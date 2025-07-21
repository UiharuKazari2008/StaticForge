// Global variables
let subscriptionData = null;
let forcePaidRequest = false;
let allImages = [];

// Make u1 array available globally for tag highlighting
if (typeof u1 !== 'undefined') {
    window.u1 = u1;
}
// Infinite scroll variables
let currentPage = 1;
let imagesPerPage =12
let isLoadingMore = false;
let hasMoreImages = true;
let hasMoreImagesBefore = false; // Track if there are images before current page
let infiniteScrollLoading = document.getElementById('infiniteScrollLoading');
let visibleItems = new Set(); // Track visible items
let virtualScrollEnabled = true; // Enable virtual scrolling
let currentImage = null;
let currentManualPreviewImage = null;

// Bidirectional infinite scroll tracking
let displayedStartIndex = 0; // First displayed image index in allImages array
let displayedEndIndex = 0;   // Last displayed image index in allImages array

let selectedCharacterAutocompleteIndex = -1;

// Selection state
let selectedImages = new Set();
let isSelectionMode = false;

// Workspace state
let workspaces = [];
let activeWorkspace = 'default';
let currentWorkspaceOperation = null;
let activeWorkspaceColor = '#124'; // Default color
let activeWorkspaceBackgroundColor = null; // Can be null for auto-generation
let activeWorkspaceBackgroundImage = null; // Can be null for no background image
let activeWorkspaceBackgroundOpacity = 0.3; // Default opacity

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
    const datasetDropdown = document.getElementById('datasetDropdown');
    const datasetBiasControls = document.querySelector('#manualModal .prompt-tabs .tab-buttons button[data-tab="settings"]')
    
    if (datasetDropdown) {
        datasetDropdown.style.display = isV3Selected ? 'none' : '';
    }
    if (datasetBiasControls) {
        datasetBiasControls.style.display = isV3Selected ? 'none' : '';
    }
    
    // Hide/show character prompts for V3 models
    const addCharacterBtn = document.getElementById('addCharacterBtn');
    const characterPromptsContainer = document.getElementById('characterPromptsContainer');
    
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
    const saveBtn = document.getElementById('manualSaveBtn');
    const presetNameInput = document.getElementById('manualPresetName');
    
    if (saveBtn && presetNameInput) {
        const hasPresetName = presetNameInput.value.trim().length > 0;
        saveBtn.disabled = !hasPresetName;
        
        if (hasPresetName) {
            saveBtn.classList.remove('disabled');
        } else {
            saveBtn.classList.add('disabled');
        }
    }
}

// Helper function to update load button state based on preset name validation
function updateLoadButtonState() {
    const loadBtn = document.getElementById('manualLoadBtn');
    const presetNameInput = document.getElementById('manualPresetName');
    
    if (!loadBtn || !presetNameInput) return;
    
    const presetName = presetNameInput.value.trim();
    if (!presetName) {
        loadBtn.disabled = true;
        loadBtn.classList.add('disabled');
        return;
    }
    
    // Check if preset exists in available presets
    const isValidPreset = window.availablePresets && window.availablePresets.includes(presetName);
    
    loadBtn.disabled = !isValidPreset;
    
    if (isValidPreset) {
        loadBtn.classList.remove('disabled');
    } else {
        loadBtn.classList.add('disabled');
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

// Load available presets for validation
async function loadAvailablePresets() {
    try {
        const response = await fetchWithAuth('/', {
            method: 'OPTIONS'
        });
        if (response.ok) {
            const options = await response.json();
            if (options.presets) {
                window.availablePresets = options.presets.map(preset => preset.name);
            }
        }
    } catch (error) {
        console.warn('Failed to load available presets:', error);
        window.availablePresets = [];
    }
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
        
        showSuccess(`Preset "${presetName}" loaded successfully!`);
    } catch (error) {
        console.error('Load preset error:', error);
        showError(`Failed to load preset "${presetName}": ${error.message}`);
    }
}

// Three-way mapping for samplers
const SAMPLER_MAP = [
  { meta: 'k_euler_ancestral', display: 'Euler Ancestral', request: 'EULER_ANC' },
  { meta: 'k_dpmpp_sde', display: 'DPM++ SDE', request: 'DPMSDE' },
  { meta: 'k_dpmpp_2m', display: 'DPM++ 2M', request: 'DPM2M' },
  { meta: 'k_dpmpp_2m_sde', display: 'DPM++ 2M SDE', request: 'DPM2MSDE' },
  { meta: 'k_euler', display: 'Euler', request: 'EULER' },
  { meta: 'k_dpmpp_2s_ancestral', display: 'DPM++ 2S Ancestral', request: 'DPM2S_ANC' }
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
const RESOLUTION_GROUPS = [
    {
        group: 'Normal',
        badge: 'N',
        options: RESOLUTIONS.filter(r => r.value.startsWith('normal_')).map(r => ({
            value: r.value,
            name: r.display.replace('Normal ', ''),
            dims: `${r.width}x${r.height}`
        })), 
        free: true
    },
    {
        group: 'Large',
        badge: 'L',
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
        badge: 'S',
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
            { value: 'v4_5', name: 'v4.5 Full', display: 'v4.5 Full' },
            { value: 'v4_5_cur', name: 'v4.5 Curated', display: 'v4.5 Curated' },
            { value: 'v4', name: 'v4 Full', display: 'v4 Full' },
            { value: 'v4_cur', name: 'v4 Curated', display: 'v4 Curated' }
        ]
    },
    {
        group: 'Legacy Model',
        badge: 'Legacy',
        options: [
            { value: 'v3', name: 'v3 Full', display: 'v3 Full' },
            { value: 'v3_furry', name: 'v3 Furry', display: 'v3 Furry' }
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

// Helper functions for sampler mapping
function getSamplerMeta(meta) {
  return SAMPLER_MAP.find(s => s.meta.toLowerCase() === meta.toLowerCase());
}

// Helper functions for noise mapping
function getNoiseMeta(meta) {
  return NOISE_MAP.find(n => n.meta.toLowerCase() === meta.toLowerCase());
}

// DOM elements
const logoutButton = document.getElementById('logoutButton');

const manualModal = document.getElementById('manualModal');
const manualForm = document.getElementById('manualForm');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualPreviewCloseBtn = document.getElementById('manualPreviewCloseBtn');
const manualBtn = document.getElementById('manualBtn');

const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');
const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');
const lightboxScrapBtn = document.getElementById('lightboxScrapBtn');
const generateBtn = document.getElementById('generateBtn');
const presetSelect = document.getElementById('presetSelect');
const gallery = document.getElementById('gallery');
const galleryColumnsInput = document.getElementById('galleryColumnsInput');
const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
const cacheGallery = document.getElementById('cacheGallery');
// Pagination elements removed for infinite scroll
const loadingOverlay = document.getElementById('loadingOverlay');
const confettiContainer = document.getElementById('confettiContainer');
const lightboxUpscaleBtn = document.getElementById('lightboxUpscaleBtn');
const lightboxRerollBtn = document.getElementById('lightboxRerollBtn');
const lightboxRerollEditBtn = document.getElementById('lightboxRerollEditBtn');

// Manual form elements
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
const manualSaveBtn = document.getElementById('manualSaveBtn');
const clearSeedBtn = document.getElementById('clearSeedBtn');
const layer1SeedToggleGroup = document.getElementById('layer1SeedToggleGroup');
const layer1SeedToggle = document.getElementById('layer1SeedToggle');
const manualMaskBiasRow = document.getElementById('manualMaskBiasRow');
const manualMaskBias = document.getElementById('manualMaskBias');
const manualNoiseSchedulerDropdown = document.getElementById('manualNoiseSchedulerDropdown');
const manualNoiseSchedulerDropdownBtn = document.getElementById('manualNoiseSchedulerDropdownBtn');
const manualNoiseSchedulerDropdownMenu = document.getElementById('manualNoiseSchedulerDropdownMenu');
const manualNoiseSchedulerSelected = document.getElementById('manualNoiseSchedulerSelected');
const manualNoiseSchedulerHidden = document.getElementById('manualNoiseScheduler');
let manualSelectedNoiseScheduler = '';

// Mask Bias Dropdown Elements
const manualMaskBiasDropdown = document.getElementById('manualMaskBiasDropdown');
const manualMaskBiasDropdownBtn = document.getElementById('manualMaskBiasDropdownBtn');
const manualMaskBiasDropdownMenu = document.getElementById('manualMaskBiasDropdownMenu');
const manualMaskBiasSelected = document.getElementById('manualMaskBiasSelected');
const manualMaskBiasHidden = document.getElementById('manualMaskBias');
const manualMaskBiasGroup = document.getElementById('manualMaskBiasGroup');
let manualSelectedMaskBias = '2';

// Image Bias Dropdown Elements
const imageBiasDropdown = document.getElementById('imageBiasDropdown');
const imageBiasDropdownBtn = document.getElementById('imageBiasDropdownBtn');
const imageBiasDropdownMenu = document.getElementById('imageBiasDropdownMenu');
const imageBiasSelected = document.getElementById('imageBiasSelected');
const imageBiasHidden = document.getElementById('imageBias');
const imageBiasGroup = document.getElementById('imageBiasGroup');

// Global variables for image handling
let uploadedImageData = null;
let originalImageData = null;
const manualResolutionDropdown = document.getElementById('manualResolutionDropdown');
const manualResolutionDropdownBtn = document.getElementById('manualResolutionDropdownBtn');
const manualResolutionDropdownMenu = document.getElementById('manualResolutionDropdownMenu');
const manualResolutionSelected = document.getElementById('manualResolutionSelected');
const manualResolutionHidden = document.getElementById('manualResolution');
const manualCustomResolution = document.getElementById('manualCustomResolution');
const manualCustomResolutionBtn = document.getElementById('manualCustomResolutionBtn');
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
let manualSelectedModel = '';

// Character autocomplete elements
const characterAutocompleteOverlay = document.getElementById('characterAutocompleteOverlay');
const characterAutocompleteList = document.querySelector('.character-autocomplete-list');

// Preset autocomplete elements
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

const inpaintBtn = document.getElementById('inpaintBtn');
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

const manualPresetToggleBtn = document.getElementById('manualPresetToggleBtn');
const manualPresetToggleText = document.getElementById('manualPresetToggleText');
const manualPresetToggleIcon = document.getElementById('manualPresetToggleIcon');
const manualPresetGroup = document.getElementById('manualPresetGroup');


const manualPreviewLoadBtn = document.getElementById('manualPreviewLoadBtn');
const manualPreviewScrapBtn = document.getElementById('manualPreviewScrapBtn');

// Global variables for character autocomplete
let characterAutocompleteTimeout = null;
let currentCharacterAutocompleteTarget = null;

// Global variables for character autocomplete
let characterSearchResults = [];
let characterData = null;

// Dataset Dropdown Elements
const datasetDropdown = document.getElementById('datasetDropdown');
const datasetDropdownBtn = document.getElementById('datasetDropdownBtn');
const datasetDropdownMenu = document.getElementById('datasetDropdownMenu');
const datasetSelected = document.getElementById('datasetSelected');
const datasetIcon = document.getElementById('datasetIcon');
let selectedDatasets = []; // Default to anime enabled

// Dataset Bias Variables
let datasetBias = {
    anime: 1.0,
    furry: 1.0,
    backgrounds: 1.0
};

// Quality Toggle Element
const qualityToggleBtn = document.getElementById('qualityToggleBtn');
let appendQuality = true;

// UC Presets Dropdown Elements  
const ucPresetsDropdown = document.getElementById('ucPresetsDropdown');
const ucPresetsDropdownBtn = document.getElementById('ucPresetsDropdownBtn');
const ucPresetsDropdownMenu = document.getElementById('ucPresetsDropdownMenu');
let selectedUcPreset = 3; // Default to "Heavy"

// Global variables for preset autocomplete
let presetAutocompleteTimeout = null;
let currentPresetAutocompleteTarget = null;
let selectedPresetAutocompleteIndex = -1;
let presetSearchResults = [];

function renderGroupedDropdown(menu, groups, selectHandler, closeHandler, selectedVal, renderOptionContent) {
    menu.innerHTML = '';
    groups.forEach(group => {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-dropdown-group';
        groupHeader.textContent = group.group;
        menu.appendChild(groupHeader);
        group.options.forEach(opt => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedVal === opt.value ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = opt.value;
            option.dataset.group = group.group;
            option.innerHTML = renderOptionContent(opt, group);
            const action = () => {
                selectHandler(opt.value, group.group);
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
    });
}

const resolutionOptionRenderer = (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`;


function openDropdown(menu, button) {
    menu.style.display = 'block';
    if (button) button.classList.add('active');
}

function closeDropdown(menu, button) {
    menu.style.display = 'none';
    if (button) button.classList.remove('active');
}

function toggleDropdown(menu, button) {
    if (menu.style.display === 'block') {
        closeDropdown(menu, button);
    } else {
        openDropdown(menu, button);
    }
}

function setupDropdown(container, button, menu, render, getSelectedValue) {
    if (!container || !button || !menu) return;
    button.addEventListener('click', async e => {
        e.stopPropagation();
        if (menu.style.display === 'block') {
            closeDropdown(menu, button);
        } else {
            await render(getSelectedValue());
            openDropdown(menu, button);
        }
    });

    document.addEventListener('click', e => {
        if (!container.contains(e.target)) {
            closeDropdown(menu, button);
        }
    });
}


// Custom Preset Dropdown Functions
async function renderCustomPresetDropdown(selectedVal) {
    customPresetDropdownMenu.innerHTML = '';

    // Use global presets and pipelines loaded from /options
    if (Array.isArray(presets) && presets.length > 0) {
        // Presets group header
        const presetsGroupHeader = document.createElement('div');
        presetsGroupHeader.className = 'custom-dropdown-group';
        presetsGroupHeader.innerHTML = '<i class="nai-heart-enabled"></i> Presets';
        customPresetDropdownMenu.appendChild(presetsGroupHeader);

        for (const preset of presets) {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedVal === `preset:${preset.name}` ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = `preset:${preset.name}`;
            option.dataset.type = 'preset';
            option.innerHTML = `
                <div class="preset-option-content">
                    <div class="preset-name">${preset.name}</div>
                    <div class="preset-details">
                        <span class="preset-model">${modelsShort[preset.model.toUpperCase()] || preset.model || 'Default'}</span>
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

    // Add pipelines group
    if (Array.isArray(pipelines) && pipelines.length > 0) {
        // Pipelines group header
        const pipelinesGroupHeader = document.createElement('div');
        pipelinesGroupHeader.className = 'custom-dropdown-group';
        pipelinesGroupHeader.innerHTML = '<i class="nai-inpaint"></i> Pipelines';
        customPresetDropdownMenu.appendChild(pipelinesGroupHeader);

        for (const pipeline of pipelines) {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedVal === `pipeline:${pipeline.name}` ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = `pipeline:${pipeline.name}`;
            option.dataset.type = 'pipeline';
            // Use layer info from /options
            const l1 = pipeline.layer1.info;
            const l2 = pipeline.layer2.info;
            option.innerHTML = `
                <div class="pipeline-option-content">
                    <div class="pipeline-name">${pipeline.name}</div>
                    <div class="pipeline-layers">
                        <div class="pipeline-layer">
                            <span class="layer-type">${pipeline.layer1.type}</span>
                            <span class="layer-value">${pipeline.layer1.value}</span>
                        </div>
                        <div class="pipeline-layer">
                            <span class="layer-type">${pipeline.layer2.type}</span>
                            <span class="layer-value">${pipeline.layer2.value}</span>
                        </div>
                    </div>
                    <div class="pipeline-details">
                        <div class="pipeline-models">
                            <span class="pipeline-model">${modelsShort[l1.model?.toUpperCase()] || l1.model || 'Default'}</span>
                            <div class="pipeline-icons">
                                ${l1.upscale ? '<i class="nai-upscale" title="Upscale enabled"></i>' : ''}
                                ${l1.allow_paid ? '<i class="nai-anla" title="Allow paid"></i>' : ''}
                                ${l1.variety ? '<i class="nai-wand-sparkles" title="Variety enabled"></i>' : ''}
                                ${l1.character_prompts ? '<i class="fas fa-users" title="Character prompts"></i>' : ''}
                                ${l1.base_image ? '<i class="fas fa-image" title="Has base image"></i>' : ''}
                            </div>
                        </div>
                        <div class="pipeline-models">
                            <span class="pipeline-model">${modelsShort[l2.model?.toUpperCase()] || l2.model || 'Default'}</span>
                            <div class="pipeline-icons">
                                ${l2.upscale ? '<i class="nai-upscale" title="Upscale enabled"></i>' : ''}
                                ${l2.allow_paid ? '<i class="nai-anla" title="Allow paid"></i>' : ''}
                                ${l2.character_prompts ? '<i class="fas fa-users" title="Character prompts"></i>' : ''}
                            </div>
                        </div>
                    </div>
                    <div class="pipeline-resolution">${pipeline.resolution || 'Default'}</div>
                </div>
            `;
            option.addEventListener('click', () => {
                selectCustomPreset(`pipeline:${pipeline.name}`);
                closeCustomPresetDropdown();
            });
            option.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    selectCustomPreset(`pipeline:${pipeline.name}`);
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
    } else if (value.startsWith('pipeline:')) {
        const pipelineName = value.replace('pipeline:', '');
        customPresetSelected.innerHTML = `<i class="nai-inpaint"></i> ${pipelineName}`;
    } else {
        customPresetSelected.innerHTML = '<i class="nai-pen-tip-light"></i> Select Preset or Pipeline';
    }
    
    // Sync with hidden select for compatibility
    const hiddenSelect = document.getElementById('presetSelect');
    if (hiddenSelect) hiddenSelect.value = value;
    
    // Trigger any listeners (e.g., updateGenerateButton)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
}

function openCustomPresetDropdown() {
    openDropdown(customPresetDropdownMenu, customPresetDropdownBtn);
}

function closeCustomPresetDropdown() {
    closeDropdown(customPresetDropdownMenu, customPresetDropdownBtn);
}

setupDropdown(customPresetDropdown, customPresetDropdownBtn, customPresetDropdownMenu, renderCustomPresetDropdown, () => selectedPreset);

function renderManualResolutionDropdown(selectedVal) {
    renderGroupedDropdown(manualResolutionDropdownMenu, RESOLUTION_GROUPS, selectManualResolution, closeManualResolutionDropdown, selectedVal, resolutionOptionRenderer);
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
    
    // Update mask bias dropdown to reflect new resolution
    if (manualMaskBiasSelected) {
        selectManualMaskBias(manualSelectedMaskBias);
    }
    
    // Check if we're in a pipeline edit context and update mask bias visibility
    if (window.currentPipelineEdit && !window.currentMaskData) {
        const pipelineName = window.currentPipelineEdit.pipelineName;
        const pipelinePresetRes = getPipelinePresetResolution(pipelineName);
        if (pipelinePresetRes) {
            const presetDims = getDimensionsFromResolution(pipelinePresetRes);
            const selectedDims = getDimensionsFromResolution(value);
            if (presetDims && selectedDims) {
                // Calculate aspect ratios
                const presetAspectRatio = presetDims.width / presetDims.height;
                const selectedAspectRatio = selectedDims.width / selectedDims.height;
                
                // Show/hide mask bias dropdown based on aspect ratio difference
                if (Math.abs(presetAspectRatio - selectedAspectRatio) > 0.01) {
                    if (manualMaskBiasGroup) {
                        manualMaskBiasGroup.style.display = 'block';
                    }
                } else {
                    if (manualMaskBiasGroup) {
                        manualMaskBiasGroup.style.display = 'none';
                    }
                }
            }
        }
    } else {
        manualMaskBiasGroup.style.display = 'none';
    }
    
    // Trigger any listeners (e.g., updateGenerateButton or manual form update)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
    // Update price display
    updateManualPriceDisplay();

    // --- ADDED: Refresh preview image if in bias mode ---
    if (window.uploadedImageData && window.uploadedImageData.isBiasMode && manualModal && manualModal.style.display === 'block') {
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

function openManualResolutionDropdown() {
    openDropdown(manualResolutionDropdownMenu, manualResolutionDropdownBtn);
}

function closeManualResolutionDropdown() {
    closeDropdown(manualResolutionDropdownMenu, manualResolutionDropdownBtn);
}

setupDropdown(manualResolutionDropdown, manualResolutionDropdownBtn, manualResolutionDropdownMenu, renderManualResolutionDropdown, () => manualSelectedResolution);

// Replace the three function definitions with the new combined function
async function loadIntoManualForm(source, image = null) {
    try {
        let data = {};
        let type = 'metadata';
        let name = '';

        // Save the current preset name before clearing the form
        const currentPresetName = manualPresetName ? manualPresetName.value.trim() : '';

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
            } else if (presetType === 'pipeline') {
                type = 'pipeline';
                endpoint = `/pipeline/${presetName}`;
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

            // For pipeline, we only edit layer2
            if (type === 'pipeline') {
                data = data.layer2 || {};
            }

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
            const customWidth = document.getElementById('manualCustomWidth');
            const customHeight = document.getElementById('manualCustomHeight');
            if (customWidth && customHeight) {
                customWidth.value = data.width;
                customHeight.value = data.height;
            }
            // Sanitize dimensions after setting
            sanitizeCustomDimensions();
        }
        if (manualSteps) manualSteps.value = data.steps || (type === 'metadata' ? 25 : undefined);
        if (manualGuidance) manualGuidance.value = data.scale || data.guidance || (type === 'metadata' ? 5.0 : undefined);
        if (manualRescale) manualRescale.value = data.cfg_rescale || data.rescale || (type === 'metadata' ? 0.0 : undefined);
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
            autoPositionBtn.setAttribute('data-state', data.use_coords ? 'on' : 'off');
        } else if (data.allCharacterPrompts && Array.isArray(data.allCharacterPrompts)) {
            // Handle new allCharacterPrompts format
            loadCharacterPrompts(data.allCharacterPrompts, data.use_coords);
            autoPositionBtn.setAttribute('data-state', data.use_coords ? 'on' : 'off');
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
                const container = document.getElementById('vibeReferencesContainer');
                if (container) {
                    container.innerHTML = '';
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
                const container = document.getElementById('vibeReferencesContainer');
                if (container) {
                    container.innerHTML = '';
                }
                
                // Add each vibe transfer back to the container
                for (const vibeTransfer of data.vibe_transfer) {
                    await addVibeReferenceToContainer(vibeTransfer.id, vibeTransfer.ie, vibeTransfer.strength);
                }
                
                // Show the vibe references section
                const section = document.getElementById('vibeReferencesSection');
                if (section) {
                    section.style.display = '';
                }
                
                console.log(`🎨 Restored ${data.vibe_transfer.length} vibe transfers from forge data`);
            }
        } else {
            // Clear vibe references if no data
            const container = document.getElementById('vibeReferencesContainer');
            if (container) {
                container.innerHTML = '';
            }
        }
        
        // Handle vibe normalize setting
        if (data.normalize_vibes !== undefined) {
            const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.setAttribute('data-state', data.normalize_vibes ? 'on' : 'off');
            }
        } else {
            // Default to on if not specified
            const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.setAttribute('data-state', 'on');
            }
        }

        // Handle image source data
        const hasBaseImage = data.image_source;
        const isPipeline = data.request_type === 'pipeline';

        const variationImage = document.getElementById('manualVariationImage');
        const strengthValue = document.getElementById('manualStrengthValue');
        const noiseValue = document.getElementById('manualNoiseValue');

        // Handle pipeline images - show inpaint button and load pipeline mask if no mask exists
        if (isPipeline) { 
            if (data.mask_compressed) {
                // Store the compressed mask data for later use
                window.currentMaskCompressed = data.mask_compressed;
                
                // Process compressed mask to display resolution
                const targetWidth = data.width || 1024;
                const targetHeight = data.height || 1024;
                
                try {
                    window.pipelineMaskData = await processCompressedMask(data.mask_compressed, targetWidth, targetHeight);
                    window.currentMaskData = window.pipelineMaskData;
                    console.log('✅ Successfully processed compressed mask for pipeline');
                    // Update vibe transfer UI state after mask is loaded
                    updateInpaintButtonState();
                } catch (error) {
                    console.error('❌ Failed to process compressed mask for pipeline:', error);
                    // Fallback to regular mask if available
                    if (data.mask) {
                        window.pipelineMaskData = "data:image/png;base64," + data.mask;
                        window.currentMaskData = window.pipelineMaskData;
                        // Update vibe transfer UI state after mask is loaded
                        updateInpaintButtonState();
                    }
                }
            } else if (data.mask) {
                window.pipelineMaskData = "data:image/png;base64," + data.mask;
                window.currentMaskData = window.pipelineMaskData;
                console.log('✅ Loaded regular mask for pipeline');
            } else {
                // Get pipeline name from metadata (pipeline_name then preset_name)
                let pipelineName = data.pipeline_name || data.preset_name || 'generated';
                
                // Load pipeline mask from server
                try {
                    const maskResponse = await fetchWithAuth(`/pipeline/${pipelineName}?render_mask=true`, {
                        method: 'OPTIONS',
                    });
                    if (maskResponse.ok) {
                        const maskData = await maskResponse.json();
                        if (maskData.mask) {
                            window.currentMaskData = "data:image/png;base64," + maskData.mask;
                            window.pipelineMaskData = "data:image/png;base64," + maskData.mask;
                            console.log(`🎭 Loaded pipeline mask for: ${pipelineName}`);
                            // Update vibe transfer UI state after mask is loaded
                            updateInpaintButtonState();
                        }
                    }
                } catch (error) {
                    console.error('Failed to load pipeline mask:', error);
                }
            }
            
            // For pipeline images, get the current image and set it as placeholder
            if (image) {
                let imageToShow = image.filename;
                if (image.pipeline_upscaled) {
                    imageToShow = image.pipeline_upscaled;
                } else if (image.pipeline) {
                    imageToShow = image.pipeline;
                } else if (image.upscaled) {
                    imageToShow = image.upscaled;
                } else if (image.original) {
                    imageToShow = image.original;
                }
                
                if (imageToShow) {
                    // Set up uploaded image data with the current image as placeholder
                    window.uploadedImageData = {
                        image_source: `file:${imageToShow}`,
                        width: data.width || 1024,
                        height: data.height || 1024,
                        bias: 2,
                        isBiasMode: true,
                        isClientSide: false,
                        isPlaceholder: true
                    };
                    
                    // Show the variation image
                    if (variationImage) {
                        variationImage.style.display = 'block';
                    }
                }
            }
            
            // Hide the image bias dropdown for pipeline images
            hideImageBiasDropdown();
            
            // Disable transformation dropdown for pipeline images
            const transformationDropdown = document.getElementById('transformationDropdown');
            if (transformationDropdown) {
                transformationDropdown.classList.add('disabled');
            }
            
            window.currentPipelineEdit = {
                isPipelineEdit: true,
                pipelineName: name,
                layer1Seed: data.layer1Seed
            };
        }

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
                const transformationSection = document.getElementById('transformationSection');
                if (transformationSection) {
                    transformationSection.classList.add('display-image');
                }
            }
            
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
                    renderImageBiasDropdown('custom');
                } else {
                    renderImageBiasDropdown(data.image_bias.toString());
                }
            }

            if (strengthValue && data.strength !== undefined && data.strength !== null) {
                strengthValue.value = data.strength;
                window.strengthValueLoaded = true;
            }
            if (noiseValue && data.noise !== undefined && data.noise !== null) {
                noiseValue.value = data.noise;
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
            const transformationSection = document.getElementById('transformationSection');
            if (transformationSection) {
                transformationSection.classList.remove('display-image');
            }
        }

        // Type-specific handling
        if (name) {
            manualPresetName.value = name;
        }

        if (type === 'pipeline') {
            // Pipeline-specific: disable preset name, etc.
            const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
            if (presetNameGroup) {
                presetNameGroup.style.display = 'block';
                manualPresetName.disabled = true;
                manualPresetName.style.opacity = '0.6';
            }
            const saveButton = document.getElementById('manualSaveBtn');
            if (saveButton) saveButton.style.display = 'none';
            window.currentPipelineEdit = {
                isPipelineEdit: true,
                pipelineName: name,
                layer1Seed: null
            };
        } else if (type === 'preset') {
            // Preset-specific
            const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
            if (presetNameGroup) {
                presetNameGroup.style.display = 'block';
                manualPresetName.disabled = false;
                manualPresetName.style.opacity = '1';
            }
            const saveButton = document.getElementById('manualSaveBtn');
            if (saveButton) saveButton.style.display = 'flex';
            window.currentPipelineEdit = null;
        } else if (type === 'metadata') {
            manualStrengthValue.value = (data.strength !== undefined && data.strength !== null) ? data.strength : 0.8;
            manualNoiseValue.value = (data.noise !== undefined && data.noise !== null) ? data.noise : 0.1;
            if (manualUpscale) manualUpscale.checked = false;
            // Load image into preview panel when loading from metadata
            if (image) {
                let imageToShow = image.filename;
                if (image.pipeline_upscaled) {
                    imageToShow = image.pipeline_upscaled;
                } else if (image.pipeline) {
                    imageToShow = image.pipeline;
                } else if (image.upscaled) {
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
        updateRequestTypeButtonVisibility();
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

function updateCustomResolutionValue() {
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
            
            // Check if we're in a pipeline edit context and update mask bias visibility
            if (window.currentPipelineEdit && !window.currentMaskData) {
                const pipelineName = window.currentPipelineEdit.pipelineName;
                const pipelinePresetRes = getPipelinePresetResolution(pipelineName);
                if (pipelinePresetRes) {
                    const presetDims = getDimensionsFromResolution(pipelinePresetRes);
                    if (presetDims) {
                        // Calculate aspect ratios
                        const presetAspectRatio = presetDims.width / presetDims.height;
                        const selectedAspectRatio = result.width / result.height;
                        
                        // Show/hide mask bias dropdown based on aspect ratio difference
                        if (Math.abs(presetAspectRatio - selectedAspectRatio) > 0.01) {
                            if (manualMaskBiasGroup) {
                                manualMaskBiasGroup.style.display = 'block';
                            }
                        } else {
                            if (manualMaskBiasGroup) {
                                manualMaskBiasGroup.style.display = 'none';
                            }
                        }
                    }
                }
            }
            
            // Update button grid orientation for mask bias
            const buttonGrid = manualMaskBiasDropdownBtn.querySelector('.mask-bias-grid');
            if (buttonGrid) {
                const width = parseInt(manualWidth.value);
                const height = parseInt(manualHeight.value);
                const isPortraitMode = height > width;
                buttonGrid.setAttribute('data-orientation', isPortraitMode ? 'portrait' : 'landscape');
            }
            
            // --- ADDED: Refresh preview image if in bias mode ---
            if (window.uploadedImageData && window.uploadedImageData.isBiasMode) {
                // Reset bias to center (2) when resolution changes
                const resetBias = 2;
                if (imageBiasHidden != null) {
                    imageBiasHidden.value = resetBias.toString();
                }
                window.uploadedImageData.bias = resetBias;
                
                // Re-crop and update preview with reset bias
                cropImageToResolution();
                
                // Re-render the dropdown options to reflect new resolution and reset bias
                renderImageBiasDropdown(resetBias.toString());
            }
        }
    }
}

function isValidPresetName(name) {
    if (!name) return false;
    return window.availablePresets && window.availablePresets.includes(name);
}

function updateManualPresetToggleBtn() {
    const presetName = manualPresetName.value.trim();
    const valid = isValidPresetName(presetName);
    if (valid) {
        // Hide the group, show the toggle button with value
        manualPresetGroup.style.display = 'none';
        manualPresetToggleBtn.style.display = '';
        manualPresetToggleBtn.classList.remove('toggle-btn');
        manualPresetToggleBtn.classList.add('hover-show');
        manualPresetToggleText.textContent = presetName;
        manualPresetToggleText.style.display = '';
    } else {
        // Show the group, hide the toggle button
        manualPresetGroup.style.display = '';
        manualPresetToggleBtn.style.display = 'none';
        manualPresetToggleBtn.classList.add('toggle-btn');
        manualPresetToggleBtn.classList.remove('hover-show');
        manualPresetToggleText.style.display = 'none';
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
        showSuccess(message);
      }
      
      // Update the hidden resolution value
      updateCustomResolutionValue();
      
      // Update button grid orientation for mask bias
      const buttonGrid = manualMaskBiasDropdownBtn.querySelector('.mask-bias-grid');
      if (buttonGrid) {
        const width = parseInt(manualWidth.value);
        const height = parseInt(manualHeight.value);
        const isPortraitMode = height > width;
        buttonGrid.setAttribute('data-orientation', isPortraitMode ? 'portrait' : 'landscape');
      }
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

function renderManualSamplerDropdown(selectedVal) {
  renderSimpleDropdown(manualSamplerDropdownMenu, SAMPLER_MAP, 'meta', 'display', selectManualSampler, closeManualSamplerDropdown, selectedVal);
}

function selectManualSampler(value) {
  manualSelectedSampler = value;
  const s = SAMPLER_MAP.find(s => s.meta.toLowerCase() === value.toLowerCase());
  if (s) {
    manualSamplerSelected.textContent = s.display;
  } else {
    manualSamplerSelected.textContent = 'Select sampler...';
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

// Mask Bias Dropdown Functions
function getMaskBiasOptions() {
    // Get current resolution to determine if we're in portrait or landscape mode
    const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
    const isPortrait = currentResolution.includes('portrait');
    const isLandscape = currentResolution.includes('landscape');
    
    // For custom resolutions, determine based on width/height
    if (currentResolution === 'custom' && manualWidth && manualHeight) {
        const width = parseInt(manualWidth.value);
        const height = parseInt(manualHeight.value);
        const isPortrait = height > width;
        const isLandscape = width > height;
    }
    
    if (isPortrait) {
        return [
            { value: '0', display: 'Top', icon: '⬆️' },
            { value: '1', display: 'Mid-Top', icon: '⬆️' },
            { value: '2', display: 'Center', icon: '⬆️' },
            { value: '3', display: 'Mid-Bottom', icon: '⬆️' },
            { value: '4', display: 'Bottom', icon: '⬆️' }
        ];
    } else {
        // Landscape or square - use same position names
        return [
            { value: '0', display: 'Left', icon: '⬅️' },
            { value: '1', display: 'Mid-Left', icon: '⬅️' },
            { value: '2', display: 'Center', icon: '⬅️' },
            { value: '3', display: 'Mid-Right', icon: '⬅️' },
            { value: '4', display: 'Right', icon: '⬅️' }
        ];
    }
}

function renderManualMaskBiasDropdown(selectedVal) {
    manualMaskBiasDropdownMenu.innerHTML = '';
    
    const maskBiasOptions = getMaskBiasOptions();
    
    maskBiasOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        optionElement.dataset.value = option.value;
        
        if (option.value === selectedVal) {
            optionElement.classList.add('selected');
        }
        
        // Determine grid layout based on aspect ratio
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        const isPortrait = currentResolution.includes('portrait');
        
        // For custom resolutions, determine based on width/height
        let isPortraitMode = isPortrait;
        if (currentResolution === 'custom' && manualWidth && manualHeight) {
            const width = parseInt(manualWidth.value);
            const height = parseInt(manualHeight.value);
            isPortraitMode = height > width;
        }
        
        // Create grid based on orientation
        let gridHTML = '';
        if (isPortraitMode) {
            // Portrait: 3 columns, 5 rows (vertical layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        } else {
            // Landscape: 5 columns, 3 rows (horizontal layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        }
        
        optionElement.innerHTML = `
            <div class="mask-bias-option-content">
                <div class="mask-bias-grid" data-bias="${option.value}" data-orientation="${isPortraitMode ? 'portrait' : 'landscape'}">
                    ${gridHTML}
                </div>
                <span class="mask-bias-label">${option.display}</span>
            </div>
        `;
        
        optionElement.addEventListener('click', () => {
            selectManualMaskBias(option.value);
            closeManualMaskBiasDropdown();
        });
        
        manualMaskBiasDropdownMenu.appendChild(optionElement);
    });
}

function selectManualMaskBias(value) {
    manualSelectedMaskBias = value;
    
    const maskBiasOptions = getMaskBiasOptions();
    const selectedOption = maskBiasOptions.find(option => option.value === value);
    
    if (selectedOption) {
        manualMaskBiasSelected.textContent = selectedOption.display;
    } else {
        manualMaskBiasSelected.textContent = 'Center';
    }
    
    // Update the button's grid preview
    const buttonGrid = manualMaskBiasDropdownBtn.querySelector('.mask-bias-grid');
    if (buttonGrid) {
        buttonGrid.setAttribute('data-bias', value);
        
        // Update orientation based on current resolution
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        const isPortrait = currentResolution.includes('portrait');
        
        // For custom resolutions, determine based on width/height
        let isPortraitMode = isPortrait;
        if (currentResolution === 'custom' && manualWidth && manualHeight) {
            const width = parseInt(manualWidth.value);
            const height = parseInt(manualHeight.value);
            isPortraitMode = height > width;
        }
        
        buttonGrid.setAttribute('data-orientation', isPortraitMode ? 'portrait' : 'landscape');
    }
    
    if (manualMaskBiasHidden) manualMaskBiasHidden.value = value;
}

function openManualMaskBiasDropdown() {
    manualMaskBiasDropdownMenu.style.display = 'block';
    manualMaskBiasDropdownBtn.classList.add('active');
}

function closeManualMaskBiasDropdown() {
    manualMaskBiasDropdownMenu.style.display = 'none';
    manualMaskBiasDropdownBtn.classList.remove('active');
}

// Mask Bias Dropdown Event Listeners
manualMaskBiasDropdownBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    
    if (manualMaskBiasDropdownMenu.style.display === 'block') {
        closeManualMaskBiasDropdown();
    } else {
        renderManualMaskBiasDropdown(manualSelectedMaskBias);
        openManualMaskBiasDropdown();
    }
});

// Close manual mask bias dropdown when clicking outside
document.addEventListener('click', e => {
    if (!manualMaskBiasDropdown.contains(e.target)) {
        closeManualMaskBiasDropdown();
    }
});

const modelOptionRenderer = (opt, group) => `<span>${opt.display}</span>`;

function renderManualModelDropdown(selectedVal) {
    renderGroupedDropdown(manualModelDropdownMenu, modelGroups, selectManualModel, closeManualModelDropdown, selectedVal, modelOptionRenderer);
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
    manualModelSelected.innerHTML = `${optObj.display}${groupObj.badge ? '<span class="custom-dropdown-badge">' + groupObj.badge + '</span>' : ''}`;
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
        (window.currentEditImage.filename || window.currentEditImage.original || window.currentEditImage.pipeline || window.currentEditImage.pipeline_upscaled)
    );
    
    // Check if this is an img2img (has base image) or pipeline image
    const isImg2Img = hasValidImage && window.currentEditMetadata.base_image === true;
    const isPipeline = hasValidImage && (window.currentEditImage.pipeline || window.currentEditImage.pipeline_upscaled);
    
    // Show reroll button only if there's a base image available (for img2img) or if it's a pipeline
    const shouldShowReroll = hasValidImage && (isImg2Img || isPipeline);
    
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
            const displayText = options[value] || 'Select';
            updateTransformationDropdownState(value, displayText);
            
            // Handle reroll/variation logic
            handleTransformationTypeChange(value);
            break;
    }
    
    // Update button states for reroll/variation
    updateRequestTypeButtonVisibility();
}

function handleTransformationTypeChange(requestType) {
        const variationRow = document.getElementById('transformationSection');
        const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
        const saveButton = document.getElementById('manualSaveBtn');
        const layer1SeedToggle = document.getElementById('layer1SeedToggle');
        const manualMaskBiasGroup = document.getElementById('manualMaskBiasGroup');
        const variationImage = document.getElementById('manualVariationImage');

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
        const filename = image.filename || image.original || image.pipeline || image.pipeline_upscaled;
        if (!filename) return;
        source = `file:${filename}`;
        previewUrl = `/images/${filename}`;
        // For pipeline, it might be pipeline image, but we can treat as base
    }

    window.uploadedImageData = {
        image_source: source,
        bias: bias,
        isBiasMode: true,
        isClientSide: false
    };
    
    // Show transformation section content
    const transformationSection = document.getElementById('transformationSection');
    if (transformationSection) {
        transformationSection.classList.add('display-image');
    }

    cropImageToResolution();
    updateInpaintButtonState();

    // Show bias dropdown
    renderImageBiasDropdown(bias.toString());

    // Hide preset name and save for variation
    if (presetNameGroup) presetNameGroup.style.display = 'none';
    if (saveButton) saveButton.style.display = 'none';
    if (layer1SeedToggle) layer1SeedToggle.style.display = 'none';
    if (manualMaskBiasGroup) manualMaskBiasGroup.style.display = 'none';

    // For pipeline specific
    if (requestType === 'reroll' && (image.pipeline || image.pipeline_upscaled)) {
        // Pipeline reroll logic, no uploadedImageData for image, but use pipeline endpoint in generation
        window.currentRequestType = 'pipeline_reroll';
        // Set other fields for pipeline
        if (presetNameGroup) {
            presetNameGroup.style.display = 'block';
            manualPresetName.disabled = true;
            manualPresetName.style.opacity = '0.6';
        }
        if (saveButton) saveButton.style.display = 'none';
        if (layer1SeedToggle) {
            layer1SeedToggle.style.display = 'inline-block';
            layer1SeedToggle.setAttribute('data-state', metadata.layer1Seed ? 'on' : 'off');
        }
        if (manualMaskBiasGroup) manualMaskBiasGroup.style.display = 'block';
        // ... other pipeline specific
    }

    updateRequestTypeButtonVisibility();
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
    if (transformationSelected) transformationSelected.textContent = text || 'Select';
    
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

// ==================== WORKSPACE MANAGEMENT ====================

// Reference workspace move functions
async function moveCacheToDefaultWorkspace(cacheImage) {
    try {
        const response = await fetchWithAuth('/workspaces/default/references', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes: [cacheImage.hash] })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move cache file');
        }
        
        showSuccess('Reference file moved to default workspace');
        await loadCacheImages();
        displayCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error moving cache file to default:', error);
        showError('Failed to move cache file: ' + error.message);
    }
}

function showCacheMoveToWorkspaceModal(cacheImage) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('cacheMoveToWorkspaceModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cacheMoveToWorkspaceModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Move to Workspace</h3>
                    <button id="closeCacheMoveToWorkspaceBtn" class="close-dialog">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Select workspace to move cache file:</p>
                    <div class="workspace-move-list" id="cacheMoveWorkspaceList">
                        <!-- Workspace list will be populated here -->
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Close modal handlers
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        document.getElementById('closeCacheMoveToWorkspaceBtn').addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    // Populate workspace list
    const workspaceList = document.getElementById('cacheMoveWorkspaceList');
    workspaceList.innerHTML = '';
    
    workspaces.forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-move-item';
        item.innerHTML = `
            <div class="workspace-move-info">
                <span class="workspace-name">${workspace.name}</span>
                ${workspace.isActive ? '<span class="badge-active">Active</span>' : ''}
            </div>
        `;
        
        item.addEventListener('click', async () => {
            modal.style.display = 'none';
            await moveCacheToWorkspace(cacheImage, workspace.id);
        });
        
        workspaceList.appendChild(item);
    });
    
    modal.style.display = 'block';
}

async function moveCacheToWorkspace(cacheImage, workspaceId) {
    try {
        const response = await fetchWithAuth(`/workspaces/${workspaceId}/references`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes: [cacheImage.hash] })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move cache file');
        }
        
        const workspace = workspaces.find(w => w.id === workspaceId);
        showSuccess(`Reference file moved to ${workspace ? workspace.name : 'workspace'}`);
        await loadCacheImages();
        displayCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error moving cache file to workspace:', error);
        showError('Failed to move cache file: ' + error.message);
    }
}

// Workspace API functions
async function loadWorkspaces() {
    try {
        const response = await fetchWithAuth('/workspaces', {
            method: 'OPTIONS'
        });
        if (!response.ok) throw new Error('Failed to load workspaces');
        
        const data = await response.json();
        workspaces = data.workspaces;
        activeWorkspace = data.activeWorkspace;
        
        // Update active workspace color
        const activeWorkspaceData = workspaces.find(w => w.id === activeWorkspace);
        if (activeWorkspaceData) {
            activeWorkspaceColor = activeWorkspaceData.color || '#124';
            updateBokehBackground();
        }
        
        renderWorkspaceDropdown();
        updateActiveWorkspaceDisplay();
        
        console.log('✅ Loaded workspaces:', workspaces.length);
    } catch (error) {
        console.error('Error loading workspaces:', error);
        showError('Failed to load workspaces: ' + error.message);
    }
}

// Initialize background layers with default color
function initializeBokehBackgrounds() {
    const currentBg = document.querySelector('.current-bg');
    const nextBg = document.querySelector('.next-bg');
    const bokeh = document.querySelector('.bokeh');
    
    if (currentBg) {
        currentBg.style.backgroundColor = 'transparent';
    }
    if (nextBg) {
        nextBg.style.opacity = '0';
        nextBg.style.backgroundColor = 'transparent';
    }
    if (bokeh) {
        bokeh.style.backgroundColor = addTransparency('#124', 0.5);
    }
}

// Load active workspace color for bokeh background
async function loadActiveWorkspaceColor() {
    try {
        const response = await fetchWithAuth('/workspaces/active/color');
        if (!response.ok) throw new Error('Failed to load workspace color');
        
        const data = await response.json();
        activeWorkspaceColor = data.color;
        activeWorkspaceBackgroundColor = data.backgroundColor;
        activeWorkspaceBackgroundImage = data.backgroundImage;
        activeWorkspaceBackgroundOpacity = data.backgroundOpacity || 0.3;
        updateBokehBackground();
        
        console.log('🎨 Loaded workspace settings:', {
            color: activeWorkspaceColor,
            backgroundColor: activeWorkspaceBackgroundColor,
            backgroundImage: activeWorkspaceBackgroundImage,
            backgroundOpacity: activeWorkspaceBackgroundOpacity
        });
    } catch (error) {
        console.error('Error loading workspace color:', error);
        // Use default values on error
        activeWorkspaceColor = '#124';
        activeWorkspaceBackgroundColor = null;
        activeWorkspaceBackgroundImage = null;
        activeWorkspaceBackgroundOpacity = 0.3;
        updateBokehBackground();
    }
}

// Animate workspace transition with bokeh circle movement
async function animateWorkspaceTransition() {
    const bokeh = document.querySelector('.bokeh');
    const currentBg = document.querySelector('.current-bg');
    const nextBg = document.querySelector('.next-bg');
    
    if (!bokeh || !currentBg || !nextBg) return;
    
    
    // Step 1: Move all circles off-screen (0.3s)
    console.log('🎬 Starting workspace transition animation');
    
    // Preload background image if it exists to prevent flickering
    if (activeWorkspaceBackgroundImage) {
        const img = new Image();
        img.src = `/images/${activeWorkspaceBackgroundImage}`;
        new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // Timeout after 2 seconds to prevent hanging
            setTimeout(resolve, 2000);
        }).catch(() => {
            console.warn('Failed to preload background image:', activeWorkspaceBackgroundImage);
        });
    }
    
    // Step 2: Update background with fade transition
    updateBokehBackgroundWithFade();
}

// Update bokeh background with fade transition between layers
async function updateBokehBackgroundWithFade() {
    const currentBg = document.querySelector('.current-bg');
    const nextBg = document.querySelector('.next-bg');
    const bokeh = document.querySelector('.bokeh');
    
    if (!currentBg || !nextBg || !bokeh) return;
    
    // Generate color variations based on the workspace color
    const baseColor = activeWorkspaceColor;
    const colorVariations = generateColorVariations(baseColor);
    
    // Update the bokeh circles with new colors and opacity
    const circles = bokeh.querySelectorAll('circle');
    circles.forEach((circle, index) => {
        const colorIndex = index % colorVariations.length;
        const color = colorVariations[colorIndex];
        // Make circles more opaque than background
        const circleOpacity = Math.min(1, activeWorkspaceBackgroundOpacity + 0.3);
        circle.style.fill = color;
        circle.style.opacity = circleOpacity;
    });
    
    // Set up the bokeh background color with transparency
    const backgroundColor = activeWorkspaceBackgroundColor || generateBackgroundColor(baseColor);
    const transparentColor = addTransparency(backgroundColor, 0.25); // 25% transparency
    bokeh.style.backgroundColor = transparentColor;
    
    // Set up the next background layer for images only
    if (activeWorkspaceBackgroundImage) {
        // Set background image on the div
        nextBg.style.backgroundImage = `url('/images/${activeWorkspaceBackgroundImage}')`;
        nextBg.style.backgroundSize = 'cover';
        nextBg.style.backgroundPosition = 'top center';
        nextBg.style.backgroundRepeat = 'no-repeat';
        nextBg.style.backgroundColor = 'transparent';
    } else {
        // No background image
        nextBg.style.backgroundImage = 'none';
        nextBg.style.backgroundColor = 'transparent';
    }
    
    // Fade from current to next background
    nextBg.style.opacity = '1';
    
    // Wait for the fade transition to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Swap the layers - copy all properties to ensure no flickering
    currentBg.style.backgroundImage = nextBg.style.backgroundImage;
    currentBg.style.backgroundSize = nextBg.style.backgroundSize;
    currentBg.style.backgroundPosition = nextBg.style.backgroundPosition;
    currentBg.style.backgroundRepeat = nextBg.style.backgroundRepeat;
    currentBg.style.backgroundColor = nextBg.style.backgroundColor;
    currentBg.style.backgroundBlendMode = nextBg.style.backgroundBlendMode || 'normal';
    
    // Reset next background - ensure it's completely transparent
    nextBg.style.opacity = '0';
    nextBg.style.backgroundImage = 'none';
    nextBg.style.backgroundColor = 'transparent';
    nextBg.style.backgroundBlendMode = 'normal';
    
    console.log('🎨 Updated bokeh background with fade:', {
        color: baseColor,
        backgroundColor: transparentColor,
        backgroundImage: activeWorkspaceBackgroundImage,
        opacity: activeWorkspaceBackgroundOpacity
    });
}

// Update bokeh background with workspace color (for initial load and non-animated updates)
function updateBokehBackground() {
    const currentBg = document.querySelector('.current-bg');
    const bokeh = document.querySelector('.bokeh');
    if (!currentBg || !bokeh) return;
    
    // Generate color variations based on the workspace color
    const baseColor = activeWorkspaceColor;
    const colorVariations = generateColorVariations(baseColor);
    
    // Update the bokeh circles with new colors and opacity
    const circles = bokeh.querySelectorAll('circle');
    circles.forEach((circle, index) => {
        const colorIndex = index % colorVariations.length;
        const color = colorVariations[colorIndex];
        // Make circles more opaque than background
        const circleOpacity = Math.min(1, activeWorkspaceBackgroundOpacity + 0.3);
        circle.style.fill = color;
        circle.style.opacity = circleOpacity;
    });
    
    // Update the bokeh background color with transparency
    const backgroundColor = activeWorkspaceBackgroundColor || generateBackgroundColor(baseColor);
    const transparentColor = addTransparency(backgroundColor, 0.25); // 25% transparency
    bokeh.style.backgroundColor = transparentColor;
    
    // Update the current background layer for images only
    if (activeWorkspaceBackgroundImage) {
        // Set background image on the div
        currentBg.style.backgroundImage = `url('/images/${activeWorkspaceBackgroundImage}')`;
        currentBg.style.backgroundSize = 'cover';
        currentBg.style.backgroundPosition = 'top center';
        currentBg.style.backgroundRepeat = 'no-repeat';
        currentBg.style.backgroundColor = 'transparent';
    } else {
        // No background image
        currentBg.style.backgroundImage = 'none';
        currentBg.style.backgroundColor = 'transparent';
    }
    
    console.log('🎨 Updated bokeh background:', {
        color: baseColor,
        backgroundColor: transparentColor,
        backgroundImage: activeWorkspaceBackgroundImage,
        opacity: activeWorkspaceBackgroundOpacity
    });
}

// Generate color variations for bokeh circles with more variety
function generateColorVariations(baseColor) {
    // Convert hex to HSL for better color manipulation
    const hsl = hexToHsl(baseColor);
    
    // Generate variations with different hue shifts, saturation, and lightness
    const variations = [
        baseColor, // Original color
        hslToHex(hsl.h, hsl.s, Math.min(100, hsl.l + 15)), // Lighter
        hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - 20)), // Darker
        hslToHex((hsl.h + 15) % 360, Math.min(100, hsl.s + 10), hsl.l), // Slightly different hue
        hslToHex((hsl.h - 10 + 360) % 360, Math.max(0, hsl.s - 15), hsl.l), // Complementary direction
        hslToHex(hsl.h, Math.max(0, hsl.s - 20), Math.min(100, hsl.l + 10)), // Less saturated, lighter
        hslToHex((hsl.h + 25) % 360, Math.min(100, hsl.s + 5), Math.max(0, hsl.l - 15)), // Different hue, darker
        hslToHex(hsl.h, Math.max(0, hsl.s - 10), Math.min(100, hsl.l + 20)), // Less saturated, much lighter
        hslToHex((hsl.h - 20 + 360) % 360, hsl.s, Math.max(0, hsl.l - 25)), // Different hue, much darker
        hslToHex(hsl.h, Math.min(100, hsl.s + 15), Math.max(0, hsl.l - 10)) // More saturated, darker
    ];
    
    return variations;
}

// Generate background color (darker, more muted version of workspace color)
function generateBackgroundColor(baseColor) {
    const hsl = hexToHsl(baseColor);
    // Create a darker, more muted background color
    return hslToHex(hsl.h, Math.max(0, hsl.s - 30), Math.max(0, hsl.l - 40));
}

// Helper function to convert hex to HSL
function hexToHsl(hex) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse hex values
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

// Helper function to convert HSL to hex
function hslToHex(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    
    if (0 <= h && h < 1/6) {
        r = c; g = x; b = 0;
    } else if (1/6 <= h && h < 1/3) {
        r = x; g = c; b = 0;
    } else if (1/3 <= h && h < 1/2) {
        r = 0; g = c; b = x;
    } else if (1/2 <= h && h < 2/3) {
        r = 0; g = x; b = c;
    } else if (2/3 <= h && h < 5/6) {
        r = x; g = 0; b = c;
    } else if (5/6 <= h && h <= 1) {
        r = c; g = 0; b = x;
    }
    
    const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
    const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
    const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');
    
    return `#${rHex}${gHex}${bHex}`;
}

// Helper function to add transparency to a hex color
function addTransparency(hexColor, alpha) {
    // Remove # if present
    hexColor = hexColor.replace('#', '');
    
    // Convert alpha to hex (0-255)
    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    
    // Return hex color with alpha
    return `#${hexColor}${alphaHex}`;
}

async function createWorkspace(name) {
    try {
        const response = await fetchWithAuth('/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create workspace');
        }
        
        await loadWorkspaces();
        await loadGallery(); // Refresh gallery to show new workspace filtering
        await loadCacheImages(); // Refresh cache browser to show new workspace filtering
        showSuccess(`Workspace "${name}" created successfully`);
    } catch (error) {
        console.error('Error creating workspace:', error);
        showError('Failed to create workspace: ' + error.message);
    }
}

async function renameWorkspace(id, newName) {
    try {
        if (id === 'default') return;
        const response = await fetchWithAuth(`/workspaces/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to rename workspace');
        }
    } catch (error) {
        console.error('Error renaming workspace:', error);
        showError('Failed to rename workspace: ' + error.message);
    }
}

async function deleteWorkspace(id) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete workspace');
        }
        
        await loadWorkspaces();
        await loadGallery(); // Refresh gallery to show updated filtering
        await loadCacheImages(); // Refresh cache browser to show updated filtering
        showSuccess('Workspace deleted and items moved to default');
    } catch (error) {
        console.error('Error deleting workspace:', error);
        showError('Failed to delete workspace: ' + error.message);
    }
}

async function dumpWorkspace(sourceId, targetId) {
    try {
        const response = await fetchWithAuth(`/workspaces/${sourceId}/dump`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to dump workspace');
        }
        
        await loadWorkspaces();
        await loadGallery(); // Refresh gallery
        await loadCacheImages(); // Refresh cache browser
        showSuccess('Workspace dumped successfully');
    } catch (error) {
        console.error('Error dumping workspace:', error);
        showError('Failed to dump workspace: ' + error.message);
    }
}

async function setActiveWorkspace(id) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/activate`, {
            method: 'PUT'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to set active workspace');
        }
        
        // Fade out gallery
        if (gallery) {
            gallery.style.transition = 'opacity 0.3s ease-out';
            gallery.style.opacity = '0';
        }
        
        // Wait for fade out
        await new Promise(resolve => setTimeout(resolve, 300));
        
        activeWorkspace = id;
        
        // Update workspace settings immediately
        const workspace = workspaces.find(w => w.id === id);
        if (workspace) {
            activeWorkspaceColor = workspace.color || '#124';
            activeWorkspaceBackgroundColor = workspace.backgroundColor;
            activeWorkspaceBackgroundImage = workspace.backgroundImage;
            activeWorkspaceBackgroundOpacity = workspace.backgroundOpacity || 0.3;
            
            // Trigger workspace transition animation
            await animateWorkspaceTransition();
        }
        
        loadWorkspaces();
        updateActiveWorkspaceDisplay();
        await loadGallery(); // Refresh gallery with new workspace filter
        await loadCacheImages(); // Refresh cache browser with new workspace filter
        
        // Fade in gallery
        if (gallery) {
            gallery.style.transition = 'opacity 0.3s ease-in';
            gallery.style.opacity = '1';
        }
        
        showSuccess('Active workspace changed');
    } catch (error) {
        console.error('Error setting active workspace:', error);
        showError('Failed to set active workspace: ' + error.message);
        
        // Ensure gallery is visible even on error
        if (gallery) {
            gallery.style.opacity = 1;
        }
    }
}

async function moveFilesToWorkspace(filenames, targetWorkspaceId) {
    try {
        const response = await fetchWithAuth(`/workspaces/${targetWorkspaceId}/files`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move files');
        }
        
        const result = await response.json();
        await loadGallery(); // Refresh gallery
        showSuccess(`Moved ${result.movedCount} files to workspace`);
    } catch (error) {
        console.error('Error moving files to workspace:', error);
        showError('Failed to move files: ' + error.message);
    }
}

// Update workspace color
async function updateWorkspaceColor(id, color) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/color`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace color');
        }
    } catch (error) {
        console.error('Error updating workspace color:', error);
        showError('Failed to update workspace color: ' + error.message);
    }
}

// Update workspace background color
async function updateWorkspaceBackgroundColor(id, backgroundColor) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/background-color`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backgroundColor })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace background color');
        }
    } catch (error) {
        console.error('Error updating workspace background color:', error);
        showError('Failed to update workspace background color: ' + error.message);
    }
}

// Update workspace background image
async function updateWorkspaceBackgroundImage(id, backgroundImage) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/background-image`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backgroundImage })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace background image');
        }
    } catch (error) {
        console.error('Error updating workspace background image:', error);
        showError('Failed to update workspace background image: ' + error.message);
    }
}

// Update workspace background opacity
async function updateWorkspaceBackgroundOpacity(id, backgroundOpacity) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/background-opacity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backgroundOpacity })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace background opacity');
        }
    } catch (error) {
        console.error('Error updating workspace background opacity:', error);
        showError('Failed to update workspace background opacity: ' + error.message);
    }
}

// Workspace UI functions
function renderWorkspaceDropdown(selectedVal) {
    const workspaceMenu = document.getElementById('workspaceDropdownMenu');
    if (!workspaceMenu) return;
    
    workspaceMenu.innerHTML = '';
    
    workspaces.forEach(workspace => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (workspace.isActive ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = workspace.id;
        
        option.innerHTML = `
            <div class="workspace-option-content">
                <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#124'}"></div>
                <span class="workspace-name">${workspace.name}</span>
                <span class="workspace-counts">${workspace.fileCount} files</span>
            </div>
        `;
        
        const action = () => {
            if (!workspace.isActive) {
                setActiveWorkspace(workspace.id);
            }
            closeWorkspaceDropdown();
        };
        
        option.addEventListener('click', action);
        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                action();
            }
        });
        
        workspaceMenu.appendChild(option);
    });
    
    // Update desktop workspace tabs
    renderWorkspaceTabs();
}

function updateActiveWorkspaceDisplay() {
    const workspaceSelected = document.getElementById('workspaceSelected');
    if (!workspaceSelected) return;
    
    const activeWorkspaceData = workspaces.find(w => w.id === activeWorkspace);
    if (activeWorkspaceData) {
        workspaceSelected.textContent = activeWorkspaceData.name;
    }
    
    // Update desktop workspace tabs
    renderWorkspaceTabs();
}

function openWorkspaceDropdown() {
    openDropdown(document.getElementById('workspaceDropdownMenu'), document.getElementById('workspaceDropdownBtn'));
}

function closeWorkspaceDropdown() {
    closeDropdown(document.getElementById('workspaceDropdownMenu'), document.getElementById('workspaceDropdownBtn'));
}

// Desktop workspace tabs functionality
function renderWorkspaceTabs() {
    const workspaceTabs = document.getElementById('workspaceTabs');
    if (!workspaceTabs) return;
    
    workspaceTabs.innerHTML = '';
    
    workspaces.forEach(workspace => {
        const tab = document.createElement('div');
        tab.className = 'workspace-tab' + (workspace.isActive ? ' active' : '');
        tab.dataset.workspaceId = workspace.id;
        
        // Use workspace color as background for active tab
        if (workspace.isActive) {
            const workspaceColor = workspace.color || '#124';
            tab.style.background = `${workspaceColor}89`;
            tab.style.color = '#ffffff';
            tab.style.borderColor = `${workspaceColor}88`;
        }
        
        tab.innerHTML = `
            <span class="workspace-name">${workspace.name}</span>
        `;
        
        const action = () => {
            if (!workspace.isActive) {
                setActiveWorkspace(workspace.id);
            }
        };
        
        tab.addEventListener('click', action);
        workspaceTabs.appendChild(tab);
    });
}

function renderWorkspaceManagementList() {
    const list = document.getElementById('workspaceManageList');
    if (!list) return;
    
    list.innerHTML = '';
    
    workspaces.forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-manage-item';
        
        item.innerHTML = `
            <div class="workspace-manage-info">
                <div class="workspace-header">
                    <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#124'}"></div>
                    <h5>${workspace.name} ${workspace.isActive ? '<span class="badge-active">Active</span>' : ''}</h5>
                </div>
                <span class="workspace-manage-counts">${workspace.fileCount} files, ${workspace.cacheFileCount} references</span>
            </div>
            <div class="workspace-manage-actions">
                <button type="button" class="btn-link" onclick="editWorkspaceSettings('${workspace.id}')" title="Workspace Settings">
                    <i class="fas fa-cog"></i>
                </button>
                ${!workspace.isDefault ? `
                    <button type="button" class="btn-link" onclick="editWorkspace('${workspace.id}', '${workspace.name}')" title="Rename">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="btn-link" onclick="showDumpWorkspaceModal('${workspace.id}', '${workspace.name}')" title="Dump">
                        <i class="fas fa-arrow-right"></i>
                    </button>
                    <button type="button" class="btn-link text-danger" onclick="confirmDeleteWorkspace('${workspace.id}', '${workspace.name}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        `;
        
        list.appendChild(item);
    });
}

// Workspace modal functions
function showWorkspaceManagementModal() {
    renderWorkspaceManagementList();
    const modal = document.getElementById('workspaceManageModal');
    if (modal) modal.style.display = 'block';
}

function hideWorkspaceManagementModal() {
    const modal = document.getElementById('workspaceManageModal');
    if (modal) modal.style.display = 'none';
}

function showAddWorkspaceModal() {
    currentWorkspaceOperation = { type: 'add' };
    document.getElementById('workspaceEditTitle').textContent = 'Add Workspace';
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'block';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'block';
    document.getElementById('workspaceNameInput').value = '';
    document.getElementById('workspaceColorInput').value = '#124';
    document.getElementById('workspaceBackgroundColorInput').value = '#0a1a2a';
    document.getElementById('workspaceBackgroundImageInput').value = '';
    document.getElementById('workspaceBackgroundImageInput').placeholder = 'No background image selected';
    document.getElementById('workspaceBackgroundOpacityInput').value = '0.3';
    document.getElementById('workspaceBackgroundOpacityInput').textContent = '30';
    const modal = document.getElementById('workspaceEditModal');
    if (modal) modal.style.display = 'block';
}

function editWorkspace(id, currentName) {
    currentWorkspaceOperation = { type: 'rename', id };
    document.getElementById('workspaceEditTitle').textContent = 'Rename Workspace';
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'none';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'none';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'none';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'none';
    document.getElementById('workspaceNameInput').value = currentName;
    const modal = document.getElementById('workspaceEditModal');
    if (modal) modal.style.display = 'block';
}

async function editWorkspaceSettings(id) {
    currentWorkspaceOperation = { type: 'settings', id };
    document.getElementById('workspaceEditTitle').textContent = 'Workspace Settings';
    
    // Show all form elements
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'block';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'block';
    
    // Get workspace data
    const workspace = workspaces.find(w => w.id === id);
    if (workspace) {
        // Set current values
        document.getElementById('workspaceNameInput').value = workspace.name;
        document.getElementById('workspaceColorInput').value = workspace.color || '#124';
        document.getElementById('workspaceBackgroundColorInput').value = workspace.backgroundColor || '#0a1a2a';
        document.getElementById('workspaceBackgroundOpacityInput').value = workspace.backgroundOpacity || 0.3;
        
        // Update opacity display
        const opacityValue = document.getElementById('workspaceBackgroundOpacityInput');
        if (opacityValue) {
            opacityValue.textContent = Math.round((workspace.backgroundOpacity || 0.3) * 100);
        }
        
        // Background images will be loaded when the modal is opened
        
        // Set background image if exists
        const backgroundImageInput = document.getElementById('workspaceBackgroundImageInput');
        if (backgroundImageInput) {
            backgroundImageInput.value = workspace.backgroundImage || '';
            backgroundImageInput.placeholder = workspace.backgroundImage ? workspace.backgroundImage : 'No background image selected';
        }
    }
    
    const modal = document.getElementById('workspaceEditModal');
    if (modal) modal.style.display = 'block';
}

function hideWorkspaceEditModal() {
    const modal = document.getElementById('workspaceEditModal');
    if (modal) modal.style.display = 'none';
    
    // Reset form
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'block';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'block';
    document.getElementById('workspaceNameInput').value = '';
    document.getElementById('workspaceColorInput').value = '#124';
    document.getElementById('workspaceBackgroundColorInput').value = '#0a1a2a';
    document.getElementById('workspaceBackgroundImageInput').value = '';
    document.getElementById('workspaceBackgroundImageInput').placeholder = 'No background image selected';
    document.getElementById('workspaceBackgroundOpacityInput').value = '0.3';
    document.getElementById('workspaceBackgroundOpacityInput').textContent = '30%';
    
    currentWorkspaceOperation = null;
}

function showDumpWorkspaceModal(sourceId, sourceName) {
    document.getElementById('dumpSourceWorkspaceName').textContent = sourceName;
    
    const select = document.getElementById('dumpTargetSelect');
    select.innerHTML = '';
    
    workspaces.forEach(workspace => {
        if (workspace.id !== sourceId) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            select.appendChild(option);
        }
    });
    
    currentWorkspaceOperation = { type: 'dump', sourceId };
    const modal = document.getElementById('workspaceDumpModal');
    if (modal) modal.style.display = 'block';
}

function hideWorkspaceDumpModal() {
    const modal = document.getElementById('workspaceDumpModal');
    if (modal) modal.style.display = 'none';
    currentWorkspaceOperation = null;
}

function confirmDeleteWorkspace(id, name) {
    if (confirm(`Are you sure you want to delete the workspace "${name}"?\n\nAll items will be moved to the default workspace.`)) {
        deleteWorkspace(id);
    }
}

// Initialize workspace system
function initializeWorkspaceSystem() {
    // Setup workspace dropdown using standard custom dropdown system
    const workspaceDropdown = document.getElementById('workspaceDropdown');
    const workspaceDropdownBtn = document.getElementById('workspaceDropdownBtn');
    const workspaceDropdownMenu = document.getElementById('workspaceDropdownMenu');
    
    setupDropdown(workspaceDropdown, workspaceDropdownBtn, workspaceDropdownMenu, renderWorkspaceDropdown, () => activeWorkspace);
    
    // Workspace action button events
    const workspaceManageBtn = document.getElementById('workspaceManageBtn');
    const workspaceAddBtn = document.getElementById('workspaceAddBtn');
    
    if (workspaceManageBtn) {
        workspaceManageBtn.addEventListener('click', () => {
            showWorkspaceManagementModal();
        });
    }
    
    if (workspaceAddBtn) {
        workspaceAddBtn.addEventListener('click', () => {
            showAddWorkspaceModal();
        });
    }
    
    // Modal close events
    document.getElementById('closeWorkspaceManageBtn')?.addEventListener('click', hideWorkspaceManagementModal);
    document.getElementById('closeWorkspaceEditBtn')?.addEventListener('click', hideWorkspaceEditModal);
    document.getElementById('closeWorkspaceDumpBtn')?.addEventListener('click', hideWorkspaceDumpModal);
    document.getElementById('workspaceCancelBtn')?.addEventListener('click', hideWorkspaceEditModal);
    document.getElementById('workspaceDumpCancelBtn')?.addEventListener('click', hideWorkspaceDumpModal);
    
    // Background image modal close events
    document.getElementById('closeBackgroundImageModalBtn')?.addEventListener('click', hideBackgroundImageModal);
    document.getElementById('backgroundImageCancelBtn')?.addEventListener('click', hideBackgroundImageModal);
    
    // Bulk change preset modal events
    document.getElementById('closeBulkChangePresetBtn')?.addEventListener('click', () => {
        document.getElementById('bulkChangePresetModal').style.display = 'none';
    });
    document.getElementById('bulkChangePresetCancelBtn')?.addEventListener('click', () => {
        document.getElementById('bulkChangePresetModal').style.display = 'none';
    });
    document.getElementById('bulkChangePresetConfirmBtn')?.addEventListener('click', handleBulkChangePresetConfirm);
    
    // Save workspace
    document.getElementById('workspaceSaveBtn')?.addEventListener('click', async () => {
        if (currentWorkspaceOperation) {
            if (currentWorkspaceOperation.type === 'add') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                const color = document.getElementById('workspaceColorInput').value.trim();
                const backgroundColor = document.getElementById('workspaceBackgroundColorInput').value.trim();
                const backgroundImage = document.getElementById('workspaceBackgroundImageInput').value.trim();
                const backgroundOpacity = parseFloat(document.getElementById('workspaceBackgroundOpacityInput').value);
                
                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }
                // Create workspace with just the name
                await createWorkspace(name);
                // Get the newly created workspace ID and update its settings
                await loadWorkspaces();
                const newWorkspace = workspaces.find(w => w.name === name);
                if (newWorkspace) {
                    await Promise.all([
                        updateWorkspaceColor(newWorkspace.id, color),
                        updateWorkspaceBackgroundColor(newWorkspace.id, backgroundColor || null),
                        updateWorkspaceBackgroundImage(newWorkspace.id, backgroundImage || null),
                        updateWorkspaceBackgroundOpacity(newWorkspace.id, backgroundOpacity)
                    ]);
                    await loadWorkspaces();
                }
            } else if (currentWorkspaceOperation.type === 'rename') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }
                await renameWorkspace(currentWorkspaceOperation.id, name);
            } else if (currentWorkspaceOperation.type === 'settings') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                const color = document.getElementById('workspaceColorInput').value.trim();
                const backgroundColor = document.getElementById('workspaceBackgroundColorInput').value.trim();
                const backgroundImage = document.getElementById('workspaceBackgroundImageInput').value.trim();
                const backgroundOpacity = parseFloat(document.getElementById('workspaceBackgroundOpacityInput').value);
                
                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }
                
                // Update all settings
                await Promise.all([
                    renameWorkspace(currentWorkspaceOperation.id, name),
                    updateWorkspaceColor(currentWorkspaceOperation.id, color),
                    updateWorkspaceBackgroundColor(currentWorkspaceOperation.id, backgroundColor || null),
                    updateWorkspaceBackgroundImage(currentWorkspaceOperation.id, backgroundImage || null),
                    updateWorkspaceBackgroundOpacity(currentWorkspaceOperation.id, backgroundOpacity)
                ]);
                await loadWorkspaces();
        
                // Update bokeh background if this is the active workspace
                if (currentWorkspaceOperation.id === activeWorkspace) {
                    activeWorkspaceBackgroundOpacity = backgroundOpacity;
                    activeWorkspaceBackgroundImage = backgroundImage;
                    activeWorkspaceBackgroundColor = backgroundColor;
                    activeWorkspaceColor = color;
                    animateWorkspaceTransition();
                }
            }
        }
        
        hideWorkspaceEditModal();
        hideWorkspaceManagementModal();
    });
    
    // Dump workspace
    document.getElementById('workspaceDumpConfirmBtn')?.addEventListener('click', async () => {
        const targetId = document.getElementById('dumpTargetSelect').value;
        if (!targetId) {
            showError('Please select a target workspace');
            return;
        }
        
        if (currentWorkspaceOperation && currentWorkspaceOperation.type === 'dump') {
            await dumpWorkspace(currentWorkspaceOperation.sourceId, targetId);
        }
        
        hideWorkspaceDumpModal();
        hideWorkspaceManagementModal();
    });
    
    // Add wheel event for workspace background opacity input
    const opacityInput = document.getElementById('workspaceBackgroundOpacityInput');
    if (opacityInput) {
        opacityInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const step = parseFloat(opacityInput.step) || 0.01;
            let value = parseFloat(opacityInput.value) || 0.3;
            if (e.deltaY < 0) {
                value += step;
            } else {
                value -= step;
            }
            value = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
            opacityInput.value = value;
            opacityInput.dispatchEvent(new Event('input', { bubbles: true }));
        }, { passive: false });
    }
}

// Initialize workspace settings form event listeners
function initializeWorkspaceSettingsForm() {
    // Background image selection button
    const selectBackgroundImageBtn = document.getElementById('selectBackgroundImageBtn');
    if (selectBackgroundImageBtn) {
        selectBackgroundImageBtn.addEventListener('click', () => {
            showBackgroundImageModal();
        });
    }
}

// Background Image Selection Modal Functions
let selectedBackgroundImage = null;

async function showBackgroundImageModal() {
    const modal = document.getElementById('backgroundImageModal');
    const grid = document.getElementById('backgroundImageGrid');
    const loading = document.getElementById('backgroundImageLoading');
    const searchInput = document.getElementById('backgroundImageSearchInput');
    
    if (!modal || !grid || !loading) return;
    
    // Show modal
    modal.style.display = 'block';
    
    // Show loading
    loading.style.display = 'flex';
    grid.innerHTML = '';
    
    try {
        // Get current workspace images
        const workspaceImages = await getWorkspaceImages();
        
        // Hide loading
        loading.style.display = 'none';
        
        // Populate grid
        populateBackgroundImageGrid(workspaceImages);
        
        // Set up search functionality
        setupBackgroundImageSearch(searchInput, workspaceImages);
        
        // Set up selection handlers
        setupBackgroundImageSelection();
        
    } catch (error) {
        console.error('Error loading background images:', error);
        loading.style.display = 'none';
        grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Error loading images</p>';
    }
}

async function getWorkspaceImages() {
    try {
        // Get current workspace ID
        const workspaceId = currentWorkspaceOperation?.id || activeWorkspace;
        // Get workspace files from backend
        const workspaceResponse = await fetchWithAuth(`/workspaces/${workspaceId}/files`);
        if (!workspaceResponse.ok) throw new Error('Failed to load workspace files');
        
        const workspaceData = await workspaceResponse.json();
        const workspaceFiles = new Set(workspaceData.files || []);
        
        // Get all images from the filesystem (not filtered by active workspace)
        const allImagesResponse = await fetchWithAuth('/images/all');
        if (!allImagesResponse.ok) throw new Error('Failed to load all images');
        
        const allImagesItems = await allImagesResponse.json();
        
        // Filter images to only include workspace files
        const filteredImages = allImagesItems.filter(img => {
            const file = img.pipeline_upscaled || img.pipeline || img.upscaled || img.original;
            return workspaceFiles.has(file);
        });
        
        return filteredImages;
    } catch (error) {
        console.error('Error getting workspace images:', error);
        return [];
    }
}

function populateBackgroundImageGrid(images) {
    const grid = document.getElementById('backgroundImageGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    images.forEach(img => {
        const file = img.pipeline_upscaled || img.pipeline || img.upscaled || img.original;
        const preview = img.preview;
        
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'background-image-option';
        option.dataset.filename = file;
        
        option.innerHTML = `
            <div class="background-image-thumbnail" style="background-image: url('/previews/${preview}')"></div>
        `;
        
        grid.appendChild(option);
    });
}

function setupBackgroundImageSearch(searchInput, allImages) {
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const grid = document.getElementById('backgroundImageGrid');
        const options = grid.querySelectorAll('.background-image-option');
        
        options.forEach(option => {
            const filename = option.dataset.filename.toLowerCase();
            if (filename.includes(searchTerm)) {
                option.style.display = 'flex';
            } else {
                option.style.display = 'none';
            }
        });
    });
}

function setupBackgroundImageSelection() {
    const grid = document.getElementById('backgroundImageGrid');
    const noImageBtn = document.getElementById('noBackgroundImageBtn');
    
    // Clear previous selections
    const allOptions = document.querySelectorAll('.background-image-option');
    allOptions.forEach(option => option.classList.remove('selected'));
    if (noImageBtn) noImageBtn.classList.remove('selected');
    
    // Set current selection
    const currentInput = document.getElementById('workspaceBackgroundImageInput');
    const currentValue = currentInput ? currentInput.value : '';
    
    if (!currentValue) {
        if (noImageBtn) noImageBtn.classList.add('selected');
    } else {
        const selectedOption = grid.querySelector(`[data-filename="${currentValue}"]`);
        if (selectedOption) selectedOption.classList.add('selected');
    }
    
    // Add click handlers
    if (noImageBtn) {
        noImageBtn.addEventListener('click', () => {
            selectBackgroundImage(null);
        });
    }
    
    const options = grid.querySelectorAll('.background-image-option');
    options.forEach(option => {
        option.addEventListener('click', () => {
            const filename = option.dataset.filename;
            selectBackgroundImage(filename);
        });
    });
}

function selectBackgroundImage(filename) {
    selectedBackgroundImage = filename;
    
    // Update visual selection
    const allOptions = document.querySelectorAll('.background-image-option');
    const noImageBtn = document.getElementById('noBackgroundImageBtn');
    
    allOptions.forEach(option => option.classList.remove('selected'));
    if (noImageBtn) noImageBtn.classList.remove('selected');
    
    if (!filename) {
        if (noImageBtn) noImageBtn.classList.add('selected');
    } else {
        const selectedOption = document.querySelector(`[data-filename="${filename}"]`);
        if (selectedOption) selectedOption.classList.add('selected');
    }
    
    // Update input field
    const input = document.getElementById('workspaceBackgroundImageInput');
    if (input) {
        input.value = filename || '';
        input.placeholder = filename ? filename : 'No background image selected';
    }
    
    // Close modal
    hideBackgroundImageModal();
}

function hideBackgroundImageModal() {
    const modal = document.getElementById('backgroundImageModal');
    if (modal) modal.style.display = 'none';
    
    // Clear search
    const searchInput = document.getElementById('backgroundImageSearchInput');
    if (searchInput) searchInput.value = '';
    
    selectedBackgroundImage = null;
}

// Scraps functionality
let isViewingScraps = false;
let scrapsImages = [];

// Toggle between images and scraps
function toggleGalleryView() {
    isViewingScraps = !isViewingScraps;
    const toggleBtn = document.getElementById('galleryToggleBtn');
    
    if (isViewingScraps) {
        toggleBtn.innerHTML = '<i class="nai-image-tool-sketch"></i>';
        toggleBtn.setAttribute('data-state', 'scraps');
        loadScraps();
    } else {
        toggleBtn.innerHTML = '<i class="nai-image-count"></i>';
        toggleBtn.setAttribute('data-state', 'images');
        loadGallery();
    }

    toggleBtn.setAttribute('data-state', isViewingScraps ? 'on' : 'off');
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

// Move image to scraps
async function moveToScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled || image.pipeline || image.pipeline_upscaled;
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
            showSuccess('Image moved to scraps');
            
            // If currently viewing scraps, reload them
            if (isViewingScraps) {
                await loadScraps();
            } else {
                // If viewing images, reload the gallery to remove the moved image
                await loadGallery();
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
        const filename = currentManualPreviewImage.filename || currentManualPreviewImage.original || currentManualPreviewImage.upscaled || currentManualPreviewImage.pipeline || currentManualPreviewImage.pipeline_upscaled;
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
                img.upscaled === currentManualPreviewImage.upscaled ||
                img.pipeline === currentManualPreviewImage.pipeline ||
                img.pipeline_upscaled === currentManualPreviewImage.pipeline_upscaled
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
                
                showGlassToast('success', 'Scrap Image', 'Image moved to scraps!');
            } else {
                // No next image, reset the preview
                resetManualPreview();
                showGlassToast('success', 'Scrap Image', 'Image moved to scraps!');
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
        const filename = image.filename || image.original || image.upscaled || image.pipeline || image.pipeline_upscaled;
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
            showGlassToast('success', 'Scrap Image', 'Image removed from scraps');
            
            // If currently viewing scraps, reload them
            if (isViewingScraps) {
                await loadScraps();
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

document.addEventListener('DOMContentLoaded', async function() {
    // Initialize background layers
    initializeBokehBackgrounds();
    
    try {
        // Calculate initial images per page based on current window size
        galleryRows = calculateGalleryRows();
        imagesPerPage = galleryColumnsInput.value * galleryRows;  
        
        await loadOptions();
        await loadWorkspaces(); // Load workspace data
        await loadActiveWorkspaceColor(); // Load workspace color for bokeh
        await loadBalance();
        await updateImageGenCounter();
        await loadAvailablePresets();
        await loadVibeReferences(); // Load vibe references for immediate use
        renderManualSamplerDropdown(manualSelectedSampler);
        selectManualSampler('k_euler_ancestral');
        renderManualResolutionDropdown(manualSelectedResolution);
        selectManualResolution('normal_square', 'Normal');
        renderManualNoiseSchedulerDropdown(manualSelectedNoiseScheduler);
        selectManualNoiseScheduler('karras');
        renderManualMaskBiasDropdown(manualSelectedMaskBias);
        selectManualMaskBias('2');
        renderManualModelDropdown(manualSelectedModel);
        selectManualModel('v4_5', '');

        // Initialize new dropdowns
        renderDatasetDropdown();
        updateDatasetDisplay();
        renderDatasetBiasControls();
        renderUcPresetsDropdown();
        selectUcPreset(0);

        await loadGallery();
        updateGenerateButton();
        
        // Initialize image bias adjustment functionality
        initializeImageBiasAdjustment();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load application data');
    }

    // Initialize background gradient
    setupEventListeners();
    
    // Initialize workspace system
    initializeWorkspaceSystem();
    
    // Initialize workspace settings form event listeners
    initializeWorkspaceSettingsForm();
    
    // Initialize cache manager
    initializeCacheManager();
    
    // Initialize emphasis highlighting for manual fields
    if (manualPrompt) {
        initializeEmphasisOverlay(manualPrompt);
    }
    if (manualUc) {
        initializeEmphasisOverlay(manualUc);
    }
});

// Global options data
let optionsData = null;

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
        label.textContent = dataset.charAt(0).toUpperCase() + dataset.slice(1) + ' Bias';
        
        const inputGroup = document.createElement('div');
        inputGroup.className = 'form-row';
        
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'form-control hover-show';
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
        if (window.datasetOptions && window.datasetOptions[dataset] && window.datasetOptions[dataset].sub_toggles) {
            window.datasetOptions[dataset].sub_toggles.forEach(subToggle => {
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
    
    const presets = [
        { value: 0, display: 'None' },
        { value: 1, display: 'Human Focus' },
        { value: 2, display: 'Light' },
        { value: 3, display: 'Heavy' }
    ];
    
    presets.forEach(preset => {
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
    manualPreviewCloseBtn.addEventListener('click', hideManualModal);
    
    // Update save button state when preset name changes
    const presetNameInput = document.getElementById('manualPresetName');
    if (presetNameInput) {
        presetNameInput.addEventListener('input', () => {
            updateSaveButtonState();
            validatePresetWithTimeout();
            manualPresetToggleText.textContent = presetNameInput.value.trim();
        });
        presetNameInput.addEventListener('keyup', () => {
            updateSaveButtonState();
            validatePresetWithTimeout();
            manualPresetToggleText.textContent = presetNameInput.value.trim();
        });
        presetNameInput.addEventListener('change', () => {
            updateSaveButtonState();
            validatePresetWithTimeout();
            manualPresetToggleText.textContent = presetNameInput.value.trim();
        });
    }
    
    // Add load button click handler
    const loadBtn = document.getElementById('manualLoadBtn');
    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            const presetNameInput = document.getElementById('manualPresetName');
            if (presetNameInput) {
                const presetName = presetNameInput.value.trim();
                if (presetName) {
                    loadPresetIntoForm(presetName);
                }
            }
        });
    }
    manualForm.addEventListener('submit', handleManualGeneration);
    manualSaveBtn.addEventListener('click', handleManualSave);
    
    // Manual preview control events    
    if (manualPreviewDownloadBtn) {
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
    }
    
    if (manualPreviewUpscaleBtn) {
        manualPreviewUpscaleBtn.addEventListener('click', () => {
            if (currentManualPreviewImage) {
                upscaleImage(currentManualPreviewImage);
            } else {
                showGlassToast('error', 'Upscale Failed', 'No image available');
            }
        });
    }
    
    if (manualPreviewLoadBtn) {
        manualPreviewLoadBtn.addEventListener('click', () => {
            if (currentManualPreviewImage) {
                rerollImageWithEdit(currentManualPreviewImage);
            } else {
                showGlassToast('error', 'Load Failed', 'No image available');
            }
        });
    }
    
    if (manualPreviewVariationBtn) {
        manualPreviewVariationBtn.addEventListener('click', () => {
            if (currentManualPreviewImage) {
                // For preview, only set the base image without replacing dialog contents
                const filename = currentManualPreviewImage.original || currentManualPreviewImage.pipeline || currentManualPreviewImage.pipeline_upscaled;
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
                    const variationImage = document.getElementById('manualVariationImage');
                    if (variationImage) {
                        variationImage.src = previewUrl;
                        variationImage.style.display = 'block';
                    }

                    // Set strength to 0.8 and noise to 0.1 for variation
                    const strengthValue = document.getElementById('manualStrengthValue');
                    const noiseValue = document.getElementById('manualNoiseValue');
                    if (strengthValue) strengthValue.value = '0.8';
                    if (noiseValue) noiseValue.value = '0.1';

                    // Set transformation type to variation
                    updateTransformationDropdownState('variation', 'Variation');

                    // Show transformation section content
                    const transformationSection = document.getElementById('transformationSection');
                    if (transformationSection) {
                        transformationSection.classList.add('display-image');
                    }
                    
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
    }
    
    if (manualPreviewSeedBtn) {
        manualPreviewSeedBtn.addEventListener('click', () => {
            if (window.lastGeneratedSeed) {
                manualSeed.value = window.lastGeneratedSeed;
            } else {
                showGlassToast('error', 'Load Failed', 'No seed available');
            }
        });
    }
    
    if (manualPreviewDeleteBtn) {
        manualPreviewDeleteBtn.addEventListener('click', deleteManualPreviewImage);
    }
    
    if (manualPreviewScrapBtn) {
        manualPreviewScrapBtn.addEventListener('click', () => {
            if (currentManualPreviewImage) {
                if (isViewingScraps) {
                    removeFromScraps(currentManualPreviewImage);
                } else {
                    moveManualPreviewToScraps();
                }
            } else {
                showGlassToast('error', 'Load Failed', 'No image available');
            }
        });
    }
    
    // Clear seed button
    clearSeedBtn.addEventListener('click', clearSeed);
    
    // Layer1 seed toggle
    layer1SeedToggle.addEventListener('click', toggleLayer1Seed);
    
    // Paid request toggle
    const paidRequestToggle = document.getElementById('paidRequestToggle');
    if (paidRequestToggle) {
        paidRequestToggle.addEventListener('click', () => {
            forcePaidRequest = !forcePaidRequest;
            paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
        });
    }
    
    // Dataset dropdown
    if (datasetDropdownBtn) {
        setupDropdown(datasetDropdown, datasetDropdownBtn, datasetDropdownMenu, renderDatasetDropdown, () => selectedDatasets);
    }
    
    // Quality toggle
    if (qualityToggleBtn) {
        qualityToggleBtn.addEventListener('click', toggleQuality);
    }
    
    // Vibe normalize toggle
    const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
    if (vibeNormalizeToggle) {
        vibeNormalizeToggle.addEventListener('click', () => {
            const currentState = vibeNormalizeToggle.getAttribute('data-state') === 'on';
            const newState = !currentState;
            vibeNormalizeToggle.setAttribute('data-state', newState ? 'on' : 'off');
        });
    }
    
    // UC Presets dropdown
    if (ucPresetsDropdownBtn) {
        setupDropdown(ucPresetsDropdown, ucPresetsDropdownBtn, ucPresetsDropdownMenu, renderUcPresetsDropdown, () => selectedUcPreset);
    }
    
    function syncSliderWithInput(slider, input, min, max, step) {
        if (!slider || !input) return;
        // Slider -> Input
        slider.addEventListener('input', function() {
            input.value = this.value;
        });
        // Input -> Slider
        input.addEventListener('input', function() {
            let val = parseFloat(this.value);
            if (isNaN(val)) val = min;
            val = Math.max(min, Math.min(max, val));
            slider.value = val;
            this.value = val;
        });
        // Mouse wheel on input
        input.addEventListener('wheel', function(e) {
            e.preventDefault();
            let val = parseFloat(this.value) || min;
            const delta = e.deltaY > 0 ? -step : step;
            val = Math.max(min, Math.min(max, +(val + delta).toFixed(2)));
            this.value = val;
            slider.value = val;
        });
    }
    syncSliderWithInput(manualStrengthValue, manualStrengthValue, 0.0, 1.0, 0.01);
    syncSliderWithInput(manualNoiseValue, manualNoiseValue, 0.0, 1.0, 0.01);

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
    
    // Character detail events - no longer needed since we're using inline onclick handlers
    // The close button is now created dynamically in the character detail content

    // Lightbox events
    if (lightboxCloseBtn) {
        lightboxCloseBtn.addEventListener('click', hideLightbox);
    }
    
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
            } else if (lightboxModal.style.display === 'block') {
                hideLightbox();
            } else if (metadataDialog.style.display === 'block') {
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
            if (lightboxModal.style.display === 'block') {
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
        }
    });


    // Generation controls
    presetSelect.addEventListener('change', updateGenerateButton);
    generateBtn.addEventListener('click', generateImage);
    
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

    // Request type toggle functionality
    
    
    
    if (inpaintBtn) {
        inpaintBtn.addEventListener('click', () => {
            // Always open the mask editor when inpaint button is clicked
            openMaskEditor();
        });
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
    const cacheBrowserTabButtons = document.querySelectorAll('.cache-browser-tabs .tab-btn');
    cacheBrowserTabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            switchCacheBrowserTab(targetTab);
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

    // Add event listener for mask bias changes
    if (manualMaskBiasHidden) {
        manualMaskBiasHidden.addEventListener('change', handleMaskBiasChange);
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
    
    // Handle viewport changes for manual modal preview
    window.addEventListener('resize', () => {
        const manualModal = document.getElementById('manualModal');
        const isWideViewport = window.innerWidth >= 1400;
        const isManualModalOpen = manualModal && manualModal.style.display === 'block';
        
        // If switching from wide to narrow viewport and modal is open, reset preview
        if (!isWideViewport && isManualModalOpen) {
            resetManualPreview();
        }
    });
    
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
    const bulkChangePresetBtn = document.getElementById('bulkChangePresetBtn');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    
    if (bulkMoveToWorkspaceBtn) {
        bulkMoveToWorkspaceBtn.addEventListener('click', handleBulkMoveToWorkspace);
    }
    
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    }
    
    if (bulkSequenziaBtn) {
        bulkSequenziaBtn.addEventListener('click', handleBulkSequenzia);
    }
    
    if (bulkMoveToScrapsBtn) {
        bulkMoveToScrapsBtn.addEventListener('click', handleBulkMoveToScraps);
    }
    
    if (bulkChangePresetBtn) {
        bulkChangePresetBtn.addEventListener('click', handleBulkChangePreset);
    }
    
    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', clearSelection);
    }

    // Character prompts event listeners
    const addCharacterBtn = document.getElementById('addCharacterBtn');
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
    const manualTabButtons = document.querySelectorAll('#manualModal .prompt-tabs .tab-buttons .tab-btn');
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

    // Update the click event for manualPresetToggleBtn to toggle the group and button state
    manualPresetToggleBtn.addEventListener('click', function() {
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
        }
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

    // Gallery toggle button
    const galleryToggleBtn = document.getElementById('galleryToggleBtn');
    if (galleryToggleBtn) {
        galleryToggleBtn.addEventListener('click', toggleGalleryView);
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

    // Infinite scroll
    window.addEventListener('scroll', handleInfiniteScroll);
}

// Tab switching functionality for prompt/UC tabs (Manual Generation Model)
function switchManualTab(targetTab) {
    // Target ONLY the tab buttons within the manual modal's prompt-tabs section
    const tabButtons = document.querySelectorAll('#manualModal .prompt-tabs .tab-buttons .tab-btn');
    // Target ONLY the tab panes within the manual modal's prompt-tabs section
    const tabPanes = document.querySelectorAll('#manualModal .prompt-tabs .tab-content .tab-pane');
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    
    // Remove show-both state
    promptTabs.classList.remove('show-both');
    showBothBtn.classList.remove('active');
    
    // Remove active class from all buttons and panes
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabPanes.forEach(pane => pane.classList.remove('active'));
    
    // Add active class to clicked button and corresponding pane
    const targetButton = document.querySelector(`#manualModal .prompt-tabs .tab-buttons .tab-btn[data-tab="${targetTab}"]`);
    const targetPane = document.getElementById(`${targetTab}-tab`);
    
    if (targetButton) targetButton.classList.add('active');
    if (targetPane) targetPane.classList.add('active');
}

// Show both panes functionality for manual generation model
function toggleManualShowBoth() {
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    // Target ONLY the tab buttons within the manual modal's prompt-tabs section
    const tabButtons = document.querySelectorAll('#manualModal .prompt-tabs .tab-buttons .tab-btn');
    // Target ONLY the tab panes within the manual modal's prompt-tabs section
    const tabPanes = document.querySelectorAll('#manualModal .prompt-tabs .tab-content .tab-pane');
    const tabButtonsContainer = document.querySelector('#manualModal .prompt-tabs .tab-buttons');
    
    const isShowingBoth = promptTabs.classList.contains('show-both');
    
    if (isShowingBoth) {
        // Return to single tab mode
        promptTabs.classList.remove('show-both');
        showBothBtn.classList.remove('active');
        
        // Show tab buttons container
        if (tabButtonsContainer) {
            tabButtonsContainer.style.display = '';
        }
        
        // Set Base Prompt as default when returning from show both mode
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabPanes.forEach(pane => pane.classList.remove('active'));
        
        // Activate the Base Prompt tab
        const promptTabBtn = document.querySelector('#manualModal .prompt-tabs .tab-buttons .tab-btn[data-tab="prompt"]');
        const promptTabPane = document.getElementById('prompt-tab');
        
        if (promptTabBtn && promptTabPane) {
            promptTabBtn.classList.add('active');
            promptTabPane.classList.add('active');
        }
    } else {
        // Show both panes
        promptTabs.classList.add('show-both');
        showBothBtn.classList.add('active');
        
        // Hide tab buttons container when showing both
        if (tabButtonsContainer) {
            tabButtonsContainer.style.display = 'none';
        }
    }
}

// Tab switching functionality for character prompt tabs
function switchCharacterTab(characterId, targetTab) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;
    
    const characterTabButtons = characterItem.querySelectorAll('.tab-btn');
    const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
    
    // Remove active class from all buttons and panes
    characterTabButtons.forEach(btn => btn.classList.remove('active'));
    characterTabPanes.forEach(pane => pane.classList.remove('active'));
    
    // Add active class to clicked button and corresponding pane
    const targetButton = characterItem.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    const targetPane = document.getElementById(`${characterId}_${targetTab}-tab`);
    
    if (targetButton) targetButton.classList.add('active');
    if (targetPane) targetPane.classList.add('active');
}

let presets, pipelines, resolutions, models, modelsNames, modelsShort, textReplacements, samplers, noiseSchedulers;
// Load options from server
async function loadOptions() {
    try {
        const response = await fetchWithAuth('/', { method: 'OPTIONS' });
        if (!response.ok) throw new Error('Failed to load options');
        
        const options = await response.json();
        
        // Populate presets
        presets = options.presets;
        pipelines = options.pipelines || [];

        // Populate resolutions using global RESOLUTIONS array
        resolutions = RESOLUTIONS.map(r => r.value);
        manualResolution.innerHTML = '<option value="">Unchanged</option>';
        RESOLUTIONS.forEach(resolution => {
            const manualOption = document.createElement('option');
            manualOption.value = resolution.value;
            manualOption.textContent = resolution.display;
            manualResolution.appendChild(manualOption);
        });

        // Populate models for manual form
        models = Object.keys(options.models);
        modelsNames = options.models;
        modelsShort = options.modelsShort;
        manualModel.innerHTML = '<option value="">Select model...</option>';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.toLowerCase(); // Use lowercase to match config
            option.textContent = options.models[model]; // Use pretty display name
            manualModel.appendChild(option);
        });



        // Store text replacements for autocomplete
        textReplacements = options.textReplacements || {};

        // Load additional options (datasets, quality presets, UC presets)
        try {
            const optionsResponse = await fetchWithAuth('/', {
                method: 'OPTIONS'
            });
            if (optionsResponse.ok) {
                optionsData = await optionsResponse.json();
                // Store dataset options globally for sub-toggle rendering
                // Convert array to object keyed by dataset value
                const datasetsArray = optionsData.datasets || [];
                window.datasetOptions = {};
                datasetsArray.forEach(dataset => {
                    window.datasetOptions[dataset.value] = dataset;
                });
                console.log('✅ Loaded enhanced options data');
            }
        } catch (error) {
            console.log('⚠️ Failed to load enhanced options, using defaults:', error.message);
            window.datasetOptions = {};
        }

        // Populate sampler dropdown with display names, value=meta name
        manualSampler.innerHTML = '<option value="">Default</option>';
        SAMPLER_MAP.forEach(s => {
          const option = document.createElement('option');
          option.value = s.meta;
          option.textContent = s.display;
          manualSampler.appendChild(option);
        });

        // Populate noise scheduler dropdown with display names, value=meta name
        manualNoiseScheduler.innerHTML = '<option value="">Default</option>';
        NOISE_MAP.forEach(n => {
          const option = document.createElement('option');
          option.value = n.meta;
          option.textContent = n.display;
          manualNoiseScheduler.appendChild(option);
        });

        // Initialize custom preset dropdown
        await renderCustomPresetDropdown(selectedPreset);

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
        subscriptionData = balance.subscription;
        updateBalanceDisplay(balance);
    } catch (error) {
        console.error('Error loading balance:', error);
        // Don't throw error for balance loading failure
        updateBalanceDisplay({ totalCredits: 0, fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 });
    }
}

// Update balance display
function updateBalanceDisplay(balance) {
    const balanceDisplay = document.getElementById('balanceDisplay');
    const balanceAmount = document.getElementById('balanceAmount');
    const balanceIcon = balanceDisplay.querySelector('i');
    
    if (!balanceDisplay || !balanceAmount) return;
    
    const totalCredits = balance.totalCredits || 0;
    const fixedCredits = balance.fixedTrainingStepsLeft || 0;
    const purchasedCredits = balance.purchasedTrainingSteps || 0;
    
    // Update amount
    balanceAmount.textContent = totalCredits;
    
    // Update tooltip with detailed breakdown
    const tooltip = `Free Credits: ${fixedCredits}\nPaid Credits: ${purchasedCredits}`;
    balanceDisplay.title = tooltip;
    
    // Update styling based on credit levels
    balanceDisplay.classList.remove('low-credits');
    
    if (totalCredits === 0) {
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
async function loadGallery(noReset) {
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
            if (!noReset) {
                resetInfiniteScroll();
                displayCurrentPageOptimized();
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

let galleryColumns = parseInt(galleryColumnsInput?.value) || 5;
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
    const itemSize = galleryRect.width / galleryColumns; // Width of each item
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
    
    // Find the filename of the first visible gallery item
    let firstFilename = null;
    const firstItem = gallery.querySelector('.gallery-item .gallery-item-checkbox');
    if (firstItem) {
        firstFilename = firstItem.dataset.filename;
    }
    imagesPerPage = galleryColumns * galleryRows;
    // Find the index of that filename in allImages
    let newPage = 1;
    if (firstFilename) {
        const idx = allImages.findIndex(img => (img.original || img.pipeline || img.pipeline_upscaled) === firstFilename);
        if (idx !== -1) {
            newPage = Math.floor(idx / imagesPerPage) + 1;
        }
    }
    currentPage = newPage;
    if (debounceGalleryTimeout) clearTimeout(debounceGalleryTimeout);
    debounceGalleryTimeout = setTimeout(() => {
        imagesPerPage = galleryColumns * galleryRows; // Ensure up-to-date
        resetInfiniteScroll();
        displayCurrentPageOptimized();
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
    items.forEach(item => {
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
    });
}

// Optimized display function for infinite scroll
function displayCurrentPageOptimized() {
    if (!gallery) return;

    // Clear gallery
    gallery.innerHTML = '';

    // If no images, show empty state
    if (allImages.length === 0) {
        return;
    }

    // Start with a window in the middle/top
    displayedStartIndex = 0;
    displayedEndIndex = Math.min(imagesPerPage * 3, allImages.length);
    for (let i = displayedStartIndex; i < displayedEndIndex; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'gallery-placeholder';
        placeholder.style.height = '256px';
        placeholder.style.width = '100%';
        placeholder.dataset.imageIndex = i;
        gallery.appendChild(placeholder);
    }
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
    if (infiniteScrollLoading) {
        infiniteScrollLoading.style.display = 'none';
    }
}

// Create gallery item element
function createGalleryItem(image, index) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    const filename = image.filename || image.original || image.upscaled || image.pipeline || image.pipeline_upscaled;
    item.dataset.filename = filename;
    item.dataset.index = index;
    // Restore selection state from data-selected if present
    if (item.dataset.selected === 'true' || selectedImages.has(filename)) {
        item.dataset.selected = 'true';
        item.classList.add('selected');
    } else {
        item.dataset.selected = 'false';
        item.classList.remove('selected');
    }
    // Add selection checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gallery-item-checkbox';
    checkbox.dataset.filename = filename;
    checkbox.checked = item.dataset.selected === 'true';
    // ALT+click range selection on click event
    checkbox.addEventListener('click', (e) => {
        if (e.altKey) {
            e.preventDefault();
            // Use all .gallery-item and .gallery-placeholder with data-filename for range selection
            const items = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
            const clickedIndex = items.findIndex(div => div.dataset.filename === filename);
            if (lastSelectedGalleryIndex !== null && clickedIndex !== -1) {
                const [start, end] = [lastSelectedGalleryIndex, clickedIndex].sort((a, b) => a - b);
                for (let i = start; i <= end; i++) {
                    const div = items[i];
                    div.dataset.selected = 'true';
                    div.classList.add('selected');
                    selectedImages.add(div.dataset.filename);
                    // If it's a real item, update checkbox
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
    
    if (image.pipeline || image.pipeline_upscaled) {
        // Pipeline filename format: timestamp_preset_layer1Seed_layer2Seed (base already has _pipeline removed)
        const parts = image.base.split('_');
        if (parts.length >= 4) {
            // Format: [timestamp, preset, layer1Seed, layer2Seed]
            const timestamp = parts[0];
            const presetParts = parts.slice(1, -2); // Everything between timestamp and the two seeds
            const layer1SeedPart = parts[parts.length - 2];
            const layer2SeedPart = parts[parts.length - 1];
            
            presetName = presetParts.join('_') || 'generated';
            seed = layer2SeedPart || '';
            layer1Seed = layer1SeedPart || '';
        } else if (parts.length === 3) {
            // Format: [timestamp, preset, layer1Seed] (only one seed)
            const timestamp = parts[0];
            const presetName = parts[1] || 'generated';
            const layer1SeedPart = parts[2] || '';
            seed = ''; // No layer2 seed
            layer1Seed = layer1SeedPart;
        } else {
            presetName = parts.slice(1).join('_') || 'generated';
        }
    } else {
        // Regular filename format: timestamp_preset_seed.png
        const parts = image.base.split('_');
        if (parts.length >= 3) {
            presetName = parts.slice(1, -1).join('_') || 'generated';
            seed = parts[parts.length - 1] || '';
        }
    }
    
    const dateTime = new Date(image.mtime).toLocaleString();
    
    // Create info rows
    const presetRow = document.createElement('div');
    presetRow.className = 'gallery-info-row';
    presetRow.textContent = presetName;
    
    const seedRow = document.createElement('div');
    seedRow.className = 'gallery-info-row';
    if (image.pipeline || image.pipeline_upscaled) {
        if (layer1Seed && seed) {
            seedRow.textContent = `Seeds: ${layer1Seed} → ${seed}`;
        } else if (layer1Seed) {
            seedRow.textContent = `Seed: ${layer1Seed}`;
        } else {
            seedRow.textContent = `Seed: ${seed}`;
        }
    } else {
        seedRow.textContent = `Seed: ${seed}`;
    }
    
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
    downloadBtn.className = 'btn-primary round-button';
    downloadBtn.innerHTML = '<i class="nai-save"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadImage(image);
    };
    
    // Direct reroll button (left side)
    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'btn-primary round-button';
    rerollBtn.innerHTML = '<i class="nai-dice"></i>';
    rerollBtn.title = 'Reroll with same settings';
    rerollBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImage(image);
    };
    
    // Reroll with edit button (right side with cog)
    const rerollEditBtn = document.createElement('button');
    rerollEditBtn.className = 'btn-primary round-button';
    rerollEditBtn.innerHTML = '<i class="nai-penwriting"></i>';
    rerollEditBtn.title = 'Reroll with Edit';
    rerollEditBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImageWithEdit(image);
    };
    
    // Upscale button (only for non-upscaled images)
    const upscaleBtn = document.createElement('button');
    upscaleBtn.className = 'btn-primary round-button';
    upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
    upscaleBtn.title = 'Upscale';
    upscaleBtn.onclick = (e) => {
        e.stopPropagation();
        upscaleImage(image);
    };
    
    // Only show upscale button for non-upscaled images
    if (!image.upscaled && !image.pipeline_upscaled) {
        upscaleBtn.style.display = 'inline-block';
    } else {
        upscaleBtn.style.display = 'none';
    }
    
    // Scrap button
    const scrapBtn = document.createElement('button');
    scrapBtn.className = 'btn-secondary round-button';
    if (isViewingScraps) {
        scrapBtn.innerHTML = '<i class="nai-undo"></i>';
        scrapBtn.title = 'Remove from scraps';
        scrapBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromScraps(image);
        };
    } else {
        scrapBtn.innerHTML = '<i class="nai-image-tool-sketch"></i>';
        scrapBtn.title = 'Move to scraps';
        scrapBtn.onclick = (e) => {
            e.stopPropagation();
            moveToScraps(image);
        };
    }
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger round-button';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete image';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteImage(image);
    };
    
    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(upscaleBtn);
    actionsDiv.appendChild(rerollBtn);
    actionsDiv.appendChild(rerollEditBtn);
    actionsDiv.appendChild(scrapBtn);
    actionsDiv.appendChild(deleteBtn);
    
    overlay.appendChild(actionsDiv);
    
    item.appendChild(checkbox);
    item.appendChild(img);
    item.appendChild(overlay);
    
    // Click to show lightbox - prefer highest quality version
    item.addEventListener('click', (e) => {
        // Don't open lightbox if clicking on checkbox
        if (e.target.type === 'checkbox') {
            return;
        }
        
        let filenameToShow = image.original;
        if (image.pipeline_upscaled) {
            filenameToShow = image.pipeline_upscaled;
        } else if (image.pipeline) {
            filenameToShow = image.pipeline;
        } else if (image.upscaled) {
            filenameToShow = image.upscaled;
        }
        
        const imageToShow = {
            filename: filenameToShow,
            base: image.base,
            upscaled: image.upscaled,
            pipeline: image.pipeline,
            pipeline_upscaled: image.pipeline_upscaled
        };
        showLightbox(imageToShow);
    });
    
    return item;
}


async function rerollImage(image) {
    try {
        // Determine which filename to use for metadata
        // For gallery items, determine the filename based on available properties
        let filenameForMetadata = image.filename;
        
        if (!filenameForMetadata) {
            // If no filename property, determine from gallery image object
            if (image.pipeline_upscaled) {
                filenameForMetadata = image.pipeline_upscaled;
            } else if (image.pipeline) {
                filenameForMetadata = image.pipeline;
            } else if (image.upscaled) {
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
        
            // Show loading
    showManualLoading(true, 'Rerolling image...');

        // Check if this is a pipeline image
        const isPipeline = image.pipeline || image.pipeline_upscaled;
        
        if (isPipeline) {
            // Handle pipeline reroll

            // Extract pipeline name from filename (metadata doesn't contain preset name for pipelines)
            const parts = image.base.split('_');
            let pipelineName = 'generated';
            
            if (parts.length >= 4) {
                // Pipeline format: [timestamp, preset, layer1Seed, layer2Seed]
                const presetParts = parts.slice(1, -2); // Everything between timestamp and the two seeds
                pipelineName = presetParts.join('_') || 'generated';
            } else if (parts.length === 3) {
                // Format: [timestamp, preset, layer1Seed] (only one seed)
                pipelineName = parts[1] || 'generated';
            }

            // Use pipeline endpoint with original layer1 seed from metadata
            // Build layer2 configuration from metadata
            const layer2Config = {
                prompt: metadata.prompt || '',
                model: metadata.model || 'v4_5',
                resolution: metadata.resolution || 'NORMAL_PORTRAIT',
                steps: metadata.steps || 25,
                guidance: metadata.scale || 5.0,
                rescale: metadata.cfg_rescale || 0.0,
                allow_paid: typeof forcePaidRequest !== 'undefined' ? forcePaidRequest : true
            };

            if (metadata.skip_cfg_above_sigma) {
                layer2Config.variety = true;
            }
            
            // Add upscale if it was used in original generation
            if (metadata.upscaled) {
                layer2Config.upscale = true;
            }
            
            // Add character prompts if available
            if (metadata.characterPrompts && Array.isArray(metadata.characterPrompts) && metadata.characterPrompts.length > 0) {
                layer2Config.allCharacterPrompts = metadata.characterPrompts;
                layer2Config.use_coords = !!metadata.use_coords;
            }

            // Add optional fields if they have values
            if (metadata.uc) {
                layer2Config.uc = metadata.uc;
            }
            
            if (metadata.sampler) {
                const samplerObj = getSamplerMeta(metadata.sampler);
                layer2Config.sampler = samplerObj ? samplerObj.request : metadata.sampler;
            }
            
            if (metadata.noise_schedule) {
                const noiseObj = getNoiseMeta(metadata.noise_schedule);
                layer2Config.noiseScheduler = noiseObj ? noiseObj.request : metadata.noise_schedule;
            }
            
            // Build pipeline request body using captured pipeline context
            const pipelineRequestBody = {
                preset: pipelineName,
                layer2: layer2Config,
                resolution: metadata.resolution || undefined,
                workspace: activeWorkspace
            };
            
            // Add mask_bias if available in metadata
            if (metadata.mask_bias !== undefined) {
                pipelineRequestBody.mask_bias = parseInt(metadata.mask_bias);
            }
            
            // Check if layer1 seed toggle is enabled and we have a layer1 seed
            const useLayer1Seed = layer1SeedToggle.getAttribute('data-state') === 'on' && metadata.layer1Seed;
            if (useLayer1Seed) {
                pipelineRequestBody.layer1_seed = metadata.layer1Seed;
            }

            addSharedFieldsToRequestBody(pipelineRequestBody, metadata);

            delete pipelineRequestBody.seed;
            
            const pipelineUrl = `/pipeline/generate`;
            const generateResponse = await fetch(pipelineUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pipelineRequestBody)
            });

            if (!generateResponse.ok) {
                throw new Error(`Pipeline generation failed: ${generateResponse.statusText}`);
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
                    }
                } catch (error) {
                    console.warn('Failed to fetch metadata for generated image:', error);
                }
            }
            
            // Create a temporary image to get dimensions
            const img = new Image();
            img.onload = function() {
                createConfetti();
                showSuccess('Pipeline rerolled successfully!');
            
                // Refresh gallery and show the new image in lightbox
                setTimeout(async () => {
                    await loadGallery();
                
                    // Find the newly generated image (should be the first one)
                    if (allImages.length > 0) {
                        const newImage = allImages[0]; // Newest image is first
                        let filenameToShow = newImage.original;
                        if (newImage.pipeline_upscaled) {
                            filenameToShow = newImage.pipeline_upscaled;
                        } else if (newImage.pipeline) {
                            filenameToShow = newImage.pipeline;
                        } else if (newImage.upscaled) {
                            filenameToShow = newImage.upscaled;
                        }
                        
                        const imageToShow = {
                            filename: filenameToShow,
                            base: newImage.base,
                            upscaled: newImage.upscaled,
                            pipeline: newImage.pipeline,
                            pipeline_upscaled: newImage.pipeline_upscaled
                        };
                        showLightbox(imageToShow);
                    }
                }, 1000);
            };
            img.src = imageUrl;
            
        } else {
            // Handle regular image reroll (existing logic)
            
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
                    }
                } catch (error) {
                    console.warn('Failed to fetch metadata for generated image:', error);
                }
            }
            
            // Create a temporary image to get dimensions
            const img = new Image();
            img.onload = function() {
                createConfetti();
                showGlassToast('success', 'Reroll', 'Image rerolled successfully!');
            
                // Refresh gallery and show the new image in lightbox
                setTimeout(async () => {
                    await loadGallery();
                
                    // Find the newly generated image (should be the first one)
                    if (allImages.length > 0) {
                        const newImage = allImages[0]; // Newest image is first
                        let filenameToShow = newImage.original;
                        if (newImage.pipeline_upscaled) {
                            filenameToShow = newImage.pipeline_upscaled;
                        } else if (newImage.pipeline) {
                            filenameToShow = newImage.pipeline;
                        } else if (newImage.upscaled) {
                            filenameToShow = newImage.upscaled;
                        }
                        
                        const imageToShow = {
                            filename: filenameToShow,
                            base: newImage.base,
                            upscaled: newImage.upscaled,
                            pipeline: newImage.pipeline,
                            pipeline_upscaled: newImage.pipeline_upscaled
                        };
                        showLightbox(imageToShow);
                    }
                }, 1000);
            };
            img.src = imageUrl;
        }

    } catch (error) {
        console.error('Direct reroll error:', error);
        showError('Image reroll failed: ' + error.message);
    } finally {
        showManualLoading(false);
    }
}

// Reroll an image with editable settings
async function rerollImageWithEdit(image) {
    try {
        // Determine filename for metadata
        let filenameForMetadata = image.filename || image.pipeline_upscaled || image.pipeline || image.upscaled || image.original;
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
        if (lightboxModal.style.display === 'block') {
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
        const isPipeline = image.pipeline || image.pipeline_upscaled;

        // Update button visibility
        updateRequestTypeButtonVisibility();

        // Set initial state
        const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
        const saveButton = document.getElementById('manualSaveBtn');
        const layer1SeedToggle = document.getElementById('layer1SeedToggle');
        const manualMaskBiasGroup = document.getElementById('manualMaskBiasGroup');

        if (isPipeline) {
            window.currentRequestType = 'pipeline_reroll';
            // Set transformation type to reroll
            updateTransformationDropdownState('reroll', 'Referance');

            if (presetNameGroup) {
                presetNameGroup.style.display = 'block';
                manualPresetName.disabled = true;
                manualPresetName.style.opacity = '0.6';
            }
            if (saveButton) saveButton.style.display = 'none';
            if (layer1SeedToggle) {
                layer1SeedToggle.style.display = 'inline-block';
                layer1SeedToggle.setAttribute('data-state', metadata.layer1Seed ? 'on' : 'off');
            }
            if (manualMaskBiasGroup) {
                manualMaskBiasGroup.style.display = 'block';
                selectManualMaskBias(manualSelectedMaskBias);
            }

            window.currentPipelineName = metadata.preset_name;
            window.currentLayer1Seed = metadata.layer1Seed || metadata.seed;

        } else if (isVariation) {
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
            
            const variationImage = document.getElementById('manualVariationImage');
            if (variationImage) {
                variationImage.style.display = 'block';
            }
            updateInpaintButtonState();
            renderImageBiasDropdown((typeof metadata.image_bias === 'number' ? metadata.image_bias : 2).toString());

            if (presetNameGroup) presetNameGroup.style.display = 'block';
            if (saveButton) saveButton.style.display = 'inline-block';
            if (layer1SeedToggle) layer1SeedToggle.style.display = 'none';
            if (manualMaskBiasGroup) manualMaskBiasGroup.style.display = 'none';
        } else {
            window.currentRequestType = null;
            // Clear transformation type
            updateTransformationDropdownState(undefined, 'Select');

            if (presetNameGroup) presetNameGroup.style.display = 'block';
            if (saveButton) saveButton.style.display = 'inline-block';
            if (layer1SeedToggle) layer1SeedToggle.style.display = 'none';
            if (manualMaskBiasGroup) manualMaskBiasGroup.style.display = 'none';
        }

        // Only call cropImageToResolution if uploadedImageData is available
        if (window.uploadedImageData) {
            await cropImageToResolution();
        }
        manualModal.style.display = 'block';
        manualPrompt.focus();
        
        // Auto-resize textareas after modal is shown
        autoResizeTextareasAfterModalShow();

    } catch (error) {
        console.error('Reroll with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
    }
}

// Upscale an image
async function upscaleImage(image) {
    // Show loading overlay (same as generation)
    showManualLoading(true, 'Upscaling image...');

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
        showGlassToast('success', 'Upscale', 'Image upscaled successfully!');
        
        // Reload gallery to show new upscaled image
        await loadGallery();
        
        // Refresh balance after successful upscaling
        await loadBalance();
        
        // Find the upscaled image in the gallery and show it in lightbox
        let upscaledFilename = image.original.replace('.png', '_upscaled.png');
        let upscaledImage = allImages.find(img => 
            img.original === upscaledFilename || 
            img.upscaled === upscaledFilename ||
            img.pipeline === upscaledFilename ||
            img.pipeline_upscaled === upscaledFilename
        );
        
        if (upscaledImage) {
            // Determine which filename to show based on what's available
            let filenameToShow = upscaledImage.original;
            if (upscaledImage.pipeline_upscaled) {
                filenameToShow = upscaledImage.pipeline_upscaled;
            } else if (upscaledImage.pipeline) {
                filenameToShow = upscaledImage.pipeline;
            } else if (upscaledImage.upscaled) {
                filenameToShow = upscaledImage.upscaled;
            }
            
            const imageToShow = {
                filename: filenameToShow,
                base: upscaledImage.base,
                upscaled: upscaledImage.upscaled,
                pipeline: upscaledImage.pipeline,
                pipeline_upscaled: upscaledImage.pipeline_upscaled
            };
            showLightbox(imageToShow);
        }
        
    } catch (error) {
        console.error('Upscaling error:', error);
        showError('Image upscaling failed. Please try again.');
    } finally {
        showManualLoading(false);
    }
}

// Infinite scroll handler
function handleInfiniteScroll() {
    if (isLoadingMore) return;
    
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // Load more when user is near the bottom (within 200px)
    if (scrollTop + windowHeight >= documentHeight - 200 && hasMoreImages) {
        loadMoreImages();
    }
    // Load more when user is near the top (within 200px)
    if (scrollTop <= 200 && hasMoreImagesBefore) {
        loadMoreImagesBefore();
    }
    // Virtual scrolling: remove items that are too far from viewport
    if (virtualScrollEnabled) {
        updateVirtualScroll();
    }
}

// Load more images for infinite scroll (scroll down)
async function loadMoreImages() {
    if (isLoadingMore || !hasMoreImages) return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'flex';
    try {
        // Calculate next batch of images
        const startIndex = displayedEndIndex;
        const endIndex = Math.min(startIndex + imagesPerPage, allImages.length);
        const nextBatch = allImages.slice(startIndex, endIndex);
        if (nextBatch.length === 0) {
            hasMoreImages = false;
            return;
        }
        // Add placeholders for new items
        for (let i = startIndex; i < endIndex; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.style.height = '256px'; // or your item height
            placeholder.style.width = '100%';
            placeholder.dataset.imageIndex = i;
            gallery.appendChild(placeholder);
        }
        // Fill visible placeholders with real items
        updateVirtualScroll();
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

// Load more images before for infinite scroll (scroll up)
async function loadMoreImagesBefore() {
    if (isLoadingMore || !hasMoreImagesBefore) return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'flex';
    try {
        // Calculate previous batch of images
        const endIndex = displayedStartIndex;
        const startIndex = Math.max(0, endIndex - imagesPerPage);
        const prevBatch = allImages.slice(startIndex, endIndex);
        if (prevBatch.length === 0) {
            hasMoreImagesBefore = false;
            return;
        }
        // Add placeholders for new items at the top
        for (let i = endIndex - 1; i >= startIndex; i--) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.style.height = '256px'; // or your item height
            placeholder.style.width = '100%';
            placeholder.dataset.imageIndex = i;
            gallery.insertBefore(placeholder, gallery.firstChild);
        }
        // Fill visible placeholders with real items
        updateVirtualScroll();
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
    const bufferRows = 4; // Number of rows to keep above and below viewport
    const itemsPerRow = galleryColumns;
    const visibleIndices = Array.from(visibleItems);
    
    if (visibleIndices.length === 0) return;
    
    const minVisible = Math.min(...visibleIndices);
    const maxVisible = Math.max(...visibleIndices);
    const minKeep = Math.max(0, minVisible - bufferRows * itemsPerRow);
    const maxKeep = Math.min(total - 1, maxVisible + bufferRows * itemsPerRow);
    
    // Process items in reverse order to avoid index shifting issues
    for (let i = 0; i < total; i++) {
        const el = items[i];
        
        if (i < minKeep || i > maxKeep) {
            // Replace with placeholder if not already
            if (!el.classList.contains('gallery-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = el.offsetHeight + 'px';
                placeholder.style.width = el.offsetWidth + 'px';
                placeholder.dataset.filename = el.dataset.filename;
                placeholder.dataset.index = el.dataset.index;
                placeholder.dataset.imageIndex = el.dataset.imageIndex || i;
                // Preserve selection state
                placeholder.dataset.selected = el.dataset.selected;
                gallery.replaceChild(placeholder, el);
            }
        } else {
            // If it's a placeholder, restore the real item
            if (el.classList.contains('gallery-placeholder')) {
                const imageIndex = parseInt(el.dataset.index || el.dataset.imageIndex || i);
                const image = allImages[imageIndex];
                if (image) {
                    const realItem = createGalleryItem(image, imageIndex);
                    realItem.dataset.imageIndex = imageIndex;
                    // Restore selection state
                    if (el.dataset.selected === 'true') {
                        realItem.dataset.selected = 'true';
                        realItem.classList.add('selected');
                        selectedImages.add(realItem.dataset.filename);
                        const cb = realItem.querySelector('.gallery-item-checkbox');
                        if (cb) cb.checked = true;
                    } else {
                        realItem.dataset.selected = 'false';
                        realItem.classList.remove('selected');
                        selectedImages.delete(realItem.dataset.filename);
                        const cb = realItem.querySelector('.gallery-item-checkbox');
                        if (cb) cb.checked = false;
                    }
                    gallery.replaceChild(realItem, el);
                }
            }
        }
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
    
    // Check if a preset is selected for editing
    const selectedValue = presetSelect.value;
    if (selectedValue) {
        // Parse the selected value to determine if it's a preset or pipeline
        const [type, name] = selectedValue.split(':');
        
        if (type === 'preset') {
            // Load preset for editing
            await loadIntoManualForm(selectedValue);
        } else if (type === 'pipeline') {
            // Load pipeline for limited editing (layer2 only)
            await loadIntoManualForm(selectedValue);
        }
    } else {
        // Clear form for new generation
        clearManualForm();
    }
    
    manualModal.style.display = 'block';
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
    
    // Update button visibility
    updateRequestTypeButtonVisibility();
    
    // Check if "show both" mode is active and hide tab buttons container if needed
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const showBothBtn = document.getElementById('showBothBtn');
    const tabButtonsContainer = document.querySelector('#manualModal .prompt-tabs .tab-buttons');
    
    if (promptTabs && promptTabs.classList.contains('show-both') && showBothBtn && showBothBtn.classList.contains('active')) {
        // "Show both" mode is active, hide the tab buttons container
        if (tabButtonsContainer) {
            tabButtonsContainer.style.display = 'none';
        }
    }
}

// Hide manual modal
function hideManualModal(e, preventModalReset = false) {
    const isWideViewport = window.innerWidth >= 1400;
    const isManualModalOpen = manualModal && manualModal.style.display === 'block';

    if (!preventModalReset || !(isWideViewport && isManualModalOpen)) {
        // Handle loading overlay when modal is closed
        const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
        if (manualLoadingOverlay && !manualLoadingOverlay.classList.contains('hidden')) {
            // If manual loading overlay is visible, switch to regular loading overlay
            const loadingMessage = manualLoadingOverlay.querySelector('p')?.textContent || 'Generating your image...';
            manualLoadingOverlay.classList.add('hidden');
            showLoading(true, loadingMessage);
        }
        
        manualModal.style.display = 'none';
        clearManualForm();
        
        // Reset manual preview
        resetManualPreview();
        
        // Clear pipeline context
        window.currentPipelineEdit = null;
        
        // Hide request type toggle row
        const requestTypeRow = document.getElementById('requestTypeRow');
        if (requestTypeRow) {
            requestTypeRow.style.display = 'none';
        }
        
        // Clear edit context
        window.currentEditMetadata = null;
        window.currentEditImage = null;
        window.currentRequestType = null;
        
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
        
        // Update button visibility
        updateRequestTypeButtonVisibility();
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
    layer1SeedToggle.setAttribute('data-state', 'off');
    
    // Reset paid request toggle
    forcePaidRequest = false;
    const paidRequestToggle = document.getElementById('paidRequestToggle');
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
    
    selectedUcPreset = 3; // Default to "Heavy"
    selectUcPreset(3);
    renderUcPresetsDropdown();
    
    // Reset preset name field
    manualPresetName.disabled = false;
    manualPresetName.style.opacity = '1';
    
    // Clear pipeline context
    window.currentPipelineEdit = null;
    
    // Hide mask bias dropdown
    if (manualMaskBiasGroup) {
        manualMaskBiasGroup.style.display = 'none';
    }
    
            // Hide transformation section
        const variationRow = document.getElementById('transformationSection');
        if (variationRow) {
        }
    
    const variationImage = document.getElementById('manualVariationImage');
    if (variationImage) {
        variationImage.src = '';
    }
    
    // Reset transformation section states
    const transformationSection = document.getElementById('transformationSection');
    if (transformationSection) {
        transformationSection.classList.remove('display-image');
    }
    
    const transformationSectionRight = document.getElementById('transformationSectionRight');
    if (transformationSectionRight) {
        transformationSectionRight.classList.remove('disabled');
    }
    
    const transformationDropdown = document.getElementById('transformationDropdown');
    if (transformationDropdown) {
        transformationDropdown.classList.remove('disabled');
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

    // Hide the layer1 seed toggle by default
    layer1SeedToggle.style.display = 'none';
    
    // Clear character prompts
    clearCharacterPrompts();
    
    // Reset sprout seed button state
    if (sproutSeedBtn) {
        sproutSeedBtn.setAttribute('data-state', 'off');
        sproutSeedBtn.classList.remove('active');
        manualSeed.disabled = false;
    }
    
    // Reset inpaint button state and clear mask
    if (inpaintBtn) {
        inpaintBtn.setAttribute('data-state', 'off');
        inpaintBtn.classList.remove('active');
    }
    window.currentMaskData = null;
    window.currentMaskCompressed = null;
    window.pipelineMaskData = null;
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

    updateInpaintButtonState();
    updateMaskPreview();
    
    // Hide image bias dropdown
    hideImageBiasDropdown();
    
    // Show the clear seed button
    const clearSeedBtn = document.getElementById('clearSeedBtn');
    if (clearSeedBtn) clearSeedBtn.style.display = 'inline-block';
    
    // Reset transformation dropdown state
    updateTransformationDropdownState(undefined, 'Select');
    
    // Update button visibility
    updateRequestTypeButtonVisibility();
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
        prompt: manualPrompt.value.trim(),
        resolutionValue: manualResolution.value,
        uc: manualUc.value.trim(),
        seed: manualSeed.value.trim(),
        sampler: manualSampler.value,
        noiseScheduler: manualNoiseScheduler.value,
        steps: parseInt(manualSteps.value) || 25,
        guidance: parseFloat(manualGuidance.value) || 5.0,
        rescale: parseFloat(manualRescale.value) || 0.0,
        upscale: manualUpscale.getAttribute('data-state') === 'on',
        presetName: manualPresetName.value ? manualPresetName.value.trim() : "",
        autoPositionBtn: document.getElementById('autoPositionBtn'),
        container: document.getElementById('characterPromptsContainer'),
        characterItems: document.getElementById('characterPromptsContainer') ? document.getElementById('characterPromptsContainer').querySelectorAll('.character-prompt-item') : [],
        characterPrompts: getCharacterPrompts()
    };

    // Handle image bias - support both legacy and dynamic bias
    const imageBiasHidden = document.getElementById('imageBias');
    if (window.uploadedImageData && window.uploadedImageData.image_bias) {
        values.image_bias = window.uploadedImageData.image_bias;
    } else if (imageBiasHidden && imageBiasHidden.value) {

        values.image_bias = parseInt(imageBiasHidden.value);
    }

    // Handle mask bias
    const maskBiasHidden = document.getElementById('manualMaskBias');
    if (maskBiasHidden && maskBiasHidden.value) {
        values.mask_bias = parseInt(maskBiasHidden.value);
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
    values.normalize_vibes = document.getElementById('vibeNormalizeToggle')?.getAttribute('data-state') === 'on';

    return values;
}

// Utility: Collect vibe transfer data from the container
function collectVibeTransferData() {
    const container = document.getElementById('vibeReferencesContainer');
    if (!container) return [];
    
    const vibeTransferItems = container.querySelectorAll('.vibe-reference-item');
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
        const isWideViewport = window.innerWidth >= 1400;
        const manualModal = document.getElementById('manualModal');
        const isManualModalOpen = manualModal && manualModal.style.display === 'block';
        
        if (isWideViewport && isManualModalOpen) {
            // Update manual modal preview instead of opening lightbox
            // Don't clear context when modal is open in wide viewport mode
            await updateManualPreview(imageUrl, blob, response);
            
            // Update placeholder image for pipeline edits
            if (window.currentPipelineEdit && window.currentPipelineEdit.isPipelineEdit) {
                // Update the placeholder image with the newly generated image
                const generatedFilename = response && response.headers ? response.headers.get('X-Generated-Filename') : null;
                if (generatedFilename) {
                    window.uploadedImageData.image_source = `file:${generatedFilename}`;
                    window.uploadedImageData.isPlaceholder = true; // Keep as placeholder since it's the current pipeline image
                }
                
                // Update variation image display if it exists
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage) {
                    variationImage.src = imageUrl;
                    variationImage.style.display = 'block';
                }
                
                // Update mask editor background if it's currently open
                const maskEditorDialog = document.getElementById('maskEditorDialog');
                if (maskEditorDialog && maskEditorDialog.style.display === 'block') {
                    const canvasInner = document.querySelector('.mask-editor-canvas-inner');
                    if (canvasInner) {
                        const backgroundImageValue = `url(${imageUrl})`;
                        canvasInner.style.setProperty('--background-image', backgroundImageValue);
                        console.log('🖼️ Updated mask editor background with newly generated pipeline image');
                    }
                }
                
                console.log('🖼️ Updated placeholder image with newly generated pipeline image');
            }
            
            loadGallery();
        } else {
            // Clear context only when modal is not open or not in wide viewport mode
            if (typeof clearContextFn === "function") clearContextFn();
            
            // Normal behavior - open lightbox
            setTimeout(async () => {
                await loadGallery();
                if (typeof loadBalance === "function") await loadBalance();
                if (allImages.length > 0) {
                    const newImage = allImages[0];
                    let imageToShow;
                    if (newImage.pipeline_upscaled || newImage.pipeline) {
                        let filenameToShow = newImage.original;
                        if (newImage.pipeline_upscaled) filenameToShow = newImage.pipeline_upscaled;
                        else if (newImage.pipeline) filenameToShow = newImage.pipeline;
                        else if (newImage.upscaled) filenameToShow = newImage.upscaled;
                        imageToShow = {
                            filename: filenameToShow,
                            base: newImage.base,
                            upscaled: newImage.upscaled,
                            pipeline: newImage.pipeline,
                            pipeline_upscaled: newImage.pipeline_upscaled
                        };
                    } else {
                        imageToShow = {
                            filename: newImage.upscaled || newImage.original,
                            base: newImage.base,
                            upscaled: newImage.upscaled
                        };
                    }
                    showLightbox(imageToShow);
                }
            }, 1000);
        }
    };
    img.src = imageUrl;
}

// Function to update manual modal preview
async function updateManualPreview(imageUrl, blob, response = null, metadata = null) {
    const previewImage = document.getElementById('manualPreviewImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
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
        if (!allImages || allImages.length === 0 || response) {
            await loadGallery();
        }
        
        const found = allImages.find(img => img.original === generatedFilename || img.upscaled === generatedFilename || img.pipeline === generatedFilename || img.pipeline_upscaled === generatedFilename);
        
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
                upscaled: null,
                pipeline: null,
                pipeline_upscaled: null
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
        const loadBtn = document.getElementById('manualPreviewLoadBtn');
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (loadBtn) loadBtn.style.display = 'flex';
        if (scrapBtn) {
            scrapBtn.style.display = 'flex';
            // Update scrap button based on current view
            if (isViewingScraps) {
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

// Function to reset manual modal preview
function resetManualPreview() {
    const previewImage = document.getElementById('manualPreviewImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
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
        
        // Hide control buttons
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (upscaleBtn) upscaleBtn.style.display = 'none';
        if (rerollBtn) rerollBtn.style.display = 'none';
        if (variationBtn) variationBtn.style.display = 'none';
        const loadBtn = document.getElementById('manualPreviewLoadBtn');
        if (loadBtn) loadBtn.style.display = 'none';
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) scrapBtn.style.display = 'none';
        if (seedBtn) seedBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
        
        // Reset zoom functionality
        resetManualPreviewZoom();
        
        // Clear stored seed and current image
        window.lastGeneratedSeed = null;
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
        img.upscaled === currentFilename || 
        img.pipeline === currentFilename || 
        img.pipeline_upscaled === currentFilename
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
        img.upscaled === currentFilename || 
        img.pipeline === currentFilename || 
        img.pipeline_upscaled === currentFilename
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
}

async function handleManualGeneration(e) {
    e.preventDefault();

    const isPipelineEdit = window.currentPipelineEdit && window.currentPipelineEdit.isPipelineEdit;
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

    if (isPipelineEdit) {
        // Pipeline Edit
        if (!validateFields(['prompt', 'resolutionValue'], 'Please fill in all required fields (Prompt, Resolution)')) return;
        const resolution = getResolution(values.resolutionValue);

        // Capture pipeline context BEFORE hiding modal (which clears it)
        let pipelineContext = { ...window.currentPipelineEdit };
        const useLayer1Seed = layer1SeedToggle.getAttribute('data-state') === 'on';

        showManualLoading(true, 'Running Pipeline...');

        try {
            // Build layer2 config
            const layer2Config = {
                prompt: values.prompt,
                model: values.model,
                resolution: resolution,
                steps: values.steps,
                guidance: values.guidance,
                rescale: values.rescale,
                allow_paid: forcePaidRequest
            };
            addSharedFieldsToRequestBody(layer2Config, values);

            // Build pipeline request body
            const pipelineRequestBody = {
                preset: pipelineContext.pipelineName,
                layer2: layer2Config,
                resolution: resolution,
                workspace: activeWorkspace
            };
            if (useLayer1Seed && pipelineContext.layer1Seed) {
                pipelineRequestBody.layer1_seed = pipelineContext.layer1Seed;
            }
            if (window.currentMaskCompressed) {
                pipelineRequestBody.mask_compressed = window.currentMaskCompressed.replace('data:image/png;base64,', '');
            } else if (window.currentMaskData) {
                const compressedMask = saveMaskCompressed();
                if (compressedMask) {
                    pipelineRequestBody.mask_compressed = compressedMask.replace('data:image/png;base64,', '');
                }
            } else if (typeof manualMaskBiasDropdown !== "undefined" && manualMaskBiasDropdown && 
                manualMaskBiasDropdown.style.display !== 'none' && manualMaskBiasHidden) {
                pipelineRequestBody.mask_bias = parseInt(manualMaskBiasHidden.value);
            }
            
            // For pipeline images, don't send image data since they don't have image_source
            // and are generated at runtime without requiring a base image
            hideManualModal(undefined, true);
            const pipelineUrl = `/pipeline/generate`;
            const generateResponse = await fetch(pipelineUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pipelineRequestBody)
            });

            if (!generateResponse.ok) throw new Error(`Pipeline generation failed: ${generateResponse.statusText}`);
            const blob = await generateResponse.blob();
            await handleImageResult(blob, 'Pipeline edited successfully!', () => {  }, values.seed, generateResponse);
        } catch (error) {
            hideManualModal(undefined, true);
            console.error('Pipeline edit generation error:', error);
            showError('Pipeline generation failed. Please try again.');
        } finally {
            showManualLoading(false);
        }
    } else if (isImg2Img) {
        // Img2Img / Variation Edit/Reroll
        if (!validateFields(['model', 'prompt', 'resolutionValue'], 'Please fill in all required fields (Model, Prompt, Resolution)')) return;
        const resolution = getResolution(values.resolutionValue);

        // Prepare requestBody
        const requestBody = {
            strength: parseFloat(document.getElementById('manualStrengthValue').value) || 0.8,
            noise: parseFloat(document.getElementById('manualNoiseValue').value) || 0.1,
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
            showGlassToast('success', 'Save Preset', result.message);
            
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
        allow_paid: forcePaidRequest, // Default to true for presets
        characterPrompts: getCharacterPrompts()
    };
    
    // Set auto position button state
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    presetData.use_coords = autoPositionBtn.getAttribute('data-state') === 'on';
    
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
        const customWidth = document.getElementById('manualCustomWidth');
        const customHeight = document.getElementById('manualCustomHeight');
        if (customWidth && customHeight) {
            presetData.width = parseInt(customWidth.value) || undefined;
            presetData.height = parseInt(customHeight.value) || undefined;
        }
    }
    
    // Check if this is an img2img with base image
    if (window.uploadedImageData && window.uploadedImageData.image_source) {
        // Add image source in the correct format type:value
        presetData.image_source = window.uploadedImageData.image_source;
        
        presetData.strength = parseFloat(document.getElementById('manualStrengthValue').value) || 0.8;
        presetData.noise = parseFloat(document.getElementById('manualNoiseValue').value) || 0.1;
        
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
    
    // Add mask bias if available
    const maskBiasHidden = document.getElementById('manualMaskBias');
    if (maskBiasHidden && maskBiasHidden.value) {
        presetData.mask_bias = parseInt(maskBiasHidden.value);
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

// Character autocomplete functions
function handleCharacterAutocompleteInput(e) {
    // Don't trigger autocomplete if we're in navigation mode
    if (autocompleteNavigationMode) {
        autocompleteNavigationMode = false;
        return;
    }
    
    // Handle backspace - if actively navigating, start normal search delay
    if (e.inputType === 'deleteContentBackward') {
        // If user is actively navigating or has an item selected, start normal search
        if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
            // Clear existing timeout
            if (characterAutocompleteTimeout) {
                clearTimeout(characterAutocompleteTimeout);
            }
            
            // Set timeout to search after user stops typing (normal delay)
            characterAutocompleteTimeout = setTimeout(() => {
                if (searchText.startsWith('<') || searchText.length >= 2) {
                    searchCharacters(searchText, target);
                } else {
                    hideCharacterAutocomplete();
                }
            }, 500);
            return;
        } else {
            // Not actively navigating, hide autocomplete
            hideCharacterAutocomplete();
            return;
        }
    }
    
    const target = e.target;
    const value = target.value;
    const cursorPosition = target.selectionStart;
    
    // Get the text before the cursor
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    let searchText = lastDelimiterIndex >= 0 ? 
        textBeforeCursor.substring(lastDelimiterIndex + 1).trim() : 
        textBeforeCursor.trim();
    
    // Special handling for text replacement searches starting with <
    // If the search text starts with <, we need to preserve it for the search
    if (searchText.startsWith('<')) {
        // Keep the < in the search text
        searchText = searchText;
    } else {
        // Check if there's a < character before the cursor that should be included
        const lastLessThanIndex = textBeforeCursor.lastIndexOf('<');
        if (lastLessThanIndex > lastDelimiterIndex) {
            // There's a < after the last delimiter, include it in the search
            searchText = textBeforeCursor.substring(lastLessThanIndex).trim();
        }
    }
    
    // Clear existing timeout
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
    }
    
    // Set timeout to search after user stops typing
    characterAutocompleteTimeout = setTimeout(() => {
        // For text replacement searches (starting with <), search immediately even with 1 character
        if (searchText.startsWith('<') || searchText.length >= 2) {
            searchCharacters(searchText, target);
        } else {
            hideCharacterAutocomplete();
        }
    }, 500);
}

// Global variables for emphasis popup
let emphasisPopupActive = false;
let emphasisPopupValue = 1.0;
let emphasisPopupTarget = null;
let emphasisPopupSelection = null;

// Global variables for emphasis editing
let emphasisEditingActive = false;
let emphasisEditingValue = 1.0;
let emphasisEditingTarget = null;
let emphasisEditingSelection = null;
let emphasisEditingMode = 'normal'; // 'normal', 'brace', 'group'

// Emphasis highlighting functionality
let emphasisHighlightingActive = false;
let emphasisHighlightingTarget = null;

// Track if we're in autocomplete navigation mode
let autocompleteNavigationMode = false;
// Track if autocomplete is expanded to show all results
let autocompleteExpanded = false;

function handleCharacterAutocompleteKeydown(e) {
    // Handle emphasis editing popup
    if (emphasisEditingActive) {
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                emphasisEditingValue = Math.min(emphasisEditingValue + 0.1, 5.0);
                updateEmphasisEditingPopup();
                break;
            case 'ArrowDown':
                e.preventDefault();
                emphasisEditingValue = Math.max(emphasisEditingValue - 0.1, -3.0);
                updateEmphasisEditingPopup();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                switchEmphasisMode('left');
                break;
            case 'ArrowRight':
                e.preventDefault();
                switchEmphasisMode('right');
                break;
            case 'Enter':
                e.preventDefault();
                applyEmphasisEditing();
                return;
            case 'Escape':
                e.preventDefault();
                cancelEmphasisEditing();
                return;
            default:
                // Any other key applies the emphasis
                applyEmphasisEditing();
                return;
        }
        return;
    }

    // Handle autocomplete navigation - only when autocomplete is visible AND we're in navigation mode
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
        const items = characterAutocompleteList ? characterAutocompleteList.querySelectorAll('.character-autocomplete-item') : [];
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                autocompleteNavigationMode = true;
                // Expand to show all items when navigating down
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                }
                selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 1, items.length - 1);
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
            case 'ArrowUp':
                e.preventDefault();
                autocompleteNavigationMode = true;
                // If at the first item and pressing up, exit autocomplete
                if (selectedCharacterAutocompleteIndex <= 0) {
                    hideCharacterAutocomplete();
                    autocompleteNavigationMode = false;
                    return;
                }
                selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 1, -1);
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                // Only handle left/right arrows when actively selecting items in the menu
                if (selectedCharacterAutocompleteIndex >= 0) {
                    e.preventDefault();
                    if (e.key === 'ArrowRight') {
                        // Insert the selected item
                        if (items[selectedCharacterAutocompleteIndex]) {
                            const selectedItem = items[selectedCharacterAutocompleteIndex];
                            if (selectedItem.dataset.type === 'textReplacement') {
                                // For text replacements, insert the actual text, not the placeholder
                                const placeholder = selectedItem.dataset.placeholder;
                                const actualText = textReplacements[placeholder] || placeholder;
                                insertTextReplacement(actualText);
                            } else if (selectedItem.dataset.type === 'tag') {
                                selectTag(selectedItem.dataset.tagName);
                            } else {
                                const character = JSON.parse(selectedItem.dataset.characterData);
                                selectCharacterItem(character);
                            }
                        }
                    }
                } else {
                    // When not actively selecting, allow normal text navigation
                    hideCharacterAutocomplete();
                    autocompleteNavigationMode = false;
                }
                break;
            case 'Enter':
                e.preventDefault();
                autocompleteNavigationMode = true;
                if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
                    const selectedItem = items[selectedCharacterAutocompleteIndex];
                    if (selectedItem.dataset.type === 'textReplacement') {
                        selectTextReplacement(selectedItem.dataset.placeholder);
                    } else if (selectedItem.dataset.type === 'tag') {
                        selectTag(selectedItem.dataset.tagName);
                    } else {
                        const character = JSON.parse(selectedItem.dataset.characterData);
                        selectCharacterItem(character);
                    }
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideCharacterAutocomplete();
                autocompleteNavigationMode = false;
                break;
            case 'e':
            case 'E':
                // Only handle 'E' key when we're in navigation mode (autocomplete is active)
                if (autocompleteNavigationMode) {
                    e.preventDefault();
                    // Start emphasis editing for current tag
                    startEmphasisEditing(currentCharacterAutocompleteTarget);
                }
                break;
            case 'Backspace':
                // When actively navigating in autocomplete, don't close it on backspace
                if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
                    // Allow normal backspace behavior but keep autocomplete open
                    // The input handler will handle the actual text deletion and search
                    return;
                }
                break;
        }
    }
    // Note: We don't handle any keys when autocomplete is not visible or not in navigation mode
    // This allows all keys to work normally in text input
}

async function searchCharacters(query, target) {
    try {        
        // Check if query starts with < - only return text replacements in this case
        const isTextReplacementSearch = query.startsWith('<');
        
        let searchResults = [];
        
        if (!isTextReplacementSearch) {
            // Only search server if not starting with <
            const response = await fetchWithAuth(`/search/prompt?m=${manualModel.value}&q=${encodeURIComponent(query)}`);
            
            if (!response.ok) {
                throw new Error('Failed to search characters and tags');
            }
            
            searchResults = await response.json();
        }
        
        // Handle PICK_ prefix stripping for search but preserve in inserted text
        let searchQuery = query;
        let hasPickPrefix = false;
        
        if (query.startsWith('PICK_')) {
            searchQuery = query.substring(5); // Remove PICK_ prefix for searching
            hasPickPrefix = true;
        }
        
        // For text replacement searches, strip the < character from the search query
        if (isTextReplacementSearch) {
            searchQuery = searchQuery.substring(1); // Remove the < character
        }
                
        // Search through text replacements
        const textReplacementResults = Object.keys(textReplacements)
            .filter(key => {
                const keyToSearch = key.startsWith('PICK_') ? key.substring(5) : key;
                // If searchQuery is empty (just < was typed), return all items
                if (searchQuery === '') {
                    return true;
                }
                return keyToSearch.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .map(key => ({
                type: 'textReplacement',
                name: key,
                description: textReplacements[key],
                placeholder: key, // The placeholder name like <NAME> or <PICK_NAME>
                // If we searched with PICK_ prefix, ensure the result preserves it
                displayName: hasPickPrefix && !key.startsWith('PICK_') ? `PICK_${key}` : key
            }));
                
        // Combine search results with text replacement results
        const allResults = [...searchResults, ...textReplacementResults];
        characterSearchResults = allResults;
        
        // Always show autocomplete, even with no results
        showCharacterAutocompleteSuggestions(allResults, target);
    } catch (error) {
        console.error('Character and tag search error:', error);
        hideCharacterAutocomplete();
    }
}

function showCharacterAutocompleteSuggestions(results, target) {
    if (!characterAutocompleteList || !characterAutocompleteOverlay) {
        console.error('Character autocomplete elements not found');
        return;
    }
    
    currentCharacterAutocompleteTarget = target;
    selectedCharacterAutocompleteIndex = -1;
    
    // Store all results for potential expansion
    window.allAutocompleteResults = results;
    
    // Check if we can add emphasis option
    const canAddEmphasis = checkCanAddEmphasis(target);
    
    // Show all results if expanded, otherwise show only first 5 items
    const displayResults = autocompleteExpanded ? results : results.slice(0, 5);
    
    // Populate character autocomplete list
    characterAutocompleteList.innerHTML = '';
    
    // If no results, show a "no results" message
    if (results.length === 0) {
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'character-autocomplete-item no-results';
        noResultsItem.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">No results found</span>
                <span class="character-copyright">Try a different search term</span>
            </div>
        `;
        characterAutocompleteList.appendChild(noResultsItem);
    } else {
        // Add emphasis tooltip at the bottom if applicable
        // Note: This will be shown/hidden based on navigation mode
        if (canAddEmphasis) {
            const emphasisTooltip = document.createElement('div');
            emphasisTooltip.className = 'character-autocomplete-tooltip';
            emphasisTooltip.id = 'emphasisTooltip';
            emphasisTooltip.style.display = 'none'; // Hidden by default
            emphasisTooltip.innerHTML = `
                <span>Press E to add emphasis</span>
            `;
            characterAutocompleteList.appendChild(emphasisTooltip);
        }
        
        displayResults.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'character-autocomplete-item';
            
            if (result.type === 'textReplacement') {
                // Handle text replacement results
                item.dataset.type = 'textReplacement';
                item.dataset.placeholder = result.placeholder;
                
                // Use displayName if available, otherwise use placeholder
                const displayName = result.displayName || result.placeholder;
                
                item.innerHTML = `
                    <div class="character-info-row">
                        <span class="character-name">${displayName}</span>
                        <span class="character-copyright">Text Replacement</span>
                    </div>
                    <div class="character-info-row">
                        <div class="placeholder-desc"><span class="placeholder-desc-text">${result.description}</span></div>
                    </div>
                `;
                
                item.addEventListener('click', () => selectTextReplacement(result.placeholder));
            } else if (result.type === 'tag') {
                // Handle tag results
                item.dataset.type = 'tag';
                item.dataset.tagName = result.name;
                item.dataset.modelType = result.model.toLowerCase().includes('furry') ? 'furry' : 'anime';
                
                item.innerHTML = `
                    <div class="character-info-row">
                        <span class="character-name">${result.name}</span>
                        <span class="character-copyright">${modelKeys[result.model.toLowerCase()]?.type || 'NovelAI'}${modelKeys[result.model.toLowerCase()]?.version ? ' <span class="badge">' + modelKeys[result.model.toLowerCase()]?.version + '</span>' : ''}</span>
                    </div>
                `;
                
                item.addEventListener('click', () => selectTag(result.name));
            } else {
                // Handle character results
                item.dataset.type = 'character';
                item.dataset.characterData = JSON.stringify(result.character);
                
                // Parse name and copyright from character data
                const character = result.character;
                const name = character.name || result.name;
                const copyright = character.copyright || '';
                
                item.innerHTML = `
                    <div class="character-info-row">
                        <span class="character-name">${name}</span>
                        <span class="character-copyright">${copyright}</span>
                    </div>
                `;
                
                item.addEventListener('click', () => selectCharacterItem(result.character));
            }
            
            characterAutocompleteList.appendChild(item);
        });
        
        // Add "show more" indicator if there are more results and not expanded
        if (results.length > 5 && !autocompleteExpanded) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press ↓ to show all ${results.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }
    }
    
    // Position overlay relative to viewport
    const rect = target.getBoundingClientRect();
    characterAutocompleteOverlay.style.left = rect.left + 'px';
    characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    characterAutocompleteOverlay.style.width = rect.width + 'px';
    
    characterAutocompleteOverlay.classList.remove('hidden');
    
    // Auto-select first item if there are results and user is in navigation mode
    if (results.length > 0 && (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0)) {
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
    }
}

function checkCanAddEmphasis(target) {
    const value = target.value;
    const cursorPosition = target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // First check if cursor is inside a {} or [] block
    const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
    let braceMatch;
    while ((braceMatch = bracePattern.exec(value)) !== null) {
        const braceStart = braceMatch.index;
        const braceEnd = braceMatch.index + braceMatch[0].length;
        
        if (cursorPosition >= braceStart && cursorPosition <= braceEnd) {
            // Cursor is inside a {} or [] block, can add emphasis
            return true;
        }
    }
    
    // Check if cursor is at end of a tag pattern (same logic as autocomplete)
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const searchText = lastDelimiterIndex >= 0 ? 
        textBeforeCursor.substring(lastDelimiterIndex + 1).trim() : 
        textBeforeCursor.trim();
    
    // Check if we have a valid tag to emphasize
    return searchText.length >= 2 && /^[a-zA-Z0-9_]+$/.test(searchText);
}

function expandAutocompleteToShowAll() {
    if (!window.allAutocompleteResults || !characterAutocompleteList) return;
    
    autocompleteExpanded = true;
    
    // Clear current list
    characterAutocompleteList.innerHTML = '';
    
    // Add all results
    window.allAutocompleteResults.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = 'character-autocomplete-item';
        
        if (result.type === 'textReplacement') {
            item.dataset.type = 'textReplacement';
            item.dataset.placeholder = result.placeholder;
            
            // Use displayName if available, otherwise use placeholder
            const displayName = result.displayName || result.placeholder;
            
            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${displayName}</span>
                    <span class="character-copyright">Text Replacement</span>
                </div>
                <div class="character-info-row">
                    <div class="placeholder-desc"><span class="placeholder-desc-text">${result.description}</span></div>
                </div>
            `;
            
            item.addEventListener('click', () => selectTextReplacement(result.placeholder));
        } else if (result.type === 'tag') {
            item.dataset.type = 'tag';
            item.dataset.tagName = result.name;
            item.dataset.modelType = result.model.toLowerCase().includes('furry') ? 'furry' : 'anime';
            
            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${result.name}</span>
                    <span class="character-copyright">${modelKeys[result.model.toLowerCase()]?.type || 'NovelAI'}${modelKeys[result.model.toLowerCase()]?.version ? ' <span class="badge">' + modelKeys[result.model.toLowerCase()]?.version + '</span>' : ''}</span>
                </div>
            `;
            
            item.addEventListener('click', () => selectTag(result.name));
        } else {
            item.dataset.type = 'character';
            item.dataset.characterData = JSON.stringify(result.character);
            
            const character = result.character;
            const name = character.name || result.name;
            const copyright = character.copyright || '';
            
            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${name}</span>
                    <span class="character-copyright">${copyright}</span>
                </div>
            `;
            
            item.addEventListener('click', () => selectCharacterItem(result.character));
        }
        
        characterAutocompleteList.appendChild(item);
    });
    
    // Maintain selection after expanding
    if (selectedCharacterAutocompleteIndex >= 0) {
        updateCharacterAutocompleteSelection();
    }
}

// Emphasis popup functions
function showEmphasisPopup() {
    // Create popup if it doesn't exist
    let popup = document.getElementById('emphasisPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'emphasisPopup';
        popup.className = 'emphasis-popup';
        popup.innerHTML = `
            <div class="emphasis-popup-content">
                <div class="emphasis-label">Emphasis Weight</div>
                <div class="emphasis-value">${emphasisPopupValue.toFixed(1)}</div>
                <div class="emphasis-controls">
                    <button class="emphasis-btn" onclick="adjustEmphasis(-0.1)">-</button>
                    <input type="range" min="0.1" max="2.0" step="0.1" value="${emphasisPopupValue}" 
                           oninput="updateEmphasisFromSlider(this.value)" 
                           onwheel="adjustEmphasisFromWheel(event)">
                    <button class="emphasis-btn" onclick="adjustEmphasis(0.1)">+</button>
                </div>
                <div class="emphasis-help">Use ↑↓ arrows or scroll to adjust</div>
            </div>
        `;
        document.body.appendChild(popup);
    }
    
    // Position popup near cursor
    const rect = emphasisPopupTarget.getBoundingClientRect();
    const cursorPosition = emphasisPopupTarget.selectionStart;
    const textBeforeCursor = emphasisPopupTarget.value.substring(0, cursorPosition);
    
    // Calculate approximate cursor position
    const tempSpan = document.createElement('span');
    tempSpan.style.font = window.getComputedStyle(emphasisPopupTarget).font;
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'pre';
    tempSpan.textContent = textBeforeCursor;
    document.body.appendChild(tempSpan);
    
    const textWidth = tempSpan.offsetWidth;
    document.body.removeChild(tempSpan);
    
    popup.style.left = (rect.left + textWidth) + 'px';
    popup.style.top = (rect.top - popup.offsetHeight - 10) + 'px';
    popup.style.display = 'block';
    
    updateEmphasisPopup();
}

function updateEmphasisPopup() {
    const popup = document.getElementById('emphasisPopup');
    if (!popup) return;
    
    const valueElement = popup.querySelector('.emphasis-value');
    const slider = popup.querySelector('input[type="range"]');
    
    if (valueElement) valueElement.textContent = emphasisPopupValue.toFixed(1);
    if (slider) slider.value = emphasisPopupValue;
}

function adjustEmphasis(delta) {
    emphasisPopupValue = Math.max(0.1, Math.min(2.0, emphasisPopupValue + delta));
    updateEmphasisPopup();
}

function updateEmphasisFromSlider(value) {
    emphasisPopupValue = parseFloat(value);
    updateEmphasisPopup();
}

function adjustEmphasisFromWheel(event) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    adjustEmphasis(delta);
}

function startEmphasisEditing(target) {
    if (!target) return;
    
    emphasisEditingTarget = target;
    const value = target.value;
    const cursorPosition = target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // First, check if cursor is inside an existing emphasis block
    const emphasisPattern = /(\d+\.\d+)::([^:]+)::/g;
    let emphasisMatch;
    let insideEmphasis = false;
    let emphasisMode = 'normal'; // 'normal', 'brace', 'group'
    
    while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
        const emphasisStart = emphasisMatch.index;
        const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
        
        if (cursorPosition >= emphasisStart && cursorPosition <= emphasisEnd) {
            // Cursor is inside an existing emphasis block
            insideEmphasis = true;
            emphasisEditingValue = parseFloat(emphasisMatch[1]);
            emphasisEditingSelection = {
                start: emphasisStart,
                end: emphasisEnd
            };
            
            // Check if there's a {} block inside this emphasis block
            const emphasisText = emphasisMatch[2];
            const bracePattern = /\{([^}]*)\}/g;
            let braceMatch;
            while ((braceMatch = bracePattern.exec(emphasisText)) !== null) {
                const braceStartInEmphasis = emphasisStart + emphasisMatch.index;
                const braceEndInEmphasis = braceStartInEmphasis + braceMatch[0].length;
                
                if (cursorPosition >= braceStartInEmphasis && cursorPosition <= braceEndInEmphasis) {
                    // Cursor is inside a {} block within the emphasis block
                    emphasisMode = 'brace';
                    emphasisEditingSelection = {
                        start: braceStartInEmphasis,
                        end: braceEndInEmphasis
                    };
                    break;
                }
            }
            
            if (emphasisMode !== 'brace') {
                emphasisMode = 'group';
            }
            break;
        }
    }
    
    if (!insideEmphasis) {
        // Check if cursor is inside a {} or [] block
        const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
        let braceMatch;
        let insideBrace = false;
        
        while ((braceMatch = bracePattern.exec(value)) !== null) {
            const braceStart = braceMatch.index;
            const braceEnd = braceMatch.index + braceMatch[0].length;
            
            if (cursorPosition >= braceStart && cursorPosition <= braceEnd) {
                // Cursor is inside a {} or [] block
                insideBrace = true;
                emphasisMode = 'brace';
                // Calculate weight based on number of {} or [] around it
                const braceText = braceMatch[0];
                const isBracket = braceText.startsWith('[');
                
                if (isBracket) {
                    // [] block - negative emphasis
                    const openBrackets = (braceText.match(/\[/g) || []).length;
                    const closeBrackets = (braceText.match(/\]/g) || []).length;
                    const bracketLevel = openBrackets - closeBrackets;
                    emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                } else {
                    // {} block - positive emphasis
                    const openBraces = (braceText.match(/\{/g) || []).length;
                    const closeBraces = (braceText.match(/\}/g) || []).length;
                    const braceLevel = openBraces - closeBraces;
                    emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                }
                
                emphasisEditingSelection = {
                    start: braceStart,
                    end: braceEnd
                };
                break;
            }
        }
        
        // If not inside a brace, check if we're at the start/end of a brace block within an emphasis group
        if (!insideBrace) {
            const emphasisPattern = /(\d+\.\d+)::([^:]+)::/g;
            let emphasisMatch;
            
            while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
                const emphasisStart = emphasisMatch.index;
                const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
                const emphasisText = emphasisMatch[2];
                
                // Check if cursor is at the start or end of a brace block within this emphasis
                if (cursorPosition >= emphasisStart && cursorPosition <= emphasisEnd) {
                    const relativePos = cursorPosition - emphasisStart;
                    const emphasisContent = emphasisText;
                    
                    // Check if cursor is at the start of a brace block
                    const braceStartMatch = emphasisContent.match(/^(\{+|\[+)/);
                    if (braceStartMatch && relativePos <= braceStartMatch[0].length) {
                        insideBrace = true;
                        emphasisMode = 'brace';
                        const braceLevel = braceStartMatch[0].length;
                        emphasisEditingValue = braceStartMatch[0].startsWith('[') ? 
                            1.0 - (braceLevel * 0.1) : 1.0 + (braceLevel * 0.1);
                        emphasisEditingSelection = {
                            start: emphasisStart + emphasisMatch.index + 1,
                            end: emphasisStart + emphasisMatch.index + 1 + braceStartMatch[0].length
                        };
                        break;
                    }
                    
                    // Check if cursor is at the end of a brace block
                    const braceEndMatch = emphasisContent.match(/(\}+|]+)$/);
                    if (braceEndMatch && relativePos >= emphasisContent.length - braceEndMatch[0].length) {
                        insideBrace = true;
                        emphasisMode = 'brace';
                        const braceLevel = braceEndMatch[0].length;
                        emphasisEditingValue = braceEndMatch[0].startsWith(']') ? 
                            1.0 - (braceLevel * 0.1) : 1.0 + (braceLevel * 0.1);
                        emphasisEditingSelection = {
                            start: emphasisStart + emphasisMatch.index + 1 + emphasisContent.length - braceEndMatch[0].length,
                            end: emphasisStart + emphasisMatch.index + 1 + emphasisContent.length
                        };
                        break;
                    }
                }
            }
        }
        
        if (!insideBrace) {
            // Check if there's a text selection
            const selectionStart = target.selectionStart;
            const selectionEnd = target.selectionEnd;
            const hasSelection = selectionStart !== selectionEnd;
            
            if (hasSelection) {
                // Use the selected text for emphasis
                emphasisEditingSelection = {
                    start: selectionStart,
                    end: selectionEnd
                };
                emphasisEditingValue = 1.0;
                emphasisMode = 'normal';
            } else {
                // For new blocks, search back to find the block boundary
                const searchBackIndex = Math.max(
                    textBeforeCursor.lastIndexOf(','),
                    textBeforeCursor.lastIndexOf('|'),
                    textBeforeCursor.lastIndexOf(':'),
                    textBeforeCursor.lastIndexOf('{'),
                    textBeforeCursor.lastIndexOf('}'),
                    textBeforeCursor.lastIndexOf('['),
                    textBeforeCursor.lastIndexOf(']')
                );
                
                const blockStart = searchBackIndex >= 0 ? searchBackIndex + 1 : 0;
                
                // Search forward to find the end of the current tag
                const textAfterCursor = value.substring(cursorPosition);
                const searchForwardIndex = Math.min(
                    textAfterCursor.indexOf(',') >= 0 ? textAfterCursor.indexOf(',') : Infinity,
                    textAfterCursor.indexOf('|') >= 0 ? textAfterCursor.indexOf('|') : Infinity,
                    textAfterCursor.indexOf(':') >= 0 ? textAfterCursor.indexOf(':') : Infinity,
                    textAfterCursor.indexOf('{') >= 0 ? textAfterCursor.indexOf('{') : Infinity,
                    textAfterCursor.indexOf('}') >= 0 ? textAfterCursor.indexOf('}') : Infinity,
                    textAfterCursor.indexOf('[') >= 0 ? textAfterCursor.indexOf('[') : Infinity,
                    textAfterCursor.indexOf(']') >= 0 ? textAfterCursor.indexOf(']') : Infinity
                );
                
                const blockEnd = searchForwardIndex !== Infinity ? cursorPosition + searchForwardIndex : value.length;
                const blockText = value.substring(blockStart, blockEnd).trim();
                
                if (blockText.length < 2) return;
                
                // Check if the current tag is already emphasized
                const currentTagEmphasisPattern = new RegExp(`(\\d+\\.\\d+)::${blockText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}::`);
                const currentTagMatch = value.match(currentTagEmphasisPattern);
                
                if (currentTagMatch) {
                    // Current tag is already emphasized, adjust its weight
                    emphasisEditingValue = parseFloat(currentTagMatch[1]);
                    emphasisEditingSelection = {
                        start: currentTagMatch.index,
                        end: currentTagMatch.index + currentTagMatch[0].length
                    };
                    emphasisMode = 'group';
                } else {
                    // Create new emphasis block
                    emphasisEditingValue = 1.0;
                    emphasisEditingSelection = {
                        start: blockStart,
                        end: blockEnd
                    };
                    emphasisMode = 'normal';
                }
            }
        }
    }
    
    emphasisEditingTarget = target;
    emphasisEditingActive = true;
    emphasisEditingMode = emphasisMode; // Store the mode for later use
    
    // Hide autocomplete
    hideCharacterAutocomplete();
    
    // Show emphasis editing popup
    showEmphasisEditingPopup();
}

function showEmphasisEditingPopup() {
    // Create popup if it doesn't exist
    let popup = document.getElementById('emphasisEditingPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'emphasisEditingPopup';
        popup.className = 'emphasis-popup';
        popup.innerHTML = `
            <div class="emphasis-popup-content">
                <div class="emphasis-header">
                    <div class="emphasis-text" id="emphasisText">Select text...</div>
                </div>
                <div class="emphasis-toolbar">
                    <div class="emphasis-value" id="emphasisValue">1.0</div>
                    <div class="emphasis-type" id="emphasisType">New Group</div>
                    <div class="emphasis-controls">
                        <button class="btn-secondary emphasis-btn emphasis-up" onclick="adjustEmphasisEditing(0.1)" title="Increase">
                        <i class="nai-plus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn emphasis-down" onclick="adjustEmphasisEditing(-0.1)" title="Decrease">
                        <i class="nai-minus"></i>
                        </button>
                        <button class="btn-secondary emphasis-btn emphasis-toggle" id="emphasisToggleBtn" onclick="switchEmphasisMode('toggle')" title="Toggle Mode" style="display: none;">
                        <i class="nai-arrow-left"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(popup);
    }
    
    // Position popup near text cursor
    const rect = emphasisEditingTarget.getBoundingClientRect();
    const cursorPosition = emphasisEditingTarget.selectionStart;
    const textBeforeCursor = emphasisEditingTarget.value.substring(0, cursorPosition);
    
    // Position popup relative to the input field
    const inputPadding = parseInt(window.getComputedStyle(emphasisEditingTarget).paddingLeft) || 0;
    
    // Position popup near the center-right of the input field
    const cursorX = rect.left + (rect.width * 0.7); // 70% from the left
    const cursorY = rect.top;
    
    // Position popup above the cursor
    popup.style.left = cursorX + 'px';
    popup.style.top = (cursorY - popup.offsetHeight - 10) + 'px';
    popup.style.display = 'block';
    popup.style.zIndex = '9999'; // Ensure it's on top
    
    updateEmphasisEditingPopup();
}

function updateEmphasisEditingPopup() {
    const popup = document.getElementById('emphasisEditingPopup');
    if (!popup) return;
    
    const valueElement = popup.querySelector('#emphasisValue');
    const typeElement = popup.querySelector('#emphasisType');
    const textElement = popup.querySelector('#emphasisText');
    const toggleBtn = popup.querySelector('#emphasisToggleBtn');
    
    if (valueElement) {
        valueElement.textContent = emphasisEditingValue.toFixed(1);
        
        // Color code the emphasis value
        if (emphasisEditingValue > 1.0) {
            valueElement.style.color = '#ff8c00'; // Orange for > 1
        } else if (emphasisEditingValue < 1.0) {
            valueElement.style.color = '#87ceeb'; // Light blue for < 1
        } else {
            valueElement.style.color = '#ffffff'; // White for = 1
        }
    }
    
    // Update type indicator
    if (typeElement) {
        let typeText = '';
        let modeClass = '';
        switch (emphasisEditingMode) {
            case 'normal':
                typeText = 'New Group';
                modeClass = 'mode-normal';
                break;
            case 'brace':
                typeText = 'Brace Block';
                modeClass = 'mode-brace';
                break;
            case 'group':
                typeText = 'Modify Group';
                modeClass = 'mode-group';
                break;
        }
        typeElement.textContent = typeText;
        typeElement.className = `emphasis-type ${modeClass}`;
    }
    
    // Update text content
    if (textElement && emphasisEditingTarget && emphasisEditingSelection) {
        const target = emphasisEditingTarget;
        const text = target.value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
        
        // Remove :: wrapper if it's an emphasis block, or {}/[] if it's a brace block
        let displayText = text;
        if (emphasisEditingMode === 'group') {
            const emphasisMatch = text.match(/\d+\.\d+::(.+?)::/);
            if (emphasisMatch) {
                displayText = emphasisMatch[1];
            }
        } else if (emphasisEditingMode === 'brace') {
            // Remove all { and } or [ and ] from the beginning and end
            displayText = text.replace(/^\{+|\[+/, '').replace(/\}+|\]+$/, '');
        }
        
        textElement.textContent = displayText;
    }
    
    // Update toggle button visibility and direction
    if (toggleBtn) {
        let arrowDirection = '';
        let tooltipText = '';
        
        console.log('Current emphasis mode:', emphasisEditingMode);
        
        // Always show toggle button, determine direction based on current mode
        if (emphasisEditingMode === 'group') {
            arrowDirection = '<i class="fas fa-brackets-curly"></i>';
            tooltipText = 'Switch to Brace Block';
        } else if (emphasisEditingMode === 'brace') {
            arrowDirection = '<i class="fas fa-colon"></i>';
            tooltipText = 'Switch to Group';
        } else if (emphasisEditingMode === 'normal') {
            arrowDirection = '<i class="fas fa-brackets-curly"></i>';
            tooltipText = 'Switch to Brace Block';
        }
        
        // Always show the button
        toggleBtn.style.display = '';
        toggleBtn.innerHTML = arrowDirection;
        toggleBtn.title = tooltipText;
    }
}

function adjustEmphasisEditing(delta) {
    emphasisEditingValue = Math.max(-1.0, Math.min(2.5, emphasisEditingValue + delta));
    updateEmphasisEditingPopup();
}

function updateEmphasisEditingFromSlider(value) {
    emphasisEditingValue = parseFloat(value);
    updateEmphasisEditingPopup();
}

function adjustEmphasisEditingFromWheel(event) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    adjustEmphasisEditing(delta);
}

function applyEmphasisEditing() {
    if (!emphasisEditingTarget || !emphasisEditingSelection) return;
    
    const target = emphasisEditingTarget;
    const value = target.value;
    const weight = emphasisEditingValue.toFixed(1);
    
    // Get the text to emphasize (trim any leading/trailing spaces)
    const textToEmphasize = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end).trim();
    
    // Check if we're inside an existing emphasis block
    const emphasisPattern = /(\d+\.\d+)::([^:]+)::/;
    const isInsideEmphasis = emphasisPattern.test(textToEmphasize);
    
    // Check if we're inside a {} or [] block
    const isInsideBrace = (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) || 
                          (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']'));
    
    let emphasizedText;
    if (emphasisEditingMode === 'brace') {
        // Brace mode: create or update {} or [] blocks
        if (isInsideBrace) {
            // Update existing brace block - extract the actual text content
            let innerText;
            if (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) {
                // Remove all { and } from the beginning and end
                innerText = textToEmphasize.replace(/^\{+/, '').replace(/\}+$/, '');
            } else if (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']')) {
                // Remove all [ and ] from the beginning and end
                innerText = textToEmphasize.replace(/^\[+/, '').replace(/\]+$/, '');
            } else {
                innerText = textToEmphasize;
            }
            
            const braceLevel = Math.round((emphasisEditingValue - 1.0) * 10);
            
            if (braceLevel > 0) {
                // Positive emphasis: use {} - ensure clean conversion from []
                const braces = '{'.repeat(braceLevel + 1);
                emphasizedText = `${braces}${innerText}${'}'.repeat(braceLevel + 1)}`;
            } else if (braceLevel < 0) {
                // Negative emphasis: use [] - ensure clean conversion from {}
                const bracketLevel = Math.abs(Math.round((1.0 - emphasisEditingValue) * 10));
                const brackets = '['.repeat(bracketLevel);
                emphasizedText = `${brackets}${innerText}${']'.repeat(bracketLevel)}`;
            } else {
                // No emphasis: just the text - remove all braces/brackets
                emphasizedText = innerText;
            }
        } else {
            // Create new brace block
            const braceLevel = Math.round((emphasisEditingValue - 1.0) * 10);
            
            if (braceLevel > 0) {
                // Positive emphasis: use {}
                const braces = '{'.repeat(braceLevel + 1);
                emphasizedText = `${braces}${textToEmphasize}${'}'.repeat(braceLevel + 1)}`;
            } else if (braceLevel < 0) {
                // Negative emphasis: use [] (inverted calculation)
                const bracketLevel = Math.abs(Math.round((1.0 - emphasisEditingValue) * 10));
                const brackets = '['.repeat(bracketLevel);
                emphasizedText = `${brackets}${textToEmphasize}${']'.repeat(bracketLevel)}`;
            } else {
                // No emphasis: just the text
                emphasizedText = textToEmphasize;
            }
        }
    } else if (isInsideEmphasis) {
        // We're inside an existing emphasis block, just update the weight
        const match = textToEmphasize.match(emphasisPattern);
        if (match) {
            emphasizedText = textToEmphasize.replace(match[1], weight);
        } else {
            emphasizedText = `${weight}::${textToEmphasize}::`;
        }
    } else {
        // Create new emphasis block - no extra spaces inside
        emphasizedText = `${weight}::${textToEmphasize}::`;
    }
    
    // Replace the text, preserving the original spacing around the selection
    const beforeText = value.substring(0, emphasisEditingSelection.start);
    let afterText = value.substring(emphasisEditingSelection.end);
    
    // For brace mode, handle closing braces/brackets around the entire tag
    if (emphasisEditingMode === 'brace') {
        // Find the start and end of the tag by searching for delimiters
        let tagStart = emphasisEditingSelection.start;
        let tagEnd = emphasisEditingSelection.end;
    
        // Expand tagStart backwards to skip spaces, commas, and braces/brackets
        while (tagStart > 0) {
            const char = value[tagStart - 1];
            if (char === ' ' || char === '{' || char === '[' || char === '}' || char === ']') {
                tagStart--;
            } else if (char === ',') {
                // If comma, ensure a space follows it
                if (value[tagStart] !== ' ') {
                    // Insert a space after the comma if missing
                    beforeTag = value.substring(0, tagStart) + ', ';
                    tagStart = beforeTag.length;
                }
                break;
            } else if (char === ':' || char === '|') {
                break;
            } else {
                break;
            }
        }
        // Expand tagEnd forwards to skip spaces, commas, and braces/brackets
        while (tagEnd < value.length) {
            const char = value[tagEnd];
            if (char === ' ' || char === '{' || char === '[' || char === '}' || char === ']') {
                tagEnd++;
            } else if (char === ',') {
                // If comma, ensure a space follows it
                if (value[tagEnd + 1] !== ' ') {
                    // Insert a space after the comma if missing
                    tagEnd++;
                }
                break;
            } else if (char === ':' || char === '|') {
                break;
            } else {
                break;
            }
        }
    
        // Get the text around the tag
        const beforeTag = value.substring(0, tagStart);
        let afterTag = value.substring(tagEnd);
        if (/^,/.test(afterTag) && !/^,\\s/.test(afterTag)) {
            afterTag = ', ' + afterTag.slice(1);
        }
    
        let newValue = beforeTag + emphasizedText + afterTag;
        // Add space after comma if needed
        newValue = newValue.replace(/,([^\s])/g, ', $1');
        target.value = newValue;
        // Set cursor position after the emphasized text
        const newCursorPosition = newValue.indexOf(emphasizedText) + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
    } else {
        // For other modes, handle spacing as before
        // Ensure there's a space before the emphasis block if needed (only for new blocks)
        let prefix = '';
        if (!isInsideEmphasis && !isInsideBrace && emphasisEditingSelection.start > 0) {
            const charBefore = value[emphasisEditingSelection.start - 1];
            if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
                prefix = ' ';
            }
        }
        
        // Remove any trailing space from beforeText and leading space from afterText
        // to avoid double spaces
        const trimmedBefore = beforeText.replace(/\s+$/, '');
        const trimmedAfter = afterText.replace(/^\s+/, '');
        
        let newValue = trimmedBefore + prefix + emphasizedText + (trimmedAfter ? ' ' + trimmedAfter : '');
        
        // Add space after comma if needed
        newValue = newValue.replace(/,([^\s])/g, ', $1');
        
        target.value = newValue;
        
        // Set cursor position after the emphasized text
        const newCursorPosition = trimmedBefore.length + prefix.length + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
    }
    
    // Hide popup
    const popup = document.getElementById('emphasisEditingPopup');
    if (popup) {
        popup.style.display = 'none';
    }
    
    // Reset state
    emphasisEditingActive = false;
    emphasisEditingTarget = null;
    emphasisEditingSelection = null;
    emphasisEditingMode = 'normal';
    
    // Trigger input event to update any dependent UI
    target.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Update emphasis highlighting
    autoResizeTextarea(target);
    updateEmphasisHighlighting(target);
}

// Emphasis highlighting functions
function startEmphasisHighlighting(textarea) {
    if (emphasisHighlightingActive && emphasisHighlightingTarget === textarea) return;
    
    emphasisHighlightingActive = true;
    emphasisHighlightingTarget = textarea;
    
    // Add event listeners for real-time highlighting
    textarea.addEventListener('input', () => {
        autoResizeTextarea(textarea);
        updateEmphasisHighlighting(textarea);
    });
    
    // Initial highlighting
    autoResizeTextarea(textarea);
    updateEmphasisHighlighting(textarea);
}

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Calculate new height based on content, accounting for padding
    const computedStyle = window.getComputedStyle(textarea);
    const paddingTop = parseFloat(computedStyle.paddingTop);
    const paddingBottom = parseFloat(computedStyle.paddingBottom);
    const borderTop = parseFloat(computedStyle.borderTopWidth);
    const borderBottom = parseFloat(computedStyle.borderBottomWidth);
    const totalPadding = paddingTop + paddingBottom + borderTop + borderBottom;
    
    const minHeight = 80;
    
    // Ensure scrollHeight is calculated correctly
    let scrollHeight = textarea.scrollHeight;
    if (scrollHeight === 0 && textarea.value) {
        // If scrollHeight is 0 but there's content, try again after a brief delay
        setTimeout(() => {
            textarea.style.height = 'auto';
            const newScrollHeight = textarea.scrollHeight;
            if (newScrollHeight > 0) {
                const newHeight = Math.max(newScrollHeight + totalPadding, minHeight);
                textarea.style.height = newHeight + 'px';
                
                // Update container height if it exists
                const container = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
                if (container) {
                    container.style.height = newHeight + 'px';
                    container.style.minHeight = newHeight + 'px';
                }
            }
        }, 5);
        return;
    }
    
    const newHeight = Math.max(scrollHeight + totalPadding, minHeight);
    
    // Set the new height
    textarea.style.height = newHeight + 'px';
    
    // Update container height if it exists
    const container = textarea.closest('.prompt-textarea-container, .character-prompt-textarea-container');
    if (container) {
        container.style.height = newHeight + 'px';
        container.style.minHeight = newHeight + 'px';
    }
}

function stopEmphasisHighlighting() {
    emphasisHighlightingActive = false;
    emphasisHighlightingTarget = null;
}

function updateEmphasisHighlighting(textarea) {
    if (!textarea) return;
    
    const value = textarea.value;
    const highlightedValue = highlightEmphasisInText(value);
    
    // Create or update the highlighting overlay
    let overlay = textarea.parentElement.querySelector('.emphasis-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'emphasis-highlight-overlay';
        textarea.parentElement.appendChild(overlay);
    }
    
    overlay.innerHTML = highlightedValue;
    
    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

function initializeEmphasisOverlay(textarea) {
    if (!textarea) return;
    
    const value = textarea.value;
    const highlightedValue = highlightEmphasisInText(value);
    
    // Create or update the highlighting overlay
    let overlay = textarea.parentElement.querySelector('.emphasis-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'emphasis-highlight-overlay';
        textarea.parentElement.appendChild(overlay);
    }
    
    overlay.innerHTML = highlightedValue;
    
    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

function highlightEmphasisInText(text) {
    if (!text) return '';
    
    let highlightedText = text;
    
    // Function to calculate dynamic colors based on weight
    function getEmphasisColors(weight) {
        let backgroundR, backgroundG, backgroundB, backgroundA;
        let borderR, borderG, borderB, borderA;
        
        if (weight >= 1.0 && weight <= 3.0) {
            // Positive emphasis: 1-3.0 with stronger 1-3 range and gradual 3-5 range
            if (weight <= 2.0) {
                // Stronger changes in 1-3 range
                const ratio = (weight - 1.0) / 2.0; // 0 to 1 over 1-3 range
                backgroundR = 255;
                backgroundG = Math.round(69 - (46 * ratio));
                backgroundB = Math.round(0 + (23 * ratio));
                backgroundA = 0.05 + (0.67 * ratio);
            } else {
                // More gradual changes in 3-5 range
                const gradualRatio = (weight - 3.0) / 2.0; // 0 to 1 over 3-5 range
                backgroundR = 255;
                backgroundG = 23; // Already at minimum from 1-3 range
                backgroundB = 23; // Already at maximum from 1-3 range
                backgroundA = 0.72 + (0.28 * gradualRatio); // Subtle alpha increase
            }
            
            // Brighter border for contrast
            borderR = Math.min(255, backgroundR + 30);
            borderG = Math.min(255, backgroundG + 30);
            borderB = Math.min(255, backgroundB + 30);
            borderA = Math.min(1.0, backgroundA + 0.2);
        } else if (weight >= -2.0 && weight <= 1.0) {
            // Negative emphasis: -4-1.0 = rgba(23, 134, 255, 0.69) to rgba(0, 91, 163, 0.25)
            const ratio = Math.max((weight + 2.0) / 3.0, 0.0); // Adjusted for -4 to 1 range
            backgroundR = Math.round(23 - (23 * ratio));
            backgroundG = Math.round(134 - (43 * ratio));
            backgroundB = 255;
            backgroundA = 0.69 - (0.44 * ratio);
            
            // Brighter border for contrast
            borderR = Math.min(255, backgroundR + 30);
            borderG = Math.min(255, backgroundG + 30);
            borderB = Math.min(255, backgroundB + 30);
            borderA = Math.min(1.0, backgroundA + 0.2);
        } else {
            // Default neutral color
            backgroundR = 76; backgroundG = 175; backgroundB = 80; backgroundA = 0.2;
            borderR = 106; borderG = 205; borderB = 110; borderA = 0.4;
        }
        
        return {
            background: `rgba(${backgroundR}, ${backgroundG}, ${backgroundB}, ${backgroundA.toFixed(2)})`,
            border: `rgba(${borderR}, ${borderG}, ${borderB}, ${borderA.toFixed(2)})`
        };
    }
    
    // Function to get group colors based on group index
    function getGroupColors(groupIndex) {
        const colors = [
            { border: 'rgba(255, 99, 132, 0.75)', background: 'rgba(255, 99, 132, 0.1)' },   // Red
            { border: 'rgba(54, 162, 235, 0.75)', background: 'rgba(54, 162, 235, 0.1)' },   // Blue
            { border: 'rgba(255, 205, 86, 0.75)', background: 'rgba(255, 205, 86, 0.1)' },   // Yellow
            { border: 'rgba(75, 192, 192, 0.75)', background: 'rgba(75, 192, 192, 0.1)' },   // Teal
            { border: 'rgba(153, 102, 255, 0.75)', background: 'rgba(153, 102, 255, 0.1)' }, // Purple
            { border: 'rgba(255, 159, 64, 0.75)', background: 'rgba(255, 159, 64, 0.1)' },   // Orange
            { border: 'rgba(199, 199, 199, 0.75)', background: 'rgba(199, 199, 199, 0.1)' }, // Gray
            { border: 'rgba(83, 102, 255, 0.75)', background: 'rgba(83, 102, 255, 0.1)' }    // Indigo
        ];
        return colors[groupIndex % colors.length];
    }
    
    // Function to apply NSFW highlighting to content
    function applyNSFWHighlighting(content) {
        if (!window.u1) return content;
        
        // Create a regex pattern from all u1 tags, sorted by length (longest first to avoid partial matches)
        const sortedTags = [...window.u1].sort((a, b) => b.length - a.length);
        const tagPattern = new RegExp(`\\b(${sortedTags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
        
        return content.replace(tagPattern, (match, tag) => {
            return `<span class="emphasis-highlight" style="background: #ff49dd85; border-color: #ff49ddc9;">${tag}</span>`;
        });
    }
    
    // First, split text into groups by | and apply group highlighting
    const groups = highlightedText.split('|');
    if (groups.length > 1) {
        highlightedText = groups.map((group, index) => {
            if (group) {
                const colors = getGroupColors(index);
                return `<span class="emphasis-group" style="border: 2px dashed ${colors.border}; padding: 0; margin: -4px; border-radius: 4px; display: inline;">${group}</span>`;
            }
            return group;
        }).join('|');
    }
    
    // Highlight weight::text:: format
    highlightedText = highlightedText.replace(/(-?\d+\.?\d*)::([^:]+)::/g, (match, weight, content) => {
        const weightNum = parseFloat(weight);
        const colors = getEmphasisColors(weightNum);
        
        // Apply NSFW highlighting to the content inside emphasis
        const highlightedContent = applyNSFWHighlighting(content);
        
        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${weight}::${highlightedContent}::</span>`;
    });
    
    // Highlight brace emphasis {text} - convert to weight equivalent
    highlightedText = highlightedText.replace(/(\{+)([^}]+)(\}+)/g, (match, openBraces, content, closeBraces) => {
        const braceLevel = Math.min(openBraces.length, closeBraces.length);
        const weight = 1.0 + (braceLevel * 0.1); // Convert brace level to weight (+0.1 per level)
        const colors = getEmphasisColors(weight);
        
        // Apply NSFW highlighting to the content inside braces
        const highlightedContent = applyNSFWHighlighting(content);
        
        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBraces}${highlightedContent}${closeBraces}</span>`;
    });
    
    // Highlight bracket emphasis [text] - convert to weight equivalent
    highlightedText = highlightedText.replace(/(\[+)([^\]]+)(\]+)/g, (match, openBrackets, content, closeBrackets) => {
        const bracketLevel = Math.min(openBrackets.length, closeBrackets.length);
        const weight = 1.0 - (bracketLevel * 0.1); // Convert bracket level to weight (-0.1 per level)
        const colors = getEmphasisColors(weight);
        
        // Apply NSFW highlighting to the content inside brackets
        const highlightedContent = applyNSFWHighlighting(content);
        
        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBrackets}${highlightedContent}${closeBrackets}</span>`;
    });
    
    // Highlight text replacements <text> - no emphasis levels, just visual highlighting
    // Match patterns that look like valid text replacement keys (letters, numbers, underscores) - case insensitive
    highlightedText = highlightedText.replace(/(<)([a-zA-Z0-9_]+)(>)/g, (match, openBracket, content, closeBracket) => {
        // Check if content starts with PICK_ (case insensitive)
        const isPickReplacement = content.toUpperCase().startsWith('PICK_');
        const backgroundColor = isPickReplacement ? '#628a33' : '#8bc34a8a';
        
        // Escape the < and > characters for HTML display
        const escapedMatch = match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });
    
    // Highlight NSFW tags in remaining text (outside of emphasis blocks)
    // Only process text that's not already inside emphasis-highlight spans
    highlightedText = highlightedText.replace(/([^<]*?)(?=<span class="emphasis-highlight"|$)/g, (match, text) => {
        if (!window.u1 || !text.trim()) return match;
        
        // Create a regex pattern from all u1 tags, sorted by length (longest first)
        const sortedTags = [...window.u1].sort((a, b) => b.length - a.length);
        const tagPattern = new RegExp(`\\b(${sortedTags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
        
        return text.replace(tagPattern, (tagMatch, tag) => {
            return `<span class="emphasis-highlight" style="background: #ff49dd85; border-color: #ff49ddc9;">${tag}</span>`;
        });
    });
    
    return highlightedText;
}

// Helper function to clean up emphasis groups and brace blocks, and copy values
function cleanupEmphasisGroupsAndCopyValue(target, selection, currentValue) {
    const value = target.value;
    let cleanedValue = value;
    let newSelection = { ...selection };
    let copiedValue = currentValue;
    
    // First, clean up emphasis groups
    const emphasisPattern = /(\d+\.\d+)::([^:]+)::/g;
    let emphasisMatch;
    
    while ((emphasisMatch = emphasisPattern.exec(cleanedValue)) !== null) {
        const emphasisStart = emphasisMatch.index;
        const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
        
        // If the current selection overlaps with an emphasis group, clean it up
        if (selection.start <= emphasisEnd && selection.end >= emphasisStart) {
            const beforeEmphasis = cleanedValue.substring(0, emphasisStart);
            const afterEmphasis = cleanedValue.substring(emphasisEnd);
            const emphasisContent = emphasisMatch[2]; // The text inside the emphasis
            const emphasisWeight = parseFloat(emphasisMatch[1]);
            
            // Copy the emphasis value
            copiedValue = emphasisWeight;
            
            // Replace the emphasis group with just the content
            cleanedValue = beforeEmphasis + emphasisContent + afterEmphasis;
            
            // Update the selection to point to the cleaned content
            newSelection = {
                start: emphasisStart,
                end: emphasisStart + emphasisContent.length
            };
            break;
        }
    }
    
    // Then, clean up brace blocks ({} and [])
    const bracePattern = /\{+([^{}]*)\}+|\[+([^\[\]]*)\]+/g;
    let braceMatch;
    
    while ((braceMatch = bracePattern.exec(cleanedValue)) !== null) {
        const braceStart = braceMatch.index;
        const braceEnd = braceMatch.index + braceMatch[0].length;
        
        // If the current selection overlaps with a brace block, clean it up
        if (selection.start <= braceEnd && selection.end >= braceStart) {
            const beforeBrace = cleanedValue.substring(0, braceStart);
            const afterBrace = cleanedValue.substring(braceEnd);
            const braceContent = braceMatch[1] || braceMatch[2]; // The text inside the braces
            const isBracket = braceMatch[0].startsWith('[');
            
            // Calculate brace value
            if (isBracket) {
                const bracketLevel = (braceMatch[0].match(/\[/g) || []).length;
                copiedValue = 1.0 - (bracketLevel * 0.1);
            } else {
                const braceLevel = (braceMatch[0].match(/\{/g) || []).length;
                copiedValue = 1.0 + (braceLevel * 0.1);
            }
            
            // Replace the brace block with just the content
            cleanedValue = beforeBrace + braceContent + afterBrace;
            
            // Update the selection to point to the cleaned content
            newSelection = {
                start: braceStart,
                end: braceStart + braceContent.length
            };
            break;
        }
    }
    
    // Update the target value
    target.value = cleanedValue;
    
    return {
        newSelection,
        copiedValue,
        cleanedValue
    };
}

function switchEmphasisMode(direction) {
    if (!emphasisEditingTarget || !emphasisEditingSelection) return;
    
    const value = emphasisEditingTarget.value;
    const cursorPosition = emphasisEditingTarget.selectionStart;
    
    if (direction === 'toggle') {
        // Toggle between group and brace modes
        if (emphasisEditingMode === 'group') {
            // Switch from group to brace mode
            const emphasisText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
            const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
            let braceMatch;
            let foundBrace = false;
            
            while ((braceMatch = bracePattern.exec(emphasisText)) !== null) {
                const braceStartInEmphasis = emphasisEditingSelection.start + emphasisText.indexOf(braceMatch[0]);
                const braceEndInEmphasis = braceStartInEmphasis + braceMatch[0].length;
                
                if (cursorPosition >= braceStartInEmphasis && cursorPosition <= braceEndInEmphasis) {
                    emphasisEditingMode = 'brace';
                    emphasisEditingSelection = {
                        start: braceStartInEmphasis,
                        end: braceEndInEmphasis
                    };
                    // Calculate brace level from the text
                    const braceText = braceMatch[0];
                    const isBracket = braceText.startsWith('[');
                    
                    if (isBracket) {
                        const openBrackets = (braceText.match(/\[/g) || []).length;
                        const closeBrackets = (braceText.match(/\]/g) || []).length;
                        const bracketLevel = openBrackets - closeBrackets;
                        emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                    } else {
                        const openBraces = (braceText.match(/\{/g) || []).length;
                        const closeBraces = (braceText.match(/\}/g) || []).length;
                        const braceLevel = openBraces - closeBraces;
                        emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                    }
                    foundBrace = true;
                    break;
                }
            }
            
            if (!foundBrace) {
                // Find the current word/tag within the group
                const groupText = emphasisText;
                const tagPattern = /([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)/g;
                let tagMatch;
                let foundTag = false;
                
                while ((tagMatch = tagPattern.exec(groupText)) !== null) {
                    const tagStartInGroup = emphasisEditingSelection.start + tagMatch.index;
                    const tagEndInGroup = tagStartInGroup + tagMatch[0].length;
                    
                    if (cursorPosition >= tagStartInGroup && cursorPosition <= tagEndInGroup) {
                        emphasisEditingMode = 'brace';
                        emphasisEditingSelection = {
                            start: tagStartInGroup,
                            end: tagEndInGroup
                        };
                        emphasisEditingValue = 1.0;
                        foundTag = true;
                        break;
                    }
                }
                
                if (!foundTag) {
                    // Use cursor position to find the word
                    const textBeforeCursor = value.substring(0, cursorPosition);
                    const textAfterCursor = value.substring(cursorPosition);
                    
                    const wordBefore = textBeforeCursor.match(/\b[a-zA-Z0-9_]+$/);
                    const wordAfter = textAfterCursor.match(/^[a-zA-Z0-9_]+/);
                    
                    if (wordBefore || wordAfter) {
                        const start = wordBefore ? cursorPosition - wordBefore[0].length : cursorPosition;
                        const end = wordAfter ? cursorPosition + wordAfter[0].length : cursorPosition;
                        
                        emphasisEditingMode = 'brace';
                        emphasisEditingSelection = {
                            start: start,
                            end: end
                        };
                        emphasisEditingValue = 1.0;
                    }
                }
            }
        } else if (emphasisEditingMode === 'brace') {
            // Switch from brace to group mode
            const emphasisPattern = /(\d+\.\d+)::([^:]+)::/g;
            let emphasisMatch;
            let foundGroup = false;
            
            // Store the current brace value before switching
            const currentBraceValue = emphasisEditingValue;
            
            while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
                const emphasisStart = emphasisMatch.index;
                const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
                
                // Check if we're inside this emphasis group (but not switching between outer/inner)
                if (emphasisEditingSelection.start >= emphasisStart && emphasisEditingSelection.end <= emphasisEnd) {
                    // Don't allow switching to a group that contains the current selection
                    // This prevents switching between outer and inner groups
                    continue;
                }
                
                // Check if this emphasis group is inside our current selection
                if (emphasisStart >= emphasisEditingSelection.start && emphasisEnd <= emphasisEditingSelection.end) {
                    emphasisEditingMode = 'group';
                    emphasisEditingSelection = {
                        start: emphasisStart,
                        end: emphasisEnd
                    };
                    // Copy the brace value to the group value
                    emphasisEditingValue = currentBraceValue;
                    foundGroup = true;
                    break;
                }
            }
            
            if (!foundGroup) {
                // If no group found, create a new emphasis block from the brace
                const braceText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
                const innerText = braceText.replace(/^\{+|\[+/, '').replace(/\}+|\]+$/, '');
                
                // Calculate weight from brace level
                const braceLevel = (braceText.match(/\{/g) || []).length - (braceText.match(/\}/g) || []).length;
                const bracketLevel = (braceText.match(/\[/g) || []).length - (braceText.match(/\]/g) || []).length;
                
                if (braceLevel > 0) {
                    emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                } else if (bracketLevel > 0) {
                    emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                } else {
                    emphasisEditingValue = 1.0;
                }
                
                // Create new emphasis block and clean up existing groups
                const result = cleanupEmphasisGroupsAndCopyValue(emphasisEditingTarget, emphasisEditingSelection, emphasisEditingValue);
                emphasisEditingMode = 'normal';
                emphasisEditingSelection = result.newSelection;
                emphasisEditingValue = result.copiedValue;
            }
        }
    } else if (direction === 'right') {
        // Right arrow: switch to more specific mode
        switch (emphasisEditingMode) {
            case 'normal':
                // Switch to brace mode - add {} around current selection
                emphasisEditingMode = 'brace';
                emphasisEditingValue = 1.0;
                break;
            case 'group':
                // Switch to brace mode - focus on {} or [] block inside the group
                const emphasisText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
                const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
                let braceMatch;
                let foundBrace = false;
                while ((braceMatch = bracePattern.exec(emphasisText)) !== null) {
                    const braceStartInEmphasis = emphasisEditingSelection.start + emphasisText.indexOf(braceMatch[0]);
                    const braceEndInEmphasis = braceStartInEmphasis + braceMatch[0].length;
                    
                    if (cursorPosition >= braceStartInEmphasis && cursorPosition <= braceEndInEmphasis) {
                        emphasisEditingMode = 'brace';
                        emphasisEditingSelection = {
                            start: braceStartInEmphasis,
                            end: braceEndInEmphasis
                        };
                        // Calculate brace level from the text
                        const braceText = braceMatch[0];
                        const isBracket = braceText.startsWith('[');
                        
                        if (isBracket) {
                            const openBrackets = (braceText.match(/\[/g) || []).length;
                            const closeBrackets = (braceText.match(/\]/g) || []).length;
                            const bracketLevel = openBrackets - closeBrackets;
                            emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                        } else {
                            const openBraces = (braceText.match(/\{/g) || []).length;
                            const closeBraces = (braceText.match(/\}/g) || []).length;
                            const braceLevel = openBraces - closeBraces;
                            emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                        }
                        foundBrace = true;
                        break;
                    }
                }
                
                // If no specific brace found, find the current tag/item within the group
                if (!foundBrace) {
                    // Find the current tag/item within the group
                    const groupText = emphasisText;
                    const tagPattern = /([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)/g;
                    let tagMatch;
                    let foundTag = false;
                    
                    while ((tagMatch = tagPattern.exec(groupText)) !== null) {
                        const tagStartInGroup = emphasisEditingSelection.start + tagMatch.index;
                        const tagEndInGroup = tagStartInGroup + tagMatch[0].length;
                        
                        if (cursorPosition >= tagStartInGroup && cursorPosition <= tagEndInGroup) {
                            emphasisEditingMode = 'brace';
                            emphasisEditingSelection = {
                                start: tagStartInGroup,
                                end: tagEndInGroup
                            };
                            emphasisEditingValue = 1.0;
                            foundTag = true;
                            break;
                        }
                    }
                    
                    // If still no tag found, use the cursor position to find the word
                    if (!foundTag) {
                        const textBeforeCursor = value.substring(0, cursorPosition);
                        const textAfterCursor = value.substring(cursorPosition);
                        
                        // Find the word boundaries
                        const wordBefore = textBeforeCursor.match(/\b[a-zA-Z0-9_]+$/);
                        const wordAfter = textAfterCursor.match(/^[a-zA-Z0-9_]+/);
                        
                        if (wordBefore || wordAfter) {
                            const start = wordBefore ? cursorPosition - wordBefore[0].length : cursorPosition;
                            const end = wordAfter ? cursorPosition + wordAfter[0].length : cursorPosition;
                            
                            emphasisEditingMode = 'brace';
                            emphasisEditingSelection = {
                                start: start,
                                end: end
                            };
                            emphasisEditingValue = 1.0;
                        }
                    }
                }
                break;
        }
    } else if (direction === 'left') {
                        // Left arrow: switch to less specific mode
        switch (emphasisEditingMode) {
            case 'brace':
                // Try to switch back to group mode first
                const emphasisPattern = /(\d+\.\d+)::([^:]+)::/g;
                let emphasisMatch;
                let foundGroup = false;
                
                // Store the current brace value before switching
                const currentBraceValue = emphasisEditingValue;
                
                while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
                    const emphasisStart = emphasisMatch.index;
                    const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
                    
                    // Check if we're inside this emphasis group (but not switching between outer/inner)
                    if (emphasisEditingSelection.start >= emphasisStart && emphasisEditingSelection.end <= emphasisEnd) {
                        // Don't allow switching to a group that contains the current selection
                        // This prevents switching between outer and inner groups
                        continue;
                    }
                    
                    // Check if this emphasis group is inside our current selection
                    if (emphasisStart >= emphasisEditingSelection.start && emphasisEnd <= emphasisEditingSelection.end) {
                        emphasisEditingMode = 'group';
                        emphasisEditingSelection = {
                            start: emphasisStart,
                            end: emphasisEnd
                        };
                        // Copy the brace value to the group value
                        emphasisEditingValue = currentBraceValue;
                        foundGroup = true;
                        break;
                    }
                }
                
                // If no group found, switch back to normal mode
                if (!foundGroup) {
                    emphasisEditingMode = 'normal';
                    // Copy the brace value to normal mode and clean up existing groups
                    const result = cleanupEmphasisGroupsAndCopyValue(emphasisEditingTarget, emphasisEditingSelection, currentBraceValue);
                    emphasisEditingSelection = result.newSelection;
                    emphasisEditingValue = result.copiedValue;
                }
                break;
        }
    }
    
    updateEmphasisEditingPopup();
}

function cancelEmphasisEditing() {
    // Hide popup
    const popup = document.getElementById('emphasisEditingPopup');
    if (popup) {
        popup.style.display = 'none';
    }
    
    // Reset state
    emphasisEditingActive = false;
    emphasisEditingTarget = null;
    emphasisEditingSelection = null;
    emphasisEditingMode = 'normal';
}

function updateCharacterAutocompleteSelection() {
    if (!characterAutocompleteList) return;
    
    const items = characterAutocompleteList.querySelectorAll('.character-autocomplete-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedCharacterAutocompleteIndex);
    });
    
    // Scroll the selected item into view
    if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
        const selectedItem = items[selectedCharacterAutocompleteIndex];
        selectedItem.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    }
}

function selectCharacterItem(character) {
    try {
        showCharacterDetail(character);
    } catch (error) {
        console.error('Error displaying character data:', error);
        showError('Failed to display character data');
    }
}

function selectTextReplacement(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;
    
    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    
    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);
    
    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;
    
    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    
    // Build the new prompt
    let newPrompt = '';
    
    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;
    
    // Add the placeholder wrapped in angle brackets
    const wrappedPlaceholder = `<${placeholder}>`;
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += wrappedPlaceholder;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + wrappedPlaceholder;
        } else {
            newPrompt += ', ' + wrappedPlaceholder;
        }
    } else {
        newPrompt = wrappedPlaceholder;
    }
    
    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }
    
    // Update the target field
    target.value = newPrompt;
    
    // Set cursor position after the inserted placeholder
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Hide character autocomplete
    hideCharacterAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function insertTextReplacement(actualText) {
    if (!currentCharacterAutocompleteTarget) return;
    
    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    
    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);
    
    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;
    
    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    
    // Build the new prompt
    let newPrompt = '';
    
    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;
    
    // Add the actual text (not wrapped in angle brackets)
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += actualText;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + actualText;
        } else {
            newPrompt += ', ' + actualText;
        }
    } else {
        newPrompt = actualText;
    }
    
    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }
    
    // Update the target field
    target.value = newPrompt;
    
    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Hide character autocomplete
    hideCharacterAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTag(tagName) {
    if (!currentCharacterAutocompleteTarget) return;
    
    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    
    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);
    
    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;
    
    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    
    // Build the new prompt
    let newPrompt = '';
    
    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;
    
    // Add the tag name
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += tagName;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + tagName;
        } else {
            newPrompt += ', ' + tagName;
        }
    } else {
        newPrompt = tagName;
    }
    
    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }
    
    // Update the target field
    target.value = newPrompt;
    
    // Set cursor position after the inserted tag
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Hide character autocomplete
    hideCharacterAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTextReplacementFullText(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;
    
    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    
    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);
    
    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;
    
    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    
    // Build the new prompt
    let newPrompt = '';
    
    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;
    
    // Add the full text replacement description
    const fullText = textReplacements[placeholder];
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += fullText;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + fullText;
        } else {
            newPrompt += ', ' + fullText;
        }
    } else {
        newPrompt = fullText;
    }
    
    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }
    
    // Update the target field
    target.value = newPrompt;
    
    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Hide character autocomplete
    hideCharacterAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectCharacterWithoutEnhancers(character) {
    try {
        if (!currentCharacterAutocompleteTarget) return;
        
        const target = currentCharacterAutocompleteTarget;
        const currentValue = target.value;
        const cursorPosition = target.selectionStart;
        
        // Get the text before the cursor
        const textBeforeCursor = currentValue.substring(0, cursorPosition);
        
        // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
        const lastDelimiterIndex = Math.max(
            textBeforeCursor.lastIndexOf('{'),
            textBeforeCursor.lastIndexOf('}'),
            textBeforeCursor.lastIndexOf('['),
            textBeforeCursor.lastIndexOf(']'),
            textBeforeCursor.lastIndexOf(':'),
            textBeforeCursor.lastIndexOf('|'),
            textBeforeCursor.lastIndexOf(',')
        );
        const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;
        
        // Get the text after the cursor
        const textAfterCursor = currentValue.substring(cursorPosition);
        
        // Build the new prompt
        let newPrompt = '';
        
        // Keep the text before the current term (trim any trailing delimiters and spaces)
        const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
        newPrompt = textBefore;
        
        // Add just the character prompt without any enhancers
        if (character.prompt) {
            if (newPrompt) {
                // Check if the text before ends with : or | - don't add comma in those cases
                if (textBefore.endsWith(':')) {
                    newPrompt += character.prompt;
                } else if (textBefore.endsWith('|')) {
                    newPrompt += ' ' + character.prompt;
                } else {
                    newPrompt += ', ' + character.prompt;
                }
            } else {
                newPrompt = character.prompt;
            }
        }
        
        // Add the text after the cursor (trim any leading delimiters and spaces)
        const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
        if (textAfter) {
            if (newPrompt) {
                newPrompt += ', ' + textAfter;
            } else {
                newPrompt = textAfter;
            }
        }
        
        // Update the target field
        target.value = newPrompt;
        
        // Set cursor position after the inserted text
        const newCursorPosition = newPrompt.length - textAfter.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        
        // Hide character autocomplete
        hideCharacterAutocomplete();
        
        // Focus back on the target field
        if (target) {
            target.focus();
            autoResizeTextarea(target);
            updateEmphasisHighlighting(target);
        }
    } catch (error) {
        console.error('Error loading character data:', error);
        showError('Failed to load character data');
    }
}

function showCharacterDetail(character) {
    try {
        
        // Reset selected enhancer group index
        selectedEnhancerGroupIndex = -1;
        
        // Instead of using a separate overlay, replace the content inside the existing autocomplete overlay
        const autocompleteList = document.querySelector('.character-autocomplete-list');
        
        if (!autocompleteList) {
            console.error('Character autocomplete list not found');
            return;
        }
        
        // Create enhancers HTML
        let enhancersHTML = '';
        
        // Add "None" option first
        enhancersHTML += `
            <div class="enhancer-group" 
                 data-enhancer-group="null" 
                 data-character='${JSON.stringify(character)}'
                 onclick="selectEnhancerGroupFromDetail(null, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                <div class="enhancer-group-header">
                    <span class="enhancer-group-name">None</span>
                    <span class="enhancer-group-count">0</span>
                </div>
            </div>
        `;
        
        // Ensure character.enhancers exists and is an array
        if (character.enhancers && Array.isArray(character.enhancers)) {
            // Add enhancer groups
            character.enhancers.forEach((enhancerGroup, groupIndex) => {
                // Handle mixed structure: convert strings to single-item arrays
                let processedGroup;
                if (typeof enhancerGroup === 'string') {
                    // Convert string to single-item array
                    processedGroup = [enhancerGroup];
                } else if (Array.isArray(enhancerGroup)) {
                    // Already an array, use as-is
                    processedGroup = enhancerGroup;
                } else {
                    console.warn(`Enhancer group ${groupIndex} is neither string nor array:`, enhancerGroup);
                    return; // Skip this group
                }
                
                enhancersHTML += `
                    <div class="enhancer-group" 
                         data-enhancer-group='${JSON.stringify(processedGroup)}'
                         data-character='${JSON.stringify(character)}'
                         onclick="selectEnhancerGroupFromDetail(${JSON.stringify(processedGroup).replace(/"/g, '&quot;')}, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                        <div class="enhancer-group-header">
                            <span class="enhancer-group-name">Group ${groupIndex + 1}</span>
                            <span class="enhancer-group-count">${processedGroup.length}</span>
                        </div>
                        <div class="enhancer-items">
                            ${processedGroup.map(item => {
                                // Ensure item is a string
                                if (typeof item !== 'string') {
                                    console.warn(`Enhancer item is not a string:`, item);
                                    return '';
                                }
                                const isNegative = item.startsWith('--');
                                const displayItem = isNegative ? item.substring(2) : item;
                                return `<span class="enhancer-item ${isNegative ? 'negative' : ''}">${displayItem}</span>`;
                            }).join('')}
                        </div>
                    </div>
                `;
            });
        } else {
            enhancersHTML += '<div class="no-enhancers">No enhancers available</div>';
        }
        
        // Replace the autocomplete content with character detail
        autocompleteList.innerHTML = `
            <div class="character-detail-content">
                <div class="character-detail-header">
                    <div class="character-name-copyright">
                        <span class="character-name">${character.name || 'Unknown Character'}</span>
                        <span class="character-copyright">${character.copyright || ''}</span>
                    </div>
                    <button class="close-character-detail" onclick="hideCharacterDetail()">&times;</button>
                </div>
                <div class="character-detail-body">
                    <div class="character-prompt">
                        <strong>Prompt:</strong> <span>${character.prompt || 'No prompt available'}</span>
                    </div>
                    <div class="character-enhancers">
                        <strong>Enhancers:</strong>
                        <div class="enhancers-list">
                            ${enhancersHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Ensure the autocomplete overlay maintains its width
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.style.width = characterAutocompleteOverlay.style.width || '400px';
        }
        
        // The autocomplete overlay is already visible, so no need to show/hide anything
    } catch (error) {
        console.error('Error showing character detail:', error);
        console.error('Character that caused error:', character);
        showError('Failed to display character details');
    }
}

function selectEnhancerGroup(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;
    
    const target = currentCharacterAutocompleteTarget;
    
    // Update the target field with character prompt
    if (character.prompt) {
        target.value = character.prompt;
    }
    
    // Add enhancer items to the prompt if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const currentPrompt = target.value;
        const enhancerText = enhancerGroup.join(', ');
        target.value = currentPrompt + ', ' + enhancerText;
    }
    
    // Hide character detail overlay and autocomplete
    hideCharacterDetail();
    hideCharacterAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
        updateEmphasisHighlighting(target);
    }
}

function selectEnhancerGroupFromDetail(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;
    
    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    
    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);
    
    // Find the last comma before the cursor, or start from the beginning
    const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
    const startOfCurrentTerm = lastCommaIndex >= 0 ? lastCommaIndex + 1 : 0;
    
    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    
    // Build the new prompt
    let newPrompt = '';
    
    // Keep the text before the current term (trim any trailing commas and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;
    
    // Add character prompt if this is the first item or we're at the beginning
    if (character.prompt) {
        if (startOfCurrentTerm === 0) {
            // This is the first item, use the character prompt
            newPrompt = character.prompt;
        } else {
            // Add character prompt after existing text
            if (newPrompt) {
                newPrompt += ', ' + character.prompt;
            } else {
                newPrompt = character.prompt;
            }
        }
    }
    
    // Add enhancer items if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const enhancerText = enhancerGroup.join(', ');
        if (newPrompt) {
            newPrompt += ', ' + enhancerText;
        } else {
            newPrompt = enhancerText;
        }
    }
    
    // Add the text after the cursor (trim any leading commas and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        if (newPrompt) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt = textAfter;
        }
    }
    
    // Update the target field
    target.value = newPrompt;
    
    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Hide character autocomplete (which now contains the detail view)
    hideCharacterAutocomplete();an
    
    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function applyFormattedText(textarea, lostFocus) {
    // Store cursor position if textarea is in focus
    const cursorPosition = !lostFocus ? textarea.selectionStart : -1;
    
    let text = textarea.value;
    
    // Process text based on focus state
    if (lostFocus) {
        // When losing focus, clean up the text
        text = text
            .split('\n').map(item => item.trim()).join(' ')
            .split(',').map(item => item.trim()).join(', ')
            .split('|').map(item => item.trim()).filter(Boolean).join(' | ');
        
        // Remove leading | or , and trim start
        text = text.replace(/^(\||,)+\s*/, '');
    } else {
        // When focused, just clean up basic formatting
        text = text
            .split('\n').map(item => item.trim()).join(' ')
            .split(',').map(item => item.trim()).join(', ')
            .split('|').map(item => item.trim()).join(' | ');
    }

    // Fix curly brace groups: ensure each group has equal number of { and }
    // Only process if there is a "}," to terminate it
    if (text.includes('},')) {
        text = text.replace(/(\{+)([^{}]*)(\}*)/g, (match, openBraces, content, closeBraces, offset, str) => {
            const after = str.slice(offset + match.length, offset + match.length + 1);
            if (closeBraces.length > 0 && after === ',') {
                const openCount = openBraces.length;
                return openBraces + content + '}'.repeat(openCount);
            }
            return match;
        });
    }

    // Fix square bracket groups: ensure each group has equal number of [ and ]
    // Only process if there is "]," to terminate it
    if (text.includes('],')) {
        text = text.replace(/(\[+)([^\[\]]*)(\]*)/g, (match, openBrackets, content, closeBrackets, offset, str) => {
            const after = str.slice(offset + match.length, offset + match.length + 1);
            if (closeBrackets.length > 0 && after === ',') {
                const openCount = openBrackets.length;
                return openBrackets + content + ']'.repeat(openCount);
            }
            return match;
        });
    }

    // If not focused, remove empty tags (consecutive commas with only spaces between)
    if (lostFocus) {
        // Remove any sequence of commas (with any amount of spaces between) that does not have text between them
        // e.g. ",   ,", ", ,", ",,"
        text = text.replace(/(?:^|,)\s*(?=,|$)/g, ''); // Remove empty segments
        // Remove any leading or trailing commas left after cleanup
        text = text.replace(/^,|,$/g, '');
        // Remove extra spaces after cleanup
        text = text.replace(/,\s+/g, ', ');
        text = text.replace(/\s+,/g, ',');
    }

    textarea.value = text;
    
    // Restore cursor position if textarea was in focus
    if (!lostFocus && cursorPosition >= 0) {
        // Ensure cursor position doesn't exceed the new text length
        const newPosition = Math.min(cursorPosition, text.length);
        textarea.setSelectionRange(newPosition, newPosition);
        textarea.focus();
    }
}
// Global variable to track selected enhancer group index
let selectedEnhancerGroupIndex = -1;

function handleCharacterDetailArrowKeys(key) {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (enhancerGroups.length === 0) return;
    
    // Remove previous selection
    enhancerGroups.forEach(group => group.classList.remove('selected'));
    
    if (key === 'ArrowUp') {
        selectedEnhancerGroupIndex = selectedEnhancerGroupIndex <= 0 ? enhancerGroups.length - 1 : selectedEnhancerGroupIndex - 1;
    } else if (key === 'ArrowDown') {
        selectedEnhancerGroupIndex = selectedEnhancerGroupIndex >= enhancerGroups.length - 1 ? 0 : selectedEnhancerGroupIndex + 1;
    }
    
    // Add selection to current item
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        enhancerGroups[selectedEnhancerGroupIndex].classList.add('selected');
        
        // Scroll the selected item into view
        enhancerGroups[selectedEnhancerGroupIndex].scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }
}

function handleCharacterDetailEnter() {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        const selectedGroup = enhancerGroups[selectedEnhancerGroupIndex];
        
        // Get the data from data attributes (much more reliable than parsing onclick)
        const enhancerGroupData = selectedGroup.getAttribute('data-enhancer-group');
        const characterData = selectedGroup.getAttribute('data-character');
        
        if (enhancerGroupData && characterData) {
            try {
                // Parse the data attributes
                const enhancerGroup = enhancerGroupData === 'null' ? null : JSON.parse(enhancerGroupData);
                const character = JSON.parse(characterData);
                
                selectEnhancerGroupFromDetail(enhancerGroup, character);
            } catch (error) {
                console.error('Error parsing data attributes:', error);
                console.error('enhancerGroupData:', enhancerGroupData);
                console.error('characterData:', characterData);
                
                // Fallback: try to trigger the click event instead
                selectedGroup.click();
            }
        } else {
            // Fallback: try to trigger the click event instead
            selectedGroup.click();
        }
    }
}

function hideCharacterAutocomplete() {
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('hidden');
    }
    currentCharacterAutocompleteTarget = null;
    selectedCharacterAutocompleteIndex = -1;
    characterSearchResults = [];
    autocompleteNavigationMode = false;
    autocompleteExpanded = false;
    updateEmphasisTooltipVisibility();
}

function updateEmphasisTooltipVisibility() {
    const tooltip = document.getElementById('emphasisTooltip');
    if (tooltip) {
        tooltip.style.display = autocompleteNavigationMode ? 'block' : 'none';
    }
}

function hideCharacterDetail() {
    // Since we're now replacing the content inside the autocomplete overlay,
    // we need to restore the original autocomplete list content
    const autocompleteList = document.querySelector('.character-autocomplete-list');
    
    if (autocompleteList && characterSearchResults.length > 0) {
        // Restore the original autocomplete suggestions
        showCharacterAutocompleteSuggestions(characterSearchResults, currentCharacterAutocompleteTarget);
    } else {
        // If no search results, just hide the overlay
        hideCharacterAutocomplete();
    }
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
            <span class="preset-details">${modelsShort[result.model.toUpperCase()] || result.model || 'Default'}</span>
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

// Update autocomplete positions when page scrolls
function updateAutocompletePositions() {
    // Update character autocomplete position
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden') && currentCharacterAutocompleteTarget) {
        const rect = currentCharacterAutocompleteTarget.getBoundingClientRect();
        characterAutocompleteOverlay.style.left = rect.left + 'px';
        characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
        characterAutocompleteOverlay.style.width = rect.width + 'px';
    }
    
    // Update preset autocomplete position
    if (presetAutocompleteOverlay && !presetAutocompleteOverlay.classList.contains('hidden') && currentPresetAutocompleteTarget) {
        const rect = currentPresetAutocompleteTarget.getBoundingClientRect();
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
    }
}

function selectPresetItem(presetName) {
    if (!currentPresetAutocompleteTarget) return;
    
    const target = currentPresetAutocompleteTarget;
    target.value = presetName;
    
    // Hide preset autocomplete
    hidePresetAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
    }
}

function hidePresetAutocomplete() {
    if (presetAutocompleteOverlay) {
        presetAutocompleteOverlay.classList.add('hidden');
    }
    currentPresetAutocompleteTarget = null;
    selectedPresetAutocompleteIndex = -1;
    presetSearchResults = [];
}

// Update generate button state
function updateGenerateButton() {
    const selectedValue = presetSelect.value;
    
    if (!selectedValue) {
        generateBtn.disabled = true;
        return;
    }
    
    // Parse the selected value to determine if it's a preset or pipeline
    const [type, name] = selectedValue.split(':');
    
    if (!type || !name) {
        generateBtn.disabled = true;
        return;
    }
    
    if (type === 'preset') {
        // For presets, resolution is required and no mask preview
        generateBtn.disabled = false;
    } else if (type === 'pipeline') {
        // For pipelines, resolution is optional and show mask preview
        generateBtn.disabled = false;
    } else {
        generateBtn.disabled = true;
    }
}

// Generate image
async function generateImage() {
    const selectedValue = presetSelect.value;
    if (!selectedValue) {
        showError('Please select a preset or pipeline');
        return;
    }

    // Parse the selected value to determine if it's a preset or pipeline
    const [type, name] = selectedValue.split(':');
    
    if (!type || !name) {
        showError('Invalid selection');
        return;
    }

    showManualLoading(true, 'Generating image...');

    try {
        let url;
        if (type === 'preset') {
            // For presets, resolution is optional
            const params = new URLSearchParams({ forceGenerate: 'true' });
            if (activeWorkspace) params.append('workspace', activeWorkspace);
            
            url = `/preset/${name}?${params.toString()}`;
        } else if (type === 'pipeline') {
            // For pipelines, resolution is optional (uses pipeline's resolution if not specified)
            const params = new URLSearchParams({
                forceGenerate: 'true'
            });
            if (activeWorkspace) params.append('workspace', activeWorkspace);
            url = `/pipeline/${name}?${params.toString()}`;
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
            }
        } catch (error) {
            console.warn('Failed to fetch metadata for generated image:', error);
        }
        // Wait for the image to load, then refresh gallery and open the correct image
        const img = new Image();
        img.onload = async function() {
            createConfetti();
            
            await loadGallery();
            
            // Refresh balance after successful generation
            await loadBalance();
            
            // Find the image in the gallery by filename
            const found = allImages.find(img => img.original === generatedFilename || img.upscaled === generatedFilename || img.pipeline === generatedFilename || img.pipeline_upscaled === generatedFilename);
            if (found) {
                // Construct proper image object with filename property
                const imageToShow = {
                    filename: generatedFilename,
                    base: found.base,
                    original: found.original,
                    upscaled: found.upscaled,
                    pipeline: found.pipeline,
                    pipeline_upscaled: found.pipeline_upscaled
                };
                showLightbox(imageToShow);
            } else {
                showError('Generated image not found in gallery.');
            }
        };
        img.src = imageUrl;

    } catch (error) {
        console.error('Generation error:', error);
        showError('Image generation failed. Please try again.');
    } finally {
        showManualLoading(false);
    }
}

// Show lightbox
async function showLightbox(image) {
    // Set current lightbox image for navigation
    currentLightboxImage = image;
    
    if (image.url) {
        lightboxImage.src = image.url;
    } else {
        lightboxImage.src = `/images/${image.filename}`;
    }
    
    lightboxModal.style.display = 'block';
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
    
    // Store current image for download
    lightboxImage.dataset.filename = image.filename;
    lightboxImage.dataset.url = image.url;
    lightboxImage.dataset.base = image.base;
    lightboxImage.dataset.upscaled = image.upscaled ? 'true' : '';

    // Reset metadata table first
    resetMetadataTable();

    // Load and display metadata
    const metadata = await loadAndDisplayMetadata(image.filename);
    
    // Store current image and metadata for dialog
    currentImage = { ...image, metadata };
    
    // Update lightbox controls with metadata
    updateLightboxControls({ ...image, metadata });
    
    // Initialize zoom and pan functionality
    initializeLightboxZoom();
}

// Helper: Format resolution name for display
function formatResolution(resolution) {
    if (!resolution) return '';
    
    // Handle custom resolution format: custom_1024x768
    if (resolution.startsWith('custom_')) {
        const dimensions = resolution.replace('custom_', '');
        const [width, height] = dimensions.split('x').map(Number);
        if (width && height) {
            return `Custom ${width}×${height}`;
        }
    }
    
    // Try to find the resolution in our global array first
    const res = RESOLUTIONS.find(r => r.value.toLowerCase() === resolution.toLowerCase());
    if (res) {
        return res.display;
    }
    
    // Fallback: Convert snake_case to Title Case
    return resolution
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Load and display metadata
async function loadAndDisplayMetadata(filename) {
    try {
        const response = await fetchWithAuth(`/images/${filename}`, {
            method: 'OPTIONS'
        });
        
        if (response.ok) {
            const metadata = await response.json();
            
            if (metadata && Object.keys(metadata).length > 0) {
                // Populate metadata table
                populateMetadataTable(metadata);
                
                // Set up expandable sections
                setupPromptPanel(metadata);
                
                return metadata;
            }
        }
        return null;
    } catch (error) {
        console.error('Error loading metadata:', error);
        return null;
    }
}

// Populate metadata table
function populateMetadataTable(metadata) {
    // Type and Name
    const typeElement = document.getElementById('metadataType');
    const nameElement = document.getElementById('metadataName');
    
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
    const modelElement = document.getElementById('metadataModel');
    if (modelElement) {
        modelElement.textContent = metadata.model_display_name || metadata.model || '-';
    }
    
    // Resolution
    const resolutionElement = document.getElementById('metadataResolution');
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
    const stepsElement = document.getElementById('metadataSteps');
    if (stepsElement) {
        const stepsText = metadata.steps || '-';
        if (metadata.skip_cfg_above_sigma !== null && metadata.skip_cfg_above_sigma !== undefined) {
            stepsElement.innerHTML = `${stepsText} <i class="fas fa-splotch variety-icon" title="Variety+ enabled"></i>`;
        } else {
            stepsElement.textContent = stepsText;
        }
    }
    
    // Seeds - Handle display logic
    const seed1Element = document.getElementById('metadataSeed1');
    const seed2Element = document.getElementById('metadataSeed2');
    
    if (seed1Element && seed2Element) {
        // Find the label elements more safely
        const seed1Cell = seed1Element.closest('.metadata-cell');
        const seed2Cell = seed2Element.closest('.metadata-cell');
        const seed1Label = seed1Cell ? seed1Cell.querySelector('.metadata-label') : null;
        const seed2Label = seed2Cell ? seed2Cell.querySelector('.metadata-label') : null;
        
        if (seed1Label && seed2Label) {
            // Check if this is a pipeline with both seeds
            const isPipeline = metadata.request_type === 'pipeline' || metadata.request_type === 'custom_pipeline';
            const hasLayer2Seed = metadata.layer2Seed !== undefined;
            
            if (isPipeline && hasLayer2Seed) {
                // Pipeline with both seeds - show both
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
    const guidanceElement = document.getElementById('metadataGuidance');
    if (guidanceElement) {
        guidanceElement.textContent = metadata.scale || '-';
    }
    
    // Rescale
    const rescaleElement = document.getElementById('metadataRescale');
    if (rescaleElement) {
        rescaleElement.textContent = metadata.cfg_rescale || '-';
    }
    
    // Sampler
    const samplerElement = document.getElementById('metadataSampler');
    if (samplerElement) {
        const samplerObj = getSamplerMeta(metadata.sampler);
        samplerElement.textContent = samplerObj ? samplerObj.display : (metadata.sampler || '-');
    }
    
    // Noise Schedule
    const noiseScheduleElement = document.getElementById('metadataNoiseSchedule');
    if (noiseScheduleElement) {
        const noiseObj = getNoiseMeta(metadata.noise_schedule);
        noiseScheduleElement.textContent = noiseObj ? noiseObj.display : (metadata.noise_schedule || '-');
    }
}

// Setup prompt panel
function setupPromptPanel(metadata) {
    const promptBtn = document.getElementById('promptBtn');
    const promptPanel = document.getElementById('promptPanel');
    const allPromptsContent = document.getElementById('allPromptsContent');

    // Clear previous content
    if (allPromptsContent) allPromptsContent.innerHTML = '';
    
    // Setup prompt button
    if (promptBtn && promptPanel) {
        promptBtn.style.display = 'inline-block';
        
        promptBtn.onclick = () => {
            // Check if panel is currently shown
            const isPanelShown = promptPanel.classList.contains('show');
            
            if (isPanelShown) {
                // Hide panel
                promptPanel.classList.remove('show');
                setTimeout(() => {
                    promptPanel.classList.add('hidden');
                }, 300);
                
                // Move close button back to original position
                if (lightboxCloseBtn) {
                    lightboxCloseBtn.classList.remove('prompt-panel-open');
                }
            } else {
                // Populate panel content
                if (allPromptsContent) {
                    allPromptsContent.innerHTML = '';
                    
                    // Add base prompt if exists
                    if (metadata.prompt) {
                        const basePromptItem = createCharacterPromptItem('Base Prompt', metadata.prompt, metadata.uc);
                        allPromptsContent.appendChild(basePromptItem);
                    }
                    
                    // Add character prompts if exist
                    if (metadata.characterPrompts && metadata.characterPrompts.length > 0) {
                        metadata.characterPrompts.forEach((charPrompt, index) => {
                            const charName = charPrompt.chara_name || `Character ${index + 1}`;
                            const charPromptItem = createCharacterPromptItem(charName, charPrompt.prompt || 'No prompt available', charPrompt.uc, charPrompt);
                            allPromptsContent.appendChild(charPromptItem);
                        });
                    }
                    
                    // Show message if no prompts at all
                    if (!metadata.prompt && (!metadata.characterPrompts || metadata.characterPrompts.length === 0)) {
                        const noPromptsMsg = document.createElement('div');
                        noPromptsMsg.className = 'character-prompt-item-panel';
                        noPromptsMsg.innerHTML = '<div class="character-prompt-text">No prompts available</div>';
                        allPromptsContent.appendChild(noPromptsMsg);
                    }
                }
                
                // Show panel
                promptPanel.classList.remove('hidden');
                setTimeout(() => {
                    promptPanel.classList.add('show');
                }, 10);
                
                // Move close button to accommodate panel
                if (lightboxCloseBtn) {
                    lightboxCloseBtn.classList.add('prompt-panel-open');
                }
            }
        };
    } else if (promptBtn) {
        promptBtn.style.display = 'none';
    }
}

// Helper function to create prompt items with copy functionality
function createPromptItem(title, content) {
    const promptItem = document.createElement('div');
    promptItem.className = 'character-prompt-item-panel';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'prompt-header';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'character-name';
    titleDiv.textContent = title;
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'prompt-copy-btn';
    copyBtn.innerHTML = '<i class="nai-clipboard"></i>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = () => copyToClipboard(content, title);
    
    headerDiv.appendChild(titleDiv);
    headerDiv.appendChild(copyBtn);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'character-prompt-text';
    contentDiv.textContent = content;
    
    promptItem.appendChild(headerDiv);
    promptItem.appendChild(contentDiv);
    
    return promptItem;
}

// Helper function to create character prompt items with UC
function createCharacterPromptItem(title, content, uc, charPrompt = null) {
    const promptItem = document.createElement('div');
    promptItem.className = 'character-prompt-item-panel';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'prompt-header';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'character-name';
    titleDiv.textContent = title;
    
    // Add badges for character prompts
    if (charPrompt) {
        const badgesDiv = document.createElement('div');
        badgesDiv.className = 'prompt-badges';
        
        // Add coordinate badge if coordinates exist
        if (charPrompt.center && charPrompt.center.x !== undefined && charPrompt.center.y !== undefined) {
            const coordBadge = document.createElement('span');
            coordBadge.className = 'prompt-badge coordinate-badge';
            coordBadge.textContent = getCellLabelFromCoords(charPrompt.center.x, charPrompt.center.y);
            badgesDiv.appendChild(coordBadge);
        }
        
        // Add disabled badge if character is disabled
        if (charPrompt.enabled === false) {
            const disabledBadge = document.createElement('span');
            disabledBadge.className = 'prompt-badge disabled-badge';
            disabledBadge.textContent = 'Not Included';
            badgesDiv.appendChild(disabledBadge);
        }
        
        titleDiv.appendChild(badgesDiv);
    }
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'prompt-copy-btn';
    copyBtn.innerHTML = '<i class="nai-clipboard"></i>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = () => copyToClipboard(content, title);
    
    headerDiv.appendChild(titleDiv);
    headerDiv.appendChild(copyBtn);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'character-prompt-text';
    contentDiv.textContent = content;
    
    promptItem.appendChild(headerDiv);
    promptItem.appendChild(contentDiv);
    
    // Add UC if it exists
    if (uc) {
        const divider = document.createElement('div');
        divider.className = 'prompt-divider';
        promptItem.appendChild(divider);
        
        const ucHeaderDiv = document.createElement('div');
        ucHeaderDiv.className = 'prompt-header';
        
        const ucTitleDiv = document.createElement('div');
        ucTitleDiv.className = 'character-name';
        ucTitleDiv.textContent = 'Undesired Content';
        
        const ucCopyBtn = document.createElement('button');
        ucCopyBtn.className = 'prompt-copy-btn';
        ucCopyBtn.innerHTML = '<i class="nai-clipboard"></i>';
        ucCopyBtn.title = 'Copy to clipboard';
        ucCopyBtn.onclick = () => copyToClipboard(uc, `${title} - Undesired Content`);
        
        ucHeaderDiv.appendChild(ucTitleDiv);
        ucHeaderDiv.appendChild(ucCopyBtn);
        
        const ucContentDiv = document.createElement('div');
        ucContentDiv.className = 'character-prompt-text';
        ucContentDiv.textContent = uc;
        
        promptItem.appendChild(ucHeaderDiv);
        promptItem.appendChild(ucContentDiv);
    }
    
    return promptItem;
}

// Function to copy text to clipboard and show toast
async function copyToClipboard(text, title) {
    try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            showGlassToast('success', 'Clipboard', `Copied ${title} to clipboard`);
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                showGlassToast('success', 'Clipboard', `Copied ${title} to clipboard`);
            } else {
                throw new Error('execCommand copy failed');
            }
        }
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showGlassToast('error', 'Clipboard', 'Failed to copy to clipboard');
    }
}


// Helper: Format request type for display
function formatRequestType(requestType) {
    const typeMappings = {
        'custom': 'Manual Generation',
        'preset': 'Image Preset',
        'pipeline': 'Image Pipeline',
        'custom_pipeline': 'Custom Pipeline'
    };
    
    return typeMappings[requestType] || requestType;
}

// Hide lightbox
function hideLightbox() {
    lightboxModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    
    // Clear any existing metadata
    const metadataTable = document.querySelector('.lightbox-metadata-section .metadata-table tbody');
    if (metadataTable) {
        metadataTable.innerHTML = '';
    }
    
    // Hide expanded sections
    const expandedSections = document.querySelectorAll('.metadata-expanded');
    expandedSections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Hide prompt panel
    const promptPanel = document.getElementById('promptPanel');
    if (promptPanel) {
        promptPanel.classList.remove('show');
        promptPanel.classList.add('hidden');
    }
    
    // Reset close button position
    if (lightboxCloseBtn) {
        lightboxCloseBtn.classList.remove('prompt-panel-open');
    }
    
    // Hide dialog if open
    hideMetadataDialog();
    
    // Reset zoom and pan
    resetLightboxZoom();
}

// Navigate between images in lightbox
function navigateLightbox(direction) {
    // Find current image index by matching the filename
    const currentImageIndex = allImages.findIndex(img => {
        const currentFilename = currentLightboxImage?.filename;
        return img.original === currentFilename || 
               img.pipeline === currentFilename ||
               img.pipeline_upscaled === currentFilename ||
               img.upscaled === currentFilename;
    });
    
    if (currentImageIndex === -1) return;
    
    // Calculate new index
    let newIndex = currentImageIndex + direction;
    
    // Handle wrapping
    if (newIndex < 0) {
        newIndex = allImages.length - 1;
    } else if (newIndex >= allImages.length) {
        newIndex = 0;
    }
    
    // Get the new image from allImages
    const newImageObj = allImages[newIndex];
    if (newImageObj) {
        // Construct the image object the same way as in createGalleryItem
        let filenameToShow = newImageObj.original;
        if (newImageObj.pipeline_upscaled) {
            filenameToShow = newImageObj.pipeline_upscaled;
        } else if (newImageObj.pipeline) {
            filenameToShow = newImageObj.pipeline;
        } else if (newImageObj.upscaled) {
            filenameToShow = newImageObj.upscaled;
        }
        
        const imageToShow = {
            filename: filenameToShow,
            base: newImageObj.base,
            upscaled: newImageObj.upscaled,
            pipeline: newImageObj.pipeline,
            pipeline_upscaled: newImageObj.pipeline_upscaled
        };
        
        showLightbox(imageToShow);
    }
}

// Lightbox zoom and pan functionality
let currentLightboxImage = null;
let lightboxZoom = 1;
let lightboxPanX = 0;
let lightboxPanY = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let lastTouchDistance = 0;

function initializeLightboxZoom() {
    const imageContainer = document.querySelector('.lightbox-image-container');
    const image = document.getElementById('lightboxImage');
    
    if (!imageContainer || !image) return;
    
    // Reset zoom and pan
    resetLightboxZoom();
    
    // Mouse wheel zoom
    imageContainer.addEventListener('wheel', handleWheelZoom, { passive: false });
    
    // Mouse drag pan
    imageContainer.addEventListener('mousedown', handleMouseDown);
    imageContainer.addEventListener('mousemove', handleMouseMove);
    imageContainer.addEventListener('mouseup', handleMouseUp);
    imageContainer.addEventListener('mouseleave', handleMouseUp);
    
    // Touch zoom and pan
    imageContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    imageContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    imageContainer.addEventListener('touchend', handleTouchEnd);
    
    // Double click to reset zoom
    imageContainer.addEventListener('dblclick', resetLightboxZoom);
}

function resetLightboxZoom() {
    lightboxZoom = 1;
    lightboxPanX = 0;
    lightboxPanY = 0;
    updateImageTransform();
    
    const imageContainer = document.querySelector('.lightbox-image-container');
    if (imageContainer) {
        imageContainer.classList.remove('zoomed');
    }
}

function updateImageTransform() {
    const image = document.getElementById('lightboxImage');
    if (image) {
        image.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxZoom})`;
    }
}

function handleWheelZoom(e) {
    e.preventDefault();
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(1, Math.min(5, lightboxZoom * delta));
    
    // If zooming out to original size, reset pan to center
    if (newZoom <= 1 && lightboxZoom > 1) {
        lightboxPanX = 0;
        lightboxPanY = 0;
    } else {
        // Zoom towards mouse position only when zooming in or when already zoomed
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const zoomChange = newZoom / lightboxZoom;
        lightboxPanX = mouseX - (mouseX - lightboxPanX) * zoomChange;
        lightboxPanY = mouseY - (mouseY - lightboxPanY) * zoomChange;
    }
    
    lightboxZoom = newZoom;
    updateImageTransform();
    
    const imageContainer = document.querySelector('.lightbox-image-container');
    if (imageContainer) {
        imageContainer.classList.toggle('zoomed', lightboxZoom > 1);
    }
}

function handleMouseDown(e) {
    if (lightboxZoom > 1) {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        e.preventDefault();
    }
}

function handleMouseMove(e) {
    if (isDragging && lightboxZoom > 1) {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        
        lightboxPanX += deltaX;
        lightboxPanY += deltaY;
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        
        updateImageTransform();
        e.preventDefault();
    }
}

function handleMouseUp() {
    isDragging = false;
}

function handleTouchStart(e) {
    if (e.touches.length === 1) {
        // Single touch - start pan
        isDragging = true;
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        // Two touches - start pinch zoom
        lastTouchDistance = getTouchDistance(e.touches);
    }
}

function handleTouchMove(e) {
    if (e.touches.length === 1 && isDragging && lightboxZoom > 1) {
        // Single touch pan
        const deltaX = e.touches[0].clientX - lastMouseX;
        const deltaY = e.touches[0].clientY - lastMouseY;
        
        lightboxPanX += deltaX;
        lightboxPanY += deltaY;
        
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
        
        updateImageTransform();
        e.preventDefault();
    } else if (e.touches.length === 2) {
        // Two touch pinch zoom
        const currentDistance = getTouchDistance(e.touches);
        const delta = currentDistance / lastTouchDistance;
        
        const newZoom = Math.max(1, Math.min(5, lightboxZoom * delta));
        
        // If zooming out to original size, reset pan to center
        if (newZoom <= 1 && lightboxZoom > 1) {
            lightboxPanX = 0;
            lightboxPanY = 0;
        } else {
            // Zoom towards center of touches only when zooming in or when already zoomed
            const rect = e.currentTarget.getBoundingClientRect();
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            
            const zoomChange = newZoom / lightboxZoom;
            lightboxPanX = centerX - (centerX - lightboxPanX) * zoomChange;
            lightboxPanY = centerY - (centerY - lightboxPanY) * zoomChange;
        }
        
        lightboxZoom = newZoom;
        lastTouchDistance = currentDistance;
        
        updateImageTransform();
        
        const imageContainer = document.querySelector('.lightbox-image-container');
        if (imageContainer) {
            imageContainer.classList.toggle('zoomed', lightboxZoom > 1);
        }
        
        e.preventDefault();
    }
}

function handleTouchEnd(e) {
    if (e.touches.length === 0) {
        isDragging = false;
        lastTouchDistance = 0;
    }
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
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
    } else if (image.pipeline_upscaled || image.pipeline || image.upscaled || image.original) {
        // For gallery images - prefer highest quality version
        if (image.pipeline_upscaled) {
            filename = image.pipeline_upscaled;
        } else if (image.pipeline) {
            filename = image.pipeline;
        } else if (image.upscaled) {
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
async function deleteImage(image) {
    // Show confirmation dialog
    const confirmed = confirm('Are you sure you want to delete this image? This will permanently delete both the original and upscaled versions.');
    
    if (!confirmed) {
        return;
    }
    
    try {
        // Determine which filename to use for deletion
        let filenameToDelete = null;
        
        // For pipeline images, prioritize pipeline_upscaled, then pipeline
        if (image.pipeline_upscaled) {
            filenameToDelete = image.pipeline_upscaled;
        } else if (image.pipeline) {
            filenameToDelete = image.pipeline;
        }
        // For regular images, prioritize original, then upscaled
        else if (image.original) {
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
            showGlassToast('success', 'Delete Image', 'Image deleted successfully!');
            
            // Close lightbox
            hideLightbox();
            
            // Refresh gallery to show updated list
            await loadGallery();
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
        
        // For pipeline images, prioritize pipeline_upscaled, then pipeline
        if (currentManualPreviewImage.pipeline_upscaled) {
            filenameToDelete = currentManualPreviewImage.pipeline_upscaled;
        } else if (currentManualPreviewImage.pipeline) {
            filenameToDelete = currentManualPreviewImage.pipeline;
        }
        // For regular images, prioritize original, then upscaled
        else if (currentManualPreviewImage.original) {
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
                img.upscaled === currentManualPreviewImage.upscaled ||
                img.pipeline === currentManualPreviewImage.pipeline ||
                img.pipeline_upscaled === currentManualPreviewImage.pipeline_upscaled
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
                
                showGlassToast('success', 'Delete Image', 'Image deleted!');
            } else {
                // No next image, reset the preview
                resetManualPreview();
                showGlassToast('error', 'Delete Image', 'Image deleted!');
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

// Show loading overlay
function showLoading(show, message = 'Generating Image...') {
    if (show) {
        loadingOverlay.classList.remove('hidden');
        // Update the loading message
        const loadingText = loadingOverlay.querySelector('p');
        if (loadingText) {
            loadingText.textContent = message;
        }
    } else {
        loadingOverlay.classList.add('hidden');
    }
}

// Show manual modal loading overlay
function showManualLoading(show, message = 'Generating Image...') {
    const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
    const manualModal = document.getElementById('manualModal');
    
    // Check if manual modal is open and screen is wide enough for preview section
    const isManualModalOpen = manualModal && manualModal.style.display !== 'none';
    const isWideScreen = window.innerWidth > 1400;
    
    if (show && isManualModalOpen && isWideScreen) {
        // Use manual loading overlay for wide screens with modal open
        if (manualLoadingOverlay) {
            manualLoadingOverlay.classList.remove('hidden');
            // Update the loading message
            const loadingText = manualLoadingOverlay.querySelector('p');
            if (loadingText) {
                loadingText.textContent = message;
            }
        }
    } else if (show) {
        // Fall back to regular loading overlay for narrow screens or when modal is closed
        showLoading(true, message);
    } else {
        // Hide both overlays
        if (manualLoadingOverlay) {
            manualLoadingOverlay.classList.add('hidden');
        }
        showLoading(false);
    }
}

// Show success message (simple glass toast)
function showSuccess(message) {
    showGlassToast('success', null, message);
}

// Show error message (simple glass toast)
function showError(message) {
    showGlassToast('error', null, message);
}

// Update lightbox controls based on image type
function updateLightboxControls(image) {
    const deleteBtn = document.getElementById('lightboxDeleteBtn');
    const toggleBaseBtn = document.getElementById('toggleBaseImageBtn');
    
    // Handle mask images (show only download button)
    if (image.isMask) {
        lightboxDownloadBtn.style.display = 'inline-block';
        lightboxRerollBtn.style.display = 'none';
        lightboxRerollEditBtn.style.display = 'none';
        lightboxUpscaleBtn.style.display = 'none';
        deleteBtn.style.display = 'none';
        
        // Set up download for mask
        lightboxDownloadBtn.onclick = (e) => {
            e.preventDefault();
            downloadImage(image);
        };
        return;
    }
    
    // Always show download button for regular images
    lightboxDownloadBtn.style.display = 'inline-block';
    
    // Show reroll button for all images (both original and upscaled)
    lightboxRerollBtn.style.display = 'inline-block';
    
    // Show combined edit button for all images (both original and upscaled)
    lightboxRerollEditBtn.style.display = 'inline-block';
    
    // Show upscale button only for non-upscaled images
    if (image.upscaled || image.pipeline_upscaled) {
        lightboxUpscaleBtn.style.display = 'none';
    } else {
        lightboxUpscaleBtn.style.display = 'inline-block';
    }
    
    // Show scrap button only for logged-in users
    lightboxScrapBtn.style.display = 'inline-block';
    // Update scrap button based on current view
    if (isViewingScraps) {
        lightboxScrapBtn.innerHTML = '<i class="nai-undo"></i>';
        lightboxScrapBtn.title = 'Remove from scraps';
    } else {
        lightboxScrapBtn.innerHTML = '<i class="nai-image-tool-sketch"></i>';
        lightboxScrapBtn.title = 'Move to scraps';
    }
    
    // Show toggle base image button for variations with base images
    if (image.metadata && image.metadata.base_image === true && image.metadata.original_filename) {
        toggleBaseBtn.style.display = 'inline-block';
        toggleBaseBtn.setAttribute('data-state', 'variation'); // Start with variation view
        toggleBaseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> <span>Show Base</span>';
    } else {
        toggleBaseBtn.style.display = 'none';
    }
    
    // Construct proper image object for functions
    // The image.filename is the actual filename being displayed
    // The pipeline/upscaled properties indicate what files exist
    const imageObj = {
        filename: image.filename,
        base: image.base,
        original: image.original || image.filename,
        upscaled: image.upscaled,
        pipeline: image.pipeline,
        pipeline_upscaled: image.pipeline_upscaled,
        metadata: image.metadata
    };
    
    // Set up event listeners
    lightboxDownloadBtn.onclick = (e) => {
        e.preventDefault();
        downloadImage(imageObj);
    };
    lightboxRerollBtn.onclick = () => rerollImage(imageObj); // Direct reroll
    lightboxRerollEditBtn.onclick = () => rerollImageWithEdit(imageObj); // Combined edit (reroll/variation)
    lightboxUpscaleBtn.onclick = () => upscaleImage(imageObj);
    lightboxScrapBtn.onclick = () => {
        if (isViewingScraps) {
            removeFromScraps(imageObj);
        } else {
            moveToScraps(imageObj);
        }
    };
    deleteBtn.onclick = () => deleteImage(imageObj); // Delete image
    
    // Set up toggle base image functionality
    if (toggleBaseBtn.style.display !== 'none') {
        toggleBaseBtn.onclick = () => toggleBaseImage(imageObj);
    }
}

// Create variation from image
async function variationImage(imageObj) {
    try {
        // Determine filename for metadata
        let filenameForMetadata = imageObj.filename || imageObj.pipeline_upscaled || imageObj.pipeline || imageObj.upscaled || imageObj.original;
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
        if (lightboxModal.style.display === 'block') {
            hideLightbox();
        }

        // Store metadata and image
        window.currentEditMetadata = metadata;
        window.currentEditImage = imageObj;

        // Load form values from metadata
        await loadIntoManualForm(metadata, imageObj);

        // Show request type row
        const requestTypeRow = document.getElementById('requestTypeRow');
        if (requestTypeRow) requestTypeRow.style.display = 'flex';

        // Set transformation type to variation
        updateTransformationDropdownState('variation', 'Current');

        // Set up the image as base image for variation
        const filename = imageObj.filename || imageObj.original || imageObj.pipeline || imageObj.pipeline_upscaled;
        if (!filename) {
            throw new Error('No filename available for variation');
        }

        const source = `file:${filename}`;
        const previewUrl = `/images/${filename}`;

        window.uploadedImageData = {
            image_source: source,
            width: metadata.width || 512,
            height: metadata.height || 512,
            bias: 2, // Default center bias
            isBiasMode: true,
            isClientSide: false
        };

        // Set the variation image
        const variationImage = document.getElementById('manualVariationImage');
        if (variationImage) {
            variationImage.src = previewUrl;
            variationImage.style.display = 'block';
        }

        // Set strength to 0.8 and noise to 0.1 for variation
        const strengthValue = document.getElementById('manualStrengthValue');
        const noiseValue = document.getElementById('manualNoiseValue');
        if (strengthValue) strengthValue.value = '0.8';
        if (noiseValue) noiseValue.value = '0.1';

        // Show transformation section content
        const transformationSection = document.getElementById('transformationSection');
        if (transformationSection) {
            transformationSection.classList.add('display-image');
        }

        // Update button visibility
        updateRequestTypeButtonVisibility();
        updateUploadDeleteButtonVisibility();

        // Set form state for variation
        const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
        const saveButton = document.getElementById('manualSaveBtn');
        const layer1SeedToggle = document.getElementById('layer1SeedToggle');
        const manualMaskBiasGroup = document.getElementById('manualMaskBiasGroup');

        if (presetNameGroup) presetNameGroup.style.display = 'block';
        if (saveButton) saveButton.style.display = 'inline-block';
        if (layer1SeedToggle) layer1SeedToggle.style.display = 'none';
        if (manualMaskBiasGroup) manualMaskBiasGroup.style.display = 'none';

        // Update inpaint button state
        updateInpaintButtonState();

        await cropImageToResolution();
        manualModal.style.display = 'block';
        manualPrompt.focus();
        
        // Auto-resize textareas after modal is shown
        autoResizeTextareasAfterModalShow();

    } catch (error) {
        console.error('Variation setup error:', error);
        showError('Failed to set up variation: ' + error.message);
    }
}

// Toggle between variation and base image
async function toggleBaseImage(imageObj) {
    const toggleBaseBtn = document.getElementById('toggleBaseImageBtn');
    const lightboxImage = document.getElementById('lightboxImage');
    const currentState = toggleBaseBtn.getAttribute('data-state');
    
    if (currentState === 'variation') {
        // Switch to base image
        try {
            const baseImageUrl = `/images/${imageObj.metadata.original_filename}`;
            lightboxImage.src = baseImageUrl;
            toggleBaseBtn.setAttribute('data-state', 'base');
            toggleBaseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> <span>Show Variation</span>';
        } catch (error) {
            console.error('Error loading base image:', error);
            showError('Failed to load base image');
        }
    } else {
        // Switch back to variation image
        const variationImageUrl = `/images/${imageObj.filename}`;
        lightboxImage.src = variationImageUrl;
        toggleBaseBtn.setAttribute('data-state', 'variation');
        toggleBaseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> <span>Show Base</span>';
    }
}

let resizeTimeout = null;
// Debounced resize handler
function handleResize() {
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
            
            // Recalculate current page to maintain position
            const currentStartIndex = (currentPage - 1) * imagesPerPage;
            currentPage = Math.floor(currentStartIndex / imagesPerPage) + 1;
            
            // Redisplay current page
            displayCurrentPage();
        }
        
        // Handle loading overlay switching on resize
        const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
        const manualModal = document.getElementById('manualModal');
        
        if (manualLoadingOverlay && manualModal) {
            const isManualModalOpen = manualModal.style.display !== 'none';
            const isWideScreen = window.innerWidth > 1400;
            const isManualOverlayVisible = !manualLoadingOverlay.classList.contains('hidden');
            
            if (isManualOverlayVisible && isManualModalOpen) {
                if (isWideScreen) {
                    // Switch to manual overlay for wide screens
                    showLoading(false);
                    manualLoadingOverlay.classList.remove('hidden');
                } else {
                    // Switch to regular overlay for narrow screens
                    manualLoadingOverlay.classList.add('hidden');
                    showLoading(true, manualLoadingOverlay.querySelector('p')?.textContent || 'Generating your image...');
                }
            }
        }
        updateGalleryItemToolbars();
        updateGalleryPlaceholders(); // Update placeholders after resize
    }, 250); // 250ms delay
}

// Show mask preview for pipelines
async function showMaskPreview() {
    const selectedValue = presetSelect.value;
    
    if (!selectedValue) {
        showError('Please select a pipeline');
        return;
    }

    // Parse the selected value to determine if it's a pipeline
    const [type, name] = selectedValue.split(':');
    
    if (type !== 'pipeline' || !name) {
        showError('Please select a pipeline to preview mask');
        return;
    }

    try {
        const url = `/pipeline/${name}/mask`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to load mask: ${response.statusText}`);
        }

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = function() {
            const maskImage = {
                filename: `mask_${name}_${Date.now()}.png`,
                width: img.width,
                height: img.height,
                url: imageUrl,
                isMask: true
            };
            
            showLightbox(maskImage);
            showSuccess('Mask preview loaded');
        };
        img.src = imageUrl;

    } catch (error) {
        console.error('Mask preview error:', error);
        showError('Failed to load mask preview. Please try again.');
    }
}

// Toggle manual upscale button functionality
function toggleManualUpscale() {
    const currentState = manualUpscale.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    
    manualUpscale.setAttribute('data-state', newState);
    
}

// Update button visibility based on available image
function updateRequestTypeButtonVisibility() {
    const hasValidImage = window.currentEditImage && window.currentEditMetadata;
    const hasBaseImage = hasValidImage && (
        window.currentEditMetadata.original_filename || 
        (window.currentEditImage.filename || window.currentEditImage.original || window.currentEditImage.pipeline || window.currentEditImage.pipeline_upscaled)
    );
    
    // Check if this is an img2img (has base image) or pipeline image
    const isImg2Img = hasValidImage && window.currentEditMetadata.base_image === true;
    const isPipeline = hasValidImage && (window.currentEditImage.pipeline || window.currentEditImage.pipeline_upscaled);
    
    // Show reroll button only if there's a base image available (for img2img) or if it's a pipeline
    const shouldShowReroll = hasValidImage && (isImg2Img || isPipeline);
    
    // Update transformation dropdown options based on available images
    const transformationDropdown = document.getElementById('transformationDropdown');
    if (transformationDropdown) {
        // For pipeline images, hide the transformation dropdown
        const isPipeline = window.currentEditMetadata && window.currentEditMetadata.request_type === 'pipeline';
        if (isPipeline) {
            transformationDropdown.style.display = 'none';
        } else {
            transformationDropdown.style.display = 'inline-block';
            renderTransformationDropdown(document.getElementById('transformationType').value);
        }
    }
}

// Metadata dialog functions
function showMetadataDialog() {
    if (currentImage && currentImage.metadata && metadataDialog) {
        populateDialogMetadataTable(currentImage.metadata);
        metadataDialog.style.display = 'block';
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
            // Check if this is a pipeline with both seeds
            const isPipeline = metadata.request_type === 'pipeline' || metadata.request_type === 'custom_pipeline';
            const hasLayer2Seed = metadata.layer2Seed !== undefined;
            
            if (isPipeline && hasLayer2Seed) {
                // Pipeline with both seeds - show both
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

// Toggle layer1 seed function
function toggleLayer1Seed() {
    const currentState = layer1SeedToggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    
    layer1SeedToggle.setAttribute('data-state', newState);
    
    // The new CSS system handles styling automatically based on data-state
    // No need to manually set styles - the CSS classes handle it
}

// Helper: Get pipeline preset resolution
function getPipelinePresetResolution(pipelineName) {
    const pipeline = pipelines.find(p => p.name === pipelineName);
    return pipeline ? pipeline.resolution : null;
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
        manualSeed.disabled = true;
        sproutSeedBtn.classList.add('active');
        // Hide the clear seed button
        if (clearSeedBtn) clearSeedBtn.style.display = 'none';
    } else {
        // Clear the seed value and enable the field
        manualSeed.value = '';
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
        const icon = getToastIcon(type);
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

function getToastIcon(type) {
    switch (type) {
        case 'success': return '<i class="nai-check"></i>';
        case 'error': return '<i class="nai-cross"></i>';
        case 'warning': return '<i class="nai-help"></i>';
        case 'info': return '<i class="nai-book-open"></i>';
        default: return '<i class="nai-book-open"></i>';
    }
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
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

// Upload single image to server (for backward compatibility)
async function uploadImage(file) {
    await uploadImages([file]);
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
        const transformationSection = document.getElementById('transformationSection');
        if (transformationSection) {
            transformationSection.classList.add('display-image');
        }
        updateUploadDeleteButtonVisibility();
        updateInpaintButtonState();
        
        // Crop and update preview
        await cropImageToResolution();
        
        showSuccess('Base image uploaded and processed.');

    } catch (error) {
        console.error('Manual upload error:', error);
        showError(`Upload failed: ${error.message}`);
    } finally {
        showManualLoading(false);
    }
}

// Render image bias dropdown
async function renderImageBiasDropdown(selectedVal) {
    let imageAR = 1;
    let targetAR = 1;
    
    const imageBiasDropdownMenu = document.getElementById('imageBiasDropdownMenu');
    if (!imageBiasDropdownMenu) return;

    if (!window.uploadedImageData || window.uploadedImageData.isPlaceholder) {
        if (imageBiasGroup) {
            imageBiasGroup.style.display = 'none';
        }
        return;
    }

    if (!imageBiasDropdownBtn.hasAttribute('data-setup')) {
        // Add event listeners
        imageBiasDropdownBtn.addEventListener('click', () => {
            if (imageBiasDropdownMenu.style.display === 'none') {
                openImageBiasDropdown();
            } else {
                closeImageBiasDropdown();
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!imageBiasDropdownBtn.contains(e.target) && !imageBiasDropdownMenu.contains(e.target)) {
                closeImageBiasDropdown();
            }
        });
        
        // Mark as set up
        imageBiasDropdownBtn.setAttribute('data-setup', 'true');
    }
    
    // Check if we have dynamic bias (object) instead of legacy bias (number)
    const hasDynamicBias = window.uploadedImageData && window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object';
    
    // Render image bias options with correct labels
    function renderImageBiasOptions() {
        const isPortraitImage = imageAR < targetAR;
        imageBiasDropdownMenu.innerHTML = '';
        
        // Create bias options based on image orientation (exclude Custom from dropdown)
        const biasOptions = [
            { value: '0', display: isPortraitImage ? 'Top' : 'Left' },
            { value: '1', display: isPortraitImage ? 'Mid-Top' : 'Mid-Left' },
            { value: '2', display: 'Center' },
            { value: '3', display: isPortraitImage ? 'Mid-Bottom' : 'Mid-Right' },
            { value: '4', display: isPortraitImage ? 'Bottom' : 'Right' }
        ];
        
        biasOptions.forEach(option => {
            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option';
            optionElement.dataset.value = option.value;
            
            // Create grid based on orientation
            let gridHTML = '';
            if (isPortraitImage) {
                // Portrait: 3 columns, 5 rows (vertical layout)
                for (let i = 0; i < 15; i++) {
                    gridHTML += '<div class="grid-cell"></div>';
                }
            } else {
                // Landscape: 5 columns, 3 rows (horizontal layout)
                for (let i = 0; i < 15; i++) {
                    gridHTML += '<div class="grid-cell"></div>';
                }
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
                selectImageBias(option.value);
            });
            
            imageBiasDropdownMenu.appendChild(optionElement);
        });
        
        // Update button display
        if (imageBiasDropdownBtn) {
            const buttonGrid = imageBiasDropdownBtn.querySelector('.mask-bias-grid');
            if (buttonGrid) {
                if (hasDynamicBias) {
                    // Show custom bias with diagonal grid
                    buttonGrid.setAttribute('data-bias', 'custom');
                    buttonGrid.setAttribute('data-orientation', isPortraitImage ? 'portrait' : 'landscape');
                    buttonGrid.classList.add('custom-bias');
                } else {
                    // Show normal bias
                    buttonGrid.setAttribute('data-bias', selectedVal);
                    buttonGrid.setAttribute('data-orientation', isPortraitImage ? 'portrait' : 'landscape');
                    buttonGrid.classList.remove('custom-bias');
                }
            }
        }
        
        // Call updateImageBiasDisplay with appropriate value
        if (hasDynamicBias) {
            updateImageBiasDisplay('custom');
        } else {
            updateImageBiasDisplay(selectedVal);
        }
    }

    if (hasDynamicBias) {
        imageBiasGroup.style.display = 'flex';
        renderImageBiasOptions();
        return;
    }
    
    const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
    if (currentResolution === 'custom' && manualWidth && manualHeight) {
        const width = parseInt(manualWidth.value);
        const height = parseInt(manualHeight.value);
        targetAR = width / height;
    } else {
        const resolutionDims = getDimensionsFromResolution(currentResolution);
        if (resolutionDims) {
            targetAR = resolutionDims.width / resolutionDims.height;
        }
    }
    
    if (window.uploadedImageData) {
        if (window.uploadedImageData.width && window.uploadedImageData.height) {
            imageAR = window.uploadedImageData.width / window.uploadedImageData.height;
        } else if (window.uploadedImageData.originalDataUrl) {
            // Fallback to loading image if dimensions not stored
            imageAR = await new Promise(resolve => {
                const img = new Image();
                img.onload = function() {
                    resolve(img.width / img.height);
                };
                img.src = window.uploadedImageData.originalDataUrl;
            });
        }
    }

    // Show image bias group if aspect ratios are different enough OR if both are square (bias still useful for cropping)
    if (imageBiasGroup) {
        const aspectRatioDifference = Math.abs(imageAR - targetAR);
        const isImageSquare = Math.abs(imageAR - 1.0) < 0.05;
        const isTargetSquare = Math.abs(targetAR - 1.0) < 0.05;
        
        if (aspectRatioDifference > 0.05 || (isImageSquare && isTargetSquare)) {
            imageBiasGroup.style.display = 'flex';
        } else {
            imageBiasGroup.style.display = 'none';
            return;
        }
    }

    renderImageBiasOptions();
}

// Select image bias
function selectImageBias(value) {
    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;
    
    if (hasExistingMask) {
        // Store the pending bias change and show alert modal
        window.pendingImageBiasChange = { 
            value, 
            callback: () => {
                // This will be called after the mask is handled
            }
        };
        showImageBiasMaskAlertModal();
        return;
    }
    
    // No mask exists, proceed with bias change
    applyImageBiasChange(value);
}

// Update image bias display
function updateImageBiasDisplay(value) {
    const buttonGrid = imageBiasDropdownBtn.querySelector('.mask-bias-grid');
    if (!buttonGrid) return;

    const isPortraitImage = buttonGrid.getAttribute('data-orientation') === 'portrait';
    const hasDynamicBias = window.uploadedImageData && window.uploadedImageData.image_bias;
    
    if (hasDynamicBias) {
        // Show "Custom" for dynamic bias
        if (imageBiasSelected) {
            imageBiasSelected.textContent = 'Custom';
        }
        buttonGrid.setAttribute('data-bias', 'custom');
        buttonGrid.classList.add('custom-bias');
    } else {
        // Show normal bias options
        const biasOptions = [
            { value: '0', display: isPortraitImage ? 'Top' : 'Left' },
            { value: '1', display: isPortraitImage ? 'Mid-Top' : 'Mid-Left' },
            { value: '2', display: 'Center' },
            { value: '3', display: isPortraitImage ? 'Mid-Bottom' : 'Mid-Right' },
            { value: '4', display: isPortraitImage ? 'Bottom' : 'Right' }
        ];
        
        // Fix: Use string comparison to handle '0' value correctly
        const selectedOption = biasOptions.find(opt => opt.value === value.toString());
        if (imageBiasSelected && selectedOption) {
            imageBiasSelected.textContent = selectedOption.display;
        }
        buttonGrid.setAttribute('data-bias', value);
        buttonGrid.classList.remove('custom-bias');
    }
    
    handleImageBiasChange();
    
    closeImageBiasDropdown();
}

// Open image bias dropdown
function openImageBiasDropdown() {
    const imageBiasDropdownMenu = document.getElementById('imageBiasDropdownMenu');
    if (imageBiasDropdownMenu) {
        imageBiasDropdownMenu.style.display = 'block';
    }
}

// Close image bias dropdown
function closeImageBiasDropdown() {
    const imageBiasDropdownMenu = document.getElementById('imageBiasDropdownMenu');
    if (imageBiasDropdownMenu) {
        imageBiasDropdownMenu.style.display = 'none';
    }
}

// Hide image bias dropdown
function hideImageBiasDropdown() {
    const imageBiasGroup = document.getElementById('imageBiasGroup');
    if (imageBiasGroup) {
        imageBiasGroup.style.display = 'none';
    }
}

// Handle mask bias changes
async function handleMaskBiasChange() {
    if (!window.uploadedImageData || !window.uploadedImageData.isBiasMode) return;
    
    const newBias = parseInt(manualMaskBiasHidden.value) || 2;
    manualSelectedMaskBias = newBias;
    
    // Update mask preview
    updateMaskPreview();
}

// Handle image bias changes
async function handleImageBiasChange() {
    if (!window.uploadedImageData || !window.uploadedImageData.isBiasMode) return;
    
    const newBias = parseInt(imageBiasHidden.value);
    // Don't fall back - if it's NaN, don't update
    if (isNaN(newBias)) return;
    
    // Update stored data
    window.uploadedImageData.bias = newBias;

    // Update the image position
    await cropImageToResolution();
}

// Internal function to crop image to resolution (existing function, keeping for compatibility)
function cropImageToResolutionInternal(dataUrl, bias) {
    const biasFractions = [0, 0.25, 0.5, 0.75, 1];
    return new Promise((resolve) => {
        if (!dataUrl) {
            console.warn('No dataUrl provided to cropImageToResolutionInternal');
            resolve(dataUrl);
            return;
        }
        
        const img = new Image();
        img.onload = function() {
            // Validate image dimensions
            if (img.width === 0 || img.height === 0) {
                console.warn('Image has invalid dimensions:', img.width, 'x', img.height);
                resolve(dataUrl);
                return;
            }
            const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
            const resolutionDims = getDimensionsFromResolution(currentResolution);
            
            if (!resolutionDims) {
                resolve(dataUrl);
                return;
            }
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = resolutionDims.width;
            canvas.height = resolutionDims.height;
            
            // Calculate crop dimensions
            const imageAR = img.width / img.height;
            const targetAR = resolutionDims.width / resolutionDims.height;
            
            let cropWidth, cropHeight, cropX, cropY;
            
            if (imageAR > targetAR) {
                // Image is wider than target, crop width
                cropHeight = img.height;
                cropWidth = img.height * targetAR;
                const biasFrac = biasFractions[bias] !== undefined ? biasFractions[bias] : 0.5;
                cropX = (img.width - cropWidth) * biasFrac;
                cropY = 0;
            } else {
                // Image is taller than target, crop height
                cropWidth = img.width;
                cropHeight = img.width / targetAR;
                cropX = 0;
                const biasFrac = biasFractions[bias] !== undefined ? biasFractions[bias] : 0.5;
                cropY = (img.height - cropHeight) * biasFrac;
            }
            
            // Draw cropped image
            ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, resolutionDims.width, resolutionDims.height);
            
            // Convert to blob instead of data URL to avoid memory issues
            canvas.toBlob((blob) => {
                // Create blob URL and store it in window for cleanup
                const blobUrl = URL.createObjectURL(blob);
                
                // Store the blob URL for cleanup
                if (!window.croppedImageBlobUrls) {
                    window.croppedImageBlobUrls = [];
                }
                window.croppedImageBlobUrls.push(blobUrl);
                
                resolve(blobUrl);
            }, 'image/png');
        };
        img.src = dataUrl;
    });
}
// Clean up blob URLs to prevent memory leaks
function cleanupBlobUrls() {
    if (window.croppedImageBlobUrls) {
        window.croppedImageBlobUrls.forEach(blobUrl => {
            URL.revokeObjectURL(blobUrl);
        });
        window.croppedImageBlobUrls = [];
    }
}

// Handle deleting uploaded base image
function handleDeleteBaseImage() {
    // Clean up any existing blob URLs
    cleanupBlobUrls();
    
    // Clear the uploaded image data
    window.uploadedImageData = null;
    
    // Clear the variation image
    const variationImage = document.getElementById('manualVariationImage');
    if (variationImage) {
        variationImage.src = '';
    }
    
    // Hide transformation section content
    const transformationSection = document.getElementById('transformationSection');
    if (transformationSection) {
        transformationSection.classList.remove('display-image');
    }
    
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
        // For pipeline images, don't show delete button since they use placeholder images
        const isPipeline = window.currentEditMetadata && window.currentEditMetadata.request_type === 'pipeline';
        if (isPipeline) {
            deleteImageBaseBtn.style.display = 'none';
        } else if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            // Image is uploaded (not a placeholder), show delete button
            deleteImageBaseBtn.style.display = 'inline-block';
        } else {
            // No image uploaded or it's a placeholder, hide delete button
            deleteImageBaseBtn.style.display = 'none';
        }
    }
}

// Selection handling functions
function handleImageSelection(image, isSelected, event) {
    const filename = image.filename || image.original || image.upscaled || image.pipeline || image.pipeline_upscaled;
    
    // Skip if no valid filename found
    if (!filename) {
        console.warn('No valid filename found for image:', image);
        return;
    }
    
    const item = event.target.closest('.gallery-item');
    
    // ALT+click range selection
    if (event && event.altKey) {
        // Find all checkboxes in order
        const checkboxes = Array.from(document.querySelectorAll('.gallery-item-checkbox'));
        const clickedIndex = checkboxes.findIndex(cb => cb.dataset.filename === filename);
        if (lastSelectedGalleryIndex !== null && clickedIndex !== -1) {
            const [start, end] = [lastSelectedGalleryIndex, clickedIndex].sort((a, b) => a - b);
            for (let i = start; i <= end; i++) {
                const cb = checkboxes[i];
                const img = allImages[i];
                if (cb && img) {
                    cb.checked = true;
                    selectedImages.add(cb.dataset.filename);
                    cb.closest('.gallery-item').classList.add('selected');
                }
            }
            updateBulkActionsBar();
            return;
        }
    }
    // Update last selected index
    const checkboxes = Array.from(document.querySelectorAll('.gallery-item-checkbox'));
    const thisIndex = checkboxes.findIndex(cb => cb.dataset.filename === filename);
    if (thisIndex !== -1) {
        lastSelectedGalleryIndex = thisIndex;
    }

    if (isSelected) {
        selectedImages.add(filename);
        item.classList.add('selected');
    } else {
        selectedImages.delete(filename);
        item.classList.remove('selected');
    }
    
    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCount = document.getElementById('selectedCount');
    const bulkMoveToScrapsBtn = document.getElementById('bulkMoveToScrapsBtn');
    
    if (selectedImages.size > 0) {
        bulkActionsBar.style.display = 'flex';
        selectedCount.textContent = selectedImages.size;
        gallery.classList.add('selection-mode');
        isSelectionMode = true;
        
        // Show/hide scrap button based on current view
        if (bulkMoveToScrapsBtn) {
            if (isViewingScraps) {
                // Hide scrap button when viewing scraps (can't move scraps to scraps)
                bulkMoveToScrapsBtn.style.display = 'none';
            } else {
                // Show scrap button when viewing regular images
                bulkMoveToScrapsBtn.style.display = 'inline-block';
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
    
    // Uncheck all checkboxes
    const checkboxes = document.querySelectorAll('.gallery-item-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Remove selected class from all items
    const selectedItems = document.querySelectorAll('.gallery-item.selected');
    selectedItems.forEach(item => {
        item.classList.remove('selected');
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
                modal.style.display = 'none';
            }
        });
        
        document.getElementById('closeBulkMoveToWorkspaceBtn').addEventListener('click', () => {
            modal.style.display = 'none';
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
            modal.style.display = 'none';
            await moveBulkImagesToWorkspace(workspace.id);
        });
        
        workspaceList.appendChild(item);
    });
    
    modal.style.display = 'block';
}

async function moveBulkImagesToWorkspace(workspaceId) {
    try {
        const isScrapsView = isViewingScraps;
        const loadingText = isScrapsView ? 'Moving scraps to workspace...' : 'Moving images to workspace...';
        showLoading(true, loadingText);
        
        // Filter out any null/undefined values from selectedImages
        const validFilenames = Array.from(selectedImages).filter(filename => filename && typeof filename === 'string');
        
        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to move');
        }
        
        // Use appropriate endpoint based on current view
        const endpoint = isScrapsView ? `/workspaces/${workspaceId}/scraps` : `/workspaces/${workspaceId}/files`;
        
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
        const itemType = isScrapsView ? 'scraps' : 'images';
        
        showSuccess(`Moved ${result.movedCount} ${itemType} to ${workspace ? workspace.name : 'workspace'}`);
        
        // Clear selection and reload gallery
        clearSelection();
        if (isScrapsView) {
            await loadScraps();
        } else {
            await loadGallery();
        }
        
    } catch (error) {
        console.error('Error moving items to workspace:', error);
        showError('Failed to move items: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function handleBulkDelete() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }
    
    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to delete ${selectedImages.size} selected image(s)? This will permanently delete both the original and upscaled versions.`);
    
    if (!confirmed) {
        return;
    }
    
    try {
        showLoading(true, 'Deleting selected images...');
        
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
            showSuccess(`Successfully deleted ${result.successful} image(s)`);
            if (result.failed > 0) {
                showError(`${result.failed} image(s) failed to delete`);
            }
            
            // Clear selection and refresh gallery
            clearSelection();
            await loadGallery();
        } else {
            throw new Error(result.error || 'Bulk delete failed');
        }
        
    } catch (error) {
        console.error('Bulk delete error:', error);
        showError('Bulk delete failed: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function handleBulkSequenzia() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }
    
    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to send ${selectedImages.size} selected image(s) to Sequenzia? This will move the images and delete them from the gallery.`);
    
    if (!confirmed) {
        return;
    }
    
    try {
        showLoading(true, 'Sending images to Sequenzia...');
        
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
            showSuccess(`Successfully sent ${result.successful} image(s) to Sequenzia`);
            if (result.failed > 0) {
                showError(`${result.failed} image(s) failed to send`);
            }
            
            // Clear selection and refresh gallery
            clearSelection();
            await loadGallery();
        } else {
            throw new Error(result.error || 'Send to Sequenzia failed');
        }
        
    } catch (error) {
        console.error('Send to Sequenzia error:', error);
        showError('Send to Sequenzia failed: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function handleBulkMoveToScraps() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }
    
    // Don't allow moving scraps to scraps
    if (isViewingScraps) {
        showError('Cannot move scraps to scraps');
        return;
    }
    
    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to move ${selectedImages.size} selected image(s) to scraps?`);
    
    if (!confirmed) {
        return;
    }
    
    try {
        showLoading(true, 'Moving images to scraps...');
        
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
            showSuccess(`Successfully moved ${successCount} image(s) to scraps`);
        }
        
        if (errorCount > 0) {
            showError(`${errorCount} image(s) failed to move to scraps`);
        }
        
        // Clear selection and refresh gallery
        clearSelection();
        await loadGallery();
        
    } catch (error) {
        console.error('Bulk move to scraps error:', error);
        showError('Failed to move images to scraps: ' + error.message);
    } finally {
        showLoading(false);
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
    modal.style.display = 'block';
    
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
        showLoading(true, 'Updating preset names...');
        
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
            const action = newPresetName ? `set to "${newPresetName}"` : 'removed';
            showSuccess(`Successfully updated preset name for ${result.updatedCount} image(s) (${action})`);
            
            // Clear selection and refresh gallery
            clearSelection();
            await loadGallery();
        } else {
            throw new Error(result.error || 'Failed to update preset names');
        }
        
    } catch (error) {
        console.error('Bulk change preset error:', error);
        showError('Failed to update preset names: ' + error.message);
    } finally {
        showLoading(false);
        modal.style.display = 'none';
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
            baseUc: '<NUC_3>',
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
    showGlassToast('success', 'Random Prompt', 'Transferred to editor');
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
    const container = document.getElementById('characterPromptsContainer');
    const characterId = `character_${characterPromptCounter++}`;
    
    const characterItem = document.createElement('div');
    characterItem.className = 'character-prompt-item';
    characterItem.id = characterId;
    
            characterItem.innerHTML = `
            <div class="character-prompt-tabs">
                <div class="tab-header">
                    <div class="tab-buttons">
                        <button type="button" class="tab-btn active" data-tab="prompt">
                            <i class="nai-penwriting"></i> Prompt
                        </button>
                        <button type="button" class="tab-btn" data-tab="uc">
                            <i class="nai-minus"></i> UC
                        </button>
                        <div class="character-name-editable" onclick="editCharacterName('${characterId}')">
                            <span class="character-name-text">Character ${characterPromptCounter}</span>
                            <i class="nai-settings"></i>
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
                            <i class="fas fa-crosshairs"></i> Position
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
                    <div class="tab-pane active" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..."></textarea>
                        </div>
                    </div>
                    <div class="tab-pane" id="${characterId}_uc-tab" data-label="UC">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content..."></textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;
    
    // Store character name in dataset
    characterItem.dataset.charaName = `Character ${characterPromptCounter}`;
    
    container.appendChild(characterItem);
    

    
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
    
    // Add tab switching functionality for character prompt tabs
    const characterTabButtons = characterItem.querySelectorAll('.tab-btn');
    
    characterTabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            switchCharacterTab(characterId, targetTab);
        });
    });
    
    // Add preview textarea click handler
    const previewTextarea = document.getElementById(`${characterId}_preview`);
    if (previewTextarea) {
        previewTextarea.addEventListener('click', () => {
            toggleCharacterPromptCollapse(characterId);
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
    const existingCharacters = container.querySelectorAll('.character-prompt-item');
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
    const container = document.getElementById('characterPromptsContainer');
    const characterItems = Array.from(container.querySelectorAll('.character-prompt-item'));
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
        container.insertBefore(targetItem, currentItem);
    } else {
        // Moving up
        container.insertBefore(currentItem, targetItem);
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
    const container = document.getElementById('characterPromptsContainer');
    const characterItems = container.querySelectorAll('.character-prompt-item');
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    
    if (characterItems.length === 0) {
        autoPositionBtn.style.display = 'none';
        return;
    }
    
    autoPositionBtn.style.display = 'inline-flex';
    
    if (characterItems.length === 1) {
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
    const container = document.getElementById('characterPromptsContainer');
    const characterItems = container.querySelectorAll('.character-prompt-item');
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
    const container = document.getElementById('characterPromptsContainer');
    container.innerHTML = '';
    characterPromptCounter = 0;
}

function loadCharacterPrompts(characterPrompts, useCoords) {
    clearCharacterPrompts();
    
    if (!characterPrompts || !Array.isArray(characterPrompts)) {
        return;
    }
    
    // Update counter to match the number of characters
    characterPromptCounter = characterPrompts.length;
    
    characterPrompts.forEach((character, index) => {
        const container = document.getElementById('characterPromptsContainer');
        const characterId = `character_${index}`;
        characterPromptCounter = index + 1;
        
        const characterItem = document.createElement('div');
        characterItem.className = 'character-prompt-item';
        characterItem.id = characterId;
        
        if (!character.enabled) {
            characterItem.classList.add('character-prompt-disabled');
        }
        
        // Determine position button text
        let positionBtnText = '<i class="fas fa-crosshairs"></i> Position';
        if (character.center && useCoords) {
            // Find the cell label for the stored position
            const x = character.center.x;
            const y = character.center.y;
            const cellLabel = getCellLabelFromCoords(x, y);
            if (cellLabel) {
                positionBtnText = `<i class="fas fa-crosshairs"></i> ${cellLabel}`;
            }
        }
        
        characterItem.innerHTML = `
            <div class="character-prompt-tabs">
                <div class="tab-header">
                    <div class="tab-buttons">
                        <button type="button" class="tab-btn active" data-tab="prompt">
                            <i class="nai-penwriting"></i> Prompt
                        </button>
                        <button type="button" class="tab-btn" data-tab="uc">
                            <i class="nai-minus"></i> UC
                        </button>
                        <div class="character-name-editable" onclick="editCharacterName('${characterId}')">
                            <span class="character-name-text">${character.chara_name || `Character ${index + 1}`}</span>
                            <i class="nai-settings"></i>
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
                    <div class="tab-pane active" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt...">${character.prompt || ''}</textarea>
                        </div>
                    </div>
                    <div class="tab-pane" id="${characterId}_uc-tab" data-label="UC">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content...">${character.uc || ''}</textarea>
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
        
        container.appendChild(characterItem);
        

        
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
        
        // Add tab switching functionality for character prompt tabs
        const characterTabButtons = characterItem.querySelectorAll('.tab-btn');
        
        characterTabButtons.forEach(button => {
            button.addEventListener('click', function() {
                const targetTab = this.getAttribute('data-tab');
                switchCharacterTab(characterId, targetTab);
            });
        });
        
        // Add preview textarea click handler
        const previewTextarea = document.getElementById(`${characterId}_preview`);
        if (previewTextarea) {
            previewTextarea.addEventListener('click', () => {
                toggleCharacterPromptCollapse(characterId);
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

function editCharacterName(characterId) {
    const characterItem = document.getElementById(characterId);
    const nameElement = characterItem.querySelector('.character-name-text');
    const currentName = nameElement.textContent;
    
    // Check if there's already an input field and remove it
    const existingInput = characterItem.querySelector('.character-name-input');
    if (existingInput) {
        existingInput.remove();
        nameElement.style.display = 'inline';
        return;
    }
    
    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'character-name-input';
    input.value = currentName;
    input.style.width = '100%';
    input.style.padding = '4px 8px';
    input.style.border = '1px solid #444';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#2a2a2a';
    input.style.color = '#fff';
    input.style.fontSize = '14px';
    
    // Replace text with input
    nameElement.style.display = 'none';
    nameElement.parentNode.insertBefore(input, nameElement);
    input.focus();
    input.select();
    
    // Handle save on enter or blur
    function saveName() {
        const newName = input.value.trim();
        if (newName) {
            nameElement.textContent = newName;
            characterItem.dataset.charaName = newName;
        }
        nameElement.style.display = 'inline';
        input.remove();
    }
    
    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            saveName();
        } else if (e.key === 'Escape') {
            nameElement.style.display = 'inline';
            input.remove();
        }
    });
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
        const isImg2Img = document.getElementById('manualMaskBiasRow')?.style?.display !== 'none' || !document.getElementById('transformationSection')?.classList.contains('hidden');
        
        // Get sampler object
        const samplerObj = getSamplerMeta(sampler) || { meta: 'k_euler_ancestral' };
        
        // Calculate price
        const price = calculatePriceUnified({
            height: height,
            width: width,
            steps: steps,
            model: model,
            sampler: samplerObj,
            subscription: subscriptionData || { perks: { unlimitedImageGenerationLimits: [] } },
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

// Mask Editor Functionality
let maskEditorCanvas = null;
let maskEditorCanvasInner = null;
let maskEditorCtx = null;
let isDrawing = false;
let currentTool = 'brush'; // 'brush' or 'eraser'
let brushSize = 3;
let brushSizePercent = 0.03; // 3% of canvas size as default
let brushShape = 'square'; // 'square' or 'circle'
let maskImageData = null;
let displayScale = 1; // Track the display scale for cursor positioning
let globalMouseDown = false; // Track global mouse state for continuous drawing

// Initialize mask editor
function initializeMaskEditor() {
    maskEditorCanvas = document.getElementById('maskCanvas');
    maskEditorCanvasInner = document.getElementById('maskEditorCanvasInner');
    if (!maskEditorCanvas) return;
    
    maskEditorCtx = maskEditorCanvas.getContext('2d');
    
    // Create brush cursor element if it doesn't exist
    let brushCursor = document.querySelector('.brush-cursor');
    if (!brushCursor) {
        brushCursor = document.createElement('div');
        brushCursor.className = 'brush-cursor';
        brushCursor.style.display = 'none';
        document.body.appendChild(brushCursor);
    }
    
    // Set up canvas event listeners
    maskEditorCanvas.addEventListener('mousedown', startDrawing);
    maskEditorCanvas.addEventListener('mousemove', draw);
    maskEditorCanvas.addEventListener('mouseup', stopDrawing);
    
    // Brush cursor events
    maskEditorCanvas.addEventListener('mousemove', updateBrushCursor);
    maskEditorCanvas.addEventListener('mouseenter', handleCanvasMouseEnter);
    maskEditorCanvas.addEventListener('mouseleave', () => {
        if (brushCursor) brushCursor.style.display = 'none';
    });
    
    // Wheel event for brush size adjustment
    maskEditorCanvas.addEventListener('wheel', handleCanvasWheel);
    
    // Global mouse events for continuous drawing
    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('mousemove', handleGlobalMouseMove);
    
    // Touch events for mobile
    maskEditorCanvas.addEventListener('touchstart', handleTouchStart);
    maskEditorCanvas.addEventListener('touchmove', handleTouchMove);
    maskEditorCanvas.addEventListener('touchend', handleTouchEnd);
    
    // Tool buttons
    const brushBtn = document.getElementById('maskBrushBtn');
    const eraserBtn = document.getElementById('maskEraserBtn');
    const brushShapeBtn = document.getElementById('brushShapeBtn');
    const clearBtn = document.getElementById('clearMaskBtn');
    const saveBtn = document.getElementById('saveMaskBtn');
    const deleteBtn = document.getElementById('deleteMaskBtn');
    const cancelBtn = document.getElementById('cancelMaskBtn');
    const closeBtn = document.getElementById('closeMaskEditorBtn');
    const brushSizeInput = document.getElementById('brushSize');
    
    if (brushBtn) {
        brushBtn.addEventListener('click', () => setTool('brush'));
    }
    
    if (eraserBtn) {
        eraserBtn.addEventListener('click', () => setTool('eraser'));
    }
    
    if (brushShapeBtn) {
        brushShapeBtn.addEventListener('click', toggleBrushShape);
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearMask);
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', saveMask);
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteMask());
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeMaskEditor);
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMaskEditor);
    }
    
    if (brushSizeInput) {
        // Set initial value
        brushSizeInput.value = brushSize;
        
        // Input change handler
        brushSizeInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val)) val = 1;
            val = Math.max(1, Math.min(15, val));
            brushSize = val;
            e.target.value = val;
            
            // Calculate and store the percentage for future reference
            if (maskEditorCanvas) {
                const canvasDiagonal = Math.sqrt(maskEditorCanvas.width * maskEditorCanvas.width + maskEditorCanvas.height * maskEditorCanvas.height);
                brushSizePercent = brushSize / canvasDiagonal;
            }
            
            // Update cursor size if it exists
            const brushCursor = document.querySelector('.brush-cursor');
            if (brushCursor && brushCursor.style.display !== 'none') {
                const cursorSize = brushSize * displayScale;
                brushCursor.style.width = cursorSize + 'px';
                brushCursor.style.height = cursorSize + 'px';
            }
        });
        
        // Mouse wheel handler for scrolling
        brushSizeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentValue = parseInt(this.value) || 3;
            const newValue = Math.max(1, Math.min(15, currentValue + delta));
            this.value = newValue;
            brushSize = newValue;
            
            // Calculate and store the percentage for future reference
            if (maskEditorCanvas) {
                const canvasDiagonal = Math.sqrt(maskEditorCanvas.width * maskEditorCanvas.width + maskEditorCanvas.height * maskEditorCanvas.height);
                brushSizePercent = brushSize / canvasDiagonal;
            }
            
            // Update cursor size if it exists
            const brushCursor = document.querySelector('.brush-cursor');
            if (brushCursor && brushCursor.style.display !== 'none') {
                const cursorSize = brushSize * displayScale;
                brushCursor.style.width = cursorSize + 'px';
                brushCursor.style.height = cursorSize + 'px';
            }
        });
    }
}

// Set drawing tool
function setTool(tool) {
    currentTool = tool;
    
    const brushBtn = document.getElementById('maskBrushBtn');
    const eraserBtn = document.getElementById('maskEraserBtn');
    
    if (brushBtn) {
        brushBtn.setAttribute('data-state', tool === 'brush' ? 'on' : 'off');
    }
    
    if (eraserBtn) {
        eraserBtn.setAttribute('data-state', tool === 'eraser' ? 'on' : 'off');
    }
}

// Toggle brush shape
function toggleBrushShape() {
    brushShape = brushShape === 'square' ? 'circle' : 'square';
    
    // Update the toggle button icon
    const brushShapeBtn = document.getElementById('brushShapeBtn');
    if (brushShapeBtn) {
        const icon = brushShapeBtn.querySelector('i');
        if (icon) {
            if (brushShape === 'circle') {
                icon.className = 'fas fa-circle';
            } else {
                icon.className = 'fas fa-square';
            }
        }
    }
    
    // Update cursor if it's visible
    const brushCursor = document.querySelector('.brush-cursor');
    if (brushCursor && brushCursor.style.display !== 'none') {
        if (brushShape === 'circle') {
            brushCursor.style.borderRadius = '50%';
        } else {
            brushCursor.style.borderRadius = '0';
        }
    }
}

// Handle canvas wheel for brush size adjustment
function handleCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    const currentValue = brushSize;
    const newValue = Math.max(1, Math.min(15, currentValue + delta));
    brushSize = newValue;
    
    // Update brush size input if it exists
    const brushSizeInput = document.getElementById('brushSize');
    if (brushSizeInput) {
        brushSizeInput.value = newValue;
    }
    
    // Calculate and store the percentage for future reference
    if (maskEditorCanvas) {
        const canvasDiagonal = Math.sqrt(maskEditorCanvas.width * maskEditorCanvas.width + maskEditorCanvas.height * maskEditorCanvas.height);
        brushSizePercent = brushSize / canvasDiagonal;
    }
    
    // Update cursor size if it exists
    const brushCursor = document.querySelector('.brush-cursor');
    if (brushCursor && brushCursor.style.display !== 'none') {
        const rect = maskEditorCanvas.getBoundingClientRect();
        const visualScaleX = rect.width / maskEditorCanvas.width;
        const visualScaleY = rect.height / maskEditorCanvas.height;
        const visualScale = Math.min(visualScaleX, visualScaleY);
        const cursorSize = brushSize * visualScale;
        brushCursor.style.width = cursorSize + 'px';
        brushCursor.style.height = cursorSize + 'px';
    }
}

// Handle canvas mouse enter for continuous drawing
function handleCanvasMouseEnter(e) {
    const brushCursor = document.querySelector('.brush-cursor');
    if (brushCursor) brushCursor.style.display = 'block';
    
    // If global mouse is down, resume drawing
    if (globalMouseDown && !isDrawing) {
        isDrawing = true;
        draw(e);
    }
}

// Handle global mouse up to stop drawing
function handleGlobalMouseUp() {
    if (isDrawing) {
        isDrawing = false;
        globalMouseDown = false;
    }
}

// Handle global mouse move for continuous drawing
function handleGlobalMouseMove(e) {
    // Only handle if we're drawing and mouse is over the canvas
    if (globalMouseDown && !isDrawing && maskEditorCanvas) {
        const rect = maskEditorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Check if mouse is over the canvas
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
            isDrawing = true;
            draw(e);
        }
    }
}

// Start drawing
function startDrawing(e) {
    isDrawing = true;
    globalMouseDown = true;
    draw(e);
}

// Draw function
function draw(e) {
    if (!isDrawing || !maskEditorCtx) return;
    
    e.preventDefault();
    
    const rect = maskEditorCanvas.getBoundingClientRect();
    
    // Calculate the actual canvas content area (accounting for object-fit: contain)
    const visualScaleX = rect.width / maskEditorCanvas.width;
    const visualScaleY = rect.height / maskEditorCanvas.height;
    const visualScale = Math.min(visualScaleX, visualScaleY);
    
    // Calculate the actual canvas content dimensions
    const actualCanvasWidth = maskEditorCanvas.width * visualScale;
    const actualCanvasHeight = maskEditorCanvas.height * visualScale;
    
    // Calculate padding around the canvas content
    const paddingX = (rect.width - actualCanvasWidth) / 2;
    const paddingY = (rect.height - actualCanvasHeight) / 2;
    
    // Calculate position relative to the actual canvas content
    const x = e.clientX - rect.left - paddingX;
    const y = e.clientY - rect.top - paddingY;
    
    // Only draw if mouse is over the actual canvas content
    if (x >= 0 && x <= actualCanvasWidth && y >= 0 && y <= actualCanvasHeight) {
        // Scale coordinates to canvas size
        const canvasX = (x / actualCanvasWidth) * maskEditorCanvas.width;
        const canvasY = (y / actualCanvasHeight) * maskEditorCanvas.height;
        
        if (currentTool === 'brush') {
            if (brushShape === 'circle') {
                // Draw circle brush using direct pixel manipulation
                drawCircle(canvasX, canvasY, brushSize / 2, '#ffffff', 1);
            } else {
                // Draw square brush using direct pixel manipulation
                drawSquare(canvasX, canvasY, brushSize, '#ffffff', 1);
            }
        } else {
            if (brushShape === 'circle') {
                // Draw circle eraser using direct pixel manipulation
                drawCircle(canvasX, canvasY, brushSize / 2, '#000000', 0);
            } else {
                // Draw square eraser using direct pixel manipulation
                drawSquare(canvasX, canvasY, brushSize, '#000000', 0);
            }
        }
    }
}

// Draw circle using direct pixel manipulation (like the inpainting editor)
function drawCircle(x, y, radius, color, alpha) {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    const roundedRadius = Math.round(radius);
    
    const startX = roundedX - roundedRadius;
    const startY = roundedY - roundedRadius;
    const size = 2 * roundedRadius + 1;
    
    const imageData = maskEditorCtx.getImageData(startX, startY, size, size);
    
    for (let i = 0; i <= roundedRadius; i++) {
        for (let j = 0; j <= roundedRadius; j++) {
            // Check if pixel is within circle using distance calculation
            const minDist = Math.min(
                Math.sqrt((j + 0.5) * (j + 0.5) + (i + 0.5) * (i + 0.5)),
                Math.sqrt((j - 0.5) * (j - 0.5) + (i - 0.5) * (i - 0.5))
            );
            
            if (minDist <= roundedRadius) {
                // Set pixels in all four quadrants
                const positions = [
                    (roundedRadius + j) * 4 + (roundedRadius + i) * size * 4,
                    (roundedRadius - j) * 4 + (roundedRadius + i) * size * 4,
                    (roundedRadius + j) * 4 + (roundedRadius - i) * size * 4,
                    (roundedRadius - j) * 4 + (roundedRadius - i) * size * 4
                ];
                
                positions.forEach(pos => {
                    if (pos >= 0 && pos < imageData.data.length) {
                        imageData.data[pos] = parseInt(color.slice(1, 3), 16);     // Red
                        imageData.data[pos + 1] = parseInt(color.slice(3, 5), 16); // Green
                        imageData.data[pos + 2] = parseInt(color.slice(5, 7), 16); // Blue
                        imageData.data[pos + 3] = 255 * alpha;                    // Alpha
                    }
                });
            }
        }
    }
    
    maskEditorCtx.putImageData(imageData, startX, startY);
}

// Draw square using direct pixel manipulation (like the inpainting editor)
function drawSquare(x, y, size, color, alpha) {
    const startX = x - Math.floor(size / 2);
    const startY = y - Math.floor(size / 2);
    const endX = startX + size;
    const endY = startY + size;
    
    const imageData = maskEditorCtx.getImageData(startX, startY, endX - startX, endY - startY);
    
    for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = parseInt(color.slice(1, 3), 16);     // Red
        imageData.data[i + 1] = parseInt(color.slice(3, 5), 16); // Green
        imageData.data[i + 2] = parseInt(color.slice(5, 7), 16); // Blue
        imageData.data[i + 3] = 255 * alpha;                    // Alpha
    }
    
    maskEditorCtx.putImageData(imageData, startX, startY);
}

// Stop drawing
function stopDrawing() {
    isDrawing = false;
    globalMouseDown = false;
}

// Update brush cursor position and size
function updateBrushCursor(e) {
    const brushCursor = document.querySelector('.brush-cursor');
    if (!brushCursor || !maskEditorCanvas) return;
    
    const rect = maskEditorCanvas.getBoundingClientRect();
    const containerRect = maskEditorCanvasInner.getBoundingClientRect();
    
    // Calculate the actual canvas content area (accounting for object-fit: contain)
    const visualScaleX = rect.width / maskEditorCanvas.width;
    const visualScaleY = rect.height / maskEditorCanvas.height;
    const visualScale = Math.min(visualScaleX, visualScaleY);
    
    // Calculate the actual canvas content dimensions
    const actualCanvasWidth = maskEditorCanvas.width * visualScale;
    const actualCanvasHeight = maskEditorCanvas.height * visualScale;
    
    // Calculate padding around the canvas content
    const paddingX = (rect.width - actualCanvasWidth) / 2;
    const paddingY = (rect.height - actualCanvasHeight) / 2;
    
    // Calculate position relative to the actual canvas content
    const x = e.clientX - rect.left - paddingX;
    const y = e.clientY - rect.top - paddingY;
    
    // Only show cursor if mouse is over the actual canvas content
    if (x >= 0 && x <= actualCanvasWidth && y >= 0 && y <= actualCanvasHeight) {
        brushCursor.style.display = 'block';
        
        // Calculate cursor size based on visual scale
        const cursorSize = brushSize * visualScale;
        
        // Position cursor relative to the actual canvas content
        brushCursor.style.left = (rect.left + paddingX + x - cursorSize / 2) + 'px';
        brushCursor.style.top = (rect.top + paddingY + y - cursorSize / 2) + 'px';
        brushCursor.style.width = cursorSize + 'px';
        brushCursor.style.height = cursorSize + 'px';
        
        // Update cursor shape
        if (brushShape === 'circle') {
            brushCursor.style.borderRadius = '50%';
        } else {
            brushCursor.style.borderRadius = '0';
        }
    } else {
        brushCursor.style.display = 'none';
    }
}

// Touch event handlers
function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    maskEditorCanvas.dispatchEvent(mouseEvent);
}

function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    maskEditorCanvas.dispatchEvent(mouseEvent);
}

function handleTouchEnd(e) {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    maskEditorCanvas.dispatchEvent(mouseEvent);
}

// Clear mask
function clearMask() {
    if (!maskEditorCtx) return;
    
    // Clear the entire canvas to transparent
    maskEditorCtx.clearRect(0, 0, maskEditorCanvas.width, maskEditorCanvas.height);
}

// Save mask (upscaled version for display)
function saveMask() {
    if (!maskEditorCanvas) return;
    
    try {
        // Get target dimensions for scaling up
        const targetWidth = maskEditorCanvas.targetWidth || maskEditorCanvas.width * 8;
        const targetHeight = maskEditorCanvas.targetHeight || maskEditorCanvas.height * 8;
        
        // Create a temporary canvas with the target resolution
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        
        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Disable image smoothing for nearest neighbor scaling
        tempCtx.imageSmoothingEnabled = false;
        
        // Draw the mask canvas scaled up to target resolution
        tempCtx.drawImage(maskEditorCanvas, 0, 0, maskEditorCanvas.width, maskEditorCanvas.height, 0, 0, targetWidth, targetHeight);
        
        // Binarize the image data to ensure crisp 1-bit mask
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            // If pixel is not black (has been drawn on), make it pure white
            if (r > 0 || g > 0 || b > 0) {
                data[i] = 255;     // Red
                data[i + 1] = 255; // Green
                data[i + 2] = 255; // Blue
                data[i + 3] = 255; // Alpha
            } else {
                // Black pixels (background) stay pure black
                data[i] = 0;       // Red
                data[i + 1] = 0;   // Green
                data[i + 2] = 0;   // Blue
                data[i + 3] = 255; // Alpha
            }
        }
        
        // Put the binarized image data back
        tempCtx.putImageData(imageData, 0, 0);
        
        // Convert to base64
        const base64Data = tempCanvas.toDataURL('image/png');
        
        // Store the mask data in a global variable
        window.currentMaskData = base64Data;
        
        // Also store the compressed version for server processing
        const compressedMask = saveMaskCompressed();
        if (compressedMask) {
            window.currentMaskCompressed = compressedMask;
        }
        
        // Set inpaint button to on
        if (inpaintBtn) {
            inpaintBtn.setAttribute('data-state', 'on');
            inpaintBtn.classList.add('active');
        }
        
        // Update vibe transfer UI state
        updateInpaintButtonState();
        
        showSuccess('Mask saved successfully!');
        closeMaskEditor();
    } catch (error) {
        console.error('Error saving mask:', error);
        showError('Failed to save mask');
    }
}

// Save unupscaled mask for server processing
function saveMaskCompressed() {
    if (!maskEditorCanvas) return null;
    
    // Check if canvas has valid dimensions
    if (maskEditorCanvas.width === 0 || maskEditorCanvas.height === 0) {
        console.warn('Mask editor canvas has invalid dimensions');
        return null;
    }
    
    try {
        // Create a temporary canvas with the original (unupscaled) dimensions
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        tempCanvas.width = maskEditorCanvas.width;
        tempCanvas.height = maskEditorCanvas.height;
        
        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Draw the mask canvas at original size
        tempCtx.drawImage(maskEditorCanvas, 0, 0);
        
        // Binarize the image data to ensure crisp 1-bit mask
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            // If pixel is not black (has been drawn on), make it pure white
            if (r > 0 || g > 0 || b > 0) {
                data[i] = 255;     // Red
                data[i + 1] = 255; // Green
                data[i + 2] = 255; // Blue
                data[i + 3] = 255; // Alpha
            } else {
                // Black pixels (background) stay pure black
                data[i] = 0;       // Red
                data[i + 1] = 0;   // Green
                data[i + 2] = 0;   // Blue
                data[i + 3] = 255; // Alpha
            }
        }
        
        // Put the binarized image data back
        tempCtx.putImageData(imageData, 0, 0);
        
        // Convert to base64 (without data URL prefix)
        const base64Data = tempCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');
        
        return base64Data;
    } catch (error) {
        console.error('Error saving compressed mask:', error);
        return null;
    }
}
// Helper: Set mask editor canvas from a data URL
function setMaskEditorFromDataUrl(dataUrl) {
    if (!dataUrl && window.maskEditorCanvas.width !== undefined) return;
    
    // Initialize mask editor if not already done
    if (!window.maskEditorCanvas || !window.maskEditorCtx) {
        if (typeof initializeMaskEditor === 'function') initializeMaskEditor();
    }
    
    const img = new Image();
    img.onload = function() {
        // Set canvas dimensions to match the image
        window.maskEditorCanvas.width = img.width;
        window.maskEditorCanvas.height = img.height;
        
        // Clear and draw the mask
        window.maskEditorCtx.clearRect(0, 0, img.width, img.height);
        window.maskEditorCtx.drawImage(img, 0, 0);
    };
    img.onerror = function() {
        console.error('Failed to load mask image for editor');
    };
    img.src = dataUrl;
}

// Helper function to convert standard mask to compressed format
async function convertStandardMaskToCompressed(standardMaskBase64, originalWidth, originalHeight) {
    return new Promise((resolve, reject) => {
        // Validate input parameters
        if (!standardMaskBase64 || !originalWidth || !originalHeight) {
            reject(new Error('Invalid parameters: standardMaskBase64, originalWidth, and originalHeight are required'));
            return;
        }
        
        if (originalWidth <= 0 || originalHeight <= 0) {
            reject(new Error(`Invalid original dimensions: ${originalWidth}x${originalHeight}`));
            return;
        }
        
        // Calculate compressed dimensions (1/8 scale)
        const compressedWidth = Math.floor(originalWidth / 8);
        const compressedHeight = Math.floor(originalHeight / 8);
        
        // Create a temporary canvas to process the standard mask
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        tempCanvas.width = compressedWidth;
        tempCanvas.height = compressedHeight;
        
        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Disable image smoothing for nearest neighbor scaling
        tempCtx.imageSmoothingEnabled = false;
        
        // Create image from standard mask
        const img = new Image();
        img.onload = function() {
            try {
                // Validate loaded image dimensions
                if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
                    reject(new Error(`Invalid loaded mask image dimensions: ${img.width}x${img.height}`));
                    return;
                }
                
                // Draw the standard mask scaled down to compressed size
                tempCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, compressedWidth, compressedHeight);
                
                // Binarize the image data to ensure crisp 1-bit mask
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];
                    
                    // If pixel is not black (has been drawn on), make it pure white
                    if (r > 0 || g > 0 || b > 0) {
                        data[i] = 255;     // Red
                        data[i + 1] = 255; // Green
                        data[i + 2] = 255; // Blue
                        data[i + 3] = 255; // Alpha
                    } else {
                        // Black pixels (background) stay pure black
                        data[i] = 0;       // Red
                        data[i + 1] = 0;   // Green
                        data[i + 2] = 0;   // Blue
                        data[i + 3] = 255; // Alpha
                    }
                }
                
                // Put the binarized image data back
                tempCtx.putImageData(imageData, 0, 0);
                
                // Convert to base64 (without data URL prefix)
                const compressedMaskBase64 = tempCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');
                
                // Resolve the promise
                resolve(compressedMaskBase64);
            } catch (error) {
                console.error('Error converting standard mask to compressed:', error);
                reject(error);
            }
        };
        
        img.onerror = function() {
            console.error('Failed to load standard mask image');
            reject(new Error('Failed to load standard mask image'));
        };
        
        img.src = "data:image/png;base64," + standardMaskBase64;
    });
}

// Helper function to process compressed mask to display resolution
function processCompressedMask(compressedMaskBase64, targetWidth, targetHeight, callback) {
    return new Promise((resolve, reject) => {
        // Validate input parameters
        if (!compressedMaskBase64 || !targetWidth || !targetHeight) {
            reject(new Error('Invalid parameters: compressedMaskBase64, targetWidth, and targetHeight are required'));
            return;
        }
        
        if (targetWidth <= 0 || targetHeight <= 0) {
            reject(new Error(`Invalid target dimensions: ${targetWidth}x${targetHeight}`));
            return;
        }
        
        // Create a temporary canvas to process the compressed mask
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        
        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Disable image smoothing for nearest neighbor scaling
        tempCtx.imageSmoothingEnabled = false;
        
        // Create image from compressed mask
        const img = new Image();
        img.onload = function() {
            try {
                // Validate loaded image dimensions
                if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
                    reject(new Error(`Invalid loaded mask image dimensions: ${img.width}x${img.height}`));
                    return;
                }
                
                // Draw the compressed mask scaled up to target resolution
                tempCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetWidth, targetHeight);
                
                // Binarize the image data to ensure crisp 1-bit mask
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];
                    
                    // If pixel is not black (has been drawn on), make it pure white
                    if (r > 0 || g > 0 || b > 0) {
                        data[i] = 255;     // Red
                        data[i + 1] = 255; // Green
                        data[i + 2] = 255; // Blue
                        data[i + 3] = 255; // Alpha
                    } else {
                        // Black pixels (background) stay pure black
                        data[i] = 0;       // Red
                        data[i + 1] = 0;   // Green
                        data[i + 2] = 0;   // Blue
                        data[i + 3] = 255; // Alpha
                    }
                }
                
                // Put the binarized image data back
                tempCtx.putImageData(imageData, 0, 0);
                
                // Convert to base64
                const base64Data = tempCanvas.toDataURL('image/png');
                
                // Call the callback with the processed mask if provided
                if (callback) {
                    callback(base64Data);
                }
                
                // Resolve the promise
                resolve(base64Data);
            } catch (error) {
                console.error('Error processing compressed mask:', error);
                reject(error);
            }
        };
        
        img.onerror = function() {
            console.error('Failed to load compressed mask image');
            reject(new Error('Failed to load compressed mask image'));
        };
        
        img.src = "data:image/png;base64," + compressedMaskBase64;
    });
}

// Delete mask
async function deleteMask() {
    // Clear the stored mask data
    window.currentMaskData = null;
    
    // Set inpaint button to off
    if (inpaintBtn) {
        inpaintBtn.setAttribute('data-state', 'off');
        inpaintBtn.classList.remove('active');
    }

    // Clear the canvas
    if (maskEditorCtx) {
        maskEditorCtx.clearRect(0, 0, maskEditorCanvas.width, maskEditorCanvas.height);
    }
    
    // For pipeline images, restore the original pipeline mask
    const isPipeline = window.currentEditMetadata && window.currentEditMetadata.request_type === 'pipeline';
    if (isPipeline && window.pipelineMaskData) {
        window.currentMaskData = window.pipelineMaskData + "";
    }
    window.currentMaskCompressed = null;
    
    // Update vibe transfer UI state
    updateInpaintButtonState();
    
    closeMaskEditor();
}

// Close mask editor
function closeMaskEditor() {
    const maskEditorDialog = document.getElementById('maskEditorDialog');
    if (maskEditorDialog) {
        maskEditorDialog.style.display = 'none';
    }
    
    // Reset drawing state
    isDrawing = false;
    globalMouseDown = false;
    
    // Remove global event listeners
    document.removeEventListener('mouseup', handleGlobalMouseUp);
    document.removeEventListener('mousemove', handleGlobalMouseMove);
    
    // Update inpaint button state and mask preview
    updateInpaintButtonState();
    updateMaskPreview();
}

// Open mask editor
function openMaskEditor() {
    console.log('openMaskEditor called');
    const maskEditorDialog = document.getElementById('maskEditorDialog');
    
    if (!maskEditorDialog) {
        console.error('maskEditorDialog not found');
        return;
    }
    
    // Initialize mask editor first if not already done
    if (!maskEditorCtx) {
        initializeMaskEditor();
    }
    
    // Get the source image dimensions
    const variationImage = document.getElementById('manualVariationImage');
    const isPipelineEdit = window.currentPipelineEdit && window.currentPipelineEdit.isPipelineEdit;
    
    // For pipeline editing, we don't need a variation image
    if (!isPipelineEdit && (!variationImage || !variationImage.src)) {
        showError('No source image available');
        return;
    }
    
    // Get the resolution from the form
    let resolutionValue = document.getElementById('manualResolution').value;
    
    // If resolution value is empty, try to get it from the dropdown display or use default
    if (!resolutionValue) {
        const resolutionSelected = document.getElementById('manualResolutionSelected');
        
        if (resolutionSelected && resolutionSelected.textContent !== 'Select resolution...') {
            // Try to find the resolution value from the display text
            resolutionValue = getResolutionFromDisplay(resolutionSelected.textContent);
        }
        
        // Default to normal portrait if no resolution is selected or found
        if (!resolutionValue) {
            resolutionValue = 'normal_portrait';
        }
        
        // Ensure the hidden input is also set for consistency
        const manualResolutionHidden = document.getElementById('manualResolution');
        if (manualResolutionHidden) {
            manualResolutionHidden.value = resolutionValue;
        }
    }
    
    let canvasWidth, canvasHeight;
    
    if (resolutionValue === 'custom') {
        // Use custom resolution values
        canvasWidth = parseInt(document.getElementById('manualWidth').value) || 512;
        canvasHeight = parseInt(document.getElementById('manualHeight').value) || 512;
    } else {
        // Use resolution map to get dimensions
        const dimensions = getDimensionsFromResolution(resolutionValue);
        canvasWidth = dimensions.width;
        canvasHeight = dimensions.height;
    }
    
    // Store target dimensions for saving
    const targetWidth = canvasWidth;
    const targetHeight = canvasHeight;
    
    // Calculate 8x smaller canvas dimensions for editing
    canvasWidth = Math.ceil(canvasWidth / 8);
    canvasHeight = Math.ceil(canvasHeight / 8);
    
    // Set canvas dimensions to the 8x smaller size
    maskEditorCanvas.width = canvasWidth;
    maskEditorCanvas.height = canvasHeight;
    
    // Calculate display scale to fit in the container (max 512px)
    const maxDisplaySize = 512;
    const scaleX = maxDisplaySize / canvasWidth;
    const scaleY = maxDisplaySize / canvasHeight;
    displayScale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
    
    // Set the canvas display size
    maskEditorCanvasInner.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
    
    // Set nearest neighbor scaling
    maskEditorCanvas.style.imageRendering = 'pixelated';
    maskEditorCanvas.style.imageRendering = '-moz-crisp-edges';
    maskEditorCanvas.style.imageRendering = 'crisp-edges';
    
    // Store target dimensions for saving
    maskEditorCanvas.targetWidth = targetWidth;
    maskEditorCanvas.targetHeight = targetHeight;
    
    // Calculate brush size based on canvas resolution (8x smaller canvas)
    const canvasDiagonal = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight);
    brushSize = Math.round(canvasDiagonal * brushSizePercent);
    
    // Ensure brush size is within bounds (1-15)
    brushSize = Math.max(1, Math.min(15, brushSize));
    
    // Update brush size input
    const brushSizeInput = document.getElementById('brushSize');
    if (brushSizeInput) {
        brushSizeInput.value = brushSize;
    }
    
    // Set the background image in the inner container with aspect ratio scaling
    const canvasInner = document.querySelector('.mask-editor-canvas-inner');
    if (canvasInner) {
        // Check if we have a placeholder image (current image for pipeline or regular image)
        if (window.uploadedImageData && window.uploadedImageData.isPlaceholder) {
            // Use the placeholder image as background
            const backgroundImageValue = `url(${window.uploadedImageData.image_source.replace('file:', '/images/')})`;
            canvasInner.style.setProperty('--background-image', backgroundImageValue);
            canvasInner.style.setProperty('--background-aspect-ratio', `${canvasWidth} / ${canvasHeight}`);
            canvasInner.style.setProperty('--background-size', 'contain');
            canvasInner.style.setProperty('--background-width', '100%');
            canvasInner.style.setProperty('--background-height', '100%');
        } else if (isPipelineEdit || !variationImage || !variationImage.src) {
            // For pipeline editing or when no variation image, create a black placeholder
            const placeholderCanvas = document.createElement('canvas');
            const placeholderCtx = placeholderCanvas.getContext('2d');
            placeholderCanvas.width = targetWidth;
            placeholderCanvas.height = targetHeight;
            
            // Fill with black
            placeholderCtx.fillStyle = '#000000';
            placeholderCtx.fillRect(0, 0, targetWidth, targetHeight);
            
            // Convert to data URL and store as placeholder
            window.uploadedImageData.image_source = placeholderCanvas.toDataURL('image/png');
            window.uploadedImageData.isPlaceholder = true;
            
            // Use the placeholder as background
            const backgroundImageValue = `url(${window.uploadedImageData.image_source})`;
            canvasInner.style.setProperty('--background-image', backgroundImageValue);
            canvasInner.style.setProperty('--background-aspect-ratio', `${canvasWidth} / ${canvasHeight}`);
            canvasInner.style.setProperty('--background-size', 'contain');
            canvasInner.style.setProperty('--background-width', '100%');
            canvasInner.style.setProperty('--background-height', '100%');
        } else {
            // Use the variation image as background with aspect ratio scaling
            const backgroundImageValue = `url(${variationImage.src})`;
            canvasInner.style.setProperty('--background-image', backgroundImageValue);
            canvasInner.style.setProperty('--background-aspect-ratio', `${canvasWidth} / ${canvasHeight}`);
            canvasInner.style.setProperty('--background-size', 'contain');
            canvasInner.style.setProperty('--background-width', '100%');
            canvasInner.style.setProperty('--background-height', '100%');
        }
    }
    
    // Initialize canvas with transparent background (black will be drawn as needed)
    maskEditorCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Load existing mask if available
    if (window.currentMaskData) {
        const maskImg = new Image();
        maskImg.onload = function() {
            // Create a temporary canvas to scale down the mask
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = canvasWidth;
            tempCanvas.height = canvasHeight;
            
            // Disable image smoothing for nearest neighbor scaling
            tempCtx.imageSmoothingEnabled = false;
            
            // Draw the mask image onto the temp canvas (scaled down)
            tempCtx.drawImage(maskImg, 0, 0, canvasWidth, canvasHeight);
            
            // Get the scaled down image data
            const imageData = tempCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // If pixel is pure black (0,0,0), make it transparent for editing
                if (r === 0 && g === 0 && b === 0) {
                    data[i + 3] = 0; // Set alpha to 0 (transparent)
                } else if (r > 0 || g > 0 || b > 0) {
                    // Any non-black pixel becomes white with full opacity
                    data[i] = 255;     // Red
                    data[i + 1] = 255; // Green
                    data[i + 2] = 255; // Blue
                    data[i + 3] = 255; // Alpha
                }
            }
            
            // Put the modified image data back to the main canvas
            maskEditorCtx.putImageData(imageData, 0, 0);
        };
        maskImg.src = window.currentMaskData;
    }
    
    // Show the dialog
    maskEditorDialog.style.display = 'block';
    
    // Add global event listeners for continuous drawing
    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('mousemove', handleGlobalMouseMove);
}

// Update inpaint button state
function updateInpaintButtonState() {
    const noiseValue = document.getElementById('manualNoiseValue');
    const strengthValue = document.getElementById('manualStrengthValue');
    
    if (inpaintBtn) {
        if (window.currentMaskData) {
            inpaintBtn.setAttribute('data-state', 'on');
            inpaintBtn.classList.add('active');
        } else {
            inpaintBtn.setAttribute('data-state', 'off');
            inpaintBtn.classList.remove('active');
        }
    }
    
    // Disable noise slider when mask is set
    if (noiseValue) {
        if (window.currentMaskData) {
            noiseValue.disabled = true;
            noiseValue.style.opacity = '0.5';
        } else {
            noiseValue.disabled = false;
            noiseValue.style.opacity = '1';
        }
    }

    // Disable vibe transfer section and tabs when inpainting is enabled
    const vibeReferencesSection = document.getElementById('vibeReferencesSection');
    const vibeReferencesTabBtn = document.querySelector('.cache-browser-tabs .tab-btn[data-tab="vibe-references"]');
    const vibeTabBtn = document.querySelector('.cache-manager-tabs .tab-btn[data-tab="vibe"]');
    
    if (window.currentMaskData) {
        // Disable vibe references section
        if (vibeReferencesSection) {
            vibeReferencesSection.style.opacity = '0.5';
            vibeReferencesSection.style.pointerEvents = 'none';
        }
        
        // Disable vibe references tab in cache browser
        if (vibeReferencesTabBtn) {
            vibeReferencesTabBtn.style.opacity = '0.5';
            vibeReferencesTabBtn.style.pointerEvents = 'none';
            vibeReferencesTabBtn.title = 'Vibe transfers disabled during inpainting';
        }
        
        // Disable vibe tab in cache manager
        if (vibeTabBtn) {
            vibeTabBtn.style.opacity = '0.5';
            vibeTabBtn.style.pointerEvents = 'none';
            vibeTabBtn.title = 'Vibe transfers disabled during inpainting';
        }
    } else {
        // Re-enable vibe references section
        if (vibeReferencesSection) {
            vibeReferencesSection.style.opacity = '1';
            vibeReferencesSection.style.pointerEvents = 'auto';
        }
        
        // Re-enable vibe references tab in cache browser
        if (vibeReferencesTabBtn) {
            vibeReferencesTabBtn.style.opacity = '1';
            vibeReferencesTabBtn.style.pointerEvents = 'auto';
            vibeReferencesTabBtn.title = '';
        }
        
        // Re-enable vibe tab in cache manager
        if (vibeTabBtn) {
            vibeTabBtn.style.opacity = '1';
            vibeTabBtn.style.pointerEvents = 'auto';
            vibeTabBtn.title = '';
        }
    }

    // Show inpaint button for pipeline images or when there's uploaded image data
    const shouldShowInpaint = window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.request_type === 'pipeline');    
    if (shouldShowInpaint) {
        if (inpaintBtn) {
            inpaintBtn.classList.remove('hidden');
        }
        // Set strength value based on mask presence
        if (strengthValue) {
            if (window.currentMaskData) {
                // Set strength to 1.0 when mask is set (unless it was loaded from a preset)
                if (strengthValue.textContent === '0.8') {
                    strengthValue.textContent = '1.0';
                }
            } else {
                // Set strength to 0.8 when no mask (unless it was loaded from a preset)
                if (strengthValue.textContent === '1.0') {
                    strengthValue.textContent = '0.8';
                }
            }
        }
    } else {
        if (inpaintBtn) {
            inpaintBtn.classList.add('hidden');
        }
    }
}

// Update mask preview overlay
async function updateMaskPreview() {
    const maskPreviewCanvas = document.getElementById('maskPreviewCanvas');
    const variationImage = document.getElementById('manualVariationImage');
    
    if (!maskPreviewCanvas || !variationImage) {
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }
    
    // Wait for the image to load and get valid dimensions
    let retryCount = 0;
    const maxRetries = 20; // Increased retries for slower loading
    
    while (retryCount < maxRetries) {
        // Check if image is loaded and has valid dimensions
        if (variationImage.complete && variationImage.naturalWidth > 0 && variationImage.naturalHeight > 0) {
            // Get the actual displayed dimensions
            const imageRect = variationImage.getBoundingClientRect();
            
            // Check if the displayed dimensions are valid and the image is visible
            if (imageRect.width > 0 && imageRect.height > 0 && 
                variationImage.style.display !== 'none' && 
                variationImage.style.visibility !== 'hidden') {
                break; // Valid dimensions found, proceed
            }
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 150)); // Slightly longer wait
        retryCount++;
    }
    
    if (retryCount >= maxRetries) {
        console.warn('Failed to get valid image dimensions after retries');
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }
    
    // Check if we have a compressed mask first
    let maskData = window.currentMaskData;
    if (window.currentMaskCompressed && !maskData) {
        // Get the current resolution for scaling
        let dims = null;
        if (manualHeight.value && manualWidth.value) {
            dims = { width: manualWidth.value, height: manualHeight.value };
        } else {
            const resolutionValue = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
            dims = getDimensionsFromResolution(resolutionValue);
        }

        if (dims && dims.width > 0 && dims.height > 0) {
            try {
                // Process the compressed mask to display resolution
                maskData = await processCompressedMask(window.currentMaskCompressed, dims.width, dims.height);
            } catch (error) {
                console.error('Error processing compressed mask:', error);
                // Fallback to regular mask if available
                maskData = window.currentMaskData;
            }
        } else {
            console.warn('Invalid dimensions for mask processing:', dims);
        }
    }
    
    if (!maskData) {
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }
    
    // Validate mask data format
    if (typeof maskData !== 'string' || !maskData.startsWith('data:image/')) {
        console.warn('Invalid mask data format:', typeof maskData, maskData ? maskData.substring(0, 50) + '...' : 'null');
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }
    
    // Get the actual displayed dimensions of the variation image
    const imageRect = variationImage.getBoundingClientRect();
    const containerRect = variationImage.closest('.variation-image-container').getBoundingClientRect();
    
    // Validate that we have valid dimensions
    if (imageRect.width <= 0 || imageRect.height <= 0) {
        console.warn('Invalid image dimensions for mask preview:', imageRect);
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }
    
    // Set canvas size to match the actual displayed image dimensions
    maskPreviewCanvas.width = imageRect.width;
    maskPreviewCanvas.height = imageRect.height;
    
    // Position the canvas to overlay the image exactly
    maskPreviewCanvas.style.position = 'absolute';
    maskPreviewCanvas.style.left = (imageRect.left - containerRect.left) + 'px';
    maskPreviewCanvas.style.top = (imageRect.top - containerRect.top) + 'px';
    maskPreviewCanvas.style.width = imageRect.width + 'px';
    maskPreviewCanvas.style.height = imageRect.height + 'px';
    
    const ctx = maskPreviewCanvas.getContext('2d');
    
    // Load the mask image
    const maskImg = new Image();
    maskImg.onload = function() {
        // Validate canvas dimensions before proceeding
        if (maskPreviewCanvas.width <= 0 || maskPreviewCanvas.height <= 0) {
            console.warn('Canvas dimensions are invalid for mask preview:', {
                width: maskPreviewCanvas.width,
                height: maskPreviewCanvas.height
            });
            return;
        }
        
        // Clear the canvas first
        ctx.clearRect(0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);
        
        // Draw the mask image onto the preview canvas, maintaining aspect ratio
        ctx.drawImage(maskImg, 0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);
        
        // Get image data to modify colors
        const imageData = ctx.getImageData(0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // If pixel is white (masked area), make it green overlay
            if (r === 255 && g === 255 && b === 255) {
                data[i] = 149;     // Red
                data[i + 1] = 254;   // Green
                data[i + 2] = 108;   // Blue
                data[i + 3] = 200; // Semi-transparent
            } else {
                // Make black areas transparent
                data[i + 3] = 0;
            }
        }
        
        // Put the modified image data back
        ctx.putImageData(imageData, 0, 0);
        
        // Show the preview canvas
        maskPreviewCanvas.style.display = 'block';
    };
    maskImg.src = maskData;
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

// Reference Browser Functions
let cacheImages = [];
let cacheCurrentPage = 1;
let cacheImagesPerPage = 20;

// Vibe References Functions
let vibeReferences = [];
let vibeReferencesGallery = null;

async function showCacheBrowser() {
    // Check if we're on desktop (manual modal is split)
    const manualModal = document.getElementById('manualModal');
    const isDesktop = manualModal && window.innerWidth >= 1400;
    
    if (isDesktop) {
        // Show as container in preview section
        const cacheBrowserContainer = document.getElementById('cacheBrowserContainer');
        const cacheBrowserLoadingContainer = document.getElementById('cacheBrowserLoadingContainer');
        const cacheGalleryContainer = document.getElementById('cacheGalleryContainer');
        const previewSection = document.getElementById('manualPanelSection');
        
        if (!cacheBrowserContainer || !cacheBrowserLoadingContainer || !cacheGalleryContainer || !previewSection) return;
        
        // Set active panel to cache browser
        previewSection.setAttribute('data-active-panel', 'cache-browser');
        cacheBrowserLoadingContainer.style.display = 'flex';
        cacheGalleryContainer.innerHTML = '';
        
        try {
            await loadCacheImages();
            await loadVibeReferences();
            displayCacheImagesContainer();
            displayVibeReferencesContainer();
        } catch (error) {
            console.error('Error loading cache images:', error);
            showError('Failed to load cache images');
        } finally {
            cacheBrowserLoadingContainer.style.display = 'none';
        }
    } else {
        // Show as modal (mobile/tablet)
        const cacheBrowserModal = document.getElementById('cacheBrowserModal');
        const cacheBrowserLoading = document.getElementById('cacheBrowserLoading');
        
        if (!cacheBrowserModal || !cacheBrowserLoading || !cacheGallery) return;
        
        cacheBrowserModal.style.display = 'block';
        cacheBrowserLoading.style.display = 'flex';
        cacheGallery.innerHTML = '';
        
        try {
            await loadCacheImages();
            await loadVibeReferences();
            displayCacheImages();
            displayVibeReferences();
        } catch (error) {
            console.error('Error loading cache images:', error);
            showError('Failed to load cache images');
        } finally {
            cacheBrowserLoading.style.display = 'none';
        }
    }
}

function hideCacheBrowser() {
    // Hide both modal and container versions
    const cacheBrowserModal = document.getElementById('cacheBrowserModal');
    const cacheBrowserContainer = document.getElementById('cacheBrowserContainer');
    const previewSection = document.getElementById('manualPanelSection');
    
    if (cacheBrowserModal) {
        cacheBrowserModal.style.display = 'none';
    }
    
    if (cacheBrowserContainer) {
        cacheBrowserContainer.style.display = 'none';
    }
    
    // Clear active panel to show manual preview
    if (previewSection) {
        previewSection.removeAttribute('data-active-panel');
    }
}

async function loadCacheImages() {
    try {
        const response = await fetchWithAuth('/references', {
            method: 'OPTIONS'
        });
        if (response.ok) {
            cacheImages = await response.json();
            console.log('Loaded cache images:', cacheImages.length, 'items');
            if (cacheImages.length > 0) {
                console.log('Sample cache image:', cacheImages[0]);
            }
        } else {
            throw new Error(`Failed to load cache: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error loading cache images:', error);
        throw error;
    }
}

function displayCacheImages() {
    // Get the references tab gallery (modal version)
    const referencesTab = document.getElementById('references-tab');
    const cacheGallery = referencesTab ? referencesTab.querySelector('#cacheGallery') : null;
    
    if (!cacheGallery) return;
    
    cacheGallery.innerHTML = '';
    
    if (cacheImages.length === 0) {
        cacheGallery.innerHTML = '<div class="no-images">No cache images found</div>';
        return;
    }
    
    // Separate default workspace items from current workspace items
    const currentWorkspaceItems = [];
    const defaultWorkspaceItems = [];
    
    cacheImages.forEach(cacheImage => {
        if (cacheImage.workspaceId === 'default') {
            defaultWorkspaceItems.push(cacheImage);
        } else {
            currentWorkspaceItems.push(cacheImage);
        }
    });
    
    console.log('Cache images sorting:', {
        total: cacheImages.length,
        currentWorkspace: currentWorkspaceItems.length,
        defaultWorkspace: defaultWorkspaceItems.length
    });
    
    // Display current workspace items first, then default workspace items
    currentWorkspaceItems.forEach(cacheImage => {
        const galleryItem = createCacheGalleryItem(cacheImage);
        cacheGallery.appendChild(galleryItem);
    });
    
    defaultWorkspaceItems.forEach(cacheImage => {
        const galleryItem = createCacheGalleryItem(cacheImage);
        cacheGallery.appendChild(galleryItem);
    });
    
    // Add few-items class if there are 3 or fewer items
    if (cacheImages.length <= 3) {
        cacheGallery.classList.add('few-items');
    } else {
        cacheGallery.classList.remove('few-items');
    }
}

function displayCacheImagesContainer() {
    const cacheGalleryContainer = document.getElementById('cacheGalleryContainer');
    if (!cacheGalleryContainer) return;
    
    cacheGalleryContainer.innerHTML = '';
    
    if (cacheImages.length === 0) {
        cacheGalleryContainer.innerHTML = '<div class="no-images">No cache images found</div>';
        return;
    }
    
    // Separate default workspace items from current workspace items
    const currentWorkspaceItems = [];
    const defaultWorkspaceItems = [];
    
    cacheImages.forEach(cacheImage => {
        if (cacheImage.workspaceId === 'default') {
            defaultWorkspaceItems.push(cacheImage);
        } else {
            currentWorkspaceItems.push(cacheImage);
        }
    });
    
    // Display current workspace items first, then default workspace items
    currentWorkspaceItems.forEach(cacheImage => {
        const galleryItem = createCacheGalleryItem(cacheImage);
        cacheGalleryContainer.appendChild(galleryItem);
    });
    
    defaultWorkspaceItems.forEach(cacheImage => {
        const galleryItem = createCacheGalleryItem(cacheImage);
        cacheGalleryContainer.appendChild(galleryItem);
    });
    
    // Add few-items class if there are 3 or fewer items
    if (cacheImages.length <= 3) {
        cacheGalleryContainer.classList.add('few-items');
    } else {
        cacheGalleryContainer.classList.remove('few-items');
    }
}

function displayVibeReferencesContainer() {
    const vibeReferencesGalleryContainer = document.getElementById('vibeReferencesGalleryContainer');
    if (!vibeReferencesGalleryContainer) return;
    
    vibeReferencesGalleryContainer.innerHTML = '';
    
    if (vibeReferences.length === 0) {
        vibeReferencesGalleryContainer.innerHTML = '<div class="no-images">No vibe references found</div>';
        return;
    }
    
    // Separate default workspace items from current workspace items
    const currentWorkspaceItems = [];
    const defaultWorkspaceItems = [];
    
    vibeReferences.forEach(vibeRef => {
        if (vibeRef.workspaceId === 'default') {
            defaultWorkspaceItems.push(vibeRef);
        } else {
            currentWorkspaceItems.push(vibeRef);
        }
    });
    
    // Display current workspace items first, then default workspace items
    currentWorkspaceItems.forEach(vibeRef => {
        const galleryItem = createVibeReferenceGalleryItem(vibeRef);
        vibeReferencesGalleryContainer.appendChild(galleryItem);
    });
    
    defaultWorkspaceItems.forEach(vibeRef => {
        const galleryItem = createVibeReferenceGalleryItem(vibeRef);
        vibeReferencesGalleryContainer.appendChild(galleryItem);
    });
    
    // Add few-items class if there are 3 or fewer items
    if (vibeReferences.length <= 3) {
        vibeReferencesGalleryContainer.classList.add('few-items');
    } else {
        vibeReferencesGalleryContainer.classList.remove('few-items');
    }
}

function createCacheGalleryItem(cacheImage) {
    const item = document.createElement('div');
    item.className = 'cache-gallery-item';
    
    // Create image element
    const img = document.createElement('img');
    if (cacheImage.hasPreview) {
        img.src = `/cache/preview/${cacheImage.hash}.webp`;
    } else {
        img.src = `/cache/${cacheImage.hash}`;
    }
    img.alt = `Reference image ${cacheImage.hash}`;
    img.loading = 'lazy';
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'cache-gallery-item-overlay';
    
    // Create info
    const info = document.createElement('div');
    info.className = 'cache-gallery-item-info';
    
    const dateTime = new Date(cacheImage.mtime).toLocaleString();
    const fileSize = formatFileSize(cacheImage.size);
    
    info.innerHTML = `
        <div>${cacheImage.hash.substring(0, 8)}...</div>
        <div>${dateTime}</div>
        <div>${fileSize}</div>
    `;
    
    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cache-gallery-item-buttons';
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'cache-delete-btn';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCacheImage(cacheImage);
    });
    
    buttonsContainer.appendChild(deleteBtn);
    
    overlay.appendChild(info);
    overlay.appendChild(buttonsContainer);
    
    item.appendChild(img);
    item.appendChild(overlay);
    
    // Add default workspace badge if this is a default workspace item
    if (cacheImage.workspaceId === 'default') {
        const badge = document.createElement('div');
        badge.className = 'default-workspace-badge';
        badge.textContent = 'Default';
        badge.style.background = '#444';
        badge.style.color = '#fff';
        badge.style.fontWeight = 'bold';
        badge.style.padding = '2px 8px';
        badge.style.borderRadius = '6px';
        badge.style.marginTop = '8px';
        badge.style.marginBottom = '4px';
        badge.style.display = 'inline-block';
        badge.style.fontSize = '0.8rem';
        item.appendChild(badge);
    }
    
    // Click to select image
    item.addEventListener('click', () => {
        selectCacheImage(cacheImage);
    });
    
    return item;
}

// Vibe References Functions
async function loadVibeReferences() {
    try {
        const response = await fetchWithAuth('/vibe/images', {
            method: 'GET'
        });
        if (response.ok) {
            vibeReferences = await response.json();
        } else {
            throw new Error(`Failed to load vibe references: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error loading vibe references:', error);
        throw error;
    }
}

function displayVibeReferences() {
    // Get the vibe references tab gallery (modal version)
    const vibeReferencesTab = document.getElementById('vibe-references-tab');
    const vibeReferencesGallery = vibeReferencesTab ? vibeReferencesTab.querySelector('#vibeReferencesGallery') : null;
    
    if (!vibeReferencesGallery) return;
    
    vibeReferencesGallery.innerHTML = '';
    
    if (vibeReferences.length === 0) {
        vibeReferencesGallery.innerHTML = '<div class="no-images">No vibe references found</div>';
        return;
    }
    
    // Separate default workspace items from current workspace items
    const currentWorkspaceItems = [];
    const defaultWorkspaceItems = [];
    
    vibeReferences.forEach(vibeRef => {
        if (vibeRef.workspaceId === 'default') {
            defaultWorkspaceItems.push(vibeRef);
        } else {
            currentWorkspaceItems.push(vibeRef);
        }
    });
    
    // Display current workspace items first, then default workspace items
    currentWorkspaceItems.forEach(vibeRef => {
        const galleryItem = createVibeReferenceGalleryItem(vibeRef);
        vibeReferencesGallery.appendChild(galleryItem);
    });
    
    defaultWorkspaceItems.forEach(vibeRef => {
        const galleryItem = createVibeReferenceGalleryItem(vibeRef);
        vibeReferencesGallery.appendChild(galleryItem);
    });
    
    // Add few-items class if there are 3 or fewer items
    if (vibeReferences.length <= 3) {
        vibeReferencesGallery.classList.add('few-items');
    } else {
        vibeReferencesGallery.classList.remove('few-items');
    }
}

function createVibeReferenceGalleryItem(vibeRef) {
    const item = document.createElement('div');
    item.className = 'cache-gallery-item';
    
    // Get current model
    const currentModel = manualSelectedModel || manualModelHidden?.value || '';
    
    // Check if this vibe has encodings for the current model
    const hasCurrentModelEncodings = vibeRef.encodings && vibeRef.encodings.some(encoding => 
        encoding.model.toLowerCase() === currentModel.toLowerCase()
    );
    
    // Add disabled class if no encodings for current model
    if (!hasCurrentModelEncodings) {
        item.classList.add('disabled');
    }
    
    // Create image element
    const img = document.createElement('img');
    if (vibeRef.preview) {
        img.src = `/cache/preview/${vibeRef.preview}`;
    } else if (vibeRef.type === 'base64' && vibeRef.source) {
        img.src = `data:image/png;base64,${vibeRef.source}`;
    } else {
        // Fallback to a placeholder
        img.src = '/images/placeholder.png';
    }
    img.alt = `Vibe reference ${vibeRef.id}`;
    img.loading = 'lazy';
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'cache-gallery-item-overlay';
    
    // Create info
    const info = document.createElement('div');
    info.className = 'cache-gallery-item-info';
    
    const encodingsCount = vibeRef.encodings ? vibeRef.encodings.length : 0;
    const currentModelEncodingsCount = vibeRef.encodings ? 
        vibeRef.encodings.filter(encoding => encoding.model.toLowerCase() === currentModel.toLowerCase()).length : 0;
    
    info.innerHTML = `
        <div>${vibeRef.id}</div>
        <div>${currentModelEncodingsCount}/${encodingsCount} encoding(s) for ${currentModel}</div>
    `;
    
    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cache-gallery-item-buttons';
    
    // Create select button
    const selectBtn = document.createElement('button');
    selectBtn.className = 'cache-delete-btn';
    selectBtn.innerHTML = '<i class="nai-vibe-transfer"></i>';
    selectBtn.title = hasCurrentModelEncodings ? 'Select vibe reference' : 'No encodings for current model';
    selectBtn.disabled = !hasCurrentModelEncodings;
    selectBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (hasCurrentModelEncodings) {
            await selectVibeReference(vibeRef);
        }
    });
    
    buttonsContainer.appendChild(selectBtn);
    
    overlay.appendChild(info);
    overlay.appendChild(buttonsContainer);
    
    item.appendChild(img);
    item.appendChild(overlay);
    
    // Add default workspace badge if this is a default workspace item
    if (vibeRef.workspaceId === 'default') {
        const badge = document.createElement('div');
        badge.className = 'default-workspace-badge';
        badge.textContent = 'Default';
        badge.style.background = '#444';
        badge.style.color = '#fff';
        badge.style.fontWeight = 'bold';
        badge.style.padding = '2px 8px';
        badge.style.borderRadius = '6px';
        badge.style.marginTop = '8px';
        badge.style.marginBottom = '4px';
        badge.style.display = 'inline-block';
        badge.style.fontSize = '0.8rem';
        item.appendChild(badge);
    }
    
    // Click to select vibe reference (only if enabled)
    item.addEventListener('click', async () => {
        if (hasCurrentModelEncodings) {
            await selectVibeReference(vibeRef);
        }
    });
    
    return item;
}

async function selectVibeReference(vibeRef) {
    // Add to vibe references container
    await addVibeReferenceToContainer(vibeRef.id);
    
    // Close cache browser
    hideCacheBrowser();
    
    showSuccess('Vibe reference selected successfully');
}

function createVibeReferenceItem(vibeRef) {
    const item = document.createElement('div');
    item.className = 'vibe-reference-item';
    item.setAttribute('data-vibe-id', vibeRef.id);
    
    // Create preview image
    const preview = document.createElement('img');
    preview.className = 'vibe-reference-preview';
    if (vibeRef.preview) {
        preview.src = `/cache/preview/${vibeRef.preview}`;
    } else if (vibeRef.type === 'base64' && vibeRef.source) {
        preview.src = `data:image/png;base64,${vibeRef.source}`;
    } else {
        // Fallback to a placeholder
        preview.src = '/images/placeholder.png';
    }
    preview.alt = `Vibe reference ${vibeRef.id}`;
    
    // Create controls
    const controls = document.createElement('div');
    controls.className = 'vibe-reference-controls';
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'vibe-reference-delete-btn';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Remove vibe reference';
    deleteBtn.addEventListener('click', () => {
        removeVibeReference(vibeRef.id);
    });
    
    controls.appendChild(deleteBtn);
    
    // Create info section
    const info = document.createElement('div');
    info.className = 'vibe-reference-info';
    
    // IE Control
    const ieControl = document.createElement('div');
    ieControl.className = 'vibe-reference-ie-control';
    
    // Create custom dropdown for IE values
    const ieDropdown = document.createElement('div');
    ieDropdown.className = 'custom-dropdown dropup';
    
    const ieDropdownBtn = document.createElement('button');
    ieDropdownBtn.type = 'button';
    ieDropdownBtn.className = 'custom-dropdown-btn hover-show colored';

    const ieIcon = document.createElement('i');
    ieIcon.className = 'nai-vibe-transfer';
    ieDropdownBtn.appendChild(ieIcon);

    const ieText = document.createElement('span');
    
    // Get current model
    const currentModel = manualSelectedModel || manualModelHidden?.value || '';
    
    // Get available encodings for this vibe (filtered by current model)
    const availableEncodings = vibeRef.encodings ? 
        vibeRef.encodings.filter(encoding => encoding.model.toLowerCase() === currentModel.toLowerCase()) : [];
    
    if (availableEncodings.length > 0) {
        // Use the first encoding as default
        const defaultEncoding = availableEncodings[0];
        ieText.textContent = `${defaultEncoding.informationExtraction}`;
        ieDropdownBtn.dataset.selectedModel = defaultEncoding.model;
        ieDropdownBtn.dataset.selectedIe = defaultEncoding.informationExtraction;
    } else {
        ieText.textContent = 'No encodings';
        ieDropdownBtn.disabled = true;
    }
    ieDropdownBtn.appendChild(ieText);
    
    const ieDropdownMenu = document.createElement('div');
    ieDropdownMenu.className = 'custom-dropdown-menu';
    ieDropdownMenu.style.display = 'none';
    
    // Add encoding options (only for current model)
    availableEncodings.forEach(encoding => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.textContent = `${encoding.informationExtraction}`;
        option.dataset.model = encoding.model;
        option.dataset.ie = encoding.informationExtraction;
        
        option.addEventListener('click', () => {
            ieDropdownBtn.textContent = `${encoding.informationExtraction}`;
            ieDropdownBtn.dataset.selectedModel = encoding.model;
            ieDropdownBtn.dataset.selectedIe = encoding.informationExtraction;
            ieDropdownMenu.style.display = 'none';
        });
        
        ieDropdownMenu.appendChild(option);
    });
    
    // Add dropdown toggle functionality
    ieDropdownBtn.addEventListener('click', () => {
        if (ieDropdownMenu.style.display === 'none') {
            ieDropdownMenu.style.display = 'block';
        } else {
            ieDropdownMenu.style.display = 'none';
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!ieDropdown.contains(e.target)) {
            ieDropdownMenu.style.display = 'none';
        }
    });
    
    ieDropdown.appendChild(ieDropdownBtn);
    ieDropdown.appendChild(ieDropdownMenu);
    ieControl.appendChild(ieDropdown);
    
    // Ratio Control
    const ratioControl = document.createElement('div');
    ratioControl.className = 'vibe-reference-ratio-control';
    
    const ratioInput = document.createElement('input');
    ratioInput.type = 'number';
    ratioInput.className = 'vibe-reference-ratio-input hover-show right colored';
    ratioInput.min = '0.0';
    ratioInput.max = '1.0';
    ratioInput.step = '0.01';
    ratioInput.value = '0.7';
    
    // Add wheel event for scrolling
    ratioInput.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.01 : 0.01;
        const newValue = Math.max(0, Math.min(1, parseFloat(this.value) + delta));
        this.value = newValue.toFixed(2);
    });
    
    ratioControl.appendChild(ratioInput);
    
    info.appendChild(ieControl);
    info.appendChild(ratioControl);
    
    item.appendChild(preview);
    item.appendChild(controls);
    item.appendChild(info);
    
    return item;
}

async function addVibeReferenceToContainer(vibeId, selectedIe, strength) {
    // Check if inpainting is enabled (mask is present)
    if (window.currentMaskData) {
        console.warn('Cannot add vibe references during inpainting');
        showError('Vibe transfers are disabled during inpainting');
        return;
    }
    
    // Find the vibe reference in the global vibeReferences array
    let vibeRef = vibeReferences.find(ref => ref.id === vibeId);
    if (!vibeRef) {
        // Try to load vibe references if not found
        if (vibeReferences.length === 0) {
            try {
                await loadVibeReferences();
                vibeRef = vibeReferences.find(ref => ref.id === vibeId);
            } catch (error) {
                console.error('Failed to load vibe references:', error);
            }
        }
        
        if (!vibeRef) {
            console.error(`Vibe reference with ID ${vibeId} not found`);
            return;
        }
    }
    
    const container = document.getElementById('vibeReferencesContainer');
    if (!container) return;
    
    // Check if already exists
    const existingItem = container.querySelector(`[data-vibe-id="${vibeId}"]`);
    if (existingItem) {
        console.warn(`Vibe reference ${vibeId} already exists in container`);
        return;
    }
    
    const item = createVibeReferenceItem(vibeRef);
    
    // Set the specific IE and strength values
    const ieDropdownBtn = item.querySelector('.custom-dropdown-btn');
    const ratioInput = item.querySelector('.vibe-reference-ratio-input');
    
    if (ieDropdownBtn && selectedIe) {
        // Find the encoding with the specified IE
        const encoding = vibeRef.encodings?.find(enc => enc.informationExtraction === selectedIe);
        if (encoding) {
            ieDropdownBtn.textContent = `${encoding.informationExtraction}`;
            ieDropdownBtn.dataset.selectedModel = encoding.model;
            ieDropdownBtn.dataset.selectedIe = encoding.informationExtraction;
        }
    }
    
    if (ratioInput && strength !== undefined) {
        ratioInput.value = strength.toString();
    }
    
    container.appendChild(item);
    
    // Show the section
    const section = document.getElementById('vibeReferencesSection');
    if (section) {
        section.style.display = '';
    }
}

function removeVibeReference(vibeId) {
    const container = document.getElementById('vibeReferencesContainer');
    if (!container) return;
    
    const item = container.querySelector(`[data-vibe-id="${vibeId}"]`);
    if (item) {
        item.remove();
        
        // Hide section if no more items
        const remainingItems = container.querySelectorAll('.vibe-reference-item');
        if (remainingItems.length === 0) {
            const section = document.getElementById('vibeReferencesSection');
            if (section) {
                section.style.display = 'none';
            }
        }
    }
}

function refreshVibeReferences() {
    // Refresh vibe references in the gallery (both modal and container versions)
    if (vibeReferences && vibeReferences.length > 0) {
        displayVibeReferences();
        displayVibeReferencesContainer();
    }
}

// Cache Browser Tab Functions
function switchCacheBrowserTab(tabName) {
    // Update tab buttons (both modal and container versions)
    const tabButtons = document.querySelectorAll('.cache-browser-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        }
    });
    
    // Update tab panes (modal version)
    const modalTabPanes = document.querySelectorAll('#cacheBrowserModal .cache-browser-body .tab-pane');
    modalTabPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === `${tabName}-tab`) {
            pane.classList.add('active');
        }
    });
    
    // Update tab panes (container version)
    const containerTabPanes = document.querySelectorAll('#cacheBrowserContainer .cache-browser-body .tab-pane');
    containerTabPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === `${tabName}-tab-container`) {
            pane.classList.add('active');
        }
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function selectCacheImage(cacheImage) {
    try {
        // Check if there's an existing mask
        const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;
        
        if (hasExistingMask) {
            // Store the pending cache image selection and show alert modal
            window.pendingCacheImageSelection = { cacheImage };
            showBaseImageChangeAlertModal();
            return;
        }
        
        // No mask exists, proceed with cache image selection
        await selectCacheImageInternal(cacheImage);
        
    } catch (error) {
        console.error('Error selecting cache image:', error);
        showError('Failed to select cache image');
    }
}

// Internal function to handle the actual cache image selection
async function selectCacheImageInternal(cacheImage) {
    try {
        // Set the uploaded image data
        window.uploadedImageData = {
            image_source: `cache:${cacheImage.hash}`,
            width: 512, // Default, will be updated when image loads
            height: 512,
            bias: 2, // Reset bias to center (2)
            isBiasMode: true,
            isClientSide: 2
        };
        

        // Show transformation section content
        const transformationSection = document.getElementById('transformationSection');
        if (transformationSection) {
            transformationSection.classList.add('display-image');
        }
        
        // Update image bias - reset to center (2)
        if (imageBiasHidden != null) imageBiasHidden.value = '2';
        renderImageBiasDropdown('2');
        
        // Set transformation type to browse (successful)
        updateTransformationDropdownState('browse', 'Upload');
        
        // Update mask preview and button visibility
        updateUploadDeleteButtonVisibility();
        updateInpaintButtonState();
        
        // Crop and update preview
        await cropImageToResolution();
        
        // Close cache browser
        hideCacheBrowser();
        
        showSuccess('Reference image selected successfully');
        
    } catch (error) {
        console.error('Error selecting cache image:', error);
        showError('Failed to select cache image');
    }
}

async function deleteCacheImage(cacheImage) {
    if (!confirm(`Are you sure you want to delete this cache image?`)) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`/cache/${cacheImage.hash}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Remove from local array
            cacheImages = cacheImages.filter(img => img.hash !== cacheImage.hash);
            
            // Refresh both displays
            displayCacheImages();
            displayCacheImagesContainer();
            
            showSuccess('Reference image deleted successfully');
        } else {
            throw new Error(`Failed to delete cache image: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error deleting cache image:', error);
        showError('Failed to delete cache image');
    }
}

// Image Bias Adjustment Modal Functions
let imageBiasAdjustmentData = {
    originalImage: null,
    targetDimensions: null,
    currentBias: { x: 0, y: 0, scale: 1.0, rotate: 0 },
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    originalTransform: { x: 0, y: 0 },
    previewMode: 'css' // Default to CSS view
};

// Show image bias adjustment modal
async function showImageBiasAdjustmentModal() {
    if (!window.uploadedImageData) {
        showError('No base image available for adjustment');
        return;
    }

    const modal = document.getElementById('imageBiasAdjustmentModal');
    if (!modal) return;

    // Get target dimensions
    const resolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
    const targetDims = getDimensionsFromResolution(resolution);
    if (!targetDims) {
        showError('Invalid resolution for bias adjustment');
        return;
    }

    // Get original image data
    let imageDataUrl = window.uploadedImageData.originalDataUrl;
    if (!imageDataUrl) {
        // Fetch the image based on the image source
        const imageSource = window.uploadedImageData.image_source;
        if (imageSource.startsWith('data:')) {
            imageDataUrl = imageSource;
        } else {
            let imageUrl = null;
            if (imageSource.startsWith('file:')) {
                imageUrl = `/images/${imageSource.replace('file:', '')}`;
            } else if (imageSource.startsWith('cache:')) {
                imageUrl = `/cache/preview/${imageSource.replace('cache:', '')}.webp`;
            }
            if (imageUrl) {
                const response = await fetch(imageUrl);
                const blob = await response.blob();
                imageDataUrl = URL.createObjectURL(blob);
            }
        }
    }

    if (!imageDataUrl) {
        showError('Could not load image for adjustment');
        return;
    }

    // Load original image to get dimensions
    const originalImage = new Image();
    originalImage.onload = function() {
        imageBiasAdjustmentData.originalImage = originalImage;
        imageBiasAdjustmentData.targetDimensions = targetDims;
        
        // Initialize bias values from current bias setting
        // Check if we have existing bias data from the uploaded image data
        if (window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object') {
            // Use existing bias values from uploaded image data
            imageBiasAdjustmentData.currentBias = { ...window.uploadedImageData.image_bias };
        } else if (imageBiasAdjustmentData.currentBias && typeof imageBiasAdjustmentData.currentBias === 'object' && 
                   (imageBiasAdjustmentData.currentBias.x !== 0 || imageBiasAdjustmentData.currentBias.y !== 0 || 
                    imageBiasAdjustmentData.currentBias.scale !== 1.0 || imageBiasAdjustmentData.currentBias.rotate !== 0)) {
            // Use existing bias values from previous adjustment (only if they're not default values)
            // currentBias is already set from the uploaded image data
        } else {
            // Fall back to legacy bias system or default values
            const currentBias = window.uploadedImageData.bias || 2;
            const biasFractions = [0, 0.25, 0.5, 0.75, 1];
            const biasFrac = biasFractions[currentBias] || 0.5;
            
            // Calculate initial position based on current bias
            // For the new system, we'll start with centered position and let user adjust
            imageBiasAdjustmentData.currentBias = {
                x: 0,
                y: 0,
                scale: 1.0,
                rotate: 0
            };
        }
        
        // Show modal first
        modal.style.display = 'flex';
        
        // Update UI after modal is visible (so we can get proper container dimensions)
        setTimeout(() => {
            updateBiasAdjustmentUI();
            updateBiasAdjustmentImage();
        }, 100);
    };
    originalImage.src = imageDataUrl;
}

// Update bias adjustment UI controls
function updateBiasAdjustmentUI() {
    const { x, y, scale, rotate } = imageBiasAdjustmentData.currentBias;
    
    document.getElementById('biasX').value = x;
    document.getElementById('biasY').value = y;
    document.getElementById('biasScale').value = scale;
    document.getElementById('biasRotate').value = rotate;
}

// Update bias adjustment image display
function updateBiasAdjustmentImage() {
    const image = document.getElementById('biasAdjustmentImage');
    const wrapper = document.getElementById('biasAdjustmentImageWrapper');
    const targetOverlay = document.getElementById('targetAreaOverlay');
    const targetBorder = targetOverlay.querySelector('.target-area-border');
    
    if (!imageBiasAdjustmentData.originalImage || !imageBiasAdjustmentData.targetDimensions) return;
    
    const { originalImage, targetDimensions, currentBias } = imageBiasAdjustmentData;
    
    // Set image source
    image.src = originalImage.src;
    
    // Calculate display dimensions - use the actual container size with padding accounted for
    const container = document.getElementById('imagePreviewContainer');
    const containerRect = container.getBoundingClientRect();
    const padding = 32; // 2em = 32px (assuming 1em = 16px)
    const containerWidth = containerRect.width - (padding * 2);
    const containerHeight = containerRect.height - (padding * 2);
    
    // Calculate target area size in display units
    const targetAR = targetDimensions.width / targetDimensions.height;
    let targetDisplayWidth, targetDisplayHeight;
    
    if (targetAR > containerWidth / containerHeight) {
        targetDisplayWidth = containerWidth;
        targetDisplayHeight = containerWidth / targetAR;
    } else {
        targetDisplayHeight = containerHeight;
        targetDisplayWidth = containerHeight * targetAR;
    }
    
    // Set target area border size
    targetBorder.style.width = `${targetDisplayWidth}px`;
    targetBorder.style.height = `${targetDisplayHeight}px`;
    
    // Calculate scale factor to make image fill target area at scale 1.0
    const imageAR = originalImage.width / originalImage.height;
    let imageDisplayWidth, imageDisplayHeight;
    
    if (imageAR > targetAR) {
        // Image is wider than target, scale to match target height
        imageDisplayHeight = targetDisplayHeight;
        imageDisplayWidth = targetDisplayHeight * imageAR;
    } else {
        // Image is taller than target, scale to match target width
        imageDisplayWidth = targetDisplayWidth;
        imageDisplayHeight = targetDisplayWidth / imageAR;
    }
    
    // Set image size to fill target area
    image.style.width = `${imageDisplayWidth}px`;
    image.style.height = `${imageDisplayHeight}px`;
    
    // Calculate scale factor between target dimensions and display dimensions
    const scaleX = targetDisplayWidth / targetDimensions.width;
    const scaleY = targetDisplayHeight / targetDimensions.height;
    
    // Scale the bias position values to match the display dimensions
    const scaledX = currentBias.x * scaleX;
    const scaledY = currentBias.y * scaleY;
    
    // Position the wrapper relative to the target area overlay (top-left is 0,0)
    // The target area overlay is centered in the container, so we need to calculate its position
    // The container has 2em padding, so the target area is centered within the padded area
    const targetAreaX = (containerWidth - targetDisplayWidth) / 2;
    const targetAreaY = (containerHeight - targetDisplayHeight) / 2;
    
    // Apply position to wrapper (scaled to match display dimensions, referenced to target area top-left)
    // The wrapper is positioned relative to the container, and the target area is already centered within the padded area
    wrapper.style.transform = `translate(${targetAreaX + scaledX}px, ${targetAreaY + scaledY}px)`;
    
    // Apply rotation and scale to image (from top-left corner)
    const { scale, rotate } = currentBias;
    image.style.transform = `rotate(${rotate}deg) scale(${scale})`;
}

// Handle bias control changes
function handleBiasControlChange() {
    const x = parseInt(document.getElementById('biasX').value) || 0;
    const y = parseInt(document.getElementById('biasY').value) || 0;
    const scale = parseFloat(document.getElementById('biasScale').value) || 1.0;
    const rotate = parseInt(document.getElementById('biasRotate').value) || 0;
    
    imageBiasAdjustmentData.currentBias = { x, y, scale, rotate };
    updateBiasAdjustmentImage();
    
    // Update client preview if it's active
    if (imageBiasAdjustmentData.previewMode === 'client') {
        updateClientPreview();
    }
}

// Image Bias Preset Functions
function getImageBiasPresetOptions() {
    // Get current resolution to determine if we're in portrait or landscape mode
    const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
    let isPortrait = currentResolution.toLowerCase().includes('portrait');
    
    // For custom resolutions, determine based on width/height
    if (currentResolution === 'custom' && manualWidth && manualHeight) {
        const width = parseInt(manualWidth.value);
        const height = parseInt(manualHeight.value);
        isPortrait = height > width;
    }
    
    if (!isPortrait) {
        return [
            { value: '0', display: 'Top' },
            { value: '1', display: 'Mid-Top' },
            { value: '2', display: 'Center' },
            { value: '3', display: 'Mid-Bottom' },
            { value: '4', display: 'Bottom' }
        ];
    } else {
        // Landscape or square - use same position names
        return [
            { value: '0', display: 'Left' },
            { value: '1', display: 'Mid-Left' },
            { value: '2', display: 'Center' },
            { value: '3', display: 'Mid-Right' },
            { value: '4', display: 'Right' }
        ];
    }
}

function renderImageBiasPresetDropdown(selectedVal) {
    const menu = document.getElementById('imageBiasPresetMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    const presetOptions = getImageBiasPresetOptions();
    
    presetOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        optionElement.dataset.value = option.value;
        
        // Determine grid layout based on aspect ratio
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        const isPortrait = currentResolution.includes('portrait');
        
        // For custom resolutions, determine based on width/height
        let isPortraitMode = isPortrait;
        if (currentResolution === 'custom' && manualWidth && manualHeight) {
            const width = parseInt(manualWidth.value);
            const height = parseInt(manualHeight.value);
            isPortraitMode = height > width;
        }
        
        // Create grid based on orientation
        let gridHTML = '';
        if (isPortraitMode) {
            // Portrait: 3 columns, 5 rows (vertical layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        } else {
            // Landscape: 5 columns, 3 rows (horizontal layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        }
        
        optionElement.innerHTML = `
            <div class="mask-bias-option-content">
                <div class="mask-bias-grid" data-bias="${option.value}" data-orientation="${isPortraitMode ? 'portrait' : 'landscape'}">
                    ${gridHTML}
                </div>
                <span class="mask-bias-label">${option.display}</span>
            </div>
        `;
        
        optionElement.addEventListener('click', () => {
            applyImageBiasPreset(option.value);
            closeImageBiasPresetDropdown();
        });
        
        menu.appendChild(optionElement);
    });
}

function selectImageBiasPreset(value) {
    const btn = document.getElementById('imageBiasPresetBtn');
    const grid = btn.querySelector('.mask-bias-grid');
    const label = btn.querySelector('.mask-bias-label');
    
    const presetOptions = getImageBiasPresetOptions();
    const selectedOption = presetOptions.find(option => option.value === value);
    
    if (selectedOption) {
        label.textContent = selectedOption.display;
    } else {
        label.textContent = 'Center';
    }
    
    // Update the button's grid preview
    if (grid) {
        grid.setAttribute('data-bias', value);
        
        // Update orientation based on current resolution
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        const isPortrait = currentResolution.includes('portrait');
        
        // For custom resolutions, determine based on width/height
        let isPortraitMode = isPortrait;
        if (currentResolution === 'custom' && manualWidth && manualHeight) {
            const width = parseInt(manualWidth.value);
            const height = parseInt(manualHeight.value);
            isPortraitMode = height > width;
        }
        
        grid.setAttribute('data-orientation', isPortraitMode ? 'portrait' : 'landscape');
    }
    
    // Calculate and apply the preset position
    applyImageBiasPreset(value);
}

function applyImageBiasPreset(presetValue) {
    if (!imageBiasAdjustmentData.targetDimensions) return;
    
    const { width: targetWidth, height: targetHeight } = imageBiasAdjustmentData.targetDimensions;
    const { width: imageWidth, height: imageHeight } = imageBiasAdjustmentData.originalImage;
    
    // Calculate how the image fills the target area
    const imageAR = imageWidth / imageHeight;
    const targetAR = targetWidth / targetHeight;
    
    let imageFillWidth, imageFillHeight;
    
    if (imageAR > targetAR) {
        // Image is wider than target, scale to match target height
        imageFillHeight = targetHeight;
        imageFillWidth = targetHeight * imageAR;
    } else {
        // Image is taller than target, scale to match target width
        imageFillWidth = targetWidth;
        imageFillHeight = targetWidth / imageAR;
    }
    
    // Calculate position based on preset
    let x = 0, y = 0;
    
    switch (presetValue) {
        case '0': // Top/Left
            x = 0;
            y = 0;
            break;
        case '1': // Mid-Top/Mid-Left
            x = (targetWidth - imageFillWidth) / 2;
            y = 0;
            break;
        case '2': // Center
            x = (targetWidth - imageFillWidth) / 2;
            y = (targetHeight - imageFillHeight) / 2;
            break;
        case '3': // Mid-Bottom/Mid-Right
            x = (targetWidth - imageFillWidth) / 2;
            y = targetHeight - imageFillHeight;
            break;
        case '4': // Bottom/Right
            x = targetWidth - imageFillWidth;
            y = targetHeight - imageFillHeight;
            break;
    }
    
    // Update the bias values
    imageBiasAdjustmentData.currentBias.x = Math.round(x);
    imageBiasAdjustmentData.currentBias.y = Math.round(y);
    
    // Update the UI
    document.getElementById('biasX').value = Math.round(x);
    document.getElementById('biasY').value = Math.round(y);
    
    updateBiasAdjustmentImage();
    
    // Update client preview if it's active
    if (imageBiasAdjustmentData.previewMode === 'client') {
        updateClientPreview();
    }
}

function openImageBiasPresetDropdown() {
    const menu = document.getElementById('imageBiasPresetMenu');
    const btn = document.getElementById('imageBiasPresetBtn');
    if (menu && btn) {
        menu.style.display = 'block';
        btn.classList.add('active');
    }
}

function closeImageBiasPresetDropdown() {
    const menu = document.getElementById('imageBiasPresetMenu');
    const btn = document.getElementById('imageBiasPresetBtn');
    if (menu && btn) {
        menu.style.display = 'none';
        btn.classList.remove('active');
    }
}

// Reset bias controls
function resetBiasControls() {
    imageBiasAdjustmentData.currentBias = { x: 0, y: 0, scale: 1.0, rotate: 0 };
    updateBiasAdjustmentUI();
    updateBiasAdjustmentImage();
}

// Handle image dragging
function handleBiasImageMouseDown(e) {
    if (e.target.id !== 'biasAdjustmentImage') return;
    
    imageBiasAdjustmentData.isDragging = true;
    imageBiasAdjustmentData.dragStart = { x: e.clientX, y: e.clientY };
    imageBiasAdjustmentData.originalTransform = { ...imageBiasAdjustmentData.currentBias };
    
    e.preventDefault();
}

function handleBiasImageMouseMove(e) {
    if (!imageBiasAdjustmentData.isDragging) return;
    
    const deltaX = e.clientX - imageBiasAdjustmentData.dragStart.x;
    const deltaY = e.clientY - imageBiasAdjustmentData.dragStart.y;
    
    imageBiasAdjustmentData.currentBias.x = imageBiasAdjustmentData.originalTransform.x + deltaX;
    imageBiasAdjustmentData.currentBias.y = imageBiasAdjustmentData.originalTransform.y + deltaY;
    
    updateBiasAdjustmentUI();
    updateBiasAdjustmentImage();
}

function handleBiasImageMouseUp() {
    imageBiasAdjustmentData.isDragging = false;
}

// Toggle between CSS view and client preview
function togglePreviewMode() {
    const toggleBtn = document.getElementById('previewToggleBtn');
    const cssWrapper = document.getElementById('biasAdjustmentImageWrapper');
    const clientImage = document.getElementById('clientPreviewImage');
    
    const currentState = toggleBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    
    imageBiasAdjustmentData.previewMode = newState === 'on' ? 'client' : 'css';
    
    if (newState === 'on') {
        // Show client preview
        toggleBtn.setAttribute('data-state', 'on');
        toggleBtn.innerHTML = '<i class="fas fa-mouse-pointer"></i> Interactive';
        cssWrapper.style.display = 'none';
        clientImage.style.display = 'block';
        updateClientPreview();
    } else {
        // Show CSS interactive view
        toggleBtn.setAttribute('data-state', 'off');
        toggleBtn.innerHTML = '<i class="nai-sparkles"></i> Preview';
        cssWrapper.style.display = 'block';
        clientImage.style.display = 'none';
        updateBiasAdjustmentImage();
    }
}

// Update client preview image
async function updateClientPreview() {
    if (!imageBiasAdjustmentData.originalImage || !imageBiasAdjustmentData.targetDimensions) return;
    
    try {
        const clientPreview = await generateClientBiasPreview();
        const clientImage = document.getElementById('clientPreviewImage');
        clientImage.src = clientPreview;
    } catch (error) {
        console.error('Failed to update client preview:', error);
    }
}

// Test bias adjustment
async function testBiasAdjustment() {
    if (!imageBiasAdjustmentData.originalImage || !imageBiasAdjustmentData.targetDimensions) {
        showError('No image data available for testing');
        return;
    }
    
    const testBtn = document.getElementById('biasTestBtn');
    const resultsDiv = document.getElementById('biasTestResults');
    
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="spinner"></i> Testing...';
    
    try {
        // Generate client-side preview
        const clientPreview = await generateClientBiasPreview();
        document.getElementById('clientTestImage').src = clientPreview;
        
        // Generate server-side preview
        const serverPreview = await generateServerBiasPreview();
        document.getElementById('serverTestImage').src = serverPreview;
        
        resultsDiv.style.display = 'flex';
        
    } catch (error) {
        console.error('Bias test error:', error);
        showError('Failed to test bias adjustment: ' + error.message);
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = '<i class="nai-sparkles"></i> Test Adjustment';
    }
}

// Generate client-side bias preview
async function generateClientBiasPreview() {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const { originalImage, targetDimensions, currentBias } = imageBiasAdjustmentData;
        
        canvas.width = targetDimensions.width;
        canvas.height = targetDimensions.height;
        
        // Calculate how to fill the canvas while maintaining aspect ratio
        const imageAR = originalImage.width / originalImage.height;
        const targetAR = targetDimensions.width / targetDimensions.height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imageAR > targetAR) {
            // Image is wider than target, scale to match target height
            drawHeight = targetDimensions.height;
            drawWidth = targetDimensions.height * imageAR;
            // Position at top-left corner, not centered
            drawX = 0;
            drawY = 0;
        } else {
            // Image is taller than target, scale to match target width
            drawWidth = targetDimensions.width;
            drawHeight = targetDimensions.width / imageAR;
            // Position at top-left corner, not centered
            drawX = 0;
            drawY = 0;
        }
        
        // Apply bias transformations - all referenced to top-left corner
        ctx.save();
        
        // Apply position offset (absolute pixels, not affected by scale)
        // Client preview should not have padding - it represents the actual target resolution
        ctx.translate(currentBias.x, currentBias.y);
        
        // Apply rotation and scale from top-left corner
        ctx.rotate((currentBias.rotate * Math.PI) / 180);
        ctx.scale(currentBias.scale, currentBias.scale);
        
        // Draw the image to fill the canvas (like object-fit: cover)
        ctx.drawImage(originalImage, drawX, drawY, drawWidth, drawHeight);
        
        ctx.restore();
        
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            resolve(url);
        }, 'image/png');
    });
}

// Generate server-side bias preview
async function generateServerBiasPreview() {
    const { targetDimensions, currentBias } = imageBiasAdjustmentData;
    
    // Get the image source path from uploaded image data
    if (!window.uploadedImageData || !window.uploadedImageData.image_source) {
        throw new Error('No image source available for server test');
    }
    
    const imageSource = window.uploadedImageData.image_source;
    
    // Send to server for processing
    const response = await fetch('/test-bias-adjustment', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            image_source: imageSource,
            target_width: targetDimensions.width,
            target_height: targetDimensions.height,
            bias: currentBias
        })
    });
    
    if (!response.ok) {
        throw new Error(`Server test failed: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

// Save bias adjustment
async function saveBiasAdjustment() {
    if (!imageBiasAdjustmentData.currentBias) {
        showError('No bias adjustment to save');
        return;
    }
    
    // Show confirmation dialog with previews
    await showBiasAdjustmentConfirmDialog();
}

// Show bias adjustment confirmation dialog
async function showBiasAdjustmentConfirmDialog() {
    const dialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (!dialog) {
        console.error('Bias adjustment confirmation dialog not found');
        return;
    }
    
    // Generate previews
    await generateConfirmationPreviews();
    
    // Show dialog
    dialog.style.display = 'flex';
}

// Generate previews for confirmation dialog
async function generateConfirmationPreviews() {
    try {
        // Generate client preview
        const clientPreview = await generateClientBiasPreview();
        const confirmClientPreview = document.getElementById('confirmClientPreview');
        if (confirmClientPreview && clientPreview) {
            confirmClientPreview.src = clientPreview;
        }
        
        // Generate server preview
        const serverPreview = await generateServerBiasPreview();
        const confirmServerPreview = document.getElementById('confirmServerPreview');
        if (confirmServerPreview && serverPreview) {
            confirmServerPreview.src = serverPreview;
        }
    } catch (error) {
        console.error('Failed to generate confirmation previews:', error);
        showError('Failed to generate previews');
    }
}

// Function to detect transparent pixels in an image
function detectTransparentPixels(imageDataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            let transparentPixels = 0;
            const totalPixels = canvas.width * canvas.height;
            
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                if (alpha < 128) { // Consider pixels with alpha < 128 as transparent
                    transparentPixels++;
                }
            }
            
            const transparentPercentage = (transparentPixels / totalPixels) * 100;
            resolve({
                hasTransparentPixels: transparentPixels > 0,
                transparentPercentage: transparentPercentage,
                transparentPixels: transparentPixels,
                totalPixels: totalPixels
            });
        };
        img.src = imageDataUrl;
    });
}

// Function to auto-fill mask based on transparent pixels
async function autoFillMaskFromTransparentPixels() {
    if (!window.uploadedImageData || !window.uploadedImageData.originalDataUrl) {
        showError('No image data available for auto-fill');
        return;
    }

    if (!window.currentMaskData) {
        showError('No existing mask found for auto-fill');
        return;
    }

    try {
        // Get the current resolution
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        const resolutionDims = getDimensionsFromResolution(currentResolution);
        if (!resolutionDims) {
            showError('Invalid resolution for auto-fill');
            return;
        }

        // Load the existing mask
        const maskImg = new Image();
        maskImg.onload = function() {
            // Step 1: Upscale the mask 8x with nearest neighbor
            const upscaledCanvas = document.createElement('canvas');
            const upscaledCtx = upscaledCanvas.getContext('2d');
            upscaledCanvas.width = resolutionDims.width;
            upscaledCanvas.height = resolutionDims.height;
            
            // Use nearest neighbor scaling for upscaling
            upscaledCtx.imageSmoothingEnabled = false;
            upscaledCtx.drawImage(maskImg, 0, 0, upscaledCanvas.width, upscaledCanvas.height);
            
            // Step 2: Apply the same transforms as the image bias
            const transformedCanvas = document.createElement('canvas');
            const transformedCtx = transformedCanvas.getContext('2d');
            transformedCanvas.width = resolutionDims.width;
            transformedCanvas.height = resolutionDims.height;
            
            // Fill with white background
            transformedCtx.fillStyle = '#FFFFFF';
            transformedCtx.fillRect(0, 0, transformedCanvas.width, transformedCanvas.height);
            
            // Apply the same transforms as the image bias, calculating delta from original bias
            const dynamicBias = window.uploadedImageData.image_bias;
            const previousBias = window.uploadedImageData.previousBias; // The bias that was active when mask was created
            
            if (dynamicBias && typeof dynamicBias === 'object') {
                transformedCtx.save();
                
                // Calculate the difference between current bias and the bias that was active when mask was created
                if (previousBias && typeof previousBias === 'object') {
                    // Calculate delta from previous bias to current bias
                    const deltaX = (dynamicBias.x || 0) - (previousBias.x || 0);
                    const deltaY = (dynamicBias.y || 0) - (previousBias.y || 0);
                    const deltaRotate = (dynamicBias.rotate || 0) - (previousBias.rotate || 0);
                    
                    // For scale, we need to calculate the relative change
                    // If previous scale was 1.2 and current is 1.5, delta should be 1.5/1.2 = 1.25
                    const previousScale = previousBias.scale || 1;
                    const currentScale = dynamicBias.scale || 1;
                    const deltaScale = currentScale / previousScale;
                    
                    // Calculate the source image position when the mask was created
                    // The source image fills the target area, so we need to find its top-left corner
                    const sourceImageWidth = upscaledCanvas.width;
                    const sourceImageHeight = upscaledCanvas.height;
                    const targetWidth = resolutionDims.width;
                    const targetHeight = resolutionDims.height;
                    
                    // Calculate how the source image was positioned (like in cropImageWithDynamicBias)
                    const imageAR = sourceImageWidth / sourceImageHeight;
                    const targetAR = targetWidth / targetHeight;
                    
                    let sourceX, sourceY, sourceWidth, sourceHeight;
                    if (imageAR > targetAR) {
                        // Image is wider than target, scale to match target height
                        sourceHeight = targetHeight;
                        sourceWidth = targetHeight * imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    } else {
                        // Image is taller than target, scale to match target width
                        sourceWidth = targetWidth;
                        sourceHeight = targetWidth / imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    }
                    
                    // Apply transformations from the source image's top-left origin (like cropImageWithDynamicBias)
                    transformedCtx.translate(deltaX, deltaY);
                    transformedCtx.rotate(deltaRotate * Math.PI / 180);
                    transformedCtx.scale(deltaScale, deltaScale);
                } else {
                    // No previous bias, apply the full current bias transformations
                    // Calculate the source image position (same logic as above)
                    const sourceImageWidth = upscaledCanvas.width;
                    const sourceImageHeight = upscaledCanvas.height;
                    const targetWidth = resolutionDims.width;
                    const targetHeight = resolutionDims.height;
                    
                    const imageAR = sourceImageWidth / sourceImageHeight;
                    const targetAR = targetWidth / targetHeight;
                    
                    let sourceX, sourceY, sourceWidth, sourceHeight;
                    if (imageAR > targetAR) {
                        sourceHeight = targetHeight;
                        sourceWidth = targetHeight * imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    } else {
                        sourceWidth = targetWidth;
                        sourceHeight = targetWidth / imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    }
                    
                    // Apply transformations from the source image's top-left origin
                    transformedCtx.translate(dynamicBias.x || 0, dynamicBias.y || 0);
                    transformedCtx.rotate((dynamicBias.rotate || 0) * Math.PI / 180);
                    transformedCtx.scale(dynamicBias.scale || 1, dynamicBias.scale || 1);
                }
                
                transformedCtx.drawImage(upscaledCanvas, 0, 0);
                transformedCtx.restore();
            } else {
                // For regular bias, apply the standard crop transform
                const bias = window.uploadedImageData.bias || 2;
                const originalWidth = window.uploadedImageData.originalWidth;
                const originalHeight = window.uploadedImageData.originalHeight;
                
                const scale = Math.max(resolutionDims.width / originalWidth, resolutionDims.height / originalHeight) * (bias / 2);
                const scaledWidth = originalWidth * scale;
                const scaledHeight = originalHeight * scale;
                const x = (resolutionDims.width - scaledWidth) / 2;
                const y = (resolutionDims.height - scaledHeight) / 2;
                
                // If there was a previous bias, calculate the delta
                if (previousBias && typeof previousBias === 'number') {
                    const previousScale = Math.max(resolutionDims.width / originalWidth, resolutionDims.height / originalHeight) * (previousBias / 2);
                    const previousScaledWidth = originalWidth * previousScale;
                    const previousScaledHeight = originalHeight * previousScale;
                    const previousX = (resolutionDims.width - previousScaledWidth) / 2;
                    const previousY = (resolutionDims.height - previousScaledHeight) / 2;
                    
                    // Calculate the offset to align the mask
                    const offsetX = x - previousX;
                    const offsetY = y - previousY;
                    const scaleRatio = scale / previousScale;
                    
                    transformedCtx.save();
                    transformedCtx.translate(offsetX, offsetY);
                    transformedCtx.scale(scaleRatio, scaleRatio);
                    transformedCtx.drawImage(upscaledCanvas, previousX, previousY, previousScaledWidth, previousScaledHeight);
                    transformedCtx.restore();
                } else {
                    transformedCtx.drawImage(upscaledCanvas, x, y, scaledWidth, scaledHeight);
                }
            }
            
            // Step 3: Scale down 8x with nearest neighbor
            const finalCanvas = document.createElement('canvas');
            const finalCtx = finalCanvas.getContext('2d');
            finalCanvas.width = Math.floor(resolutionDims.width / 8);
            finalCanvas.height = Math.floor(resolutionDims.height / 8);
            
            // Use nearest neighbor scaling
            finalCtx.imageSmoothingEnabled = false;
            finalCtx.drawImage(transformedCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
            
            // Convert mask to base64
            const maskBase64 = finalCanvas.toDataURL('image/png');
            
            // Store the mask data
            window.currentMaskData = maskBase64;
            
            // Set inpaint button to on
            if (inpaintBtn) {
                inpaintBtn.setAttribute('data-state', 'on');
                inpaintBtn.classList.add('active');
            }
            
            // Update mask preview
            updateMaskPreview();
            
            showSuccess('Mask auto-filled and aligned with image bias');
        };
        
        // Load the existing mask
        maskImg.src = window.currentMaskData;
        
    } catch (error) {
        console.error('Error auto-filling mask:', error);
        showError('Failed to auto-fill mask');
    }
}



// Accept bias adjustment and save
function acceptBiasAdjustment() {
    if (!imageBiasAdjustmentData.currentBias) {
        showError('No bias adjustment to save');
        return;
    }
    
    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;
    
    if (hasExistingMask) {
        // Store the pending bias adjustment and show alert modal
        window.pendingBiasAdjustment = {
            bias: imageBiasAdjustmentData.currentBias,
            callback: () => {
                // This will be called after the mask is handled
            }
        };
        hideBiasAdjustmentConfirmDialog();
        hideImageBiasAdjustmentModal();
        showImageBiasMaskAlertModal();
        return;
    }
    
    // No mask exists, proceed with bias adjustment
    applyBiasAdjustment();
}

// Apply bias adjustment (helper function)
function applyBiasAdjustment() {
    // Store the bias adjustment data
    if (!window.uploadedImageData) {
        window.uploadedImageData = {};
    }
    
    // Store the previous bias before applying the new one
    window.uploadedImageData.previousBias = window.uploadedImageData.image_bias || window.uploadedImageData.bias || 2;
    
    window.uploadedImageData.image_bias = imageBiasAdjustmentData.currentBias;
    
    // Update the hidden input for form submission
    const imageBiasHidden = document.getElementById('imageBias');
    if (imageBiasHidden) {
        imageBiasHidden.value = JSON.stringify(imageBiasAdjustmentData.currentBias);
    }
    
    // Close both dialogs
    hideBiasAdjustmentConfirmDialog();
    hideImageBiasAdjustmentModal();
    
    // Update the main preview
    cropImageToResolution();

    renderImageBiasDropdown();
    
    showSuccess('Bias adjustment saved');
}



// Hide bias adjustment confirmation dialog
function hideBiasAdjustmentConfirmDialog() {
    const dialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (dialog) {
        dialog.style.display = 'none';
    }
}

// Show base image change alert modal
function showBaseImageChangeAlertModal() {
    const modal = document.getElementById('baseImageChangeAlertModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Hide base image change alert modal
function hideBaseImageChangeAlertModal() {
    const modal = document.getElementById('baseImageChangeAlertModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Show image bias mask alert modal
function showImageBiasMaskAlertModal() {
    const modal = document.getElementById('imageBiasMaskAlertModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Hide image bias mask alert modal
function hideImageBiasMaskAlertModal() {
    const modal = document.getElementById('imageBiasMaskAlertModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Confirm base image change and delete mask
async function confirmBaseImageChange() {
    // Delete the existing mask
    await deleteMask();
    
    // Hide the modal
    hideBaseImageChangeAlertModal();
    
    // Continue with the pending image upload
    if (window.pendingImageUpload) {
        const { file } = window.pendingImageUpload;
        window.pendingImageUpload = null;
        await handleManualImageUploadInternal(file);
    }
    
    // Continue with the pending cache image selection
    if (window.pendingCacheImageSelection) {
        const { cacheImage } = window.pendingCacheImageSelection;
        window.pendingCacheImageSelection = null;
        await selectCacheImageInternal(cacheImage);
    }
}

// Apply image bias change (helper function)
async function applyImageBiasChange(value, callback) {
    // Clear dynamic bias data when selecting a preset
    if (window.uploadedImageData && window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object') {
        delete window.uploadedImageData.image_bias;
    }
    
    // Fix: Ensure value is properly set, even if it's 0
    if (imageBiasHidden != null) {
        imageBiasHidden.value = value.toString();
    }
    
    // Update the uploaded image data with the new bias value
    if (window.uploadedImageData) {
        window.uploadedImageData.bias = parseInt(value);
    }
    
    updateImageBiasDisplay(value);
    
    // Reload the preview image with the new bias
    await cropImageToResolution();
    
    // Call the original callback if provided
    if (callback) {
        callback();
    }
}

// Create mask from transparent pixels
async function createMaskFromTransparentPixels() {
    try {
        if (!window.uploadedImageData || !window.uploadedImageData.originalDataUrl) {
            showError('No image data available');
            return;
        }

        // Get the processed image with current bias applied
        let processedImageUrl;
        
        // Check if we have a pending bias adjustment (custom bias)
        if (window.pendingBiasAdjustment && imageBiasAdjustmentData.currentBias) {
            processedImageUrl = await cropImageWithDynamicBias(window.uploadedImageData.originalDataUrl, imageBiasAdjustmentData.currentBias);
        } else {
            const dynamicBias = window.uploadedImageData.image_bias;
            if (dynamicBias && typeof dynamicBias === 'object') {
                processedImageUrl = await cropImageWithDynamicBias(window.uploadedImageData.originalDataUrl, dynamicBias);
            } else {
                const bias = window.uploadedImageData.bias || 2;
                processedImageUrl = await cropImageToResolutionInternal(window.uploadedImageData.originalDataUrl, bias);
            }
        }

        // Create a canvas to process the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = processedImageUrl;
        });

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Get image data to analyze transparent pixels
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Create mask canvas
        const maskCanvas = document.createElement('canvas');
        const maskCtx = maskCanvas.getContext('2d');
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;

        // Fill with black background
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        // Process each pixel
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // If pixel is transparent or very transparent, make it white in the mask
            if (a < 128) {
                const pixelIndex = i / 4;
                const x = pixelIndex % canvas.width;
                const y = Math.floor(pixelIndex / canvas.width);
                
                maskCtx.fillStyle = '#FFFFFF';
                maskCtx.fillRect(x, y, 1, 1);
            }
        }

        // Convert mask to base64
        const maskDataUrl = maskCanvas.toDataURL('image/png');
        
        // Store the mask data
        window.currentMaskData = maskDataUrl;
        
        // Set inpaint button to on
        if (inpaintBtn) {
            inpaintBtn.setAttribute('data-state', 'on');
            inpaintBtn.classList.add('active');
        }
        
        // Update vibe transfer UI state
        updateInpaintButtonState();
        
        showSuccess('Mask created from transparent pixels!');
        
    } catch (error) {
        console.error('Error creating mask from transparent pixels:', error);
        showError('Failed to create mask from transparent pixels');
    }
}

// Hide image bias adjustment modal
function hideImageBiasAdjustmentModal() {
    const modal = document.getElementById('imageBiasAdjustmentModal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Clean up test results
    const resultsDiv = document.getElementById('biasTestResults');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }
    
    // Reset dragging state
    imageBiasAdjustmentData.isDragging = false;
}

// Enhanced cropImageToResolution function to handle dynamic bias adjustments
async function cropImageToResolution() {
    if (!(window.uploadedImageData && (window.uploadedImageData.image_source || window.uploadedImageData.originalDataUrl))) {
        console.warn('No uploaded image data available for cropping');
        return;
    }

    try {
        // Clean up any existing blob URLs before creating new ones
        cleanupBlobUrls();
        
        // Get the image data URL
        let imageDataUrl = window.uploadedImageData.originalDataUrl;
        
        if (!imageDataUrl) {
            const imageSource = window.uploadedImageData.image_source;
            if (imageSource.startsWith('data:')) {
                imageDataUrl = imageSource;
            } else {
                let imageUrl = null;
                if (imageSource.startsWith('file:')) {
                    imageUrl = `/images/${imageSource.replace('file:', '')}`;
                } else if (imageSource.startsWith('cache:')) {
                    imageUrl = `/cache/preview/${imageSource.replace('cache:', '')}.webp`;
                }
                if (imageUrl) {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    imageDataUrl = URL.createObjectURL(blob);
                }
            }
            window.uploadedImageData.originalDataUrl = imageDataUrl;
        }
        
        if (!imageDataUrl) {
            console.warn('Could not get image data URL for cropping');
            return;
        }

        // Check if we have dynamic bias adjustment data
        const dynamicBias = window.uploadedImageData.image_bias;
        let croppedBlobUrl;
        
        if (dynamicBias && typeof dynamicBias === 'object') {
            // Use dynamic bias adjustment
            croppedBlobUrl = await cropImageWithDynamicBias(imageDataUrl, dynamicBias);
        } else {
            // Use legacy bias system
            const bias = (window.uploadedImageData.bias !== undefined && window.uploadedImageData.bias !== null) ? window.uploadedImageData.bias : 2;
            croppedBlobUrl = await cropImageToResolutionInternal(imageDataUrl, bias);
        }
        
        // Update the preview image
        const variationImage = document.getElementById('manualVariationImage');
        if (variationImage) {
            variationImage.src = croppedBlobUrl;
            variationImage.style.display = 'block';
            // Give the image more time to load before updating mask preview
            setTimeout(updateMaskPreview, 500);
        }

        window.uploadedImageData.croppedBlobUrl = croppedBlobUrl;
    } catch (error) {
        console.error('Failed to crop image to resolution:', error);
        showError('Failed to crop image to resolution');
    }
}

// New function to crop image with dynamic bias adjustments
function cropImageWithDynamicBias(dataUrl, bias) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
            const resolutionDims = getDimensionsFromResolution(currentResolution);
            
            if (!resolutionDims) {
                resolve(dataUrl);
                return;
            }
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = resolutionDims.width;
            canvas.height = resolutionDims.height;
            
            // Calculate how to fill the canvas while maintaining aspect ratio
            const imageAR = img.width / img.height;
            const targetAR = resolutionDims.width / resolutionDims.height;
            
            let drawWidth, drawHeight, drawX, drawY;
            
            if (imageAR > targetAR) {
                // Image is wider than target, scale to match target height
                drawHeight = resolutionDims.height;
                drawWidth = resolutionDims.height * imageAR;
                // Position at top-left corner, not centered
                drawX = 0;
                drawY = 0;
            } else {
                // Image is taller than target, scale to match target width
                drawWidth = resolutionDims.width;
                drawHeight = resolutionDims.width / imageAR;
                // Position at top-left corner, not centered
                drawX = 0;
                drawY = 0;
            }
            
            // Apply bias transformations - all referenced to top-left
            ctx.save();
            
            // Apply position offset (absolute pixels, not affected by scale)
            // This function is for actual cropping, not preview - no padding needed
            ctx.translate(bias.x, bias.y);
            
            // Apply rotation around top-left corner (0,0)
            ctx.rotate((bias.rotate * Math.PI) / 180);
            
            // Apply scale from top-left corner
            ctx.scale(bias.scale, bias.scale);
            
            // Draw the image to fill the canvas (like object-fit: cover)
            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            
            ctx.restore();
            
            // Convert to blob
            canvas.toBlob((blob) => {
                const blobUrl = URL.createObjectURL(blob);
                
                if (!window.croppedImageBlobUrls) {
                    window.croppedImageBlobUrls = [];
                }
                window.croppedImageBlobUrls.push(blobUrl);
                
                resolve(blobUrl);
            }, 'image/png');
        };
        img.src = dataUrl;
    });
}

// Setup image bias adjustment event listeners
function setupImageBiasAdjustmentListeners() {
    // Modal controls
    const closeBtn = document.getElementById('closeImageBiasAdjustmentBtn');
    const cancelBtn = document.getElementById('cancelBiasAdjustmentBtn');
    const saveBtn = document.getElementById('saveBiasAdjustmentBtn');
    const resetBtn = document.getElementById('biasResetBtn');
    const testBtn = document.getElementById('biasTestBtn');
    
    if (closeBtn) closeBtn.addEventListener('click', hideImageBiasAdjustmentModal);
    if (cancelBtn) cancelBtn.addEventListener('click', hideImageBiasAdjustmentModal);
    if (saveBtn) saveBtn.addEventListener('click', saveBiasAdjustment);
    if (resetBtn) resetBtn.addEventListener('click', resetBiasControls);
    if (testBtn) testBtn.addEventListener('click', testBiasAdjustment);
    

    
    // Bias control inputs
    const biasInputs = ['biasX', 'biasY', 'biasScale', 'biasRotate'];
    biasInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', handleBiasControlChange);
            input.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -1 : 1;
                const step = parseFloat(input.step) || 1;
                input.value = parseFloat(input.value || 0) + (delta * step);
                handleBiasControlChange();
            });
        }
    });
    
    // Image dragging
    const imageContainer = document.getElementById('imagePreviewContainer');
    if (imageContainer) {
        imageContainer.addEventListener('mousedown', handleBiasImageMouseDown);
        document.addEventListener('mousemove', handleBiasImageMouseMove);
        document.addEventListener('mouseup', handleBiasImageMouseUp);
    }
    
    // Preview toggle button
    const previewToggleBtn = document.getElementById('previewToggleBtn');
    
    if (previewToggleBtn) {
        previewToggleBtn.addEventListener('click', togglePreviewMode);
    }
    
    // Image bias preset dropdown
    const presetBtn = document.getElementById('imageBiasPresetBtn');
    if (presetBtn) {
        presetBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            
            const menu = document.getElementById('imageBiasPresetMenu');
            if (menu.style.display === 'block') {
                closeImageBiasPresetDropdown();
            } else {
                renderImageBiasPresetDropdown(); // Default to center
                openImageBiasPresetDropdown();
            }
        });
    }
    
    // Close image bias preset dropdown when clicking outside
    document.addEventListener('click', e => {
        const dropdown = document.getElementById('imageBiasPresetDropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            closeImageBiasPresetDropdown();
        }
    });
    
    // Close modal when clicking outside
    const modal = document.getElementById('imageBiasAdjustmentModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideImageBiasAdjustmentModal();
            }
        });
    }
    
    // Close base image change alert modal when clicking outside
    const baseImageChangeModal = document.getElementById('baseImageChangeAlertModal');
    if (baseImageChangeModal) {
        baseImageChangeModal.addEventListener('click', (e) => {
            if (e.target === baseImageChangeModal) {
                hideBaseImageChangeAlertModal();
                // Clear any pending changes
                window.pendingImageUpload = null;
                window.pendingCacheImageSelection = null;
            }
        });
    }
    
    // Close image bias mask alert modal when clicking outside
    const imageBiasMaskModal = document.getElementById('imageBiasMaskAlertModal');
    if (imageBiasMaskModal) {
        imageBiasMaskModal.addEventListener('click', (e) => {
            if (e.target === imageBiasMaskModal) {
                hideImageBiasMaskAlertModal();
                // Clear any pending changes
                window.pendingImageBiasChange = null;
                window.pendingBiasAdjustment = null;
            }
        });
    }
    
    // Confirmation dialog controls
    const closeConfirmBtn = document.getElementById('closeBiasConfirmBtn');
    const cancelConfirmBtn = document.getElementById('cancelBiasConfirmBtn');
    
    // Base image change alert modal controls
    const closeBaseImageChangeAlertBtn = document.getElementById('closeBaseImageChangeAlertBtn');
    const confirmBaseImageChangeBtn = document.getElementById('confirmBaseImageChangeBtn');
    const cancelBaseImageChangeBtn = document.getElementById('cancelBaseImageChangeBtn');
    
    if (closeBaseImageChangeAlertBtn) closeBaseImageChangeAlertBtn.addEventListener('click', () => {
        hideBaseImageChangeAlertModal();
        // Clear any pending changes
        window.pendingImageUpload = null;
        window.pendingCacheImageSelection = null;
    });
    if (confirmBaseImageChangeBtn) confirmBaseImageChangeBtn.addEventListener('click', confirmBaseImageChange);
    if (cancelBaseImageChangeBtn) cancelBaseImageChangeBtn.addEventListener('click', () => {
        hideBaseImageChangeAlertModal();
        // Clear any pending changes
        window.pendingImageUpload = null;
        window.pendingCacheImageSelection = null;
    });
    
    // Image bias mask alert modal controls
    const closeImageBiasMaskAlertBtn = document.getElementById('closeImageBiasMaskAlertBtn');
    const cancelImageBiasBtn = document.getElementById('cancelImageBiasBtn');
    const removeMaskBtn = document.getElementById('removeMaskBtn');
    const createMaskBtn = document.getElementById('createMaskBtn');
    
    if (closeImageBiasMaskAlertBtn) closeImageBiasMaskAlertBtn.addEventListener('click', () => {
        hideImageBiasMaskAlertModal();
        // Clear any pending changes
        window.pendingImageBiasChange = null;
        window.pendingBiasAdjustment = null;
    });
    if (cancelImageBiasBtn) cancelImageBiasBtn.addEventListener('click', () => {
        hideImageBiasMaskAlertModal();
        // Clear any pending changes
        window.pendingImageBiasChange = null;
        window.pendingBiasAdjustment = null;
    });
    if (removeMaskBtn) removeMaskBtn.addEventListener('click', () => {
        deleteMask();
        hideImageBiasMaskAlertModal();
        // Continue with the pending image bias change
        if (window.pendingImageBiasChange) {
            const { value, callback } = window.pendingImageBiasChange;
            window.pendingImageBiasChange = null;
            applyImageBiasChange(value, callback);
        }
        // Continue with the pending bias adjustment
        if (window.pendingBiasAdjustment) {
            const { bias, callback } = window.pendingBiasAdjustment;
            window.pendingBiasAdjustment = null;
            imageBiasAdjustmentData.currentBias = bias;
            applyBiasAdjustment();
        }
    });
    if (createMaskBtn) {
        console.log('Create mask button found and event listener added');
                createMaskBtn.addEventListener('click', async () => {
            console.log('Create mask button clicked');
            hideImageBiasMaskAlertModal();
        
        let hadPendingChanges = false;
        
        // Continue with the pending image bias change first
        if (window.pendingImageBiasChange) {
            const { value, callback } = window.pendingImageBiasChange;
            window.pendingImageBiasChange = null;
            await applyImageBiasChange(value, callback);
            hadPendingChanges = true;
        }
        
        // Continue with the pending bias adjustment first
        if (window.pendingBiasAdjustment) {
            const { bias, callback } = window.pendingBiasAdjustment;
            window.pendingBiasAdjustment = null;
            imageBiasAdjustmentData.currentBias = bias;
            await applyBiasAdjustment();
            hadPendingChanges = true;
        }
        
        if (hadPendingChanges) {
            console.log('Creating mask from transparent pixels');
            // Then create mask from transparent pixels
            await createMaskFromTransparentPixels();
        } else {
            console.log('Opening mask editor directly');
            // No pending changes, just open the mask editor
            openMaskEditor();
        }
    });
    }
    const acceptConfirmBtn = document.getElementById('acceptBiasConfirmBtn');
    
    if (closeConfirmBtn) closeConfirmBtn.addEventListener('click', hideBiasAdjustmentConfirmDialog);
    if (cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', hideBiasAdjustmentConfirmDialog);
    if (acceptConfirmBtn) acceptConfirmBtn.addEventListener('click', acceptBiasAdjustment);
    
    // Close confirmation dialog when clicking outside
    const confirmDialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (confirmDialog) {
        confirmDialog.addEventListener('click', (e) => {
            if (e.target === confirmDialog) {
                hideBiasAdjustmentConfirmDialog();
            }
        });
    }
}

// Add button to open bias adjustment modal
function addBiasAdjustmentButton() {
    const imageBiasGroup = document.getElementById('imageBiasGroup');
    if (!imageBiasGroup) return;
    
    // Check if button already exists
    if (document.getElementById('imageBiasAdjustBtn')) return;
    
    const adjustBtn = document.createElement('button');
    adjustBtn.id = 'imageBiasAdjustBtn';
    adjustBtn.type = 'button';
    adjustBtn.className = 'btn-secondary';
    adjustBtn.innerHTML = '<i class="nai-settings"></i>';
    adjustBtn.title = 'Advanced Bias Adjustment';
    
    adjustBtn.addEventListener('click', showImageBiasAdjustmentModal);
    
    // Insert after the dropdown
    const dropdown = imageBiasGroup.querySelector('#imageBiasDropdown');
    if (dropdown) {
        dropdown.parentNode.insertBefore(adjustBtn, dropdown.nextSibling);
    }
}



// Initialize image bias adjustment functionality
function initializeImageBiasAdjustment() {
    setupImageBiasAdjustmentListeners();
    
    // Connect existing bias adjustment button
    const adjustBtn = document.getElementById('imageBiasAdjustBtn');
    if (adjustBtn) {
        adjustBtn.addEventListener('click', showImageBiasAdjustmentModal);
    }
    
    // Add bias adjustment button when image bias group is shown (fallback)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const imageBiasGroup = document.getElementById('imageBiasGroup');
                if (imageBiasGroup && imageBiasGroup.style.display !== 'none') {
                    addBiasAdjustmentButton();
                }
            }
        });
    });
    
    const imageBiasGroup = document.getElementById('imageBiasGroup');
    if (imageBiasGroup) {
        observer.observe(imageBiasGroup, { attributes: true });
    }
}

// Reference Manager Variables
let cacheManagerImages = [];
let cacheManagerSelectedImages = new Set();
let cacheManagerCurrentWorkspace = 'default';
let cacheManagerIsSelectionMode = false;

// Vibe Manager Variables
let vibeManagerImages = [];
let vibeManagerSelectedModel = 'v4_5';
let vibeManagerIeSelectedModel = 'v4_5';
let vibeManagerFromReferenceSelectedModel = 'v4_5';
let vibeManagerFromReferenceImage = null;
let vibeManagerSelectedImages = new Set();
let vibeManagerIsSelectionMode = false;

// Helper function to get workspace display name
function getWorkspaceDisplayName(workspaceId) {
    const workspace = workspaces.find(w => w.id === workspaceId);
    return workspace ? workspace.name : 'Default';
}

// Modal management functions
function disablePageScroll() {
    document.body.classList.add('modal-open');
}

function enablePageScroll() {
    document.body.classList.remove('modal-open');
}

// Reference Manager Functions
function showCacheManagerModal() {
    cacheManagerCurrentWorkspace = activeWorkspace;
    cacheManagerSelectedImages.clear();
    cacheManagerIsSelectionMode = false;
    
    // Setup workspace dropdown
    setupCacheManagerWorkspaceDropdown();
    
    // Setup cache manager tab event listeners
    setupCacheManagerTabs();
    
    // Load cache images for current workspace
    loadCacheManagerImages();
    
    const modal = document.getElementById('cacheManagerModal');
    if (modal) {
        modal.style.display = 'block';
        disablePageScroll();
    }
}

function hideCacheManagerModal() {
    const modal = document.getElementById('cacheManagerModal');
    if (modal) {
        modal.style.display = 'none';
        enablePageScroll();
    }
    
    // Reset state
    cacheManagerSelectedImages.clear();
    cacheManagerIsSelectionMode = false;
}

function setupCacheManagerTabs() {
    const tabButtons = document.querySelectorAll('.cache-manager-tabs .tab-btn');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            switchCacheManagerTab(targetTab);
        });
    });
}

function setupCacheManagerWorkspaceDropdown() {
    const dropdown = document.getElementById('cacheManagerWorkspaceDropdown');
    const dropdownBtn = document.getElementById('cacheManagerWorkspaceDropdownBtn');
    const dropdownMenu = document.getElementById('cacheManagerWorkspaceDropdownMenu');
    const selectedSpan = document.getElementById('cacheManagerWorkspaceSelected');
    
    if (!dropdown || !dropdownBtn || !dropdownMenu || !selectedSpan) return;
    
    // Update selected workspace
    selectedSpan.textContent = getWorkspaceDisplayName(cacheManagerCurrentWorkspace);
    
    // Check if dropdown is already set up
    if (dropdown.dataset.setup === 'true') {
        return; // Already set up, don't add duplicate event listeners
    }
    
    // Setup dropdown functionality
    setupDropdown(dropdown, dropdownBtn, dropdownMenu, renderCacheManagerWorkspaceDropdown, () => cacheManagerCurrentWorkspace);
    
    // Mark as set up
    dropdown.dataset.setup = 'true';
}

function renderCacheManagerWorkspaceDropdown() {
    const dropdownMenu = document.getElementById('cacheManagerWorkspaceDropdownMenu');
    if (!dropdownMenu) return '';
    
    dropdownMenu.innerHTML = '';
    
    workspaces.forEach(workspace => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (workspace.id === cacheManagerCurrentWorkspace ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = workspace.id;
        
        const workspaceColor = workspace.color || '#124';
        
        option.innerHTML = `
            <div class="workspace-option-content">
                <div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                <div class="workspace-name">${workspace.name}</div>
            </div>
        `;
        
        const action = () => {
            if (workspace.id !== cacheManagerCurrentWorkspace) {
                cacheManagerCurrentWorkspace = workspace.id;
                cacheManagerSelectedImages.clear();
                loadCacheManagerImages();
                
                // Update selected workspace display
                const selectedSpan = document.getElementById('cacheManagerWorkspaceSelected');
                if (selectedSpan) {
                    selectedSpan.textContent = workspace.name;
                }
            }
            closeDropdown(dropdownMenu, document.getElementById('cacheManagerWorkspaceDropdownBtn'));
        };
        
        option.addEventListener('click', action);
        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                action();
            }
        });
        
        dropdownMenu.appendChild(option);
    });
}

async function loadCacheManagerImages() {
    const loading = document.getElementById('cacheManagerLoading');
    const gallery = document.getElementById('cacheManagerGallery');
    
    if (loading) loading.style.display = 'flex';
    if (gallery) gallery.innerHTML = '';
    
    try {
        // Load cache images for the current workspace
        const response = await fetchWithAuth(`/workspaces/${cacheManagerCurrentWorkspace}/references`, {
            method: 'OPTIONS'
        });
        
        if (response.ok) {
            cacheManagerImages = await response.json();
        } else {
            throw new Error(`Failed to load cache: ${response.statusText}`);
        }
        
        displayCacheManagerImages();
    } catch (error) {
        console.error('Error loading cache manager images:', error);
        showError('Failed to load cache images');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function displayCacheManagerImages() {
    const gallery = document.getElementById('cacheManagerGallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    
    if (cacheManagerImages.length === 0) {
        gallery.innerHTML = '<div class="no-images">No cache images found in this workspace</div>';
        return;
    }
    
    cacheManagerImages.forEach(cacheImage => {
        const galleryItem = createCacheManagerGalleryItem(cacheImage);
        gallery.appendChild(galleryItem);
    });
    
    updateCacheManagerSelectionMode();
}

function createCacheManagerGalleryItem(cacheImage) {
    const item = document.createElement('div');
    item.className = 'cache-manager-gallery-item';
    item.dataset.hash = cacheImage.hash;
    
    // Create image element
    const img = document.createElement('img');
    if (cacheImage.hasPreview) {
        img.src = `/cache/preview/${cacheImage.hash}.webp`;
    } else {
        img.src = `/cache/${cacheImage.hash}`;
    }
    img.alt = `Reference image ${cacheImage.hash}`;
    img.loading = 'lazy';
    
    // Create checkbox for selection mode
    const checkbox = document.createElement('div');
    checkbox.className = 'cache-manager-gallery-item-checkbox';
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCacheManagerImageSelection(cacheImage.hash);
    });
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'cache-manager-gallery-item-overlay';
    
    
    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cache-manager-gallery-item-buttons';
    
    // Create vibe encode button
    const vibeBtn = document.createElement('button');
    vibeBtn.className = 'btn-secondary btn-small';
    vibeBtn.innerHTML = '<i class="nai-vibe-transfer"></i>';
    vibeBtn.title = 'Create Vibe Encoding';
    vibeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showVibeManagerFromReferenceModal(cacheImage);
    });
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCacheManagerImage(cacheImage, cacheManagerCurrentWorkspace);
    });
    
    buttonsContainer.appendChild(vibeBtn);
    buttonsContainer.appendChild(deleteBtn);
    
    overlay.appendChild(buttonsContainer);
    
    item.appendChild(img);
    item.appendChild(checkbox);
    item.appendChild(overlay);
    
    // Click to select image
    item.addEventListener('click', () => {
        if (cacheManagerIsSelectionMode) {
            toggleCacheManagerImageSelection(cacheImage.hash);
        }
    });
    
    return item;
}

function toggleCacheManagerImageSelection(hash) {
    if (cacheManagerSelectedImages.has(hash)) {
        cacheManagerSelectedImages.delete(hash);
    } else {
        cacheManagerSelectedImages.add(hash);
    }
    
    updateCacheManagerSelectionMode();
    updateCacheManagerGallerySelection();
}

function updateCacheManagerSelectionMode() {
    const gallery = document.getElementById('cacheManagerGallery');
    const moveBtn = document.getElementById('cacheManagerMoveBtn');
    
    if (!gallery) return;
    
    if (cacheManagerSelectedImages.size > 0) {
        cacheManagerIsSelectionMode = true;
        gallery.classList.add('selection-mode');
        if (moveBtn) moveBtn.style.display = 'inline-block';
    } else {
        cacheManagerIsSelectionMode = false;
        gallery.classList.remove('selection-mode');
        if (moveBtn) moveBtn.style.display = 'none';
    }
}

function updateCacheManagerGallerySelection() {
    const gallery = document.getElementById('cacheManagerGallery');
    if (!gallery) return;
    
    const items = gallery.querySelectorAll('.cache-manager-gallery-item');
    items.forEach(item => {
        const hash = item.dataset.hash;
        const checkbox = item.querySelector('.cache-manager-gallery-item-checkbox');
        
        if (cacheManagerSelectedImages.has(hash)) {
            item.classList.add('selected');
            checkbox.checked = true;
        } else {
            item.classList.remove('selected');
            checkbox.checked = false;
        }
    });
}

async function deleteCacheManagerImage(cacheImage, workspace) {
    if (!confirm(`Are you sure you want to delete this cache image?`)) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`/workspaces/${workspace || cacheManagerCurrentWorkspace}/references/${cacheImage.hash}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Remove from local array
            cacheManagerImages = cacheManagerImages.filter(img => img.hash !== cacheImage.hash);
            cacheManagerSelectedImages.delete(cacheImage.hash);
            
            // Refresh display
            displayCacheManagerImages();
            
            showSuccess('Reference image deleted successfully');
        } else {
            throw new Error(`Failed to delete cache image: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error deleting cache manager image:', error);
        showError('Failed to delete cache image');
    }
}

function showCacheManagerUploadModal() {
    const modal = document.getElementById('cacheManagerUploadModal');
    if (modal) {
        modal.style.display = 'block';
        disablePageScroll();
    }
    
    // Reset form
    const fileInput = document.getElementById('cacheManagerFileInput');
    const uploadBtn = document.getElementById('cacheManagerUploadConfirmBtn');
    const progress = document.getElementById('cacheManagerUploadProgress');
    
    if (fileInput) fileInput.value = '';
    if (uploadBtn) uploadBtn.disabled = true;
    if (progress) progress.style.display = 'none';
}

function hideCacheManagerUploadModal() {
    const modal = document.getElementById('cacheManagerUploadModal');
    if (modal) {
        modal.style.display = 'none';
        enablePageScroll();
    }
}

async function uploadCacheManagerImages() {
    const fileInput = document.getElementById('cacheManagerFileInput');
    const uploadBtn = document.getElementById('cacheManagerUploadConfirmBtn');
    const progress = document.getElementById('cacheManagerUploadProgress');
    const progressFill = document.getElementById('cacheManagerProgressFill');
    const progressText = document.getElementById('cacheManagerProgressText');
    
    if (!fileInput || !fileInput.files.length) return;
    
    const files = Array.from(fileInput.files);
    uploadBtn.disabled = true;
    progress.style.display = 'flex';
    
    let uploadedCount = 0;
    
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            // Create form data
            const formData = new FormData();
            formData.append('image', file);
            
            // Upload file
            const response = await fetchWithAuth(`/workspaces/${cacheManagerCurrentWorkspace}/references`, {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                uploadedCount++;
            } else {
                console.error(`Failed to upload ${file.name}: ${response.statusText}`);
            }
            
            // Update progress
            const percent = Math.round(((i + 1) / files.length) * 100);
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `${percent}% (${i + 1}/${files.length})`;
        }
        
        if (uploadedCount > 0) {
            showSuccess(`${uploadedCount} image(s) uploaded successfully`);
            hideCacheManagerUploadModal();
            loadCacheManagerImages(); // Refresh the gallery
        } else {
            showError('No images were uploaded successfully');
        }
    } catch (error) {
        console.error('Error uploading cache images:', error);
        showError('Failed to upload images');
    } finally {
        uploadBtn.disabled = false;
        progress.style.display = 'none';
    }
}

function showCacheManagerMoveModal() {
    if (cacheManagerSelectedImages.size === 0) {
        showError('Please select images to move');
        return;
    }
    
    const modal = document.getElementById('cacheManagerMoveModal');
    const countSpan = document.getElementById('cacheManagerMoveCount');
    const targetSelect = document.getElementById('cacheManagerMoveTargetSelect');
    
    if (!modal || !countSpan || !targetSelect) return;
    
    countSpan.textContent = cacheManagerSelectedImages.size;
    
    // Populate target workspace options
    targetSelect.innerHTML = '';
    workspaces.forEach(workspace => {
        if (workspace.id !== cacheManagerCurrentWorkspace) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            targetSelect.appendChild(option);
        }
    });
    
    modal.style.display = 'block';
    disablePageScroll();
}

function hideCacheManagerMoveModal() {
    const modal = document.getElementById('cacheManagerMoveModal');
    if (modal) {
        modal.style.display = 'none';
        enablePageScroll();
    }
}

async function moveCacheManagerImages() {
    const targetSelect = document.getElementById('cacheManagerMoveTargetSelect');
    if (!targetSelect || !targetSelect.value) {
        showError('Please select a target workspace');
        return;
    }
    
    const targetWorkspace = targetSelect.value;
    const selectedHashes = Array.from(cacheManagerSelectedImages);
    
    try {
        const response = await fetchWithAuth(`/workspaces/${targetWorkspace}/references`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                hashes: selectedHashes
            })
        });
        
        if (response.ok) {
            showSuccess(`${selectedHashes.length} image(s) moved successfully`);
            
            // Clear selection and exit selection mode
            cacheManagerSelectedImages.clear();
            cacheManagerIsSelectionMode = false;
            
            // Update UI to reflect selection state
            updateCacheManagerSelectionMode();
            
            hideCacheManagerMoveModal();
            loadCacheManagerImages(); // Refresh the gallery
        } else {
            throw new Error(`Failed to move images: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error moving cache images:', error);
        showError('Failed to move images');
    }
}

// Vibe Manager Functions
function showVibeManagerUploadModal() {
    const modal = document.getElementById('vibeManagerUploadModal');
    if (modal) {
        modal.style.display = 'block';
        disablePageScroll();
    }
    
    // Reset form
    const fileInput = document.getElementById('vibeManagerFileInput');
    const uploadBtn = document.getElementById('vibeManagerUploadConfirmBtn');
    const ieInput = document.getElementById('vibeManagerIeInput');
    
    if (fileInput) fileInput.value = '';
    if (uploadBtn) uploadBtn.disabled = true;
    if (ieInput) ieInput.value = '0.5';
    
    // Populate model dropdown
    populateVibeManagerModelDropdown();
}

function hideVibeManagerUploadModal() {
    const modal = document.getElementById('vibeManagerUploadModal');
    if (modal) {
        modal.style.display = 'none';
        enablePageScroll();
    }
}

function showVibeManagerIeModal(vibeImage) {
    const modal = document.getElementById('vibeManagerIeModal');
    if (modal) modal.style.display = 'block';
    
    // Store the vibe image for later use
    modal.dataset.vibeImageId = vibeImage.id;
    
    // Reset form
    const ieInput = document.getElementById('vibeManagerIeInput2');
    
    if (ieInput) ieInput.value = '0.5';
    
    // Populate model dropdown
    populateVibeManagerIeModelDropdown();
}

function populateVibeManagerModelDropdown() {
    const dropdownMenu = document.getElementById('vibeManagerModelDropdownMenu');
    const selectedSpan = document.getElementById('vibeManagerModelSelected');
    
    if (!dropdownMenu || !selectedSpan) return;
    
    dropdownMenu.innerHTML = '';
    
    // Get V4+ models from optionsData
    if (optionsData && optionsData.models) {
        const v4Models = Object.entries(optionsData.models)
            .filter(([key, value]) => {
                // Filter for V4+ models (kayra, v4, v4_5, etc.)
                const modelKey = key.toLowerCase();
                return modelKey.includes('v4') || modelKey.includes('kayra') || modelKey.includes('opus');
            })
            .sort((a, b) => {
                // Sort by model version (V4.5 first, then V4, then others)
                const aKey = a[0].toLowerCase();
                const bKey = b[0].toLowerCase();
                if (aKey.includes('v4_5')) return -1;
                if (bKey.includes('v4_5')) return 1;
                if (aKey.includes('v4')) return -1;
                if (bKey.includes('v4')) return 1;
                return a[1].localeCompare(b[1]);
            });
        
        v4Models.forEach(([key, displayName]) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (vibeManagerSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;
            
            option.addEventListener('click', () => {
                vibeManagerSelectedModel = key;
                selectedSpan.textContent = displayName;
                closeDropdown(dropdownMenu, document.getElementById('vibeManagerModelDropdownBtn'));
            });
            
            dropdownMenu.appendChild(option);
        });
    }
    
    // Update selected display
    if (optionsData && optionsData.models && optionsData.models[vibeManagerSelectedModel]) {
        selectedSpan.textContent = optionsData.models[vibeManagerSelectedModel];
    }
}

function populateVibeManagerIeModelDropdown() {
    const dropdownMenu = document.getElementById('vibeManagerIeModelDropdownMenu');
    const selectedSpan = document.getElementById('vibeManagerIeModelSelected');
    
    if (!dropdownMenu || !selectedSpan) return;
    
    dropdownMenu.innerHTML = '';
    
    // Get V4+ models from optionsData
    if (optionsData && optionsData.models) {
        const v4Models = Object.entries(optionsData.models)
            .filter(([key, value]) => {
                // Filter for V4+ models (kayra, v4, v4_5, etc.)
                const modelKey = key.toLowerCase();
                return modelKey.includes('v4') || modelKey.includes('kayra') || modelKey.includes('opus');
            })
            .sort((a, b) => {
                // Sort by model version (V4.5 first, then V4, then others)
                const aKey = a[0].toLowerCase();
                const bKey = b[0].toLowerCase();
                if (aKey.includes('v4_5')) return -1;
                if (bKey.includes('v4_5')) return 1;
                if (aKey.includes('v4')) return -1;
                if (bKey.includes('v4')) return 1;
                return a[1].localeCompare(b[1]);
            });
        
        v4Models.forEach(([key, displayName]) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (vibeManagerIeSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;
            
            option.addEventListener('click', () => {
                vibeManagerIeSelectedModel = key;
                selectedSpan.textContent = displayName;
                closeDropdown(dropdownMenu, document.getElementById('vibeManagerIeModelDropdownBtn'));
            });
            
            dropdownMenu.appendChild(option);
        });
    }
    
    // Update selected display
    if (optionsData && optionsData.models && optionsData.models[vibeManagerIeSelectedModel]) {
        selectedSpan.textContent = optionsData.models[vibeManagerIeSelectedModel];
    }
}

function showVibeManagerFromReferenceModal(cacheImage) {
    const modal = document.getElementById('vibeManagerFromReferenceModal');
    if (modal) modal.style.display = 'block';
    
    // Store the reference image
    vibeManagerFromReferenceImage = cacheImage;
    
    // Show preview
    const preview = document.getElementById('vibeManagerFromReferencePreview');
    if (preview) {
        const img = document.createElement('img');
        if (cacheImage.hasPreview) {
            img.src = `/cache/preview/${cacheImage.hash}.webp`;
        } else {
            img.src = `/cache/${cacheImage.hash}`;
        }
        img.alt = `Reference image ${cacheImage.hash}`;
        preview.innerHTML = '';
        preview.appendChild(img);
    }
    
    // Reset form
    const ieInput = document.getElementById('vibeManagerFromReferenceIeInput');
    
    if (ieInput) ieInput.value = '0.5';
    
    // Populate model dropdown
    populateVibeManagerFromReferenceModelDropdown();
}

function hideVibeManagerFromReferenceModal() {
    const modal = document.getElementById('vibeManagerFromReferenceModal');
    if (modal) modal.style.display = 'none';
    vibeManagerFromReferenceImage = null;
}

function populateVibeManagerFromReferenceModelDropdown() {
    const dropdownMenu = document.getElementById('vibeManagerFromReferenceModelDropdownMenu');
    const selectedSpan = document.getElementById('vibeManagerFromReferenceModelSelected');
    
    if (!dropdownMenu || !selectedSpan) return;
    
    dropdownMenu.innerHTML = '';
    
    // Get V4+ models from optionsData
    if (optionsData && optionsData.models) {
        const v4Models = Object.entries(optionsData.models)
            .filter(([key, value]) => {
                // Filter for V4+ models (kayra, v4, v4_5, etc.)
                const modelKey = key.toLowerCase();
                return modelKey.includes('v4') || modelKey.includes('kayra') || modelKey.includes('opus');
            })
            .sort((a, b) => {
                // Sort by model version (V4.5 first, then V4, then others)
                const aKey = a[0].toLowerCase();
                const bKey = b[0].toLowerCase();
                if (aKey.includes('v4_5')) return -1;
                if (bKey.includes('v4_5')) return 1;
                if (aKey.includes('v4')) return -1;
                if (bKey.includes('v4')) return 1;
                return a[1].localeCompare(b[1]);
            });
        
        v4Models.forEach(([key, displayName]) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (vibeManagerFromReferenceSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;
            
            option.addEventListener('click', () => {
                vibeManagerFromReferenceSelectedModel = key;
                selectedSpan.textContent = displayName;
                closeDropdown(dropdownMenu, document.getElementById('vibeManagerFromReferenceModelDropdownBtn'));
            });
            
            dropdownMenu.appendChild(option);
        });
    }
    
    // Update selected display
    if (optionsData && optionsData.models && optionsData.models[vibeManagerFromReferenceSelectedModel]) {
        selectedSpan.textContent = optionsData.models[vibeManagerFromReferenceSelectedModel];
    }
}

async function createVibeManagerFromReference() {
    if (!vibeManagerFromReferenceImage) {
        showError('No reference image selected');
        return;
    }
    
    const ieInput = document.getElementById('vibeManagerFromReferenceIeInput');
    const informationExtraction = ieInput ? parseFloat(ieInput.value) : 0.5;
    
    // Show glass toast
    const toastId = showGlassToast('info', 'Creating Vibe Encoding', 'Processing reference image...', true);
    
    try {
        // Send to encode endpoint with cache image reference
        const response = await fetchWithAuth('/vibe/encode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cacheFile: vibeManagerFromReferenceImage.hash,
                informationExtraction: informationExtraction,
                model: vibeManagerFromReferenceSelectedModel,
                workspace: cacheManagerCurrentWorkspace
            })
        });
        
        if (response.ok) {
            updateGlassToast(toastId, 'success', 'Encoding Complete', 'Vibe encoding created successfully from reference image');
            
            showSuccess('Vibe encoding created successfully from reference image');
            hideVibeManagerFromReferenceModal();
            loadVibeManagerImages(); // Refresh the vibe gallery
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create vibe encoding');
        }
    } catch (error) {
        console.error('Error creating vibe encoding from reference:', error);
        updateGlassToast(toastId, 'error', 'Encoding Failed', 'Failed to create vibe encoding: ' + error.message);
    } finally {
        // Toast will auto-remove after 3 seconds
    }
}



function hideVibeManagerIeModal() {
    const modal = document.getElementById('vibeManagerIeModal');
    if (modal) modal.style.display = 'none';
}

async function loadVibeManagerImages() {
    const loading = document.getElementById('vibeManagerLoading');
    const gallery = document.getElementById('vibeManagerGallery');
    
    if (loading) loading.style.display = 'flex';
    if (gallery) gallery.innerHTML = '';
    
    try {
        // Load vibe images for the current workspace
        const response = await fetchWithAuth(`/vibe/images?workspace=${cacheManagerCurrentWorkspace}`);
        
        if (response.ok) {
            vibeManagerImages = await response.json();
        } else {
            throw new Error(`Failed to load vibe images: ${response.statusText}`);
        }
        
        displayVibeManagerImages();
    } catch (error) {
        console.error('Error loading vibe manager images:', error);
        showError('Failed to load vibe images');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function displayVibeManagerImages() {
    const gallery = document.getElementById('vibeManagerGallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    
    if (vibeManagerImages.length === 0) {
        gallery.innerHTML = '<div class="no-images">No vibe images found in this workspace</div>';
        return;
    }
    
    vibeManagerImages.forEach(vibeImage => {
        const galleryItem = createVibeManagerGalleryItem(vibeImage);
        gallery.appendChild(galleryItem);
    });
}

function createVibeManagerGalleryItem(vibeImage) {
    const item = document.createElement('div');
    item.className = 'vibe-manager-gallery-item';
    item.dataset.id = vibeImage.id;
    
    // Create image element
    const img = document.createElement('img');
    if (vibeImage.preview) {
        img.src = `/cache/preview/${vibeImage.preview}`;
    } else {
        img.src = '/images/placeholder.png'; // Fallback image
    }
    img.alt = `Vibe image ${vibeImage.id}`;
    img.loading = 'lazy';
    
    // Create checkbox for selection mode
    const checkbox = document.createElement('div');
    checkbox.className = 'vibe-manager-gallery-item-checkbox';
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleVibeManagerImageSelection(vibeImage.id);
    });
    
    // Create encodings badges container
    const encodingsContainer = document.createElement('div');
    encodingsContainer.className = 'vibe-manager-gallery-item-encodings';
    
    if (vibeImage.encodings && vibeImage.encodings.length > 0) {
        // Create enhanced badges container
        const badgesContainer = document.createElement('div');
        badgesContainer.className = 'vibe-image-badges';
        
        vibeImage.encodings.forEach(encoding => {
            // Get model display name
            const modelKey = encoding.model || 'kayra';
            const modelDisplayName = optionsData && optionsData.models && optionsData.models[modelKey] ? optionsData.models[modelKey] : modelKey;
            
            // Combined model and IE badge with split colors
            const combinedBadge = document.createElement('div');
            combinedBadge.className = 'vibe-badge split';
            combinedBadge.innerHTML = `
                <span class="badge-text">${modelDisplayName}</span>
                <span class="badge-text">${encoding.informationExtraction || '0.5'}</span>
            `;
            combinedBadge.title = `Model: ${modelDisplayName}, IE: ${encoding.informationExtraction || '0.5'}`;
            badgesContainer.appendChild(combinedBadge);
        });
        
        encodingsContainer.appendChild(badgesContainer);
    } else {
        const noEncodingsBadge = document.createElement('div');
        noEncodingsBadge.className = 'vibe-manager-encoding-badge no-encodings';
        noEncodingsBadge.textContent = 'No IE';
        encodingsContainer.appendChild(noEncodingsBadge);
    }
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'vibe-manager-gallery-item-overlay';
    
    // Create info section
    const infoSection = document.createElement('div');
    infoSection.className = 'vibe-manager-gallery-item-info';
    
    const date = new Date(vibeImage.mtime).toLocaleDateString();
    infoSection.innerHTML = `
        <div>${date}</div>
        <div>${vibeImage.type}</div>
    `;
    
    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'vibe-manager-gallery-item-buttons';
    
    // Create IE request button
    const ieBtn = document.createElement('button');
    ieBtn.className = 'btn-secondary btn-small';
    ieBtn.innerHTML = '<i class="nai-plus"></i>';
    ieBtn.title = 'Request new Information Extraction';
    ieBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showVibeManagerIeModal(vibeImage);
    });
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete vibe image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteVibeManagerImage(vibeImage);
    });
    
    buttonsContainer.appendChild(ieBtn);
    buttonsContainer.appendChild(deleteBtn);
    
    overlay.appendChild(infoSection);
    overlay.appendChild(buttonsContainer);
    
    item.appendChild(img);
    item.appendChild(checkbox);
    item.appendChild(encodingsContainer);
    item.appendChild(overlay);
    
    // Click to select image
    item.addEventListener('click', () => {
        if (vibeManagerIsSelectionMode) {
            toggleVibeManagerImageSelection(vibeImage.id);
        }
    });
    
    return item;
}

// Vibe Manager Multi-Select Functions
function toggleVibeManagerImageSelection(vibeImageId) {
    if (vibeManagerSelectedImages.has(vibeImageId)) {
        vibeManagerSelectedImages.delete(vibeImageId);
    } else {
        vibeManagerSelectedImages.add(vibeImageId);
    }
    
    updateVibeManagerSelectionMode();
    updateVibeManagerGallerySelection();
}

function updateVibeManagerSelectionMode() {
    const gallery = document.getElementById('vibeManagerGallery');
    const moveBtn = document.getElementById('vibeManagerMoveBtn');
    
    if (!gallery) return;
    
    if (vibeManagerSelectedImages.size > 0) {
        vibeManagerIsSelectionMode = true;
        gallery.classList.add('selection-mode');
        if (moveBtn) moveBtn.style.display = 'inline-block';
    } else {
        vibeManagerIsSelectionMode = false;
        gallery.classList.remove('selection-mode');
        if (moveBtn) moveBtn.style.display = 'none';
    }
}

function updateVibeManagerGallerySelection() {
    const gallery = document.getElementById('vibeManagerGallery');
    if (!gallery) return;
    
    const items = gallery.querySelectorAll('.vibe-manager-gallery-item');
    items.forEach(item => {
        const vibeImageId = item.dataset.id;
        const checkbox = item.querySelector('.vibe-manager-gallery-item-checkbox');
        
        if (vibeManagerSelectedImages.has(vibeImageId)) {
            item.classList.add('selected');
            checkbox.checked = true;
        } else {
            item.classList.remove('selected');
            checkbox.checked = false;
        }
    });
}



function updateVibeManagerBulkActions() {
    const moveBtn = document.getElementById('vibeManagerMoveBtn');
    
    if (vibeManagerSelectedImages.size > 0) {
        moveBtn.innerHTML = `<i class="fas fa-arrow-right"></i> Move Selected (${vibeManagerSelectedImages.size})`;
    } else {
        moveBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Move Selected';
    }
}

function showVibeManagerDeleteModal() {
    if (vibeManagerSelectedImages.size === 0) {
        showError('No vibe images selected');
        return;
    }
    
    const modal = document.getElementById('vibeManagerDeleteModal');
    if (modal) {
        modal.style.display = 'flex';
        disablePageScroll();
    }
}

function hideVibeManagerDeleteModal() {
    const modal = document.getElementById('vibeManagerDeleteModal');
    if (modal) {
        modal.style.display = 'none';
        enablePageScroll();
    }
}

async function deleteSelectedVibeImages() {
    const checkboxes = document.querySelectorAll('#vibeManagerDeleteItemsList .vibe-delete-items input[type="checkbox"]:checked');
    
    if (checkboxes.length === 0) {
        showError('No items selected for deletion');
        return;
    }
    
    const confirmMessage = `Are you sure you want to delete ${checkboxes.length} selected item(s)?`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const toastId = showGlassToast('info', 'Deleting Items', 'Processing deletion...', true);
        
        // Process selected items
        const vibesToDelete = [];
        const encodingsToDelete = [];
        
        checkboxes.forEach(checkbox => {
            const itemId = checkbox.id.replace('delete-', '');
            const itemElement = checkbox.closest('.vibe-delete-item');
            
            // Check if this is a vibe or encoding based on the badge type
            const badge = itemElement.querySelector('.vibe-badge');
            if (badge.classList.contains('vibe-only')) {
                // This is an entire vibe
                vibesToDelete.push(itemId);
            } else {
                // This is an encoding - extract vibeId, model, and ie from the badge
                const badgeTexts = badge.querySelectorAll('.badge-text');
                if (badgeTexts.length >= 2) {
                    const model = badgeTexts[0].textContent;
                    const ie = parseFloat(badgeTexts[1].textContent);
                    
                    // Find the vibe that contains this encoding
                    const vibe = vibeManagerImages.find(v => v.encodings && v.encodings.some(e => 
                        e.model === model && e.informationExtraction === ie
                    ));
                    
                    if (vibe) {
                        encodingsToDelete.push({
                            vibeId: vibe.id,
                            model: model,
                            informationExtraction: ie
                        });
                    }
                }
            }
        });
        
        // Send deletion request
        const response = await fetchWithAuth('/vibe/images/bulk-delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                vibesToDelete: vibesToDelete,
                encodingsToDelete: encodingsToDelete,
                workspace: cacheManagerCurrentWorkspace
            })
        });
        
        if (response.ok) {
            updateGlassToast(toastId, 'success', 'Delete Complete', 'Items deleted successfully');
            
            // Remove deleted vibes from local array
            vibeManagerImages = vibeManagerImages.filter(img => !vibesToDelete.includes(img.id));
            
            // Update encodings for remaining vibes
            encodingsToDelete.forEach(encodingData => {
                vibeManagerImages.forEach(vibe => {
                    if (vibe.encodings && vibe.id === encodingData.vibeId) {
                        vibe.encodings = vibe.encodings.filter(encoding => 
                            !(encoding.model === encodingData.model && encoding.informationExtraction === encodingData.informationExtraction)
                        );
                    }
                });
            });
            
            // Clear selection and exit selection mode
            vibeManagerSelectedImages.clear();
            vibeManagerIsSelectionMode = false;
            
            // Refresh display
            displayVibeManagerImages();
            updateVibeManagerSelectionMode();
            
            showSuccess(`${checkboxes.length} item(s) deleted successfully`);
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete items');
        }
    } catch (error) {
        console.error('Error deleting items:', error);
        showError('Failed to delete items: ' + error.message);
    } finally {
        hideVibeManagerDeleteModal();
    }
}

function showVibeManagerMoveModal() {
    if (vibeManagerSelectedImages.size === 0) {
        showError('No vibe images selected');
        return;
    }
    
    const modal = document.getElementById('vibeManagerMoveModal');
    const moveCount = document.getElementById('vibeManagerMoveCount');
    const targetSelect = document.getElementById('vibeManagerMoveTargetSelect');
    
    moveCount.textContent = vibeManagerSelectedImages.size;
    
    // Populate workspace options
    targetSelect.innerHTML = '';
    workspaces.forEach(workspace => {
        if (workspace.id !== cacheManagerCurrentWorkspace) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            targetSelect.appendChild(option);
        }
    });
    
    modal.style.display = 'flex';
    disablePageScroll();
}

function hideVibeManagerMoveModal() {
    const modal = document.getElementById('vibeManagerMoveModal');
    if (modal) {
        modal.style.display = 'none';
        enablePageScroll();
    }
}

async function moveSelectedVibeImages() {
    const targetWorkspace = document.getElementById('vibeManagerMoveTargetSelect').value;
    
    if (!targetWorkspace) {
        showError('Please select a target workspace');
        return;
    }
    
    try {
        const toastId = showGlassToast('info', 'Moving Vibe Images', 'Moving to target workspace...', true);
        
        const response = await fetchWithAuth('/vibe/images/bulk-move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                imageIds: Array.from(vibeManagerSelectedImages),
                targetWorkspace: targetWorkspace,
                sourceWorkspace: cacheManagerCurrentWorkspace
            })
        });
        
        if (response.ok) {
            updateGlassToast(toastId, 'success', 'Move Complete', 'Vibe images moved successfully');
            
            // Remove moved images from local array
            vibeManagerImages = vibeManagerImages.filter(img => !vibeManagerSelectedImages.has(img.id));
            
            // Clear selection and exit selection mode
            vibeManagerSelectedImages.clear();
            vibeManagerIsSelectionMode = false;
            
            // Refresh display
            displayVibeManagerImages();
            updateVibeManagerSelectionMode();
            
            showSuccess('Vibe images moved successfully');
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move vibe images');
        }
    } catch (error) {
        console.error('Error moving vibe images:', error);
        showError('Failed to move vibe images: ' + error.message);
    } finally {
        hideVibeManagerMoveModal();
    }
}

async function deleteVibeManagerImage(vibeImage) {
    // Set up the vibe image for individual deletion
    vibeManagerSelectedImages.clear();
    vibeManagerSelectedImages.add(vibeImage.id);
    
    // Show the existing delete modal with this single image
    showVibeManagerDeleteModal();
}



async function uploadVibeManagerImage() {
    const fileInput = document.getElementById('vibeManagerFileInput');
    const uploadBtn = document.getElementById('vibeManagerUploadConfirmBtn');
    const ieInput = document.getElementById('vibeManagerIeInput');
    
    if (!fileInput || !fileInput.files.length) return;
    
    const file = fileInput.files[0];
    const model = vibeManagerSelectedModel;
    const informationExtraction = ieInput ? parseFloat(ieInput.value) : 0.5;
    
    uploadBtn.disabled = true;
    
    // Show glass toast
    const toastId = showGlassToast('info', 'Uploading Vibe Image', 'Converting image to base64...', true);
    
    try {
        // Convert file to base64
        const base64 = await fileToBase64(file);
        
        // Update progress
        updateGlassToast(toastId, 'info', 'Encoding Vibe Image', 'Processing image with AI model...');
        
        // Send to encode endpoint
        const response = await fetchWithAuth('/vibe/encode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: base64,
                informationExtraction: informationExtraction,
                model: model,
                workspace: cacheManagerCurrentWorkspace
            })
        });
        
        if (response.ok) {
            updateGlassToast(toastId, 'success', 'Upload Complete', 'Vibe image uploaded and encoded successfully');
            hideVibeManagerUploadModal();
            loadVibeManagerImages(); // Refresh the gallery
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to encode vibe image');
        }
    } catch (error) {
        console.error('Error uploading vibe image:', error);
        updateGlassToast(toastId, 'error', 'Upload Failed', 'Failed to upload vibe image: ' + error.message);
    } finally {
        uploadBtn.disabled = false;
    }
}

async function requestVibeManagerIe() {
    const modal = document.getElementById('vibeManagerIeModal');
    const vibeImageId = modal.dataset.vibeImageId;
    const ieInput = document.getElementById('vibeManagerIeInput2');
    
    if (!vibeImageId) {
        showError('No vibe image selected');
        return;
    }
    
    const model = vibeManagerIeSelectedModel;
    const informationExtraction = ieInput ? parseFloat(ieInput.value) : 0.5;
    
    // Show glass toast
    const toastId = showGlassToast('info', 'Requesting IE', 'Processing new Information Extraction...', true);
    
    try {
        // Send to encode endpoint with existing vibe image ID
        const response = await fetchWithAuth('/vibe/encode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: vibeImageId,
                informationExtraction: informationExtraction,
                model: model,
                workspace: cacheManagerCurrentWorkspace
            })
        });
        
        if (response.ok) {
            updateGlassToast(toastId, 'success', 'IE Complete', 'New Information Extraction requested successfully');
            
            showSuccess('New Information Extraction requested successfully');
            hideVibeManagerIeModal();
            loadVibeManagerImages(); // Refresh the gallery
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to request Information Extraction');
        }
    } catch (error) {
        console.error('Error requesting Information Extraction:', error);
        updateGlassToast(toastId, 'error', 'IE Failed', 'Failed to request Information Extraction: ' + error.message);
    } finally {
        // Toast will auto-remove after 3 seconds
    }
}

// Helper function to convert file to base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data URL prefix
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

// Initialize cache manager functionality
function initializeCacheManager() {
    // Reference manager button
    const cacheManagerBtn = document.getElementById('cacheManagerBtn');
    if (cacheManagerBtn) {
        cacheManagerBtn.addEventListener('click', showCacheManagerModal);
    }
    
    // Reference manager modal close button
    const closeCacheManagerBtn = document.getElementById('closeCacheManagerBtn');
    if (closeCacheManagerBtn) {
        closeCacheManagerBtn.addEventListener('click', hideCacheManagerModal);
    }
    
    // Reference manager refresh button
    const refreshBtn = document.getElementById('cacheManagerRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const activeTab = document.querySelector('.cache-manager-tabs .tab-btn.active');
            if (activeTab && activeTab.dataset.tab === 'vibe') {
                loadVibeManagerImages();
            } else {
                loadCacheManagerImages();
            }
        });
    }
    
    // Reference manager upload dropdown
    const uploadDropdownBtn = document.getElementById('cacheManagerUploadDropdownBtn');
    const uploadDropdownMenu = document.getElementById('cacheManagerUploadDropdownMenu');
    if (uploadDropdownBtn && uploadDropdownMenu) {
        uploadDropdownBtn.addEventListener('click', () => {
            toggleDropdown(uploadDropdownMenu, uploadDropdownBtn);
        });
        
        // Handle upload type selection
        const uploadOptions = uploadDropdownMenu.querySelectorAll('.custom-dropdown-option');
        uploadOptions.forEach(option => {
            option.addEventListener('click', () => {
                const uploadType = option.dataset.uploadType;
                if (uploadType === 'reference') {
                    showCacheManagerUploadModal();
                } else if (uploadType === 'vibe') {
                    showVibeManagerUploadModal();
                }
                closeDropdown(uploadDropdownMenu, uploadDropdownBtn);
            });
        });
    }
    
    // Reference manager move button
    const moveBtn = document.getElementById('cacheManagerMoveBtn');
    if (moveBtn) {
        moveBtn.addEventListener('click', showCacheManagerMoveModal);
    }
    
    // Tab switching functionality
    const tabButtons = document.querySelectorAll('.cache-manager-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchCacheManagerTab(tabName);
        });
    });
    
    // Upload modal controls
    const closeUploadBtn = document.getElementById('closeCacheManagerUploadBtn');
    const uploadCancelBtn = document.getElementById('cacheManagerUploadCancelBtn');
    const uploadConfirmBtn = document.getElementById('cacheManagerUploadConfirmBtn');
    const fileInput = document.getElementById('cacheManagerFileInput');
    
    if (closeUploadBtn) closeUploadBtn.addEventListener('click', hideCacheManagerUploadModal);
    if (uploadCancelBtn) uploadCancelBtn.addEventListener('click', hideCacheManagerUploadModal);
    if (uploadConfirmBtn) uploadConfirmBtn.addEventListener('click', uploadCacheManagerImages);
    
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const uploadBtn = document.getElementById('cacheManagerUploadConfirmBtn');
            if (uploadBtn) {
                uploadBtn.disabled = !fileInput.files.length;
            }
        });
    }
    
    // Vibe upload modal controls
    const closeVibeUploadBtn = document.getElementById('closeVibeManagerUploadBtn');
    const vibeUploadCancelBtn = document.getElementById('vibeManagerUploadCancelBtn');
    const vibeUploadConfirmBtn = document.getElementById('vibeManagerUploadConfirmBtn');
    const vibeFileInput = document.getElementById('vibeManagerFileInput');
    const vibeIeSlider = document.getElementById('vibeManagerIeSlider');
    const vibeIeValue = document.getElementById('vibeManagerIeValue');
    
    if (closeVibeUploadBtn) closeVibeUploadBtn.addEventListener('click', hideVibeManagerUploadModal);
    if (vibeUploadCancelBtn) vibeUploadCancelBtn.addEventListener('click', hideVibeManagerUploadModal);
    if (vibeUploadConfirmBtn) vibeUploadConfirmBtn.addEventListener('click', uploadVibeManagerImage);
    
    if (vibeFileInput) {
        vibeFileInput.addEventListener('change', () => {
            const uploadBtn = document.getElementById('vibeManagerUploadConfirmBtn');
            if (uploadBtn) {
                uploadBtn.disabled = !vibeFileInput.files.length;
            }
        });
    }
    
    // Add scroll wheel functionality for IE inputs
    const vibeIeInput = document.getElementById('vibeManagerIeInput');
    if (vibeIeInput) {
        vibeIeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.5;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }
    
    // Vibe model dropdowns
    const vibeModelDropdownBtn = document.getElementById('vibeManagerModelDropdownBtn');
    const vibeModelDropdownMenu = document.getElementById('vibeManagerModelDropdownMenu');
    const vibeIeModelDropdownBtn = document.getElementById('vibeManagerIeModelDropdownBtn');
    const vibeIeModelDropdownMenu = document.getElementById('vibeManagerIeModelDropdownMenu');
    
    if (vibeModelDropdownBtn && vibeModelDropdownMenu) {
        vibeModelDropdownBtn.addEventListener('click', () => {
            toggleDropdown(vibeModelDropdownMenu, vibeModelDropdownBtn);
        });
    }
    
    if (vibeIeModelDropdownBtn && vibeIeModelDropdownMenu) {
        vibeIeModelDropdownBtn.addEventListener('click', () => {
            toggleDropdown(vibeIeModelDropdownMenu, vibeIeModelDropdownBtn);
        });
    }
    
    // Vibe from reference model dropdown
    const vibeFromReferenceModelDropdownBtn = document.getElementById('vibeManagerFromReferenceModelDropdownBtn');
    const vibeFromReferenceModelDropdownMenu = document.getElementById('vibeManagerFromReferenceModelDropdownMenu');
    
    if (vibeFromReferenceModelDropdownBtn && vibeFromReferenceModelDropdownMenu) {
        vibeFromReferenceModelDropdownBtn.addEventListener('click', () => {
            toggleDropdown(vibeFromReferenceModelDropdownMenu, vibeFromReferenceModelDropdownBtn);
        });
    }
    
    // Vibe IE modal controls
    const closeVibeIeBtn = document.getElementById('closeVibeManagerIeBtn');
    const vibeIeCancelBtn = document.getElementById('vibeManagerIeCancelBtn');
    const vibeIeConfirmBtn = document.getElementById('vibeManagerIeConfirmBtn');
    const vibeIeSlider2 = document.getElementById('vibeManagerIeSlider2');
    const vibeIeValue2 = document.getElementById('vibeManagerIeValue2');
    
    if (closeVibeIeBtn) closeVibeIeBtn.addEventListener('click', hideVibeManagerIeModal);
    if (vibeIeCancelBtn) vibeIeCancelBtn.addEventListener('click', hideVibeManagerIeModal);
    if (vibeIeConfirmBtn) vibeIeConfirmBtn.addEventListener('click', requestVibeManagerIe);
    
    // Add scroll wheel functionality for IE inputs
    const vibeIeInput2 = document.getElementById('vibeManagerIeInput2');
    if (vibeIeInput2) {
        vibeIeInput2.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.5;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }
    
    // Vibe from reference modal controls
    const closeVibeFromReferenceBtn = document.getElementById('closeVibeManagerFromReferenceBtn');
    const vibeFromReferenceCancelBtn = document.getElementById('vibeManagerFromReferenceCancelBtn');
    const vibeFromReferenceConfirmBtn = document.getElementById('vibeManagerFromReferenceConfirmBtn');
    const vibeFromReferenceIeInput = document.getElementById('vibeManagerFromReferenceIeInput');
    
    if (closeVibeFromReferenceBtn) closeVibeFromReferenceBtn.addEventListener('click', hideVibeManagerFromReferenceModal);
    if (vibeFromReferenceCancelBtn) vibeFromReferenceCancelBtn.addEventListener('click', hideVibeManagerFromReferenceModal);
    if (vibeFromReferenceConfirmBtn) vibeFromReferenceConfirmBtn.addEventListener('click', createVibeManagerFromReference);
    
    // Add scroll wheel functionality for IE inputs
    if (vibeFromReferenceIeInput) {
        vibeFromReferenceIeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.5;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }
    
    // Move modal controls
    const closeMoveBtn = document.getElementById('closeCacheManagerMoveBtn');
    const moveCancelBtn = document.getElementById('cacheManagerMoveCancelBtn');
    const moveConfirmBtn = document.getElementById('cacheManagerMoveConfirmBtn');
    
    if (closeMoveBtn) closeMoveBtn.addEventListener('click', hideCacheManagerMoveModal);
    if (moveCancelBtn) moveCancelBtn.addEventListener('click', hideCacheManagerMoveModal);
    if (moveConfirmBtn) moveConfirmBtn.addEventListener('click', moveCacheManagerImages);
    
    // Vibe Manager bulk action controls
    const vibeManagerMoveBtn = document.getElementById('vibeManagerMoveBtn');
    
    if (vibeManagerMoveBtn) vibeManagerMoveBtn.addEventListener('click', showVibeManagerMoveModal);
    
    // Vibe Manager delete modal controls
    const closeVibeDeleteBtn = document.getElementById('closeVibeManagerDeleteBtn');
    const vibeDeleteCancelBtn = document.getElementById('vibeManagerDeleteCancelBtn');
    const vibeDeleteConfirmBtn = document.getElementById('vibeManagerDeleteConfirmBtn');
    
    if (closeVibeDeleteBtn) closeVibeDeleteBtn.addEventListener('click', hideVibeManagerDeleteModal);
    if (vibeDeleteCancelBtn) vibeDeleteCancelBtn.addEventListener('click', hideVibeManagerDeleteModal);
    if (vibeDeleteConfirmBtn) vibeDeleteConfirmBtn.addEventListener('click', deleteSelectedVibeImages);
    
    // Vibe Manager move modal controls
    const closeVibeMoveBtn = document.getElementById('closeVibeManagerMoveBtn');
    const vibeMoveCancelBtn = document.getElementById('vibeManagerMoveCancelBtn');
    const vibeMoveConfirmBtn = document.getElementById('vibeManagerMoveConfirmBtn');
    
    if (closeVibeMoveBtn) closeVibeMoveBtn.addEventListener('click', hideVibeManagerMoveModal);
    if (vibeMoveCancelBtn) vibeMoveCancelBtn.addEventListener('click', hideVibeManagerMoveModal);
    if (vibeMoveConfirmBtn) vibeMoveConfirmBtn.addEventListener('click', moveSelectedVibeImages);
    
    // Close modals when clicking outside
    const modals = ['cacheManagerModal', 'cacheManagerUploadModal', 'cacheManagerMoveModal', 'vibeManagerUploadModal', 'vibeManagerIeModal', 'vibeManagerFromReferenceModal', 'vibeManagerDeleteModal', 'vibeManagerMoveModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (modalId === 'cacheManagerModal') {
                        hideCacheManagerModal();
                    } else if (modalId === 'cacheManagerUploadModal') {
                        hideCacheManagerUploadModal();
                    } else if (modalId === 'cacheManagerMoveModal') {
                        hideCacheManagerMoveModal();
                    } else if (modalId === 'vibeManagerUploadModal') {
                        hideVibeManagerUploadModal();
                    } else if (modalId === 'vibeManagerIeModal') {
                        hideVibeManagerIeModal();
                    } else if (modalId === 'vibeManagerFromReferenceModal') {
                        hideVibeManagerFromReferenceModal();
                    } else if (modalId === 'vibeManagerDeleteModal') {
                        hideVibeManagerDeleteModal();
                    } else if (modalId === 'vibeManagerMoveModal') {
                        hideVibeManagerMoveModal();
                    }
                }
            });
        }
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        const vibeModelDropdown = document.getElementById('vibeManagerModelDropdown');
        const vibeIeModelDropdown = document.getElementById('vibeManagerIeModelDropdown');
        const vibeFromReferenceModelDropdown = document.getElementById('vibeManagerFromReferenceModelDropdown');
        
        if (vibeModelDropdown && !vibeModelDropdown.contains(e.target)) {
            closeDropdown(vibeModelDropdownMenu, vibeModelDropdownBtn);
        }
        
        if (vibeIeModelDropdown && !vibeIeModelDropdown.contains(e.target)) {
            closeDropdown(vibeIeModelDropdownMenu, vibeIeModelDropdownBtn);
        }
        
        if (vibeFromReferenceModelDropdown && !vibeFromReferenceModelDropdown.contains(e.target)) {
            closeDropdown(vibeFromReferenceModelDropdownMenu, vibeFromReferenceModelDropdownBtn);
        }
    });
}

// Tab switching function for cache manager (Reference Model)
function switchCacheManagerTab(tabName) {
    // Update tab buttons
    const tabButtons = document.querySelectorAll('.cache-manager-tabs .tab-btn');
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update tab panes
    const tabPanes = document.querySelectorAll('.cache-manager-body .tab-pane');
    tabPanes.forEach(pane => {
        if (pane.id === `${tabName}-tab`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
    
    // Load appropriate data
    if (tabName === 'references') {
        loadCacheManagerImages();
    } else if (tabName === 'vibe') {
        loadVibeManagerImages();
    }
}

async function updateImageGenCounter() {
    try {
        const response = await fetchWithAuth('/image-counter');
        if (!response.ok) throw new Error('Failed to fetch image counter');
        const data = await response.json();
        const counter = data.count || 0;
        const counterElem = document.getElementById('imageGenCounter');
        if (counterElem) {
            counterElem.textContent = counter;
            counterElem.classList.remove('light-orange', 'orange', 'red');
            if (counter > 300) counterElem.classList.add('red');
            else if (counter > 150) counterElem.classList.add('orange');
            else if (counter > 50) counterElem.classList.add('light-orange');
        }
    } catch (e) {
        const counterElem = document.getElementById('imageGenCounter');
        if (counterElem) counterElem.textContent = '0';
    }
    try {
        const response = await fetchWithAuth('/queue-status');
        if (!response.ok) throw new Error('Failed to fetch queue status');
        const data = await response.json();
        const statusElem = document.getElementById('queueStatus');
        if (statusElem) {
            let msg = '';
            if (data.value === 2) msg = 'LIMITED';
            else if (data.value === 1) msg = 'Warning';
            else msg = 'OK';
            statusElem.textContent = msg;
            statusElem.classList.remove('warn', 'limit');
            if (data.value === 2) statusElem.classList.add('limit');
            else if (data.value === 1) statusElem.classList.add('warn');
        }
    } catch (e) {
        const statusElem = document.getElementById('queueStatus');
        if (statusElem) statusElem.textContent = '';
    }
}
setInterval(updateImageGenCounter, 25000);

let pinModalPromise = null;
function showPinModal() {
    if (pinModalPromise) return pinModalPromise;
    const modal = document.getElementById('pinModal');
    const input = document.getElementById('pinModalInput');
    const form = document.getElementById('pinModalForm');
    const error = document.getElementById('pinModalError');
    const submitBtn = document.getElementById('pinModalSubmitBtn');
    const cancelBtn = document.getElementById('pinModalCancelBtn');
    const closeBtn = document.getElementById('closePinModalBtn');
    error.style.display = 'none';
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
    let resolveFn, rejectFn;
    pinModalPromise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
        function cleanup() {
            modal.style.display = 'none';
            form.removeEventListener('submit', onSubmit);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            pinModalPromise = null;
        }
        function onSubmit(e) {
            e.preventDefault();
            const pin = input.value.trim();
            if (pin.length !== 6 || !/^[0-9]{6}$/.test(pin)) {
                error.textContent = 'Enter a valid 6-digit PIN.';
                error.style.display = 'block';
                return;
            }
            submitBtn.disabled = true;
            error.style.display = 'none';
            fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            }).then(async resp => {
                const data = await resp.json().catch(() => ({}));
                if (resp.ok) {
                    cleanup();
                    resolve();
                } else {
                    error.textContent = data.error || 'Invalid PIN code.';
                    error.style.display = 'block';
                    input.value = '';
                    input.focus();
                }
            }).catch(() => {
                error.textContent = 'Network error. Try again.';
                error.style.display = 'block';
            }).finally(() => {
                submitBtn.disabled = false;
            });
        }
        function onCancel() {
            cleanup();
            reject();
        }
        form.addEventListener('submit', onSubmit);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
    });
    return pinModalPromise;
}
async function ensureSessionValid() {
    // Try a lightweight authenticated endpoint
    try {
        const resp = await fetch('/');
        if (resp.status !== 401) return true;
    } catch {}
    try {
        await showPinModal();
        // Try again after re-auth
        const resp2 = await fetch('/balance');
        return resp2.status !== 401;
    } catch {
        // User cancelled
        window.location.href = '/';
        return false;
    }
}