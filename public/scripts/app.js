// DOM elements
const manualModal = document.getElementById('manualModal');
const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
const manualGenerateBtn = document.getElementById('manualGenerateBtn');
const manualForm = document.getElementById('manualForm');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualPreviewCloseBtn = document.getElementById('manualPreviewCloseBtn');
const manualBtn = document.getElementById('manualBtn');
const generateBtn = document.getElementById('generateBtn');
const presetSelect = document.getElementById('presetSelect');
const gallery = document.getElementById('gallery');
const galleryColumnsInput = document.getElementById('galleryColumnsInput');
const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
const cacheGallery = document.getElementById('cacheGallery');
const loadingOverlay = document.getElementById('loadingOverlay');
const confettiContainer = document.getElementById('confettiContainer');
const manualModel = document.getElementById('manualModel');
const manualPrompt = document.getElementById('manualPrompt');
const manualUc = document.getElementById('manualUc');
const manualResolution = document.getElementById('manualResolution');
const manualSteps = document.getElementById('manualSteps');
const manualGuidance = document.getElementById('manualGuidance');
const manualSeed = document.getElementById('manualSeed');
const manualSampler = document.getElementById('manualSampler');
const manualRescale = document.getElementById('manualRescale');
const manualNoiseScheduler = document.getElementById('manualNoiseScheduler');
const manualPresetName = document.getElementById('manualPresetName');
const manualUpscale = document.getElementById('manualUpscale');
const clearSeedBtn = document.getElementById('clearSeedBtn');
const manualNoiseSchedulerDropdown = document.getElementById('manualNoiseSchedulerDropdown');
const manualNoiseSchedulerDropdownBtn = document.getElementById('manualNoiseSchedulerDropdownBtn');
const manualNoiseSchedulerDropdownMenu = document.getElementById('manualNoiseSchedulerDropdownMenu');
const manualNoiseSchedulerSelected = document.getElementById('manualNoiseSchedulerSelected');
const manualNoiseSchedulerHidden = document.getElementById('manualNoiseScheduler');
let manualSelectedNoiseScheduler = '';
const variationImage = document.getElementById('manualVariationImage');
const manualResolutionDropdown = document.getElementById('manualResolutionDropdown');
const manualResolutionDropdownBtn = document.getElementById('manualResolutionDropdownBtn');
const manualResolutionDropdownMenu = document.getElementById('manualResolutionDropdownMenu');
const manualResolutionSelected = document.getElementById('manualResolutionSelected');
const manualResolutionHidden = document.getElementById('manualResolution');
const manualCustomResolution = document.getElementById('manualCustomResolution');
const manualCustomResolutionBtn = document.getElementById('manualCustomResolutionBtn');
const previewSection = document.getElementById('manualPanelSection');
const manualWidth = document.getElementById('manualWidth');
const manualHeight = document.getElementById('manualHeight');
let manualSelectedResolution = '';
let manualSelectedGroup = '';
const customPresetDropdown = document.getElementById('customPresetDropdown');
const customPresetDropdownBtn = document.getElementById('customPresetDropdownBtn');
const customPresetDropdownMenu = document.getElementById('customPresetDropdownMenu');
const customPresetSelected = document.getElementById('customPresetSelected');
let selectedPreset = '';
const manualSamplerDropdown = document.getElementById('manualSamplerDropdown');
const manualSamplerDropdownBtn = document.getElementById('manualSamplerDropdownBtn');
const manualSamplerDropdownMenu = document.getElementById('manualSamplerDropdownMenu');
const manualSamplerSelected = document.getElementById('manualSamplerSelected');
const manualSamplerHidden = document.getElementById('manualSampler');
let manualSelectedSampler = '';
const manualModelDropdown = document.getElementById('manualModelDropdown');
const manualModelDropdownBtn = document.getElementById('manualModelDropdownBtn');
const manualModelDropdownMenu = document.getElementById('manualModelDropdownMenu');
const manualModelSelected = document.getElementById('manualModelSelected');
const manualModelHidden = document.getElementById('manualModel');
const customWidth = document.getElementById('manualCustomWidth');
const customHeight = document.getElementById('manualCustomHeight');
let manualSelectedModel = '';
const presetAutocompleteOverlay = document.getElementById('presetAutocompleteOverlay');
const presetAutocompleteList = document.querySelector('.preset-autocomplete-list');
const metadataDialog = document.getElementById('metadataDialog');
const closeMetadataDialog = document.getElementById('closeMetadataDialog');
const dialogPromptBtn = document.getElementById('dialogPromptBtn');
const dialogUcBtn = document.getElementById('dialogUcBtn');
const dialogPromptExpanded = document.getElementById('dialogPromptExpanded');
const dialogUcExpanded = document.getElementById('dialogUcExpanded');
const dialogPromptContent = document.getElementById('dialogPromptContent');
const dialogUcContent = document.getElementById('dialogUcContent');
const deleteImageBaseBtn = document.getElementById('deleteImageBaseBtn');
const transformationDropdown = document.getElementById('transformationDropdown');
const transformationDropdownBtn = document.getElementById('transformationDropdownBtn');
const transformationDropdownMenu = document.getElementById('transformationDropdownMenu');
const manualPreviewDownloadBtn = document.getElementById('manualPreviewDownloadBtn');
const manualPreviewUpscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
const manualPreviewVariationBtn = document.getElementById('manualPreviewVariationBtn');
const manualPreviewSeedBtn = document.getElementById('manualPreviewSeedBtn');
const manualPreviewDeleteBtn = document.getElementById('manualPreviewDeleteBtn');
const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
const manualStrengthValue = document.getElementById('manualStrengthValue');
const manualNoiseValue = document.getElementById('manualNoiseValue');
const paidRequestToggle = document.getElementById('paidRequestToggle');
const manualPresetToggleBtn = document.getElementById('manualPresetToggleBtn');
const manualPresetToggleText = document.getElementById('manualPresetToggleText');
const manualPresetToggleIcon = document.getElementById('manualPresetToggleIcon');
const manualPresetGroup = document.getElementById('manualPresetGroup');
const manualLoadBtn = document.getElementById('manualLoadBtn');
const manualSaveBtn = document.getElementById('manualSaveBtn');
const manualPreviewLoadBtn = document.getElementById('manualPreviewLoadBtn');
const manualPreviewPinBtn = document.getElementById('manualPreviewPinBtn');
const manualPreviewScrapBtn = document.getElementById('manualPreviewScrapBtn');
const datasetDropdown = document.getElementById('datasetDropdown');
const datasetDropdownBtn = document.getElementById('datasetDropdownBtn');
const datasetDropdownMenu = document.getElementById('datasetDropdownMenu');
const datasetSelected = document.getElementById('datasetSelected');
const datasetIcon = document.getElementById('datasetIcon');
let selectedDatasets = [];  
let datasetBias = {
    anime: 1.0,
    furry: 1.0,
    backgrounds: 1.0
};
const qualityToggleBtn = document.getElementById('qualityToggleBtn');
let appendQuality = true;
const ucPresetsDropdown = document.getElementById('ucPresetsDropdown');
const ucPresetsDropdownBtn = document.getElementById('ucPresetsDropdownBtn');
const ucPresetsDropdownMenu = document.getElementById('ucPresetsDropdownMenu');
let selectedUcPreset = 3; 
let presetAutocompleteTimeout = null;
let currentPresetAutocompleteTarget = null;
let selectedPresetAutocompleteIndex = -1;
let presetSearchResults = [];
const logoutButton = document.getElementById('logoutButton');
let infiniteScrollLoading = document.getElementById('infiniteScrollLoading');
const addCharacterBtn = document.getElementById('addCharacterBtn');
const characterPromptsContainer = document.getElementById('characterPromptsContainer');
const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
const transformationRow = document.getElementById('transformationRow');
const manualPreviewOriginalImage = document.getElementById('manualPreviewOriginalImage');

// Global variables
let forcePaidRequest = false;
let allImages = [];

// Make u1 array available globally for tag highlighting
if (typeof u1 !== 'undefined') {
    window.u1 = u1;
}
// Infinite scroll variables
let imagesPerPage = 12;
let isLoadingMore = false;
let hasMoreImages = true;
let hasMoreImagesBefore = false; // Track if there are images before current page
let visibleItems = new Set(); // Track visible items
let virtualScrollEnabled = true; // Enable virtual scrolling
let currentImage = null;
let currentManualPreviewImage = null;

// Bidirectional infinite scroll tracking
let displayedStartIndex = 0; // First displayed image index in allImages array
let displayedEndIndex = 0;   // Last displayed image index in allImages array

// Improved infinite scroll configuration
let infiniteScrollConfig = {
    // Percentage-based triggers (more responsive to different screen sizes)
    bottomTriggerPercent: 0.15, // 15% from bottom
    topTriggerPercent: 0.15,    // 15% from top
    placeholderTriggerPercent: 0.25, // 25% for placeholder scheduling
    
    // Dynamic batch sizing based on viewport
    minBatchSize: 6,
    maxBatchSize: 24,
    
    // Performance optimization
    throttleDelay: 100, // ms between scroll checks
    debounceDelay: 300, // ms after scroll stops
    
    // Responsive adjustments
    smallScreenThreshold: 768, // px
    smallScreenMultiplier: 0.5, // Reduce triggers on small screens
};

// Selection state
let selectedImages = new Set();
let isSelectionMode = false;
let lastSelectedGalleryIndex = null; // Track last selected index for range selection

// Global options data
let optionsData = null;

let currentBalance = null;

// Three-way mapping for samplers
const SAMPLER_MAP = [
  { meta: 'k_euler_ancestral', display: 'Euler Ancestral', display_short: 'Euler', badge: 'A', request: 'EULER_ANC' },
  { meta: 'k_dpmpp_sde', display: 'DPM++ SDE', display_short: 'DPM', badge: 'SDE', request: 'DPMSDE' },
  { meta: 'k_dpmpp_2m', display: 'DPM++ 2M', display_short: 'DPM', badge: '2M', request: 'DPM2M' },
  { meta: 'k_dpmpp_2m_sde', display: 'DPM++ 2M SDE', display_short: 'DPM', badge: '2M/SDE', request: 'DPM2MSDE' },
  { meta: 'k_euler', display: 'Euler', display_short: 'Euler', request: 'EULER' },
  { meta: 'k_dpmpp_2s_ancestral', display: 'DPM++ 2S Ancestral', display_short: 'DPM', badge: '2S/A', request: 'DPM2S_ANC' }
];
const NOISE_MAP = [
  { meta: 'karras', display: 'Kerras', request: 'KARRAS' },
  { meta: 'exponential', display: 'Exponential', request: 'EXPONENTIAL' },
  { meta: 'polyexponential', display: 'Polyexponental', request: 'POLYEXPONENTIAL' }
];
const RESOLUTIONS = [
    { value: 'small_portrait', display: 'Small Portrait', width: 512, height: 768 },
    { value: 'small_landscape', display: 'Small Landscape', width: 768, height: 512 },
    { value: 'small_square', display: 'Small Square', width: 640, height: 640 },
    { value: 'normal_portrait', display: 'Normal Portrait', width: 832, height: 1216 },
    { value: 'normal_landscape', display: 'Normal Landscape', width: 1216, height: 832 },
    { value: 'normal_square', display: 'Normal Square', width: 1024, height: 1024 },
    { value: 'large_portrait', display: 'Large Portrait', width: 1024, height: 1536 },
    { value: 'large_landscape', display: 'Large Landscape', width: 1536, height: 1024 },
    { value: 'large_square', display: 'Large Square', width: 1472, height: 1472 },
    { value: 'wallpaper_portrait', display: 'Wallpaper Portrait', width: 1088, height: 1920 },
    { value: 'wallpaper_landscape', display: 'Wallpaper Widescreen', width: 1920, height: 1088 }
];
const resolutions = RESOLUTIONS.map(r => r.value);
const RESOLUTION_GROUPS = [
    {
        group: 'Normal',
        options: RESOLUTIONS.filter(r => r.value.startsWith('normal_')).map(r => ({
            value: r.value,
            name: r.display.replace('Normal ', ''),
            dims: `${r.width}x${r.height}`
        })),
        free: true
    },
    {
        group: 'Large',
        badge: 'LG',
        options: RESOLUTIONS.filter(r => r.value.startsWith('large_')).map(r => ({
            value: r.value,
            name: r.display.replace('Large ', ''),
            dims: `${r.width}x${r.height}`
        }))
    },
    {
        group: 'Wallpaper',
        badge: 'WP',
        options: RESOLUTIONS.filter(r => r.value.startsWith('wallpaper_')).map(r => ({
            value: r.value,
            name: r.display.replace('Wallpaper ', ''),
            dims: `${r.width}x${r.height}`
        }))
    },
    {
        group: 'Small',
        badge: 'SM',
        options: RESOLUTIONS.filter(r => r.value.startsWith('small_')).map(r => ({
            value: r.value,
            name: r.display.replace('Small ', ''),
            dims: `${r.width}x${r.height}`
        })),
        free: true
    },
    {
        group: 'Custom',
        options: [
            { value: 'custom', name: 'Custom Resolution' },
        ]
    }
];

const modelGroups = [
    {
        group: 'Current Model',
        options: [
            { value: 'v4_5', name: 'NovelAI v4.5', display: 'v4.5' },
            { value: 'v4_5_cur', name: 'NovelAI v4.5 Curated', display: 'v4.5', badge: 'C', badge_class: 'curated-badge' },
            { value: 'v4', name: 'NovelAI v4', display: 'v4' },
            { value: 'v4_cur', name: 'NovelAI v4 Curated', display: 'v4', badge: 'C', badge_class: 'curated-badge' }
        ]
    },
    {
        group: 'Legacy Model',
        options: [
            { value: 'v3', name: 'NovelAI v3 Anime', display: 'v3', badge: 'L', badge_class: 'legacy-badge' },
            { value: 'v3_furry', name: 'NovelAI v3 Furry', display: 'v3', badge: 'LF', badge_class: 'legacy-furry-badge' }
        ]
    }
];

const modelKeys = {
    "nai-diffusion-3": { type: "Anime", version: "v3" },
    "nai-diffusion-4-full": { type: "Anime", version: "v4" },
    "nai-diffusion-4-curated-preview": { type: "Anime", version: "v4C" },
    "nai-diffusion-4-5-full": { type: "Anime", version: "v4.5" },
    "nai-diffusion-4-5-curated": { type: "Anime", version: "v4.5C" },
    "nai-diffusion-furry-3": { type: "Furry", version: "v3" }
}

// Helper function to check if a model is V3
function isV3Model(modelValue) {
    if (!modelValue) return false;
    const model = modelValue.toLowerCase();
    return model === 'v3' || model === 'v3_furry';
}

// Helper function to get currently selected model
function getCurrentSelectedModel() {
    return manualSelectedModel || manualModelHidden?.value || '';
}

// Helper function to update UI visibility based on V3 model selection
function updateV3ModelVisibility() {
    const isV3Selected = isV3Model(getCurrentSelectedModel());

    // Hide/show dataset controls for V3 models
    const datasetBiasControls = document.querySelector('#manualModal .prompt-tabs .tab-buttons button[data-tab="settings"]')

    if (datasetDropdown) {
        datasetDropdown.style.display = isV3Selected ? 'none' : '';
    }
    if (datasetBiasControls) {
        datasetBiasControls.style.display = isV3Selected ? 'none' : '';
    }

    // Hide/show character prompts for V3 models
    if (addCharacterBtn) {
        addCharacterBtn.style.display = isV3Selected ? 'none' : '';
    }
    if (characterPromptsContainer) {
        characterPromptsContainer.style.display = isV3Selected ? 'none' : '';
    }

    // Store the V3 state for later use
    window.isV3ModelSelected = isV3Selected;
}

// Helper function to update save button state based on preset name
function updateSaveButtonState() {
    if (manualSaveBtn && manualPresetName) {
        const hasPresetName = manualPresetName.value.trim().length > 0;
        manualSaveBtn.disabled = !hasPresetName;

        if (hasPresetName) {
            manualSaveBtn.classList.remove('disabled');
        } else {
            manualSaveBtn.classList.add('disabled');
        }
    }
}

// Helper function to update load button state based on preset name validation
function updateLoadButtonState() {
    if (!manualLoadBtn || !manualPresetName) return;

    const presetName = manualPresetName.value.trim();
    if (!presetName) {
        manualLoadBtn.disabled = true;
        manualLoadBtn.classList.add('disabled');
        return;
    }

    // Check if preset exists in available presets
    const isValidPreset = window.optionsData.presets && window.optionsData.presets.includes(presetName);

    manualLoadBtn.disabled = !isValidPreset;

    if (isValidPreset) {
        manualLoadBtn.classList.remove('disabled');
    } else {
        manualLoadBtn.classList.add('disabled');
    }
}

// Debounced preset validation
let presetValidationTimeout = null;
function validatePresetWithTimeout() {
    clearTimeout(presetValidationTimeout);
    presetValidationTimeout = setTimeout(() => {
        updateLoadButtonState();
        updateSaveButtonState();
    }, 300); // 300ms delay
}

// Load preset into manual form
async function loadPresetIntoForm(presetName) {
    try {
        const response = await fetch(`/preset/${presetName}`, {
            method: 'OPTIONS',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to load preset: ${response.statusText}`);
        }

        const presetData = await response.json();
        await loadIntoManualForm(presetData);

        showGlassToast('success', null, `${presetName} Loaded`);
    } catch (error) {
        console.error('Load preset error:', error);
        showError(`Failed to load preset "${presetName}": ${error.message}`);
    }
}

// Helper functions for sampler mapping
function getSamplerMeta(meta) {
  return SAMPLER_MAP.find(s => s.meta.toLowerCase() === meta.toLowerCase());
}

// Helper functions for noise mapping
function getNoiseMeta(meta) {
  return NOISE_MAP.find(n => n.meta.toLowerCase() === meta.toLowerCase());
}

// Custom Preset Dropdown Functions
async function renderCustomPresetDropdown(selectedVal) {
    customPresetDropdownMenu.innerHTML = '';

    // Use global presets loaded from /options
    if (Array.isArray(window.optionsData.presets) && window.optionsData.presets.length > 0) {
        // Presets group header
        const presetsGroupHeader = document.createElement('div');
        presetsGroupHeader.className = 'custom-dropdown-group';
        presetsGroupHeader.innerHTML = '<i class="nai-heart-enabled"></i> Presets';
        customPresetDropdownMenu.appendChild(presetsGroupHeader);

        for (const preset of window.optionsData.presets) {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedVal === `preset:${preset.name}` ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = `preset:${preset.name}`;
            option.dataset.type = 'preset';
            option.innerHTML = `
                <div class="preset-option-content">
                    <div class="preset-name">${preset.name}</div>
                    <div class="preset-details">
                        <span class="preset-model">${window.optionsData?.modelsShort[preset.model.toUpperCase()] || preset.model || 'Default'}</span>
                        <div class="preset-icons">
                            ${preset.upscale ? '<i class="nai-upscale" title="Upscale enabled"></i>' : ''}
                            ${preset.allow_paid ? '<i class="nai-anla" title="Allow paid"></i>' : ''}
                            ${preset.variety ? '<i class="nai-wand-sparkles" title="Variety enabled"></i>' : ''}
                            ${preset.character_prompts ? '<i class="fas fa-users" title="Character prompts"></i>' : ''}
                            ${preset.base_image ? '<i class="fas fa-image" title="Has base image"></i>' : ''}
                        </div>
                        <span class="preset-resolution">${preset.resolution || 'Default'}</span>
                    </div>
                </div>
            `;
            option.addEventListener('click', () => {
                selectCustomPreset(`preset:${preset.name}`);
                closeCustomPresetDropdown();
            });
            option.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    selectCustomPreset(`preset:${preset.name}`);
                    closeCustomPresetDropdown();
                }
            });
            customPresetDropdownMenu.appendChild(option);
        }
    }
}

function selectCustomPreset(value) {
    selectedPreset = value;

    // Update button display
    if (value.startsWith('preset:')) {
        const presetName = value.replace('preset:', '');
        customPresetSelected.innerHTML = `<i class="nai-heart-enabled"></i> ${presetName}`;
    } else {
        customPresetSelected.innerHTML = '<i class="nai-pen-tip-light"></i> Select Preset';
    }

    // Sync with hidden select for compatibility
    presetSelect.value = value;

    // Trigger any listeners (e.g., updateGenerateButton)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
}

function closeCustomPresetDropdown() {
    closeDropdown(customPresetDropdownMenu, customPresetDropdownBtn);
}

setupDropdown(
    customPresetDropdown,
    customPresetDropdownBtn,
    customPresetDropdownMenu,
    renderCustomPresetDropdown,
    () => selectedPreset
);

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

function renderManualResolutionDropdown(selectedVal) {
    renderGroupedDropdown(
        manualResolutionDropdownMenu,
        RESOLUTION_GROUPS,
        selectManualResolution,
        () => closeDropdown(manualResolutionDropdownMenu, manualResolutionDropdownBtn),
        selectedVal,
        (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`
    );
}

async function selectManualResolution(value, group) {
    manualSelectedResolution = value.toLowerCase();

    // If group is not provided, find it automatically
    if (!group) {
        for (const g of RESOLUTION_GROUPS) {
            const found = g.options.find(o => o.value === value.toLowerCase());
            if (found) {
                group = g.group;
                break;
            }
        }
    }

    manualSelectedGroup = group;

    // Handle custom resolution mode
    if (value === 'custom') {
        manualResolutionDropdown.style.display = 'none';
        manualCustomResolution.style.display = 'flex';
        manualCustomResolutionBtn.setAttribute('data-state', 'on');
        manualResolutionGroup.classList.add('expanded');
        // Set default values if empty
        if (!manualWidth.value) manualWidth.value = '1024';
        if (!manualHeight.value) manualHeight.value = '1024';
        // Sanitize the default values
        sanitizeCustomDimensions();
    } else {
        manualResolutionDropdown.style.display = 'block';
        manualCustomResolution.style.display = 'none';
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

    // Trigger any listeners (e.g., updateGenerateButton or manual form update)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
    // Update price display
    updateManualPriceDisplay();

    // --- ADDED: Refresh preview image if in bias mode ---
    if (window.uploadedImageData && window.uploadedImageData.isBiasMode && manualModal && manualModal.style.display === 'flex') {
        // Reset bias to center (2) when resolution changes
        const resetBias = 2;
        if (imageBiasHidden != null) {
            imageBiasHidden.value = resetBias.toString();
        }
        window.uploadedImageData.bias = resetBias;

        // Re-crop and update preview with reset bias
        await cropImageToResolution();

        // Re-render the dropdown options to reflect new resolution and reset bias
        renderImageBiasDropdown(resetBias.toString());
    }
}

setupDropdown(
    manualResolutionDropdown,
    manualResolutionDropdownBtn,
    manualResolutionDropdownMenu,
    renderManualResolutionDropdown,
    () => manualSelectedResolution
);

// Replace the three function definitions with the new combined function
async function loadIntoManualForm(source, image = null) {
    try {
        let data = {};
        let type = 'metadata';
        let name = '';

        // Save the current preset name before clearing the form
        const currentPresetName = manualPresetName ? manualPresetName.value.trim() : '';

        // Save source and image to initialEdit for preview functionality
        window.initialEdit = {
            source: source,
            image: image
        };

        // Clear form first for all cases
        clearManualForm();

        if (typeof source === 'string') {
            const [presetType, presetName] = source.split(':');
            if (!presetType || !presetName) {
                throw new Error('Invalid preset value format');
            }
            name = presetName;

            let endpoint = '';
            if (presetType === 'preset') {
                type = 'preset';
                endpoint = `/preset/${presetName}`;
            } else {
                throw new Error('Invalid type');
            }

            const response = await fetchWithAuth(endpoint, {
                method: 'OPTIONS',
            });
            if (!response.ok) {
                throw new Error(`Failed to load ${presetType} data`);
            }
            data = await response.json();

            // Preprocess sampler and noiseScheduler
            if (data.sampler) {
                const samplerObj = getSamplerMeta(data.sampler) || getSamplerMeta(data.sampler);
                data.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';
            }
            if (data.noiseScheduler || data.noise_schedule) {
                const noiseObj = getNoiseMeta(data.noiseScheduler || data.noise_schedule) || getNoiseMeta(data.noiseScheduler || data.noise_schedule);
                data.noiseScheduler = noiseObj ? noiseObj.meta : 'karras';
            }

        } else if (typeof source === 'object' && source !== null) {
            type = 'metadata';
            data = source;

            // Handle resolution
            data.resolution = (data.resolution || 'normal_portrait').toLowerCase();
            if (!data.resolution.match(/^(small_|normal_|large_|wallpaper_)/) && data.width && data.height) {
                data.resolution = 'custom';
                if (manualWidth) manualWidth.value = data.width;
                if (manualHeight) manualHeight.value = data.height;
                sanitizeCustomDimensions();
            }

            // Handle sampler and noise
            if (data.sampler) {
                const samplerObj = getSamplerMeta(data.sampler);
                data.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';
            }

            if (data.noise_schedule) {
                const noiseObj = getNoiseMeta(data.noise_schedule);
                data.noiseScheduler = noiseObj ? noiseObj.meta : 'karras';
            }

            name = data.preset_name;
        } else {
            throw new Error('Invalid source');
        }

        // Common form population
        if (manualPrompt) {
            manualPrompt.value = data.prompt || '';
        }
        if (manualUc) {
            manualUc.value = data.uc || '';
            autoResizeTextarea(manualUc);
            updateEmphasisHighlighting(manualUc);
        }
        selectManualModel(data.model || 'v4_5', '');

        // Handle resolution loading with proper custom dimension support
        let resolutionToSet = (data.resolution || 'normal_portrait').toLowerCase();
        let resolutionGroup = undefined;

        if (data.width && data.height && (!data.resolution || !data.resolution.match(/^(small_|normal_|large_|wallpaper_)/))) {
            resolutionToSet = 'custom';
            resolutionGroup = 'Custom';
            // Set custom dimensions before calling selectManualResolution
            if (manualWidth) manualWidth.value = data.width;
            if (manualHeight) manualHeight.value = data.height;
        }
        selectManualResolution(resolutionToSet, resolutionGroup);

        // Handle custom dimensions after resolution is set
        if (data.width && data.height && resolutionToSet === 'custom') {
            if (customWidth && customHeight) {
                customWidth.value = data.width;
                customHeight.value = data.height;
            }
            // Sanitize dimensions after setting
            sanitizeCustomDimensions();
        }
        if (manualSteps) manualSteps.value = data.steps || 25;
        if (manualGuidance) {
            const guidanceValue = data.scale ?? data.guidance ?? 5.0;
            manualGuidance.value = guidanceValue !== undefined ? Number(guidanceValue).toFixed(1) : '';
        }
        if (manualRescale) {
            const rescaleValue = data.cfg_rescale ?? data.rescale ?? 0.0;
            manualRescale.value = rescaleValue !== undefined ? Number(rescaleValue).toFixed(2) : '';
        }
        if (manualSeed) manualSeed.value = ''; // Do not autofill for metadata, undefined for others
        if (data.seed) {
            window.lastGeneratedSeed = data.layer2_seed || data.seed;
            manualPreviewSeedNumber.textContent = parseInt(window.lastGeneratedSeed);
        }
        selectManualSampler(data.sampler || 'k_euler_ancestral');
        selectManualNoiseScheduler(data.noiseScheduler || 'karras');
        if (document.getElementById('varietyBtn')) {
            const varietyBtn = document.getElementById('varietyBtn');
            varietyEnabled = data.skip_cfg_above_sigma !== null && data.skip_cfg_above_sigma !== undefined;
            varietyBtn.setAttribute('data-state', varietyEnabled ? 'on' : 'off');
        }

        // Handle upscale
        const upscaleState = data.upscale ? 'on' : 'off';
        if (manualUpscale) manualUpscale.setAttribute('data-state', upscaleState);

        // Handle character prompts and auto position
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        if (data.characterPrompts && Array.isArray(data.characterPrompts)) {
            loadCharacterPrompts(data.characterPrompts, data.use_coords);
            autoPositionBtn.setAttribute('data-state', data.use_coords ? 'off' : 'on');
        } else if (data.allCharacterPrompts && Array.isArray(data.allCharacterPrompts)) {
            // Handle new allCharacterPrompts format
            loadCharacterPrompts(data.allCharacterPrompts, data.use_coords);
            autoPositionBtn.setAttribute('data-state', data.use_coords ? 'off' : 'on');
        } else {
            clearCharacterPrompts();
        }


        // Load new parameters from metadata if available
        if (data.dataset_config && data.dataset_config.include) {
            selectedDatasets = [...data.dataset_config.include];

            // Load bias values
            if (data.dataset_config.bias) {
                Object.keys(data.dataset_config.bias).forEach(dataset => {
                    if (datasetBias[dataset] !== undefined) {
                        datasetBias[dataset] = data.dataset_config.bias[dataset];
                    }
                });
            }

            // Load dataset settings
            if (data.dataset_config.settings) {
                Object.keys(data.dataset_config.settings).forEach(dataset => {
                    const datasetSettings = data.dataset_config.settings[dataset];
                    Object.keys(datasetSettings).forEach(settingId => {
                        const setting = datasetSettings[settingId];
                        if (setting.enabled !== undefined) {
                            // Store setting state for UI updates
                            if (!window.datasetSettings) window.datasetSettings = {};
                            if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
                            window.datasetSettings[dataset][settingId] = {
                                enabled: setting.enabled,
                                bias: setting.bias || 1.0,
                                value: setting.value
                            };
                        }
                    });
                });
            }
        } else {
            selectedDatasets = []; // Default
            // Reset bias values to defaults
            datasetBias = {
                anime: 1.0,
                furry: 1.0,
                backgrounds: 1.0
            };
        }
        updateDatasetDisplay();
        renderDatasetDropdown();
        renderDatasetBiasControls();

        if (data.append_quality !== undefined) {
            appendQuality = data.append_quality;
            if (qualityToggleBtn) {
                qualityToggleBtn.setAttribute('data-state', appendQuality ? 'on' : 'off');
            }
        } else {
            appendQuality = true;
            if (qualityToggleBtn) {
                qualityToggleBtn.setAttribute('data-state', 'on');
            }
        }

        if (data.append_uc !== undefined) {
            selectedUcPreset = data.append_uc;
        } else {
            selectedUcPreset = 3;
        }
        selectUcPreset(selectedUcPreset);
        renderUcPresetsDropdown();

        // Load character prompts - check for allCharacters first (saved input), then characterPrompts (extracted)
        if (data.allCharacters && Array.isArray(data.allCharacters)) {
            loadCharacterPrompts(data.allCharacters, data.use_coords);
        } else if (data.characterPrompts && Array.isArray(data.characterPrompts)) {
            loadCharacterPrompts(data.characterPrompts, data.use_coords);
        } else {
            clearCharacterPrompts();
        }

        // Handle new parameters
        // Handle allow_paid setting
        if (data.allow_paid !== undefined) {
            // This would need a UI element to display/set allow_paid
            // For now, we'll just store it in a global variable
            window.currentAllowPaid = data.allow_paid;
        }

        // Handle vibe transfer data from forge data (disabled when inpainting is enabled)
        if (data.vibe_transfer && Array.isArray(data.vibe_transfer) && data.vibe_transfer.length > 0) {
            // Check if inpainting is enabled (mask is present)
            if (data.mask_compressed || data.mask) {
                console.log(`⚠️ Skipping vibe transfers due to inpainting mask presence`);
                // Clear vibe references if inpainting is enabled
                if (vibeReferencesContainer) {
                    vibeReferencesContainer.innerHTML = '';
                }
                if (transformationRow) {
                    transformationRow.classList.remove('display-vibe');
                }
                if (vibeNormalizeToggle) {
                    vibeNormalizeToggle.style.display = 'none';
                }
            } else {
                // Load vibe references if not already loaded
                if (vibeReferences.length === 0) {
                    try {
                        await loadVibeReferences();
                    } catch (error) {
                        console.error('Failed to load vibe references for forge data:', error);
                    }
                }

                // Clear existing vibe references
                if (vibeReferencesContainer) {
                    vibeReferencesContainer.innerHTML = '';
                }
                if (transformationRow) {
                    transformationRow.classList.add('display-vibe');
                }

                // Add each vibe transfer back to the container
                for (const vibeTransfer of data.vibe_transfer) {
                    await addVibeReferenceToContainer(vibeTransfer.id, vibeTransfer.ie, vibeTransfer.strength);
                }
                
                if (vibeNormalizeToggle) {
                    vibeNormalizeToggle.style.display = '';
                }

                console.log(`🎨 Restored ${data.vibe_transfer.length} vibe transfers from forge data`);
            }
        } else {
            // Clear vibe references if no data
            if (vibeReferencesContainer) {
                vibeReferencesContainer.innerHTML = '';
            }
            if (transformationRow) {
                transformationRow.classList.remove('display-vibe');
            }
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.style.display = 'none';
            }
        }

        // Handle vibe normalize setting
        if (data.normalize_vibes !== undefined) {
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.setAttribute('data-state', data.normalize_vibes ? 'on' : 'off');
            }
        } else {
            // Default to on if not specified
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.setAttribute('data-state', 'on');
            }
        }

        // Handle image source data
        const hasBaseImage = data.image_source;

        if (hasBaseImage) {
            const [imageType, identifier] = data.image_source.split(':', 2);
            let previewUrl = '';

            window.uploadedImageData = {
                image_source: data.image_source,
                bias: typeof data.image_bias === 'number' ? data.image_bias : 2,
                image_bias: typeof data.image_bias === 'object' ? data.image_bias : undefined,
                isBiasMode: true,
                isClientSide: false
            };
            if (typeof data.image_bias === 'object') {
                imageBiasAdjustmentData.currentBias = data.image_bias;
            }
            if (imageType === 'cache') {
                previewUrl = `/cache/preview/${identifier}.webp`;
            } else if (imageType === 'file') {
                previewUrl = `/images/${identifier}`;
            }
            if (previewUrl) {
                await new Promise((resolve) => {
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        window.uploadedImageData.width = tempImg.width;
                        window.uploadedImageData.height = tempImg.height;
                        resolve();
                    };
                    tempImg.src = previewUrl;
                })
                if (variationImage) {
                    // Image is always visible now, just set the source
                }
                // Show transformation section content
                if (transformationRow) {
                    transformationRow.classList.add('display-image');
                }
                document.getElementById('manualStrengthGroup').style.display = '';
                document.getElementById('manualNoiseGroup').style.display = '';
            }
            // Ensure preview is updated with bias/crop
            await cropImageToResolution();

            if (data.mask_compressed !== undefined && data.mask_compressed !== null) {
                // Store the compressed mask data for later use
                window.currentMaskCompressed = data.mask_compressed;

                // Process compressed mask to display resolution
                const targetWidth = data.width || 1024;
                const targetHeight = data.height || 1024;

                try {
                    window.currentMaskData = await processCompressedMask(data.mask_compressed, targetWidth, targetHeight);
                    console.log('✅ Successfully processed compressed mask for regular image');
                    // Update vibe transfer UI state after mask is loaded
                    updateInpaintButtonState();
                } catch (error) {
                    console.error('❌ Failed to process compressed mask for regular image:', error);
                    // Fallback to regular mask if available
                    if (data.mask !== undefined && data.mask !== null) {
                        window.currentMaskData = "data:image/png;base64," + data.mask;
                    }
                }
            } else if (data.mask !== undefined && data.mask !== null) {
                window.currentMaskData = "data:image/png;base64," + data.mask;
                console.log('✅ Loaded regular mask for regular image');

                // Auto-convert standard mask to compressed format for consistency
                try {
                    const compressedMask = await convertStandardMaskToCompressed(data.mask, data.width || 1024, data.height || 1024);
                    if (compressedMask) {
                        window.currentMaskCompressed = compressedMask;
                        console.log('🔄 Auto-converted standard mask to compressed format');
                    }
                } catch (error) {
                    console.warn('⚠️ Failed to auto-convert standard mask to compressed:', error);
                }
            }

            if(data.image_bias !== undefined && data.image_bias !== null) {
                // Handle both legacy (number) and dynamic (object) bias
                if (typeof data.image_bias === 'object') {
                    await renderImageBiasDropdown('custom');
                } else {
                    await renderImageBiasDropdown(data.image_bias.toString());
                }
            } else {
                await renderImageBiasDropdown();
            }

            if (manualStrengthValue && data.strength !== undefined && data.strength !== null) {
                manualStrengthValue.value = data.strength;
                window.strengthValueLoaded = true;
            }
            if (manualNoiseValue && data.noise !== undefined && data.noise !== null) {
                manualNoiseValue.value = data.noise;
            }

        } else {
            // No image source - clear any existing image data
            if (window.currentEditMetadata) {
                delete window.currentEditMetadata.sourceFilename;
                delete window.currentEditMetadata.isVariationEdit;
            }
            if (variationImage) {
                variationImage.src = '';
            }

            // Hide transformation section content
            if (transformationRow) {
                transformationRow.classList.remove('display-image');
            }
            document.getElementById('manualStrengthGroup').style.display = 'none';
            document.getElementById('manualNoiseGroup').style.display = 'none';
        }

        // Type-specific handling
        if (name) {
            manualPresetName.value = name;
        }

        if (type === 'preset') {
            // Preset-specific
            const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
            if (presetNameGroup) {
                presetNameGroup.style.display = 'block';
                manualPresetName.disabled = false;
                manualPresetName.style.opacity = '1';
            }
            const saveButton = document.getElementById('manualSaveBtn');
            if (saveButton) saveButton.style.display = 'flex';
        } else if (type === 'metadata') {
            manualStrengthValue.value = (data.strength !== undefined && data.strength !== null) ? data.strength : 0.8;
            manualNoiseValue.value = (data.noise !== undefined && data.noise !== null) ? data.noise : 0.1;
            if (manualUpscale) manualUpscale.checked = false;
            // Load image into preview panel when loading from metadata
            if (image) {
                let imageToShow = image.filename;
                if (image.upscaled) {
                    imageToShow = image.upscaled;
                } else if (image.original) {
                    imageToShow = image.original;
                }
                if (imageToShow) {
                    updateManualPreview("/images/" + imageToShow);
                }
            }
        }

        updateInpaintButtonState();
        updateManualPriceDisplay();
        updateUploadDeleteButtonVisibility();
        updateSaveButtonState();
        updateLoadButtonState();
        updateManualPresetToggleBtn();

        // Restore the preset name that was entered by the user
        if (manualPresetName && currentPresetName) {
            manualPresetName.value = currentPresetName;
        }
    } catch (error) {
        console.error('Error loading into form:', error);
        showError('Failed to load data');
    }
}

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
                renderImageBiasDropdown(resetBias.toString());
            }
        }
    }
}

function isValidPresetName(name) {
    if (!name) return false;
    return window.optionsData.presets && window.optionsData.presets.includes(name);
}

function updateManualPresetToggleBtn() {
    const presetName = manualPresetName.value.trim();
    const valid = isValidPresetName(presetName);
    if (presetName === "") {
        // Hide everything, show only the toggle button as toggle-btn
        manualPresetGroup.style.display = 'none';
        manualPresetToggleBtn.style.display = '';
        manualPresetToggleBtn.classList.add('toggle-btn');
        manualPresetToggleBtn.classList.remove('hover-show');
        manualPresetToggleText.style.display = 'none';
        manualPresetToggleBtn.setAttribute('data-state', 'off');
        if (manualPresetToggleIcon) manualPresetToggleIcon.style.display = '';
    } else if (valid) {
        // Hide the group, show the toggle button with value
        manualPresetGroup.style.display = 'none';
        manualPresetToggleBtn.style.display = '';
        manualPresetToggleBtn.classList.remove('toggle-btn');
        manualPresetToggleBtn.classList.add('hover-show');
        manualPresetToggleText.textContent = presetName;
        manualPresetToggleText.style.display = '';
        if (manualPresetToggleIcon) manualPresetToggleIcon.style.display = 'none';
    } else {
        // Show the group, hide the toggle button
        manualPresetGroup.style.display = '';
        manualPresetToggleBtn.style.display = 'none';
        manualPresetToggleBtn.classList.add('toggle-btn');
        manualPresetToggleBtn.classList.remove('hover-show');
        manualPresetToggleText.style.display = 'none';
        if (manualPresetToggleIcon) manualPresetToggleIcon.style.display = 'none';
    }
}

function processResolutionValue(resolutionValue) {
    // Check if this is a custom resolution
    if (resolutionValue && resolutionValue.startsWith('custom_')) {
        const dimensions = resolutionValue.replace('custom_', '');
        const [width, height] = dimensions.split('x').map(Number);
        return { width, height, isCustom: true };
    }
    return { resolution: resolutionValue, isCustom: false };
}

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
    }
  }
}

function renderSimpleDropdown(menu, items, value_key, display_key, selectHandler, closeHandler, selectedVal) {
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
        option.addEventListener('click', action);
        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                action();
            }
        });
        menu.appendChild(option);
    });
}

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

function renderManualSamplerDropdown(selectedVal) {
  renderSimpleDropdown(manualSamplerDropdownMenu, SAMPLER_MAP, 'meta', 'display', selectManualSampler, closeManualSamplerDropdown, selectedVal);
}

function selectManualSampler(value) {
  manualSelectedSampler = value;
  const s = SAMPLER_MAP.find(s => s.meta.toLowerCase() === value.toLowerCase());
  if (s) {
    manualSamplerSelected.innerHTML = `${s.display_short || s.display}${s.badge ? `<span class="custom-dropdown-badge ${s.badge_class}">${s.badge}</span>` : ''}`;
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

function closeManualSamplerDropdown() {
    closeDropdown(manualSamplerDropdownMenu, manualSamplerDropdownBtn);
}

setupDropdown(manualSamplerDropdown, manualSamplerDropdownBtn, manualSamplerDropdownMenu, renderManualSamplerDropdown, () => manualSelectedSampler);

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

function renderManualNoiseSchedulerDropdown(selectedVal) {
  renderSimpleDropdown(manualNoiseSchedulerDropdownMenu, NOISE_MAP, 'meta', 'display', selectManualNoiseScheduler, closeManualNoiseSchedulerDropdown, selectedVal);
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

function closeManualNoiseSchedulerDropdown() {
    closeDropdown(manualNoiseSchedulerDropdownMenu, manualNoiseSchedulerDropdownBtn);
}

setupDropdown(manualNoiseSchedulerDropdown, manualNoiseSchedulerDropdownBtn, manualNoiseSchedulerDropdownMenu, renderManualNoiseSchedulerDropdown, () => manualSelectedNoiseScheduler);

function generateModelOptions() {
    // Populate models for manual form
    manualModel.innerHTML = '<option value="">Select model...</option>';
    Object.keys(window.optionsData?.models || {}).forEach(model => {
        const option = document.createElement('option');
        option.value = model.toLowerCase(); // Use lowercase to match config
        option.textContent = window.optionsData?.models[model]; // Use pretty display name
        manualModel.appendChild(option);
    });   
}

function renderManualModelDropdown(selectedVal) {
    renderGroupedDropdown(manualModelDropdownMenu, modelGroups, selectManualModel, closeManualModelDropdown, selectedVal, (opt, group) => `<span>${opt.name}</span>`);
}

function selectManualModel(value, group) {
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
    manualModelSelected.innerHTML = `${optObj.display}${optObj.badge ? '<span class="custom-dropdown-badge ' + optObj.badge_class + '">' + optObj.badge + '</span>' : groupObj.badge ? '<span class="custom-dropdown-badge ' + groupObj.badge_class + '">' + groupObj.badge + '</span>' : ''}`;
  } else {
    manualModelSelected.textContent = 'Select model...';
  }

  // Sync with hidden input for compatibility
  if (manualModelHidden) manualModelHidden.value = value.toLowerCase();

  // Update UI visibility based on model selection
  updateV3ModelVisibility();

  // Trigger any listeners (e.g., updateGenerateButton or manual form update)
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
  // Update price display
  updateManualPriceDisplay();

  // Refresh vibe references to update model-specific filtering
  refreshVibeReferences();
}

function closeManualModelDropdown() {
    closeDropdown(manualModelDropdownMenu, manualModelDropdownBtn);
}
setupDropdown(manualModelDropdown, manualModelDropdownBtn, manualModelDropdownMenu, renderManualModelDropdown, () => manualSelectedModel);

// Transformation Dropdown Functions
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
        rerollOption.style.display = shouldShowReroll ? 'flex' : 'none';
        rerollOption.classList.toggle('selected', selectedVal === 'reroll');
    }

    if (variationOption) {
        variationOption.style.display = hasBaseImage ? 'flex' : 'none';
        variationOption.classList.toggle('selected', selectedVal === 'variation');
    }

    if (browseOption) {
        browseOption.classList.toggle('selected', selectedVal === 'browse');
    }

    if (uploadOption) {
        uploadOption.classList.toggle('selected', selectedVal === 'upload');
    }
}

function selectTransformation(value) {
    // Handle specific actions
    switch(value) {
        case 'browse':
            showCacheBrowser();
            break;
        case 'upload':
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';

            fileInput.addEventListener('change', async (event) => {
                const file = event.target.files[0];
                if (file) {
                    await handleManualImageUpload(file);
                }
                // Clean up
                document.body.removeChild(fileInput);
            });

            document.body.appendChild(fileInput);
            fileInput.click();
            break;
        case 'reroll':
        case 'variation':
            // Update button display for immediate actions
            const options = {
                'reroll': 'Referance',
                'variation': 'Current'
            };
            const displayText = options[value] || 'References';
            updateTransformationDropdownState(value, displayText);

            // Handle reroll/variation logic
            handleTransformationTypeChange(value);
            break;
    }
}

function handleTransformationTypeChange(requestType) {
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
        bias: bias,
        isBiasMode: true,
        isClientSide: false
    };

    // Show transformation section content
    if (transformationRow) {
        transformationRow.classList.add('display-image');
    }
    document.getElementById('manualStrengthGroup').style.display = '';
    document.getElementById('manualNoiseGroup').style.display = '';

    cropImageToResolution();
    updateInpaintButtonState();

    // Show bias dropdown
    renderImageBiasDropdown(bias.toString());

    // Hide preset name and save for variation
    if (presetNameGroup) presetNameGroup.style.display = 'none';
    if (saveButton) saveButton.style.display = 'none';

    updateUploadDeleteButtonVisibility();
}

function openTransformationDropdown() {
    openDropdown(transformationDropdownMenu, transformationDropdownBtn);
}

function closeTransformationDropdown() {
    closeDropdown(transformationDropdownMenu, transformationDropdownBtn);
}

// Function to set up event listeners for transformation dropdown options
function setupTransformationDropdownListeners() {
    const options = transformationDropdownMenu.querySelectorAll('.custom-dropdown-option');

    options.forEach(option => {
        option.tabIndex = 0;

        option.addEventListener('click', () => {
            const value = option.dataset.value;
            selectTransformation(value);
            closeTransformationDropdown();
        });

        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                const value = option.dataset.value;
                selectTransformation(value);
                closeTransformationDropdown();
            }
        });
    });
}

// Function to update transformation dropdown state and text
function updateTransformationDropdownState(type, text) {
    const transformationType = document.getElementById('transformationType');
    const transformationSelected = document.getElementById('transformationSelected');
    const transformationDropdownBtn = document.getElementById('transformationDropdownBtn');

    if (transformationType) transformationType.value = type || '';
    if (transformationSelected) transformationSelected.textContent = text || 'References';

    // Update toggle button state
    if (transformationDropdownBtn) {
        if (type) {
            transformationDropdownBtn.setAttribute('data-state', 'on');
        } else {
            transformationDropdownBtn.setAttribute('data-state', 'off');
        }
    }
}

setupDropdown(transformationDropdown, transformationDropdownBtn, transformationDropdownMenu, renderTransformationDropdown, () => document.getElementById('transformationType').value);
setupTransformationDropdownListeners();

// Gallery view functionality
let currentGalleryView = 'images'; // 'images', 'scraps', 'pinned'


// Switch between gallery views
function switchGalleryView(view) {
    if (currentGalleryView === view) return;
    
    currentGalleryView = view;
    const toggleGroup = document.getElementById('galleryToggleGroup');
    
    // Update button states
    toggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    toggleGroup.querySelector(`[data-view="${view}"]`).classList.add('active');
    
    // Update slider position
    toggleGroup.setAttribute('data-active', view);
    
    // Handle view-specific logic
    switch (view) {
        case 'scraps':
            document.querySelector('.bokeh-background.current-bg')?.classList.add('scraps-grayscale');
            document.querySelector('.bokeh')?.classList.add('scraps-grayscale');
            loadScraps();
            break;
        case 'images':
            document.querySelector('.bokeh')?.classList.remove('scraps-grayscale');
            document.querySelectorAll('.bokeh-background').forEach(el => el.classList.remove('scraps-grayscale'));
            loadGallery();
            break;
        case 'pinned':
            document.querySelector('.bokeh')?.classList.remove('scraps-grayscale');
            document.querySelectorAll('.bokeh-background').forEach(el => el.classList.remove('scraps-grayscale'));
            loadPinned();
            break;
        case 'upscaled':
            document.querySelector('.bokeh')?.classList.remove('scraps-grayscale');
            document.querySelectorAll('.bokeh-background').forEach(el => el.classList.remove('scraps-grayscale'));
            loadUpscaled();
            break;
    }
}

// Load scraps for current workspace
async function loadScraps() {
    try {
        // Use the new /images endpoint with scraps query parameter
        const response = await fetchWithAuth('/images?scraps=true');
        if (response.ok) {
            const scrapsImageData = await response.json();
            // Update display
            allImages = scrapsImageData;
            displayCurrentPageOptimized();
        } else {
            console.error('Failed to load scraps:', response.statusText);
            allImages = [];
            resetInfiniteScroll();
            displayCurrentPageOptimized();
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading scraps:', error);
        allImages = [];
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }
}

// Load pinned images for current workspace
async function loadPinned() {
    try {
        // Use the new /images endpoint with pinned query parameter
        const response = await fetchWithAuth('/images?pinned=true');
        if (response.ok) {
            const pinnedImageData = await response.json();
            // Update display
            allImages = pinnedImageData;
            displayCurrentPageOptimized();
        } else {
            console.error('Failed to load pinned images:', response.statusText);
            allImages = [];
            resetInfiniteScroll();
            displayCurrentPageOptimized();
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading pinned images:', error);
        allImages = [];
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }
}

// Load upscaled images for current workspace
async function loadUpscaled() {
    try {
        // Use the new /images endpoint with upscaled query parameter
        const response = await fetchWithAuth('/images?upscaled=true');
        if (response.ok) {
            const upscaledImageData = await response.json();
            // Update display
            allImages = upscaledImageData;
            displayCurrentPageOptimized();
        } else {
            console.error('Failed to load upscaled images:', response.statusText);
            allImages = [];
            resetInfiniteScroll();
            displayCurrentPageOptimized();
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading upscaled images:', error);
        allImages = [];
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }
}

// Move image to scraps
async function moveToScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/scraps`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename })
        });

        if (response.ok) {
            const result = await response.json();
            showGlassToast('success', null, 'Image Scraped');

                    // If currently viewing scraps, reload them
            if (currentGalleryView === 'scraps') {
                await loadScraps();
            } else if (currentGalleryView === 'pinned') {
                await loadPinned();
            } else {
                // If viewing images, remove from gallery and add placeholder
                removeImageFromGallery(image);
            }
        } else {
            const error = await response.json();
            console.error('Move to scraps failed:', error);
            showError(`Failed to move to scraps: ${error.error}`);
        }
    } catch (error) {
        console.error('Error moving to scraps:', error);
        showError('Failed to move image to scraps');
    }
}

// Move manual preview image to scraps and advance to next image
async function moveManualPreviewToScraps() {
    if (!currentManualPreviewImage) {
        showError('No image to move to scraps');
        return;
    }

    try {
        const filename = currentManualPreviewImage.filename || currentManualPreviewImage.original || currentManualPreviewImage.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/scraps`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename })
        });

        if (response.ok) {
            // Find the current image index in the manual preview image list
            const currentIndex = allImages.findIndex(img =>
                img.original === currentManualPreviewImage.original ||
                img.upscaled === currentManualPreviewImage.upscaled
            );

            // Remove the current image from the manual preview list
            if (currentIndex !== -1) {
                allImages.splice(currentIndex, 1);
            }

            // Find the next (previous) image in the manual preview list
            let nextImage = null;
            const nextIndex = currentIndex >= allImages.length ? allImages.length - 1 : currentIndex;

            if (nextIndex >= 0 && nextIndex < allImages.length) {
                nextImage = allImages[nextIndex];
            }

            if (nextImage) {
                // Load the next image and its metadata
                try {
                    const metadataResponse = await fetchWithAuth(`/images/${nextImage.original}`, {
                        method: 'OPTIONS',
                    });
                    if (metadataResponse.ok) {
                        const metadata = await metadataResponse.json();
                        nextImage.metadata = metadata;
                    }
                } catch (error) {
                    console.warn('Failed to load metadata for next image:', error);
                }

                // Update the preview with the next image
                const imageUrl = `/images/${nextImage.original}`;
                updateManualPreview(imageUrl);

                showGlassToast('success', null, 'Image scrapped');
            } else {
                // No next image, reset the preview
                resetManualPreview();
                showGlassToast('success', null, 'Image scrapped!');
            }
        } else {
            const error = await response.json();
            console.error('Move to scraps failed:', error);
            showError(`Failed to move to scraps: ${error.error}`);
        }
    } catch (error) {
        console.error('Error moving to scraps:', error);
        showError('Failed to move image to scraps');
    }

    // Refresh gallery after processing is complete
    loadGallery(true);
}

// Remove image from scraps
async function removeFromScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/scraps`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename })
        });

        if (response.ok) {
            showGlassToast('success', null, 'Image restored');

            // If currently viewing scraps, reload them
            if (currentGalleryView === 'scraps') {
                await loadScraps();
            } else if (currentGalleryView === 'pinned') {
                await loadPinned();
            } else {
                // If viewing images, reload the gallery to show the restored image
                await loadGallery();
            }
        } else {
            const error = await response.json();
            showError(`Failed to remove from scraps: ${error.error}`);
        }
    } catch (error) {
        console.error('Error removing from scraps:', error);
        showError('Failed to remove image from scraps');
    }
}

// Toggle pin status of an image
async function togglePinImage(image, pinBtn = null) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        // Check if image is currently pinned
        const isPinned = await checkIfImageIsPinned(filename);
        
        if (isPinned) {
            // Remove from pinned
            const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/pinned`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                showGlassToast('success', null, 'Image unpinned');
            } else {
                const error = await response.json();
                showError(`Failed to unpin image: ${error.error}`);
                return;
            }
        } else {
            // Add to pinned
            const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/pinned`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                showGlassToast('success', null, 'Image pinned');
            } else {
                const error = await response.json();
                showError(`Failed to pin image: ${error.error}`);
                return;
            }
        }

        // Update the specific pin button that was clicked
        if (pinBtn) {
            await updatePinButtonAppearance(pinBtn, filename);
        } else {
            await updateSpecificPinButton(filename);
        }
        
        // Update lightbox pin button if lightbox is open
        if (window.lightboxPinBtn && window.lightboxPinBtn.style.display !== 'none') {
            await updateLightboxPinButtonAppearance(filename);
        }
    } catch (error) {
        console.error('Error toggling pin status:', error);
        showError('Failed to toggle pin status');
    }
}

// Check if an image is pinned
async function checkIfImageIsPinned(filename) {
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/pinned`);
        if (response.ok) {
            const data = await response.json();
            return data.pinned && data.pinned.includes(filename);
        }
        return false;
    } catch (error) {
        console.error('Error checking pin status:', error);
        return false;
    }
}

// Update pin button appearance based on pin status
async function updatePinButtonAppearance(pinBtn, filename) {
    try {
        const isPinned = await checkIfImageIsPinned(filename);
        if (isPinned) {
            pinBtn.innerHTML = '<i class="nai-heart-enabled"></i>';
            pinBtn.title = 'Unpin image';
        } else {
            pinBtn.innerHTML = '<i class="nai-heart-disabled"></i>';
            pinBtn.title = 'Pin image';
        }
    } catch (error) {
        console.error('Error updating pin button appearance:', error);
    }
}

// Update specific pin button for an image
async function updateSpecificPinButton(filename) {
    try {
        const galleryItems = document.querySelectorAll('.gallery-item');
        for (const item of galleryItems) {
            const img = item.querySelector('img');
            const pinBtn = item.querySelector('.btn-secondary[title*="Pin"]');
            
            if (img && pinBtn) {
                const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                if (itemFilename === filename) {
                    await updatePinButtonAppearance(pinBtn, filename);
                    break; // Found the specific item, no need to continue
                }
            }
        }
    } catch (error) {
        console.error('Error updating specific pin button:', error);
    }
}

// Remove image from gallery and add placeholder at the end
function removeImageFromGallery(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            console.error('No filename available for image removal');
            return;
        }

        // Find the gallery item to remove
        const galleryItems = document.querySelectorAll('.gallery-item');
        let itemToRemove = null;
        let itemIndex = -1;

        // Try to find by exact filename match first
        for (const item of galleryItems) {
            const img = item.querySelector('img');
            if (img) {
                const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                if (itemFilename === filename) {
                    itemToRemove = item;
                    itemIndex = parseInt(item.dataset.index);
                    break;
                }
            }
        }

        // If not found by exact match, try to find by base name (for variations/upscaled)
        if (!itemToRemove) {
            const baseName = filename.split('_')[0]; // Get the timestamp part
            for (const item of galleryItems) {
                const img = item.querySelector('img');
                if (img) {
                    const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                    const itemBaseName = itemFilename.split('_')[0];
                    if (itemBaseName === baseName) {
                        itemToRemove = item;
                        itemIndex = parseInt(item.dataset.index);
                        break;
                    }
                }
            }
        }

        if (!itemToRemove) {
            console.warn('Gallery item not found for removal:', filename);
            // Don't return, just log the warning and continue with the operation
            // The image will still be removed from allImages array and workspace
        }

        // Remove the item from the gallery if found
        if (itemToRemove) {
            itemToRemove.remove();
        }

        // Remove from allImages array
        const allImagesIndex = allImages.findIndex(img => 
            img.original === image.original || 
            img.upscaled === image.upscaled ||
            img.filename === filename
        );
        
        if (allImagesIndex !== -1) {
            allImages.splice(allImagesIndex, 1);
        }

        // Add placeholder at the index after the last item on the page
        // Re-query gallery items since we may have removed one
        const remainingGalleryItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
        const lastItemIndex = remainingGalleryItems.length > 0 ? 
            Math.min(Math.max(...Array.from(remainingGalleryItems).map(item => parseInt(item.dataset.index))), allImages.length) : -1;
        const placeholderIndex = lastItemIndex + 1;
        
        const placeholder = document.createElement('div');
        placeholder.className = 'gallery-placeholder';
        placeholder.style.height = '256px';
        placeholder.style.width = '100%';
        placeholder.dataset.index = placeholderIndex.toString();
        gallery.appendChild(placeholder);

        // Reindex all gallery items after the removed one (only if we found and removed an item)
        if (itemToRemove && itemIndex !== -1) {
            const remainingItems = gallery.querySelectorAll('.gallery-item');
            for (const item of remainingItems) {
                const currentIndex = parseInt(item.dataset.index);
                if (currentIndex > itemIndex) {
                    item.dataset.index = (currentIndex - 1).toString();
                }
            }

            // Update placeholder indices
            const placeholders = gallery.querySelectorAll('.gallery-placeholder');
            for (const placeholder of placeholders) {
                const currentIndex = parseInt(placeholder.dataset.index);
                if (currentIndex > itemIndex) {
                    placeholder.dataset.index = (currentIndex - 1).toString();
                }
            }
        }

        console.log(`Removed image ${filename} from gallery and added placeholder`);
    } catch (error) {
        console.error('Error removing image from gallery:', error);
    }
}

// Remove multiple images from gallery and add placeholders at the end
function removeMultipleImagesFromGallery(images) {
    try {
        if (!Array.isArray(images) || images.length === 0) {
            console.warn('No images provided for bulk removal');
            return;
        }

        const galleryItems = document.querySelectorAll('.gallery-item');
        const itemsToRemove = [];
        const indicesToRemove = [];

        // Find all items to remove
        for (const image of images) {
            const filename = image.filename || image.original || image.upscaled;
            if (!filename) continue;

            for (const item of galleryItems) {
                const img = item.querySelector('img');
                if (img) {
                    const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                    if (itemFilename === filename) {
                        itemsToRemove.push(item);
                        indicesToRemove.push(parseInt(item.dataset.index));
                        break;
                    }
                }
            }
        }

        // Sort indices in descending order to remove from end to beginning
        indicesToRemove.sort((a, b) => b - a);

        // Remove items from gallery
        itemsToRemove.forEach(item => item.remove());

        // Remove from allImages array
        for (const image of images) {
            const allImagesIndex = allImages.findIndex(img => 
                img.original === image.original || 
                img.upscaled === image.upscaled ||
                img.filename === (image.filename || image.original || image.upscaled)
            );
            
            if (allImagesIndex !== -1) {
                allImages.splice(allImagesIndex, 1);
            }
        }

        // Add placeholders at the end
        for (let i = 0; i < images.length; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.style.height = '256px';
            placeholder.style.width = '100%';
            placeholder.dataset.index = allImages.length + i;
            gallery.appendChild(placeholder);
        }

        // Reindex all remaining gallery items
        const remainingItems = gallery.querySelectorAll('.gallery-item');
        for (const item of remainingItems) {
            const currentIndex = parseInt(item.dataset.index);
            let newIndex = currentIndex;
            
            // Count how many items were removed before this one
            for (const removedIndex of indicesToRemove) {
                if (currentIndex > removedIndex) {
                    newIndex--;
                }
            }
            
            item.dataset.index = newIndex.toString();
        }

        // Update placeholder indices
        const placeholders = gallery.querySelectorAll('.gallery-placeholder');
        for (const placeholder of placeholders) {
            const currentIndex = parseInt(placeholder.dataset.index);
            let newIndex = currentIndex;
            
            // Count how many items were removed before this one
            for (const removedIndex of indicesToRemove) {
                if (currentIndex > removedIndex) {
                    newIndex--;
                }
            }
            
            placeholder.dataset.index = newIndex.toString();
        }

        console.log(`Removed ${images.length} images from gallery and added placeholders`);
    } catch (error) {
        console.error('Error removing multiple images from gallery:', error);
    }
}

function setSeedInputGroupState(open) {
    const manualSeed = document.getElementById('manualSeed');
    const sproutSeedBtn = document.getElementById('sproutSeedBtn');
    const clearSeedBtn = document.getElementById('clearSeedBtn');
    const editSeedBtn = document.getElementById('editSeedBtn');
    if (open) {
        manualSeed?.classList.remove('hidden');
        sproutSeedBtn?.classList.remove('hidden');
        clearSeedBtn?.classList.remove('hidden');
        editSeedBtn?.classList.add('hidden');
    } else {
        manualSeed?.classList.add('hidden');
        sproutSeedBtn?.classList.add('hidden');
        clearSeedBtn?.classList.add('hidden');
        editSeedBtn?.classList.remove('hidden');
    }
}

// Load options from server
async function loadOptions() {
    try {
        const response = await fetchWithAuth('/app', { method: 'OPTIONS' });
        if (!response.ok) throw new Error('Failed to load options');

        const options = await response.json();
        if (!options.ok) throw new Error("Failed to load application configuration: " + options.error);

        window.optionsData = options;

        if (window.optionsData?.user?.ok !== true) {
            showErrorSubHeader(window.optionsData.user.error, 'error', 0);
        }

        updateBalanceDisplay(window.optionsData?.balance);
    } catch (error) {
        console.error('Error loading options:', error);
        throw error;
    }
}

// Load balance from server
async function loadBalance() {
    try {
        const response = await fetchWithAuth('/balance');
        if (!response.ok) throw new Error('Failed to load balance');

        const balance = await response.json();
        updateBalanceDisplay(balance);
    } catch (error) {
        console.error('Error loading balance:', error);
        // Don't throw error for balance loading failure
        updateBalanceDisplay({ totalCredits: 0, fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 });
    }
}

document.addEventListener('DOMContentLoaded', async function() {

    try {
        // Calculate initial images per page based on current window size
        galleryRows = calculateGalleryRows();
        imagesPerPage = galleryColumnsInput.value * galleryRows;

        await loadOptions(); // TODO: Check functionality
        await loadWorkspaces(); // Load workspace data
        loadActiveWorkspaceColor(); // Load workspace color for bokeh
        await loadBalance();
        await loadVibeReferences(); // Load vibe references for immediate use
        
        // Initialize gallery toggle group
        const galleryToggleGroup = document.getElementById('galleryToggleGroup');
        if (galleryToggleGroup) {
            galleryToggleGroup.setAttribute('data-active', currentGalleryView);
        }

        generateSamplerOptions();
        renderManualSamplerDropdown(manualSelectedSampler);
        selectManualSampler('k_euler_ancestral');

        generateResolutionOptions();
        renderManualResolutionDropdown(manualSelectedResolution);
        selectManualResolution('normal_square', 'Normal');

        generateNoiseSchedulerOptions();
        renderManualNoiseSchedulerDropdown(manualSelectedNoiseScheduler);
        selectManualNoiseScheduler('karras');

        generateModelOptions();
        renderManualModelDropdown(manualSelectedModel);
        selectManualModel('v4_5', '');

        await renderCustomPresetDropdown(selectedPreset);

        // Initialize new dropdowns
        renderDatasetDropdown();
        updateDatasetDisplay();
        renderDatasetBiasControls();
        renderUcPresetsDropdown();
        selectUcPreset(0);

        await loadGallery();
        await updateGalleryColumnsFromLayout();
        updateGenerateButton();

        // Initialize image bias adjustment functionality
        initializeImageBiasAdjustment();

        // Initialize background gradient
        setupEventListeners();
    
        // Initialize cache manager
        initializeCacheManager();
        
        // Initialize keyboard shortcuts for manual modal
        initializeManualModalShortcuts();
    
        // Initialize emphasis highlighting for manual fields
        initializeEmphasisOverlay(manualPrompt);
        initializeEmphasisOverlay(manualUc);
    
    
        const manualSeed = document.getElementById('manualSeed');
        const clearSeedBtn = document.getElementById('clearSeedBtn');
        const editSeedBtn = document.getElementById('editSeedBtn');
        // Start closed
        setSeedInputGroupState(false);
    
        editSeedBtn.addEventListener('click', function() {
            setSeedInputGroupState(true);
            manualSeed?.focus();
        });
        clearSeedBtn.addEventListener('click', function() {
            if (manualSeed && manualSeed.value) {
                manualSeed.value = '';
                manualSeed.focus();
            } else {
                setSeedInputGroupState(false);
            }
        });
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load application data');
    }
});

// Dataset Dropdown Functions
function renderDatasetDropdown() {
    datasetDropdownMenu.innerHTML = '';

    // Use loaded options data or fallback to default
    const datasets = optionsData?.datasets || [
        { value: 'anime', display: 'Anime', sub_toggles: [] },
        { value: 'furry', display: 'Furry', sub_toggles: [] },
        { value: 'backgrounds', display: 'Backgrounds', sub_toggles: [] }
    ];

    datasets.forEach(dataset => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = dataset.value;

        const isSelected = selectedDatasets.includes(dataset.value);
        if (isSelected) {
            option.classList.add('selected');
        }

        option.innerHTML = `
            <span>${dataset.display}</span>
            ${isSelected ? '<i class="fas fa-check" style="margin-left: auto;"></i>' : ''}
        `;

        option.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDataset(dataset.value);
        });

        datasetDropdownMenu.appendChild(option);
    });
}

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
    renderDatasetBiasControls();
}

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
}

function openDatasetDropdown() {
    openDropdown(datasetDropdownMenu, datasetDropdownBtn);
}

function closeDatasetDropdown() {
    closeDropdown(datasetDropdownMenu, datasetDropdownBtn);
}

// Dataset Bias Functions
function renderDatasetBiasControls() {
    const container = document.getElementById('datasetBiasControls');
    if (!container) return;

    container.innerHTML = '';

    // Render datasets in specific order: anime, furry, backgrounds
    const orderedDatasets = ['anime', 'furry', 'backgrounds'];
    const datasetsToRender = orderedDatasets.filter(dataset => selectedDatasets.includes(dataset));

    datasetsToRender.forEach(dataset => {
        const biasGroup = document.createElement('div');
        biasGroup.className = 'form-group dataset-bias-group';

        const label = document.createElement('label');
        label.textContent = dataset.charAt(0).toUpperCase() + dataset.slice(1);

        const inputGroup = document.createElement('div');
        inputGroup.className = 'form-row';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'form-control hover-show colored';
        input.min = '-3';
        input.max = '5';
        input.step = '0.1';
        input.value = datasetBias[dataset];
        input.addEventListener('input', (e) => {
            datasetBias[dataset] = parseFloat(e.target.value);
        });

        // Add wheel scroll functionality
        input.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const currentValue = parseFloat(this.value) || 1.0;
            const newValue = Math.max(-3, Math.min(5, currentValue + delta));
            this.value = newValue.toFixed(1);
            datasetBias[dataset] = newValue;
        });

        inputGroup.appendChild(input);

        // Add sub-toggles for datasets that have them
        if (window.optionsData?.datasets[dataset]?.sub_toggles) {
            window.optionsData?.datasets[dataset]?.sub_toggles.forEach(subToggle => {
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'btn-secondary toggle-btn';
                toggleBtn.setAttribute('data-state', 'off');
                toggleBtn.textContent = subToggle.name;
                toggleBtn.title = subToggle.description || `Toggle ${subToggle.name}`;

                // Initialize state from window.datasetSettings if available
                if (window.datasetSettings && window.datasetSettings[dataset] && window.datasetSettings[dataset][subToggle.id]) {
                    const setting = window.datasetSettings[dataset][subToggle.id];
                    toggleBtn.setAttribute('data-state', setting.enabled ? 'on' : 'off');
                }

                toggleBtn.addEventListener('click', () => {
                    const currentState = toggleBtn.getAttribute('data-state') === 'on';
                    const newState = !currentState;
                    toggleBtn.setAttribute('data-state', newState ? 'on' : 'off');

                    // Initialize window.datasetSettings if needed
                    if (!window.datasetSettings) window.datasetSettings = {};
                    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
                    if (!window.datasetSettings[dataset][subToggle.id]) {
                        window.datasetSettings[dataset][subToggle.id] = {
                            enabled: subToggle.default_enabled || false,
                            bias: subToggle.default_bias !== undefined ? subToggle.default_bias : 1.0,
                            value: subToggle.value
                        };
                    }

                    window.datasetSettings[dataset][subToggle.id].enabled = newState;
                    updateSubToggleBiasInput(subToggle.id, dataset);
                });

                inputGroup.appendChild(toggleBtn);

                // Add bias input for sub-toggle
                const biasInput = document.createElement('input');
                biasInput.type = 'number';
                biasInput.className = 'form-control hover-show';
                biasInput.id = `${dataset}_${subToggle.id}_bias`;
                biasInput.min = '-3';
                biasInput.max = '5';
                biasInput.step = '0.1';
                biasInput.value = (window.datasetSettings && window.datasetSettings[dataset] && window.datasetSettings[dataset][subToggle.id]) ?
                    window.datasetSettings[dataset][subToggle.id].bias : (subToggle.default_bias !== undefined ? subToggle.default_bias : 1.0);
                biasInput.style.display = 'none';
                biasInput.addEventListener('input', (e) => {
                    if (!window.datasetSettings) window.datasetSettings = {};
                    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
                    if (!window.datasetSettings[dataset][subToggle.id]) {
                        window.datasetSettings[dataset][subToggle.id] = {
                            enabled: false,
                            bias: 1.0,
                            value: subToggle.value
                        };
                    }
                    window.datasetSettings[dataset][subToggle.id].bias = parseFloat(e.target.value);
                });

                // Add wheel scroll functionality to bias input
                biasInput.addEventListener('wheel', function(e) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    const currentValue = parseFloat(this.value) || 1.0;
                    const newValue = Math.max(-3, Math.min(5, currentValue + delta));
                    this.value = newValue.toFixed(1);
                    if (!window.datasetSettings) window.datasetSettings = {};
                    if (!window.datasetSettings[dataset]) window.datasetSettings[dataset] = {};
                    if (!window.datasetSettings[dataset][subToggle.id]) {
                        window.datasetSettings[dataset][subToggle.id] = {
                            enabled: false,
                            bias: 1.0,
                            value: subToggle.value
                        };
                    }
                    window.datasetSettings[dataset][subToggle.id].bias = newValue;
                });

                inputGroup.appendChild(biasInput);
            });
        }

        biasGroup.appendChild(label);
        biasGroup.appendChild(inputGroup);
        container.appendChild(biasGroup);
    });
    // Toggle the settings button based on whether there are any items in the container
    const settingsBtn = document.querySelector('#manualModal .prompt-tabs .tab-buttons button[data-tab="settings"]');
    const promptBtn = document.querySelector('#manualModal .prompt-tabs .tab-buttons button[data-tab="prompt"]');
    if (settingsBtn) {
        // If container has no children, disable settings button and switch to prompt tab if active
        if (!container.hasChildNodes() || container.children.length === 0) {
            settingsBtn.style.display = 'none';
            if (document.getElementById('settings-tab').classList.contains('active')) {
                document.getElementById('prompt-tab').classList.add('active');
                document.getElementById('settings-tab').classList.remove('active');
            }
            if (settingsBtn.classList.contains('active') && promptBtn) {
                settingsBtn.classList.remove('active');
                promptBtn.classList.add('active');
                // Optionally trigger tab switch logic if needed
                const promptTab = document.getElementById('manualPromptTab');
                const settingsTab = document.getElementById('manualSettingsTab');
                if (promptTab && settingsTab) {
                    promptTab.style.display = '';
                    settingsTab.style.display = 'none';
                }
            }
        } else {
            settingsBtn.style.display = '';
        }
    }
}

function updateSubToggleBiasInput(subToggleId, dataset) {
    const biasInput = document.getElementById(`${dataset}_${subToggleId}_bias`);
    if (biasInput) {
        const isEnabled = window.datasetSettings && window.datasetSettings[dataset] &&
                         window.datasetSettings[dataset][subToggleId] &&
                         window.datasetSettings[dataset][subToggleId].enabled;
        biasInput.style.display = isEnabled ? 'block' : 'none';
    }
}

// Quality Toggle Functions
function toggleQuality() {
    const currentState = qualityToggleBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    qualityToggleBtn.setAttribute('data-state', newState);
    appendQuality = newState === 'on';
}

// UC Presets Dropdown Functions
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

        option.addEventListener('click', () => {
            selectUcPreset(preset.value);
            closeUcPresetsDropdown();
        });

        ucPresetsDropdownMenu.appendChild(option);
    });
}

function selectUcPreset(value) {
    selectedUcPreset = value;

    // Update UC boxes visual state
    const ucBoxes = document.querySelector('.uc-boxes');
    if (ucBoxes) {
        ucBoxes.setAttribute('data-uc-level', value.toString());
    }

    // Update toggle state - on when UC preset > 0
    const ucPresetsBtn = document.getElementById('ucPresetsDropdownBtn');
    if (ucPresetsBtn) {
        ucPresetsBtn.setAttribute('data-state', value > 0 ? 'on' : 'off');
    }
}

function openUcPresetsDropdown() {
    openDropdown(ucPresetsDropdownMenu, ucPresetsDropdownBtn);
}

function closeUcPresetsDropdown() {
    closeDropdown(ucPresetsDropdownMenu, ucPresetsDropdownBtn);
}

// Setup event listeners
function setupEventListeners() {
    // Logout button
    logoutButton.addEventListener('click', handleLogout);

    // Manual modal events
    manualBtn.addEventListener('click', showManualModal);
    closeManualBtn.addEventListener('click', hideManualModal);
    manualPreviewCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.innerWidth > 1400) {
            hideManualModal(e, false);
        } else {
            previewSection.classList.remove('active');
            setTimeout(() => { previewSection.classList.remove('show'); }, 500);
        }
    });

    // Update save button state when preset name changes
    manualPresetName.addEventListener('input', () => {
        updateSaveButtonState();
        validatePresetWithTimeout();
        manualPresetToggleText.textContent = manualPresetName.value.trim();
    });
    manualPresetName.addEventListener('keyup', () => {
        updateSaveButtonState();
        validatePresetWithTimeout();
        manualPresetToggleText.textContent = manualPresetName.value.trim();
    });
    manualPresetName.addEventListener('change', () => {
        updateSaveButtonState();
        validatePresetWithTimeout();
        manualPresetToggleText.textContent = manualPresetName.value.trim();
    });

    // Add load button click handler
    manualLoadBtn.addEventListener('click', () => {
        const presetName = manualPresetName.value.trim();
        if (presetName) {
            loadPresetIntoForm(presetName);
        }
    });
    manualForm.addEventListener('submit', handleManualGeneration);
    manualSaveBtn.addEventListener('click', handleManualSave);

    // Manual preview control events
    manualPreviewDownloadBtn.addEventListener('click', () => {
        const previewImage = document.getElementById('manualPreviewImage');
        if (previewImage && previewImage.dataset.blobUrl) {
            const blobUrl = previewImage.dataset.blobUrl;
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `generated-image-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    });

    manualPreviewUpscaleBtn.addEventListener('click', (e) => {
        if (currentManualPreviewImage) {
            upscaleImage(currentManualPreviewImage, e);
        } else {
            showGlassToast('error', 'Upscale Failed', 'No image available');
        }
    });

    manualPreviewLoadBtn.addEventListener('click', () => {
        if (currentManualPreviewImage) {
            if (window.innerWidth <= 1400 && previewSection.classList.contains('show')) {
                previewSection.classList.remove('active');
                setTimeout(() => { previewSection.classList.remove('show'); }, 500);
            }
            rerollImageWithEdit(currentManualPreviewImage);
        } else {
            showGlassToast('error', 'Load Failed', 'No image available');
        }
    });

    manualPreviewVariationBtn.addEventListener('click', () => {
        if (currentManualPreviewImage) {
            // For preview, only set the base image without replacing dialog contents
            const filename = currentManualPreviewImage.original;
            if (filename) {
                const source = `file:${filename}`;
                const previewUrl = `/images/${filename}`;

                window.uploadedImageData = {
                    image_source: source,
                    bias: 2, // Default center bias
                    isBiasMode: true,
                    isClientSide: false
                };

                // Set the variation image
                variationImage.src = previewUrl;
                variationImage.style.display = 'block';
        

                // Set strength to 0.8 and noise to 0.1 for variation
                if (manualStrengthValue) manualStrengthValue.value = '0.8';
                if (manualNoiseValue) manualNoiseValue.value = '0.1';

                // Set transformation type to variation
                updateTransformationDropdownState('variation', 'Variation');

                // Show transformation section content
                if (transformationRow) {
                    transformationRow.classList.add('display-image');
                }
                document.getElementById('manualStrengthGroup').style.display = '';
                document.getElementById('manualNoiseGroup').style.display = '';

                // Update inpaint button state
                updateInpaintButtonState();
                renderImageBiasDropdown((typeof metadata.image_bias === 'number' ? metadata.image_bias : 2).toString());

            } else {
                showGlassToast('error', 'Variation Failed', 'No image found');
            }
        } else {
            showGlassToast('error', 'Variation Failed', 'No image available');
        }
    });

    manualPreviewSeedBtn.addEventListener('click', () => {
        if (window.lastGeneratedSeed) {
            manualSeed.value = window.lastGeneratedSeed; 
            setSeedInputGroupState(true);
            if (window.innerWidth <= 1400 && previewSection.classList.contains('show')) {
                previewSection.classList.remove('active');
                setTimeout(() => { previewSection.classList.remove('show'); }, 500);
            }
        } else {
            showGlassToast('error', null, 'No seed available');
        }
    });

    manualPreviewDeleteBtn.addEventListener('click', deleteManualPreviewImage);

    manualPreviewPinBtn.addEventListener('click', () => {
        if (currentManualPreviewImage) {
            togglePinImage(currentManualPreviewImage, manualPreviewPinBtn);
        } else {
            showGlassToast('error', 'Pin Failed', 'No image available');
        }
    });

    manualPreviewScrapBtn.addEventListener('click', () => {
        if (currentManualPreviewImage) {
            if (currentGalleryView === 'scraps') {
                removeFromScraps(currentManualPreviewImage);
            } else {
                moveManualPreviewToScraps();
            }
        } else {
            showGlassToast('error', 'Load Failed', 'No image available');
        }
    });

    // Clear seed button
    clearSeedBtn.addEventListener('click', clearSeed);

    // Paid request toggle
    paidRequestToggle.addEventListener('click', () => {
        forcePaidRequest = !forcePaidRequest;
        paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
    });

    // Dataset dropdown
    setupDropdown(datasetDropdown, datasetDropdownBtn, datasetDropdownMenu, renderDatasetDropdown, () => selectedDatasets);

    // Quality toggle
    qualityToggleBtn.addEventListener('click', toggleQuality);


    // Vibe normalize toggle
    vibeNormalizeToggle.addEventListener('click', () => {
        const currentState = vibeNormalizeToggle.getAttribute('data-state') === 'on';
        const newState = !currentState;
        vibeNormalizeToggle.setAttribute('data-state', newState ? 'on' : 'off');
    });

    // UC Presets dropdown
    setupDropdown(ucPresetsDropdown, ucPresetsDropdownBtn, ucPresetsDropdownMenu, renderUcPresetsDropdown, () => selectedUcPreset);

    // Character autocomplete events (for both prompt and UC fields)
    manualPrompt.addEventListener('input', handleCharacterAutocompleteInput);
    manualPrompt.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    manualPrompt.addEventListener('focus', () => startEmphasisHighlighting(manualPrompt));
    manualPrompt.addEventListener('blur', () => {
        applyFormattedText(manualPrompt, true);
        updateEmphasisHighlighting(manualPrompt);
        stopEmphasisHighlighting();
    });
    manualUc.addEventListener('input', handleCharacterAutocompleteInput);
    manualUc.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    manualUc.addEventListener('focus', () => startEmphasisHighlighting(manualUc));
    manualUc.addEventListener('blur', () => {
        applyFormattedText(manualUc, true);
        updateEmphasisHighlighting(manualUc);
        stopEmphasisHighlighting();
    });
    // Add auto-resize functionality for manual UC field
    manualUc.addEventListener('input', () => autoResizeTextarea(manualUc));

    // Preset autocomplete events
    manualPresetName.addEventListener('input', handlePresetAutocompleteInput);
    manualPresetName.addEventListener('keydown', handlePresetAutocompleteKeydown);
    document.addEventListener('click', hideCharacterAutocomplete);
    document.addEventListener('click', hidePresetAutocomplete);

    // Update autocomplete positions on scroll and resize
    window.addEventListener('scroll', updateAutocompletePositions);
    window.addEventListener('resize', updateAutocompletePositions);

    // Metadata dialog events
    if (metadataBtn) {
        metadataBtn.addEventListener('click', showMetadataDialog);
    }
    if (closeMetadataDialog) {
        closeMetadataDialog.addEventListener('click', hideMetadataDialog);
    }
    if (dialogPromptBtn) {
        dialogPromptBtn.addEventListener('click', () => toggleDialogExpanded('prompt'));
    }
    if (dialogUcBtn) {
        dialogUcBtn.addEventListener('click', () => toggleDialogExpanded('uc'));
    }

    // Close dialog expanded sections
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-expanded')) {
            const expandedSection = e.target.closest('.metadata-expanded');
            if (expandedSection) {
                expandedSection.style.display = 'none';
            }
        }
    });

    // Close metadata dialog on outside click
    // window.addEventListener('click', function(e) {
    //     if (e.target === metadataDialog) hideMetadataDialog();
    // });

    // ESC key to close lightbox and modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                // Check if we're showing character detail or autocomplete
                const autocompleteList = document.querySelector('.character-autocomplete-list');
                if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                    // We're showing character detail, go back to autocomplete
                    hideCharacterDetail();
                    return; // Don't close the overlay, just go back to character list
                } else {
                    // We're showing autocomplete, hide it
                    hideCharacterAutocomplete();
                }
            } else if (lightboxModal.style.display === 'flex') {
                hideLightbox();
            } else if (metadataDialog.style.display === 'flex') {
                hideMetadataDialog();
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Handle arrow key navigation for character detail
            if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                const autocompleteList = document.querySelector('.character-autocomplete-list');
                if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                    e.preventDefault();
                    handleCharacterDetailArrowKeys(e.key);
                }
            }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            // Handle arrow key navigation for lightbox
            if (lightboxModal.style.display === 'flex') {
                e.preventDefault();
                navigateLightbox(e.key === 'ArrowLeft' ? -1 : 1);
            }
        } else if (e.key === 'Enter') {
            // Handle Enter key for character detail selection
            if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                const autocompleteList = document.querySelector('.character-autocomplete-list');
                if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                    e.preventDefault();
                    handleCharacterDetailEnter();
                }
            }
        } else if (e.key === 'e' && e.altKey) {
            // Alt+E: Show emphasis adjustment popup
            console.log('Alt+E detected!', e.key, e.altKey, e.ctrlKey, e.shiftKey);
            e.preventDefault();
            const activeElement = document.activeElement;
            console.log('Active element:', activeElement);
            if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
                console.log('Starting emphasis editing...');
                startEmphasisEditing(activeElement);
            }
        } else if (e.key === 'w' && e.altKey) {
            // Alt+W: Show text search popup
            e.preventDefault();
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
                startTextSearch(activeElement);
            }
        }
    });


    // Generation controls
    presetSelect.addEventListener('change', updateGenerateButton);
    generateBtn.addEventListener('click', (e) => generateImage(e));

    // Upload functionality
    const uploadBtn = document.getElementById('uploadBtn');
    const imageUploadInput = document.getElementById('imageUploadInput');

    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            imageUploadInput.click();
        });
    }

    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', handleImageUpload);
    }

    // Clipboard paste functionality
    document.addEventListener('paste', handleClipboardPaste);

    // Toggle button functionality
    manualUpscale.addEventListener('click', toggleManualUpscale);

    // Custom resolution event listeners
    if (manualCustomResolutionBtn) {
        manualCustomResolutionBtn.addEventListener('click', () => {
            if (manualSelectedResolution === 'custom') {
                // Switch back to dropdown mode
                selectManualResolution('normal_portrait', 'Normal');
            }
        });
    }

    // Update hidden resolution value when custom dimensions change
    if (manualWidth) {
        manualWidth.addEventListener('input', updateCustomResolutionValue);
        manualWidth.addEventListener('blur', sanitizeCustomDimensions);
        manualWidth.addEventListener('input', updateManualPriceDisplay);
    }
    if (manualHeight) {
        manualHeight.addEventListener('input', updateCustomResolutionValue);
        manualHeight.addEventListener('blur', sanitizeCustomDimensions);
        manualHeight.addEventListener('input', updateManualPriceDisplay);
    }

    if (deleteImageBaseBtn) {
        deleteImageBaseBtn.addEventListener('click', handleDeleteBaseImage);
    }

    const closeCacheBrowserBtn = document.getElementById('closeCacheBrowserBtn');
    const closeCacheBrowserContainerBtn = document.getElementById('closeCacheBrowserContainerBtn');

    if (closeCacheBrowserBtn) {
        closeCacheBrowserBtn.addEventListener('click', hideCacheBrowser);
    }

    if (closeCacheBrowserContainerBtn) {
        closeCacheBrowserContainerBtn.addEventListener('click', hideCacheBrowser);
    }

    // Cache browser tab event listeners
    const cacheBrowserTabButtons = document.querySelectorAll('.cache-browser-tabs .gallery-toggle-btn');
    cacheBrowserTabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            const toggleGroup = this.closest('.gallery-toggle-group');
            const tabTitle = this.getAttribute('data-title');
            
            // Update the data-active attribute
            toggleGroup.setAttribute('data-active', targetTab);
            
            // Remove active class from all buttons
            toggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Add active class to clicked button
            this.classList.add('active');
            
            switchCacheBrowserTab(targetTab, tabTitle);
        });
    });

    // Ensure correct initial state for upload/delete buttons
    updateUploadDeleteButtonVisibility();

    // Price calculation event listeners
    if (manualSteps) {
        manualSteps.addEventListener('input', updateManualPriceDisplay);
    }

    if (manualStrengthValue) {
        manualStrengthValue.addEventListener('input', updateManualPriceDisplay);
    }

    if (manualNoiseValue) {
        manualNoiseValue.addEventListener('input', updateManualPriceDisplay);
    }

    // Add event listener for image bias changes
    if (imageBiasHidden) {
        imageBiasHidden.addEventListener('change', handleImageBiasChange);
    }

    // Close modals on outside click (only for login modal)
    // window.addEventListener('click', function(e) {
    //     if (e.target === loginModal) hideLoginModal();
    // });

    // Resize handler for dynamic gallery sizing
    window.addEventListener('resize', handleResize);

    // Manual preview navigation buttons
    const manualPreviewPrevBtn = document.getElementById('manualPreviewPrevBtn');
    const manualPreviewNextBtn = document.getElementById('manualPreviewNextBtn');

    if (manualPreviewPrevBtn) {
        manualPreviewPrevBtn.addEventListener('click', navigateManualPreview);
    }
    if (manualPreviewNextBtn) {
        manualPreviewNextBtn.addEventListener('click', navigateManualPreview);
    }

    // Bulk action event listeners
    const bulkMoveToWorkspaceBtn = document.getElementById('bulkMoveToWorkspaceBtn');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const bulkSequenziaBtn = document.getElementById('bulkSequenziaBtn');
    const bulkMoveToScrapsBtn = document.getElementById('bulkMoveToScrapsBtn');
    const bulkPinBtn = document.getElementById('bulkPinBtn');
    const bulkUnpinBtn = document.getElementById('bulkUnpinBtn');
    const bulkChangePresetBtn = document.getElementById('bulkChangePresetBtn');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');

    if (bulkMoveToWorkspaceBtn) {
        bulkMoveToWorkspaceBtn.addEventListener('click', handleBulkMoveToWorkspace);
    }

    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', (e) => handleBulkDelete(e));
    }

    if (bulkSequenziaBtn) {
        bulkSequenziaBtn.addEventListener('click', (e) => handleBulkSequenzia(e));
    }

    if (bulkMoveToScrapsBtn) {
        bulkMoveToScrapsBtn.addEventListener('click', (e) => handleBulkMoveToScraps(e));
    }

    if (bulkPinBtn) {
        bulkPinBtn.addEventListener('click', (e) => handleBulkPin(e));
    }

    if (bulkUnpinBtn) {
        bulkUnpinBtn.addEventListener('click', (e) => handleBulkUnpin(e));
    }

    if (bulkChangePresetBtn) {
        bulkChangePresetBtn.addEventListener('click', handleBulkChangePreset);
    }

    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', clearSelection);
    }

    // Character prompts event listeners
    if (addCharacterBtn) {
        addCharacterBtn.addEventListener('click', addCharacterPrompt);
    }

    // Auto position toggle event listener
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    if (autoPositionBtn) {
        autoPositionBtn.addEventListener('click', function() {
            const currentState = this.getAttribute('data-state');
            const newState = currentState === 'on' ? 'off' : 'on';
            this.setAttribute('data-state', newState);
            updateAutoPositionToggle();
        });
    }

    // Position dialog event listeners
    const cancelPositionBtn = document.getElementById('cancelPositionBtn');
    const confirmPositionBtn = document.getElementById('confirmPositionBtn');

    if (cancelPositionBtn) {
        cancelPositionBtn.addEventListener('click', hidePositionDialog);
    }

    if (confirmPositionBtn) {
        confirmPositionBtn.addEventListener('click', confirmPosition);
    }

    // Mouse wheel functionality for numeric inputs
    if (manualSteps) {
        manualSteps.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentValue = parseInt(this.value) || 25;
            const newValue = Math.max(1, Math.min(28, currentValue + delta));
            this.value = newValue;
        });
    }

    if (manualGuidance) {
        manualGuidance.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0.0, Math.min(10.0, currentValue + delta));
            this.value = newValue.toFixed(1);
        });
    }

    if (manualRescale) {
        manualRescale.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.0;
            const newValue = Math.max(0.0, Math.min(1.0, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }

    // Tab switching functionality for prompt/UC tabs (Manual Generation Model)
    const manualTabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');

    manualTabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            switchManualTab(targetTab);
        });
    });

    // Show both panes functionality
    if (showBothBtn) {
        showBothBtn.addEventListener('click', function() {
            toggleManualShowBoth();
        });
    }



    document.getElementById('randomPromptToggleBtn').addEventListener('click', toggleRandomPrompt);
    document.getElementById('randomPromptRefreshBtn').addEventListener('click', executeRandomPrompt);
    document.getElementById('randomPromptTransferBtn').addEventListener('click', transferRandomPrompt);
    document.getElementById('randomPromptNsfwBtn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const state = btn.dataset.state === 'on' ? 'off' : 'on';
        btn.dataset.state = state;
        btn.classList.toggle('active', state === 'on');
        executeRandomPrompt();
    });

    document.getElementById('manualPreviewHandle').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!previewSection.classList.contains('show')) {
            previewSection.classList.add('show');
            setTimeout(() => { previewSection.classList.add('active'); }, 1);
        }
    });

    // Update the click event for manualPresetToggleBtn to toggle the group and button state
    manualPresetToggleBtn.addEventListener('click', function() {
        const presetName = manualPresetName.value.trim();
        const valid = isValidPresetName(presetName);
        if (presetName === "" && !valid) {
            // Only toggle group visibility and button state if name is empty
            if (manualPresetGroup.style.display === 'none') {
                manualPresetGroup.style.display = '';
                manualPresetToggleBtn.classList.add('toggle-btn');
                manualPresetToggleBtn.classList.remove('hover-show');
                manualPresetToggleBtn.setAttribute('data-state', 'on');
                manualPresetToggleIcon.style.display = '';
                manualPresetToggleText.style.display = 'none';
            } else {
                manualPresetGroup.style.display = 'none';
                manualPresetToggleBtn.classList.add('toggle-btn');
                manualPresetToggleBtn.classList.remove('hover-show');
                manualPresetToggleBtn.setAttribute('data-state', 'off');
                manualPresetToggleIcon.style.display = '';
                manualPresetToggleText.style.display = 'none';
                manualPresetToggleText.textContent = presetName;
            }
        } else {
            if (manualPresetGroup.style.display === 'none') {
                manualPresetGroup.style.display = '';
                manualPresetToggleBtn.classList.add('toggle-btn');
                manualPresetToggleBtn.classList.remove('hover-show');
                manualPresetToggleIcon.style.display = '';
                manualPresetToggleText.style.display = 'none';
            } else {
                manualPresetGroup.style.display = 'none';
                manualPresetToggleBtn.classList.remove('toggle-btn');
                manualPresetToggleBtn.classList.add('hover-show');
                manualPresetToggleIcon.style.display = 'none';
                manualPresetToggleText.style.display = '';
                manualPresetToggleText.textContent = presetName;
            }
        }
        // If there is a valid preset name, do nothing (button is not a toggle)
    });

    galleryColumnsInput?.addEventListener('input', e => setGalleryColumns(e.target.value));
    galleryColumnsInput?.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const currentValue = parseInt(this.value) || 3;
        const newValue = Math.max(3, Math.min(10, currentValue + delta));
        this.value = newValue;
        setGalleryColumns(newValue);
    });

    // Gallery toggle group
    const galleryToggleGroup = document.getElementById('galleryToggleGroup');
    if (galleryToggleGroup) {
        galleryToggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.getAttribute('data-view');
                switchGalleryView(view);
            });
        });
    }

    // === Select All functionality ===
    if (bulkSelectAllBtn) {
        bulkSelectAllBtn.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.gallery-item-checkbox');
            checkboxes.forEach(cb => {
                if (!cb.checked) cb.click();
            });
        });
    }

    // Improved infinite scroll with percentage-based triggers
    let lastScrollTime = 0;
    let scrollTimeout;
    
    function throttledInfiniteScroll() {
        const now = Date.now();
        if (now - lastScrollTime > infiniteScrollConfig.throttleDelay) {
            handleInfiniteScroll();
            lastScrollTime = now;
        }
    }
    
    window.addEventListener('scroll', () => {
        throttledInfiniteScroll();
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            handleInfiniteScroll();
        }, infiniteScrollConfig.debounceDelay);
    });
    
    // Handle window resize to update infinite scroll configuration
    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            // Update batch size and trigger distances for new viewport
            imagesPerPage = calculateDynamicBatchSize();
            
            // Recalculate gallery layout if needed
            if (gallery && gallery.children.length > 0) {
                updateGalleryColumnsFromLayout();
            }
        }, 250); // Debounce resize events
    });
}

// Tab switching functionality for prompt/UC tabs (Manual Generation Model)
function switchManualTab(targetTab) {
    // Target ONLY the tab buttons within the manual modal's prompt-tabs section
    const tabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
    // Target ONLY the tab panes within the manual modal's prompt-tabs section
    const tabPanes = document.querySelectorAll('#manualModal .prompt-tabs .tab-content .tab-pane');
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const toggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');

    // Remove show-both state
    promptTabs.classList.remove('show-both');
    showBothBtn.classList.remove('active');

    // Remove active class from all buttons and panes
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabPanes.forEach(pane => pane.classList.remove('active'));

    // Add active class to clicked button and corresponding pane
    const targetButton = document.querySelector(`#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn[data-tab="${targetTab}"]`);
    const targetPane = document.getElementById(`${targetTab}-tab`);

    if (targetButton) targetButton.classList.add('active');
    if (targetPane) targetPane.classList.add('active');
    
    // Update the data-active attribute for the slider
    if (toggleGroup) {
        toggleGroup.setAttribute('data-active', targetTab);
    }

    // Update emphasis highlighting for the active main textarea
    const activeTextarea = document.getElementById(targetTab);
    if (activeTextarea) {
        updateEmphasisHighlighting(activeTextarea);
    }

    // Sync the selection to all character prompts
    syncCharacterPromptTabs(targetTab);
}

// New function to sync main window tab selection to all character prompts
function syncCharacterPromptTabs(mainTab) {
    const characterItems = document.querySelectorAll('.character-prompt-item');
    
    characterItems.forEach(characterItem => {
        const characterTabButtons = characterItem.querySelectorAll('.gallery-toggle-btn');
        const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
        const toggleGroup = characterItem.querySelector('.gallery-toggle-group');
        const characterPromptTabs = characterItem.querySelector('.character-prompt-tabs');

        // Remove active class from all character tab buttons and panes
        characterTabButtons.forEach(btn => btn.classList.remove('active'));
        characterTabPanes.forEach(pane => pane.classList.remove('active'));

        // Add active class to the corresponding character tab button and pane
        const targetButton = characterItem.querySelector(`.gallery-toggle-btn[data-tab="${mainTab}"]`);
        const characterId = characterItem.id;
        const targetPane = document.getElementById(`${characterId}_${mainTab}-tab`);

        if (targetButton) targetButton.classList.add('active');
        if (targetPane) targetPane.classList.add('active');
        
        // Remove show-both class when switching to single tab mode
        if (characterPromptTabs) {
            characterPromptTabs.classList.remove('show-both');
        }
        
        // Update the data-active attribute for the character's slider
        if (toggleGroup) {
            toggleGroup.setAttribute('data-active', mainTab);
        }

        // Update emphasis highlighting for the active textarea
        const activeTextarea = characterItem.querySelector(`#${characterId}_${mainTab}`);
        if (activeTextarea) {
            updateEmphasisHighlighting(activeTextarea);
        }
    });
}

// New function to sync character prompts to show both tabs
function syncCharacterPromptTabsShowBoth() {
    const characterItems = document.querySelectorAll('.character-prompt-item');
    
    characterItems.forEach(characterItem => {
        const characterTabButtons = characterItem.querySelectorAll('.gallery-toggle-btn');
        const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
        const toggleGroup = characterItem.querySelector('.gallery-toggle-group');
        const characterPromptTabs = characterItem.querySelector('.character-prompt-tabs');
        const characterId = characterItem.id;

        // Show both character tab buttons and panes
        characterTabButtons.forEach(btn => btn.classList.add('active'));
        characterTabPanes.forEach(pane => pane.classList.add('active'));
        
        // Add show-both class to character-prompt-tabs for visual separation
        if (characterPromptTabs) {
            characterPromptTabs.classList.add('show-both');
        }
        
        // Update the data-active attribute for the character's slider (keep current state)
        if (toggleGroup) {
            const currentActive = toggleGroup.getAttribute('data-active') || 'prompt';
            toggleGroup.setAttribute('data-active', currentActive);
        }

        // Update emphasis highlighting for both prompt and UC textareas
        const promptTextarea = characterItem.querySelector(`#${characterId}_prompt`);
        const ucTextarea = characterItem.querySelector(`#${characterId}_uc`);
        
        if (promptTextarea) {
            updateEmphasisHighlighting(promptTextarea);
        }
        if (ucTextarea) {
            updateEmphasisHighlighting(ucTextarea);
        }
    });
}

// Show both panes functionality for manual generation model
function toggleManualShowBoth() {
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    
    const isShowingBoth = promptTabs.classList.contains('show-both');

    if (isShowingBoth) {
        // Return to single tab mode
        promptTabs.classList.remove('show-both');
        showBothBtn.classList.remove('active');

        // Set Base Prompt as default when returning from show both mode
        syncCharacterPromptTabs('prompt');
    } else {
        // Show both panes
        promptTabs.classList.add('show-both');
        showBothBtn.classList.add('active');

        // Sync character prompts to show both tabs
        syncCharacterPromptTabsShowBoth();
    }
}

// New function to sync character prompts to show both tabs
function syncCharacterPromptTabsShowBoth() {
    const characterItems = document.querySelectorAll('.character-prompt-item');
    
    characterItems.forEach(characterItem => {
        const characterTabButtons = characterItem.querySelectorAll('.gallery-toggle-btn');
        const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
        const toggleGroup = characterItem.querySelector('.gallery-toggle-group');
        const characterPromptTabs = characterItem.querySelector('.character-prompt-tabs');
        const characterId = characterItem.id;

        // Show both character tab buttons and panes
        characterTabButtons.forEach(btn => btn.classList.add('active'));
        characterTabPanes.forEach(pane => pane.classList.add('active'));
        
        // Add show-both class to character-prompt-tabs for visual separation
        if (characterPromptTabs) {
            characterPromptTabs.classList.add('show-both');
        }
        
        // Update the data-active attribute for the character's slider (keep current state)
        if (toggleGroup) {
            const currentActive = toggleGroup.getAttribute('data-active') || 'prompt';
            toggleGroup.setAttribute('data-active', currentActive);
        }

        // Update emphasis highlighting for both prompt and UC textareas
        const promptTextarea = characterItem.querySelector(`#${characterId}_prompt`);
        const ucTextarea = characterItem.querySelector(`#${characterId}_uc`);
        
        if (promptTextarea) {
            updateEmphasisHighlighting(promptTextarea);
        }
        if (ucTextarea) {
            updateEmphasisHighlighting(ucTextarea);
        }
    });
}

// Update balance display
function updateBalanceDisplay(balance) {
    const balanceDisplay = document.getElementById('balanceDisplay');
    const balanceAmount = document.getElementById('balanceAmount');
    const balanceIcon = balanceDisplay.querySelector('i');

    if (!balanceDisplay || !balanceAmount) return;

    const totalCredits = balance?.totalCredits || -1;
    const fixedCredits = balance?.fixedTrainingStepsLeft || -1;
    const purchasedCredits = balance?.purchasedTrainingSteps || -1;

    // Update amount
    balanceAmount.textContent = totalCredits;

    // Update tooltip with detailed breakdown
    const tooltip = `Free Credits: ${fixedCredits}\nPaid Credits: ${purchasedCredits}`;
    balanceDisplay.title = tooltip;

    // Update styling based on credit levels
    balanceDisplay.classList.remove('low-credits');

    if (totalCredits !== -1) {
        currentBalance = totalCredits;
    }

    if (totalCredits === -1) {
        balanceIcon.className = 'nai-anla';
        balanceAmount.textContent = 'Account Error';
        balanceDisplay.classList.add('low-credits');
    } else if (totalCredits === 0) {
        // No credits - show dollar sign and warning styling
        balanceIcon.className = 'nai-anla';
        balanceDisplay.classList.add('low-credits');
    } else if (fixedCredits === 0) {
        // No free credits - show dollar sign
        balanceIcon.className = 'nai-anla';
    } else if (totalCredits < 5000) {
        // Low credits - show warning triangle and orange styling
        balanceIcon.className = 'fas fa-exclamation-triangle';
        balanceDisplay.classList.add('low-credits');
    } else {
        // Normal credits - show coin icon
        balanceIcon.className = 'nai-anla';
    }
}

// Load gallery images with optimized rendering to prevent flickering
async function loadGallery(addLatest) {
    try {
        const response = await fetchWithAuth('/images');
        if (response.ok) {
            const newImages = await response.json();

            // Check if images have actually changed to avoid unnecessary updates
            if (JSON.stringify(allImages) === JSON.stringify(newImages)) {
                return; // No changes, skip update
            }

            allImages = newImages;

            // Reset infinite scroll state and display initial batch
            if (!addLatest) {
                resetInfiniteScroll();
                displayCurrentPageOptimized();
            } else {
                await addNewGalleryItemAfterGeneration(newImages[0]);
            }
        } else {
            console.error('Failed to load gallery:', response.statusText);
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        // Don't throw error for gallery loading failure
        allImages = [];
        displayCurrentPageOptimized();
    }
}

// Add a new gallery item after generation with fade-in and slide-in animations
async function addNewGalleryItemAfterGeneration(newImage) {
    // Add placeholder with fade-in
    const placeholder = document.createElement('div');
    placeholder.className = 'gallery-placeholder fade-in';
    placeholder.style.height = '256px';
    placeholder.style.width = '100%';
    placeholder.dataset.filename = newImage.filename || newImage.original || newImage.upscaled;
    placeholder.dataset.time = newImage.mtime;
    placeholder.dataset.index = 0;
    gallery.insertBefore(placeholder, gallery.children[0]);
    // Wait for fade-in animation to finish
    await new Promise(resolve => {
        placeholder.addEventListener('animationend', function handler() {
            placeholder.classList.remove('fade-in');
            placeholder.removeEventListener('animationend', handler);
            resolve();
        });
    });
    // Replace placeholder with real item, slide in
    const newItem = createGalleryItem(newImage, 0);
    newItem.classList.add('slide-in');
    gallery.replaceChild(newItem, placeholder);
    newItem.addEventListener('animationend', function handler() {
        newItem.classList.remove('slide-in');
        newItem.removeEventListener('animationend', handler);
    });
    reindexGallery();
}

let galleryColumns = parseInt(galleryColumnsInput?.value) || 5;
let realGalleryColumns = galleryColumns;
let galleryRows = 5;
let debounceGalleryTimeout = null;

// Calculate optimal number of rows based on viewport height
function calculateGalleryRows() {
    if (!gallery) return 5; // Fallback to 5 if gallery not found

    // Get gallery container dimensions
    const galleryRect = gallery.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Estimate gallery item height (including gap and margins)
    // Gallery items are square (aspect-ratio: 1) with gap and padding
    const itemSize = galleryRect.width / realGalleryColumns; // Width of each item
    const gap = 24; // var(--spacing-xl) from CSS
    const itemHeight = itemSize + gap; // Item height plus gap

    // Calculate available height for gallery
    // Account for header, controls, and margins (no pagination)
    const headerHeight = 80; // Approximate header height
    const controlsHeight = 60; // Approximate controls height
    const margins = 40; // Top and bottom margins

    const availableHeight = viewportHeight - headerHeight - controlsHeight - margins;

    // Calculate how many rows can fit
    const calculatedRows = Math.floor(availableHeight / itemHeight);

    // Ensure minimum of 3 rows and maximum of 8 rows for usability
    return Math.max(3, Math.min(8, calculatedRows));
}

function setGalleryColumns(cols) {
    galleryColumns = Math.max(3, Math.min(10, parseInt(cols) || 5));
    gallery.style.gridTemplateColumns = `repeat(${galleryColumns}, 1fr)`;
    galleryColumnsInput.value = galleryColumns;

    // Recalculate rows based on new column count
    galleryRows = calculateGalleryRows();
    
    if (debounceGalleryTimeout) clearTimeout(debounceGalleryTimeout);
    debounceGalleryTimeout = setTimeout(() => {
        updateGalleryColumnsFromLayout();
        displayCurrentPageOptimized();
        resetInfiniteScroll();
    }, 500);
    updateGalleryPlaceholders();
}

function updateGalleryPlaceholders() {
    if (!gallery) return;
    // Remove old placeholders
    Array.from(gallery.querySelectorAll('.gallery-placeholder')).forEach(el => el.remove());

    // For infinite scroll, we don't need to add placeholders for the current page
    // Placeholders will be added when loading more images
}

function updateGalleryItemToolbars() {
    const items = document.querySelectorAll('.gallery-item');
    let i = 0;
    function updateNext() {
        if (i >= items.length) return;
        const item = items[i];
        const overlay = item.querySelector('.gallery-item-overlay');
        if (!overlay) return;
        // Check if item is too small (e.g., width < 120px or height < 120px)
        const rect = item.getBoundingClientRect();
        let miniToolbar = overlay.querySelector('.mini-toolbar');
        if (rect.width < 208 || rect.height < 208) {
            item.classList.add('mini-toolbar-active');
            if (!miniToolbar) {
                miniToolbar = document.createElement('div');
                miniToolbar.className = 'mini-toolbar';
                miniToolbar.innerHTML = `
                    <button class="btn-small" title="Edit"><i class="nai-settings"></i></button>
                    <button class="btn-small" title="Download"><i class="nai-save"></i></button>
                    <button class="btn-small" title="Delete"><i class="nai-trash"></i></button>
                `;
                overlay.appendChild(miniToolbar);
            }
            miniToolbar.style.display = 'flex';
        } else {
            item.classList.remove('mini-toolbar-active');
            if (miniToolbar) {
                miniToolbar.style.display = 'none';
            }
        }
        i++;
        requestAnimationFrame(updateNext);
    }
    updateNext();
}

// Optimized display function for infinite scroll using document fragment
function displayCurrentPageOptimized() {
    if (!gallery) return;

    // Clear gallery
    gallery.innerHTML = '';

    // If no images, show empty state
    if (allImages.length === 0) {
        return;
    }

    displayedStartIndex = 0;
    const itemHeight = 256;
    const itemsPerCol = Math.floor(window.innerHeight / itemHeight);
    const buffer = Math.ceil(itemsPerCol * 0.15);
    const totalItems = Math.min((itemsPerCol + buffer) * realGalleryColumns, allImages.length);
    displayedEndIndex = totalItems;

    const fragment = document.createDocumentFragment();
    for (let i = displayedStartIndex; i < displayedEndIndex; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'gallery-placeholder initial-placeholder';
        placeholder.style.height = '256px';
        placeholder.style.width = '100%';
        placeholder.dataset.index = i;
        placeholder.dataset.filename = allImages[i]?.filename || allImages[i]?.original || allImages[i]?.upscaled || '';
        placeholder.dataset.time = allImages[i]?.mtime || 0;
        fragment.appendChild(placeholder);
    }
    gallery.appendChild(fragment);

    // Fade in placeholders one by one
    const placeholders = gallery.querySelectorAll('.gallery-placeholder.initial-placeholder');
    placeholders.forEach((el, idx) => {
        setTimeout(() => {
            el.classList.add('fade-in');
            el.addEventListener('animationend', function handler() {
                el.classList.remove('fade-in');
                el.removeEventListener('animationend', handler);
            });
        }, idx * 60);
    });

    hasMoreImages = displayedEndIndex < allImages.length;
    hasMoreImagesBefore = displayedStartIndex > 0;
    updateVirtualScroll();
    updateGalleryItemToolbars();
    updateGalleryPlaceholders();
}

function resetInfiniteScroll() {
    window.scrollTo({ top: 0, behavior: 'instant' });
    displayedStartIndex = 0;
    displayedEndIndex = 0;
    isLoadingMore = false;
    hasMoreImages = true;
    hasMoreImagesBefore = false;
    
    // Update batch size based on current viewport
    imagesPerPage = calculateDynamicBatchSize();
    
    if (infiniteScrollLoading) {
        infiniteScrollLoading.style.display = 'none';
    }
}

// Create gallery item element
function createGalleryItem(image, index) {
    const item = document.createElement('div');
    item.className = 'gallery-item fade-in';
    const filename = image.filename || image.original || image.upscaled;
    item.dataset.filename = filename;
    item.dataset.time = image.mtime || 0;
    item.dataset.index = index;
    
    // Use data-selected as single source of truth for selection state
    const isSelected = selectedImages.has(filename);
    item.dataset.selected = isSelected ? 'true' : 'false';
    if (isSelected) {
        item.classList.add('selected');
    } else {
        item.classList.remove('selected');
    }
    
    // Add selection checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gallery-item-checkbox';
    checkbox.dataset.filename = filename;
    checkbox.checked = isSelected;
    
    // ALT+click range selection on click event
    checkbox.addEventListener('click', (e) => {
        if (e.altKey) {
            e.preventDefault();
            // Get all gallery items (both real items and placeholders) in order
            const allItems = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
            const clickedIndex = allItems.findIndex(div => div.dataset.filename === filename);
            
            if (lastSelectedGalleryIndex !== null && clickedIndex !== -1) {
                const [start, end] = [lastSelectedGalleryIndex, clickedIndex].sort((a, b) => a - b);
                
                // Select all items in range
                for (let i = start; i <= end; i++) {
                    const div = allItems[i];
                    const itemFilename = div.dataset.filename;
                    
                    // Update data-selected attribute
                    div.dataset.selected = 'true';
                    div.classList.add('selected');
                    selectedImages.add(itemFilename);
                    
                    // Update checkbox if it's a real item
                    const cb = div.querySelector('.gallery-item-checkbox');
                    if (cb) cb.checked = true;
                }
                
                updateBulkActionsBar();
                lastSelectedGalleryIndex = clickedIndex;
                return;
            }
        }
    });
    
    // Normal selection on change event
    checkbox.addEventListener('change', (e) => {
        if (!e.altKey) {
            e.stopPropagation();
            handleImageSelection(image, e.target.checked, e);
        }
    });

    // Use preview image
    const img = document.createElement('img');
    img.src = `/previews/${image.preview}`;
    img.alt = image.base;
    img.loading = 'lazy';

    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';

    // Create info container for preset, seed, and date
    const infoContainer = document.createElement('div');
    infoContainer.className = 'gallery-item-info-container';

    // Extract preset name and seeds from filename
    let presetName = 'generated';
    let seed = '';
    let layer1Seed = '';

    // Regular filename format: timestamp_preset_seed.png
    const parts = image.base.split('_');
    if (parts.length >= 3) {
        presetName = parts.slice(1, -1).join('_') || 'generated';
        seed = parts[parts.length - 1] || '';
    }

    const dateTime = new Date(image.mtime).toLocaleString();

    // Create info rows
    const presetRow = document.createElement('div');
    presetRow.className = 'gallery-info-row';
    presetRow.textContent = presetName;

    const seedRow = document.createElement('div');
    seedRow.className = 'gallery-info-row';
    seedRow.textContent = `Seed: ${seed}`;

    const dateRow = document.createElement('div');
    dateRow.className = 'gallery-info-row';
    dateRow.textContent = dateTime;

    infoContainer.appendChild(presetRow);
    infoContainer.appendChild(seedRow);
    infoContainer.appendChild(dateRow);

    overlay.appendChild(infoContainer);

    // Create action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'gallery-actions';

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn-secondary round-button';
    downloadBtn.innerHTML = '<i class="nai-save"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadImage(image);
    };

    // Direct reroll button (left side)
    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'btn-secondary round-button';
    rerollBtn.innerHTML = '<i class="nai-dice"></i>';
    rerollBtn.title = 'Reroll with same settings';
    rerollBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImage(image);
    };

    // Reroll with edit button (right side with cog)
    const rerollEditBtn = document.createElement('button');
    rerollEditBtn.className = 'btn-secondary round-button';
    rerollEditBtn.innerHTML = '<i class="nai-penwriting"></i>';
    rerollEditBtn.title = 'Reroll with Edit';
    rerollEditBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImageWithEdit(image);
    };

    // Upscale button (only for non-upscaled images)
    const upscaleBtn = document.createElement('button');
    upscaleBtn.className = 'btn-secondary round-button';
    upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
    upscaleBtn.title = 'Upscale';
    upscaleBtn.onclick = (e) => {
        e.stopPropagation();
        upscaleImage(image, e);
    };

    // Only show upscale button for non-upscaled images
    if (!image.upscaled) {
        upscaleBtn.style.display = 'inline-block';
    } else {
        upscaleBtn.style.display = 'none';
    }

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'btn-secondary round-button';
    pinBtn.innerHTML = '<i class="nai-heart-disabled"></i>';
    pinBtn.title = 'Pin/Unpin image';
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        togglePinImage(image, pinBtn);
    };
    
    // Update pin button appearance based on pin status
    updatePinButtonAppearance(pinBtn, filename);

    // Toolbar trigger button (combines scrap and delete)
    const toolbarBtn = document.createElement('button');
    toolbarBtn.className = 'btn-secondary round-button';
    toolbarBtn.innerHTML = '<i class="nai-dotdotdot"></i>';
    toolbarBtn.title = 'More actions';
    toolbarBtn.onclick = (e) => {
        e.stopPropagation();
        showGalleryToolbar(image, e);
    };

    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(upscaleBtn);
    actionsDiv.appendChild(rerollBtn);
    actionsDiv.appendChild(rerollEditBtn);
    actionsDiv.appendChild(pinBtn);
    actionsDiv.appendChild(toolbarBtn);

    overlay.appendChild(actionsDiv);

    item.appendChild(checkbox);
    item.appendChild(img);
    item.appendChild(overlay);

    
    item.addEventListener('click', (e) => {
        // Don't open lightbox if clicking on checkbox
        if (e.target.type === 'checkbox') {
            return;
        }

        let filenameToShow = image.original;
        if (image.upscaled) {
            filenameToShow = image.upscaled;
        }

        const imageToShow = {
            filename: filenameToShow,
            base: image.base,
            upscaled: image.upscaled
        };
        showLightbox(imageToShow);
    });

    return item;
}

// Reindex gallery items and placeholders
function reindexGallery() {
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length === 0) return;
    if (parseInt(items[items.length - 1]?.dataset?.index || '0') !== (items.length - 1)) {
        items.forEach((el, i) => {
            el.dataset.index = i.toString();
        });
    }
}

async function rerollImage(image) {
    // Check if we're in a modal context
    const isInModal = document.getElementById('manualModal').style.display === 'block';
    
    let toastId;
    let progressInterval;
    
    if (!isInModal) {
        // Use glass toast with progress when not in modal
        toastId = showGlassToast('info', 'Rerolling Image', 'Generating new image...', true);
        
        // Start progress animation (1% per second)
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += 1;
            updateGlassToastProgress(toastId, progress);
        }, 1000);
    } else {
        // Use existing modal loading overlay when in modal
        showManualLoading(true, 'Rerolling image...');
    }

    try {
        // Determine which filename to use for metadata
        // For gallery items, determine the filename based on available properties
        let filenameForMetadata = image.filename;

        if (!filenameForMetadata) {
            // If no filename property, determine from gallery image object
            if (image.upscaled) {
                filenameForMetadata = image.upscaled;
            } else if (image.original) {
                filenameForMetadata = image.original;
            }
        }

        if (!filenameForMetadata) {
            throw new Error('No filename available for metadata lookup');
        }


        // Get metadata from the image
        const response = await fetchWithAuth(`/images/${filenameForMetadata}`, {
            method: 'OPTIONS'
        });

        if (!response.ok) {
            throw new Error(`Failed to load image metadata: ${response.status} ${response.statusText}`);
        }

        const metadata = await response.json();

        if (!metadata) {
            throw new Error('No metadata found for this image');
        }

        // Check if this is a variation and we have the original base image
        const isVariation = metadata.base_image === true;
        const hasOriginalFilename = metadata.original_filename;

        let generateResponse;

        if (isVariation && hasOriginalFilename) {
            // Handle variation reroll - use the original base image
            // Build request body from metadata
            const requestBody = {
                image: `file:${hasOriginalFilename}`, // Use the original filename with file: prefix
                strength: metadata.strength || 0.8, // Use strength from metadata or default
                noise: metadata.noise || 0.1, // Use noise from metadata or default
                prompt: metadata.prompt || '',
                resolution: metadata.resolution || '',
                steps: metadata.steps || 25,
                guidance: metadata.scale || 5.0,
                rescale: metadata.cfg_rescale || 0.0,
                allow_paid: typeof forcePaidRequest !== 'undefined' ? forcePaidRequest : false,
                workspace: activeWorkspace
            };

            // Add mask data if it exists
            if (window.currentMaskCompressed) {
                requestBody.mask_compressed = window.currentMaskCompressed.replace('data:image/png;base64,', '');
            } else if (window.currentMaskData) {
                const compressedMask = saveMaskCompressed();
                if (compressedMask) {
                    requestBody.mask_compressed = compressedMask.replace('data:image/png;base64,', '');
                }
            }

            // Add optional fields if they have values
            if (metadata.uc) {
                requestBody.uc = metadata.uc;
            }

            if (metadata.sampler) {
                const samplerObj = getSamplerMeta(metadata.sampler);
                requestBody.sampler = samplerObj ? samplerObj.request : metadata.sampler;
            }

            if (metadata.noise_schedule) {
                const noiseObj = getNoiseMeta(metadata.noise_schedule);
                requestBody.noiseScheduler = noiseObj ? noiseObj.request : metadata.noise_schedule;
            }

            if (metadata.skip_cfg_above_sigma) {
                requestBody.variety = true;
            }

            // Add upscale if it was used in original generation
            if (metadata.upscaled) {
                requestBody.upscale = true;
            }

            // Add preset if available
            if (metadata.preset_name) {
                requestBody.preset = metadata.preset_name;
            }

            // Add image_bias if available (for variations)
            if (metadata.image_bias !== undefined) {
                requestBody.image_bias = metadata.image_bias;
            }

            // Add character prompts if available
            if (metadata.characterPrompts && Array.isArray(metadata.characterPrompts) && metadata.characterPrompts.length > 0) {
                requestBody.allCharacterPrompts = metadata.characterPrompts;
                requestBody.use_coords = !!metadata.use_coords;
            }


            addSharedFieldsToRequestBody(requestBody, metadata);

            delete requestBody.seed;

            // Generate variation with same settings using original base image
            const model = metadata.model ? metadata.model.toLowerCase() : 'v4_5';
            const url = `/${model}/generate`;
            generateResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
        } else {
            // Handle regular image reroll (existing logic)
            // Build request body from metadata
            const requestBody = {
                prompt: metadata.prompt || '',
                resolution: metadata.resolution || '',
                steps: metadata.steps || 25,
                guidance: metadata.scale || 5.0,
                rescale: metadata.cfg_rescale || 0.0,
                allow_paid: typeof forcePaidRequest !== 'undefined' ? forcePaidRequest : false,
                workspace: activeWorkspace
            };

            // Add optional fields if they have values
            if (metadata.uc) {
                requestBody.uc = metadata.uc;
            }

            if (metadata.sampler) {
                const samplerObj = getSamplerMeta(metadata.sampler);
                requestBody.sampler = samplerObj ? samplerObj.request : metadata.sampler;
            }

            if (metadata.noise_schedule) {
                const noiseObj = getNoiseMeta(metadata.noise_schedule);
                requestBody.noiseScheduler = noiseObj ? noiseObj.request : metadata.noise_schedule;
            }

            if (metadata.skip_cfg_above_sigma) {
                requestBody.variety = true;
            }

            // Add upscale if it was used in original generation
            if (metadata.upscaled) {
                requestBody.upscale = true;
            }

            // Add preset if available
            if (metadata.preset_name) {
                requestBody.preset = metadata.preset_name;
            }

            // Add character prompts if available
            if (metadata.characterPrompts && Array.isArray(metadata.characterPrompts) && metadata.characterPrompts.length > 0) {
                requestBody.allCharacterPrompts = metadata.characterPrompts;
                requestBody.use_coords = !!metadata.use_coords;
            }

            // Add mask data if it exists
            if (window.currentMaskCompressed) {
                requestBody.mask_compressed = window.currentMaskCompressed.replace('data:image/png;base64,', '');
            } else if (window.currentMaskData) {
                // Add compressed mask for server processing
                let compressedMask = saveMaskCompressed();
                if (compressedMask) {
                    requestBody.mask_compressed = compressedMask.replace('data:image/png;base64,', '');
                }
            }



            addSharedFieldsToRequestBody(requestBody, metadata);

            delete requestBody.seed;

            // Generate image with same settings
            const model = metadata.model ? metadata.model.toLowerCase() : 'v4_5';
            const url = `/${model}/generate`;
            generateResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
        }

        if (!generateResponse.ok) {
            throw new Error(`Generation failed: ${generateResponse.statusText}`);
        }

        const blob = await generateResponse.blob();
        const imageUrl = URL.createObjectURL(blob);

        // Extract seed from response header if available
        const headerSeed = generateResponse.headers.get('X-Seed');
        if (headerSeed) {
            window.lastGeneratedSeed = parseInt(headerSeed);
            manualPreviewSeedNumber.textContent = parseInt(headerSeed);
        }

        // Fetch metadata for the generated image if we have a filename
        const generatedFilename = generateResponse.headers.get('X-Generated-Filename');
        if (generatedFilename) {
            try {
                const metadataResponse = await fetchWithAuth(`/images/${generatedFilename}`, {
                    method: 'OPTIONS'
                });
                if (metadataResponse.ok) {
                    const metadata = await metadataResponse.json();
                    window.lastGeneration = metadata;
                    window.lastGeneration.filename = generatedFilename;
                    manualPreviewOriginalImage.classList.remove('hidden');
                }
            } catch (error) {
                console.warn('Failed to fetch metadata for generated image:', error);
            }
        }

        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = function() {
            createConfetti();

            // Refresh gallery and show the new image in lightbox
            setTimeout(async () => {
                await loadGallery();

                // Find the newly generated image (should be the first one)
                if (allImages.length > 0) {
                    const newImage = allImages[0]; // Newest image is first
                    let filenameToShow = newImage.original;
                    if (newImage.upscaled) {
                        filenameToShow = newImage.upscaled;
                    }

                    const imageToShow = {
                        filename: filenameToShow,
                        base: newImage.base,
                        upscaled: newImage.upscaled
                    };
                    showLightbox(imageToShow);
                }
            }, 1000);
        };
        img.src = imageUrl;

        // Show success message
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToastProgress(toastId, 100);
            updateGlassToast(toastId, 'success', 'Reroll Complete', 'Image generated successfully!');
            const imageContainer = document.querySelector('.manual-preview-image-container');
            imageContainer.classList.remove('swapped');
        } else {
            showGlassToast('success', 'Reroll Complete', 'Image generated successfully!');
        }

    } catch (error) {
        console.error('Direct reroll error:', error);
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToast(toastId, 'error', 'Reroll Failed', 'Image reroll failed: ' + error.message);
        } else {
            showError('Image reroll failed: ' + error.message);
        }
    } finally {
        if (isInModal) {
            showManualLoading(false);
        }
    }
}

// Reroll an image with editable settings
async function rerollImageWithEdit(image) {
    try {
        // Determine filename for metadata
        let filenameForMetadata = image.filename || image.upscaled || image.original;
        if (!filenameForMetadata) {
            throw new Error('No filename available for metadata lookup');
        }

        // Get metadata
        const response = await fetchWithAuth(`/images/${filenameForMetadata}`, {
            method: 'OPTIONS'
        });
        if (!response.ok) {
            throw new Error(`Failed to load image metadata: ${response.status} ${response.statusText}`);
        }
        const metadata = await response.json();
        if (!metadata) {
            throw new Error('No metadata found for this image');
        }

        // Close lightbox
        if (lightboxModal.style.display === 'flex') {
            hideLightbox();
        }

        // Store metadata and image
        window.currentEditMetadata = metadata;
        window.currentEditImage = image;

        // Load form values from metadata
        await loadIntoManualForm(metadata, image);

        // Show request type row
        const requestTypeRow = document.getElementById('requestTypeRow');
        if (requestTypeRow) requestTypeRow.style.display = 'flex';

        // Determine types
        const isVariation = metadata.base_image === true;

        // Set initial state
        const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
        const saveButton = document.getElementById('manualSaveBtn');

        if (isVariation) {
            window.currentRequestType = 'reroll';
            // Set transformation type to reroll
            updateTransformationDropdownState('reroll', 'Referance');

            const [type, id] = metadata.image_source.split(':');
            const previewUrl = type === 'file' ? `/images/${id}` : `/cache/preview/${id}.webp`;
            window.uploadedImageData = {
                image_source: metadata.image_source,
                width: metadata.width || 512,
                height: metadata.height || 512,
                bias: typeof metadata.image_bias === 'number' ? metadata.image_bias : 2,
                image_bias: typeof metadata.image_bias === 'object' ? metadata.image_bias : undefined,
                isBiasMode: true,
                isClientSide: false
            };
            if (typeof metadata.image_bias === 'object') {
                imageBiasAdjustmentData.currentBias = metadata.image_bias;
            }

            variationImage.style.display = 'block';
            updateInpaintButtonState();
            renderImageBiasDropdown((typeof metadata.image_bias === 'number' ? metadata.image_bias : 2).toString());

            if (presetNameGroup) presetNameGroup.style.display = 'block';
            if (saveButton) saveButton.style.display = 'inline-block';
        } else {
            window.currentRequestType = null;
            // Clear transformation type
            updateTransformationDropdownState(undefined, 'References');

            if (presetNameGroup) presetNameGroup.style.display = 'block';
            if (saveButton) saveButton.style.display = 'inline-block';
        }

        // Only call cropImageToResolution if uploadedImageData is available
        if (window.uploadedImageData) {
            await cropImageToResolution();
        }
        manualLoadingOverlay.classList.remove('hidden');
        manualLoadingOverlay.classList.add('return');
        manualPreviewOriginalImage.classList.add('hidden');
        
        openModal(manualModal);
        manualPrompt.focus();

        // Auto-resize textareas after modal is shown
        autoResizeTextareasAfterModalShow();
        
        if (!document.body.classList.contains('editor-open')) {
            document.body.classList.add('editor-open');
        }

    } catch (error) {
        console.error('Reroll with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
    }
}

// Upscale an image
async function upscaleImage(image, event = null) {
    // Check if user has already allowed paid requests
    const cost = 7; // Upscaling cost
    if (!forcePaidRequest) {
        const confirmed = await showCreditCostDialog(cost, event);
        
        if (!confirmed) {
            return;
        }
    }
    
    // Check if we're in a modal context
    const isInModal = document.getElementById('manualModal').style.display === 'block';
    
    let toastId;
    let progressInterval;
    
    if (!isInModal) {
        // Use glass toast with progress when not in modal
        toastId = showGlassToast('info', 'Upscaling Image', 'Upscaling image...', true);
        
        // Start progress animation (1% per second)
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += 1;
            updateGlassToastProgress(toastId, progress);
        }, 1000);
    } else {
        // Use existing modal loading overlay when in modal
        showManualLoading(true, 'Upscaling image...');
    }

    try {
        const upscaleResponse = await fetchWithAuth(`/images/${image.original}/upscale`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!upscaleResponse.ok) {
            throw new Error(`Upscaling failed: ${upscaleResponse.statusText}`);
        }

        const blob = await upscaleResponse.blob();
        const imageUrl = URL.createObjectURL(blob);

        // Show success message
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToastProgress(toastId, 100);
            updateGlassToast(toastId, 'success', 'Upscale Complete', 'Image upscaled successfully!');
        } else {
            showGlassToast('success', 'Upscale Complete', 'Image upscaled successfully!');
        }

        // Reload gallery to show new upscaled image
        await loadGallery();

        // Update balance and show credit deduction toast
        await updateBalanceAndShowCreditDeduction('image upscaling', cost);

        // Find the upscaled image in the gallery and show it in lightbox
        let upscaledFilename = image.original.replace('.png', '_upscaled.png');
        let upscaledImage = allImages.find(img =>
            img.original === upscaledFilename ||
            img.upscaled === upscaledFilename
        );

        if (upscaledImage) {
            // Determine which filename to show based on what's available
            let filenameToShow = upscaledImage.original;
            if (upscaledImage.upscaled) {
                filenameToShow = upscaledImage.upscaled;
            }

            const imageToShow = {
                filename: filenameToShow,
                base: upscaledImage.base,
                upscaled: upscaledImage.upscaled
            };
            showLightbox(imageToShow);
        }

    } catch (error) {
        console.error('Upscaling error:', error);
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToast(toastId, 'error', 'Upscale Failed', 'Image upscaling failed. Please try again.');
        } else {
            showError('Image upscaling failed. Please try again.');
        }
    } finally {
        if (isInModal) {
            showManualLoading(false);
        }
    }
}

// Deferred placeholder addition for rapid scrolling
let deferredPlaceholderTimeout = null;
let pendingPlaceholderAdditions = {
    above: false,
    below: false
};

function scheduleDeferredPlaceholderAddition(direction) {
    pendingPlaceholderAdditions[direction] = true;
    
    if (deferredPlaceholderTimeout) {
        clearTimeout(deferredPlaceholderTimeout);
    }
    
    deferredPlaceholderTimeout = setTimeout(() => {
        if (pendingPlaceholderAdditions.above) {
            addPlaceholdersAbove();
            pendingPlaceholderAdditions.above = false;
        }
        if (pendingPlaceholderAdditions.below) {
            addPlaceholdersBelow();
            pendingPlaceholderAdditions.below = false;
        }
    }, 50); // 50ms delay to batch rapid scroll events
}

function addPlaceholdersAbove() {
    if (!gallery || isLoadingMore) return;
    
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const bufferRows = 8;
    const itemsPerRow = realGalleryColumns;
    const bufferSize = bufferRows * itemsPerRow;
    
    // Count placeholders above
    let placeholdersAbove = 0;
    let firstRealIndex = -1;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('gallery-placeholder')) {
            placeholdersAbove++;
        } else {
            firstRealIndex = parseInt(items[i].dataset.index);
            break;
        }
    }
    
    // Add placeholders in row batches until buffer is filled
    while (placeholdersAbove < bufferSize && firstRealIndex > 0) {
        const needed = Math.min(bufferSize - placeholdersAbove, itemsPerRow);
        for (let i = 0; i < needed; i++) {
            const idx = firstRealIndex - i - 1;
            if (idx < 0) break;
            
            // Check if placeholder already exists
            const existingPlaceholder = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
            if (!existingPlaceholder) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = '256px';
                placeholder.style.width = '100%';
                placeholder.dataset.index = idx;
                gallery.insertBefore(placeholder, gallery.firstChild);
                placeholdersAbove++;
            }
        }
        firstRealIndex = Math.max(0, firstRealIndex - needed);
    }
}

function addPlaceholdersBelow() {
    if (!gallery || isLoadingMore) return;
    
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const bufferRows = 8;
    const itemsPerRow = realGalleryColumns;
    const bufferSize = bufferRows * itemsPerRow;
    
    // Count placeholders below
    let placeholdersBelow = 0;
    let lastRealIndex = -1;
    
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].classList.contains('gallery-placeholder')) {
            placeholdersBelow++;
        } else {
            lastRealIndex = parseInt(items[i].dataset.index);
            break;
        }
    }
    
    // Add placeholders in row batches until buffer is filled
    while (placeholdersBelow < bufferSize && lastRealIndex < allImages.length - 1) {
        const needed = Math.min(bufferSize - placeholdersBelow, itemsPerRow);
        for (let i = 0; i < needed; i++) {
            const idx = lastRealIndex + i + 1;
            if (idx >= allImages.length) break;
            
            // Check if placeholder already exists
            const existingPlaceholder = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
            if (!existingPlaceholder) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = '256px';
                placeholder.style.width = '100%';
                placeholder.dataset.index = idx;
                gallery.appendChild(placeholder);
                placeholdersBelow++;
            }
        }
        lastRealIndex = Math.min(allImages.length - 1, lastRealIndex + needed);
    }
}

// Improved infinite scroll handler with percentage-based triggers
function handleInfiniteScroll() {
    if (isLoadingMore) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // Calculate responsive trigger distances
    const isSmallScreen = window.innerWidth <= infiniteScrollConfig.smallScreenThreshold;
    const multiplier = isSmallScreen ? infiniteScrollConfig.smallScreenMultiplier : 1;
    
    // Use percentage-based triggers that adapt to page height
    const bottomTriggerDistance = Math.max(
        windowHeight * infiniteScrollConfig.bottomTriggerPercent * multiplier,
        windowHeight * 0.1 // Minimum 10% of viewport height
    );
    
    const topTriggerDistance = Math.max(
        windowHeight * infiniteScrollConfig.topTriggerPercent * multiplier,
        windowHeight * 0.1 // Minimum 10% of viewport height
    );
    
    const placeholderTriggerDistance = Math.max(
        windowHeight * infiniteScrollConfig.placeholderTriggerPercent * multiplier,
        windowHeight * 0.15 // Minimum 15% of viewport height
    );

    // Load more when user is near the bottom (percentage-based)
    if (scrollTop + windowHeight >= documentHeight - bottomTriggerDistance && hasMoreImages) {
        loadMoreImages();
    }
    
    // Load more when user is near the top (percentage-based)
    if (scrollTop <= topTriggerDistance && hasMoreImagesBefore) {
        loadMoreImagesBefore();
    }
    
    // Schedule deferred placeholder additions for rapid scrolling
    if (scrollTop <= placeholderTriggerDistance) {
        scheduleDeferredPlaceholderAddition('above');
    }
    if (scrollTop + windowHeight >= documentHeight - placeholderTriggerDistance) {
        scheduleDeferredPlaceholderAddition('below');
    }
    
    // Virtual scrolling: remove items that are too far from viewport
    if (virtualScrollEnabled) {
        updateVirtualScroll();
    }
}

// Load more images for infinite scroll (scroll down) with dynamic batch sizing
async function loadMoreImages() {
    if (isLoadingMore || !hasMoreImages) return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'flex';
    
    try {
        // Calculate dynamic batch size based on viewport
        const dynamicBatchSize = calculateDynamicBatchSize();
        
        // Calculate next batch of images
        const startIndex = displayedEndIndex;
        const endIndex = Math.min(startIndex + dynamicBatchSize, allImages.length);
        const nextBatch = allImages.slice(startIndex, endIndex);
        
        if (nextBatch.length === 0) {
            hasMoreImages = false;
            return;
        }
        
        // Add placeholders for new items with responsive height
        for (let i = startIndex; i < endIndex; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.style.height = calculatePlaceholderHeight() + 'px';
            placeholder.style.width = '100%';
            placeholder.dataset.index = i;
            gallery.appendChild(placeholder);
        }
        
        // Update displayed range
        displayedEndIndex = endIndex;
        hasMoreImages = endIndex < allImages.length;
        
    } catch (error) {
        console.error('Error loading more images:', error);
    } finally {
        isLoadingMore = false;
        if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'none';
    }
}

// Load more images before for infinite scroll (scroll up) with dynamic batch sizing
async function loadMoreImagesBefore() {
    if (isLoadingMore || !hasMoreImagesBefore) return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'flex';
    
    try {
        // Calculate dynamic batch size based on viewport
        const dynamicBatchSize = calculateDynamicBatchSize();
        
        // Calculate previous batch of images
        const endIndex = displayedStartIndex;
        const startIndex = Math.max(0, endIndex - dynamicBatchSize);
        const prevBatch = allImages.slice(startIndex, endIndex);
        
        if (prevBatch.length === 0) {
            hasMoreImagesBefore = false;
            return;
        }
        
        // Add placeholders for new items at the top with responsive height
        for (let i = endIndex - 1; i >= startIndex; i--) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.style.height = calculatePlaceholderHeight() + 'px';
            placeholder.style.width = '100%';
            placeholder.dataset.index = i;
            gallery.insertBefore(placeholder, gallery.firstChild);
        }
        
        // Update displayed range
        displayedStartIndex = startIndex;
        hasMoreImagesBefore = startIndex > 0;
        
    } catch (error) {
        console.error('Error loading more images before:', error);
    } finally {
        isLoadingMore = false;
        if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'none';
    }
}

// Helper functions for improved infinite scroll
function calculateDynamicBatchSize() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Base batch size on viewport size
    let baseSize = Math.ceil((windowWidth * windowHeight) / (300 * 300)); // Rough calculation
    
    // Adjust for small screens
    if (windowWidth <= infiniteScrollConfig.smallScreenThreshold) {
        baseSize = Math.ceil(baseSize * 0.7);
    }
    
    // Ensure batch size is within configured bounds
    return Math.max(
        infiniteScrollConfig.minBatchSize,
        Math.min(infiniteScrollConfig.maxBatchSize, baseSize)
    );
}

function calculatePlaceholderHeight() {
    // Calculate responsive placeholder height based on viewport
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Base height calculation
    let baseHeight = Math.min(windowWidth, windowHeight) * 0.3; // 30% of smaller viewport dimension
    
    // Adjust for different screen sizes
    if (windowWidth <= 480) {
        baseHeight = Math.min(baseHeight, 200); // Mobile: max 200px
    } else if (windowWidth <= 768) {
        baseHeight = Math.min(baseHeight, 250); // Tablet: max 250px
    } else {
        baseHeight = Math.min(baseHeight, 300); // Desktop: max 300px
    }
    
    // Ensure minimum height
    return Math.max(baseHeight, 150);
}

function calculateTrueItemsPerRow() {
    if (!gallery) return 5; // Fallback
    
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length < 2) return 5; // Need at least 2 items
    
    const firstItem = items[0];
    const firstRect = firstItem.getBoundingClientRect();
    const firstY = firstRect.top;
    
    // Find the next item that's at the same Y position (same row)
    let itemsInRow = 1;
    for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const rect = item.getBoundingClientRect();
        // Check if this item is at the same Y position (within 5px tolerance)
        if (Math.abs(rect.top - firstY) < 5) {
            itemsInRow++;
        } else {
            break; // Found the end of the first row
        }
    }
    
    return Math.max(1, itemsInRow);
}
// Update gallery columns based on true layout
function updateGalleryColumnsFromLayout() {
    const trueColumns = calculateTrueItemsPerRow();
    if (trueColumns !== realGalleryColumns) {
        realGalleryColumns = trueColumns;
        galleryRows = calculateGalleryRows();
        imagesPerPage = realGalleryColumns * galleryRows;
    }
}


// Update visible items tracking for virtual scrolling
function updateVisibleItems() {
    if (!gallery) return;

    visibleItems.clear();
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;

    items.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top + window.pageYOffset;
        const itemBottom = rect.bottom + window.pageYOffset;

        // Check if item is visible in viewport
        if (itemBottom > viewportTop && itemTop < viewportBottom) {
            visibleItems.add(index);
        }
    });
}

// Virtual scroll: replace far-away items with placeholders
function updateVirtualScroll() {
    if (!gallery) return;

    // First, update visible items tracking
    updateVisibleItems();

    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const total = items.length;
    const bufferRows = 8; // Number of rows to keep above and below viewport
    const itemsPerRow = realGalleryColumns;
    const visibleIndices = Array.from(visibleItems);

    if (visibleIndices.length === 0) return;

    const minVisible = Math.min(...visibleIndices);
    const maxVisible = Math.max(...visibleIndices);
    const minKeep = Math.max(0, minVisible - itemsPerRow); // 1 screen above
    const maxKeep = Math.min(total - 1, maxVisible + itemsPerRow); // 1 screen below
    const bufferSize = bufferRows * itemsPerRow;

    // Replace far-away items with placeholders, restore real items near viewport
    for (let i = 0; i < total; i++) {
        const el = items[i];
        if (i < minKeep || i > maxKeep) {
            if (!el.classList.contains('gallery-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = el.offsetHeight + 'px';
                placeholder.style.width = el.offsetWidth + 'px';
                placeholder.dataset.filename = el.dataset.filename;
                placeholder.dataset.index = el.dataset.index || i;
                placeholder.dataset.time = el.dataset.time || 0;
                placeholder.dataset.selected = el.dataset.selected;
                gallery.replaceChild(placeholder, el);
            }
        } else {
            if (el.classList.contains('gallery-placeholder')) {
                const imageIndex = parseInt(el.dataset.index || i);
                const image = allImages[imageIndex];
                if (image) {
                    const realItem = createGalleryItem(image, imageIndex);
                    // The createGalleryItem function already handles selection state based on selectedImages Set
                    // No need to manually manage selectedImages here
                    gallery.replaceChild(realItem, el);
                }
            }
        }
    }

    // --- Dynamic placeholder management above and below buffer, in full row batches ---
    const allPlaceholders = Array.from(gallery.querySelectorAll('.gallery-placeholder'));
    // Find checked placeholders
    const checkedIndices = allPlaceholders
        .map((el, idx) => el.dataset.selected === 'true' ? idx : -1)
        .filter(idx => idx !== -1);
    const firstChecked = checkedIndices.length > 0 ? checkedIndices[0] : null;
    const lastChecked = checkedIndices.length > 0 ? checkedIndices[checkedIndices.length - 1] : null;

    // Build a set of all indices currently present in the DOM
    const presentIndices = new Set();
    Array.from(gallery.children).forEach(el => {
        if (el.dataset && el.dataset.index !== undefined) {
            presentIndices.add(parseInt(el.dataset.index));
        }
    });

    // Count placeholders above and below buffer
    let placeholdersAbove = 0, placeholdersBelow = 0;
    for (let i = 0; i < allPlaceholders.length; i++) {
        const idx = Array.prototype.indexOf.call(gallery.children, allPlaceholders[i]);
        if (idx < minKeep) placeholdersAbove++;
        if (idx > maxKeep) placeholdersBelow++;
    }
    // Remove excess placeholders above (in full row batches, not checked or after first checked)
    let toRemoveAbove = placeholdersAbove - bufferSize;
    if (toRemoveAbove >= itemsPerRow) {
        toRemoveAbove = Math.floor(toRemoveAbove / itemsPerRow) * itemsPerRow;
        let removed = 0;
        for (let i = 0; i < allPlaceholders.length && removed < toRemoveAbove; i++) {
            const el = allPlaceholders[i];
            const idx = Array.prototype.indexOf.call(gallery.children, el);
            if (idx < minKeep) {
                if (el.dataset.selected === 'true' || (firstChecked !== null && i >= firstChecked)) break;
                presentIndices.delete(parseInt(el.dataset.index));
                el.remove();
                removed++;
            }
        }
    }
    // Remove excess placeholders below (in full row batches, not checked or before last checked)
    let toRemoveBelow = placeholdersBelow - bufferSize;
    if (toRemoveBelow >= itemsPerRow) {
        toRemoveBelow = Math.floor(toRemoveBelow / itemsPerRow) * itemsPerRow;
        let removed = 0;
        for (let i = allPlaceholders.length - 1; i >= 0 && removed < toRemoveBelow; i--) {
            const el = allPlaceholders[i];
            const idx = Array.prototype.indexOf.call(gallery.children, el);
            if (idx > maxKeep) {
                if (el.dataset.selected === 'true' || (lastChecked !== null && i <= lastChecked)) break;
                presentIndices.delete(parseInt(el.dataset.index));
                el.remove();
                removed++;
            }
        }
    }
    // Add missing placeholders above (in full row batches, only for missing indices)
    while (placeholdersAbove < bufferSize) {
        let firstChild = gallery.firstChild;
        let firstIndex = firstChild && firstChild.dataset && firstChild.dataset.index !== undefined ? parseInt(firstChild.dataset.index) : displayedStartIndex;
        if (firstIndex <= 0) break;
        let needed = Math.min(bufferSize - placeholdersAbove, itemsPerRow);
        let actuallyAdded = 0;
        for (let i = 0; i < needed; i++) {
            const idx = firstIndex - i - 1;
            if (idx < 0) break;
            if (!presentIndices.has(idx)) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = '256px';
                placeholder.style.width = '100%';
                placeholder.dataset.index = idx;
                gallery.insertBefore(placeholder, gallery.firstChild);
                presentIndices.add(idx);
                actuallyAdded++;
            }
        }
        placeholdersAbove += actuallyAdded;
        if (actuallyAdded === 0 || needed < itemsPerRow) break;
    }
    // Add missing placeholders below (in full row batches, only for missing indices)
    while (placeholdersBelow < bufferSize && displayedEndIndex < allImages.length) {
        // Find the current last index in the gallery
        let lastChild = gallery.lastChild;
        let lastIndex = lastChild && lastChild.dataset && lastChild.dataset.index !== undefined ? parseInt(lastChild.dataset.index) : displayedEndIndex;
        let needed = Math.min(bufferSize - placeholdersBelow, itemsPerRow);
        let actuallyAdded = 0;
        for (let i = 0; i < needed; i++) {
            const idx = lastIndex + i + 1;
            if (idx >= allImages.length) break;
            if (!presentIndices.has(idx)) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = '256px';
                placeholder.style.width = '100%';
                placeholder.dataset.index = idx;
                gallery.appendChild(placeholder);
                presentIndices.add(idx);
                actuallyAdded++;
            }
        }
        placeholdersBelow += actuallyAdded;
        if (actuallyAdded === 0 || needed < itemsPerRow) break;
    }
    // After all changes, update displayedStartIndex and displayedEndIndex to match the DOM
    let newFirst = gallery.firstChild && gallery.firstChild.dataset && gallery.firstChild.dataset.index !== undefined ? parseInt(gallery.firstChild.dataset.index) : 0;
    let newLast = gallery.lastChild && gallery.lastChild.dataset && gallery.lastChild.dataset.index !== undefined ? parseInt(gallery.lastChild.dataset.index) : 0;
    displayedStartIndex = Math.max(0, newFirst);
    displayedEndIndex = Math.max(displayedStartIndex, newLast + 1);

    // --- Force resolve all placeholders in the visible/buffered range to real items ---
    // Recompute visible/buffered range after any placeholder changes
    const updatedItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const updatedTotal = updatedItems.length;
    // Recompute visible indices
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;
    let updatedVisible = new Set();
    updatedItems.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top + window.pageYOffset;
        const itemBottom = rect.bottom + window.pageYOffset;
        if (itemBottom > viewportTop && itemTop < viewportBottom) {
            updatedVisible.add(index);
        }
    });
    const updatedVisibleIndices = Array.from(updatedVisible);
    if (updatedVisibleIndices.length > 0) {
        const minVisible = Math.min(...updatedVisibleIndices);
        const maxVisible = Math.max(...updatedVisibleIndices);
        const minKeep = Math.max(0, minVisible - itemsPerRow); // 1 screen above
        const maxKeep = Math.min(updatedTotal - 1, maxVisible + itemsPerRow); // 1 screen below
        for (let i = minKeep; i <= maxKeep; i++) {
            const el = updatedItems[i];
            if (el && el.classList.contains('gallery-placeholder')) {
                const imageIndex = parseInt(el.dataset.index || i);
                const image = allImages[imageIndex];
                if (image) {
                    const realItem = createGalleryItem(image, imageIndex);
                    // The createGalleryItem function already handles selection state based on selectedImages Set
                    // No need to manually manage selectedImages here
                    gallery.replaceChild(realItem, el);
                }
            }
        }
    }

    // --- If still at bottom or top, keep updating until filled or no more can be loaded ---
    let safetyCounter = 0;
    while (safetyCounter < 10) { // Prevent infinite loops
        safetyCounter++;
        // Re-calculate after DOM updates
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const atBottom = (windowHeight + scrollTop) >= (documentHeight - 10); // 10px threshold
        const atTop = scrollTop <= 10;
        let didWork = false;
        // If at bottom, try to add/resolve more below
        if (atBottom && hasMoreImages) {
            loadMoreImages();
            didWork = true;
        }
        // If at top, try to add/resolve more above
        if (atTop && hasMoreImagesBefore) {
            loadMoreImagesBefore();
            didWork = true;
        }
        // If no more work, break
        if (!didWork) break;
        // After loading, placeholders will be resolved in the next loop iteration
    }
}

// Handle logout
async function handleLogout() {
    try {
        const response = await fetchWithAuth('/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            window.location.href = '/';
        } else {
            showError('Logout failed');
        }
    } catch (error) {
        // Already redirected on 401
    }
}

// Show manual modal
async function showManualModal() {
    // Close editor if open
    if (!document.body.classList.contains('editor-open')) {
        document.body.classList.add('editor-open');
    }

    // Check if a preset is selected for editing
    const selectedValue = presetSelect.value;
    if (selectedValue) {
        // Load preset for editing
        await loadIntoManualForm(selectedValue);
    } else {
        // Clear form for new generation
        clearManualForm();
    }

    manualLoadingOverlay.classList.remove('hidden');
    manualLoadingOverlay.classList.add('return');
    manualPreviewOriginalImage.classList.add('hidden');
    openModal(manualModal);
    manualPrompt.focus();
    await cropImageToResolution();

    // Auto-resize textareas after modal is shown
    autoResizeTextareasAfterModalShow();

    // Update save button state
    updateSaveButtonState();

    // Update load button state
    updateLoadButtonState();

    // Calculate initial price display
    updateManualPriceDisplay();

    // Check if "show both" mode is active and hide tab buttons container if needed
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const showBothBtn = document.getElementById('showBothBtn');
    const tabButtonsContainer = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');

    if (promptTabs && promptTabs.classList.contains('show-both') && showBothBtn && showBothBtn.classList.contains('active')) {
        // "Show both" mode is active, hide the tab buttons container
        if (tabButtonsContainer) {
            tabButtonsContainer.style.display = 'none';
        }
    }

    // Initialize keyboard shortcuts
    initializeKeyboardShortcuts();
}

// Hide manual modal
function hideManualModal(e, preventModalReset = false) {
    const isManualModalOpen = manualModal && manualModal.style.display === 'flex';

    if (!preventModalReset || !isManualModalOpen) {
        // Handle loading overlay when modal is closed
        const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
        if (manualLoadingOverlay && !manualLoadingOverlay.classList.contains('hidden')) {
            // If manual loading overlay is visible, switch to regular loading overlay
            const loadingMessage = manualLoadingOverlay.querySelector('p')?.textContent || 'Generating your image...';
            manualLoadingOverlay.classList.add('hidden', 'return');
            showManualLoading(true, loadingMessage);
        }

        if (previewSection) {
            previewSection.classList.remove('active', 'show');
        }

        closeModal(manualModal);
        if (document.body.classList.contains('editor-open')) {
            document.body.classList.remove('editor-open');
        }
        clearManualForm();

        // Reset manual preview
        resetManualPreview();

        // Hide request type toggle row
        const requestTypeRow = document.getElementById('requestTypeRow');
        if (requestTypeRow) {
            requestTypeRow.style.display = 'none';
        }

        // Clear edit context
        window.currentEditMetadata = null;
        window.currentEditImage = null;
        window.currentRequestType = null;
        window.initialEdit = null;
        window.lastGeneration = null;

        // Reset random prompt state
        savedRandomPromptState = null;
        lastPromptState = null;

        // Reset random prompt buttons and icons
        const toggleBtn = document.getElementById('randomPromptToggleBtn');
        const refreshBtn = document.getElementById('randomPromptRefreshBtn');
        const transferBtn = document.getElementById('randomPromptTransferBtn');
        const nsfwBtn = document.getElementById('randomPromptNsfwBtn');

        if (toggleBtn) {
            toggleBtn.dataset.state = 'off';
            toggleBtn.classList.remove('active');
        }
        if (refreshBtn) {
            refreshBtn.style.display = 'none';
        }
        if (transferBtn) {
            transferBtn.style.display = 'none';
        }
        if (nsfwBtn) {
            nsfwBtn.dataset.state = 'off';
            nsfwBtn.classList.remove('active');
            nsfwBtn.style.display = 'none';
        }

        // Hide keyboard shortcuts overlay
        hideShortcutsOverlay();
    }
}

// Auto-resize textareas after modal is shown
function autoResizeTextareasAfterModalShow() {
    // Auto-resize main prompt and UC textareas
    if (manualPrompt) {
        autoResizeTextarea(manualPrompt);
    }
    if (manualUc) {
        autoResizeTextarea(manualUc);
    }

    // Auto-resize character prompt textareas
    const characterPromptItems = document.querySelectorAll('.character-prompt-item');
    characterPromptItems.forEach(item => {
        const characterId = item.id;
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);

        if (promptField) {
            autoResizeTextarea(promptField);
        }
        if (ucField) {
            autoResizeTextarea(ucField);
        }
    });
}

// Clear manual form
function clearManualForm() {
    // Clean up any existing blob URLs
    cleanupBlobUrls();

    manualForm.reset();

    manualGenerateBtn.disabled = false;

    // Reset custom dropdowns to defaults
    selectManualModel('v4_5', '');
    selectManualResolution('normal_square', 'Normal');
    selectManualSampler('k_euler_ancestral');
    selectManualNoiseScheduler('karras');

    // Reset custom resolution fields
    if (manualWidth) manualWidth.value = '';
    if (manualHeight) manualHeight.value = '';
    // Ensure manualResolutionHidden is set correctly after selectManualResolution
    if (manualResolutionHidden) manualResolutionHidden.value = 'normal_square';

    // Reset upscale toggle
    manualUpscale.setAttribute('data-state', 'off');

    // Reset paid request toggle
    forcePaidRequest = false;
    if (paidRequestToggle) {
        paidRequestToggle.setAttribute('data-state', 'off');
    }

    // Reset new parameters
    selectedDatasets = []; // Default to anime enabled
    datasetBias = {
        anime: 1.0,
        furry: 1.0,
        backgrounds: 1.0
    };
    updateDatasetDisplay();
    renderDatasetDropdown();
    renderDatasetBiasControls();

    appendQuality = true;
    if (qualityToggleBtn) {
        qualityToggleBtn.setAttribute('data-state', 'on');
    }

    autoPositionBtn.setAttribute('data-state', 'on');

    selectedUcPreset = 3; // Default to "Heavy"
    selectUcPreset(3);
    renderUcPresetsDropdown();

    // Reset preset name field
    manualPresetName.disabled = false;
    manualPresetName.style.opacity = '1';

    variationImage.src = '';

    // Reset transformation section states
    if (transformationRow) {
        transformationRow.classList.remove('display-image');
    }

    document.getElementById('manualStrengthGroup').style.display = 'none';
    document.getElementById('manualNoiseGroup').style.display = 'none';

    const transformationDropdown = document.getElementById('transformationDropdown');
    if (transformationDropdown) {
        transformationDropdown.classList.remove('disabled');
    }


    if (vibeReferencesContainer) {
        vibeReferencesContainer.style.display = 'none';
        vibeReferencesContainer.innerHTML = '';
    }
    if (transformationRow) {
        transformationRow.classList.remove('display-vibe');
    }
    if (vibeNormalizeToggle) {
        vibeNormalizeToggle.style.display = 'none';
    }

    // Clear variation context
    if (window.currentEditMetadata) {
        delete window.currentEditMetadata.sourceFilename;
        delete window.currentEditMetadata.isVariationEdit;
    }

    // Restore UI elements
    const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
    const saveButton = document.getElementById('manualSaveBtn');

    if (presetNameGroup) {
        presetNameGroup.style.display = 'block';
    }
    if (saveButton) {
        saveButton.style.display = 'inline-block';
    }

    // Clear character prompts
    clearCharacterPrompts();

    // Reset sprout seed button state
    if (sproutSeedBtn) {
        sproutSeedBtn.setAttribute('data-state', 'off');
        sproutSeedBtn.classList.remove('active');
        manualSeed.disabled = false;
    }

    // Reset inpaint button state and clear mask
    resetInpaint();
    window.strengthValueLoaded = false;
    window.uploadedImageData = null;
    // Clear any stored previous bias
    if (window.uploadedImageData) {
        delete window.uploadedImageData.previousBias;
    }
    imageBiasAdjustmentData = {
        originalImage: null,
        targetDimensions: null,
        currentBias: { x: 0, y: 0, scale: 1.0, rotate: 0 },
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        originalTransform: { x: 0, y: 0 },
        previewMode: 'css' // Default to CSS view
    };
    window.lastGeneratedSeed = null;
    manualPreviewSeedNumber.textContent = '---'

    updateAutoPositionToggle();

    // Hide image bias dropdown
    hideImageBiasDropdown();

    // Show the clear seed button
    const clearSeedBtn = document.getElementById('clearSeedBtn');
    if (clearSeedBtn) clearSeedBtn.style.display = 'inline-block';

    // Reset transformation dropdown state
    updateTransformationDropdownState(undefined, 'References');

    updateUploadDeleteButtonVisibility();

    // Hide autocomplete overlays
    hideCharacterAutocomplete();
    hidePresetAutocomplete();

    // Update save button state after clearing form
    updateSaveButtonState();

    // Update load button state after clearing form
    updateLoadButtonState();
}

// Handle manual generation
// Utility: Collect common form values
function collectManualFormValues() {
    // Ensure manualResolutionHidden has a value
    if (manualResolutionHidden && !manualResolutionHidden.value) {
        manualResolutionHidden.value = 'normal_square';
    }

    const values = {
        model: manualModel.value,
        prompt: manualPrompt.value.trim() + '',
        resolutionValue: manualResolution.value,
        uc: manualUc.value.trim() + '',
        seed: manualSeed.value.trim(),
        sampler: manualSampler.value,
        noiseScheduler: manualNoiseScheduler.value,
        steps: parseInt(manualSteps.value) || 25,
        guidance: parseFloat(manualGuidance.value) || 5.0,
        rescale: parseFloat(manualRescale.value) || 0.0,
        upscale: manualUpscale.getAttribute('data-state') === 'on',
        presetName: manualPresetName.value ? manualPresetName.value.trim() : "",
        autoPositionBtn: document.getElementById('autoPositionBtn'),
        container: characterPromptsContainer,
        characterItems: characterPromptsContainer ? characterPromptsContainer.querySelectorAll('.character-prompt-item') : [],
        characterPrompts: getCharacterPrompts()
    };

    // Handle image bias - support both legacy and dynamic bias
    const imageBiasHidden = document.getElementById('imageBias');
    if (window.uploadedImageData && window.uploadedImageData.image_bias) {
        values.image_bias = window.uploadedImageData.image_bias;
    } else if (imageBiasHidden && imageBiasHidden.value) {

        values.image_bias = parseInt(imageBiasHidden.value);
    }

    // Add new parameters
    values.dataset_config = {
        include: selectedDatasets,
        bias: {},
        settings: {}
    };

    // Add dataset settings from window.datasetSettings if available
    if (window.datasetSettings) {
        values.dataset_config.settings = window.datasetSettings;
    }

    // Add bias values for datasets with bias > 1.0
    selectedDatasets.forEach(dataset => {
        if (datasetBias[dataset] > 1.0) {
            values.dataset_config.bias[dataset] = datasetBias[dataset];
        }
    });
    values.append_quality = appendQuality;
    values.append_uc = selectedUcPreset;

    // Collect vibe transfer data
    values.vibe_transfer = collectVibeTransferData();
    values.normalize_vibes = vibeNormalizeToggle.getAttribute('data-state') === 'on';

    values.upscale = manualUpscale.getAttribute('data-state') === 'on' ? 2 : undefined;

    return values;
}

// Utility: Collect vibe transfer data from the container
function collectVibeTransferData() {
    if (!vibeReferencesContainer) return [];

    const vibeTransferItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');
    const vibeTransfers = [];

    vibeTransferItems.forEach(item => {
        const vibeId = item.getAttribute('data-vibe-id');
        const ieDropdownBtn = item.querySelector('.custom-dropdown-btn');
        const ratioInput = item.querySelector('.vibe-reference-ratio-input');

        if (vibeId && ieDropdownBtn && ratioInput) {
            const selectedIe = ieDropdownBtn.dataset.selectedIe;
            const strength = parseFloat(ratioInput.value) || 0.7;

            if (selectedIe) {
                vibeTransfers.push({
                    id: vibeId,
                    ie: selectedIe,
                    strength: strength
                });
            }
        }
    });

    return vibeTransfers;
}

// Utility: Add shared fields to request body
function addSharedFieldsToRequestBody(requestBody, values) {
    if (values.uc) requestBody.uc = values.uc;
    if (values.seed) requestBody.seed = parseInt(values.seed);

    if (values.sampler) {
        const samplerObj = getSamplerMeta(values.sampler);
        requestBody.sampler = samplerObj ? samplerObj.request : values.sampler;
    }
    if (values.noiseScheduler) {
        const noiseObj = getNoiseMeta(values.noiseScheduler);
        requestBody.noiseScheduler = noiseObj ? noiseObj.request : values.noiseScheduler;
    }

    if (values.upscale) requestBody.upscale = true;
    if (typeof varietyEnabled !== "undefined" && varietyEnabled) {
        requestBody.variety = true;
    }
    // Character prompts
    if (values.characterPrompts && values.characterPrompts.length > 0) {
        requestBody.allCharacterPrompts = values.characterPrompts;
        requestBody.use_coords = false;
        if (values.autoPositionBtn && values.autoPositionBtn.getAttribute('data-state') !== 'on') {
            if (Array.from(values.characterItems).some(item => item.dataset.positionX && item.dataset.positionY)) {
                requestBody.use_coords = true;
            }
        }
    }

    // Add new parameters
    if (values.dataset_config) {
        requestBody.dataset_config = values.dataset_config;
    }
    if (values.append_quality !== undefined) {
        requestBody.append_quality = values.append_quality;
    }
    if (values.append_uc !== undefined) {
        requestBody.append_uc = values.append_uc;
    }

    // Add vibe transfer data
    if (values.vibe_transfer && values.vibe_transfer.length > 0) {
        requestBody.vibe_transfer = values.vibe_transfer;
        requestBody.normalize_vibes = values.normalize_vibes;
    }
}

// Utility: Show image and confetti, refresh gallery, etc.
async function handleImageResult(blob, successMsg, clearContextFn, seed = null, response = null) {
    // Store the seed for manual preview
    const priceList = document.getElementById('manualPriceList');
    const cost = parseInt(priceList.textContent);
    
    if (seed !== null) {
        window.lastGeneratedSeed = seed;
        manualPreviewSeedNumber.textContent = parseInt(seed);
    }

    // Extract seed from response header if available
    if (response && response.headers) {
        const headerSeed = response.headers.get('X-Seed');
        if (headerSeed) {
            window.lastGeneratedSeed = parseInt(headerSeed);
            manualPreviewSeedNumber.textContent = parseInt(headerSeed);
        }
    }

    // Fetch metadata for the generated image if we have a filename
    if (response && response.headers) {
        const filename = response.headers.get('X-Generated-Filename');
        if (filename) {
            try {
                const metadataResponse = await fetchWithAuth(`/images/${filename}`, {
                    method: 'OPTIONS'
                });
                if (metadataResponse.ok) {
                    const metadata = await metadataResponse.json();
                    window.lastGeneration = metadata;
                    window.lastGeneration.filename = filename;
                    manualPreviewOriginalImage.classList.remove('hidden');
                }
            } catch (error) {
                console.warn('Failed to fetch metadata for generated image:', error);
            }
        }
    }

    const imageUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = async function() {
        createConfetti();

        // Check if we're in wide viewport mode and manual modal is open
        const manualModal = document.getElementById('manualModal');
        const isManualModalOpen = manualModal.style.display === 'flex';

        if (isManualModalOpen) {
            // Update manual modal preview instead of opening lightbox
            // Don't clear context when modal is open in wide viewport mode

            const imageContainer = document.querySelector('.manual-preview-image-container');
            imageContainer.classList.remove('swapped');

            await loadGallery(true);
            await updateManualPreview(imageUrl, blob, response);
            
            // Update balance and show credit deduction toast for manual generation
            await updateBalanceAndShowCreditDeduction('image generation', cost);
        } else {
            // Clear context only when modal is not open or not in wide viewport mode
            if (typeof clearContextFn === "function") clearContextFn();

            // Normal behavior - open lightbox
            setTimeout(async () => {
                await loadGallery();
                
                // Update balance and show credit deduction toast
                await updateBalanceAndShowCreditDeduction('image generation', cost);
                
                if (allImages.length > 0) {
                    const newImage = allImages[0];
                    const imageToShow = {
                        filename: newImage.upscaled || newImage.original,
                        base: newImage.base,
                        upscaled: newImage.upscaled
                    };
                    
                    showLightbox(imageToShow);
                }
            }, 1000);
        }
    };
    img.src = imageUrl;
}

// Helper function to get current balance
async function getCurrentBalance() {
    try {
        const balanceResponse = await fetchWithAuth('/balance');
        if (balanceResponse.ok) {
            const balanceData = await balanceResponse.json();
            return balanceData;
        }
    } catch (error) {
        console.warn('Failed to get current balance:', error);
    }
    return null;
}

// Helper function to update balance and show credit deduction toast with true cost calculation
async function updateBalanceAndShowCreditDeduction(operationType, estimatedCost) {
    try {
        // Get current balance
        const balanceAfter = await getCurrentBalance();
        
        if (balanceAfter !== null && currentBalance !== null) {
            const actualCost = currentBalance - balanceAfter.totalCredits;
            
            // Show credit deduction toast with actual cost
            if (actualCost > 0) {
                showGlassToast('warning', 'Transaction', `<i class="nai-anla"></i> ${actualCost} deducted for ${operationType}. New balance: <i class="nai-anla"></i> ${balanceAfter.totalCredits}`);
            }
            // Update balance display
            updateBalanceDisplay(balanceAfter);
        } else if (actualCost < 0) {
            // Fallback to estimated cost if we can't get actual cost
            showGlassToast('warning', 'Transaction', `<i class="nai-anla"></i> ${estimatedCost} deducted for ${operationType}.`);
        }
    } catch (error) {
        console.warn('Failed to update balance after operation:', error);
        // Still show the deduction toast even if balance update fails
        if (actualCost > 0) {
            showGlassToast('warning', 'Transaction', `<i class="nai-anla"></i> ${actualCost} deducted for ${operationType}.`);
        }
    }
}

// Function to update manual modal preview
async function updateManualPreview(imageUrl, blob, response = null, metadata = null) {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const seedBtn = document.getElementById('manualPreviewSeedBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');

    if (previewImage && previewPlaceholder) {
        // Show the image and hide placeholder
        previewImage.src = imageUrl;
        previewImage.style.display = 'block';
        previewPlaceholder.style.display = 'none';

        // Store the blob URL for download functionality
        previewImage.dataset.blobUrl = imageUrl;

        // Check if we have initialEdit data for side-by-side preview
        if (window.initialEdit && window.initialEdit.image) {
            // Show original image for comparison
            if (originalImage) {
                const originalImageUrl = `/images/${window.initialEdit.image.original || window.initialEdit.image.filename}`;
                originalImage.src = originalImageUrl;
                originalImage.style.display = 'block';
                
                // Add click handler to load original image into main preview
                originalImage.onclick = function() {
                    swapManualPreviewImages();
                };
                
                // Enable dual mode
                imageContainer.classList.add('dual-mode');
            }
        } else {
            // Single image mode
            if (originalImage) {
                originalImage.style.display = 'none';
            }
            imageContainer.classList.remove('dual-mode', 'original-hidden');
        }

        // Get the actual filename from response headers if available, otherwise extract from URL
        let generatedFilename = null;
        if (response && response.headers) {
            generatedFilename = response.headers.get('X-Generated-Filename');
        }

        if (!generatedFilename) {
            // Fallback: try to extract from imageUrl (for existing images)
            if (imageUrl.startsWith('/images/')) {
                generatedFilename = imageUrl.split('/').pop();
            }
        }

        // Only load gallery if we don't have allImages or if this is a newly generated image (has response)
        if (!allImages || allImages.length === 0) {
            await loadGallery();
        }

        const found = allImages.find(img => img.original === generatedFilename || img.upscaled === generatedFilename);

        if (found) {
            currentManualPreviewImage = found;

            // Use passed metadata if available, otherwise load if not already loaded
            if (metadata) {
                found.metadata = metadata;
            } else if (!found.metadata && generatedFilename) {
                try {
                    const metadataResponse = await fetchWithAuth(`/images/${generatedFilename}`, {
                        method: 'OPTIONS'
                    });
                    if (metadataResponse.ok) {
                        const metadata = await metadataResponse.json();
                        found.metadata = metadata;
                    }
                } catch (error) {
                    console.warn('Failed to load metadata for image:', error);
                }
            }
        } else if (generatedFilename) {
            // If not found in gallery, create a temporary image object for newly generated images
            const tempImage = {
                original: generatedFilename,
                base: generatedFilename,
                upscaled: null
            };
            currentManualPreviewImage = tempImage;
        } else {
            // No filename available, can't set up delete functionality
            currentManualPreviewImage = null;
        }

        // Show control buttons
        if (downloadBtn) downloadBtn.style.display = 'flex';
        if (upscaleBtn) upscaleBtn.style.display = 'flex';
        if (rerollBtn) rerollBtn.style.display = 'flex';
        if (variationBtn) variationBtn.style.display = 'flex';
        if (manualPreviewLoadBtn) manualPreviewLoadBtn.style.display = 'flex';
        
        // Show and update pin button
        if (manualPreviewPinBtn) {
            manualPreviewPinBtn.style.display = 'flex';
            if (currentManualPreviewImage) {
                const filename = currentManualPreviewImage.filename || currentManualPreviewImage.original || currentManualPreviewImage.upscaled;
                if (filename) {
                    updatePinButtonAppearance(manualPreviewPinBtn, filename);
                }
            }
        }
        
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) {
            scrapBtn.style.display = 'flex';
            // Update scrap button based on current view
            if (currentGalleryView === 'scraps') {
                scrapBtn.innerHTML = '<i class="nai-undo"></i>';
                scrapBtn.title = 'Remove from scraps';
            } else {
                scrapBtn.innerHTML = '<i class="nai-image-tool-sketch"></i>';
                scrapBtn.title = 'Move to scraps';
            }
        }
        if (seedBtn) seedBtn.style.display = 'flex';
        if (deleteBtn) deleteBtn.style.display = 'flex';

        // Initialize zoom functionality
        setTimeout(() => {
            initializeManualPreviewZoom();
        }, 100);

        // Update seed display
        if (currentManualPreviewImage && currentManualPreviewImage.metadata && currentManualPreviewImage.metadata.seed !== undefined) {
            manualPreviewSeedNumber.textContent = currentManualPreviewImage.metadata.seed;
            window.lastGeneratedSeed = currentManualPreviewImage.metadata.seed;
        } else {
            manualPreviewSeedNumber.textContent = '---';
            window.lastGeneratedSeed = null;
        }

        // Update navigation buttons
        updateManualPreviewNavigation();
    }
}

// Function to handle image swapping in manual preview
function swapManualPreviewImages() {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
    
    if (!previewImage || !originalImage || !imageContainer || !window.lastGeneration || !window.initialEdit) return;
    
    // Check if we're currently showing the original image
    if (imageContainer.classList.contains('swapped')) {
        // Switch back to generated image
        if (window.lastGeneration && window.lastGeneration.filename) {
            previewImage.src = `/images/${window.lastGeneration.filename}`;
            manualPreviewSeedNumber.textContent = window.lastGeneration.seed;
        }
        imageContainer.classList.remove('swapped');
    } else {
        // Switch to original image
        if (window.initialEdit && window.initialEdit.image) {
            const originalImageUrl = `/images/${window.initialEdit.image.upscaled || window.initialEdit.image.original}`;
            previewImage.src = originalImageUrl;
            manualPreviewSeedNumber.textContent = window.initialEdit.source.seed;
        }
        imageContainer.classList.add('swapped');
    }
}

// Function to reset manual modal preview
function resetManualPreview() {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const seedBtn = document.getElementById('manualPreviewSeedBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');

    if (previewImage && previewPlaceholder) {
        // Hide the image and show placeholder
        previewImage.style.display = 'none';
        previewImage.src = '';
        previewImage.dataset.blobUrl = '';
        previewPlaceholder.style.display = 'flex';

        // Hide original image and reset dual mode
        if (originalImage) {
            originalImage.style.display = 'none';
            originalImage.src = '';
            originalImage.onclick = null;
            originalImage.classList.add('hidden');
        }
        if (imageContainer) {
            imageContainer.classList.remove('dual-mode', 'original-hidden', 'swapped');
        }

        // Hide control buttons
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (upscaleBtn) upscaleBtn.style.display = 'none';
        if (rerollBtn) rerollBtn.style.display = 'none';
        if (variationBtn) variationBtn.style.display = 'none';
        if (manualPreviewLoadBtn) manualPreviewLoadBtn.style.display = 'none';
        if (manualPreviewPinBtn) manualPreviewPinBtn.style.display = 'none';
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) scrapBtn.style.display = 'none';
        if (seedBtn) seedBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';

        // Reset zoom functionality
        resetManualPreviewZoom();

        // Clear stored seed and current image
        window.lastGeneratedSeed = null;
        window.lastGeneration = null;
        manualPreviewSeedNumber.textContent = '---';
        currentManualPreviewImage = null;

        // Disable navigation buttons
        updateManualPreviewNavigation();
    }
}

// Function to update manual preview navigation buttons
function updateManualPreviewNavigation() {
    const prevBtn = document.getElementById('manualPreviewPrevBtn');
    const nextBtn = document.getElementById('manualPreviewNextBtn');

    if (!prevBtn || !nextBtn) return;

    // Disable both buttons if no current image or no gallery
    if (!currentManualPreviewImage || !allImages || allImages.length === 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    // Find current image index in gallery using filename comparison
    const currentFilename = currentManualPreviewImage.original || currentManualPreviewImage.filename;
    const currentIndex = allImages.findIndex(img =>
        img.original === currentFilename ||
        img.upscaled === currentFilename
    );

    if (currentIndex === -1) {
        // Current image not found in gallery, disable both buttons
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    // Enable/disable buttons based on position
    prevBtn.disabled = currentIndex === 0; // Disable if first image
    nextBtn.disabled = currentIndex === allImages.length - 1; // Disable if last image
}

// Function to navigate manual preview
async function navigateManualPreview(event) {
    const direction = event.currentTarget.id === 'manualPreviewPrevBtn' ? -1 : 1;

    if (!currentManualPreviewImage || !allImages || allImages.length === 0) return;

    // Find current image index in gallery using filename comparison
    const currentFilename = currentManualPreviewImage.original || currentManualPreviewImage.filename;
    const currentIndex = allImages.findIndex(img =>
        img.original === currentFilename ||
        img.upscaled === currentFilename
    );

    if (currentIndex === -1) return;

    // Calculate new index
    const newIndex = currentIndex + direction;

    // Check bounds
    if (newIndex < 0 || newIndex >= allImages.length) return;

    // Get the new image
    const newImage = allImages[newIndex];

    // Load the new image and its metadata
    try {
        const metadataResponse = await fetchWithAuth(`/images/${newImage.original}`, {
            method: 'OPTIONS'
        });
        if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            newImage.metadata = metadata;
        }
    } catch (error) {
        console.warn('Failed to load metadata for navigation image:', error);
    }

    // Update the preview with the new image and metadata
    const imageUrl = `/images/${newImage.original}`;
    updateManualPreview(imageUrl, null, null, newImage.metadata);
    
    const imageContainer = document.querySelector('.manual-preview-image-container');
    imageContainer.classList.add('swapped');
}

async function handleManualGeneration(e) {
    e.preventDefault();

    manualGenerateBtn.disabled = true;

    const isImg2Img = window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.isVariationEdit);
    const values = collectManualFormValues();

    // Helper: Validate required fields
    function validateFields(requiredFields, msg) {
        for (const field of requiredFields) {
            if (!values[field]) {
                showError(msg);
                return false;
            }
        }
        return true;
    }

    // Helper: Get processed resolution
    function getResolution(resolutionValue) {
        const resolutionData = processResolutionValue(resolutionValue);
        return resolutionData.isCustom ? `${resolutionData.width}x${resolutionData.height}` : resolutionData.resolution;
    }

    if (isImg2Img) {
        // Img2Img / Variation Edit/Reroll
        if (!validateFields(['model', 'prompt', 'resolutionValue'], 'Please fill in all required fields (Model, Prompt, Resolution)')) return;
        const resolution = getResolution(values.resolutionValue);

        // Prepare requestBody
        const requestBody = {
            strength: parseFloat(manualStrengthValue.value) || 0.8,
            noise: parseFloat(manualNoiseValue.value) || 0.1,
            prompt: values.prompt,
            resolution: resolution,
            steps: values.steps,
            guidance: values.guidance,
            rescale: values.rescale,
            allow_paid: forcePaidRequest,
            workspace: activeWorkspace
        };

        // Handle uploaded image data
        if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            requestBody.image = window.uploadedImageData.image_source;
        } else if (window.currentEditMetadata && window.currentEditMetadata.sourceFilename) {
            requestBody.image = `file:${window.currentEditMetadata.sourceFilename}`;
        }
        requestBody.image_bias = window.uploadedImageData.image_bias || window.uploadedImageData.bias;

        if (!requestBody.image) {
            showError('No source image found for variation');
            return;
        }

        // Add mask data if it exists
        if (window.currentMaskCompressed) {
            requestBody.mask_compressed = window.currentMaskCompressed.replace('data:image/png;base64,', '');
        } else if (window.currentMaskData) {
            // Add compressed mask for server processing
            const compressedMask = saveMaskCompressed();
            if (compressedMask) {
                requestBody.mask_compressed = compressedMask.replace('data:image/png;base64,', '');
            }
        }

        addSharedFieldsToRequestBody(requestBody, values);

        // Add preset name if available
        if (values.presetName) requestBody.preset = values.presetName;

        // Check if this requires paid credits and user hasn't already allowed paid
        if (requiresPaidCredits(requestBody) && !forcePaidRequest) {
            const cost = calculateCreditCost(requestBody);
            const confirmed = await showCreditCostDialog(cost, e);
            
            if (!confirmed) {
                manualGenerateBtn.disabled = false;
                return;
            }
            
            // Set allow_paid to true for this request only (don't change UI)
            requestBody.allow_paid = true;
        }

        hideManualModal(undefined, true);
        showManualLoading(true, 'Generating Image...');

        try {
            const url = `/${values.model.toLowerCase()}/generate`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) throw new Error(`Variation generation failed: ${response.statusText}`);
            const blob = await response.blob();
            await handleImageResult(blob, 'Variation generated successfully!', () => { }, values.seed, response);
        } catch (error) {
            hideManualModal(undefined, true);
            console.error('Variation generation error:', error);
            showError('Variation generation failed. Please try again.');
        } finally {
            showManualLoading(false);
            manualGenerateBtn.disabled = false;
        }
    } else {
        // Regular manual generation or reroll
        if (!validateFields(['model', 'prompt', 'resolutionValue'], 'Please fill in all required fields (Model, Prompt, Resolution)')) return;
        const resolution = getResolution(values.resolutionValue);

        const requestBody = {
            prompt: values.prompt,
            resolution: resolution,
            steps: values.steps,
            guidance: values.guidance,
            rescale: values.rescale,
            allow_paid: forcePaidRequest,
            workspace: activeWorkspace
        };
        if (values.presetName) requestBody.preset = values.presetName;

        addSharedFieldsToRequestBody(requestBody, values);
    
        // Check if this requires paid credits and user hasn't already allowed paid
        if (requiresPaidCredits(requestBody) && !forcePaidRequest) {
            const cost = calculateCreditCost(requestBody);
            const confirmed = await showCreditCostDialog(cost, e);
            
            if (!confirmed) {
                manualGenerateBtn.disabled = false;
                return;
            }
            
            // Set allow_paid to true for this request only (don't change UI)
            requestBody.allow_paid = true;
        }

        showManualLoading(true, 'Generating Image...');

        hideManualModal(undefined, true);
        
        try {
            const url = `/${values.model.toLowerCase()}/generate`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) throw new Error(`Generation failed: ${response.statusText}`);
            const blob = await response.blob();
            await handleImageResult(blob, 'Image generated successfully!', undefined, values.seed, response);
        } catch (error) {
            hideManualModal(undefined, true);
            console.error('Manual generation error:', error);
            showError('Image generation failed. Please try again.');
        } finally {
            showManualLoading(false);
            manualGenerateBtn.disabled = false;
        }
    }
}

// Save manual preset (this would need a backend endpoint)
async function saveManualPreset(presetName, config) {
    try {
        let response;
        response = await fetchWithAuth(`/preset/${presetName}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...config
            })
        });

        if (response.ok) {
            const result = await response.json();
            showGlassToast('success', null, result.message);

            // Refresh the preset list
            await loadOptions();

            // Select the newly saved preset
            presetSelect.value = presetName;
            updateGenerateButton();

            // Close the manual modal
            hideManualModal(undefined, true);
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save preset');
        }
    } catch (error) {
        console.error('Error saving preset:', error);
        showError('Failed to save preset: ' + error.message);
    }
}

// Handle manual save button
async function handleManualSave() {
    const presetName = manualPresetName.value.trim();
    if (!presetName) {
        showError('Please enter a preset name to save');
        return;
    }

    // Validate required fields
    const model = manualModel.value;
    const prompt = manualPrompt.value.trim();

    if (!model || !prompt) {
        showError('Please fill in all required fields (Model, Prompt)');
        return;
    }

    // Build preset data with all available parameters
    const presetData = {
        prompt: prompt,
        uc: manualUc.value.trim(),
        model: model,
        resolution: manualResolution.value,
        steps: parseInt(manualSteps.value) || 25,
        guidance: parseFloat(manualGuidance.value) || 5.0,
        rescale: parseFloat(manualRescale.value) || 0.0,
        upscale: manualUpscale.getAttribute('data-state') === 'on',
        allow_paid: forcePaidRequest,
        characterPrompts: getCharacterPrompts()
    };

    // Set auto position button state
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    presetData.use_coords = autoPositionBtn.getAttribute('data-state') === 'off';

    // Add variety setting if enabled
    if (typeof varietyEnabled !== "undefined" && varietyEnabled) {
        presetData.variety = true;
    }

    // Add optional fields if they have values
    if (manualSeed.value.trim()) {
        presetData.seed = parseInt(manualSeed.value);
    }

    if (manualSampler.value) {
        const samplerObj = getSamplerMeta(manualSampler.value);
        presetData.sampler = samplerObj ? samplerObj.request : manualSampler.value;
    }

    if (manualNoiseScheduler.value) {
        const noiseObj = getNoiseMeta(manualNoiseScheduler.value);
        presetData.noiseScheduler = noiseObj ? noiseObj.request : manualNoiseScheduler.value;
    }

    // Add custom dimensions if resolution is custom
    if (manualResolution.value === 'custom') {
        if (customWidth && customHeight) {
            presetData.width = parseInt(customWidth.value) || undefined;
            presetData.height = parseInt(customHeight.value) || undefined;
        }
    }

    // Check if this is an img2img with base image
    if (window.uploadedImageData && window.uploadedImageData.image_source) {
        // Add image source in the correct format type:value
        presetData.image_source = window.uploadedImageData.image_source;

        presetData.strength = parseFloat(manualStrengthValue.value) || 0.8;
        presetData.noise = parseFloat(manualNoiseValue.value) || 0.1;

        // Add image bias if available
        const imageBiasHidden = document.getElementById('manualImageBias');
        if (window.uploadedImageData && window.uploadedImageData.image_bias) {
            presetData.image_bias = window.uploadedImageData.image_bias;
        } else if (imageBiasHidden && imageBiasHidden.value) {
            presetData.image_bias = parseInt(imageBiasHidden.value);
        }
    }

    // Include mask data if it exists
    if (window.currentMaskCompressed) {
        presetData.mask_compressed = window.currentMaskCompressed.replace('data:image/png;base64,', '');
    } else if (window.currentMaskData) {
        const maskCompressed = saveMaskCompressed();
        presetData.mask_compressed = maskCompressed.replace('data:image/png;base64,', '');
    }

    // Add new parameters to preset data
    presetData.dataset_config = {
        include: selectedDatasets,
        bias: {},
        settings: {}
    };

    // Add dataset settings from window.datasetSettings if available
    if (window.datasetSettings) {
        presetData.dataset_config.settings = window.datasetSettings;
    }

    // Add bias values for datasets with bias > 1.0
    selectedDatasets.forEach(dataset => {
        if (datasetBias[dataset] > 1.0) {
            presetData.dataset_config.bias[dataset] = datasetBias[dataset];
        }
    });
    presetData.append_quality = appendQuality;
    presetData.append_uc = selectedUcPreset;

    await saveManualPreset(presetName, presetData);
}

// Preset autocomplete functions
function handlePresetAutocompleteInput(e) {
    const target = e.target;
    const value = target.value;

    // Clear existing timeout
    if (presetAutocompleteTimeout) {
        clearTimeout(presetAutocompleteTimeout);
    }

    // Set timeout to search after user stops typing
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
                e.preventDefault();
                selectedPresetAutocompleteIndex = Math.min(selectedPresetAutocompleteIndex + 1, items.length - 1);
                updatePresetAutocompleteSelection();
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedPresetAutocompleteIndex = Math.max(selectedPresetAutocompleteIndex - 1, -1);
                updatePresetAutocompleteSelection();
                break;
            case 'Enter':
                e.preventDefault();
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
        const response = await fetchWithAuth(`/preset/search?q=${encodeURIComponent(query)}`);

        if (!response.ok) {
            throw new Error('Failed to search presets');
        }

        const presetResults = await response.json();
        presetSearchResults = presetResults;

        if (presetResults.length > 0) {
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

    // Populate preset autocomplete list
    presetAutocompleteList.innerHTML = '';
    results.forEach((result, index) => {
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

    // Determine size class based on number of results
    presetAutocompleteOverlay.classList.remove('size-small', 'size-medium', 'size-large');
    if (results.length <= 3) {
        presetAutocompleteOverlay.classList.add('size-small');
    } else if (results.length <= 8) {
        presetAutocompleteOverlay.classList.add('size-medium');
    } else {
        presetAutocompleteOverlay.classList.add('size-large');
    }

    // Position overlay relative to viewport
    const rect = target.getBoundingClientRect();
    const overlayHeight = Math.min(400, window.innerHeight * 0.5);
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    presetAutocompleteOverlay.style.left = rect.left + 'px';
    presetAutocompleteOverlay.style.width = rect.width + 'px';

    // Check if there's enough space above, otherwise show below
    if (spaceAbove >= overlayHeight) {
        // Position above
        presetAutocompleteOverlay.style.top = (rect.top - 5) + 'px';
        presetAutocompleteOverlay.style.transform = 'translateY(-100%)';
        presetAutocompleteOverlay.style.maxHeight = overlayHeight + 'px';
    } else {
        // Position below if not enough space above
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

    // Scroll the selected item into view
    if (selectedPresetAutocompleteIndex >= 0 && items[selectedPresetAutocompleteIndex]) {
        const selectedItem = items[selectedPresetAutocompleteIndex];
        selectedItem.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    }
}

// Update generate button state
function updateGenerateButton() {
    const selectedValue = presetSelect.value;

    if (!selectedValue) {
        generateBtn.disabled = true;
        return;
    }

    if (selectedValue.startsWith('preset:')) {
        generateBtn.disabled = false;
    } else {
        generateBtn.disabled = true;
    }   
}

// Generate image
async function generateImage(event = null) {
    const selectedValue = presetSelect.value;
    if (!selectedValue) {
        showError('Please select a preset');
        return;
    }

    if (!selectedValue.startsWith('preset:')) {
        showError('Invalid selection');
        return;
    }

    // Check if this preset requires paid credits and show confirmation dialog
    const presetName = selectedValue.replace('preset:', '');
    
    // For now, we'll check if the preset requires paid credits by looking at the preset data
    // This is a simplified approach - in a real implementation, you'd want to check the actual preset configuration
    const requiresPaid = false; // This would be determined by the preset configuration

    const cost = parseInt(document.getElementById('manualPriceList').textContent); // Default cost for preset generation
    if (requiresPaid && !forcePaidRequest) {
        const confirmed = await showCreditCostDialog(cost, event);
        
        if (!confirmed) {
            return;
        }
    }

    // Check if we're in a modal context
    const isInModal = document.getElementById('manualModal').style.display === 'block';
    
    let toastId;
    let progressInterval;
    
    if (!isInModal) {
        // Use glass toast with progress when not in modal
        toastId = showGlassToast('info', 'Generating Image', 'Generating image...', true);
        
        // Start progress animation (1% per second)
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += 1;
            updateGlassToastProgress(toastId, progress);
        }, 1000);
    } else {
        // Use existing modal loading overlay when in modal
        showManualLoading(true, 'Generating image...');
    }

    try {
        let url;
        if (selectedValue.startsWith('preset:')) {
            const params = new URLSearchParams({ forceGenerate: 'true' });
            if (activeWorkspace) params.append('workspace', activeWorkspace);

            url = `/preset/${selectedValue.replace('preset:', '')}?${params.toString()}`;
        } else {
            throw new Error('Invalid selection type');
        }

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Generation failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);

        // Get the generated filename from the response header
        const generatedFilename = response.headers.get('X-Generated-Filename');
        if (!generatedFilename) {
            showError('No generated filename returned by server.');
            return;
        }

        // Extract seed from response header if available
        const headerSeed = response.headers.get('X-Seed');
        if (headerSeed) {
            window.lastGeneratedSeed = parseInt(headerSeed);
            manualPreviewSeedNumber.textContent = parseInt(headerSeed);
        }

        // Fetch metadata for the generated image
        try {
            const metadataResponse = await fetchWithAuth(`/images/${generatedFilename}`, {
                method: 'OPTIONS'
            });
            if (metadataResponse.ok) {
                const metadata = await metadataResponse.json();
                window.lastGeneration = metadata;
                window.lastGeneration.filename = generatedFilename;
                manualPreviewOriginalImage.classList.remove('hidden');
            }
        } catch (error) {
            console.warn('Failed to fetch metadata for generated image:', error);
        }
        
        // Wait for the image to load, then insert into gallery and reindex
        const img = new Image();
        img.onload = async function() {
            createConfetti();

            await loadGallery();

            // Update balance and show credit deduction toast
            await updateBalanceAndShowCreditDeduction('image generation', cost);

            // Find the image in the gallery by filename
            const found = allImages.find(img => img.original === generatedFilename || img.upscaled === generatedFilename);
            if (found) {
                // Construct proper image object with filename property
                const imageToShow = {
                    filename: generatedFilename,
                    base: found.base,
                    original: found.original,
                    upscaled: found.upscaled
                };
                showLightbox(imageToShow);
            } else {
                showError('Generated image not found in gallery.');
            }
        };
        img.src = imageUrl;

        // Show success message
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToastProgress(toastId, 100);
            updateGlassToast(toastId, 'success', 'Generation Complete', 'Image generated successfully!');
        } else {
            showGlassToast('success', 'Generation Complete', 'Image generated successfully!');
            const imageContainer = document.querySelector('.manual-preview-image-container');
            imageContainer.classList.remove('swapped');
        }

    } catch (error) {
        console.error('Generation error:', error);
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToast(toastId, 'error', 'Generation Failed', 'Image generation failed. Please try again.');
        } else {
            showError('Image generation failed. Please try again.');
        }
    } finally {
        if (isInModal) {
            showManualLoading(false);
        }
    }
}

// Manual preview zoom and pan functionality
let manualPreviewZoom = 1;
let manualPreviewPanX = 0;
let manualPreviewPanY = 0;
let isManualPreviewDragging = false;
let lastManualPreviewMouseX = 0;
let lastManualPreviewMouseY = 0;
let lastManualPreviewTouchDistance = 0;

function initializeManualPreviewZoom() {
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const image = document.getElementById('manualPreviewImage');

    if (!imageContainer || !image) return;

    // Reset zoom and pan
    resetManualPreviewZoom();

    // Mouse wheel zoom
    imageContainer.addEventListener('wheel', handleManualPreviewWheelZoom, { passive: false });

    // Mouse drag pan
    imageContainer.addEventListener('mousedown', handleManualPreviewMouseDown);
    imageContainer.addEventListener('mousemove', handleManualPreviewMouseMove);
    imageContainer.addEventListener('mouseup', handleManualPreviewMouseUp);
    imageContainer.addEventListener('mouseleave', handleManualPreviewMouseUp);

    // Touch zoom and pan
    imageContainer.addEventListener('touchstart', handleManualPreviewTouchStart, { passive: false });
    imageContainer.addEventListener('touchmove', handleManualPreviewTouchMove, { passive: false });
    imageContainer.addEventListener('touchend', handleManualPreviewTouchEnd);

    // Double click to reset zoom
    imageContainer.addEventListener('dblclick', resetManualPreviewZoom);
}

function resetManualPreviewZoom() {
    manualPreviewZoom = 1;
    manualPreviewPanX = 0;
    manualPreviewPanY = 0;
    updateManualPreviewImageTransform();

    const imageContainer = document.querySelector('.manual-preview-image-container');
    if (imageContainer) {
        imageContainer.classList.remove('zoomed');
        
        // Restore original image visibility when zoom is reset
        const originalImage = document.getElementById('manualPreviewOriginalImage');
        if (originalImage && imageContainer.classList.contains('dual-mode')) {
            originalImage.style.display = 'block';
        }
    }
}

function updateManualPreviewImageTransform() {
    const image = document.getElementById('manualPreviewImage');
    if (image) {
        image.style.transform = `translate(${manualPreviewPanX}px, ${manualPreviewPanY}px) scale(${manualPreviewZoom})`;
    }
}

function handleManualPreviewWheelZoom(e) {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(1, Math.min(5, manualPreviewZoom * delta));

    // If zooming out to original size, reset pan to center
    if (newZoom <= 1 && manualPreviewZoom > 1) {
        manualPreviewPanX = 0;
        manualPreviewPanY = 0;
    } else {
        // Zoom towards mouse position only when zooming in or when already zoomed
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomChange = newZoom / manualPreviewZoom;
        manualPreviewPanX = mouseX - (mouseX - manualPreviewPanX) * zoomChange;
        manualPreviewPanY = mouseY - (mouseY - manualPreviewPanY) * zoomChange;
    }

    manualPreviewZoom = newZoom;
    updateManualPreviewImageTransform();

    const imageContainer = document.querySelector('.manual-preview-image-container');
    if (imageContainer) {
        imageContainer.classList.toggle('zoomed', manualPreviewZoom > 1);
        
        // Hide original image when zoomed
        const originalImage = document.getElementById('manualPreviewOriginalImage');
        if (originalImage && imageContainer.classList.contains('dual-mode')) {
            if (manualPreviewZoom > 1) {
                originalImage.style.display = 'none';
            } else {
                originalImage.style.display = 'block';
            }
        }
    }
}

function handleManualPreviewMouseDown(e) {
    if (manualPreviewZoom > 1) {
        isManualPreviewDragging = true;
        lastManualPreviewMouseX = e.clientX;
        lastManualPreviewMouseY = e.clientY;
        e.preventDefault();
    }
}

function handleManualPreviewMouseMove(e) {
    if (isManualPreviewDragging && manualPreviewZoom > 1) {
        const deltaX = e.clientX - lastManualPreviewMouseX;
        const deltaY = e.clientY - lastManualPreviewMouseY;

        manualPreviewPanX += deltaX;
        manualPreviewPanY += deltaY;

        lastManualPreviewMouseX = e.clientX;
        lastManualPreviewMouseY = e.clientY;

        updateManualPreviewImageTransform();
        e.preventDefault();
    }
}

function handleManualPreviewMouseUp() {
    isManualPreviewDragging = false;
}

function handleManualPreviewTouchStart(e) {
    if (e.touches.length === 1) {
        // Single touch - start pan
        isManualPreviewDragging = true;
        lastManualPreviewMouseX = e.touches[0].clientX;
        lastManualPreviewMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        // Two touches - start pinch zoom
        lastManualPreviewTouchDistance = getTouchDistance(e.touches);
    }
}

function handleManualPreviewTouchMove(e) {
    if (e.touches.length === 1 && isManualPreviewDragging && manualPreviewZoom > 1) {
        // Single touch pan
        const deltaX = e.touches[0].clientX - lastManualPreviewMouseX;
        const deltaY = e.touches[0].clientY - lastManualPreviewMouseY;

        manualPreviewPanX += deltaX;
        manualPreviewPanY += deltaY;

        lastManualPreviewMouseX = e.touches[0].clientX;
        lastManualPreviewMouseY = e.touches[0].clientY;

        updateManualPreviewImageTransform();
        e.preventDefault();
    } else if (e.touches.length === 2) {
        // Two touch pinch zoom
        const currentDistance = getTouchDistance(e.touches);
        const delta = currentDistance / lastManualPreviewTouchDistance;

        const newZoom = Math.max(1, Math.min(5, manualPreviewZoom * delta));

        // If zooming out to original size, reset pan to center
        if (newZoom <= 1 && manualPreviewZoom > 1) {
            manualPreviewPanX = 0;
            manualPreviewPanY = 0;
        } else {
            // Zoom towards center of touches only when zooming in or when already zoomed
            const rect = e.currentTarget.getBoundingClientRect();
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            const zoomChange = newZoom / manualPreviewZoom;
            manualPreviewPanX = centerX - (centerX - manualPreviewPanX) * zoomChange;
            manualPreviewPanY = centerY - (centerY - manualPreviewPanY) * zoomChange;
        }

        manualPreviewZoom = newZoom;
        lastManualPreviewTouchDistance = currentDistance;

        updateManualPreviewImageTransform();

        const imageContainer = document.querySelector('.manual-preview-image-container');
        if (imageContainer) {
            imageContainer.classList.toggle('zoomed', manualPreviewZoom > 1);
            
            // Hide original image when zoomed
            const originalImage = document.getElementById('manualPreviewOriginalImage');
            if (originalImage && imageContainer.classList.contains('dual-mode')) {
                if (manualPreviewZoom > 1) {
                    originalImage.style.display = 'none';
                } else {
                    originalImage.style.display = 'block';
                }
            }
        }

        e.preventDefault();
    }
}

function handleManualPreviewTouchEnd(e) {
    if (e.touches.length === 0) {
        isManualPreviewDragging = false;
        lastManualPreviewTouchDistance = 0;
    }
}

// Download image
function downloadImage(image) {
    let filename, url;

    // Handle different image object structures
    if (image.url) {
        // For newly generated images (lightbox)
        url = image.url;
        filename = image.filename;
    } else if (image.upscaled || image.original) {
        // For gallery images - prefer highest quality version
        if (image.upscaled) {
            filename = image.upscaled;
        } else {
            filename = image.original;
        }
        url = null; // Will use server endpoint
    } else {
        // Fallback - assume it's a filename string
        filename = image;
        url = null;
    }

    if (url) {
        // For newly generated images
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
    } else {
        // For existing images
        const link = document.createElement('a');
        link.href = `/images/${filename}?download=true`;
        link.download = filename;
        link.click();
    }
}

// Delete image
async function deleteImage(image, event = null) {
    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        'Are you sure you want to delete this image? This will permanently delete both the original and upscaled versions.',
        'Delete',
        'Cancel',
        event
    );
    
    if (!confirmed) {
        return;
    }

    try {
        // Determine which filename to use for deletion
        let filenameToDelete = null;

        // For regular images, prioritize original, then upscaled
        if (image.original) {
            filenameToDelete = image.original;
        } else if (image.upscaled) {
            filenameToDelete = image.upscaled;
        }

        if (!filenameToDelete) {
            throw new Error('No filename available for deletion');
        }


        // Send delete request
        const response = await fetchWithAuth(`/images/${filenameToDelete}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`Delete failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            showGlassToast('success', null, 'Image deleted!');

            // Close lightbox
            hideLightbox();

            // Remove image from gallery and add placeholder
            removeImageFromGallery(image);
        } else {
            throw new Error(result.error || 'Delete failed');
        }

    } catch (error) {
        console.error('Delete error:', error);
        showError('Failed to delete image: ' + error.message);
    }
}

async function deleteManualPreviewImage() {
    if (!currentManualPreviewImage) {
        showError('No image to delete');
        return;
    }

    try {
        // Determine which filename to use for deletion
        let filenameToDelete = null;

        // For regular images, prioritize original, then upscaled
        if (currentManualPreviewImage.original) {
            filenameToDelete = currentManualPreviewImage.original;
        } else if (currentManualPreviewImage.upscaled) {
            filenameToDelete = currentManualPreviewImage.upscaled;
        }

        if (!filenameToDelete) {
            throw new Error('No filename available for deletion');
        }

        // Send delete request
        const response = await fetchWithAuth(`/images/${filenameToDelete}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`Delete failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {

            // Find the current image index in the manual preview image list
            const currentIndex = allImages.findIndex(img =>
                img.original === currentManualPreviewImage.original ||
                img.upscaled === currentManualPreviewImage.upscaled
            );

            // Remove the current image from the manual preview list
            if (currentIndex !== -1) {
                allImages.splice(currentIndex, 1);
            }

            // Find the next (previous) image in the manual preview list
            let nextImage = null;
            const nextIndex = currentIndex >= allImages.length ? allImages.length - 1 : currentIndex;

            if (nextIndex >= 0 && nextIndex < allImages.length) {
                nextImage = allImages[nextIndex];
            }

            if (nextImage) {
                // Load the next image and its metadata
                try {
                    const metadataResponse = await fetchWithAuth(`/images/${nextImage.original}`, {
                        method: 'OPTIONS',
                    });
                    if (metadataResponse.ok) {
                        const metadata = await metadataResponse.json();
                        nextImage.metadata = metadata;
                    }
                } catch (error) {
                    console.warn('Failed to load metadata for next image:', error);
                }

                // Update the preview with the next image
                const imageUrl = `/images/${nextImage.original}`;
                updateManualPreview(imageUrl);

                showGlassToast('success', null, 'Image deleted');
            } else {
                // No next image, reset the preview
                resetManualPreview();
                showGlassToast('success', null, 'Image deleted');
            }
        } else {
            throw new Error(result.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showError('Failed to delete image: ' + error.message);
    }

    // Refresh gallery after processing is complete
    loadGallery(true);
}

// Create confetti effect
function createConfetti() {
    const colors = ['#ff4500', '#ff6347', '#ff8c00', '#ffa500', '#ff6b35', '#ff7f50', '#ff4500', '#ff6347'];
    const shapes = ['rect', 'circle', 'triangle'];

    // Increase the number of confetti pieces for more intensity
    const totalPieces = 150;

    for (let i = 0; i < totalPieces; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';

            // Random position across the entire screen width
            confetti.style.left = Math.random() * 100 + 'vw';

            // Random color
            const color = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.backgroundColor = color;

            // Random size between 4px and 12px
            const size = Math.random() * 8 + 4;
            confetti.style.width = size + 'px';
            confetti.style.height = size + 'px';

            // Random shape
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            if (shape === 'circle') {
                confetti.style.borderRadius = '50%';
            } else if (shape === 'triangle') {
                confetti.style.width = '0';
                confetti.style.height = '0';
                confetti.style.backgroundColor = 'transparent';
                confetti.style.borderLeft = (size/2) + 'px solid transparent';
                confetti.style.borderRight = (size/2) + 'px solid transparent';
                confetti.style.borderBottom = size + 'px solid ' + color;
            }

            // Random rotation
            confetti.style.transform = `rotate(${Math.random() * 360}deg)`;

            // Random animation duration and delay for more natural movement
            const duration = 2.5 + Math.random() * 2; // 2.5 to 4.5 seconds
            const delay = Math.random() * 0.5; // 0 to 0.5 seconds delay
            confetti.style.animationDuration = duration + 's';
            confetti.style.animationDelay = delay + 's';

            // Add some confetti with different starting positions for more spread
            if (i % 3 === 0) {
                confetti.style.left = (Math.random() * 20 - 10) + 'vw'; // Start from left edge
            } else if (i % 3 === 1) {
                confetti.style.left = (80 + Math.random() * 20) + 'vw'; // Start from right edge
            }

            confettiContainer.appendChild(confetti);

            // Remove confetti after animation
            setTimeout(() => {
                if (confetti.parentNode) {
                    confetti.parentNode.removeChild(confetti);
                }
            }, (duration + delay) * 1000 + 1000); // Extra 1 second buffer
        }, i * 20); // Reduced delay between pieces for more density
    }
}

// Show manual modal loading overlay
function showManualLoading(show, message = 'Generating Image...') {
    // Check if manual modal is open and screen is wide enough for preview section
    const isManualModalOpen = manualModal.style.display !== 'none';

    // Use manual loading overlay for wide screens with modal open
    if (isManualModalOpen) {
        manualLoadingOverlay.classList.remove('hidden');
        if (previewSection && window.innerWidth <= 1400) {
            if (!previewSection.classList.contains('show')) {
                previewSection.classList.add('show');
                setTimeout(() => { previewSection.classList.add('active'); }, 1);
            }
        }
        // Update the loading message
        const loadingText = manualLoadingOverlay.querySelector('p');
        if (loadingText) {
            loadingText.textContent = message;
        }
        if (show) {
            requestAnimationFrame(() => {
                manualLoadingOverlay.classList.remove('return');
            });
        } else {
            requestAnimationFrame(() => {
                manualLoadingOverlay.classList.add('return');
            });
        }
    } else if (show) {
        previewSection.classList.remove('active', 'show');
        // Fall back to regular loading overlay for narrow screens or when modal is closed
        loadingOverlay.classList.remove('hidden');
        // Update the loading message
        const loadingText = loadingOverlay.querySelector('p');
        if (loadingText) {
            loadingText.textContent = message;
        }
        requestAnimationFrame(() => {
            loadingOverlay.classList.remove('return');
        });
    } else {
        previewSection.classList.remove('active', 'show');
        // Hide both overlays
        if (manualLoadingOverlay) {
            requestAnimationFrame(() => {
                manualLoadingOverlay.classList.add('hidden', 'return');
            });
        }
        requestAnimationFrame(() => {
            loadingOverlay.classList.add('return');
        });
        setTimeout(() => {
            requestAnimationFrame(() => {
                loadingOverlay.classList.add('hidden');
            });
        }, 1000);
    }
}

// Show error message (simple glass toast)
function showError(message) {
    showGlassToast('error', null, message);
}

// Error Sub-Header Functions
let errorSubHeaderTimeout = null;

function showErrorSubHeader(message, type = 'error', duration = 0) {
    const errorSubHeader = document.getElementById('errorSubHeader');
    const errorIcon = errorSubHeader.querySelector('.error-sub-header-icon');
    const errorText = errorSubHeader.querySelector('.error-sub-header-text');
    const closeBtn = errorSubHeader.querySelector('.error-sub-header-close');
    
    if (!errorSubHeader || !errorIcon || !errorText) return;
    
    // Set icon based on type
    switch (type) {
        case 'login':
            errorIcon.className = 'fas fa-user-lock';
            break;
        case 'ban':
            errorIcon.className = 'fas fa-ban';
            break;
        case 'auth':
            errorIcon.className = 'fas fa-shield-alt';
            break;
        case 'warning':
            errorIcon.className = 'fas fa-exclamation-triangle';
            break;
        default:
            errorIcon.className = 'fas fa-exclamation-circle';
    }
    
    // Set message
    errorText.textContent = message;
    
    // Show the sub-header
    errorSubHeader.classList.remove('hidden');
    errorSubHeader.classList.add('show');
    document.body.classList.add('error-sub-header-active');
    
    // Clear existing timeout
    if (errorSubHeaderTimeout) {
        clearTimeout(errorSubHeaderTimeout);
    }
    
    // Auto-hide after duration (unless it's 0 for permanent)
    if (duration > 0) {
        errorSubHeaderTimeout = setTimeout(() => {
            hideErrorSubHeader();
        }, duration);
    }
    
    // Setup close button event listener
    closeBtn.onclick = hideErrorSubHeader;
}

function hideErrorSubHeader() {
    const errorSubHeader = document.getElementById('errorSubHeader');
    if (!errorSubHeader) return;
    
    errorSubHeader.classList.remove('show');
    document.body.classList.remove('error-sub-header-active');
    
    // Hide after animation completes
    setTimeout(() => {
        errorSubHeader.classList.add('hidden');
    }, 300);
    
    // Clear timeout
    if (errorSubHeaderTimeout) {
        clearTimeout(errorSubHeaderTimeout);
        errorSubHeaderTimeout = null;
    }
}

// Enhanced error handling for authentication issues
function handleAuthError(error, context = '') {
    console.error(`Authentication error in ${context}:`, error);
    
    let message = 'Authentication error occurred';
    let type = 'auth';
    
    if (error.message) {
        if (error.message.includes('login') || error.message.includes('PIN')) {
            message = 'Login failed. Please check your credentials.';
            type = 'login';
        } else if (error.message.includes('ban') || error.message.includes('suspended')) {
            message = 'Account access restricted. Please contact support.';
            type = 'ban';
        } else if (error.message.includes('unauthorized') || error.message.includes('forbidden')) {
            message = 'Access denied. Please log in again.';
            type = 'auth';
        } else {
            message = error.message;
        }
    }
    
    showErrorSubHeader(message, type, 15000);
}

// Enhanced fetchWithAuth with error sub-header support
async function fetchWithAuth(url, options = {}) {
    try {
        const response = await fetch(url, options);
        
        // Handle authentication errors
        if (response.status === 401) {
            handleAuthError(new Error('Unauthorized access'), 'fetchWithAuth');
            throw new Error('Authentication required');
        } else if (response.status === 403) {
            handleAuthError(new Error('Access forbidden'), 'fetchWithAuth');
            throw new Error('Access denied');
        }
        
        return response;
    } catch (error) {
        // Handle network or other errors
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showErrorSubHeader('Network connection error. Please check your internet connection.', 'warning', 8000);
        } else if (error.message.includes('Authentication required') || error.message.includes('Access denied')) {
            // Already handled above
        } else {
            console.error('Fetch error:', error);
        }
        throw error;
    }
}

let resizeTimeout = null;
// Debounced resize handler
async function handleResize() {
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }

    resizeTimeout = setTimeout(() => {
        // Recalculate rows based on new viewport dimensions
        const newRows = calculateGalleryRows();
        const newImagesPerPage = galleryColumnsInput.value * newRows;

        // Only update if the number of images per page has changed
        if (newImagesPerPage !== imagesPerPage || newRows !== galleryRows) {
            galleryRows = newRows;
            imagesPerPage = newImagesPerPage;
        }

        updateGalleryItemToolbars();
        updateGalleryPlaceholders(); // Update placeholders after resize
        updateGalleryColumnsFromLayout();
    }, 250); // 250ms delay
}

// Toggle manual upscale button functionality
function toggleManualUpscale() {
    const currentState = manualUpscale.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    manualUpscale.setAttribute('data-state', newState);

}

// Metadata dialog functions
function showMetadataDialog() {
    if (currentImage && currentImage.metadata && metadataDialog) {
        populateDialogMetadataTable(currentImage.metadata);
        openModal(metadataDialog);
    }
}

function hideMetadataDialog() {
    if (metadataDialog) {
        metadataDialog.style.display = 'none';
    }

    // Hide expanded sections
    if (dialogPromptExpanded) dialogPromptExpanded.style.display = 'none';
    if (dialogUcExpanded) dialogUcExpanded.style.display = 'none';
}

function populateDialogMetadataTable(metadata) {
    // Type and Name
    const typeElement = document.getElementById('dialogMetadataType');
    const nameElement = document.getElementById('dialogMetadataName');

    if (typeElement && nameElement) {
        if (metadata.request_type) {
            typeElement.textContent = formatRequestType(metadata.request_type);

            // Show/hide name field based on preset_name availability
            const nameCell = nameElement.closest('.metadata-cell');
            if (metadata.preset_name) {
                nameElement.textContent = metadata.preset_name;
                if (nameCell) nameCell.style.display = 'flex';
            } else {
                if (nameCell) nameCell.style.display = 'none';
            }
        } else {
            typeElement.textContent = '-';
            const nameCell = nameElement.closest('.metadata-cell');
            if (nameCell) nameCell.style.display = 'none';
        }
    }

    // Model
    const modelElement = document.getElementById('dialogMetadataModel');
    if (modelElement) {
        modelElement.textContent = metadata.model_display_name || metadata.model || '-';
    }

    // Resolution
    const resolutionElement = document.getElementById('dialogMetadataResolution');
    if (resolutionElement) {
        if (metadata.resolution) {
            let resolutionText = formatResolution(metadata.resolution);
            if (metadata.upscaled) {
                resolutionElement.innerHTML = `${resolutionText} <span class="badge upscaled-badge">Upscaled</span>`;
            } else {
                resolutionElement.textContent = resolutionText;
            }
        } else if (metadata.width && metadata.height) {
            let dimensionText = `${metadata.width} × ${metadata.height}`;
            if (metadata.upscaled) {
                resolutionElement.innerHTML = `${dimensionText} <span class="badge upscaled-badge">Upscaled</span>`;
            } else {
                resolutionElement.textContent = dimensionText;
            }
        } else {
            resolutionElement.textContent = '-';
        }
    }

    // Steps
    const stepsElement = document.getElementById('dialogMetadataSteps');
    if (stepsElement) {
        const stepsText = metadata.steps || '-';
        if (metadata.skip_cfg_above_sigma !== null && metadata.skip_cfg_above_sigma !== undefined) {
            stepsElement.innerHTML = `${stepsText} <i class="fas fa-tint variety-icon" title="Variety+ enabled"></i>`;
        } else {
            stepsElement.textContent = stepsText;
        }
    }

    // Seeds - Handle display logic
    const seed1Element = document.getElementById('dialogMetadataSeed1');
    const seed2Element = document.getElementById('dialogMetadataSeed2');

    if (seed1Element && seed2Element) {
        // Find the label elements more safely
        const seed1Cell = seed1Element.closest('.metadata-cell');
        const seed2Cell = seed2Element.closest('.metadata-cell');
        const seed1Label = seed1Cell ? seed1Cell.querySelector('.metadata-label') : null;
        const seed2Label = seed2Cell ? seed2Cell.querySelector('.metadata-label') : null;

        if (seed1Label && seed2Label) {
            // Check if this is both seeds
            const hasLayer2Seed = metadata.layer2Seed !== undefined;

            if (hasLayer2Seed) {
                seed1Label.textContent = 'Seed 1';
                seed2Label.textContent = 'Seed 2';
                seed1Element.textContent = metadata.layer1Seed || '-';
                seed2Element.textContent = metadata.layer2Seed || '-';
                seed1Cell.style.display = 'flex';
                seed2Cell.style.display = 'flex';
            } else {
                // Single seed - hide seed 2 and rename seed 1
                seed1Label.textContent = 'Seed';
                seed1Element.textContent = metadata.layer1Seed || metadata.seed || '-';
                seed1Cell.style.display = 'flex';
                seed2Cell.style.display = 'none';
            }
        }
    }

    // Guidance
    const guidanceElement = document.getElementById('dialogMetadataGuidance');
    if (guidanceElement) {
        guidanceElement.textContent = metadata.scale || '-';
    }

    // Rescale
    const rescaleElement = document.getElementById('dialogMetadataRescale');
    if (rescaleElement) {
        rescaleElement.textContent = metadata.cfg_rescale || '-';
    }

    // Sampler
    const samplerElement = document.getElementById('dialogMetadataSampler');
    if (samplerElement) {
        const samplerObj = getSamplerMeta(metadata.sampler);
        samplerElement.textContent = samplerObj ? samplerObj.display : (metadata.sampler || '-');
    }

    // Noise Schedule
    const noiseScheduleElement = document.getElementById('dialogMetadataNoiseSchedule');
    if (noiseScheduleElement) {
        const noiseObj = getNoiseMeta(metadata.noise_schedule);
        noiseScheduleElement.textContent = noiseObj ? noiseObj.display : (metadata.noise_schedule || '-');
    }

    // Store prompt and UC content for expandable sections
    if (dialogPromptContent) {
        dialogPromptContent.textContent = metadata.prompt || 'No prompt available';
    }
    if (dialogUcContent) {
        dialogUcContent.textContent = metadata.uc || 'No undesired content specified';
    }
}

function toggleDialogExpanded(type) {
    if (type === 'prompt' && dialogPromptExpanded && dialogUcExpanded) {
        if (dialogPromptExpanded.style.display === 'none') {
            dialogPromptExpanded.style.display = 'block';
            dialogUcExpanded.style.display = 'none';
        } else {
            dialogPromptExpanded.style.display = 'none';
        }
    } else if (type === 'uc' && dialogUcExpanded && dialogPromptExpanded) {
        if (dialogUcExpanded.style.display === 'none') {
            dialogUcExpanded.style.display = 'block';
            dialogPromptExpanded.style.display = 'none';
        } else {
            dialogUcExpanded.style.display = 'none';
        }
    }
}

// Reset metadata table to default state
function resetMetadataTable() {
    // Reset all metadata values to '-'
    const metadataElements = [
        'metadataType', 'metadataName', 'metadataModel', 'metadataResolution',
        'metadataSteps', 'metadataSeed1', 'metadataSeed2', 'metadataGuidance',
        'metadataRescale', 'metadataSampler', 'metadataNoiseSchedule'
    ];

    metadataElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = '-';
        }
    });

    // Show name field by default when resetting
    const nameElement = document.getElementById('metadataName');
    if (nameElement) {
        const nameCell = nameElement.closest('.metadata-cell');
        if (nameCell) nameCell.style.display = 'flex';
    }

    // Reset seed labels and show both cells
    const seed1Element = document.getElementById('metadataSeed1');
    const seed2Element = document.getElementById('metadataSeed2');

    if (seed1Element && seed2Element) {
        const seed1Cell = seed1Element.closest('.metadata-cell');
        const seed2Cell = seed2Element.closest('.metadata-cell');
        const seed1Label = seed1Cell ? seed1Cell.querySelector('.metadata-label') : null;
        const seed2Label = seed2Cell ? seed2Cell.querySelector('.metadata-label') : null;

        if (seed1Label && seed2Label) {
            seed1Label.textContent = 'Seed 1';
            seed2Label.textContent = 'Seed 2';
            seed1Cell.style.display = 'flex';
            seed2Cell.style.display = 'flex';
        }
    }

    // Hide prompt/UC buttons
    const promptBtn = document.getElementById('promptBtn');
    const ucBtn = document.getElementById('ucBtn');
    if (promptBtn) promptBtn.style.display = 'none';
    if (ucBtn) ucBtn.style.display = 'none';

    // Hide expanded sections
    const expandedSections = document.querySelectorAll('.metadata-expanded');
    expandedSections.forEach(section => {
        section.style.display = 'none';
    });
}

// Clear seed function
function clearSeed() {
    if (manualSeed) {
        manualSeed.value = '';
        manualSeed.focus();
    }
}

// Helper: Get dimensions from resolution name
function getDimensionsFromResolution(resolution) {
    // Handle custom resolution format: custom_1024x768
    if (resolution && resolution.startsWith('custom_')) {
        const dimensions = resolution.replace('custom_', '');
        const [width, height] = dimensions.split('x').map(Number);
        if (width && height) {
            return { width, height };
        }
    }

    // Handle predefined resolutions
    const res = RESOLUTIONS.find(r => r.value === (resolution && resolution.toLowerCase()));
    return res ? { width: res.width, height: res.height } : null;
}

// Helper: Get resolution from display text
function getResolutionFromDisplay(displayText) {
    const normalizedText = displayText.toLowerCase();
    const res = RESOLUTIONS.find(r => normalizedText.includes(r.display.toLowerCase()));
    return res ? res.value : null;
}

// Add event listener for sproutSeedBtn to toggle seed value filling
let lastLoadedSeed = null;
let sproutSeedBtn = null;

function updateSproutSeedButton() {
    sproutSeedBtn = document.getElementById('sproutSeedBtn');
    if (sproutSeedBtn) {
        if (lastLoadedSeed) {
            sproutSeedBtn.style.display = 'inline-block';
        } else {
            sproutSeedBtn.style.display = 'none';
            // Reset toggle state when no seed is available
            sproutSeedBtn.setAttribute('data-state', 'off');
        }
    }
}

function toggleSproutSeed() {
    if (!sproutSeedBtn || !lastLoadedSeed) return;

    const currentState = sproutSeedBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    sproutSeedBtn.setAttribute('data-state', newState);

    // Get the clear seed button
    const clearSeedBtn = document.getElementById('clearSeedBtn');

    if (newState === 'on') {
        // Set the seed value and disable the field
        manualSeed.value = lastLoadedSeed;
        setSeedInputGroupState(true);
        manualSeed.disabled = true;
        sproutSeedBtn.classList.add('active');
        // Hide the clear seed button
        if (clearSeedBtn) clearSeedBtn.style.display = 'none';
    } else {
        // Clear the seed value and enable the field
        manualSeed.value = '';
        setSeedInputGroupState(false);
        manualSeed.disabled = false;
        sproutSeedBtn.classList.remove('active');
        // Show the clear seed button
        if (clearSeedBtn) clearSeedBtn.style.display = 'inline-block';
    }
}

if (manualSeed && document.getElementById('sproutSeedBtn')) {
    sproutSeedBtn = document.getElementById('sproutSeedBtn');
    sproutSeedBtn.addEventListener('click', toggleSproutSeed);
    // Initialize button state
    updateSproutSeedButton();
}

// Add event listener for varietyBtn to toggle a global flag for variety and toggle the active class
let varietyEnabled = false;
if (document.getElementById('varietyBtn')) {
    document.getElementById('varietyBtn').addEventListener('click', function() {
        varietyEnabled = !varietyEnabled;
        if (varietyEnabled) {
            this.setAttribute('data-state', 'on');
        } else {
            this.setAttribute('data-state', 'off');
        }
    });
}

// Add event listener for manualSampler to auto-set noise scheduler
async function fetchWithAuth(url, options = {}) {
    if (!(await ensureSessionValid())) {
        return Promise.reject(new Error('Session invalid or cancelled'));
    }
    return fetch(url, options);
};

// Handle image upload from file input
async function handleImageUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Filter for image files
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const nonImageFiles = files.filter(file => !file.type.startsWith('image/'));

    if (nonImageFiles.length > 0) {
        showGlassToast('warning', 'Invalid Files', `${nonImageFiles.length} non-image files were skipped`);
    }

    if (imageFiles.length === 0) {
        showGlassToast('error', 'No Images', 'Please select image files only');
        return;
    }

    await uploadImages(imageFiles);

    // Clear the input so the same files can be selected again
    event.target.value = '';
}

// Handle clipboard paste
async function handleClipboardPaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
                await uploadImages([file]);
            }
            break;
        }
    }
}

// Glass Toast Notification System
let toastCounter = 0;
const activeToasts = new Map();

function showGlassToast(type, title, message, showProgress = false) {
    const toastId = `toast-${++toastCounter}`;
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();

    const toast = document.createElement('div');
    const isSimple = !title || !message;
    toast.className = `glass-toast ${showProgress ? 'upload-progress' : ''} ${isSimple ? 'simple' : ''}`;
    toast.id = toastId;

    // If only message is provided (no title), create a simple one-line toast
    if (title && message) {
        // Full toast with title and message
        const icon = getToastIcon(type, showProgress);
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
                ${showProgress ? '<div class="toast-progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;
    } else {
        // Simple one-line toast (message only)
        const messageText = title || message;
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';

        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-message">${messageText}</div>
                ${showProgress ? '<div class="toast-progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;
    }

    toastContainer.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Auto-remove after 5 seconds (unless it's a progress toast)
    if (!showProgress) {
        setTimeout(() => {
            removeGlassToast(toastId);
        }, 5000);
    }

    activeToasts.set(toastId, { type, title, message, showProgress });
    return toastId;
}

function updateGlassToast(toastId, type, title, message) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const icon = getToastIcon(type);
    const toastContent = toast.querySelector('.toast-content');

    toast.className = `glass-toast show`;
    toast.querySelector('.toast-icon').innerHTML = icon;
    toast.querySelector('.toast-title').textContent = title;
    toast.querySelector('.toast-message').textContent = message;

    // Update stored data
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.type = type;
        stored.title = title;
        stored.message = message;
        activeToasts.set(toastId, stored);
    }

    // Auto-remove after 3 seconds for updated toasts
    setTimeout(() => {
        removeGlassToast(toastId);
    }, 3000);
}

function removeGlassToast(toastId) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    toast.classList.add('removing');
    activeToasts.delete(toastId);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

function getToastIcon(type, showProgress) {
    if (showProgress && type === 'info') {
        return '<i class="fas fa-spin fa-spinner-third"></i>';
    }
    switch (type) {
        case 'success': return '<i class="fas fa-check-circle"></i>';
        case 'error': return '<i class="fas fa-times-circle"></i>';
        case 'warning': return '<i class="fas fa-exclamation-triangle"></i>';
        case 'info': return '<i class="fas fa-info-circle"></i>';
        default: return '<i class="fas fa-sparkles"></i>';
    }
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

function updateGlassToastProgress(toastId, progress) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const progressBar = toast.querySelector('.toast-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${Math.min(progress, 100)}%`;
    }
}

// Upload multiple images to server
async function uploadImages(files) {
    if (files.length === 0) return;

    const toastId = showGlassToast('info', 'Uploading Images', `Starting upload of ${files.length} images...`, true);

    try {
        const formData = new FormData();
        files.forEach(file => {
            formData.append('images', file);
        });

        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/images`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            const successCount = result.totalUploaded || 0;
            const errorCount = result.totalErrors || 0;

            if (errorCount > 0) {
                updateGlassToast(toastId, 'warning', 'Upload Complete',
                    `Successfully uploaded ${successCount} images, ${errorCount} failed`);
            } else {
                updateGlassToast(toastId, 'success', 'Upload Complete',
                    `Successfully uploaded ${successCount} images`);
            }

            // Refresh gallery to show the new images
            setTimeout(async () => {
                await loadGallery();
            }, 1000);
        } else {
            throw new Error(result.error || 'Upload failed');
        }

    } catch (error) {
        console.error('Upload error:', error);
        updateGlassToast(toastId, 'error', 'Upload Failed', error.message);
    }
}

// Handle manual image upload for variation/reroll
async function handleManualImageUpload(file) {
    if (!file.type.startsWith('image/')) {
        showError('Please select an image file');
        return;
    }

    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;

    if (hasExistingMask) {
        // Store the pending upload and show alert modal
        window.pendingImageUpload = { file };
        showBaseImageChangeAlertModal();
        return;
    }

    // No mask exists, proceed with upload
    await handleManualImageUploadInternal(file);
}

// Internal function to handle the actual image upload
async function handleManualImageUploadInternal(file) {
    try {
        showManualLoading(true, 'Uploading base image...');

        const formData = new FormData();
        formData.append('image', file);

        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/references`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success || !result.hash) {
            throw new Error(result.error || 'Upload failed to return hash.');
        }

        const { hash, width, height } = result;

        const biasToUse = 2;

        window.uploadedImageData = {
            image_source: `cache:${hash}`,
            width: width,
            height: height,
            bias: biasToUse,
            isBiasMode: true,
            isClientSide: 1
        };

        if (imageBiasHidden != null) imageBiasHidden.value = biasToUse.toString();
        renderImageBiasDropdown(biasToUse.toString());

        // Set transformation type to upload (successful)
        updateTransformationDropdownState('upload', 'Upload');

        // Show transformation section content
        if (transformationRow) {
            transformationRow.classList.add('display-image');
        }

        document.getElementById('manualStrengthGroup').style.display = '';
        document.getElementById('manualNoiseGroup').style.display = '';
        updateUploadDeleteButtonVisibility();
        updateInpaintButtonState();

        // Crop and update preview
        await cropImageToResolution();

        showGlassToast('success', null, 'Referance Image Added');

    } catch (error) {
        console.error('Manual upload error:', error);
        showError(`Upload failed: ${error.message}`);
    } finally {
        showManualLoading(false);
    }
}

// Handle deleting uploaded base image
function handleDeleteBaseImage() {
    // Clean up any existing blob URLs
    cleanupBlobUrls();

    // Clear the uploaded image data
    window.uploadedImageData = null;

    // Clear the variation image
    variationImage.src = '';

    // Hide transformation section content
    if (transformationRow) {
        transformationRow.classList.remove('display-image');
    }
    document.getElementById('manualStrengthGroup').style.display = 'none';
    document.getElementById('manualNoiseGroup').style.display = 'none';

    // Hide image bias dropdown
    hideImageBiasDropdown();

    // Clear variation context
    if (window.currentEditMetadata) {
        delete window.currentEditMetadata.sourceFilename;
        delete window.currentEditMetadata.isVariationEdit;
    }
    deleteMask();

    // Update button visibility
    updateUploadDeleteButtonVisibility();

    // Update mask preview
    updateInpaintButtonState();
    updateMaskPreview();

    updateTransformationDropdownState();
}

// Update upload/delete button visibility based on whether an image is uploaded
function updateUploadDeleteButtonVisibility() {
    if (deleteImageBaseBtn) {
        if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            // Image is uploaded (not a placeholder), show delete button
            deleteImageBaseBtn.style.display = 'inline-block';
        } else {
            // No image uploaded or it's a placeholder, hide delete button
            deleteImageBaseBtn.style.display = 'none';
        }
    }
}

// Selection handling functions
async function handleImageSelection(image, isSelected, event) {
    const filename = image.filename || image.original || image.upscaled;

    // Skip if no valid filename found
    if (!filename) {
        console.warn('No valid filename found for image:', image);
        return;
    }

    const item = event.target.closest('.gallery-item');

    // ALT+click range selection
    if (event && event.altKey) {
        // Get all gallery items (both real items and placeholders) in order
        const allItems = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
        const clickedIndex = allItems.findIndex(div => div.dataset.filename === filename);
        
        if (lastSelectedGalleryIndex !== null && clickedIndex !== -1) {
            const [start, end] = [lastSelectedGalleryIndex, clickedIndex].sort((a, b) => a - b);
            
            // Select all items in range
            for (let i = start; i <= end; i++) {
                const div = allItems[i];
                const itemFilename = div.dataset.filename;
                
                // Update data-selected attribute
                div.dataset.selected = 'true';
                div.classList.add('selected');
                selectedImages.add(itemFilename);
                
                // Update checkbox if it's a real item
                const cb = div.querySelector('.gallery-item-checkbox');
                if (cb) cb.checked = true;
            }
            
            updateBulkActionsBar();
            lastSelectedGalleryIndex = clickedIndex;
            return;
        }
    }
    
    // Update last selected index for range selection
    const allItems = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
    const thisIndex = allItems.findIndex(div => div.dataset.filename === filename);
    if (thisIndex !== -1) {
        lastSelectedGalleryIndex = thisIndex;
    }

    // Update selection state using data-selected as single source of truth
    if (isSelected) {
        selectedImages.add(filename);
        item.dataset.selected = 'true';
        item.classList.add('selected');
    } else {
        selectedImages.delete(filename);
        item.dataset.selected = 'false';
        item.classList.remove('selected');
    }

    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCount = document.getElementById('selectedCount');
    const bulkMoveToScrapsBtn = document.getElementById('bulkMoveToScrapsBtn');
    const bulkPinBtn = document.getElementById('bulkPinBtn');
    const bulkUnpinBtn = document.getElementById('bulkUnpinBtn');

    if (selectedImages.size > 0) {
        bulkActionsBar.style.display = 'flex';
        selectedCount.textContent = selectedImages.size;
        gallery.classList.add('selection-mode');
        isSelectionMode = true;

        // Show/hide buttons based on current view
        if (bulkMoveToScrapsBtn) {
            if (currentGalleryView === 'scraps') {
                // Hide scrap button when viewing scraps (can't move scraps to scraps)
                bulkMoveToScrapsBtn.style.display = 'none';
            } else if (currentGalleryView === 'pinned') {
                // Hide scrap button when viewing pinned (can't move pinned to scraps)
                bulkMoveToScrapsBtn.style.display = 'none';
            } else {
                // Show scrap button when viewing regular images
                bulkMoveToScrapsBtn.style.display = 'inline-block';
            }
        }

        // Show/hide pin button based on current view
        if (bulkPinBtn) {
            if (currentGalleryView === 'images') {
                // Show pin button when viewing regular images
                bulkPinBtn.style.display = 'inline-block';
            } else {
                // Hide pin button for other views
                bulkPinBtn.style.display = 'none';
            }
        }

        // Show/hide unpin button based on current view
        if (bulkUnpinBtn) {
            if (currentGalleryView === 'pinned') {
                // Show unpin button when viewing pinned items
                bulkUnpinBtn.style.display = 'inline-block';
            } else {
                // Hide unpin button for other views
                bulkUnpinBtn.style.display = 'none';
            }
        }
    } else {
        bulkActionsBar.style.display = 'none';
        gallery.classList.remove('selection-mode');
        isSelectionMode = false;
    }
}

function clearSelection() {
    selectedImages.clear();
    lastSelectedGalleryIndex = null; // Reset range selection tracking

    // Uncheck all checkboxes
    const checkboxes = document.querySelectorAll('.gallery-item-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });

    // Remove selected class and data-selected attribute from all items (both real items and placeholders)
    const allItems = document.querySelectorAll('.gallery-item, .gallery-placeholder');
    allItems.forEach(item => {
        item.classList.remove('selected');
        item.dataset.selected = 'false';
    });

    updateBulkActionsBar();
}

async function handleBulkMoveToWorkspace() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }

    // Create workspace selection modal
    let modal = document.getElementById('bulkMoveToWorkspaceModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'bulkMoveToWorkspaceModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Move to Workspace</h3>
                    <button id="closeBulkMoveToWorkspaceBtn" class="close-dialog">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Select workspace to move <span id="bulkMoveSelectedCount">${selectedImages.size}</span> selected image(s):</p>
                    <div class="workspace-move-list" id="bulkMoveWorkspaceList">
                        <!-- Workspace list will be populated here -->
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal handlers
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });

        document.getElementById('closeBulkMoveToWorkspaceBtn').addEventListener('click', () => {
            closeModal(modal);
        });
    }

    // Update selected count
    document.getElementById('bulkMoveSelectedCount').textContent = selectedImages.size;

    // Populate workspace list
    const workspaceList = document.getElementById('bulkMoveWorkspaceList');
    workspaceList.innerHTML = '';

    workspaces.forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-move-item';
        item.innerHTML = `
            <div class="workspace-move-info">
                <span class="workspace-name">${workspace.name}</span>
                ${workspace.isActive ? '<span class="badge-active">Active</span>' : ''}
                <span class="workspace-counts">${workspace.fileCount} files</span>
            </div>
        `;

        item.addEventListener('click', async () => {
            closeModal(modal);
            await moveBulkImagesToWorkspace(workspace.id);
        });

        workspaceList.appendChild(item);
    });

    openModal(modal);
}

async function moveBulkImagesToWorkspace(workspaceId) {
    try {
        const isScrapsView = currentGalleryView === 'scraps';
        const isPinnedView = currentGalleryView === 'pinned';

        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to move');
        }

        // Use appropriate endpoint based on current view
        let endpoint;
        if (isScrapsView) {
            endpoint = `/workspaces/${workspaceId}/scraps`;
        } else if (isPinnedView) {
            endpoint = `/workspaces/${workspaceId}/pinned`;
        } else {
            endpoint = `/workspaces/${workspaceId}/files`;
        }

        const response = await fetchWithAuth(endpoint, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filenames: validFilenames
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move items');
        }

        const result = await response.json();
        const workspace = workspaces.find(w => w.id === workspaceId);
        let itemType;
        if (isScrapsView) {
            itemType = 'scraps';
        } else if (isPinnedView) {
            itemType = 'pinned images';
        } else {
            itemType = 'images';
        }

        showGlassToast('success', null, `Moved ${result.movedCount} ${itemType} to ${workspace ? workspace.name : 'workspace'}`);

        // Clear selection and reload gallery
        clearSelection();
        if (isScrapsView) {
            await loadScraps();
        } else if (isPinnedView) {
            await loadPinned();
        } else {
            await loadGallery();
        }

    } catch (error) {
        console.error('Error moving items to workspace:', error);
        showError('Failed to move items: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

async function handleBulkDelete(event = null) {
    if (selectedImages.size === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to delete.');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete ${selectedImages.size} selected image(s)? This will permanently delete both the original and upscaled versions.`,
        'Delete',
        'Cancel',
        event
    );
    
    if (!confirmed) {
        return;
    }

    try {
        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to delete');
        }

        const response = await fetchWithAuth('/images/bulk', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filenames: validFilenames
            })
        });

        if (!response.ok) {
            throw new Error(`Bulk delete failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            showGlassToast('success', null, `Successfully removed ${result.successful} image(s)`);
            if (result.failed > 0) {
                showError(`${result.failed} image(s) failed to delete`);
            }

            // Clear selection and remove images from gallery
            clearSelection();
            if (currentGalleryView === 'scraps') {
                await loadScraps();
            } else if (currentGalleryView === 'pinned') {
                await loadPinned();
            } else {
                // Convert filenames to image objects for removal
                const imagesToRemove = validFilenames.map(filename => ({ filename }));
                removeMultipleImagesFromGallery(imagesToRemove);
            }
        } else {
            throw new Error(result.error || 'Bulk delete failed');
        }

    } catch (error) {
        console.error('Bulk delete error:', error);
        showError('Bulk delete failed: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

async function handleBulkSequenzia(event = null) {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to send ${selectedImages.size} selected image(s) to Sequenzia? This will move the images and delete them from the gallery.`,
        'Send to Sequenzia',
        'Cancel',
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Sending images to Sequenzia...');

        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to send to Sequenzia');
        }

        const response = await fetchWithAuth('/images/send-to-sequenzia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filenames: validFilenames
            })
        });

        if (!response.ok) {
            throw new Error(`Send to Sequenzia failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            showGlassToast('success', null, `Successfully bounced ${result.successful} image(s) to Sequenzia`);
            if (result.failed > 0) {
                showError(`${result.failed} image(s) failed to send`);
            }

            // Clear selection and refresh gallery based on current view
            clearSelection();
            if (currentGalleryView === 'scraps') {
                await loadScraps();
            } else if (currentGalleryView === 'pinned') {
                await loadPinned();
            } else {
                await loadGallery();
            }
        } else {
            throw new Error(result.error || 'Send to Sequenzia failed');
        }

    } catch (error) {
        console.error('Send to Sequenzia error:', error);
        showError('Send to Sequenzia failed: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

async function handleBulkMoveToScraps(event = null) {
    if (selectedImages.size === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to move to scraps.');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to move ${selectedImages.size} selected image(s) to scraps?`,
        'Move to Scraps',
        'Cancel',
        event
    );
    
    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Moving images to scraps...');

        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to move to scraps');
        }

        // Move each file to scraps
        let successCount = 0;
        let errorCount = 0;

        for (const filename of validFilenames) {
            try {
                const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/scraps`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ filename })
                });

                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                errorCount++;
                console.error(`Failed to move ${filename} to scraps:`, error);
            }
        }

        if (successCount > 0) {
            showGlassToast('success', null, `Successfully scrapped ${successCount} image(s)`);
        }

        if (errorCount > 0) {
            showError(`${errorCount} image(s) failed to move to scraps`);
        }

        // Clear selection and remove images from gallery
        clearSelection();
        if (currentGalleryView === 'scraps') {
            await loadScraps();
        } else if (currentGalleryView === 'pinned') {
            await loadPinned();
        } else {
            // Convert filenames to image objects for removal
            const imagesToRemove = validFilenames.map(filename => ({ filename }));
            removeMultipleImagesFromGallery(imagesToRemove);
        }

    } catch (error) {
        console.error('Bulk move to scraps error:', error);
        showError('Failed to move images to scraps: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

async function handleBulkUnpin(event = null) {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }

    // Only allow unpinning when viewing pinned items
    if (currentGalleryView !== 'pinned') {
        showError('Can only unpin items when viewing pinned items');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to unpin ${selectedImages.size} selected image(s)?`,
        'Unpin',
        'Cancel',
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Unpinning images...');

        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to unpin');
        }

        // Unpin all files at once using bulk endpoint
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/pinned/bulk`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filenames: validFilenames })
        });

        if (response.ok) {
            const result = await response.json();
            showGlassToast('success', null, `Unpinned ${result.removedCount} image(s)`);

            // Clear selection and refresh gallery
            clearSelection();
            await loadPinned();
            
            // Update pin buttons for the affected images
            for (const filename of validFilenames) {
                await updateSpecificPinButton(filename);
            }
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to unpin images');
        }

    } catch (error) {
        console.error('Bulk unpin error:', error);
        showError('Failed to unpin images: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

async function handleBulkPin(event = null) {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }

    // Only allow pinning when viewing regular images
    if (currentGalleryView !== 'images') {
        showError('Can only pin items when viewing regular images');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to pin ${selectedImages.size} selected image(s)?`,
        'Pin',
        'Cancel',
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Pinning images...');

        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to pin');
        }

        // Pin all files at once using bulk endpoint
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/pinned/bulk`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filenames: validFilenames })
        });

        if (response.ok) {
            const result = await response.json();
            showGlassToast('success', null, `Pinned ${result.addedCount} image(s)`);

            // Clear selection and refresh gallery
            clearSelection();
            await loadGallery();
            
            // Update pin buttons for the affected images
            for (const filename of validFilenames) {
                await updateSpecificPinButton(filename);
            }
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to pin images');
        }

    } catch (error) {
        console.error('Bulk pin error:', error);
        showError('Failed to pin images: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

async function handleBulkChangePreset() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }

    // Show the modal
    const modal = document.getElementById('bulkChangePresetModal');
    const selectedCountSpan = document.getElementById('bulkChangePresetSelectedCount');
    const presetNameInput = document.getElementById('bulkChangePresetNameInput');

    if (!modal || !selectedCountSpan || !presetNameInput) {
        showError('Modal elements not found');
        return;
    }

    // Update selected count
    selectedCountSpan.textContent = selectedImages.size;

    // Clear input
    presetNameInput.value = '';

    // Show modal
    openModal(modal);

    // Focus on input
    presetNameInput.focus();
}

async function handleBulkChangePresetConfirm() {
    const modal = document.getElementById('bulkChangePresetModal');
    const presetNameInput = document.getElementById('bulkChangePresetNameInput');

    if (!modal || !presetNameInput) {
        showError('Modal elements not found');
        return;
    }

    const newPresetName = presetNameInput.value.trim();

    try {
        showManualLoading(true, 'Updating preset names...');

        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to update');
        }

        const response = await fetchWithAuth('/images/bulk/preset', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filenames: validFilenames,
                presetName: newPresetName || null // Send null if empty to remove preset name
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update preset names');
        }

        const result = await response.json();

        if (result.success) {
            const action = newPresetName ? `Wrote "${newPresetName} to "` : 'Cleared';
            showGlassToast('success', null, `Updated ${result.updatedCount} image(s) (${action})`);

            // Clear selection and refresh gallery based on current view
            clearSelection();
            if (currentGalleryView === 'scraps') {
                await loadScraps();
            } else if (currentGalleryView === 'pinned') {
                await loadPinned();
            } else {
                await loadGallery();
            }
        } else {
            throw new Error(result.error || 'Failed to update preset names');
        }

    } catch (error) {
        console.error('Bulk change preset error:', error);
        showError('Failed to update preset names: ' + error.message);
    } finally {
        showManualLoading(false);
        closeModal(modal);
    }
}

// Character Prompts Functions
let characterPromptCounter = 0;
let currentPositionCharacterId = null;
let selectedPositionCell = null;
let lastPromptState = null;
let savedRandomPromptState = null;

/**
 * Determines the request type for random prompt generation based on the selected model.
 * @returns {number} - The request type (0, 1, or 2).
 */
function getRequestTypeForRandomPrompt() {
    const modelValue = document.getElementById('manualModel').value || '';
    const modelLower = modelValue.toLowerCase();

    if (modelLower.includes('v4.5') || modelLower.includes('v4')) {
        return 2;
    } else if (modelLower.includes('furry')) {
        return 1;
    } else if (modelLower.includes('anime')) {
        return 0;
    }
    return 0; // Default to Anime
}

/**
 * Executes the random prompt generation and populates the form.
 */
async function executeRandomPrompt() {
    const requestType = getRequestTypeForRandomPrompt();
    const nsfw = document.getElementById('randomPromptNsfwBtn').dataset.state === 'on';

    const promptData = await randomPrompt(requestType, nsfw);

    if (promptData && Array.isArray(promptData)) {
        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');

        if (manualPrompt) {
            manualPrompt.value = promptData[0] || '';
            autoResizeTextarea(manualPrompt);
            updateEmphasisHighlighting(manualPrompt);
        }
        if (manualUc) {
            manualUc.value = '';
            autoResizeTextarea(manualUc);
            updateEmphasisHighlighting(manualUc);
        }

        const characterPrompts = promptData.slice(1).map(p => ({ prompt: p, uc: '', enabled: true }));
        savedRandomPromptState = {
            basePrompt: promptData[0],
            baseUc: '',
            characters: characterPrompts
        };
        loadCharacterPrompts(characterPrompts, false);
    }
}

/**
 * Transfers the current random prompt to the main prompt and exits random mode.
 */
function transferRandomPrompt() {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
    const transferBtn = document.getElementById('randomPromptTransferBtn');
    const nsfwBtn = document.getElementById('randomPromptNsfwBtn');

    // Check if random mode is active
    if (toggleBtn.dataset.state !== 'on') {
        return; // Not in random mode, do nothing
    }

    // Copy current random prompt state to main prompt
    if (savedRandomPromptState) {
        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        if (manualPrompt) {
            manualPrompt.value = savedRandomPromptState.basePrompt;
            autoResizeTextarea(manualPrompt);
            updateEmphasisHighlighting(manualPrompt);
        }
        if (manualUc) {
            manualUc.value = savedRandomPromptState.baseUc;
            autoResizeTextarea(manualUc);
            updateEmphasisHighlighting(manualUc);
        }
        loadCharacterPrompts(savedRandomPromptState.characters, false);
    }

    // Exit random mode
    toggleBtn.dataset.state = 'off';
    toggleBtn.classList.remove('active');
    refreshBtn.style.display = 'none';
    transferBtn.style.display = 'none';
    nsfwBtn.style.display = 'none';

    // Clear saved states
    savedRandomPromptState = null;
    lastPromptState = null;

    // Show success message
    showGlassToast('success', null, 'Transferred to editor');
}

/**
 * Toggles the random prompt generation feature on and off.
 */
async function toggleRandomPrompt() {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
    const transferBtn = document.getElementById('randomPromptTransferBtn');
    const nsfwBtn = document.getElementById('randomPromptNsfwBtn');
    const isEnabled = toggleBtn.dataset.state === 'on';

    if (isEnabled) {
        // Turning OFF - save current random prompt state
        savedRandomPromptState = {
            basePrompt: document.getElementById('manualPrompt').value,
            baseUc: document.getElementById('manualUc').value,
            characters: getCharacterPrompts()
        };

        toggleBtn.dataset.state = 'off';
        toggleBtn.classList.remove('active');
        refreshBtn.style.display = 'none';
        transferBtn.style.display = 'none';
        nsfwBtn.style.display = 'none';

        if (lastPromptState) {
            const manualPrompt = document.getElementById('manualPrompt');
            const manualUc = document.getElementById('manualUc');
            if (manualPrompt) {
                manualPrompt.value = lastPromptState.basePrompt;
                autoResizeTextarea(manualPrompt);
                updateEmphasisHighlighting(manualPrompt);
            }
            if (manualUc) {
                manualUc.value = lastPromptState.baseUc;
                autoResizeTextarea(manualUc);
                updateEmphasisHighlighting(manualUc);
            }
            loadCharacterPrompts(lastPromptState.characters, false);
        }
        lastPromptState = null;

    } else {
        // Turning ON
        // Save current state before doing anything
        lastPromptState = {
            basePrompt: document.getElementById('manualPrompt').value,
            baseUc: document.getElementById('manualUc').value,
            characters: getCharacterPrompts()
        };

        toggleBtn.dataset.state = 'on';
        toggleBtn.classList.add('active');
        refreshBtn.style.display = '';
        transferBtn.style.display = '';
        nsfwBtn.style.display = '';

        // Check if we have a saved random prompt state
        if (savedRandomPromptState) {
            // Restore the last random prompt values
            const manualPrompt = document.getElementById('manualPrompt');
            const manualUc = document.getElementById('manualUc');
            if (manualPrompt) {
                manualPrompt.value = savedRandomPromptState.basePrompt;
                autoResizeTextarea(manualPrompt);
                updateEmphasisHighlighting(manualPrompt);
            }
            if (manualUc) {
                manualUc.value = savedRandomPromptState.baseUc;
                autoResizeTextarea(manualUc);
                updateEmphasisHighlighting(manualUc);
            }
            loadCharacterPrompts(savedRandomPromptState.characters, false);
        } else {
            // No saved state, generate new random prompt
            await executeRandomPrompt();
        }
    }
}

function addCharacterPrompt() {
    const characterId = `character_${characterPromptCounter++}`;

    // Get the current main window tab selection
    const mainToggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
    const mainActiveTab = mainToggleGroup ? mainToggleGroup.getAttribute('data-active') : 'prompt';

    const characterItem = document.createElement('div');
    characterItem.className = 'character-prompt-item';
    characterItem.id = characterId;

    // Determine which tab should be active based on main window selection
    const promptTabActive = mainActiveTab === 'prompt' ? 'active' : '';
    const ucTabActive = mainActiveTab === 'uc' ? 'active' : '';

    characterItem.innerHTML = `
            <div class="character-prompt-tabs">
                <div class="tab-header">
                    <div class="left-controls">
                    <div class="character-name-editable">
                        <input type="text" class="character-name-input hover-show" value="Character ${characterPromptCounter}" placeholder="Enter character name...">
                        <span class="character-name-input-placeholder">Character ${characterPromptCounter}</span>
                    </div>
                </div>
                <div class="character-prompt-preview">
                    <input type="text" id="${characterId}_preview" readonly placeholder="Click to expand and edit prompt..."></input>
                </div>
                    <div class="character-prompt-controls">
                        <button type="button" class="btn-secondary character-prompt-collapse-toggle" onclick="toggleCharacterPromptCollapse('${characterId}')" title="Collapse/Expand">
                            <i class="nai-fold"></i>
                        </button>
                        <button type="button" class="btn-secondary move-up-btn" onclick="moveCharacterPrompt('${characterId}', 'up')" style="display: inline-flex;">
                            <i class="nai-directional-arrow-up"></i>
                        </button>
                        <button type="button" class="btn-secondary move-down-btn" onclick="moveCharacterPrompt('${characterId}', 'down')" style="display: inline-flex;">
                            <i class="nai-directional-arrow-down"></i>
                        </button>
                        <button type="button" class="btn-secondary position-btn" onclick="showPositionDialog('${characterId}')" style="display: none;">
                            <i class="fas fa-crosshairs"></i>
                        </button>
                        <button type="button" class="btn-danger" onclick="deleteCharacterPrompt('${characterId}')">
                            <i class="nai-trash"></i>
                        </button>
                        <button type="button" class="btn-secondary toggle-btn" id="${characterId}_enabled" data-state="on" onclick="toggleCharacterPromptEnabled('${characterId}')" title="Enable/Disable Character">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </div>
                </div>
                <div class="tab-content">
                    <div class="tab-pane ${promptTabActive}" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
                        </div>
                    </div>
                    <div class="tab-pane ${ucTabActive}" id="${characterId}_uc-tab" data-label="UC">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;

    // Store character name in dataset
    characterItem.dataset.charaName = `Character ${characterPromptCounter}`;

    characterPromptsContainer.appendChild(characterItem);



    // Add autocomplete event listeners for prompt and UC fields
    const promptField = document.getElementById(`${characterId}_prompt`);
    const ucField = document.getElementById(`${characterId}_uc`);

    if (promptField) {
        promptField.addEventListener('input', handleCharacterAutocompleteInput);
        promptField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
        promptField.addEventListener('focus', () => startEmphasisHighlighting(promptField));
        promptField.addEventListener('blur', () => {
            applyFormattedText(promptField, true);
            updateEmphasisHighlighting(promptField);
            stopEmphasisHighlighting();
        });
        // Add auto-resize functionality
        promptField.addEventListener('input', () => autoResizeTextarea(promptField));
        // Initialize emphasis highlighting overlay
        initializeEmphasisOverlay(promptField);
    }

    if (ucField) {
        ucField.addEventListener('input', handleCharacterAutocompleteInput);
        ucField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
        ucField.addEventListener('focus', () => startEmphasisHighlighting(ucField));
        ucField.addEventListener('blur', () => {
            applyFormattedText(ucField, true);
            updateEmphasisHighlighting(ucField);
            stopEmphasisHighlighting();
        });
        // Add auto-resize functionality
        ucField.addEventListener('input', () => autoResizeTextarea(ucField));
        initializeEmphasisOverlay(ucField);
    }

    // Add preview textarea click handler
    const previewTextarea = document.getElementById(`${characterId}_preview`);
    if (previewTextarea) {
        previewTextarea.addEventListener('click', () => {
            toggleCharacterPromptCollapse(characterId);
        });
    }

    // Add character name input event listeners
    const nameInput = characterItem.querySelector('.character-name-input');
    if (nameInput) {
        nameInput.addEventListener('blur', function() {
            const newName = this.value.trim();
            if (newName) {
                characterItem.dataset.charaName = newName;
                characterItem.querySelector('.character-name-input-placeholder').textContent = newName;
            } else {
                this.value = `Character ${characterPromptCounter}`;
                characterItem.dataset.charaName = `Character ${characterPromptCounter}`;
                characterItem.querySelector('.character-name-input-placeholder').textContent = `Character ${characterPromptCounter}`;
            }
        });

        nameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                this.blur();
            }
        });
    }

    // Update preview content when prompt changes
    if (promptField) {
        promptField.addEventListener('input', () => {
            updateCharacterPromptPreview(characterId);
        });
    }

    // Set initial collapsed state for new characters
    // First character should be open, others collapsed
    const existingCharacters = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    if (existingCharacters.length === 0) {
        // This is the first character, make it open
        characterItem.classList.remove('collapsed');
        updateCharacterPromptCollapseButton(characterId, false);
    } else {
        // This is not the first character, make it collapsed
        characterItem.classList.add('collapsed');
        updateCharacterPromptCollapseButton(characterId, true);
    }

    // Update auto position toggle visibility
    updateAutoPositionToggle();
}

function deleteCharacterPrompt(characterId) {
    const characterItem = document.getElementById(characterId);
    if (characterItem) {
        characterItem.remove();
        updateAutoPositionToggle();
    }
}

function moveCharacterPrompt(characterId, direction) {
    const characterItems = Array.from(characterPromptsContainer.querySelectorAll('.character-prompt-item'));
    const currentIndex = characterItems.findIndex(item => item.id === characterId);

    if (currentIndex === -1) return;

    let newIndex;
    if (direction === 'up' && currentIndex > 0) {
        newIndex = currentIndex - 1;
    } else if (direction === 'down' && currentIndex < characterItems.length - 1) {
        newIndex = currentIndex + 1;
    } else {
        return; // Can't move in that direction
    }

    // Swap the elements
    const currentItem = characterItems[currentIndex];
    const targetItem = characterItems[newIndex];

    if (newIndex > currentIndex) {
        // Moving down
        characterPromptsContainer.insertBefore(targetItem, currentItem);
    } else {
        // Moving up
        characterPromptsContainer.insertBefore(currentItem, targetItem);
    }

    // Update button states after reordering
    updateAutoPositionToggle();
}

function toggleCharacterPromptEnabled(characterId) {
    const characterItem = document.getElementById(characterId);
    const toggleBtn = document.getElementById(`${characterId}_enabled`);

    if (characterItem && toggleBtn) {
        const currentState = toggleBtn.getAttribute('data-state');
        const newState = currentState === 'on' ? 'off' : 'on';

        toggleBtn.setAttribute('data-state', newState);

        if (newState === 'on') {
            characterItem.classList.remove('character-prompt-disabled');
        } else {
            characterItem.classList.add('character-prompt-disabled');
        }
    }
}

function updateAutoPositionToggle() {
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const autoPositionBtn = document.getElementById('autoPositionBtn');

    if (characterItems.length === 0) {
        autoPositionBtn.style.display = 'none';
        return;
    }

    if (characterItems.length === 1) {
        autoPositionBtn.style.display = 'none';
        // Force enable auto position for single character
        autoPositionBtn.setAttribute('data-state', 'on');
        // Hide position buttons and move buttons for single character
        characterItems.forEach(item => {
            const positionBtn = item.querySelector('.position-btn');
            const moveUpBtn = item.querySelector('.move-up-btn');
            const moveDownBtn = item.querySelector('.move-down-btn');
            if (positionBtn) positionBtn.style.display = 'none';
            if (moveUpBtn) moveUpBtn.style.display = 'none';
            if (moveDownBtn) moveDownBtn.style.display = 'none';
        });
    } else {
        autoPositionBtn.style.display = 'inline-flex';
        // Show/hide position buttons based on auto position state
        const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';
        characterItems.forEach((item, index) => {
            const positionBtn = item.querySelector('.position-btn');
            const moveUpBtn = item.querySelector('.move-up-btn');
            const moveDownBtn = item.querySelector('.move-down-btn');

            if (positionBtn) {
                positionBtn.style.display = isAutoPosition ? 'none' : 'inline-flex';
            }

            // Show move buttons for multiple characters
            if (moveUpBtn) {
                moveUpBtn.style.display = 'inline-flex';
                if (index === 0) {
                    moveUpBtn.disabled = true;
                    moveUpBtn.style.opacity = '0.4';
                } else {
                    moveUpBtn.disabled = false;
                    moveUpBtn.style.opacity = '1';
                }
            }
            if (moveDownBtn) {
                moveDownBtn.style.display = 'inline-flex';
                if (index === characterItems.length - 1) {
                    moveDownBtn.disabled = true;
                    moveDownBtn.style.opacity = '0.4';
                } else {
                    moveDownBtn.disabled = false;
                    moveDownBtn.style.opacity = '1';
                }
            }
        });
    }
}

function showPositionDialog(characterId) {
    currentPositionCharacterId = characterId;
    selectedPositionCell = null;

    // Reset grid selection
    document.querySelectorAll('.position-cell').forEach(cell => {
        cell.classList.remove('selected');
    });

    // Show dialog
    document.getElementById('positionDialog').style.display = 'flex';

    // Add event listeners to position cells
    document.querySelectorAll('.position-cell').forEach(cell => {
        cell.addEventListener('click', function() {
            document.querySelectorAll('.position-cell').forEach(c => c.classList.remove('selected'));
            this.classList.add('selected');
            selectedPositionCell = this;
        });
    });
}

function hidePositionDialog() {
    document.getElementById('positionDialog').style.display = 'none';
    currentPositionCharacterId = null;
    selectedPositionCell = null;
}

function confirmPosition() {
    if (currentPositionCharacterId && selectedPositionCell) {
        const x = parseFloat(selectedPositionCell.dataset.x);
        const y = parseFloat(selectedPositionCell.dataset.y);
        const cellLabel = selectedPositionCell.dataset.cell;

        // Update position button text to show current position
        const characterItem = document.getElementById(currentPositionCharacterId);
        const positionBtn = characterItem.querySelector('.position-btn');
        positionBtn.innerHTML = `<i class="fas fa-crosshairs"></i> ${cellLabel}`;

        // Store position data
        characterItem.dataset.positionX = x;
        characterItem.dataset.positionY = y;
        characterItem.dataset.positionCell = cellLabel;

        hidePositionDialog();
    }
}

function getCharacterPrompts() {
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const characterPrompts = [];
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';

    characterItems.forEach((item, index) => {
        const characterId = item.id;
        const enabled = document.getElementById(`${characterId}_enabled`).getAttribute('data-state') === 'on';
        const prompt = document.getElementById(`${characterId}_prompt`).value.trim();
        const uc = document.getElementById(`${characterId}_uc`).value.trim();
        const charaName = item.dataset.charaName || `Character ${index + 1}`;

        let center = null;

        if (!isAutoPosition)  {
            // Manual position: use stored position or default
            const storedX = item.dataset.positionX;
            const storedY = item.dataset.positionY;
            if (storedX && storedY) {
                center = { x: parseFloat(storedX), y: parseFloat(storedY) };
            }
        }

        characterPrompts.push({
            prompt: prompt,
            uc: uc,
            center: center,
            enabled: enabled,
            chara_name: charaName
        });
    });

    return characterPrompts;
}

function clearCharacterPrompts() {
    const characterPromptsContainer = document.getElementById('characterPromptsContainer');
    characterPromptsContainer.innerHTML = '';
    characterPromptCounter = 0;
}

function loadCharacterPrompts(characterPrompts, useCoords) {
    clearCharacterPrompts();

    if (!characterPrompts || !Array.isArray(characterPrompts)) {
        return;
    }

    // Get the current main window tab selection
    const mainToggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
    const mainActiveTab = mainToggleGroup ? mainToggleGroup.getAttribute('data-active') : 'prompt';

    // Update counter to match the number of characters
    characterPromptCounter = characterPrompts.length;

    characterPrompts.forEach((character, index) => {
        const characterId = `character_${index}`;
        characterPromptCounter = index + 1;

        const characterItem = document.createElement('div');
        characterItem.className = 'character-prompt-item';
        characterItem.id = characterId;

        if (!character.enabled) {
            characterItem.classList.add('character-prompt-disabled');
        }

        // Determine position button text
        let positionBtnText = '<i class="fas fa-crosshairs"></i>';
        if (character.center && useCoords) {
            // Find the cell label for the stored position
            const x = character.center.x;
            const y = character.center.y;
            const cellLabel = getCellLabelFromCoords(x, y);
            if (cellLabel) {
                positionBtnText = `<i class="fas fa-crosshairs"></i> ${cellLabel}`;
            }
        }

        // Determine which tab should be active based on main window selection
        const promptTabActive = mainActiveTab === 'prompt' ? 'active' : '';
        const ucTabActive = mainActiveTab === 'uc' ? 'active' : '';

        characterItem.innerHTML = `
            <div class="character-prompt-tabs">
                <div class="tab-header">
                    <div class="left-controls">
                    <div class="character-name-editable">
                        <input type="text" class="character-name-input hover-show" value="${character.chara_name || `Character ${index + 1}`}" placeholder="Enter character name...">
                        <span class="character-name-input-placeholder">${character.chara_name || `Character ${index + 1}`}</span>
                    </div>
                    </div>
                <div class="character-prompt-preview">
                    <input type="text" id="${characterId}_preview" readonly placeholder="Click to expand and edit prompt..." value="${character.prompt || ''}"></input>
                </div>
                    <div class="character-prompt-controls">
                        <button type="button" class="btn-secondary character-prompt-collapse-toggle" onclick="toggleCharacterPromptCollapse('${characterId}')" title="Collapse/Expand">
                            <i class="nai-fold"></i>
                        </button>
                        <button type="button" class="btn-secondary move-up-btn" onclick="moveCharacterPrompt('${characterId}', 'up')" style="display: inline-flex;">
                            <i class="nai-directional-arrow-up"></i>
                        </button>
                        <button type="button" class="btn-secondary move-down-btn" onclick="moveCharacterPrompt('${characterId}', 'down')" style="display: inline-flex;">
                            <i class="nai-directional-arrow-down"></i>
                        </button>
                        <button type="button" class="btn-secondary position-btn" onclick="showPositionDialog('${characterId}')" style="display: none;">
                            ${positionBtnText}
                        </button>
                        <button type="button" class="btn-danger" onclick="deleteCharacterPrompt('${characterId}')">
                            <i class="nai-trash"></i>
                        </button>
                        <button type="button" class="btn-secondary toggle-btn" id="${characterId}_enabled" data-state="${character.enabled ? 'on' : 'off'}" onclick="toggleCharacterPromptEnabled('${characterId}')" title="Enable/Disable Character">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </div>
                </div>
                <div class="tab-content">
                    <div class="tab-pane ${promptTabActive}" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${character.prompt || ''}</textarea>
                        </div>
                    </div>
                    <div class="tab-pane ${ucTabActive}" id="${characterId}_uc-tab" data-label="UC">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${character.uc || ''}</textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Store character name in dataset
        if (character.chara_name) {
            characterItem.dataset.charaName = character.chara_name;
        }

        // Store position data if available
        if (character.center) {
            characterItem.dataset.positionX = character.center.x;
            characterItem.dataset.positionY = character.center.y;
            characterItem.dataset.positionCell = getCellLabelFromCoords(character.center.x, character.center.y);
        }

        characterPromptsContainer.appendChild(characterItem);



        // Add autocomplete event listeners for prompt and UC fields
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);

        if (promptField) {
            promptField.addEventListener('input', handleCharacterAutocompleteInput);
            promptField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
            promptField.addEventListener('focus', () => startEmphasisHighlighting(promptField));
            promptField.addEventListener('blur', () => {
                applyFormattedText(promptField, true);
                updateEmphasisHighlighting(promptField);
                stopEmphasisHighlighting();
            });
            // Add auto-resize functionality
            promptField.addEventListener('input', () => autoResizeTextarea(promptField));
            // Initialize emphasis highlighting overlay
            initializeEmphasisOverlay(promptField);
            // Apply initial resizing and highlighting after content is set
            autoResizeTextarea(promptField);
            updateEmphasisHighlighting(promptField);
        }

        if (ucField) {
            ucField.addEventListener('input', handleCharacterAutocompleteInput);
            ucField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
            ucField.addEventListener('focus', () => startEmphasisHighlighting(ucField));
            ucField.addEventListener('blur', () => {
                applyFormattedText(ucField, true);
                updateEmphasisHighlighting(ucField);
                stopEmphasisHighlighting();
            });
            // Add auto-resize functionality
            ucField.addEventListener('input', () => autoResizeTextarea(ucField));
            // Initialize emphasis highlighting overlay
            initializeEmphasisOverlay(ucField);
            // Apply initial resizing and highlighting after content is set
            autoResizeTextarea(ucField);
            updateEmphasisHighlighting(ucField);
        }

        // Add preview textarea click handler
        const previewTextarea = document.getElementById(`${characterId}_preview`);
        if (previewTextarea) {
            previewTextarea.addEventListener('click', () => {
                toggleCharacterPromptCollapse(characterId);
            });
        }

        // Add character name input event listeners
        const nameInput = characterItem.querySelector('.character-name-input');
        if (nameInput) {
            nameInput.addEventListener('blur', function() {
                const newName = this.value.trim();
                if (newName) {
                    characterItem.dataset.charaName = newName;
                    characterItem.querySelector('.character-name-input-placeholder').textContent = newName;
                } else {
                    this.value = `Character ${characterPromptCounter}`;
                    characterItem.dataset.charaName = `Character ${characterPromptCounter}`;
                    characterItem.querySelector('.character-name-input-placeholder').textContent = `Character ${characterPromptCounter}`;
                }
            });

            nameInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    this.blur();
                }
            });
        }

        // Update preview content when prompt changes
        if (promptField) {
            promptField.addEventListener('input', () => {
                updateCharacterPromptPreview(characterId);
            });
            // Update preview initially after content is set
            updateCharacterPromptPreview(characterId);
        }

        // Set default collapsed state for loaded characters
        // First character should be open, others collapsed
        if (index === 0) {
            characterItem.classList.remove('collapsed');
            updateCharacterPromptCollapseButton(characterId, false);
        } else {
            characterItem.classList.add('collapsed');
            updateCharacterPromptCollapseButton(characterId, true);
        }
    });

    // Update auto position toggle after loading
    updateAutoPositionToggle();
}

function getCellLabelFromCoords(x, y) {
    const positions = {
        '0.1,0.1': 'A1', '0.3,0.1': 'B1', '0.5,0.1': 'C1', '0.7,0.1': 'D1', '0.9,0.1': 'E1',
        '0.1,0.3': 'A2', '0.3,0.3': 'B2', '0.5,0.3': 'C2', '0.7,0.3': 'D2', '0.9,0.3': 'E2',
        '0.1,0.5': 'A3', '0.3,0.5': 'B3', '0.5,0.5': 'C3', '0.7,0.5': 'D3', '0.9,0.5': 'E3',
        '0.1,0.7': 'A4', '0.3,0.7': 'B4', '0.5,0.7': 'C4', '0.7,0.7': 'D4', '0.9,0.7': 'E4',
        '0.1,0.9': 'A5', '0.3,0.9': 'B5', '0.5,0.9': 'C5', '0.7,0.9': 'D5', '0.9,0.9': 'E5'
    };
    return positions[`${x},${y}`] || null;
}

/**
 * Sanitize, clamp, enforce max-area, and report which dim was adjusted.
 *
 * @param {string} rawW
 * @param {string} rawH
 * @param {object} opts
 * @param {number} [opts.minW=1]
 * @param {number} [opts.maxW=8192]
 * @param {number} [opts.minH=1]
 * @param {number} [opts.maxH=8192]
 * @param {number} [opts.step]    – snap both dims to this
 * @param {number} [opts.maxArea] – max allowed w*h
 * @returns {{ width:number, height:number, changed:null|'width'|'height', reason:string }}
 */
function correctDimensions(rawW, rawH, {
  minW    = 1,
  maxW    = 2048,
  minH    = 1,
  maxH    = 2048,
  step    = 64,
  maxArea = 4194304
} = {}) {
  // strip→parse→snap→clamp
  const parse = (raw, min, max) => {
    let s = (raw.match(/\d+/g)||[''])[0],
        n = parseInt(s,10)||0;
    if (step) n -= n % step;
    return Math.max(min, Math.min(max, n));
  };

  let w = parse(rawW, minW, maxW),
      h = parse(rawH, minH, maxH),
      origW = w, origH = h,
      changed = null,
      reason = null;

  // Check if values were clamped due to min/max limits or step snapping
  const originalW = parseInt(rawW) || 0;
  const originalH = parseInt(rawH) || 0;

  if (originalW !== w || originalH !== h) {
    if (originalW !== w && originalH !== h) {
      changed = 'both';
      reason = 'clamped_and_snapped';
    } else if (originalW !== w) {
      changed = 'width';
      reason = originalW < minW ? 'min_limit' : originalW > maxW ? 'max_limit' : 'step_snap';
    } else {
      changed = 'height';
      reason = originalH < minH ? 'min_limit' : originalH > maxH ? 'max_limit' : 'step_snap';
    }
  }

  // enforce maxArea: shrink h first, else w
  if (w*h > maxArea) {
    let candidateH = Math.floor(maxArea/w);
    if (step) candidateH -= candidateH % step;
    if (candidateH >= minH) {
      h = Math.max(minH, Math.min(origH, candidateH));
      changed = 'height';
      reason = 'max_area';
    } else {
      let candidateW = Math.floor(maxArea/origH);
      if (step) candidateW -= candidateW % step;
      w = Math.max(minW, Math.min(origW, candidateW));
      changed = 'width';
      reason = 'max_area';
    }
  }

  return { width: w, height: h, changed, reason };
}

/**
 * Single unified price-calculator.
 *
 * @param {object} args
 * @param {number} args.area
 * @param {number} args.steps
 * @param {string} args.modelId         – "V3","FURRY","V4","V4_CUR","V4_5","V4_5_CUR"
 * @param {string} args.samplerRequest  – "EULER_ANC","DPMSDE","DPM2M","DPM2MSDE","EULER","DPM2S_ANC"
 * @param {object} args.subscription    – your subscription JSON
 * @param {number} [args.nSamples=1]
 * @param {boolean}[args.image=false]
 * @param {number} [args.strength=1]
 * @returns {{ list: number, opus: number }}
 */
function calculatePriceUnified({
    height,
    width,
    steps,
    model,
    sampler = { meta: 'k_euler_ancestral' },
    subscription = { perks: { unlimitedImageGenerationLimits: [] } },
    nSamples = 1,
    image = false,
    strength = 1
}) {
    // 1) how many free samples?
    const area = width * height;
    const limits = (subscription.perks?.unlimitedImageGenerationLimits || [])
        .slice()
        .sort((a, b) => a.resolution - b.resolution);
    const freeEntry = limits.find(e => e.maxPrompts > 0 && area <= e.resolution);

    // 2) calculate cost using new formula
    const _steps = steps || 28;
    const n_samples = nSamples || 1;
    const _width = width || 1024;
    const _height = height || 1024;
    const _strength = image && strength ? strength : 1.0;

    // Handle SMEA factor for both V3 and V4+ models
    let smeaFactor = 1.0;
    if (
        model.toUpperCase() === 'V4' ||
        model.toUpperCase() === 'V4_CUR' ||
        model.toUpperCase() === 'V4_5_CUR' ||
        model.toUpperCase() === 'V4_5'
    ) {
        // V4/V4.5 uses autoSmea
        /* if (sampler.meta === 'k_dpmpp_2m') {
            smeaFactor = 1.2;
        } */
    } else {
        // V3 uses sm/sm_dyn
        if (sampler.meta === 'k_dpmpp_2m') {
            smeaFactor = 1.4;
        } else if (sampler.meta === 'k_dpmpp_sde') {
            smeaFactor = 1.2;
        }
    }

    const resolution = _width * _height;

    let perSample = Math.ceil(2951823174884865e-21 * resolution + 5753298233447344e-22 * resolution * _steps,) * smeaFactor;

    perSample = Math.max(Math.ceil(perSample * _strength), 2);

    const opusDiscount = _steps <= 28 && (freeEntry?.maxPrompts > 0) && resolution <= (freeEntry?.resolution || 0);

    const listCost = perSample * n_samples;
    const opusCost = perSample * (n_samples - (opusDiscount ? 1 : 0));

    return {
        list: listCost,
        opus: opusCost
    };
}

// Calculate and update price display for manual generation
function updateManualPriceDisplay() {
    const priceDisplay = document.getElementById('manualPriceDisplay');
    const priceList = document.getElementById('manualPriceList');

    if (!priceDisplay || !priceList) return;

    try {
        // Get current form values
        const model = manualSelectedModel || 'V4_5';
        const steps = parseInt(manualSteps.value) || 25;
        const sampler = manualSelectedSampler || 'k_euler_ancestral';
        const strength = parseFloat(manualStrengthValue.value) || 1.0;

        // Calculate area from resolution
        let height = 1024; // Default area
        let width = 1024; // Default area
        if (manualSelectedResolution === 'custom') {
            width = parseInt(manualWidth.value) || 1024;
            height = parseInt(manualHeight.value) || 1024;
        } else if (manualSelectedResolution) {
            const dimensions = getDimensionsFromResolution(manualSelectedResolution);
            if (dimensions) {
                width = dimensions.width;
                height = dimensions.height;
            }
        }

        // Determine if this is an img2img request
        const isImg2Img = !document.getElementById('transformationSection')?.classList.contains('hidden');

        // Get sampler object
        const samplerObj = getSamplerMeta(sampler) || { meta: 'k_euler_ancestral' };

        // Calculate price
        const price = calculatePriceUnified({
            height: height,
            width: width,
            steps: steps,
            model: model,
            sampler: samplerObj,
            subscription: window.optionsData?.user?.subscription || { perks: { unlimitedImageGenerationLimits: [] } },
            nSamples: 1,
            image: isImg2Img,
            strength: isImg2Img ? strength : 1
        });

        // Update display
        priceList.textContent = `${price.opus === 0 ? 0 : price.list}`;

        // Apply styling for free opus price
        priceDisplay.classList.toggle('free', price.opus === 0);

        // Show the price display
        priceDisplay.style.display = 'flex';

    } catch (error) {
        console.error('Error calculating price:', error);
        priceDisplay.style.display = 'none';
    }
}

// Character Prompt Collapse/Expand Functions
function toggleCharacterPromptCollapse(characterId) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;

    const isCollapsed = characterItem.classList.contains('collapsed');
    const newCollapsedState = !isCollapsed;

    if (newCollapsedState) {
        characterItem.classList.add('collapsed');
    } else {
        characterItem.classList.remove('collapsed');
        // Resize text areas when expanding to ensure proper height
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);
        if (promptField) autoResizeTextarea(promptField);
        if (ucField) autoResizeTextarea(ucField);
    }

    updateCharacterPromptCollapseButton(characterId, newCollapsedState);
}

function updateCharacterPromptCollapseButton(characterId, isCollapsed) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;

    const collapseToggle = characterItem.querySelector('.character-prompt-collapse-toggle');
    if (!collapseToggle) return;

    const icon = collapseToggle.querySelector('i');

    if (isCollapsed) {
        icon.className = 'nai-unfold';
    } else {
        icon.className = 'nai-fold';
    }
}

function updateCharacterPromptPreview(characterId) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;

    const promptField = document.getElementById(`${characterId}_prompt`);
    const previewField = document.getElementById(`${characterId}_preview`);

    if (promptField && previewField) {
        const promptText = promptField.value.trim();
        previewField.value = promptText || 'No prompt entered';
    }
}

async function updateImageGenCounter(counter = 0) {
    try {
        const counterElem = document.getElementById('imageGenCounter');
        const statusElem = document.getElementById('queueStatus');
        if (counterElem && statusElem && counterElem.textContent !== counter.toString()) {
            counterElem.textContent = counter;
            statusElem.classList.remove('notice', 'warn', 'bad');
            if (counter > 300) statusElem.classList.add('bad');
            else if (counter > 200) statusElem.classList.add('warn');
            else if (counter > 150) statusElem.classList.add('notice');
        }
    } catch (e) {
        const counterElem = document.getElementById('imageGenCounter');
        const statusElem = document.getElementById('queueStatus');
        if (counterElem) counterElem.textContent = '---';
        if (statusElem) statusElem.classList.remove('notice', 'warn', 'bad');
    }   
}

async function updateQueueStatus(data) {
    try {
        const queueStatus = document.getElementById('queueStatus');
        const statusElem = document.getElementById('queueIcon');
        if (statusElem) {
            let classList = 'fas ';
            if (data.value === 2) classList += 'fa-octagon-exclamation fa-beat-fade';
            else if (data.value === 1) classList += 'fa-ban';
            else classList += 'fa-check hidden';

            if (data.value === 2) queueStatus.classList.add('stopped');
            else queueStatus.classList.remove('stopped');
            statusElem.setAttribute('data-value', data.value);
            statusElem.classList = classList;
        }
    } catch (e) {
        const statusElem = document.getElementById('queueIcon');
        statusElem.setAttribute('data-value', 0);
        statusElem.classList = "";
    }   
}

let pinModalPromise = null;

async function ensureSessionValid() {
    // Try a lightweight authenticated endpoint
    try {
        const resp = await fetch('/ping');
        if (resp.status !== 401) {
            const data = await resp.json();
            updateImageGenCounter(data.image_count);
            updateQueueStatus(data.queue_status);
            return true;
        }
    } catch {}
    try {
        if (pinModalPromise) return pinModalPromise;
        pinModalPromise = await window.showPinModal();
        // Try again after re-auth
        const resp2 = await fetch('/ping');
        if (resp2.status !== 401) {
            const data = await resp2.json();
            updateImageGenCounter(data.image_count);
            updateQueueStatus(data.queue_status);
            pinModalPromise = null;
            return true;
        }
    } catch {
        // User cancelled
        window.location.href = '/';
        return false;
    }
}

(async () => {
    await ensureSessionValid();
    setInterval(ensureSessionValid, 10000);
})();

// WebSocket Event Handlers
if (window.wsClient) {
    // Handle WebSocket connection events
    wsClient.on('connected', () => {
        console.log('✅ WebSocket connected successfully');
        
        // Subscribe to relevant channels
        wsClient.send({
            type: 'subscribe',
            channels: ['queue_updates', 'image_generated', 'system_messages']
        });
    });

    wsClient.on('disconnected', (event) => {
        console.log('🔌 WebSocket disconnected:', event);
    });

    // Handle queue updates
    wsClient.on('queue_update', (data) => {
        console.log('📊 Queue update received:', data);
        if (data.data) {
            updateQueueStatus(data.data);
        }
    });

    // Handle system messages
    wsClient.on('system_message', (data) => {
        console.log('📢 System message received:', data);
        if (data.data && data.data.message) {
            // Show system message as toast
            wsClient.showToast(data.data.message, data.data.level || 'info');
        }
    });

    // Handle notifications
    wsClient.on('notification', (data) => {
        console.log('🔔 Notification received:', data);
        if (data.data && data.data.message) {
            wsClient.showToast(data.data.message, data.data.type || 'info');
        }
    });

    // Handle custom message types
    wsClient.on('message', (message) => {
        console.log('📨 WebSocket message received:', message);
        // Handle any other message types here
    });
}