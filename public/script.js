// Global variables
let isAuthenticated = true;
let subscriptionData = null;
let forcePaidRequest = false;
let allImages = [];
let currentPage = 1;
let imagesPerPage = 12;
let currentImage = null;

let selectedCharacterAutocompleteIndex = -1;

// Selection state
let selectedImages = new Set();
let isSelectionMode = false;

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
// Global resolution definitions
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

// Generate resolution groups from global RESOLUTIONS array
const resolutionGroups = [
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

// Helper functions for sampler mapping
function getSamplerByMeta(meta) {
  return SAMPLER_MAP.find(s => s.meta === meta);
}
function getSamplerByRequest(request) {
  return SAMPLER_MAP.find(s => s.request === request);
}
function getSamplerByDisplay(display) {
  return SAMPLER_MAP.find(s => s.display === display);
}

// Helper functions for noise mapping
function getNoiseByMeta(meta) {
  return NOISE_MAP.find(n => n.meta === meta);
}
function getNoiseByRequest(request) {
  return NOISE_MAP.find(n => n.request === request);
}
function getNoiseByDisplay(display) {
  return NOISE_MAP.find(n => n.display === display);
}

// DOM elements
const logoutButton = document.getElementById('logoutButton');

const manualModal = document.getElementById('manualModal');
const manualForm = document.getElementById('manualForm');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualBtn = document.getElementById('manualBtn');

const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const closeLightboxBtn = document.getElementById('closeLightboxBtn');
const downloadBtn = document.getElementById('downloadBtn');
const generateBtn = document.getElementById('generateBtn');
const presetSelect = document.getElementById('presetSelect');
const resolutionSelect = document.getElementById('resolutionSelect');
const upscaleToggle = document.getElementById('upscaleToggle');
const maskPreviewBtn = document.getElementById('maskPreviewBtn');
const gallery = document.getElementById('gallery');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const loadingOverlay = document.getElementById('loadingOverlay');
const confettiContainer = document.getElementById('confettiContainer');
const controlsWrapper = document.getElementById('controlsWrapper');
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
const customResolutionDropdown = document.getElementById('customResolutionDropdown');
const customResolutionDropdownBtn = document.getElementById('customResolutionDropdownBtn');
const customResolutionDropdownMenu = document.getElementById('customResolutionDropdownMenu');
const customResolutionSelected = document.getElementById('customResolutionSelected');
let selectedResolution = '';
let selectedGroup = '';
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
const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
const manualStrengthValue = document.getElementById('manualStrengthValue');
const manualNoiseValue = document.getElementById('manualNoiseValue');

// Global variables for character autocomplete
let characterAutocompleteTimeout = null;
let currentCharacterAutocompleteTarget = null;

// Global variables for character autocomplete
let characterSearchResults = [];
let characterData = null;

// Global variables for preset autocomplete
let presetAutocompleteTimeout = null;
let currentPresetAutocompleteTarget = null;
let selectedPresetAutocompleteIndex = -1;
let presetSearchResults = [];

const RESOLUTION_GROUPS = {
    'Standard': ['1024x1024', '1152x896', '896x1152', '1216x832', '832x1216', '1344x768', '768x1344', '1536x640', '640x1536'],
    'Portrait': ['1024x1280', '1024x1536', '1024x1792'],
    'Landscape': ['1280x1024', '1536x1024', '1792x1024']
};

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


function closeCustomResolutionDropdown() {
    closeDropdown(customResolutionDropdownMenu, customResolutionDropdownBtn);
}

function renderCustomResolutionDropdown(selectedVal) {
    renderGroupedDropdown(customResolutionDropdownMenu, resolutionGroups, selectCustomResolution, closeCustomResolutionDropdown, selectedVal, resolutionOptionRenderer);
}

function selectCustomResolution(value, group) {
    selectedResolution = value;
    
    // If group is not provided, find it automatically
    if (!group) {
        for (const g of resolutionGroups) {
            const found = g.options.find(o => o.value === value);
            if (found) {
                group = g.group;
                break;
            }
        }
    }
    
    selectedGroup = group;
    
    // Update button display
    const groupObj = resolutionGroups.find(g => g.group === group);
    const optObj = groupObj ? groupObj.options.find(o => o.value === value) : null;
    if (optObj) {
        customResolutionSelected.innerHTML = `${optObj.name}${groupObj.badge ? '<span class="custom-dropdown-badge' + (groupObj.free ? ' free-badge' : '') + '">' + groupObj.badge + '</span>' : ''}`;
    } else {
        customResolutionSelected.textContent = 'Select resolution...';
    }
    // Sync with hidden select for compatibility
    const hiddenSelect = document.getElementById('resolutionSelect');
    if (hiddenSelect) hiddenSelect.value = value;
    // Trigger any listeners (e.g., updateGenerateButton)
    if (typeof updateGenerateButton === 'function') updateGenerateButton();
}

function openDropdown(menu, button) {
    menu.style.display = 'block';
    if (button) button.classList.add('active');
}

function closeDropdown(menu, button) {
    menu.style.display = 'none';
    if (button) button.classList.remove('active');
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

setupDropdown(customResolutionDropdown, customResolutionDropdownBtn, customResolutionDropdownMenu, renderCustomResolutionDropdown, () => selectedResolution);

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
        customPresetSelected.innerHTML = '<i class="nai-heart-enabled"></i> Select preset or pipeline...';
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
    renderGroupedDropdown(manualResolutionDropdownMenu, resolutionGroups, selectManualResolution, closeManualResolutionDropdown, selectedVal, resolutionOptionRenderer);
}

async function selectManualResolution(value, group) {
    manualSelectedResolution = value.toLowerCase();
    
    // If group is not provided, find it automatically
    if (!group) {
        for (const g of resolutionGroups) {
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
    const groupObj = resolutionGroups.find(g => g.group === group);
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
                endpoint = `/preset/${presetName}/raw`;
            } else if (presetType === 'pipeline') {
                type = 'pipeline';
                endpoint = `/pipeline/${presetName}/raw`;
            } else {
                throw new Error('Invalid type');
            }

            const response = await fetchWithAuth(endpoint);
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
                const samplerObj = getSamplerByRequest(data.sampler) || getSamplerByMeta(data.sampler);
                data.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';
            }
            if (data.noiseScheduler || data.noise_schedule) {
                const noiseObj = getNoiseByRequest(data.noiseScheduler || data.noise_schedule) || getNoiseByMeta(data.noiseScheduler || data.noise_schedule);
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
            const samplerObj = getSamplerByMeta(data.sampler);
            data.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';

            const noiseObj = getNoiseByMeta(data.noise_schedule);
            data.noiseScheduler = noiseObj ? noiseObj.meta : 'karras';
            
            name = data.preset_name;
        } else {
            throw new Error('Invalid source');
        }

        // Common form population
        if (manualPrompt) manualPrompt.value = data.prompt || '';
        if (manualUc) manualUc.value = data.uc || '';
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
        
        // Handle new parameters
        // Handle allow_paid setting
        if (data.allow_paid !== undefined) {
            // This would need a UI element to display/set allow_paid
            // For now, we'll just store it in a global variable
            window.currentAllowPaid = data.allow_paid;
        }

        // Handle image source data
        const hasBaseImage = data.image_source;
        const isPipeline = data.request_type === 'pipeline';

        const variationRow = document.getElementById('transformationSection');
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
                
                window.pipelineMaskData = window.currentMaskData = await processCompressedMask(data.mask_compressed, targetWidth, targetHeight);
            } else if (data.mask) {
                window.pipelineMaskData = window.currentMaskData = "data:image/png;base64," + data.mask;
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
                console.log(previewUrl);
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
                
                window.currentMaskData = await processCompressedMask(data.mask_compressed, targetWidth, targetHeight);
            } else if (data.mask !== undefined && data.mask !== null) {
                window.currentMaskData = "data:image/png;base64," + data.mask;
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
            // Metadata-specific: strength, noise, upscale off
            if (manualStrengthValue) {
                manualStrengthValue.value = data.strength || 0.8;
                window.strengthValueLoaded = true;
            }
            if (manualNoiseValue) manualNoiseValue.value = data.noise || 0.1;
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
  const s = SAMPLER_MAP.find(s => s.meta === value);
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
  const n = NOISE_MAP.find(n => n.meta === value);
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
  
  // Trigger any listeners (e.g., updateGenerateButton or manual form update)
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
  // Update price display
  updateManualPriceDisplay();
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
                'variation': 'Current Image'
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

renderManualSamplerDropdown(manualSelectedSampler);
selectManualSampler('k_euler_ancestral');
renderManualResolutionDropdown(manualSelectedResolution);
selectManualResolution('normal_square', 'Normal');
renderCustomResolutionDropdown(selectedResolution);
selectCustomResolution('', 'Default');
renderManualNoiseSchedulerDropdown(manualSelectedNoiseScheduler);
selectManualNoiseScheduler('karras');
renderManualMaskBiasDropdown(manualSelectedMaskBias);
selectManualMaskBias('2');
// Don't render image bias dropdown here - it will be rendered when needed
renderManualModelDropdown(manualSelectedModel);
selectManualModel('v4_5', '');

document.addEventListener('DOMContentLoaded', function() {
    updateControlsVisibility();
    initializeApp();
    
    // Initialize background gradient
    setupEventListeners();
});

// Initialize the application
async function initializeApp() {
    try {
        // Calculate initial images per page based on current window size
        imagesPerPage = calculateImagesPerPage();
        
        if (isAuthenticated) {
            await loadOptions();
            await loadBalance();
        }
        await loadGallery();
        updateGenerateButton();
        
        // Initialize image bias adjustment functionality
        initializeImageBiasAdjustment();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load application data');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Logout button
    logoutButton.addEventListener('click', handleLogout);

    // Manual modal events
    manualBtn.addEventListener('click', showManualModal);
    closeManualBtn.addEventListener('click', hideManualModal);
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
            // TODO: Implement upscale functionality for preview
            showToast('Upscale functionality coming soon!', 'info');
        });
    }
    
    if (manualPreviewVariationBtn) {
        manualPreviewVariationBtn.addEventListener('click', () => {
            // TODO: Implement variation functionality for preview
            showToast('Variation functionality coming soon!', 'info');
        });
    }
    
    if (manualPreviewSeedBtn) {
        manualPreviewSeedBtn.addEventListener('click', () => {
            if (window.lastGeneratedSeed) {
                manualSeed.value = window.lastGeneratedSeed;
                showToast('Seed copied to form!', 'success');
            } else {
                showToast('No seed available for this image', 'error');
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
    
    // Autocomplete events




    // Character autocomplete events (for both prompt and UC fields)
    manualPrompt.addEventListener('input', handleCharacterAutocompleteInput);
    manualPrompt.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    manualUc.addEventListener('input', handleCharacterAutocompleteInput);
    manualUc.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    
    // Preset autocomplete events
    manualPresetName.addEventListener('input', handlePresetAutocompleteInput);
    manualPresetName.addEventListener('keydown', handlePresetAutocompleteKeydown);
    document.addEventListener('click', hideCharacterAutocomplete);
    document.addEventListener('click', hidePresetAutocomplete);
    
    // Character detail events - no longer needed since we're using inline onclick handlers
    // The close button is now created dynamically in the character detail content

    // Lightbox events
    if (closeLightboxBtn) {
        closeLightboxBtn.addEventListener('click', hideLightbox);
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
        }
    });


    // Generation controls
    presetSelect.addEventListener('change', updateGenerateButton);
    resolutionSelect.addEventListener('change', updateGenerateButton);
    generateBtn.addEventListener('click', generateImage);
    maskPreviewBtn.addEventListener('click', showMaskPreview);
    
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
    upscaleToggle.addEventListener('click', toggleUpscale);
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

    // Pagination
    prevPage.addEventListener('click', () => changePage(-1));
    nextPage.addEventListener('click', () => changePage(1));


    

    
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

    // Variety+ toggle
    if (varietyToggle) {
        varietyToggle.addEventListener('click', function() {
            const state = varietyToggle.getAttribute('data-state') === 'on' ? 'off' : 'on';
            varietyToggle.setAttribute('data-state', state);
        });
    }

    // Bulk action event listeners
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const bulkSequenziaBtn = document.getElementById('bulkSequenziaBtn');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    }
    
    if (bulkSequenziaBtn) {
        bulkSequenziaBtn.addEventListener('click', handleBulkSequenzia);
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
    
    // Tab switching functionality for prompt/UC tabs
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('.prompt-tabs');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Remove show-both state
            promptTabs.classList.remove('show-both');
            showBothBtn.classList.remove('active');
            
            // Remove active class from all buttons and panes
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));
            
            // Add active class to clicked button and corresponding pane
            this.classList.add('active');
            document.getElementById(targetTab + '-tab').classList.add('active');
        });
    });
    
    // Show both panes functionality
    if (showBothBtn) {
        showBothBtn.addEventListener('click', function() {
            const isShowingBoth = promptTabs.classList.contains('show-both');
            
            if (isShowingBoth) {
                // Return to single tab mode
                promptTabs.classList.remove('show-both');
                this.classList.remove('active');
                
                // Show tab buttons
                tabButtons.forEach(btn => btn.style.display = 'flex');
                
                // Set Base Prompt as default when returning from show both mode
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanes.forEach(pane => pane.classList.remove('active'));
                
                // Activate the Base Prompt tab
                const promptTabBtn = document.querySelector('.tab-btn[data-tab="prompt"]');
                const promptTabPane = document.getElementById('prompt-tab');
                
                if (promptTabBtn && promptTabPane) {
                    promptTabBtn.classList.add('active');
                    promptTabPane.classList.add('active');
                }
            } else {
                // Show both panes
                promptTabs.classList.add('show-both');
                this.classList.add('active');
                
                // Hide tab buttons when showing both
                tabButtons.forEach(btn => {
                    btn.classList.remove('active');
                    btn.style.display = 'none';
                });
            }
        });
    }
    


    document.getElementById('randomPromptToggleBtn').addEventListener('click', toggleRandomPrompt);
    document.getElementById('randomPromptRefreshBtn').addEventListener('click', executeRandomPrompt);
    document.getElementById('randomPromptNsfwBtn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const state = btn.dataset.state === 'on' ? 'off' : 'on';
        btn.dataset.state = state;
        btn.classList.toggle('active', state === 'on');
        executeRandomPrompt();
    });
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
        resolutionSelect.innerHTML = '<option value="">Unchanged</option>';
        manualResolution.innerHTML = '<option value="">Unchanged</option>';
        RESOLUTIONS.forEach(resolution => {
            const option = document.createElement('option');
            option.value = resolution.value;
            option.textContent = resolution.display;
            resolutionSelect.appendChild(option);
            
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

// Load gallery images
async function loadGallery() {
    try {
        const response = await fetchWithAuth('/images');
        if (response.ok) {
            allImages = await response.json();
            
            displayCurrentPage();
            updatePagination();
            updateControlsVisibility();
        } else {
            console.error('Failed to load gallery:', response.statusText);
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        // Don't throw error for gallery loading failure
        allImages = [];
        displayCurrentPage();
    }
}

// Display current page of images
function displayCurrentPage() {
    const startIndex = (currentPage - 1) * imagesPerPage;
    const endIndex = startIndex + imagesPerPage;
    const pageImages = allImages.slice(startIndex, endIndex);

    gallery.innerHTML = '';

    if (pageImages.length === 0) {
        gallery.innerHTML = '<div class="no-images">No images found</div>';
        return;
    }

    pageImages.forEach(image => {
        const galleryItem = createGalleryItem(image);
        gallery.appendChild(galleryItem);
    });

    updatePagination();
}

// Create gallery item element
function createGalleryItem(image) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    
    // Add selection checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gallery-item-checkbox';
    checkbox.dataset.filename = image.original || image.pipeline || image.pipeline_upscaled;
    checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        handleImageSelection(image, e.target.checked, e);
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
    rerollEditBtn.innerHTML = '<i class="nai-settings"></i>';
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
    
    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(upscaleBtn);
    actionsDiv.appendChild(rerollBtn);
    actionsDiv.appendChild(rerollEditBtn);
    
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
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

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
        const response = await fetchWithAuth(`/metadata/${filenameForMetadata}`);
        
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
            
            // Add seed if available
            if (metadata.layer2Seed) {
                layer2Config.seed = parseInt(metadata.layer2Seed);
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
                const samplerObj = getSamplerByMeta(metadata.sampler);
                layer2Config.sampler = samplerObj ? samplerObj.request : metadata.sampler;
            }
            
            if (metadata.noise_schedule) {
                const noiseObj = getNoiseByMeta(metadata.noise_schedule);
                layer2Config.noiseScheduler = noiseObj ? noiseObj.request : metadata.noise_schedule;
            }
            
            // Build pipeline request body using captured pipeline context
            const pipelineRequestBody = {
                preset: pipelineName,
                layer2: layer2Config,
                resolution: metadata.resolution || undefined
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
                    const metadataResponse = await fetchWithAuth(`/metadata/${generatedFilename}`);
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
                    allow_paid: typeof forcePaidRequest !== 'undefined' ? forcePaidRequest : false
                };

                // Add mask data if it exists
                if (window.currentMaskData) {
                    const compressedMask = saveMaskCompressed();
                    if (compressedMask) {
                        requestBody.mask_compressed = compressedMask;
                    } else {
                        requestBody.mask = window.currentMaskData.replace('data:image/png;base64,', '');
                    }
                }
                
                // Add optional fields if they have values
                if (metadata.uc) {
                    requestBody.uc = metadata.uc;
                }
                
                // Add seed if available
                if (metadata.seed) {
                    requestBody.seed = parseInt(metadata.seed);
                }
                
                if (metadata.sampler) {
                    const samplerObj = getSamplerByMeta(metadata.sampler);
                    requestBody.sampler = samplerObj ? samplerObj.request : metadata.sampler;
                }
                
                if (metadata.noise_schedule) {
                    const noiseObj = getNoiseByMeta(metadata.noise_schedule);
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
                    allow_paid: typeof forcePaidRequest !== 'undefined' ? forcePaidRequest : false
                };
                
                // Add optional fields if they have values
                if (metadata.uc) {
                    requestBody.uc = metadata.uc;
                }
                
                // Add seed if available
                if (metadata.seed) {
                    requestBody.seed = parseInt(metadata.seed);
                }
                
                if (metadata.sampler) {
                    const samplerObj = getSamplerByMeta(metadata.sampler);
                    requestBody.sampler = samplerObj ? samplerObj.request : metadata.sampler;
                }
                
                if (metadata.noise_schedule) {
                    const noiseObj = getNoiseByMeta(metadata.noise_schedule);
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
                if (requestBody.mask_compressed) {
                    requestBody.mask = requestBody.mask_compressed;
                }

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
                    const metadataResponse = await fetchWithAuth(`/metadata/${generatedFilename}`);
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
                showSuccess('Image rerolled successfully!');
            
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
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    try {
        // Determine filename for metadata
        let filenameForMetadata = image.filename || image.pipeline_upscaled || image.pipeline || image.upscaled || image.original;
        if (!filenameForMetadata) {
            throw new Error('No filename available for metadata lookup');
        }

        // Get metadata
        const response = await fetchWithAuth(`/metadata/${filenameForMetadata}`);
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
            updateTransformationDropdownState('reroll', 'Referance Image');

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
            updateTransformationDropdownState('reroll', 'Referance Image');

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

        // Show modal
        manualModal.style.display = 'block';
        await cropImageToResolution();
        if (manualPrompt) manualPrompt.focus();

    } catch (error) {
        console.error('Reroll with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
    }
}

// Upscale an image
async function upscaleImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    // Show loading overlay (same as generation)
    showManualLoading(true, 'Upscaling image...');

    try {
        const upscaleResponse = await fetchWithAuth(`/upscale/${image.original}`, {
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
        showSuccess('Image upscaled successfully!');
        
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

// Update pagination controls
function updatePagination() {
    const totalPages = Math.ceil(allImages.length / imagesPerPage);
    
    prevPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= totalPages;
    
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

// Change page
function changePage(delta) {
    const newPage = currentPage + delta;
    const totalPages = Math.ceil(allImages.length / imagesPerPage);
    
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        displayCurrentPage();
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

// Show/hide controls based on login
function updateControlsVisibility() {
    // Controls are always visible in the app page since authentication is handled by the server
    controlsWrapper.style.display = 'block';
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
    
    // Calculate initial price display
    updateManualPriceDisplay();
    
    // Update button visibility
    updateRequestTypeButtonVisibility();
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
        const nsfwBtn = document.getElementById('randomPromptNsfwBtn');
        
        if (toggleBtn) {
            toggleBtn.dataset.state = 'off';
            toggleBtn.classList.remove('active');
        }
        if (refreshBtn) {
            refreshBtn.style.display = 'none';
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

    return values;
}

// Utility: Add shared fields to request body
function addSharedFieldsToRequestBody(requestBody, values) {
    if (values.uc) requestBody.uc = values.uc;
    if (values.seed) requestBody.seed = parseInt(values.seed);
    
    if (values.sampler) {
        const samplerObj = getSamplerByMeta(values.sampler);
        requestBody.sampler = samplerObj ? samplerObj.request : values.sampler;
    }
    if (values.noiseScheduler) {
        const noiseObj = getNoiseByMeta(values.noiseScheduler);
        requestBody.noiseScheduler = noiseObj ? noiseObj.request : values.noiseScheduler;
    }

    if (values.upscale) requestBody.upscale = true;
    if (typeof varietyEnabled !== "undefined" && varietyEnabled) {
        requestBody.variety = true;
        varietyEnabled = false;
        const varietyBtn = document.getElementById('varietyBtn');
        if (varietyBtn) varietyBtn.setAttribute('data-state', 'off');
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
                const metadataResponse = await fetchWithAuth(`/metadata/${filename}`);
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
    img.onload = function() {
        createConfetti();
        //showSuccess(successMsg);
        
        // Check if we're in wide viewport mode and manual modal is open
        const isWideViewport = window.innerWidth >= 1400;
        const manualModal = document.getElementById('manualModal');
        const isManualModalOpen = manualModal && manualModal.style.display === 'block';
        
        if (isWideViewport && isManualModalOpen) {
            // Update manual modal preview instead of opening lightbox
            // Don't clear context when modal is open in wide viewport mode
            updateManualPreview(imageUrl, blob);
            
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
function updateManualPreview(imageUrl, blob) {
    const previewImage = document.getElementById('manualPreviewImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const seedBtn = document.getElementById('manualPreviewSeedBtn');
    
    if (previewImage && previewPlaceholder) {
        // Show the image and hide placeholder
        previewImage.src = imageUrl;
        previewImage.style.display = 'block';
        previewPlaceholder.style.display = 'none';
        
        // Store the blob URL for download functionality
        previewImage.dataset.blobUrl = imageUrl;
        
        // Show control buttons
        if (downloadBtn) downloadBtn.style.display = 'flex';
        if (upscaleBtn) upscaleBtn.style.display = 'flex';
        if (rerollBtn) rerollBtn.style.display = 'flex';
        if (variationBtn) variationBtn.style.display = 'flex';
        if (seedBtn) seedBtn.style.display = 'flex';
        
        // Initialize zoom functionality
        setTimeout(() => {
            initializeManualPreviewZoom();
        }, 100);
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
        if (seedBtn) seedBtn.style.display = 'none';
        
        // Reset zoom functionality
        resetManualPreviewZoom();
        
        // Clear stored seed
        window.lastGeneratedSeed = null;
        manualPreviewSeedNumber.textContent = '---';
    }
}

async function handleManualGeneration(e) {
    e.preventDefault();

    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

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
                resolution: resolution
            };
            if (useLayer1Seed && pipelineContext.layer1Seed) {
                pipelineRequestBody.layer1_seed = pipelineContext.layer1Seed;
            }
            if (window.currentMaskData) {
                const compressedMask = saveMaskCompressed();
                if (compressedMask) {
                    pipelineRequestBody.mask_compressed = compressedMask;
                } else {
                    pipelineRequestBody.mask = window.currentMaskData.replace('data:image/png;base64,', '');
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
            allow_paid: forcePaidRequest
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
        if (window.currentMaskData) {
            // Add compressed mask for server processing
            const compressedMask = saveMaskCompressed();
            if (compressedMask) {
                requestBody.mask_compressed = compressedMask;
            } else {
                requestBody.mask = window.currentMaskData.replace('data:image/png;base64,', '');
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
            allow_paid: forcePaidRequest
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
            showSuccess(result.message);
            
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
        variety: false, // Will be set below if enabled
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
        const samplerObj = getSamplerByMeta(manualSampler.value);
        presetData.sampler = samplerObj ? samplerObj.request : manualSampler.value;
    }
    
    if (manualNoiseScheduler.value) {
        const noiseObj = getNoiseByMeta(manualNoiseScheduler.value);
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
    const variationImage = document.getElementById('manualVariationImage');
    if (variationImage && variationImage.style.display !== 'none' && window.uploadedImageData && window.uploadedImageData.image_source) {
        // Add image source in the correct format type:value
        presetData.image_source = window.uploadedImageData.image_source;
        
        // Include mask data if it exists
        if (window.currentMaskData) {
            presetData.mask_compressed = window.currentMaskData;
        }
        
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
    
    // Add compressed mask if available
    const compressedMask = saveMaskCompressed();
    if (compressedMask) {
        presetData.mask_compressed = compressedMask;
    }
    
    // Add mask bias if available
    const maskBiasHidden = document.getElementById('manualMaskBias');
    if (maskBiasHidden && maskBiasHidden.value) {
        presetData.mask_bias = parseInt(maskBiasHidden.value);
    }
    
    await saveManualPreset(presetName, presetData);
}

// Character autocomplete functions
function handleCharacterAutocompleteInput(e) {
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
    const searchText = lastDelimiterIndex >= 0 ? 
        textBeforeCursor.substring(lastDelimiterIndex + 1).trim() : 
        textBeforeCursor.trim();
    
    // Clear existing timeout
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
    }
    
    // Set timeout to search after user stops typing
    characterAutocompleteTimeout = setTimeout(() => {
        if (searchText.length >= 2) {
            searchCharacters(searchText, target);
        } else {
            hideCharacterAutocomplete();
        }
    }, 500);
}

function handleCharacterAutocompleteKeydown(e) {
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
        const items = characterAutocompleteList ? characterAutocompleteList.querySelectorAll('.character-autocomplete-item') : [];
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 1, items.length - 1);
                updateCharacterAutocompleteSelection();
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 1, -1);
                updateCharacterAutocompleteSelection();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
                    const selectedItem = items[selectedCharacterAutocompleteIndex];
                    if (selectedItem.dataset.type === 'textReplacement') {
                        selectTextReplacementFullText(selectedItem.dataset.placeholder);
                    } else {
                        // For characters, insert without enhancers
                        selectCharacterWithoutEnhancers(selectedItem.dataset.index);
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
                    const selectedItem = items[selectedCharacterAutocompleteIndex];
                    if (selectedItem.dataset.type === 'textReplacement') {
                        selectTextReplacement(selectedItem.dataset.placeholder);
                    } else {
                        selectCharacterItem(selectedItem.dataset.index);
                    }
                }
                break;
            case 'Escape':
                hideCharacterAutocomplete();
                break;
        }
    }
}

async function searchCharacters(query, target) {
    try {
        const response = await fetchWithAuth(`/auto-complete?q=${encodeURIComponent(query)}`);
        
        if (!response.ok) {
            throw new Error('Failed to search characters');
        }
        
        const characterResults = await response.json();
        
        // Also search through text replacements
        const textReplacementResults = Object.keys(textReplacements)
            .filter(key => key.toLowerCase().includes(query.toLowerCase()))
            .map(key => ({
                type: 'textReplacement',
                name: key,
                description: textReplacements[key],
                placeholder: key // The placeholder name like <NAME>
            }));
        
        // Combine character results and text replacement results
        const allResults = [...characterResults, ...textReplacementResults];
        characterSearchResults = allResults;
        
        if (allResults.length > 0) {
            showCharacterAutocompleteSuggestions(allResults, target);
        } else {
            hideCharacterAutocomplete();
        }
    } catch (error) {
        console.error('Character search error:', error);
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
    
    // Populate character autocomplete list
    characterAutocompleteList.innerHTML = '';
    results.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = 'character-autocomplete-item';
        
        if (result.type === 'textReplacement') {
            // Handle text replacement results
            item.dataset.type = 'textReplacement';
            item.dataset.placeholder = result.placeholder;
            
            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${result.placeholder}</span>
                    <span class="character-copyright">Text Replacement</span>
                </div>
                <div class="character-info-row">
                    <div class="placeholder-desc"><span class="placeholder-desc-text">${result.description}</span></div>
                </div>
            `;
            
            item.addEventListener('click', () => selectTextReplacement(result.placeholder));
        } else {
            // Handle character results
            item.dataset.index = result.index;
            
            // Parse name and copyright from the index string
            const match = result.name.match(/^(.+?)\s*\((.+?)\)$/);
            const name = match ? match[1].trim() : result.name;
            const copyright = match ? match[2].trim() : '';
            
            item.innerHTML = `
                <span class="character-name">${name}</span>
                <span class="character-copyright">${copyright}</span>
            `;
            
            item.addEventListener('click', () => selectCharacterItem(result.index));
        }
        
        characterAutocompleteList.appendChild(item);
    });
    
    // Position overlay
    const rect = target.getBoundingClientRect();
    characterAutocompleteOverlay.style.left = rect.left + 'px';
    characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    characterAutocompleteOverlay.style.width = rect.width + 'px';
    
    characterAutocompleteOverlay.classList.remove('hidden');
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

async function selectCharacterItem(index) {
    try {
        const response = await fetchWithAuth(`/auto-complete/${index}`);
        
        if (!response.ok) {
            throw new Error('Failed to load character data');
        }
        
        const character = await response.json();
        showCharacterDetail(character);
    } catch (error) {
        console.error('Error loading character data:', error);
        showError('Failed to load character data');
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
        newPrompt += ', ' + wrappedPlaceholder;
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
        newPrompt += ', ' + fullText;
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
    }
}

async function selectCharacterWithoutEnhancers(index) {
    try {
        const response = await fetchWithAuth(`/auto-complete/${index}`);
        
        if (!response.ok) {
            throw new Error('Failed to load character data');
        }
        
        const character = await response.json();
        
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
                newPrompt += ', ' + character.prompt;
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
    hideCharacterAutocomplete();
    
    // Focus back on the target field
    if (target) {
        target.focus();
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
        const response = await fetchWithAuth(`/preset-autocomplete?q=${encodeURIComponent(query)}`);
        
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
    
    // Position overlay above the input field
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
    const resolution = resolutionSelect.value;
    
    if (!selectedValue) {
        generateBtn.disabled = true;
        maskPreviewBtn.style.display = 'none';
        return;
    }
    
    // Parse the selected value to determine if it's a preset or pipeline
    const [type, name] = selectedValue.split(':');
    
    if (!type || !name) {
        generateBtn.disabled = true;
        maskPreviewBtn.style.display = 'none';
        return;
    }
    
    if (type === 'preset') {
        // For presets, resolution is required and no mask preview
        generateBtn.disabled = false;
        maskPreviewBtn.style.display = 'none';
    } else if (type === 'pipeline') {
        // For pipelines, resolution is optional and show mask preview
        generateBtn.disabled = false;
        maskPreviewBtn.style.display = 'inline-block';
    } else {
        generateBtn.disabled = true;
        maskPreviewBtn.style.display = 'none';
    }
}

// Generate image
async function generateImage() {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    const selectedValue = presetSelect.value;
    const resolution = resolutionSelect.value;
    const upscale = upscaleToggle.getAttribute('data-state') === 'on';
    const variety = varietyToggle && varietyToggle.getAttribute('data-state') === 'on';

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
        let extraParams = '';
        if (type === 'preset') {
            // For presets, resolution is optional
            if (resolution) {
                url = `/preset/${name}/${resolution}?forceGenerate=true${upscale ? '&upscale=true' : ''}${variety ? '&variety=true' : ''}`;
            } else {
                url = `/preset/${name}?forceGenerate=true${upscale ? '&upscale=true' : ''}${variety ? '&variety=true' : ''}`;
            }
        } else if (type === 'pipeline') {
            // For pipelines, resolution is optional (uses pipeline's resolution if not specified)
            const params = new URLSearchParams({
                forceGenerate: 'true'
            });
            if (upscale) params.append('upscale', 'true');
            if (resolution) params.append('resolution', resolution);
            if (variety) params.append('variety', 'true');
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
            const metadataResponse = await fetchWithAuth(`/metadata/${generatedFilename}`);
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
        const response = await fetchWithAuth(`/metadata/${filename}`);
        
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
        const samplerObj = getSamplerByMeta(metadata.sampler);
        samplerElement.textContent = samplerObj ? samplerObj.display : (metadata.sampler || '-');
    }
    
    // Noise Schedule
    const noiseScheduleElement = document.getElementById('metadataNoiseSchedule');
    if (noiseScheduleElement) {
        const noiseObj = getNoiseByMeta(metadata.noise_schedule);
        noiseScheduleElement.textContent = noiseObj ? noiseObj.display : (metadata.noise_schedule || '-');
    }
}

// Setup prompt panel
function setupPromptPanel(metadata) {
    const promptBtn = document.getElementById('promptBtn');
    const promptPanel = document.getElementById('promptPanel');
    const allPromptsContent = document.getElementById('allPromptsContent');
    const closeLightboxBtn = document.getElementById('closeLightboxBtn');
    
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
                if (closeLightboxBtn) {
                    closeLightboxBtn.classList.remove('prompt-panel-open');
                }
            } else {
                // Debug: Log metadata structure
                console.log('Metadata for prompt panel:', metadata);
                console.log('Character prompts:', metadata.characterPrompts);
                
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
                if (closeLightboxBtn) {
                    closeLightboxBtn.classList.add('prompt-panel-open');
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
            showToast(`Copied ${title} to clipboard`, 'success');
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
                showToast(`Copied ${title} to clipboard`, 'success');
            } else {
                throw new Error('execCommand copy failed');
            }
        }
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showToast('Failed to copy to clipboard', 'error');
    }
}

// Function to update background gradient


// Function to show toast notifications
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'nai-info';
    if (type === 'success') icon = 'nai-check';
    if (type === 'error') icon = 'nai-thin-cross';
    
    toast.innerHTML = `
        <i class="${icon}"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
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
    const closeLightboxBtn = document.getElementById('closeLightboxBtn');
    if (closeLightboxBtn) {
        closeLightboxBtn.classList.remove('prompt-panel-open');
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
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
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
            showSuccess('Image deleted successfully!');
            
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

// Show success message
function showSuccess(message) {
    // Simple success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(45deg, #ff4500, #ff6347);
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 3000;
        font-weight: 600;
        box-shadow: 0 5px 15px rgba(255, 69, 0, 0.3);
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Show error message
function showError(message) {
    // Simple error notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 3000;
        font-weight: 600;
        box-shadow: 0 5px 15px rgba(220, 53, 69, 0.3);
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// Update lightbox controls based on image type
function updateLightboxControls(image) {
    const downloadBtn = document.getElementById('downloadBtn');
    const rerollBtn = document.getElementById('lightboxRerollBtn');
    const rerollEditBtn = document.getElementById('lightboxRerollEditBtn');
    const variationBtn = document.getElementById('lightboxVariationBtn');
    const upscaleBtn = document.getElementById('lightboxUpscaleBtn');
    const deleteBtn = document.getElementById('lightboxDeleteBtn');
    const toggleBaseBtn = document.getElementById('toggleBaseImageBtn');
    
    // Handle mask images (show only download button)
    if (image.isMask) {
        downloadBtn.style.display = 'inline-block';
        rerollBtn.style.display = 'none';
        rerollEditBtn.style.display = 'none';
        upscaleBtn.style.display = 'none';
        deleteBtn.style.display = 'none';
        
        // Set up download for mask
        downloadBtn.onclick = (e) => {
            e.preventDefault();
            downloadImage(image);
        };
        return;
    }
    
    // Always show download button for regular images
    downloadBtn.style.display = 'inline-block';
    
    // Show reroll button for all images (both original and upscaled)
    rerollBtn.style.display = 'inline-block';
    
    // Show variation button for all images (both original and upscaled)
    variationBtn.style.display = 'inline-block';
    
    // Show combined edit button for all images (both original and upscaled)
    rerollEditBtn.style.display = 'inline-block';
    
    // Show upscale button only for non-upscaled images
    if (image.upscaled || image.pipeline_upscaled) {
        upscaleBtn.style.display = 'none';
    } else {
        upscaleBtn.style.display = 'inline-block';
    }
    
    // Show delete button only for logged-in users
    if (isAuthenticated) {
        deleteBtn.style.display = 'inline-block';
    } else {
        deleteBtn.style.display = 'none';
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
    downloadBtn.onclick = (e) => {
        e.preventDefault();
        downloadImage(imageObj);
    };
    rerollBtn.onclick = () => rerollImage(imageObj); // Direct reroll
    rerollEditBtn.onclick = () => rerollImageWithEdit(imageObj); // Combined edit (reroll/variation)
    variationBtn.onclick = () => variationImage(imageObj); // Direct variation
    upscaleBtn.onclick = () => upscaleImage(imageObj);
    deleteBtn.onclick = () => deleteImage(imageObj); // Delete image
    
    // Set up toggle base image functionality
    if (toggleBaseBtn.style.display !== 'none') {
        toggleBaseBtn.onclick = () => toggleBaseImage(imageObj);
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

// Calculate optimal images per page based on window size
function calculateImagesPerPage() {
    const gallery = document.querySelector('.gallery');
    if (!gallery) return 12; // Default fallback
    
    // Get gallery container dimensions
    const galleryRect = gallery.getBoundingClientRect();
    const galleryWidth = galleryRect.width;
    
    // If gallery width is 0, use window width as fallback
    const effectiveWidth = galleryWidth > 0 ? galleryWidth : window.innerWidth - 40; // 40px for margins
    
    // Calculate items per row based on CSS grid (250px min + 20px gap)
    const itemWidth = 250 + 20; // minmax(250px, 1fr) + gap
    const itemsPerRow = Math.floor(effectiveWidth / itemWidth);
    
    // Ensure at least 1 item per row and at most 8 items per row
    const safeItemsPerRow = Math.max(1, Math.min(8, itemsPerRow));
    
    // Calculate for 4 rows
    const newImagesPerPage = safeItemsPerRow * 4;
    
    
    return newImagesPerPage;
}

let resizeTimeout = null;
// Debounced resize handler
function handleResize() {
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }
    
    resizeTimeout = setTimeout(() => {
        const newImagesPerPage = calculateImagesPerPage();
        
        // Only update if the number of images per page has changed
        if (newImagesPerPage !== imagesPerPage) {
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
    }, 250); // 250ms delay
}

// Show mask preview for pipelines
async function showMaskPreview() {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

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

// Toggle upscale button functionality
function toggleUpscale() {
    const currentState = upscaleToggle.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    
    upscaleToggle.setAttribute('data-state', newState);
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
        const samplerObj = getSamplerByMeta(metadata.sampler);
        samplerElement.textContent = samplerObj ? samplerObj.display : (metadata.sampler || '-');
    }
    
    // Noise Schedule
    const noiseScheduleElement = document.getElementById('dialogMetadataNoiseSchedule');
    if (noiseScheduleElement) {
        const noiseObj = getNoiseByMeta(metadata.noise_schedule);
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

// Show/hide mask bias dropdown based on pipeline/resolution
function updateMaskBiasDropdown() {
    if (!presetSelect || !resolutionSelect || !manualMaskBiasGroup) return;
    if (window.currentMaskData) {
        manualMaskBiasGroup.style.display = 'none';
        return;
    }
    const selectedValue = presetSelect.value;
    const [type, name] = selectedValue.split(':');
    if (type !== 'pipeline' || !name) {
        manualMaskBiasGroup.style.display = 'none';
        return;
    }
    const pipelinePresetRes = getPipelinePresetResolution(name);
    const selectedRes = resolutionSelect.value;
    if (!pipelinePresetRes || !selectedRes) {
        manualMaskBiasGroup.style.display = 'none';
        return;
    }
    const presetDims = getDimensionsFromResolution(pipelinePresetRes);
    const selectedDims = getDimensionsFromResolution(selectedRes);
    if (!presetDims || !selectedDims) {
        manualMaskBiasGroup.style.display = 'none';
        return;
    }
    // Show dropdown only if aspect ratio or size does not match
    if (presetDims.width !== selectedDims.width || presetDims.height !== selectedDims.height) {
        manualMaskBiasGroup.style.display = '';
    } else {
        manualMaskBiasGroup.style.display = 'none';
    }
}

// Hook into preset and resolution changes
presetSelect.addEventListener('change', updateMaskBiasDropdown);
resolutionSelect.addEventListener('change', updateMaskBiasDropdown);

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
// This is now handled in the custom dropdown logic

// Update all fetch calls to NOT send auth or Bearer for browser UI
// Add a helper to handle 401 responses globally
async function fetchWithAuth(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        window.location.href = '/';
        return Promise.reject(new Error('Not authenticated'));
    }
    return response;
}

// Replace all fetch(...) calls with fetchWithAuth(...) for browser UI
// For example:
// const response = await fetch('/options');
// becomes:
// const response = await fetchWithAuth('/options');

// Handle image upload from file input
async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showError('Please select an image file');
        return;
    }
    
    await uploadImage(file);
    
    // Clear the input so the same file can be selected again
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
                await uploadImage(file);
            }
            break;
        }
    }
}

// Upload image to server
async function uploadImage(file) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
    try {
        showLoading(true, 'Uploading image...');
        
        const formData = new FormData();
        formData.append('image', file);
        
        const response = await fetchWithAuth('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Image uploaded successfully!');
            
            // Refresh gallery to show the new image
            setTimeout(async () => {
                await loadGallery();
            }, 1000);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        showError('Image upload failed: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Handle manual image upload for variation/reroll
async function handleManualImageUpload(file) {
    if (!file.type.startsWith('image/')) {
        showError('Please select an image file');
        return;
    }
    
    try {
        showManualLoading(true, 'Uploading base image...');
        
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetchWithAuth('/upload-base', {
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
    cropImageToResolution();
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

// Replace repositionBiasImage with cropImageToResolution
async function cropImageToResolution() {
    if (manualModal && manualModal.style.display !== 'block') return;
    if (!window.uploadedImageData) {
        console.warn('No uploaded image data available for cropping');
        return;
    }

    try {
        // Clean up any existing blob URLs before creating new ones
        cleanupBlobUrls();
        
        // Get the image data URL - handle file:, cache:, and data: types
        let imageDataUrl = window.uploadedImageData.originalDataUrl;
        
        if (!imageDataUrl) {
            // Fetch the image based on the image source
            const imageSource = window.uploadedImageData.image_source;
            if (imageSource) {
                if (imageSource.startsWith('data:')) {
                    // Handle data: URLs (like placeholder images)
                    imageDataUrl = imageSource;
                } else {
                    let imageUrl = null;
                    if (imageSource.startsWith('file:')) {
                        // Handle file: type - fetch from /images/
                        imageUrl = `/images/${imageSource.replace('file:', '')}`;
                    } else if (imageSource.startsWith('cache:')) {
                        // Handle cache: type - fetch from /cache/preview/
                        imageUrl = `/cache/preview/${imageSource.replace('cache:', '')}.webp`;
                    }
                    if (imageUrl) {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        imageDataUrl = URL.createObjectURL(blob);
                    }
                }
                
                // Store the data URL for future use
                window.uploadedImageData.originalDataUrl = imageDataUrl;
            }
        }
        
        if (!imageDataUrl) {
            console.warn('Could not get image data URL for cropping');
            return;
        }

        const bias = (window.uploadedImageData.bias !== undefined && window.uploadedImageData.bias !== null) ? window.uploadedImageData.bias : 2;
        const croppedBlobUrl = await cropImageToResolutionInternal(imageDataUrl, bias);
        
        // Update the preview image
        const variationImage = document.getElementById('manualVariationImage');
        if (variationImage) {
            variationImage.src = croppedBlobUrl;
            variationImage.style.display = 'block';
            setTimeout(updateMaskPreview, 100);
        }

        window.uploadedImageData.croppedBlobUrl = croppedBlobUrl;
    } catch (error) {
        console.error('Error cropping image:', error);
        showError('Failed to crop image to resolution');
    }
}

// Internal function to crop image to resolution (existing function, keeping for compatibility)
function cropImageToResolutionInternal(dataUrl, bias) {
    const biasFractions = [0, 0.25, 0.5, 0.75, 1];
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
    const filename = image.original || image.pipeline || image.pipeline_upscaled;
    const item = event.target.closest('.gallery-item');
    
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
    const gallery = document.getElementById('gallery');
    
    if (selectedImages.size > 0) {
        bulkActionsBar.style.display = 'flex';
        selectedCount.textContent = selectedImages.size;
        gallery.classList.add('selection-mode');
        isSelectionMode = true;
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

async function handleBulkDelete() {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
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
        
        const response = await fetchWithAuth('/images/bulk-delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filenames: Array.from(selectedImages)
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
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
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
        
        const response = await fetchWithAuth('/images/send-to-sequenzia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filenames: Array.from(selectedImages)
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
        document.getElementById('manualPrompt').value = promptData[0] || '';
        document.getElementById('manualUc').value = '<NUC_3>';

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
 * Toggles the random prompt generation feature on and off.
 */
async function toggleRandomPrompt() {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
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
        nsfwBtn.style.display = 'none';

        if (lastPromptState) {
            document.getElementById('manualPrompt').value = lastPromptState.basePrompt;
            document.getElementById('manualUc').value = lastPromptState.baseUc;
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
        nsfwBtn.style.display = '';
        
        // Check if we have a saved random prompt state
        if (savedRandomPromptState) {
            // Restore the last random prompt values
            document.getElementById('manualPrompt').value = savedRandomPromptState.basePrompt;
            document.getElementById('manualUc').value = savedRandomPromptState.baseUc;
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
                            <i class="nai-pen-tip-light"></i> Prompt
                        </button>
                        <button type="button" class="tab-btn" data-tab="uc">
                            <i class="fas fa-ban"></i> UC
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
                        <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..."></textarea>
                    </div>
                    <div class="tab-pane" id="${characterId}_uc-tab" data-label="UC">
                        <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content..."></textarea>
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
    }
    
    if (ucField) {
        ucField.addEventListener('input', handleCharacterAutocompleteInput);
        ucField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    }
    
    // Add tab switching functionality for character prompt tabs
    const characterTabButtons = characterItem.querySelectorAll('.tab-btn');
    const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
    
    characterTabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Remove active class from all buttons and panes
            characterTabButtons.forEach(btn => btn.classList.remove('active'));
            characterTabPanes.forEach(pane => pane.classList.remove('active'));
            
            // Add active class to clicked button and corresponding pane
            this.classList.add('active');
            document.getElementById(`${characterId}_${targetTab}-tab`).classList.add('active');
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
    characterItem.classList.add('collapsed');
    updateCharacterPromptCollapseButton(characterId, true);
    
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
                            <i class="nai-pen-tip-light"></i> Prompt
                        </button>
                        <button type="button" class="tab-btn" data-tab="uc">
                            <i class="fas fa-ban"></i> UC
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
                        <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt...">${character.prompt || ''}</textarea>
                    </div>
                    <div class="tab-pane" id="${characterId}_uc-tab" data-label="UC">
                        <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content...">${character.uc || ''}</textarea>
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
        }
        
        if (ucField) {
            ucField.addEventListener('input', handleCharacterAutocompleteInput);
            ucField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
        }
        
        // Add tab switching functionality for character prompt tabs
        const characterTabButtons = characterItem.querySelectorAll('.tab-btn');
        const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
        
        characterTabButtons.forEach(button => {
            button.addEventListener('click', function() {
                const targetTab = this.getAttribute('data-tab');
                
                // Remove active class from all buttons and panes
                characterTabButtons.forEach(btn => btn.classList.remove('active'));
                characterTabPanes.forEach(pane => pane.classList.remove('active'));
                
                // Add active class to clicked button and corresponding pane
                this.classList.add('active');
                document.getElementById(`${characterId}_${targetTab}-tab`).classList.add('active');
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
        
        // Set default collapsed state for loaded characters
        characterItem.classList.add('collapsed');
        updateCharacterPromptCollapseButton(characterId, true);
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
        const samplerObj = getSamplerByMeta(sampler) || { meta: 'k_euler_ancestral' };
        
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
    const delta = e.deltaY > 0 ? -1 : 1;
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
        
        // Set inpaint button to on
        if (inpaintBtn) {
            inpaintBtn.setAttribute('data-state', 'on');
            inpaintBtn.classList.add('active');
        }
        
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
// Helper function to process compressed mask to display resolution
function processCompressedMask(compressedMaskBase64, targetWidth, targetHeight, callback) {
    return new Promise((resolve, reject) => {
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
                reject(error);
            }
        };
        
        img.onerror = function() {
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
        
    // Hide mask bias dropdown when mask is created/edited
    updateMaskBiasDropdown();
}

// Open mask editor
function openMaskEditor() {
    const maskEditorDialog = document.getElementById('maskEditorDialog');
    
    if (!maskEditorDialog) return;
    
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
            console.log('Using placeholder image as background:', backgroundImageValue);
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
            console.log(backgroundImageValue);
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

        if (dims) {
            try {
                // Process the compressed mask to display resolution
                maskData = await processCompressedMask(window.currentMaskCompressed, dims.width, dims.height);
            } catch (error) {
                console.error('Error processing compressed mask:', error);
                // Fallback to regular mask if available
                maskData = window.currentMaskData;
            }
        }
    }
    
    if (!maskData) {
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }
    
    // Get the actual displayed dimensions of the variation image
    const imageRect = variationImage.getBoundingClientRect();
    const containerRect = variationImage.closest('.variation-image-container').getBoundingClientRect();
    
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

// Cache Browser Functions
let cacheImages = [];
let cacheCurrentPage = 1;
let cacheImagesPerPage = 20;

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
            displayCacheImagesContainer();
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
        const cacheGallery = document.getElementById('cacheGallery');
        
        if (!cacheBrowserModal || !cacheBrowserLoading || !cacheGallery) return;
        
        cacheBrowserModal.style.display = 'block';
        cacheBrowserLoading.style.display = 'flex';
        cacheGallery.innerHTML = '';
        
        try {
            await loadCacheImages();
            displayCacheImages();
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
        const response = await fetchWithAuth('/cache/list');
        if (response.ok) {
            cacheImages = await response.json();
        } else {
            throw new Error(`Failed to load cache: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error loading cache images:', error);
        throw error;
    }
}

function displayCacheImages() {
    const cacheGallery = document.getElementById('cacheGallery');
    if (!cacheGallery) return;
    
    cacheGallery.innerHTML = '';
    
    if (cacheImages.length === 0) {
        cacheGallery.innerHTML = '<div class="no-images">No cache images found</div>';
        return;
    }
    
    cacheImages.forEach(cacheImage => {
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
    
    cacheImages.forEach(cacheImage => {
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
    img.alt = `Cache image ${cacheImage.hash}`;
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
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'cache-delete-btn';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCacheImage(cacheImage);
    });
    
    overlay.appendChild(info);
    overlay.appendChild(deleteBtn);
    
    item.appendChild(img);
    item.appendChild(overlay);
    
    // Click to select image
    item.addEventListener('click', () => {
        selectCacheImage(cacheImage);
    });
    
    return item;
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
        // Set the uploaded image data
        window.uploadedImageData = {
            image_source: `cache:${cacheImage.hash}`,
            width: 512, // Default, will be updated when image loads
            height: 512,
            bias: 2,
            isBiasMode: true,
            isClientSide: 2
        };
        

        // Show transformation section content
        const transformationSection = document.getElementById('transformationSection');
        if (transformationSection) {
            transformationSection.classList.add('display-image');
        }
        
        // Update image bias
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
        
        showSuccess('Cache image selected successfully');
        
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
            
            showSuccess('Cache image deleted successfully');
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
    
    if (newState === 'off') {
        // Show CSS interactive view
        toggleBtn.setAttribute('data-state', 'off');
        toggleBtn.innerHTML = '<i class="nai-sparkles"></i> Client Preview';
        cssWrapper.style.display = 'block';
        clientImage.style.display = 'none';
        updateBiasAdjustmentImage();
    } else {
        // Show client preview
        toggleBtn.setAttribute('data-state', 'on');
        toggleBtn.innerHTML = '<i class="nai-easel"></i> Interactive View';
        cssWrapper.style.display = 'none';
        clientImage.style.display = 'block';
        updateClientPreview();
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

// Show mask adjustment modal after bias adjustment
function showMaskAdjustmentModal() {
    const modal = document.getElementById('maskAdjustmentModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Hide mask adjustment modal
function hideMaskAdjustmentModal() {
    const modal = document.getElementById('maskAdjustmentModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Accept bias adjustment and save
function acceptBiasAdjustment() {
    if (!imageBiasAdjustmentData.currentBias) {
        showError('No bias adjustment to save');
        return;
    }
    
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
    
    // Check if we need to show mask adjustment modal
    checkAndShowMaskAdjustmentModal();
    
    showSuccess('Bias adjustment saved');
}

// Check if mask adjustment modal should be shown
async function checkAndShowMaskAdjustmentModal() {
    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;
    
    // Check for transparent pixels in the processed image
    let hasTransparentPixels = false;
    let transparentPercentage = 0;
    
    if (window.uploadedImageData && window.uploadedImageData.originalDataUrl) {
        try {
            // Get the processed image with bias applied
            const dynamicBias = window.uploadedImageData.image_bias;
            let processedImageUrl;
            
            if (dynamicBias && typeof dynamicBias === 'object') {
                processedImageUrl = await cropImageWithDynamicBias(window.uploadedImageData.originalDataUrl, dynamicBias);
            } else {
                const bias = window.uploadedImageData.bias || 2;
                processedImageUrl = await cropImageToResolutionInternal(window.uploadedImageData.originalDataUrl, bias);
            }
            
            const transparentInfo = await detectTransparentPixels(processedImageUrl);
            hasTransparentPixels = transparentInfo.hasTransparentPixels;
            transparentPercentage = transparentInfo.transparentPercentage;
        } catch (error) {
            console.error('Error detecting transparent pixels:', error);
        }
    }
    
    // Show modal if there's a mask or more than 5% transparent pixels
    if (hasExistingMask || (hasTransparentPixels && transparentPercentage > 5)) {
        showMaskAdjustmentModal();
    }
}

// Hide bias adjustment confirmation dialog
function hideBiasAdjustmentConfirmDialog() {
    const dialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (dialog) {
        dialog.style.display = 'none';
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
    if (!window.uploadedImageData) {
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
            setTimeout(updateMaskPreview, 100);
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
    
    // Mask adjustment modal controls
    const closeMaskAdjustmentBtn = document.getElementById('closeMaskAdjustmentBtn');
    const editMaskBtn = document.getElementById('editMaskBtn');
    const autoFillMaskBtn = document.getElementById('autoFillMaskBtn');
    const skipMaskAdjustmentBtn = document.getElementById('skipMaskAdjustmentBtn');
    
    if (closeMaskAdjustmentBtn) closeMaskAdjustmentBtn.addEventListener('click', hideMaskAdjustmentModal);
    if (editMaskBtn) editMaskBtn.addEventListener('click', () => {
        hideMaskAdjustmentModal();
        openMaskEditor();
    });
    if (autoFillMaskBtn) autoFillMaskBtn.addEventListener('click', () => {
        hideMaskAdjustmentModal();
        autoFillMaskFromTransparentPixels();
    });
    if (skipMaskAdjustmentBtn) skipMaskAdjustmentBtn.addEventListener('click', hideMaskAdjustmentModal);
    
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
    
    // Confirmation dialog controls
    const closeConfirmBtn = document.getElementById('closeBiasConfirmBtn');
    const cancelConfirmBtn = document.getElementById('cancelBiasConfirmBtn');
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


