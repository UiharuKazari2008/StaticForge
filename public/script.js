// Global variables
let isAuthenticated = true;
let subscriptionData = null;
let allImages = [];
let currentPage = 1;
let imagesPerPage = 12;
let currentImage = null;
let selectedAutocompleteIndex = -1;
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

const resolutionGroups = [
    {
        group: 'Default',
        options: [
        { value: '', name: 'Keep Original' },
        ]
    },
    {
        group: 'Custom',
        options: [
        { value: 'custom', name: 'Custom Resolution' },
        ]
    },
    {
        group: 'Normal',
        badge: 'Normal',
        options: [
        { value: 'normal_portrait', name: 'Portrait', dims: '832x1216' },
        { value: 'normal_landscape', name: 'Landscape', dims: '1216x832' },
        { value: 'normal_square', name: 'Square', dims: '1024x1024' },
        ]
    },
    {
        group: 'Large',
        badge: 'Large',
        options: [
        { value: 'large_portrait', name: 'Portrait', dims: '1024x1536' },
        { value: 'large_landscape', name: 'Landscape', dims: '1536x1024' },
        { value: 'large_square', name: 'Square', dims: '1472x1472' },
        ]
    },
    {
        group: 'Wallpaper',
        badge: 'Wallpaper',
        options: [
        { value: 'wallpaper_portrait', name: 'Portrait', dims: '1088x1920' },
        { value: 'wallpaper_landscape', name: 'Landscape', dims: '1920x1088' },
        ]
    },
    {
        group: 'Small',
        badge: 'Small',
        options: [
        { value: 'small_portrait', name: 'Portrait', dims: '512x768' },
        { value: 'small_landscape', name: 'Landscape', dims: '768x512' },
        { value: 'small_square', name: 'Square', dims: '640x640' },
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

// Autocomplete elements
const autocompleteOverlay = document.getElementById('autocompleteOverlay');
const autocompleteList = document.querySelector('.autocomplete-list');

// Character autocomplete elements
const characterAutocompleteOverlay = document.getElementById('characterAutocompleteOverlay');
const characterAutocompleteList = document.querySelector('.character-autocomplete-list');

// Global variables for autocomplete
let currentAutocompleteTarget = null;

// Global variables for character autocomplete
let characterAutocompleteTimeout = null;
let currentCharacterAutocompleteTarget = null;

// Global variables for character autocomplete
let characterSearchResults = [];
let characterData = null;

function renderCustomResolutionDropdown(selectedVal) {
  customResolutionDropdownMenu.innerHTML = '';
  resolutionGroups.forEach(group => {
    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'custom-dropdown-group';
    groupHeader.textContent = group.group;
    customResolutionDropdownMenu.appendChild(groupHeader);
    // Options
    group.options.forEach(opt => {
      const option = document.createElement('div');
      option.className = 'custom-dropdown-option' + (selectedVal === opt.value ? ' selected' : '');
      option.tabIndex = 0;
      option.dataset.value = opt.value;
      option.dataset.group = group.group;
      option.innerHTML = `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`;
      option.addEventListener('click', () => {
        selectCustomResolution(opt.value, group.group);
        closeCustomResolutionDropdown();
      });
      option.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          selectCustomResolution(opt.value, group.group);
          closeCustomResolutionDropdown();
        }
      });
      customResolutionDropdownMenu.appendChild(option);
    });
  });
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
    customResolutionSelected.innerHTML = `${optObj.name}${groupObj.badge ? '<span class="custom-dropdown-badge">' + groupObj.badge + '</span>' : ''}`;
  } else {
    customResolutionSelected.textContent = 'Select resolution...';
  }
  // Sync with hidden select for compatibility
  const hiddenSelect = document.getElementById('resolutionSelect');
  if (hiddenSelect) hiddenSelect.value = value;
  // Trigger any listeners (e.g., updateGenerateButton)
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
}

function openCustomResolutionDropdown() {
  customResolutionDropdownMenu.style.display = 'block';
  customResolutionDropdownBtn.classList.add('active');
}
function closeCustomResolutionDropdown() {
  customResolutionDropdownMenu.style.display = 'none';
  customResolutionDropdownBtn.classList.remove('active');
}

customResolutionDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (customResolutionDropdownMenu.style.display === 'block') {
    closeCustomResolutionDropdown();
  } else {
    renderCustomResolutionDropdown(selectedResolution);
    openCustomResolutionDropdown();
  }
});

document.addEventListener('click', e => {
  if (!customResolutionDropdown.contains(e.target)) {
    closeCustomResolutionDropdown();
  }
});

// Custom Preset Dropdown Functions
async function renderCustomPresetDropdown(selectedVal) {
  customPresetDropdownMenu.innerHTML = '';
  
  // Add presets group
  if (presets && presets.length > 0) {
    // Presets group header
    const presetsGroupHeader = document.createElement('div');
    presetsGroupHeader.className = 'custom-dropdown-group';
    presetsGroupHeader.innerHTML = '<i class="nai-heart-enabled"></i> Presets';
    customPresetDropdownMenu.appendChild(presetsGroupHeader);
    
    for (const preset of presets) {
      const option = document.createElement('div');
      option.className = 'custom-dropdown-option' + (selectedVal === `preset:${preset}` ? ' selected' : '');
      option.tabIndex = 0;
      option.dataset.value = `preset:${preset}`;
      option.dataset.type = 'preset';
      
      // Get preset info for icons
      const presetInfo = await getPresetInfo(preset);
      
      option.innerHTML = `
        <div class="preset-option-content">
          <div class="preset-name">${preset}</div>
          <div class="preset-details">
            <span class="preset-model">${modelsShort[presetInfo.model.toUpperCase()] || presetInfo.model || 'Default'}</span>
            <div class="preset-icons">
              ${presetInfo.upscale ? '<i class="nai-upscale" title="Upscale enabled"></i>' : ''}
              ${presetInfo.allow_paid ? '<i class="nai-anla" title="Allow paid"></i>' : ''}
              ${presetInfo.variety ? '<i class="nai-wand-sparkles" title="Variety enabled"></i>' : ''}
              ${presetInfo.character_prompts ? '<i class="fas fa-users" title="Character prompts"></i>' : ''}
              ${presetInfo.base_image ? '<i class="fas fa-image" title="Has base image"></i>' : ''}
            </div>
          </div>
          <div class="preset-resolution">${presetInfo.resolution || 'Default'}</div>
        </div>
      `;
      
      option.addEventListener('click', () => {
        selectCustomPreset(`preset:${preset}`);
        closeCustomPresetDropdown();
      });
      option.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          selectCustomPreset(`preset:${preset}`);
          closeCustomPresetDropdown();
        }
      });
      customPresetDropdownMenu.appendChild(option);
    }
  }
  
  // Add pipelines group
  if (pipelines && pipelines.length > 0) {
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
      
      // Get pipeline info for icons
      const pipelineInfo = await getPipelineInfo(pipeline.name);
      
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
              <span class="pipeline-model">${modelsShort[pipelineInfo.layer1Model.toUpperCase()] || pipelineInfo.layer1Model || 'Default'}</span>
              <div class="pipeline-icons">
                ${pipelineInfo.layer1Upscale ? '<i class="nai-upscale" title="Upscale enabled"></i>' : ''}
                ${pipelineInfo.layer1AllowPaid ? '<i class="nai-anla" title="Allow paid"></i>' : ''}
                ${pipelineInfo.layer1Variety ? '<i class="nai-wand-sparkles" title="Variety enabled"></i>' : ''}
                ${pipelineInfo.layer1CharacterPrompts ? '<i class="fas fa-users" title="Character prompts"></i>' : ''}
                ${pipelineInfo.layer1BaseImage ? '<i class="fas fa-image" title="Has base image"></i>' : ''}
              </div>
            </div>
            <div class="pipeline-models">
              <span class="pipeline-model">${modelsShort[pipelineInfo.layer2Model.toUpperCase()] || pipelineInfo.layer2Model || 'Default'}</span>
              <div class="pipeline-icons">
                ${pipelineInfo.layer2Upscale ? '<i class="nai-upscale" title="Upscale enabled"></i>' : ''}
                ${pipelineInfo.layer2AllowPaid ? '<i class="nai-anla" title="Allow paid"></i>' : ''}
                ${pipelineInfo.layer2CharacterPrompts ? '<i class="fas fa-users" title="Character prompts"></i>' : ''}
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
  customPresetDropdownMenu.style.display = 'block';
  customPresetDropdownBtn.classList.add('active');
}

function closeCustomPresetDropdown() {
  customPresetDropdownMenu.style.display = 'none';
  customPresetDropdownBtn.classList.remove('active');
}

// Helper functions to get preset and pipeline info
async function getPresetInfo(presetName) {
  try {
    const response = await fetchWithAuth(`/preset/${encodeURIComponent(presetName)}`, {
      method: 'OPTIONS'
    });
    if (!response.ok) throw new Error('Failed to fetch preset details');
    
    const result = await response.json();
    const presetData = result.data;
    
    return {
      model: presetData.model || 'Default',
      upscale: presetData.upscale || false,
      allow_paid: presetData.allow_paid || false,
      variety: presetData.variety || false,
      character_prompts: presetData.character_prompts || false,
      base_image: presetData.base_image || false,
      resolution: presetData.resolution || 'Default'
    };
  } catch (error) {
    console.error('Error fetching preset info:', error);
    return {
      model: 'Default',
      upscale: false,
      allow_paid: false,
      variety: false,
      character_prompts: false,
      base_image: false,
      resolution: 'Default'
    };
  }
}

async function getPipelineInfo(pipelineName) {
  try {
    const response = await fetchWithAuth(`/pipeline/${encodeURIComponent(pipelineName)}`, {
      method: 'OPTIONS'
    });
    if (!response.ok) throw new Error('Failed to fetch pipeline details');
    
    const result = await response.json();
    const pipelineData = result.data;
    const layer1Info = result.layer1Info;
    const layer2Info = result.layer2Info;
    
    return {
      layer1Model: layer1Info?.model || 'Default',
      layer1Upscale: layer1Info?.upscale || false,
      layer1AllowPaid: layer1Info?.allow_paid || false,
      layer1Variety: layer1Info?.variety || false,
      layer1CharacterPrompts: layer1Info?.character_prompts || false,
      layer1BaseImage: layer1Info?.base_image || false,
      layer2Model: layer2Info?.model || 'Default',
      layer2Upscale: layer2Info?.upscale || false,
      layer2AllowPaid: layer2Info?.allow_paid || false,
      layer2CharacterPrompts: layer2Info?.character_prompts || false
    };
  } catch (error) {
    console.error('Error fetching pipeline info:', error);
    return {
      layer1Model: 'Default',
      layer1Upscale: false,
      layer1AllowPaid: false,
      layer1Variety: false,
      layer1CharacterPrompts: false,
      layer1BaseImage: false,
      layer2Model: 'Default',
      layer2Upscale: false,
      layer2AllowPaid: false,
      layer2CharacterPrompts: false
    };
  }
}

// Event listeners for custom preset dropdown
customPresetDropdownBtn.addEventListener('click', async e => {
  e.stopPropagation();
  if (customPresetDropdownMenu.style.display === 'block') {
    closeCustomPresetDropdown();
  } else {
    await renderCustomPresetDropdown(selectedPreset);
    openCustomPresetDropdown();
  }
});

document.addEventListener('click', e => {
  if (!customPresetDropdown.contains(e.target)) {
    closeCustomPresetDropdown();
  }
});


function renderManualResolutionDropdown(selectedVal) {
  manualResolutionDropdownMenu.innerHTML = '';
  resolutionGroups.forEach(group => {
    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'custom-dropdown-group';
    groupHeader.textContent = group.group;
    manualResolutionDropdownMenu.appendChild(groupHeader);
    // Options
    group.options.forEach(opt => {
      const option = document.createElement('div');
      option.className = 'custom-dropdown-option' + (selectedVal === opt.value ? ' selected' : '');
      option.tabIndex = 0;
      option.dataset.value = opt.value;
      option.dataset.group = group.group;
      option.innerHTML = `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`;
      option.addEventListener('click', () => {
        selectManualResolution(opt.value, group.group);
        closeManualResolutionDropdown();
      });
      option.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          selectManualResolution(opt.value, group.group);
          closeManualResolutionDropdown();
        }
      });
      manualResolutionDropdownMenu.appendChild(option);
    });
  });
}

function selectManualResolution(value, group) {
  manualSelectedResolution = value;
  
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
  
  manualSelectedGroup = group;
  
  // Handle custom resolution mode
  if (value === 'custom') {
    manualResolutionDropdown.style.display = 'none';
    manualCustomResolution.style.display = 'flex';
    manualCustomResolutionBtn.setAttribute('data-state', 'on');
    // Set default values if empty
    if (!manualWidth.value) manualWidth.value = '1024';
    if (!manualHeight.value) manualHeight.value = '1024';
    // Sanitize the default values
    sanitizeCustomDimensions();
  } else {
    manualResolutionDropdown.style.display = 'block';
    manualCustomResolution.style.display = 'none';
    manualCustomResolutionBtn.setAttribute('data-state', 'off');
  }
  
  // Update button display
  const groupObj = resolutionGroups.find(g => g.group === group);
  const optObj = groupObj ? groupObj.options.find(o => o.value === value) : null;
  if (optObj) {
    manualResolutionSelected.innerHTML = `${optObj.name}${groupObj.badge ? '<span class="custom-dropdown-badge">' + groupObj.badge + '</span>' : ''}`;
  } else {
    manualResolutionSelected.textContent = 'Select resolution...';
  }
  // Sync with hidden input for compatibility
  if (manualResolutionHidden) manualResolutionHidden.value = value;
  
  // Update mask bias dropdown to reflect new resolution
  if (manualMaskBiasSelected) {
    selectManualMaskBias(manualSelectedMaskBias);
  }
  
  // Check if we're in a pipeline edit context and update mask bias visibility
  if (window.currentPipelineEdit) {
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
  }
  
  // Trigger any listeners (e.g., updateGenerateButton or manual form update)
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
  // Update price display
  updateManualPriceDisplay();
}

function openManualResolutionDropdown() {
  manualResolutionDropdownMenu.style.display = 'block';
  manualResolutionDropdownBtn.classList.add('active');
}
function closeManualResolutionDropdown() {
  manualResolutionDropdownMenu.style.display = 'none';
  manualResolutionDropdownBtn.classList.remove('active');
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
      if (window.currentPipelineEdit) {
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

manualResolutionDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (manualResolutionDropdownMenu.style.display === 'block') {
    closeManualResolutionDropdown();
  } else {
    renderManualResolutionDropdown(manualSelectedResolution);
    openManualResolutionDropdown();
  }
});

document.addEventListener('click', e => {
  if (!manualResolutionDropdown.contains(e.target)) {
    closeManualResolutionDropdown();
  }
});

function renderManualSamplerDropdown(selectedVal) {
  manualSamplerDropdownMenu.innerHTML = '';
  SAMPLER_MAP.forEach(s => {
    const option = document.createElement('div');
    option.className = 'custom-dropdown-option' + (selectedVal === s.meta ? ' selected' : '');
    option.tabIndex = 0;
    option.dataset.value = s.meta;
    option.innerHTML = `<span>${s.display}</span>`;
    option.addEventListener('click', () => {
      selectManualSampler(s.meta);
      closeManualSamplerDropdown();
    });
    option.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        selectManualSampler(s.meta);
        closeManualSamplerDropdown();
      }
    });
    manualSamplerDropdownMenu.appendChild(option);
  });
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

function openManualSamplerDropdown() {
  manualSamplerDropdownMenu.style.display = 'block';
  manualSamplerDropdownBtn.classList.add('active');
}
function closeManualSamplerDropdown() {
  manualSamplerDropdownMenu.style.display = 'none';
  manualSamplerDropdownBtn.classList.remove('active');
}

manualSamplerDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (manualSamplerDropdownMenu.style.display === 'block') {
    closeManualSamplerDropdown();
  } else {
    renderManualSamplerDropdown(manualSelectedSampler);
    openManualSamplerDropdown();
  }
});

document.addEventListener('click', e => {
  if (!manualSamplerDropdown.contains(e.target)) {
    closeManualSamplerDropdown();
  }
});

function renderManualNoiseSchedulerDropdown(selectedVal) {
  manualNoiseSchedulerDropdownMenu.innerHTML = '';
  NOISE_MAP.forEach(n => {
    const option = document.createElement('div');
    option.className = 'custom-dropdown-option' + (selectedVal === n.meta ? ' selected' : '');
    option.tabIndex = 0;
    option.dataset.value = n.meta;
    option.innerHTML = `<span>${n.display}</span>`;
    option.addEventListener('click', () => {
      selectManualNoiseScheduler(n.meta);
      closeManualNoiseSchedulerDropdown();
    });
    option.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        selectManualNoiseScheduler(n.meta);
        closeManualNoiseSchedulerDropdown();
      }
    });
    manualNoiseSchedulerDropdownMenu.appendChild(option);
  });
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

function openManualNoiseSchedulerDropdown() {
  manualNoiseSchedulerDropdownMenu.style.display = 'block';
  manualNoiseSchedulerDropdownBtn.classList.add('active');
}
function closeManualNoiseSchedulerDropdown() {
  manualNoiseSchedulerDropdownMenu.style.display = 'none';
  manualNoiseSchedulerDropdownBtn.classList.remove('active');
}

manualNoiseSchedulerDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (manualNoiseSchedulerDropdownMenu.style.display === 'block') {
    closeManualNoiseSchedulerDropdown();
  } else {
    renderManualNoiseSchedulerDropdown(manualSelectedNoiseScheduler);
    openManualNoiseSchedulerDropdown();
  }
});

document.addEventListener('click', e => {
  if (!manualNoiseSchedulerDropdown.contains(e.target)) {
    closeManualNoiseSchedulerDropdown();
  }
});

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
            { value: '1', display: 'Top-Mid', icon: '⬆️' },
            { value: '2', display: 'Center', icon: '⬆️' },
            { value: '3', display: 'Bottom-Mid', icon: '⬆️' },
            { value: '4', display: 'Bottom', icon: '⬆️' }
        ];
    } else {
        // Landscape or square - use same position names
        return [
            { value: '0', display: 'Left', icon: '⬅️' },
            { value: '1', display: 'Left-Mid', icon: '⬅️' },
            { value: '2', display: 'Center', icon: '⬅️' },
            { value: '3', display: 'Right-Mid', icon: '⬅️' },
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

function renderManualModelDropdown(selectedVal) {
  manualModelDropdownMenu.innerHTML = '';
  modelGroups.forEach(group => {
    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'custom-dropdown-group';
    groupHeader.textContent = group.group;
    manualModelDropdownMenu.appendChild(groupHeader);
    // Options
    group.options.forEach(opt => {
      const option = document.createElement('div');
      option.className = 'custom-dropdown-option' + (selectedVal === opt.value ? ' selected' : '');
      option.tabIndex = 0;
      option.dataset.value = opt.value;
      option.dataset.group = group.group;
      option.innerHTML = `<span>${opt.display}</span>`;
      option.addEventListener('click', () => {
        selectManualModel(opt.value, group.group);
        closeManualModelDropdown();
      });
      option.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          selectManualModel(opt.value, group.group);
          closeManualModelDropdown();
        }
      });
      manualModelDropdownMenu.appendChild(option);
    });
  });
}

function selectManualModel(value, group) {
  manualSelectedModel = value;
  
  // If group is not provided, find it automatically
  if (!group) {
    for (const g of modelGroups) {
      const found = g.options.find(o => o.value === value);
      if (found) {
        group = g.group;
        break;
      }
    }
  }
  
  // Update button display
  const groupObj = modelGroups.find(g => g.group === group);
  const optObj = groupObj ? groupObj.options.find(o => o.value === value) : null;
  if (optObj) {
    manualModelSelected.innerHTML = `${optObj.display}${groupObj.badge ? '<span class="custom-dropdown-badge">' + groupObj.badge + '</span>' : ''}`;
  } else {
    manualModelSelected.textContent = 'Select model...';
  }
  
  // Sync with hidden input for compatibility
  if (manualModelHidden) manualModelHidden.value = value;
  
  // Trigger any listeners (e.g., updateGenerateButton or manual form update)
  if (typeof updateGenerateButton === 'function') updateGenerateButton();
  // Update price display
  updateManualPriceDisplay();
}

function openManualModelDropdown() {
  manualModelDropdownMenu.style.display = 'block';
  manualModelDropdownBtn.classList.add('active');
}
function closeManualModelDropdown() {
  manualModelDropdownMenu.style.display = 'none';
  manualModelDropdownBtn.classList.remove('active');
}

manualModelDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (manualModelDropdownMenu.style.display === 'block') {
    closeManualModelDropdown();
  } else {
    renderManualModelDropdown(manualSelectedModel);
    openManualModelDropdown();
  }
});

document.addEventListener('click', e => {
  if (!manualModelDropdown.contains(e.target)) {
    closeManualModelDropdown();
  }
});

renderManualSamplerDropdown(manualSelectedSampler);
selectManualSampler('k_euler_ancestral');
renderManualResolutionDropdown(manualSelectedResolution);
selectManualResolution('normal_portrait', '');
renderCustomResolutionDropdown(selectedResolution);
selectCustomResolution('', 'Default');
renderManualNoiseSchedulerDropdown(manualSelectedNoiseScheduler);
selectManualNoiseScheduler('karras');
renderManualMaskBiasDropdown(manualSelectedMaskBias);
selectManualMaskBias('2');
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
        
        // Start background image rotation
        startBackgroundImageRotation();
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
    
    // Clear seed button
    clearSeedBtn.addEventListener('click', clearSeed);
    
    // Layer1 seed toggle
    layer1SeedToggle.addEventListener('click', toggleLayer1Seed);
    
    // Variation range inputs
    const manualStrength = document.getElementById('manualStrength');
    const manualStrengthValue = document.getElementById('manualStrengthValue');
    const manualNoise = document.getElementById('manualNoise');
    const manualNoiseValue = document.getElementById('manualNoiseValue');
    
    if (manualStrength && manualStrengthValue) {
        manualStrength.addEventListener('input', function() {
            manualStrengthValue.textContent = this.value;
        });
    }
    
    if (manualNoise && manualNoiseValue) {
        manualNoise.addEventListener('input', function() {
            manualNoiseValue.textContent = this.value;
        });
    }

    // Autocomplete events
    manualPrompt.addEventListener('input', handleAutocompleteInput);
    manualUc.addEventListener('input', handleAutocompleteInput);
    manualPrompt.addEventListener('keydown', handleAutocompleteKeydown);
    manualUc.addEventListener('keydown', handleAutocompleteKeydown);
    document.addEventListener('click', hideAutocomplete);

    // Character autocomplete events (for both prompt and UC fields)
    manualPrompt.addEventListener('input', handleCharacterAutocompleteInput);
    manualPrompt.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    manualUc.addEventListener('input', handleCharacterAutocompleteInput);
    manualUc.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    document.addEventListener('click', hideCharacterAutocomplete);
    
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
            // } else if (loginModal.style.display === 'block') {
            //     hideLoginModal();
            } else if (manualModal.style.display === 'block') {
                hideManualModal();
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
    const rerollTypeBtn = document.getElementById('rerollTypeBtn');
    const variationTypeBtn = document.getElementById('variationTypeBtn');
    
    if (rerollTypeBtn) {
        rerollTypeBtn.addEventListener('click', () => toggleRequestType('reroll'));
    }
    
    if (variationTypeBtn) {
        variationTypeBtn.addEventListener('click', () => toggleRequestType('variation'));
    }
    
    // Price calculation event listeners
    if (manualSteps) {
        manualSteps.addEventListener('input', updateManualPriceDisplay);
    }
    
    if (manualStrength) {
        manualStrength.addEventListener('input', updateManualPriceDisplay);
    }
    
    if (manualNoise) {
        manualNoise.addEventListener('input', updateManualPriceDisplay);
    }

    // Pagination
    prevPage.addEventListener('click', () => changePage(-1));
    nextPage.addEventListener('click', () => changePage(1));


    
    // Close modals on outside click (only for login modal)
    // window.addEventListener('click', function(e) {
    //     if (e.target === loginModal) hideLoginModal();
    // });
    
    // Resize handler for dynamic gallery sizing
    window.addEventListener('resize', handleResize);

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
}

let presets, pipelines, resolutions, models, modelsNames, modelsShort, textReplacements, samplers, noiseSchedulers;
// Load options from server
async function loadOptions() {
    try {
        const response = await fetchWithAuth('/options');
        if (!response.ok) throw new Error('Failed to load options');
        
        const options = await response.json();
        
        // Populate presets
        presets = options.presets;
        pipelines = options.pipelines || [];

        // Populate resolutions
        resolutions = Object.keys(options.resolutions);
        resolutionSelect.innerHTML = '<option value="">Unchanged</option>';
        manualResolution.innerHTML = '<option value="">Unchanged</option>';
        resolutions.forEach(resolution => {
            const option = document.createElement('option');
            option.value = resolution;
            option.textContent = resolution;
            resolutionSelect.appendChild(option);
            
            const manualOption = document.createElement('option');
            manualOption.value = resolution;
            manualOption.textContent = resolution;
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
            
            // Set background image after loading gallery
            setBackgroundImage();
            
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
    
    // Variation button (blender icon)
    const variationBtn = document.createElement('button');
    variationBtn.className = 'btn-primary round-button';
    variationBtn.innerHTML = '<i class="nai-inpaint"></i>';
    variationBtn.title = 'Variation';
    variationBtn.onclick = (e) => {
        e.stopPropagation();
        variationImage(image);
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
    actionsDiv.appendChild(variationBtn);
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

// Direct variation of an image (img2img with same settings)
async function variationImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    try {
        // Determine which filename to use for metadata
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
        
        // Show loading
        showLoading(true, 'Creating variation...');
        
        // Use variation endpoint with default settings
        const url = `/variation/${filenameForMetadata}`;
        const generateResponse = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!generateResponse.ok) {
            throw new Error(`Variation generation failed: ${generateResponse.statusText}`);
        }

        const blob = await generateResponse.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = function() {
            createConfetti();
            showSuccess('Variation created successfully!');
        
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

    } catch (error) {
        console.error('Direct variation error:', error);
        showError('Image variation failed: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Variation with edit functionality
async function variationImageWithEdit(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    try {
        // Determine which filename to use for metadata
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

        // Close lightbox if it's open
        if (lightboxModal.style.display === 'block') {
            hideLightbox();
        }

        // Load metadata into manual form for variation editing
        loadMetadataIntoVariationForm(metadata, image);

        // Show variation-specific fields
        const variationRow = document.getElementById('manualVariationRow');
        if (variationRow) {
            variationRow.style.display = 'flex';
        }

        // Show the source image
        const variationImage = document.getElementById('manualVariationImage');
        if (variationImage) {
            // Find the non-upscaled version for the source image
            let sourceFilename = filenameForMetadata;
            if (sourceFilename.includes('_upscaled')) {
                sourceFilename = sourceFilename.replace('_upscaled.png', '.png');
            }
            variationImage.src = `/images/${sourceFilename}`;
            variationImage.style.display = 'block';
        }

        // Hide preset name and save button for variations
        const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
        const saveButton = document.getElementById('manualSaveBtn');
        
        if (presetNameGroup) {
            presetNameGroup.style.display = 'none';
        }
        if (saveButton) {
            saveButton.style.display = 'none';
        }
        
        // Clear any pipeline context
        window.currentPipelineEdit = null;
        
        // Hide mask bias dropdown for variations
        const maskBiasRow = document.getElementById('manualMaskBiasRow');
        if (maskBiasRow) {
            maskBiasRow.style.display = 'none';
        }
        
        // Hide the layer1 seed toggle for variations
        const layer1SeedToggle = document.getElementById('layer1SeedToggle');
        if (layer1SeedToggle) {
            layer1SeedToggle.style.display = 'none';
        }

        // Store variation context
        window.currentVariationEdit = {
            sourceFilename: filenameForMetadata,
            isVariationEdit: true
        };

        // Show manual modal
        manualModal.style.display = 'block';
        if (manualPrompt) manualPrompt.focus();

    } catch (error) {
        console.error('Variation with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
    }
}

// Load metadata into variation form
function loadMetadataIntoVariationForm(metadata, image) {
    // Load basic metadata like reroll but keep original prompt/UC for editing
    if (manualModel) {
        manualModel.value = metadata.model ? metadata.model.toLowerCase() : 'v4_5';
    }
    
    if (manualPrompt) {
        manualPrompt.value = metadata.prompt || '';
    }
    
    if (manualUc) {
        manualUc.value = metadata.uc || '';
    }
    
    if (manualResolution) {
        manualResolution.value = metadata.resolution || '';
    }
    
    if (manualSteps) {
        manualSteps.value = metadata.steps || 25;
    }
    
    if (manualGuidance) {
        manualGuidance.value = metadata.scale || 5.0;
    }
    
    if (manualRescale) {
        manualRescale.value = metadata.cfg_rescale || 0.0;
    }
    
    if (manualSeed) {
        manualSeed.value = ''; // Do not autofill for variations
    }
    
    if (manualSampler) {
        const samplerObj = getSamplerByMeta(metadata.sampler);
        manualSampler.value = samplerObj ? samplerObj.meta : '';
    }
    
    if (manualNoiseScheduler) {
        const noiseObj = getNoiseByMeta(metadata.noise_schedule);
        manualNoiseScheduler.value = noiseObj ? noiseObj.meta : '';
    }
    
    if (manualUpscale) {
        manualUpscale.checked = false; // Default to no upscale for variations
    }
    
    // Set variety button state based on skip_cfg_above_sigma
    if (document.getElementById('varietyBtn')) {
        const varietyBtn = document.getElementById('varietyBtn');
        if (metadata.skip_cfg_above_sigma !== null && metadata.skip_cfg_above_sigma !== undefined) {
            varietyEnabled = true;
            varietyBtn.setAttribute('data-state', 'on');
        } else {
            varietyEnabled = false;
            varietyBtn.setAttribute('data-state', 'off');
        }
    }
}

// Direct reroll an image (same settings)
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
    showLoading(true, 'Rerolling image...');

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
                allow_paid: true
            };

            if (metadata.skip_cfg_above_sigma) {
                layer2Config.variety = true;
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
                    image: hasOriginalFilename, // Use the original filename
                    strength: metadata.strength || 0.8, // Use strength from metadata or default
                    noise: metadata.noise || 0.1, // Use noise from metadata or default
                    prompt: metadata.prompt || '',
                    resolution: metadata.resolution || '',
                    steps: metadata.steps || 25,
                    guidance: metadata.scale || 5.0,
                    rescale: metadata.cfg_rescale || 0.0
                };
                
                // Add optional fields if they have values
                if (metadata.uc) {
                    requestBody.uc = metadata.uc;
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
                    rescale: metadata.cfg_rescale || 0.0
                };
                
                // Add optional fields if they have values
                if (metadata.uc) {
                    requestBody.uc = metadata.uc;
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
                
                // Add character prompts if available
                if (metadata.characterPrompts && Array.isArray(metadata.characterPrompts) && metadata.characterPrompts.length > 0) {
                    requestBody.allCharacterPrompts = metadata.characterPrompts;
                    requestBody.use_coords = !!metadata.use_coords;
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
        showLoading(false);
    }
}

// Reroll an image with editable settings
async function rerollImageWithEdit(image) {
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

        // Close lightbox if it's open
        if (lightboxModal.style.display === 'block') {
            hideLightbox();
        }

        // Show request type toggle row
        const requestTypeRow = document.getElementById('requestTypeRow');
        if (requestTypeRow) {
            requestTypeRow.style.display = 'flex';
        }

        // Initialize request type toggle buttons
        const rerollTypeBtn = document.getElementById('rerollTypeBtn');
        const variationTypeBtn = document.getElementById('variationTypeBtn');
        
        // Set initial state - always default to reroll mode
        const isVariation = metadata.base_image === true;
        const isPipeline = image.pipeline || image.pipeline_upscaled;
        
        // Always default to reroll mode regardless of image type
        rerollTypeBtn.setAttribute('data-state', 'on');
        variationTypeBtn.setAttribute('data-state', 'off');
        window.currentRequestType = 'reroll';

        // Store the current image metadata for both modes
        window.currentEditMetadata = metadata;
        window.currentEditImage = image;

        // Check if this is a pipeline image
        if (isPipeline) {
            // Handle pipeline edit reroll
            loadMetadataIntoManualForm(metadata, image);

            // Show preset name field but disable it for pipeline editing
            const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
            const saveButton = document.getElementById('manualSaveBtn');
            
            if (presetNameGroup) {
                presetNameGroup.style.display = 'block';
                manualPresetName.disabled = true;
                manualPresetName.style.opacity = '0.6';
            }
            if (saveButton) {
                saveButton.style.display = 'none';
            }

            // Set layer1 seed toggle to ON by default for pipelines if we have a layer1 seed
            if (metadata.layer1Seed) {
                layer1SeedToggle.setAttribute('data-state', 'on');
            }

            // Extract pipeline name from filename
            const parts = image.base.split('_');
            let pipelineName = 'generated';
            
            if (parts.length >= 4) {
                const presetParts = parts.slice(1, -2);
                pipelineName = presetParts.join('_') || 'generated';
            } else if (parts.length === 3) {
                pipelineName = parts[1] || 'generated';
            }

            // Store pipeline context
            window.currentPipelineEdit = {
                pipelineName: pipelineName,
                layer1Seed: metadata.layer1Seed || metadata.seed,
                layer2Seed: metadata.layer2Seed || metadata.seed,
                isPipelineEdit: true
            };

                // Check if mask bias dropdown should be shown
    const pipelinePresetRes = getPipelinePresetResolution(pipelineName);
    const selectedRes = metadata.resolution;
    if (pipelinePresetRes && selectedRes) {
        const presetDims = getDimensionsFromResolution(pipelinePresetRes);
        const selectedDims = getDimensionsFromResolution(selectedRes);
        if (presetDims && selectedDims) {
            // Calculate aspect ratios
            const presetAspectRatio = presetDims.width / presetDims.height;
            const selectedAspectRatio = selectedDims.width / selectedDims.height;
            
            // Show mask bias dropdown only if aspect ratios are different
            if (Math.abs(presetAspectRatio - selectedAspectRatio) > 0.01) {
                // Show mask bias dropdown for pipeline edits with aspect ratio mismatch
                if (manualMaskBiasGroup) {
                    manualMaskBiasGroup.style.display = 'block';
                    // Update mask bias options based on current resolution
                    selectManualMaskBias(manualSelectedMaskBias);
                }
            } else {
                // Hide mask bias dropdown if aspect ratios are the same
                if (manualMaskBiasGroup) {
                    manualMaskBiasGroup.style.display = 'none';
                }
            }
        } else {
            if (manualMaskBiasGroup) {
                manualMaskBiasGroup.style.display = 'none';
            }
        }
    } else {
        if (manualMaskBiasGroup) {
            manualMaskBiasGroup.style.display = 'none';
        }
    }

            // Show the layer1 seed toggle for pipeline edits
            layer1SeedToggle.style.display = 'inline-block';
        } else {
            // Handle regular image or variation in reroll mode
            if (isVariation) {
                // For variations in reroll mode, load manual form but show variation fields
                loadMetadataIntoManualForm(metadata, image);
                
                // Show variation-specific fields for variations in reroll mode
                const variationRow = document.getElementById('manualVariationRow');
                if (variationRow) {
                    variationRow.style.display = 'flex';
                }
                
                // Set the variation image to the original base image
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage && metadata.original_filename) {
                    variationImage.src = `/images/${metadata.original_filename}`;
                    variationImage.style.display = 'block';
                }
                
                // Show preset name and save button for variations in reroll mode
                const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
                const saveButton = document.getElementById('manualSaveBtn');
                
                if (presetNameGroup) {
                    presetNameGroup.style.display = 'block';
                    manualPresetName.disabled = false;
                    manualPresetName.style.opacity = '1';
                }
                if (saveButton) {
                    saveButton.style.display = 'inline-block';
                }
                
                // Hide mask bias dropdown for variations
                if (manualMaskBiasGroup) {
                    manualMaskBiasGroup.style.display = 'none';
                }
                
                // Hide the layer1 seed toggle for variations
                layer1SeedToggle.style.display = 'none';
                
                // Store variation context for reroll
                window.currentVariationEdit = {
                    sourceFilename: metadata.original_filename,
                    isVariationEdit: true
                };
            } else {
                // Handle regular image
                loadMetadataIntoManualForm(metadata, image);
                
                // Show preset name and save button for regular images
                const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
                const saveButton = document.getElementById('manualSaveBtn');
                
                if (presetNameGroup) {
                    presetNameGroup.style.display = 'block';
                    manualPresetName.disabled = false;
                    manualPresetName.style.opacity = '1';
                }
                if (saveButton) {
                    saveButton.style.display = 'inline-block';
                }
                
                // Set layer1 seed toggle to OFF for regular images
                layer1SeedToggle.setAttribute('data-state', 'off');
                
                // Clear any pipeline context
                window.currentPipelineEdit = null;
                
                // Hide mask bias dropdown for regular images
                if (manualMaskBiasGroup) {
                    manualMaskBiasGroup.style.display = 'none';
                }
                
                // Hide the layer1 seed toggle for non-pipeline edits
                layer1SeedToggle.style.display = 'none';
            }
        }

        // Show manual modal
        manualModal.style.display = 'block';
        if (manualPrompt) manualPrompt.focus();

    } catch (error) {
        console.error('Reroll with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
    }
}

// Load metadata into manual form
function loadMetadataIntoManualForm(metadata, image) {
    
    // Clear form first
    clearManualForm();
    
    // Fill form with metadata
    
    if (manualPrompt) {
        manualPrompt.value = metadata.prompt || '';
    } else {
        console.error('manualPrompt element not found!');
    }
    
    if (manualUc) {
        manualUc.value = metadata.uc || '';
    } else {
        console.error('manualUc element not found!');
    }
    
    // Handle model with custom dropdown
    const modelValue = metadata.model ? metadata.model.toLowerCase() : 'v4_5';
    selectManualModel(modelValue, '');
    
    // Handle resolution with custom dropdown
    let resolutionValue = metadata.resolution || 'normal_portrait';
    
    // If we have a resolution value, convert to lowercase for dropdown compatibility
    if (resolutionValue) {
        resolutionValue = resolutionValue.toLowerCase();
    } else if (metadata.width && metadata.height) {
        // Try to match dimensions to a known resolution
        const dimensions = `${metadata.width}x${metadata.height}`;
        const resolutionMap = {
            '512x768': 'small_portrait',
            '768x512': 'small_landscape',
            '640x640': 'small_square',
            '832x1216': 'normal_portrait',
            '1216x832': 'normal_landscape',
            '1024x1024': 'normal_square',
            '1024x1536': 'large_portrait',
            '1536x1024': 'large_landscape',
            '1472x1472': 'large_square',
            '1088x1920': 'wallpaper_portrait',
            '1920x1088': 'wallpaper_landscape'
        };
        resolutionValue = resolutionMap[dimensions] || 'normal_portrait';
    }
    
    // Check if this is a custom resolution (not in the standard map)
    if (metadata.width && metadata.height && !resolutionValue.match(/^(small_|normal_|large_|wallpaper_)/)) {
        // This is a custom resolution, set it up
        resolutionValue = 'custom';
        selectManualResolution(resolutionValue, 'Custom');
        
        // Set the width and height values
        if (manualWidth) manualWidth.value = metadata.width;
        if (manualHeight) manualHeight.value = metadata.height;
        // Sanitize the loaded values
        sanitizeCustomDimensions();
    } else {
        selectManualResolution(resolutionValue, '');
    }
    
    if (manualSteps) {
        manualSteps.value = metadata.steps || 25;
    } else {
        console.error('manualSteps element not found!');
    }
    
    if (manualGuidance) {
        manualGuidance.value = metadata.scale || 5.0;
    } else {
        console.error('manualGuidance element not found!');
    }
    
    if (manualRescale) {
        manualRescale.value = metadata.cfg_rescale || 0.0;
    } else {
        console.error('manualRescale element not found!');
    }
    
    if (manualSeed) {
        manualSeed.value = '';
    } // Do not autofill
    
    // Handle sampler with custom dropdown
        const samplerObj = getSamplerByMeta(metadata.sampler);
    selectManualSampler(samplerObj ? samplerObj.meta : 'k_euler_ancestral');
    
    // Handle noise scheduler with custom dropdown
        const noiseObj = getNoiseByMeta(metadata.noise_schedule);
    selectManualNoiseScheduler(noiseObj ? noiseObj.meta : 'karras');
    
    // Set strength and noise values for variations
    const manualStrength = document.getElementById('manualStrength');
    const manualStrengthValue = document.getElementById('manualStrengthValue');
    const manualNoise = document.getElementById('manualNoise');
    const manualNoiseValue = document.getElementById('manualNoiseValue');
    
    if (manualStrength && manualStrengthValue) {
        const strengthValue = metadata.strength || 0.8;
        manualStrength.value = strengthValue;
        manualStrengthValue.textContent = strengthValue;
    }
    
    if (manualNoise && manualNoiseValue) {
        const noiseValue = metadata.noise || 0.1;
        manualNoise.value = noiseValue;
        manualNoiseValue.textContent = noiseValue;
    }
    
    if (manualUpscale) {
        manualUpscale.checked = false; // Default to no upscale for reroll
    } else {
        console.error('manualUpscale element not found!');
    }
    
    // Set variety button state based on skip_cfg_above_sigma
    if (document.getElementById('varietyBtn')) {
        const varietyBtn = document.getElementById('varietyBtn');
        if (metadata.skip_cfg_above_sigma !== null && metadata.skip_cfg_above_sigma !== undefined) {
            // Variety was enabled (skip_cfg_above_sigma has a value)
            varietyEnabled = true;
            varietyBtn.setAttribute('data-state', 'on');
        } else {
            // Variety was disabled (skip_cfg_above_sigma is null/undefined)
            varietyEnabled = false;
            varietyBtn.setAttribute('data-state', 'off');
        }
    }
    
    // Set preset name based on image filename or base
    let presetName = 'generated';
    if (image && image.base) {
        const parts = image.base.split('_');
        if (image.pipeline || image.pipeline_upscaled) {
            // Pipeline format: [timestamp, preset, layer1Seed, layer2Seed]
            if (parts.length >= 4) {
                const presetParts = parts.slice(1, -2); // Everything between timestamp and the two seeds
                presetName = presetParts.join('_') || 'generated';
            } else if (parts.length === 3) {
                // Format: [timestamp, preset, layer1Seed] (only one seed)
                presetName = parts[1] || 'generated';
            } else {
                presetName = parts.slice(1).join('_') || 'generated';
            }
        } else {
            // Regular format: [timestamp, preset, seed]
            if (parts.length >= 3) {
                presetName = parts.slice(1, -1).join('_') || 'generated';
            }
        }
    } else if (image && image.filename) {
        const parts = image.filename.split('_');
        if (parts.length >= 3) {
            presetName = parts.slice(1, -1).join('_') || 'generated';
        }
    }
    
    if (manualPresetName) {
        manualPresetName.value = presetName;
    } else {
        console.error('manualPresetName element not found!');
    }
    
    // Set lastLoadedSeed for sprout button
    if (typeof lastLoadedSeed !== 'undefined') {
        if (image && (image.pipeline || image.pipeline_upscaled)) {
            lastLoadedSeed = metadata.layer2Seed || metadata.seed || '';
        } else {
            lastLoadedSeed = metadata.seed || '';
        }
    }
    
    // Update sprout seed button visibility
    updateSproutSeedButton();
    
    // Load character prompts if available
    if (metadata.characterPrompts && Array.isArray(metadata.characterPrompts)) {
        const useCoords = metadata.use_coords;
        loadCharacterPrompts(metadata.characterPrompts, useCoords);
    }
    
    // Load mask bias if available
    if (metadata.mask_bias !== undefined) {
        selectManualMaskBias(metadata.mask_bias.toString());
    }
}

// Upscale an image
async function upscaleImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    // Show loading overlay (same as generation)
    showLoading(true, 'Upscaling image...');

    try {
        const response = await fetchWithAuth(`/upscale/${image.original}`, {
            method: 'POST' });
        
        if (!response.ok) {
            throw new Error(`Upscaling failed: ${response.statusText}`);
        }

        const blob = await response.blob();
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
        showLoading(false);
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
function showManualModal() {
    
    // Check if a preset is selected for editing
    const selectedValue = presetSelect.value;
    if (selectedValue) {
        // Parse the selected value to determine if it's a preset or pipeline
        const [type, name] = selectedValue.split(':');
        
        if (type === 'preset') {
            // Load preset for editing
            loadPresetIntoManualForm(selectedValue);
        } else if (type === 'pipeline') {
            // Pipelines can't be edited, show message and clear form
            showError('Pipelines cannot be edited. Please select a preset to edit.');
            clearManualForm();
        }
    } else {
        // Clear form for new generation
        clearManualForm();
    }
    
    manualModal.style.display = 'block';
    manualPrompt.focus();
    
    // Calculate initial price display
    updateManualPriceDisplay();
}

// Hide manual modal
function hideManualModal() {
    manualModal.style.display = 'none';
    clearManualForm();
    
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
}

// Clear manual form
function clearManualForm() {
    manualForm.reset();
    
    // Reset custom dropdowns to defaults
    selectManualModel('v4_5', '');
    selectManualResolution('normal_portrait', '');
    selectManualSampler('k_euler_ancestral');
    selectManualNoiseScheduler('karras');
    
    // Reset custom resolution fields
    if (manualWidth) manualWidth.value = '';
    if (manualHeight) manualHeight.value = '';
    // Reset custom resolution hidden value
    if (manualResolutionHidden) manualResolutionHidden.value = '';
    
    // Reset upscale toggle
    manualUpscale.setAttribute('data-state', 'off');
    layer1SeedToggle.setAttribute('data-state', 'off');
    
    // Reset preset name field
    manualPresetName.disabled = false;
    manualPresetName.style.opacity = '1';
    
    // Clear pipeline context
    window.currentPipelineEdit = null;
    
    // Hide mask bias dropdown
    if (manualMaskBiasGroup) {
        manualMaskBiasGroup.style.display = 'none';
    }
    
    // Hide variation fields
    const variationRow = document.getElementById('manualVariationRow');
    if (variationRow) {
        variationRow.style.display = 'none';
    }
    
    const variationImage = document.getElementById('manualVariationImage');
    if (variationImage) {
        variationImage.style.display = 'none';
        variationImage.src = '';
    }
    
    // Clear variation context
    window.currentVariationEdit = null;
    
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
    
    // Show the clear seed button
    const clearSeedBtn = document.getElementById('clearSeedBtn');
    if (clearSeedBtn) clearSeedBtn.style.display = 'inline-block';
}

// Load preset into manual form
async function loadPresetIntoManualForm(presetValue) {
    try {
        // Extract the actual preset name from the dropdown value format
        // Format is either "preset:name" or "pipeline:name"
        const [type, name] = presetValue.split(':');
        
        if (!type || !name) {
            throw new Error('Invalid preset value format');
        }
        
        // Only handle presets, not pipelines
        if (type !== 'preset') {
            throw new Error('Can only edit presets, not pipelines');
        }
        
        const response = await fetchWithAuth(`/preset/${name}/raw`);
        if (response.ok) {
            const data = await response.json();

            // Preprocess sampler and noiseScheduler to meta format for dropdowns
            if (data.sampler) {
                const samplerObj = getSamplerByRequest(data.sampler) || getSamplerByMeta(data.sampler);
                data.sampler = samplerObj ? samplerObj.meta : '';
            }
            if (data.noiseScheduler) {
                const noiseObj = getNoiseByRequest(data.noiseScheduler) || getNoiseByMeta(data.noiseScheduler);
                data.noiseScheduler = noiseObj ? noiseObj.meta : '';
            }
            // Fill form with raw preset data (no text replacement processing)
            manualPrompt.value = data.prompt || '';
            manualUc.value = data.uc || '';
            selectManualModel(data.model || 'v4_5', '');
            selectManualResolution(data.resolution || 'normal_portrait', '');
            manualSteps.value = data.steps || undefined;
            manualGuidance.value = data.guidance || undefined;
            manualRescale.value = data.rescale || undefined;
            manualSeed.value = data.seed || undefined;
            selectManualSampler(data.sampler || 'k_euler_ancestral');
            selectManualNoiseScheduler(data.noiseScheduler || 'karras');
            
            // Set preset name for saving (use the actual preset name, not the full value)
            manualPresetName.value = name;
            
            // Set upscale toggle button state
            const upscaleState = data.upscale ? 'on' : 'off';
            manualUpscale.setAttribute('data-state', upscaleState);
            
            // Set auto position button state
            const autoPositionBtn = document.getElementById('autoPositionBtn');
            autoPositionBtn.setAttribute('data-state', data.use_coords ? 'on' : 'off');
            
            // Load character prompts if they exist
            if (data.characterPrompts && Array.isArray(data.characterPrompts)) {
                const useCoords = data.use_coords;
                loadCharacterPrompts(data.characterPrompts, useCoords);
            } else {
                clearCharacterPrompts();
            }
            
            // Load variation data if it exists
            if (data.variation && data.variation.file) {
                // Set up variation context
                window.currentVariationEdit = {
                    sourceFilename: data.variation.file,
                    isVariationEdit: true
                };
                
                // Show variation image
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage) {
                    variationImage.src = `/images/${data.variation.file}`;
                    variationImage.style.display = 'block';
                }
                
                // Set strength and noise values
                if (data.variation.strength !== null && data.variation.strength !== undefined) {
                    const strengthInput = document.getElementById('manualStrength');
                    const strengthValue = document.getElementById('manualStrengthValue');
                    if (strengthInput && strengthValue) {
                        strengthInput.value = data.variation.strength;
                        strengthValue.textContent = data.variation.strength;
                    }
                }
                
                if (data.variation.noise !== null && data.variation.noise !== undefined) {
                    const noiseInput = document.getElementById('manualNoise');
                    const noiseValue = document.getElementById('manualNoiseValue');
                    if (noiseInput && noiseValue) {
                        noiseInput.value = data.variation.noise;
                        noiseValue.textContent = data.variation.noise;
                    }
                }
                
                // Show variation-specific fields
                const variationRow = document.getElementById('manualVariationRow');
                if (variationRow) {
                    variationRow.style.display = 'flex';
                }
            } else {
                // Clear variation context
                window.currentVariationEdit = null;
                
                // Hide variation image
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage) {
                    variationImage.style.display = 'none';
                    variationImage.src = '';
                }
                
                // Hide variation-specific fields
                const variationRow = document.getElementById('manualVariationRow');
                if (variationRow) {
                    variationRow.style.display = 'none';
                }
            }
        } else {
            throw new Error('Failed to load preset data');
        }
    } catch (error) {
        console.error('Error loading preset:', error);
        showError('Failed to load preset data');
    }
    
    // Update price display after loading preset
    updateManualPriceDisplay();
}

// Handle manual generation
async function handleManualGeneration(e) {
    e.preventDefault();
    
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
    // Check if this is a pipeline edit
    const isPipelineEdit = window.currentPipelineEdit && window.currentPipelineEdit.isPipelineEdit;
    
    // Check if this is a variation edit
    const isVariationEdit = window.currentVariationEdit && window.currentVariationEdit.isVariationEdit;
    
    // Check current request type
    const currentRequestType = window.currentRequestType;
    
    if (isPipelineEdit) {
        // Handle pipeline editing
        
        // Validate required fields for pipeline editing
        const prompt = manualPrompt.value.trim();
        const resolutionValue = manualResolution.value;
        
        if (!prompt || !resolutionValue) {
            showError('Please fill in all required fields (Prompt, Resolution)');
            return;
        }
        
        // Process resolution value (handle custom resolution)
        const resolutionData = processResolutionValue(resolutionValue);
        const resolution = resolutionData.isCustom ? `${resolutionData.width}x${resolutionData.height}` : resolutionData.resolution;
        
        // Capture all form values BEFORE hiding the modal (which clears the form)
        const ucValue = manualUc.value.trim();
        const seedValue = manualSeed.value.trim();
        const samplerValue = manualSampler.value;
        const noiseSchedulerValue = manualNoiseScheduler.value;
        const stepsValue = parseInt(manualSteps.value) || 25;
        const guidanceValue = parseFloat(manualGuidance.value) || 5.0;
        const rescaleValue = parseFloat(manualRescale.value) || 0.0;
        const upscaleValue = manualUpscale.getAttribute('data-state') === 'on';
        const modelValue = manualModel.value; // Capture model value before modal is hidden
        const useLayer1Seed = layer1SeedToggle.getAttribute('data-state') === 'on'; // Capture toggle state
        
        // Capture pipeline context BEFORE hiding modal (which clears it)
        let pipelineContext = { ...window.currentPipelineEdit };
        
        showLoading(true, 'Generating pipeline...');
        hideManualModal();
        
        try {
            // Build layer2 configuration from form values
            const layer2Config = {
                prompt: prompt,
                model: modelValue, // Use the captured model value
                resolution: resolution,
                steps: stepsValue,
                guidance: guidanceValue,
                rescale: rescaleValue,
                allow_paid: true
            };
            
            if (ucValue) {
                layer2Config.uc = ucValue;
            }
            
            if (seedValue) {
                layer2Config.seed = parseInt(seedValue);
            }
            
            if (samplerValue) {
                const samplerObj = getSamplerByMeta(samplerValue);
                layer2Config.sampler = samplerObj ? samplerObj.request : samplerValue;
            }
            
            if (noiseSchedulerValue) {
                const noiseObj = getNoiseByMeta(noiseSchedulerValue);
                layer2Config.noiseScheduler = noiseObj ? noiseObj.request : noiseSchedulerValue;
            }
            
            // Add upscale if enabled
            if (upscaleValue) {
                layer2Config.upscale = true;
            }
            
            // Add variety if enabled
            if (varietyEnabled) {
                layer2Config.variety = true;
                varietyEnabled = false;
                if (document.getElementById('varietyBtn')) document.getElementById('varietyBtn').setAttribute('data-state', 'off');
            }
            
            // Build pipeline request body using captured pipeline context
            const pipelineRequestBody = {
                preset: pipelineContext.pipelineName,
                layer2: layer2Config,
                resolution: resolution
            };
            
            // Check if layer1 seed toggle is enabled and we have a layer1 seed
            if (useLayer1Seed && pipelineContext.layer1Seed) {
                pipelineRequestBody.layer1_seed = pipelineContext.layer1Seed;
            }
            
            // Add mask bias if dropdown is visible and has a value
            if (manualMaskBiasDropdown && manualMaskBiasDropdown.style.display !== 'none' && manualMaskBiasHidden) {
                pipelineRequestBody.mask_bias = parseInt(manualMaskBiasHidden.value);
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
            
            // Create a temporary image to get dimensions
            const img = new Image();
            img.onload = function() {
                createConfetti();
                showSuccess('Pipeline edited successfully!');
                
                // Clear pipeline context
                window.currentPipelineEdit = null;
                
                // Refresh gallery and show the new image in lightbox
                setTimeout(async () => {
                    await loadGallery();
                    
                    // Refresh balance after successful pipeline generation
                    await loadBalance();
                    
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
            
        } catch (error) {
            console.error('Pipeline edit generation error:', error);
            showError('Pipeline generation failed. Please try again.');
            // Clear pipeline context on error
            window.currentPipelineEdit = null;
        } finally {
            showLoading(false);
        }
    } else if (isVariationEdit || currentRequestType === 'variation' || (currentRequestType === 'reroll' && isVariationEdit)) {
        // Handle variation edit reroll (including reroll mode for variations with base images)
        // Validate required fields for variation editing
        const model = manualModel.value;
        const prompt = manualPrompt.value.trim();
        const resolutionValue = manualResolution.value;
        
        if (!model || !prompt || !resolutionValue) {
            showError('Please fill in all required fields (Model, Prompt, Resolution)');
            return;
        }
        
        // Process resolution value (handle custom resolution)
        const resolutionData = processResolutionValue(resolutionValue);
        const resolution = resolutionData.isCustom ? `${resolutionData.width}x${resolutionData.height}` : resolutionData.resolution;
        
        // Capture all form values BEFORE hiding the modal (which clears the form)
        const ucValue = manualUc.value.trim();
        const seedValue = manualSeed.value.trim();
        const samplerValue = manualSampler.value;
        const noiseSchedulerValue = manualNoiseScheduler.value;
        const stepsValue = parseInt(manualSteps.value) || 25;
        const guidanceValue = parseFloat(manualGuidance.value) || 5.0;
        const rescaleValue = parseFloat(manualRescale.value) || 0.0;
        const upscaleValue = manualUpscale.getAttribute('data-state') === 'on';
        const modelValue = manualModel.value; // Capture model value before modal is hidden
        const filename = window.currentVariationEdit?.sourceFilename;
        
        if (!filename) {
            showError('No source image found for variation');
            return;
        }
        
        showLoading(true, 'Generating variation...');
        
        try {
            // Capture strength and noise values right before sending request
            const strength = parseFloat(document.getElementById('manualStrength').value) || 0.8;
            const noise = parseFloat(document.getElementById('manualNoise').value) || 0.1;
            
            // Build request body for variation
            const requestBody = {
                image: filename,
                strength: strength,
                noise: noise,
                prompt: prompt,
                resolution: resolution,
                steps: stepsValue,
                guidance: guidanceValue,
                rescale: rescaleValue,
                allow_paid: true
            };
            
            if (ucValue) {
                requestBody.uc = ucValue;
            }
            
            if (seedValue) {
                requestBody.seed = parseInt(seedValue);
            }
            
            if (samplerValue) {
                const samplerObj = getSamplerByMeta(samplerValue);
                requestBody.sampler = samplerObj ? samplerObj.request : samplerValue;
            }
            
            if (noiseSchedulerValue) {
                const noiseObj = getNoiseByMeta(noiseSchedulerValue);
                requestBody.noiseScheduler = noiseObj ? noiseObj.request : noiseSchedulerValue;
            }
            
            // Add upscale if enabled
            if (upscaleValue) {
                requestBody.upscale = true;
            }
            
            // Add variety if enabled
            if (varietyEnabled) {
                requestBody.variety = true;
                varietyEnabled = false;
                if (document.getElementById('varietyBtn')) document.getElementById('varietyBtn').setAttribute('data-state', 'off');
            }
            
            // Add character prompts if available
            const characterPrompts = getCharacterPrompts();
            if (characterPrompts.length > 0) {
                requestBody.allCharacterPrompts = characterPrompts;
                requestBody.use_coords = false;
                const container = document.getElementById('characterPromptsContainer');
                const characterItems = container.querySelectorAll('.character-prompt-item');
                const autoPositionBtn = document.getElementById('autoPositionBtn');
                const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';
                if (!isAutoPosition) {
                    if (Array.from(characterItems).some(item => item.dataset.positionX && item.dataset.positionY)) {
                        requestBody.use_coords = true;
                    }
                }
            }
            
            // Generate variation
            const url = `/${modelValue.toLowerCase()}/generate`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                throw new Error(`Variation generation failed: ${response.statusText}`);
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            
            // Create a temporary image to get dimensions
            const img = new Image();
            img.onload = function() {
                createConfetti();
                showSuccess('Variation generated successfully!');
                
                // Clear variation context
                window.currentVariationEdit = null;
                
                // Refresh gallery and show the new image in lightbox
                setTimeout(async () => {
                    await loadGallery();
                    
                    // Refresh balance after successful variation generation
                    await loadBalance();
                    
                    // Find the newly generated image (should be the first one)
                    if (allImages.length > 0) {
                        const newImage = allImages[0]; // Newest image is first
                        const imageToShow = {
                            filename: newImage.upscaled || newImage.original,
                            base: newImage.base,
                            upscaled: newImage.upscaled
                        };
                        showLightbox(imageToShow);
                    }
                }, 1000);
            };
            img.src = imageUrl;
            
        } catch (error) {
            console.error('Variation generation error:', error);
            showError('Variation generation failed. Please try again.');
            // Clear variation context on error
            window.currentVariationEdit = null;
        } finally {
            showLoading(false);
            hideManualModal();
        }
    } else if (currentRequestType === 'reroll' || !currentRequestType) {
        // Handle regular manual generation or reroll (existing logic)
        // Validate required fields
        const model = manualModel.value;
        const prompt = manualPrompt.value.trim();
        const resolutionValue = manualResolution.value;
        
        if (!model || !prompt || !resolutionValue) {
            showError('Please fill in all required fields (Model, Prompt, Resolution)');
            return;
        }
        
        // Process resolution value (handle custom resolution)
        const resolutionData = processResolutionValue(resolutionValue);
        const resolution = resolutionData.isCustom ? `${resolutionData.width}x${resolutionData.height}` : resolutionData.resolution;
        
        // Capture all form values BEFORE hiding the modal (which clears the form)
        const ucValue = manualUc.value.trim();
        const seedValue = manualSeed.value.trim();
        const samplerValue = manualSampler.value;
        const noiseSchedulerValue = manualNoiseScheduler.value;
        const stepsValue = parseInt(manualSteps.value) || 25;
        const guidanceValue = parseFloat(manualGuidance.value) || 5.0;
        const rescaleValue = parseFloat(manualRescale.value) || 0.0;
        const upscaleValue = manualUpscale.getAttribute('data-state') === 'on';
        const modelValue = manualModel.value; // Capture model value before modal is hidden
        const presetName = manualPresetName.value.trim(); // Capture preset name before modal is hidden
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';
        const container = document.getElementById('characterPromptsContainer');
        const characterItems = container.querySelectorAll('.character-prompt-item');
        const characterPrompts = getCharacterPrompts();        
        showLoading(true, 'Generating image...');
        
        try {
            // Build request body using captured values
            const requestBody = {
                prompt: prompt,
                resolution: resolution,
                steps: stepsValue,
                guidance: guidanceValue,
                rescale: rescaleValue,
                allow_paid: true
            };
            
            // Add preset name if provided
            if (presetName) {
                requestBody.preset = presetName;
            }
            
            if (ucValue) {
                requestBody.uc = ucValue;
            } else {
            }
            
            if (seedValue) {
                requestBody.seed = parseInt(seedValue);
            }
            
            if (samplerValue) {
                const samplerObj = getSamplerByMeta(samplerValue);
                requestBody.sampler = samplerObj ? samplerObj.request : samplerValue;
            }
            
            if (noiseSchedulerValue) {
                const noiseObj = getNoiseByMeta(noiseSchedulerValue);
                requestBody.noiseScheduler = noiseObj ? noiseObj.request : noiseSchedulerValue;
            }
            
            // Add upscale if enabled
            if (upscaleValue) {
                requestBody.upscale = true;
            }
            
            // Add variety if enabled
            if (varietyEnabled) {
                requestBody.variety = true;
                varietyEnabled = false;
                if (document.getElementById('varietyBtn')) document.getElementById('varietyBtn').setAttribute('data-state', 'off');
            }
            
             if (characterPrompts.length > 0) {
                // Send all character data for forge storage
                requestBody.allCharacterPrompts = characterPrompts;
                requestBody.use_coords = false;
                
                // Check for manual positions
                if (!isAutoPosition) {
                    if (Array.from(characterItems).some(item => item.dataset.positionX && item.dataset.positionY)) {
                        requestBody.use_coords = true;
                    }
                }
            }
            
            // Generate image
            const url = `/${modelValue.toLowerCase()}/generate`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                throw new Error(`Generation failed: ${response.statusText}`);
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            
            // Create a temporary image to get dimensions
            const img = new Image();
            img.onload = function() {
                createConfetti();
                showSuccess('Image generated successfully!');
                
                // Refresh gallery and show the new image in lightbox
                setTimeout(async () => {
                    await loadGallery();
                    
                    // Find the newly generated image (should be the first one)
                    if (allImages.length > 0) {
                        const newImage = allImages[0]; // Newest image is first
                        const imageToShow = {
                            filename: newImage.upscaled || newImage.original,
                            base: newImage.base,
                            upscaled: newImage.upscaled
                        };
                        showLightbox(imageToShow);
                    }
                }, 1000);
            };
            img.src = imageUrl;
            
        } catch (error) {
            console.error('Manual generation error:', error);
            showError('Image generation failed. Please try again.');
        } finally {
            showLoading(false);
            hideManualModal();
        }
    }
}

// Save manual preset (this would need a backend endpoint)
async function saveManualPreset(presetName, config) {
    try {
        const response = await fetchWithAuth('/preset/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: presetName,
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
            hideManualModal();
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
    
    // Build preset data
    const presetData = {
        prompt: prompt,
        uc: manualUc.value.trim(),
        model: model,
        resolution: manualResolution.value,
        steps: parseInt(manualSteps.value) || 25,
        guidance: parseFloat(manualGuidance.value) || 5.0,
        rescale: parseFloat(manualRescale.value) || 0.0,
        upscale: manualUpscale.getAttribute('data-state') === 'on',
        characterPrompts: getCharacterPrompts()
    };
    
    // Set auto position button state
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    presetData.use_coords = autoPositionBtn.getAttribute('data-state') === 'on';
    
    // Check if this is a variation/reroll with base image
    const variationImage = document.getElementById('manualVariationImage');
    if (variationImage && variationImage.style.display !== 'none' && window.currentVariationEdit) {
        presetData.variation = {
            file: window.currentVariationEdit.sourceFilename,
            strength: parseFloat(document.getElementById('manualStrength').value) || 0.8,
            noise: parseFloat(document.getElementById('manualNoise').value) || 0.1
        };
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
    
    await saveManualPreset(presetName, presetData);
}

// Autocomplete functions
function handleAutocompleteInput(e) {
    const target = e.target;
    const value = target.value;
    const cursorPos = target.selectionStart;
    
    // Find if we're inside a <placeholder> tag
    const beforeCursor = value.substring(0, cursorPos);
    const match = beforeCursor.match(/<([^>]*)$/);
    
    if (match) {
        const partial = match[1];
        showAutocompleteSuggestions(partial, target);
    } else {
        hideAutocomplete();
    }
}

function handleAutocompleteKeydown(e) {
    if (!autocompleteOverlay.classList.contains('hidden')) {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
                updateAutocompleteSelection();
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
                updateAutocompleteSelection();
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
                    insertAutocompleteSuggestion(items[selectedAutocompleteIndex].dataset.value);
                }
                break;
            case 'Escape':
                hideAutocomplete();
                break;
        }
    }
}

function showAutocompleteSuggestions(partial, target) {
    currentAutocompleteTarget = target;
    selectedAutocompleteIndex = -1;
    
    // Filter text replacements that match the partial
    const suggestions = Object.keys(textReplacements).filter(key => 
        key.toLowerCase().includes(partial.toLowerCase())
    ).slice(0, 10); // Limit to 10 suggestions
    
    if (suggestions.length === 0) {
        hideAutocomplete();
        return;
    }
    
    // Populate autocomplete list
    autocompleteList.innerHTML = '';
    suggestions.forEach((key, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.dataset.value = key;
        item.innerHTML = `
            <div class="placeholder-name">${key}</div>
            <div class="placeholder-desc">${textReplacements[key]}</div>
        `;
        item.addEventListener('click', () => insertAutocompleteSuggestion(key));
        autocompleteList.appendChild(item);
    });
    
    // Position overlay
    const rect = target.getBoundingClientRect();
    autocompleteOverlay.style.left = rect.left + 'px';
    autocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    autocompleteOverlay.style.width = rect.width + 'px';
    
    autocompleteOverlay.classList.remove('hidden');
}

function updateAutocompleteSelection() {
    const items = autocompleteList.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedAutocompleteIndex);
    });
}

function insertAutocompleteSuggestion(value) {
    if (!currentAutocompleteTarget) return;
    
    const target = currentAutocompleteTarget;
    const cursorPos = target.selectionStart;
    const value_before = target.value.substring(0, cursorPos);
    const value_after = target.value.substring(cursorPos);
    
    // Find the start of the <placeholder> tag
    const beforeCursor = value_before;
    const match = beforeCursor.match(/<([^>]*)$/);
    
    if (match) {
        const startPos = beforeCursor.lastIndexOf('<');
        const newValue = value_before.substring(0, startPos) + '<' + value + '>' + value_after;
        target.value = newValue;
        
        // Set cursor position after the inserted placeholder
        const newCursorPos = startPos + value.length + 2; // +2 for < and >
        target.setSelectionRange(newCursorPos, newCursorPos);
    }
    
    hideAutocomplete();
}

function hideAutocomplete() {
    autocompleteOverlay.classList.add('hidden');
    currentAutocompleteTarget = null;
    selectedAutocompleteIndex = -1;
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
                <span class="character-name">${result.placeholder}</span>
                <span class="character-copyright">Text Replacement</span>
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

    showLoading(true, 'Generating image...');

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
            // Add mask_bias if dropdown is visible
            if (maskBiasDropdown && maskBiasDropdown.style.display !== 'none') {
                params.append('mask_bias', maskBiasDropdown.value);
            }
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
        // Wait for the image to load, then refresh gallery and open the correct image
        const img = new Image();
        img.onload = async function() {
            createConfetti();
            showSuccess('Image generated successfully!');
            
            // Reset variety flag if it was enabled
            if (varietyEnabled) {
                varietyEnabled = false;
                if (document.getElementById('varietyBtn')) document.getElementById('varietyBtn').setAttribute('data-state', 'off');
            }
            
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
        showLoading(false);
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
    
    // Convert snake_case to Title Case
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
function showLoading(show, message = 'Generating your image...') {
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

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .no-images {
        grid-column: 1 / -1;
        text-align: center;
        padding: 50px;
        color: #666;
        font-size: 1.2rem;
    }
    
    .upscale-btn {
        font-size: 0.9rem;
        padding: 8px 16px;
    }
`;
document.head.appendChild(style); 

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

// Toggle request type functionality
function toggleRequestType(requestType) {
    const rerollTypeBtn = document.getElementById('rerollTypeBtn');
    const variationTypeBtn = document.getElementById('variationTypeBtn');
    const variationRow = document.getElementById('manualVariationRow');
    const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
    const saveButton = document.getElementById('manualSaveBtn');
    const layer1SeedToggle = document.getElementById('layer1SeedToggle');
    
    if (requestType === 'reroll') {
        // Switch to reroll mode
        rerollTypeBtn.setAttribute('data-state', 'on');
        variationTypeBtn.setAttribute('data-state', 'off');
        window.currentRequestType = 'reroll';
        
        // Hide variation-specific fields
        if (variationRow) {
            variationRow.style.display = 'none';
        }
        
        // Show preset name and save button for regular images
        if (presetNameGroup) {
            presetNameGroup.style.display = 'block';
            manualPresetName.disabled = false;
            manualPresetName.style.opacity = '1';
        }
        if (saveButton) {
            saveButton.style.display = 'inline-block';
        }
        
        // Load metadata into manual form for reroll
        if (window.currentEditMetadata && window.currentEditImage) {
            const metadata = window.currentEditMetadata;
            const image = window.currentEditImage;
            
            // Check if this is a variation and we have the original base image
            const isVariation = metadata.base_image === true;
            const hasOriginalFilename = metadata.original_filename;
            
            if (isVariation && hasOriginalFilename) {
                // For variations, use the original base image for reroll                
                // Load metadata into manual form
                loadMetadataIntoManualForm(metadata, image);
                
                // Show variation-specific fields for variations in reroll mode
                if (variationRow) {
                    variationRow.style.display = 'flex';
                }
                
                // Set the variation image to the original base image
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage) {
                    variationImage.src = `/images/${hasOriginalFilename}`;
                    variationImage.style.display = 'block';
                }
                
                // Store variation context for reroll
                window.currentVariationEdit = {
                    sourceFilename: hasOriginalFilename,
                    isVariationEdit: true
                };
            } else {
                // For regular images, use the current image
                loadMetadataIntoManualForm(metadata, image);
                
                // Hide variation-specific fields for regular images
                if (variationRow) {
                    variationRow.style.display = 'none';
                }
                
                // Clear any variation context
                window.currentVariationEdit = null;
            }
            
            // Set layer1 seed toggle to OFF for reroll
            if (layer1SeedToggle) {
                layer1SeedToggle.setAttribute('data-state', 'off');
                layer1SeedToggle.style.display = 'none';
            }
            
            // Hide mask bias dropdown for reroll
            if (manualMaskBiasGroup) {
                manualMaskBiasGroup.style.display = 'none';
            }
        }
        
    } else if (requestType === 'variation') {
        // Switch to variation mode
        rerollTypeBtn.setAttribute('data-state', 'off');
        variationTypeBtn.setAttribute('data-state', 'on');
        window.currentRequestType = 'variation';
        
        // Show variation-specific fields
        if (variationRow) {
            variationRow.style.display = 'flex';
        }
        
        // Hide preset name and save button for variations
        if (presetNameGroup) {
            presetNameGroup.style.display = 'none';
        }
        if (saveButton) {
            saveButton.style.display = 'none';
        }
        
        // Load metadata into variation form
        if (window.currentEditMetadata && window.currentEditImage) {
            const metadata = window.currentEditMetadata;
            const image = window.currentEditImage;
            
            // Check if this is a variation and we have the original base image
            const isVariation = metadata.base_image === true;
            const hasOriginalFilename = metadata.original_filename;
            
            if (isVariation && hasOriginalFilename) {
                // For variations, use the current image as the new base                
                // Load metadata into variation form
                loadMetadataIntoVariationForm(metadata, image);
                
                // Set the variation image to the current image
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage) {
                    variationImage.src = `/images/${image.filename || image.original || image.pipeline || image.pipeline_upscaled}`;
                    variationImage.style.display = 'block';
                }
                
                // Store variation context using current image
                window.currentVariationEdit = {
                    sourceFilename: image.filename || image.original || image.pipeline || image.pipeline_upscaled,
                    isVariationEdit: true
                };
            } else {
                // For regular images, use the current image as base
                loadMetadataIntoVariationForm(metadata, image);
                
                // Set the variation image to the current image
                const variationImage = document.getElementById('manualVariationImage');
                if (variationImage) {
                    variationImage.src = `/images/${image.filename || image.original || image.pipeline || image.pipeline_upscaled}`;
                    variationImage.style.display = 'block';
                }
                
                // Store variation context
                window.currentVariationEdit = {
                    sourceFilename: image.filename || image.original || image.pipeline || image.pipeline_upscaled,
                    isVariationEdit: true
                };
            }
            
            // Hide the layer1 seed toggle for variations
            if (layer1SeedToggle) {
                layer1SeedToggle.style.display = 'none';
            }
            
            // Hide mask bias dropdown for variations
            if (manualMaskBiasGroup) {
                manualMaskBiasGroup.style.display = 'none';
            }
        }
    }
}

// Modal background click to close
// window.addEventListener('click', (e) => {
//     if (e.target === loginModal) hideLoginModal();
//     if (e.target === manualModal) hideManualModal();
// });

// Metadata dialog elements
const metadataDialog = document.getElementById('metadataDialog');
const closeMetadataDialog = document.getElementById('closeMetadataDialog');
const dialogPromptBtn = document.getElementById('dialogPromptBtn');
const dialogUcBtn = document.getElementById('dialogUcBtn');
const dialogPromptExpanded = document.getElementById('dialogPromptExpanded');
const dialogUcExpanded = document.getElementById('dialogUcExpanded');
const dialogPromptContent = document.getElementById('dialogPromptContent');
const dialogUcContent = document.getElementById('dialogUcContent');

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

// Helper: Get dimensions from resolution name (copied from server)
function getDimensionsFromResolution(resolution) {
    const map = {
        "small_portrait": { width: 512, height: 768 },
        "small_landscape": { width: 768, height: 512 },
        "small_square": { width: 640, height: 640 },
        "normal_portrait": { width: 832, height: 1216 },
        "normal_landscape": { width: 1216, height: 832 },
        "normal_square": { width: 1024, height: 1024 },
        "large_portrait": { width: 1024, height: 1536 },
        "large_landscape": { width: 1536, height: 1024 },
        "large_square": { width: 1472, height: 1472 },
        "wallpaper_portrait": { width: 1088, height: 1920 },
        "wallpaper_landscape": { width: 1920, height: 1088 }
    };
    return map[resolution && resolution.toLowerCase()] || null;
}

// Show/hide mask bias dropdown based on pipeline/resolution
function updateMaskBiasDropdown() {
    if (!presetSelect || !resolutionSelect || !maskBiasDropdown) return;
    const selectedValue = presetSelect.value;
    const [type, name] = selectedValue.split(':');
    if (type !== 'pipeline' || !name) {
        maskBiasDropdown.style.display = 'none';
        return;
    }
    const pipelinePresetRes = getPipelinePresetResolution(name);
    const selectedRes = resolutionSelect.value;
    if (!pipelinePresetRes || !selectedRes) {
        maskBiasDropdown.style.display = 'none';
        return;
    }
    const presetDims = getDimensionsFromResolution(pipelinePresetRes);
    const selectedDims = getDimensionsFromResolution(selectedRes);
    if (!presetDims || !selectedDims) {
        maskBiasDropdown.style.display = 'none';
        return;
    }
    // Show dropdown only if aspect ratio or size does not match
    if (presetDims.width !== selectedDims.width || presetDims.height !== selectedDims.height) {
        maskBiasDropdown.style.display = '';
    } else {
        maskBiasDropdown.style.display = 'none';
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
                            <i class="fas fa-ban"></i> Undesired Content
                        </button>
                        <div class="character-name-editable" onclick="editCharacterName('${characterId}')">
                            <span class="character-name-text">Character ${characterPromptCounter}</span>
                            <i class="nai-settings"></i>
                        </div>
                    </div>
                <div class="character-prompt-controls">
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
        promptField.addEventListener('input', handleAutocompleteInput);
        promptField.addEventListener('keydown', handleAutocompleteKeydown);
        promptField.addEventListener('input', handleCharacterAutocompleteInput);
        promptField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
    }
    
    if (ucField) {
        ucField.addEventListener('input', handleAutocompleteInput);
        ucField.addEventListener('keydown', handleAutocompleteKeydown);
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
        
        let center = { x: 0.5, y: 0.5 };
        
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
                            <i class="fas fa-ban"></i> Undesired Content
                        </button>
                        <div class="character-name-editable" onclick="editCharacterName('${characterId}')">
                            <span class="character-name-text">${character.chara_name || `Character ${index + 1}`}</span>
                            <i class="nai-settings"></i>
                        </div>
                    </div>
                    <div class="character-prompt-controls">
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
            promptField.addEventListener('input', handleAutocompleteInput);
            promptField.addEventListener('keydown', handleAutocompleteKeydown);
            promptField.addEventListener('input', handleCharacterAutocompleteInput);
            promptField.addEventListener('keydown', handleCharacterAutocompleteKeydown);
        }
        
        if (ucField) {
            ucField.addEventListener('input', handleAutocompleteInput);
            ucField.addEventListener('keydown', handleAutocompleteKeydown);
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
 * Single unified price‐calculator.
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
        const strength = parseFloat(manualStrength.value) || 1.0;
        
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
        const isImg2Img = document.getElementById('manualMaskBiasRow')?.style?.display !== 'none' || document.getElementById('manualVariationRow')?.style?.display !== 'none';
        
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
        priceList.textContent = `${price.list}`;
        
        // Apply styling for free opus price
        priceDisplay.classList.toggle('free', price.opus === 0);
        
        // Show the price display
        priceDisplay.style.display = 'flex';
        
    } catch (error) {
        console.error('Error calculating price:', error);
        priceDisplay.style.display = 'none';
    }
}

// Set background image from one of the last 5 images
function setBackgroundImage() {
    if (allImages.length === 0) {
        // If no images, remove background image and use default gradient
        document.documentElement.style.setProperty('--background-image', 'none');
        return;
    }
    
    // Get the last 5 images (or all if less than 5)
    const recentImages = allImages.slice(-5);
    
    // Randomly select one of the recent images
    const randomIndex = Math.floor(Math.random() * recentImages.length);
    const selectedImage = recentImages[randomIndex];
    
    // Determine which image file to use (prefer highest quality)
    let imageFilename = null;
    if (selectedImage.pipeline_upscaled) {
        imageFilename = selectedImage.pipeline_upscaled;
    } else if (selectedImage.pipeline) {
        imageFilename = selectedImage.pipeline;
    } else if (selectedImage.upscaled) {
        imageFilename = selectedImage.upscaled;
    } else if (selectedImage.original) {
        imageFilename = selectedImage.original;
    }
    
    if (imageFilename) {
        // Set the background image CSS variable using the /images/ endpoint
        const imageUrl = `url('/images/${imageFilename}')`;
        document.documentElement.style.setProperty('--background-image', imageUrl);
    } else {
        // Fallback to default gradient if no valid image found
        document.documentElement.style.setProperty('--background-image', 'none');
    }
}

// Periodically refresh background image (every 30 seconds)
function startBackgroundImageRotation() {
    setInterval(() => {
        if (allImages.length > 0) {
            setBackgroundImage();
        }
    }, 30000); // 30 seconds
}