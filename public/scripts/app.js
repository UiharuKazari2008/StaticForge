// MANUAL MODAL MANAGEMENT SYSTEM - Move to manualModalManager.js
// This system handles the manual modal's open/close, form clearing, preview management, and related DOM elements
// Includes functions: showManualPreview, hideManualPreview, hideManualPreviewResponsive, clearManualForm,
// collectManualFormValues, collectVibeTransferData, addSharedFieldsToRequestBody, etc.

// DOM elements
const manualModal = document.getElementById('manualModal');
const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
const manualGenerateBtn = document.getElementById('manualGenerateBtn');
const manualForm = document.getElementById('manualForm');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualPreviewCloseBtn = document.getElementById('manualPreviewCloseBtn');
const openGenEditorBtn = document.getElementById('openGenEditorBtn');
const generatePresetBtn = document.getElementById('generatePresetBtn');
const presetSelect = document.getElementById('presetSelect');
// GALLERY MANAGEMENT SYSTEM - Move to galleryManager.js or integrate with existing galleryView.js
// This system handles gallery display, infinite scrolling, image management, and gallery navigation
// Includes functions: clearGallery, loadGalleryFromIndex, displayGalleryFromStartIndex,
// removeImageFromGallery, updateGalleryPinButtons, etc.
// Note: Check galleryView.js for existing gallery functions before moving

const gallery = document.getElementById('gallery');
// bulkSelectAllBtn removed - now handled by context menu
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
const manualRescaleOverlay = manualRescale?.parentElement?.querySelector('.percentage-input-overlay');
const manualNoiseScheduler = document.getElementById('manualNoiseScheduler');
const manualPresetName = document.getElementById('manualPresetName');
const manualUpscale = document.getElementById('manualUpscale');
const clearSeedBtn = document.getElementById('clearSeedBtn');
const editSeedBtn = document.getElementById('editSeedBtn');
const focusOverlay = document.getElementById('focus-overlay');
let savedGalleryPosition = null;
let galleryClearTimeout = null;
const manualNoiseSchedulerDropdown = document.getElementById('manualNoiseSchedulerDropdown');
const manualNoiseSchedulerDropdownBtn = document.getElementById('manualNoiseSchedulerDropdownBtn');
const manualNoiseSchedulerDropdownMenu = document.getElementById('manualNoiseSchedulerDropdownMenu');

// DROPDOWN MANAGEMENT SYSTEM - Move to manualDropdownManager.js
// This system handles all manual generation dropdowns (model, sampler, noise scheduler, resolution, preset, etc.)
// Includes functions: renderManualModelDropdown, selectManualModel, renderManualSamplerDropdown,
// selectManualSampler, renderManualNoiseSchedulerDropdown, selectManualNoiseScheduler,
// renderManualResolutionDropdown, renderCustomPresetDropdown, selectCustomPreset, etc.
// Also includes renderSimpleDropdown utility function
// NOTE: Some dropdown utilities like renderGroupedDropdown, openDropdown, closeDropdown already exist in dropdown.js
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
const manualResolutionGroup = document.getElementById('manualResolutionGroup');
const customPresetDropdown = document.getElementById('customPresetDropdown');
const customPresetDropdownBtn = document.getElementById('customPresetDropdownBtn');
const customPresetDropdownMenu = document.getElementById('customPresetDropdownMenu');
const customPresetSelected = document.getElementById('customPresetSelected');
const clearPresetBtn = document.getElementById('clearPresetBtn');
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
window.manualSelectedModel = manualSelectedModel;
const manualPresetDeleteBtn = document.getElementById('manualDeleteBtn');

// PRESET MANAGEMENT SYSTEM - Move to presetManagement.js or integrate with existing presetManager.js
// This system handles preset loading, saving, validation, and management
// Includes functions: loadPresetIntoForm, updatePresetLoadSaveState, validatePresetWithTimeout,
// isValidPresetName, updateManualPresetToggleBtn, processResolutionValue, sanitizeCustomDimensions,
// renderCustomPresetDropdown, selectCustomPreset, closeCustomPresetDropdown
// Note: Some preset functions may already exist in presetManager.js - check for duplicates

const searchToggleBtn = document.getElementById('searchToggleBtn');
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
const previewBaseImageBtn = document.getElementById('previewBaseImageBtn');
const transformationDropdown = document.getElementById('transformationDropdown');
const transformationDropdownBtn = document.getElementById('transformationDropdownBtn');
const transformationDropdownMenu = document.getElementById('transformationDropdownMenu');
const manualPreviewDownloadBtn = document.getElementById('manualPreviewDownloadBtn');
const manualPreviewCopyBtn = document.getElementById('manualPreviewCopyBtn');
const manualPreviewUpscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
const manualPreviewVariationBtn = document.getElementById('manualPreviewVariationBtn');
const manualPreviewSeedBtn = document.getElementById('manualPreviewSeedBtn');
const manualPreviewDeleteBtn = document.getElementById('manualPreviewDeleteBtn');
const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
const manualStrengthValue = document.getElementById('manualStrengthValue');
const manualStrengthOverlay = manualStrengthValue?.parentElement?.querySelector('.percentage-input-overlay');
const manualNoiseValue = document.getElementById('manualNoiseValue');
const manualNoiseOverlay = manualNoiseValue?.parentElement?.querySelector('.percentage-input-overlay');
const paidRequestToggle = document.getElementById('paidRequestToggle');
const previewContainer = document.getElementById('manualPreviewContainer');
const previewStars = document.getElementById('previewStars');
const previewBackgroundLines = document.getElementById('previewBackgroundLines');
const previewForegroundLines = document.getElementById('previewForegroundLines');

let bypassConfirmation = false;
let previewRatio = 1;
// Function to calculate and set previewRatio based on container dimensions
function calculatePreviewRatio() {
    const container = document.querySelector('.manual-preview-image-container-inner');
    if (!container) return 1;
    
    const computedStyle = getComputedStyle(container);
    const width = parseFloat(computedStyle.width);
    const height = parseFloat(computedStyle.height);
    
    if (width > 0 && height > 0) {
        previewRatio = width / height;
    }
    
    return previewRatio;
}

// Function to dynamically size manual preview container based on image aspect ratio
function sizeManualPreviewContainer(imageWidth, imageHeight) {
    const container = document.querySelector('.manual-preview-image-container-inner');
    if (!container || !imageWidth || !imageHeight) return;
    
    const imageAspectRatio = imageWidth / imageHeight;
    
    // Reset container dimensions
    container.style.width = '';
    container.style.height = '';
    
    // Determine which dimension to constrain based on aspect ratio comparison
    if (imageAspectRatio > previewRatio) {
        // Image is wider than container ratio - constrain width
        container.style.width = imageWidth + 'px';
        container.style.height = '';
    } else {
        // Image is taller than container ratio - constrain height
        container.style.width = '';
        container.style.height = imageHeight + 'px';
    }
}

// Global button handler registry
const buttonHandlers = new Map();
let nextButtonId = 1;

// Global button click handler function
function handleToastButtonClick(buttonId) {
    const handler = buttonHandlers.get(buttonId);
    if (handler) {
        try {
            handler.onClick(handler.toastId);
            if (handler.closeOnClick !== false) {
                removeGlassToast(handler.toastId);
            }
            // Clean up the handler after use
            buttonHandlers.delete(buttonId);
        } catch (error) {
            console.error('Error in button click handler:', error);
        }
    } else {
        console.error('Button handler not found for ID:', buttonId);
    }
}

// Global background update state tracking
const backgroundUpdateState = {
    isAnimating: false,
    pendingRequest: null,
    lastRequest: null,
    animationPromise: null,
    callCount: 0,
    lastCallTime: 0
};

// Global debounced background update function
const updateBlurredBackground = createAnimationAwareDebounce(async (imageUrl) => {
    await updateManualPreviewBlurredBackground(imageUrl);
}, 300);

// MANUAL PREVIEW SYSTEM - Move to manualPreviewManager.js
// This system handles the manual preview functionality, lightbox, and preview image management
// Includes functions: showManualPreview, hideManualPreview, hideManualPreviewResponsive,
// initializeManualPreviewLightbox, handleManualPreviewClick, handleManualPreviewScroll,
// registerManualPreviewEventListeners, deregisterManualPreviewEventListeners,
// updateManualPreviewNavigation, resetManualPreview, etc.
function showManualPreview() {
    if (window.innerWidth <= 1400) {
        const previewSection = document.getElementById('manualPanelSection');
        if (previewSection) {
            previewSection.classList.add('active');
        }
        setTimeout(() => { 
            manualModal.classList.add('show-preview'); 
        }, 1);
    }
}

function hideManualPreview() {
    const previewSection = document.getElementById('manualPanelSection');
    if (previewSection) {
        previewSection.classList.remove('active');
    }
    manualModal.classList.remove('show-preview');
}

function hideManualPreviewResponsive() {
    // For responsive behavior, use a delay to match the original timing
    const previewSection = document.getElementById('manualPanelSection');
    if (previewSection) {
        previewSection.classList.remove('active');
    }
    setTimeout(() => { 
        manualModal.classList.remove('show-preview'); 
    }, 500);
}
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
const subTogglesBtn = document.getElementById('subTogglesBtn');
const subTogglesDropdown = document.getElementById('subTogglesDropdown');
const subTogglesDropdownMenu = document.getElementById('subTogglesDropdownMenu');
let selectedDatasets = [];  
let datasetBias = {};
const qualityToggleBtn = document.getElementById('qualityToggleBtn');
let appendQuality = true;
const ucPresetsDropdown = document.getElementById('ucPresetsDropdown');
const ucPresetsDropdownBtn = document.getElementById('ucPresetsDropdownBtn');
const ucPresetsDropdownMenu = document.getElementById('ucPresetsDropdownMenu');
let selectedUcPreset = 3; 
let presetAutocompleteTimeout = null;
let currentPresetAutocompleteTarget = null;
let selectedPresetAutocompleteIndex = -1;
const addCharacterBtn = document.getElementById('addCharacterBtn');
const characterPromptsContainer = document.getElementById('characterPromptsContainer');
const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
const transformationRow = document.getElementById('transformationRow');
const manualPreviewOriginalImage = document.getElementById('manualPreviewOriginalImage');
const sproutSeedBtn = document.getElementById('sproutSeedBtn');

let generationAnimationActive = false;
let manualBlockContainer = null; // Manual block container for wave animation
window.currentManualPreviewImage = null;
window.currentManualPreviewIndex = null;

// BLOCK CONTAINER ANIMATION SYSTEM - Move to blockAnimationManager.js
// This system handles the wave animation for the manual generation process
// Includes functions: initializeManualBlockContainer, updateManualBlockGrid,
// and related block container management and animation logic.

// Initialize manual block container for wave animation
function initializeManualBlockContainer() {
    if (manualBlockContainer) return; // Already initialized
    
    const container = document.getElementById('manualBlockContainer');
    if (!container) {
        console.warn('Manual block container not found');
        return;
    }
    
    try {
        // Get current image dimensions from preview image if available
        let width, height;
        
        const manualPreviewImage = document.getElementById('manualPreviewImage');
        if (manualPreviewImage && !manualPreviewImage.classList.contains('hidden') && manualPreviewImage.src && manualPreviewImage.src !== '') {
            // Use computed style of the preview image to get actual displayed dimensions
            const computedStyle = getComputedStyle(manualPreviewImage);
            width = parseInt(computedStyle.width.replace('px', '')) || 0;
            height = parseInt(computedStyle.height.replace('px', '')) || 0;
        }
        
        // Fall back to resolution preset if no preview image
        if (!width || !height) {
            if (manualSelectedResolution && manualSelectedResolution !== 'custom') {
                // Use the selected resolution preset
                const dimensions = getDimensionsFromResolution(manualSelectedResolution);
                if (dimensions) {
                    width = dimensions.width;
                    height = dimensions.height;
                }
            }
        }
        
        // Final fallback to manual input values
        if (!width || !height) {
            width = parseInt(manualWidth.value) || 1024;
            height = parseInt(manualHeight.value) || 1024;
        }
        
        // Calculate optimal grid dimensions to get closest to 400 blocks without going over
        const aspectRatio = height / width;
        let initialRow, initialCol;
        
        // Target: 400 blocks (30x30)
        const targetBlocks = 400;
        
        if (Math.abs(aspectRatio - 1) < 0.1) {
            // Square: calculate dimensions to get closest to 400 blocks
            const dimension = Math.floor(Math.sqrt(targetBlocks));
            initialRow = dimension;
            initialCol = dimension;
        } else if (aspectRatio > 1) {
            // Landscape: width > height
            // Calculate optimal dimensions maintaining aspect ratio
            const maxCol = Math.floor(Math.sqrt(targetBlocks / aspectRatio));
            const maxRow = Math.floor(maxCol * aspectRatio);
            
            // Ensure we don't go over target blocks
            if (maxRow * maxCol > targetBlocks) {
                initialRow = Math.floor(Math.sqrt(targetBlocks * aspectRatio));
                initialCol = Math.floor(targetBlocks / initialRow);
            } else {
                initialRow = maxRow;
                initialCol = maxCol;
            }
        } else {
            // Portrait: height > width
            // Calculate optimal dimensions maintaining aspect ratio
            const maxRow = Math.floor(Math.sqrt(targetBlocks * aspectRatio));
            const maxCol = Math.floor(maxRow / aspectRatio);
            
            // Ensure we don't go over target blocks
            if (maxRow * maxCol > targetBlocks) {
                initialCol = Math.floor(Math.sqrt(targetBlocks / aspectRatio));
                initialRow = Math.floor(targetBlocks / initialCol);
            } else {
                initialRow = maxRow;
                initialCol = maxCol;
            }
        }
        
        // Ensure minimum dimensions
        initialRow = Math.max(initialRow, 5);
        initialCol = Math.max(initialCol, 5);
        
        manualBlockContainer = new BlockContainer('#manualBlockContainer', {
            row: initialRow,
            col: initialCol,
            opacityRange: [0.05, 0.3],
            waveDelay: 30
        });
        
        // Initialize the container
        manualBlockContainer.init('ready');
    } catch (error) {
        console.error('Failed to initialize manual block container:', error);
    }
}

// Update manual block grid when starting generation
function updateManualBlockGrid() {
    if (!manualBlockContainer) return;
    
    try {
        // Get current image dimensions from preview image if available
        let width, height;
        
        const manualPreviewImage = document.getElementById('manualPreviewImage');
        if (manualPreviewImage && !manualPreviewImage.classList.contains('hidden') && manualPreviewImage.src && manualPreviewImage.src !== '') {
            // Use computed style of the preview image to get actual displayed dimensions
            const computedStyle = getComputedStyle(manualPreviewImage);
            width = parseInt(computedStyle.width.replace('px', '')) || 0;
            height = parseInt(computedStyle.height.replace('px', '')) || 0;
        }
        
        // Fall back to resolution preset if no preview image
        if (!width || !height) {
            if (manualSelectedResolution && manualSelectedResolution !== 'custom') {
                // Use the selected resolution preset
                const dimensions = getDimensionsFromResolution(manualSelectedResolution);
                if (dimensions) {
                    width = dimensions.width;
                    height = dimensions.height;
                }
            }
        }
        
        // Final fallback to manual input values
        if (!width || !height) {
            width = parseInt(manualWidth.value) || 1024;
            height = parseInt(manualHeight.value) || 1024;
        }
        
        // Update the block grid dimensions based on the resolution
        manualBlockContainer.updateGridDimensions(width, height);
    } catch (error) {
        console.error('Failed to update manual block grid:', error);
    }
}

// EVENT LISTENERS MANAGEMENT SYSTEM - Move to eventListenersManager.js
// This system handles setting up and managing all event listeners throughout the application
// Includes functions: setupEventListeners, registerManualPreviewEventListeners,
// deregisterManualPreviewEventListeners, and various event handler functions.
// NOTE: This is the MAIN event system that coordinates ALL other systems' event listeners.

// Event listener management for manual preview
let manualPreviewEventListenersRegistered = false;

function registerManualPreviewEventListeners() {
    if (manualPreviewEventListenersRegistered) return;
    
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const image = document.getElementById('manualPreviewImage');

    if (!imageContainer || !image) return;

    // Remove zoom and pan functionality - replace with lightbox functionality
    
    // Click to open lightbox
    image.addEventListener('click', handleManualPreviewClick);
    
    // Scroll up to open lightbox
    image.addEventListener('wheel', handleManualPreviewScroll, { passive: false });
    
    manualPreviewEventListenersRegistered = true;
}

function deregisterManualPreviewEventListeners() {
    if (!manualPreviewEventListenersRegistered) return;
    
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const image = imageContainer.querySelector('.manual-preview-image-container-inner');

    if (!imageContainer || !image) return;

    // Remove all event listeners
    image.removeEventListener('click', handleManualPreviewClick);
    image.removeEventListener('wheel', handleManualPreviewScroll);
    
    manualPreviewEventListenersRegistered = false;
}

// Simple button state tracking
let isGenerating = false;
let isQueueStopped = false;
let isQueueProcessing = false;

// Error Sub-Header Functions
let errorSubHeaderTimeout = null;

// Add event listener for sproutSeedBtn to toggle seed value filling
let lastLoadedSeed = null;

// Add event listener for varietyBtn to toggle a global flag for variety and toggle the active class
let varietyEnabled = false;

// GLASS TOAST NOTIFICATION SYSTEM - Move to toastManager.js or integrate with existing toasts.js
// This system handles all toast notifications throughout the application
// Includes functions: showGlassToast, updateGlassToast, removeGlassToast, getToastIcon,
// createToastContainer, updateGlassToastProgress, generateButtonsHtml, updateGlassToastButtons,
// updateGlassToastComplete, handleToastButtonClick, inspectButtonHandlers, etc.
// Note: Check if these functions already exist in toasts.js before moving

// Glass Toast Notification System
let toastCounter = 0;
const activeToasts = new Map();

// CHARACTER PROMPTS SYSTEM - Move to characterPromptManager.js
// This system handles character prompt creation, editing, positioning, and management
// Includes functions: addCharacterPrompt, deleteCharacterPrompt, moveCharacterPrompt,
// toggleCharacterPromptEnabled, updateAutoPositionToggle, showPositionDialog, hidePositionDialog,
// confirmPosition, getCharacterPrompts, clearCharacterPrompts, loadCharacterPrompts,
// getCellLabelFromCoords, toggleCharacterPromptCollapse, updateCharacterPromptCollapseButton,
// updateCharacterPromptPreview, etc.

// Character Prompts Functions
let characterPromptCounter = 0;
let currentPositionCharacterId = null;
let selectedPositionCell = null;
let lastPromptState = null;
let savedRandomPromptState = null;

let pinModalPromise = null;

let resizeTimeout = null;

// Global variables
let forcePaidRequest = false;
let wasInSearchMode = false; // Track if user was in search mode before opening manual modal

// Helper function to check if we're currently in search mode
function isInSearchMode() {
    const searchContainer = document.querySelector('#main-menu-bar .file-search-container');
    return searchContainer && !searchContainer.classList.contains('closed');
}

// Helper function to find the true index of an image in the gallery
// This handles both normal mode and search mode with filtered results
function findTrueImageIndexInGallery(filename) {
    if (!filename) return -1;
    
    // If we have filtered results, use the original array
    if (window.originalAllImages && window.originalAllImages.length > 0) {
        return window.originalAllImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }
    
    // Otherwise, use the current allImages array
    if (allImages && Array.isArray(allImages)) {
        return allImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }
    
    return -1;
}

// Make u1 array available globally for tag highlighting
if (typeof u1 !== 'undefined') {
    window.u1 = u1;
}

// UTILITY FUNCTIONS AND DATA STRUCTURES - Move to utilities.js
// This section contains various utility functions, data mappings, and helper functions
// MOVED: SAMPLER_MAP, NOISE_MAP, RESOLUTIONS, modelGroups, modelNames, modelBadges, optionsData, currentBalance
// MOVED: updateManualGenerateBtnState, updatePresetLoadSaveState, validatePresetWithTimeout, getSamplerMeta, getNoiseMeta
// TODO: Move remaining functions: addSafeEventListener, isV3Model, getCurrentSelectedModel,
// updateV3ModelVisibility, debounce, createAnimationAwareDebounce, calculatePreviewRatio,
// sizeManualPreviewContainer, correctDimensions, calculatePriceUnified, etc.

// Data structures moved to utilities.js
// TODO: Remove this comment once all references are updated


// Load preset into manual form
async function loadPresetIntoForm(presetName) {
    try {
        // Use WebSocket for preset loading
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const presetData = await window.wsClient.loadPreset(presetName);
        await loadIntoManualForm(presetData);

        showGlassToast('success', null, `${presetName} Loaded`);
        
        // Update prompt status icons after loading preset
        updatePromptStatusIcons();
    } catch (error) {
        console.error('Load preset error:', error);
        showError(`Failed to load preset "${presetName}": ${error.message}`);
    }
}

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

function closeCustomPresetDropdown() {
    if (customPresetDropdownMenu && customPresetDropdownBtn) closeDropdown(customPresetDropdownMenu, customPresetDropdownBtn);
}

// Function to generate image from a preset
async function generateFromPreset(presetName) {
    isGenerating = true;
    isInModal = false;

    let toastId;
    let progressInterval;
    
    toastId = showGlassToast('info', 'Generating Image', 'Generating image...', true, false, '<i class="nai-sparkles"></i>');
    
    // Start progress animation (1% per second)
    let progress = 0;
    progressInterval = setInterval(() => {
        progress += 1;
        updateGlassToastProgress(toastId, progress);
    }, 1000);

    try {
        // Generate image using WebSocket
        const result = await window.wsClient.generatePreset(presetName);
        
        // Extract data from the standard response format
        const filename = result.filename;
        const seed = result.seed;

        // Update the existing toast to show completion
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Image Generated',
            message: 'Image generated successfully and added to gallery',
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
        
        createConfetti();
        await loadGallery(true);
        
        if (manualModal.classList.contains('hidden')) {
            // Find the generated image in the gallery
            const found = allImages.find(img => img.original === filename || img.upscaled === filename);
            if (found) {
                // Construct proper image object with filename property
                const imageToShow = {
                    filename: filename,
                    base: found.base,
                    original: found.original,
                    upscaled: found.upscaled
                };
                showLightbox(imageToShow);
            }
        }

    } catch (error) {
        console.error('Generation error:', error);
        // Update the existing toast to show error
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Generation Failed',
            message: error.message,
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
    } finally {
        // Reset generating state
        isGenerating = false;
        
        // Clear progress and loading states
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        if (isInModal) {
            showManualLoading(false);
        }
    }
}

// Handle preset updates (save/delete)
async function handlePresetUpdate(data) {
    await loadOptions();
    
    await renderCustomPresetDropdown(selectedPreset);
    
    // Show notification
    if (data.message) {
        showGlassToast('info', null, data.message);
    }
}

// Delete a preset
async function deletePreset(presetName) {
    if (!presetName) {
        showError('No preset name provided');
        return;
    }

    // Use confirmation dialog instead of confirm()
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
            showGlassToast('success', null, result.data.message);
        } else {
            showGlassToast('success', null, `Preset "${presetName}" deleted successfully`);
        }
        
        // Clear the manual preset name input and hide delete button
        if (manualPresetName) {
            manualPresetName.value = '';
            updatePresetLoadSaveState();
        }

    } catch (error) {
        console.error('Error deleting preset:', error);
        showError('Failed to delete preset: ' + error.message);
    }
}

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
        (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`,
        { preventFocusTransfer: true }
    );
}

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

// Convert preset format to metadata format for compatibility
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

            if (presetType === 'preset') {
                type = 'preset';
                
                // Use WebSocket for preset loading
                if (!window.wsClient || !window.wsClient.isConnected()) {
                    throw new Error('WebSocket not connected');
                }
                
                const response = await window.wsClient.loadPreset(presetName);
                
                // Extract preset data from WebSocket response
                // The WebSocket client returns the data directly, not wrapped in a data property
                if (response) {
                    data = response;
                    data = convertPresetToMetadataFormat(data);
                } else {
                    console.error('❌ Invalid response structure:', response);
                    throw new Error(`Invalid preset response format. Response: ${JSON.stringify(response)}`);
                }
            } else {
                throw new Error('Invalid type');
            }

            // Preprocess sampler and noiseScheduler
            if (data.sampler && data.sampler !== undefined) {
                const samplerObj = getSamplerMeta(data.sampler);
                data.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';
            }
            if ((data.noiseScheduler && data.noiseScheduler !== undefined) || (data.noise_schedule && data.noise_schedule !== undefined)) {
                const noiseObj = getNoiseMeta(data.noiseScheduler || data.noise_schedule);
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
            if (data.sampler && data.sampler !== undefined) {
                const samplerObj = getSamplerMeta(data.sampler);
                data.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';
            }

            if (data.noise_schedule && data.noise_schedule !== undefined) {
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
        let resolutionToSet = 'normal_portrait'; // Default fallback
        let resolutionGroup = undefined;

        // Always try to detect resolution from dimensions if we have them
        if (data.width && data.height) {
            // Try to find a matching resolution preset based on width/height
            const matchingResolution = RESOLUTIONS.find(r => r.width === data.width && r.height === data.height);
            if (matchingResolution) {
                resolutionToSet = matchingResolution.value;
                // Find the group for this resolution
                for (const group of RESOLUTION_GROUPS) {
                    if (group.options.find(opt => opt.value === resolutionToSet)) {
                        resolutionGroup = group.group;
                        break;
                    }
                }
            } else {
                // No exact match found, try to match by aspect ratio to normal_ presets
                const aspectRatio = data.width / data.height;
                
                // Find the closest normal_ preset by aspect ratio
                const normalPresets = RESOLUTIONS.filter(r => r.value.startsWith('normal_'));
                let bestMatch = null;
                let bestRatioDiff = Infinity;
                
                normalPresets.forEach(preset => {
                    const presetRatio = preset.width / preset.height;
                    const ratioDiff = Math.abs(aspectRatio - presetRatio);
                    if (ratioDiff < bestRatioDiff) {
                        bestRatioDiff = ratioDiff;
                        bestMatch = preset;
                    }
                });
                
                if (bestMatch && bestRatioDiff < 0.1) { // Allow 10% tolerance for aspect ratio
                    resolutionToSet = bestMatch.value;
                    // Find the group for this resolution
                    for (const group of RESOLUTION_GROUPS) {
                        if (group.options.find(opt => opt.value === resolutionToSet)) {
                            resolutionGroup = group.group;
                            break;
                        }
                    }
                } else {
                    // No aspect ratio match found, use custom
                    resolutionToSet = 'custom';
                    resolutionGroup = 'Custom';
                    // Set custom dimensions before calling selectManualResolution
                    if (manualWidth) manualWidth.value = data.width;
                    if (manualHeight) manualHeight.value = data.height;
                }
            }
        } else if (data.resolution) {
            // Fall back to existing resolution field if no dimensions
            resolutionToSet = data.resolution.toLowerCase();
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
            // Handle both preset (guidance) and metadata (scale) formats
            const guidanceValue = data.guidance ?? data.scale ?? 5.0;
            manualGuidance.value = guidanceValue !== undefined ? Number(guidanceValue).toFixed(1) : '';
        }
        if (manualRescale) {
            // Handle both preset (rescale) and metadata (cfg_rescale) formats
            const rescaleValue = data.rescale ?? data.cfg_rescale ?? 0.0;
            manualRescale.value = rescaleValue !== undefined ? Number(rescaleValue).toFixed(2) : '';
        }
        
        // Update percentage overlays after setting rescale value
        updatePercentageOverlays();
        if (manualSeed) manualSeed.value = ''; // Do not autofill for metadata, undefined for others
        if (data.seed) {
            // Handle both preset (seed) and metadata (layer2_seed) formats
            window.lastGeneratedSeed = data.seed;
            manualPreviewSeedNumber.textContent = parseInt(window.lastGeneratedSeed);
            sproutSeedBtn.classList.add('available');
            updateSproutSeedButtonFromPreviewSeed();
        }
        // Ensure sampler and noiseScheduler have valid values before calling select functions
        const samplerValue = (data.sampler && data.sampler !== undefined && data.sampler !== null) ? data.sampler : 'k_euler_ancestral';
        const noiseValue = (data.noiseScheduler && data.noiseScheduler !== undefined && data.noiseScheduler !== null) ? data.noiseScheduler : 'karras';
        
        selectManualSampler(samplerValue);
        selectManualNoiseScheduler(noiseValue);
        if (document.getElementById('varietyBtn')) {
            const varietyBtn = document.getElementById('varietyBtn');
            // Handle both preset (variety) and metadata (skip_cfg_above_sigma) formats
            const varietyEnabled = data.variety !== null && data.variety !== undefined ? data.variety : 
                                 (data.skip_cfg_above_sigma !== null && data.skip_cfg_above_sigma !== undefined);
            varietyBtn.setAttribute('data-state', varietyEnabled ? 'on' : 'off');
        }

        // Handle upscale
        const upscaleState = data.upscale ? 'on' : 'off';
        if (manualUpscale) manualUpscale.setAttribute('data-state', upscaleState);

        // Handle character prompts and auto position
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        if (data.allCharacterPrompts && Array.isArray(data.allCharacterPrompts)) {
            // Handle new allCharacterPrompts format
            loadCharacterPrompts(data.allCharacterPrompts, data.use_coords);
            autoPositionBtn.setAttribute('data-state', data.use_coords ? 'off' : 'on');
        } else if (data.characterPrompts && Array.isArray(data.characterPrompts)) {
            loadCharacterPrompts(data.characterPrompts, data.use_coords);
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
            // Reset bias values to defaults for all datasets from config
            datasetBias = {};
            if (window.optionsData?.datasets) {
                window.optionsData.datasets.forEach(dataset => {
                    datasetBias[dataset.value] = 1.0;
                });
            }
        }
        updateDatasetDisplay();
        renderDatasetDropdown();
        updateSubTogglesButtonState();

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

        // Note: Character prompts are already handled in the first section above
        // This redundant section has been removed to prevent overwriting loaded character prompts

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
                console.warn(`⚠️ Skipping vibe transfers due to inpainting mask presence`);
                // Clear vibe references if inpainting is enabled
                if (vibeReferencesContainer) {
                    vibeReferencesContainer.innerHTML = '';
                }
                if (transformationRow) {
                    transformationRow.classList.remove('display-vibe');
                }
                if (vibeNormalizeToggle) {
                    vibeNormalizeToggle.classList.add('hidden');
                }
                // Update transformation dropdown button active state
                updateTransformationDropdownForVibes();
            } else {
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
                    vibeNormalizeToggle.classList.remove('hidden');
                }
                
                // Update transformation dropdown button active state
                updateTransformationDropdownForVibes();
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
                vibeNormalizeToggle.classList.add('hidden');
            }
            // Update transformation dropdown button active state
            updateTransformationDropdownForVibes();
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
        const hasBaseImage = data.image_source && !data.isVariationEdit;

        if (hasBaseImage) {
            const [imageType, identifier] = data.image_source.split(':', 2);
            let previewUrl = '';

            window.uploadedImageData = {
                image_source: data.image_source,
                width: 0, // Will be updated when image loads
                height: 0,
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
                await new Promise((resolve, reject) => {
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        window.uploadedImageData.width = tempImg.width;
                        window.uploadedImageData.height = tempImg.height;
                        resolve();
                    };
                    tempImg.onerror = () => {
                        reject(new Error(`Failed to load preview image from: ${previewUrl}`));
                    };
                    tempImg.src = previewUrl;
                })
                
                // Update image bias orientation after setting image dimensions
                updateImageBiasOrientation();
                
                if (variationImage) {
                    // Set the preview image source
                    variationImage.src = previewUrl;
                    variationImage.classList.remove('hidden');
                }
                // Show transformation section content
                if (transformationRow) {
                    transformationRow.classList.add('display-image');
                }
                document.getElementById('manualImg2ImgGroup').classList.remove('hidden');
            }
            // Ensure preview is updated with bias/crop
            try {
                await cropImageToResolution();
            } catch (error) {
                console.warn('Failed to crop image to resolution:', error);
                // Continue without cropping - the image will still be displayed
            }
            try {
                await refreshImageBiasState();
            } catch (error) {
                console.warn('Failed to refresh image bias state:', error);
                // Continue without bias state update
            }

            if (data.mask_compressed !== undefined && data.mask_compressed !== null) {
                // Store the compressed mask data for later use
                window.currentMaskCompressed = data.mask_compressed;

                // Process compressed mask to display resolution
                const targetWidth = data.width || 1024;
                const targetHeight = data.height || 1024;

                try {
                    window.currentMaskData = await processCompressedMask(data.mask_compressed, targetWidth, targetHeight);
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
                try {
                    const compressedMask = await convertStandardMaskToCompressed(data.mask, data.width || 1024, data.height || 1024);
                    if (compressedMask) {
                        window.currentMaskCompressed = compressedMask;
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
            
            updateInpaintButtonState();
            // Update percentage overlays after setting values
            updatePercentageOverlays();

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
            document.getElementById('manualImg2ImgGroup').classList.add('hidden');
        }
        
        // Handle variation editing - show image preview without triggering img2img mode
        if (data.isVariationEdit && data.image_source && image) {
            const [imageType, identifier] = data.image_source.split(':', 2);
            let previewUrl = '';
            
            if (imageType === 'file') {
                previewUrl = `/images/${identifier}`;
            } else if (imageType === 'cache') {
                previewUrl = `/cache/preview/${identifier}.webp`;
            }
            
            if (previewUrl && variationImage) {
                // Show the image preview for reference
                variationImage.src = previewUrl;
                variationImage.classList.remove('hidden');
                
                // Show transformation section content
                if (transformationRow) {
                    transformationRow.classList.add('display-image');
                }
            }
        }
        updateUploadDeleteButtonVisibility();

        // Type-specific handling
        if (name) {
            manualPresetName.value = name;
        }

        if (type === 'preset') {
            // Preset-specific
            const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
            if (presetNameGroup) {
                presetNameGroup.classList.remove('hidden');
                manualPresetName.disabled = false;
                manualPresetName.style.opacity = '1';
            }
            const saveButton = document.getElementById('manualSaveBtn');
            if (saveButton) saveButton.classList.remove('hidden');
        } else if (type === 'metadata') {
            manualStrengthValue.value = (data.strength !== undefined && data.strength !== null) ? data.strength : 0.8;
            manualNoiseValue.value = (data.noise !== undefined && data.noise !== null) ? data.noise : 0.1;
            if (manualUpscale) manualUpscale.checked = false;
            
            // Update percentage overlays after setting values
            updatePercentageOverlays();
            // Load image into preview panel when loading from metadata
            if (image) {
                // Check if this is a temp file (from blueprint upload)
                if (image.isTempFile) {                    
                    // For temp files, we need to handle them differently
                    if (image.tempFilename) {
                        // URL upload - use the temp file path
                        const previewUrl = `/temp/${image.tempFilename}`;
                        await loadTempImagePreview(previewUrl, image);
                    } else if (image.file) {
                        // File upload - create object URL
                        const previewUrl = URL.createObjectURL(image.file);
                        await loadTempImagePreview(previewUrl, image);
                    }
                } else {
                    // Regular saved image - use existing logic
                    let imageToShow = image.filename;
                    if (image.upscaled) {
                        imageToShow = image.upscaled;
                    } else if (image.original) {
                        imageToShow = image.original;
                    }
                    if (imageToShow) {
                        updateManualPreviewDirectly(image, image.metadata);
                    }
                }
            }
        }

        updateManualPriceDisplay(true);
        updatePresetLoadSaveState();
        updateManualPresetToggleBtn();

        // Restore the preset name that was entered by the user
        if (manualPresetName && currentPresetName) {
            manualPresetName.value = currentPresetName;
        }
        
        // Update prompt status icons after loading form data
        updatePromptStatusIcons();
    } catch (error) {
        console.error('Error loading into form:', error);
        showError('Failed to load data');
    }
}

// Function to load temp image preview (from blueprint uploads)
async function loadTempImagePreview(previewUrl, imageData) {
    try {        
        // Get the preview image element
        const previewImage = document.getElementById('manualPreviewImage');
        if (!previewImage) {
            console.warn('Preview image element not found');
            return;
        }
        
        // Get the preview container
        const previewContainer = document.getElementById('manualPreviewContainer');
        if (!previewContainer) {
            console.warn('Preview container element not found');
            return;
        }
        
        // Hide the placeholder and show the image
        const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
        if (previewPlaceholder) {
            previewPlaceholder.classList.add('hidden');
        }
        
        // Set the image source and make it visible
        previewImage.src = previewUrl;
        previewImage.classList.remove('hidden');
        
        // Add error handling for image loading
        previewImage.onerror = () => {
            console.error(`Failed to load image from: ${previewUrl}`);
            previewImage.classList.add('hidden');
            
            // Show placeholder instead
            if (previewPlaceholder) {
                previewPlaceholder.classList.remove('hidden');
                previewPlaceholder.innerHTML = `
                    <div class="manual-preview-placeholder">
                        <i class="mdi mdi-1-5 mdi-image-broken"></i>
                        <p>Failed to load image preview</p>
                    </div>
                `;
            }
        };
        
        // Show the preview section
        const previewSection = document.getElementById('manualPreviewSection');
        if (previewSection) {
            previewSection.classList.add('active');
            manualModal.classList.add('show-preview');
        }
        
        // Use the consolidated preview visibility system
        showManualPreview();
        
        // Ensure the image container has the proper classes for zoom functionality
        const imageContainer = previewContainer.querySelector('.manual-preview-image-container');
        if (imageContainer) {
            imageContainer.classList.add('initial');
            // Remove any existing zoom state
            imageContainer.classList.remove('zoomed');
        }

        // Update the preview seed display if available
        const previewSeedBtn = document.getElementById('manualPreviewSeedBtn');
        if (previewSeedBtn) {
            previewSeedBtn.classList.remove('hidden');
        }
        
        // Initialize lightbox functionality for the temp image preview
        setTimeout(() => {
            initializeManualPreviewLightbox();
        }, 1000);
        
    } catch (error) {
        console.error('Error loading temp image preview:', error);
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
                await renderImageBiasDropdown(resetBias.toString());
            }
            updateImageBiasOrientation();
        }
    }
}

function isValidPresetName(name) {
    if (!name) return false;
    return window.optionsData.presets && window.optionsData.presets.filter(e => e.name === name).length > 0;
}

function updateManualPresetToggleBtn() {
    const presetName = manualPresetName.value.trim();
    const valid = isValidPresetName(presetName);
    if (presetName === "") {
        // Hide everything, show only the toggle button as toggle-btn
        manualPresetGroup.classList.add('hidden');
        manualPresetToggleBtn.classList.remove('hidden');
        manualPresetToggleBtn.classList.add('toggle-btn');
        manualPresetToggleBtn.classList.remove('hover-show');
        manualPresetToggleText.classList.add('hidden');
        manualPresetToggleBtn.setAttribute('data-state', 'off');
        if (manualPresetToggleIcon) manualPresetToggleIcon.classList.remove('hidden');
    } else {
        // Hide the group, show the toggle button with value
        manualPresetGroup.classList.add('hidden');
        manualPresetToggleBtn.classList.remove('hidden');
        manualPresetToggleBtn.classList.remove('toggle-btn');
        manualPresetToggleBtn.classList.add('hover-show');
        manualPresetToggleText.textContent = presetName;
        manualPresetToggleText.classList.remove('hidden');
        if (manualPresetToggleIcon) manualPresetToggleIcon.classList.add('hidden');
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
      
      // Use debounced cropping for custom dimension changes to prevent excessive CPU usage
      if (typeof debouncedCropImageToResolution === 'function') {
        debouncedCropImageToResolution();
      }
    }
  }
}

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
  renderSimpleDropdown(manualSamplerDropdownMenu, SAMPLER_MAP, 'meta', 'display', selectManualSampler, closeManualSamplerDropdown, selectedVal, { preventFocusTransfer: true });
}

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

function closeManualSamplerDropdown() {
    closeDropdown(manualSamplerDropdownMenu, manualSamplerDropdownBtn);
}
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

function closeManualNoiseSchedulerDropdown() {
    closeDropdown(manualNoiseSchedulerDropdownMenu, manualNoiseSchedulerDropdownBtn);
}
function generateModelOptions() {
    manualModel.innerHTML = '<option value="">Select model...</option>';
    Object.keys(window.optionsData?.models || {}).forEach(model => {
        const option = document.createElement('option');
        option.value = model.toLowerCase(); // Use lowercase to match config
        option.textContent = window.optionsData?.models[model]; // Use pretty display name
        manualModel.appendChild(option);
    });   
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

function closeManualModelDropdown() {
    closeDropdown(manualModelDropdownMenu, manualModelDropdownBtn);
}
// TRANSFORMATION SYSTEM - Move to transformationManager.js
// This system handles image transformations (reroll, variation, browse, upload)
// Includes functions: renderTransformationDropdown, selectTransformation, handleTransformationTypeChange,
// openTransformationDropdown, closeTransformationDropdown, setupTransformationDropdownListeners,
// updateTransformationDropdownState, etc.

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

// Function to update transformation dropdown state and text
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
// Move image to scraps
async function moveToScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.addScrap(activeWorkspace, filename);
            } catch (wsError) {
                showError('Failed to move to scraps: ' + wsError.message);
                throw new Error('Failed to move to scraps');
            }
        } else {
                console.error('Move to scraps failed:', error);
                showError(`Failed to move to scraps: ${error.error}`);
                return;
        }

        showGlassToast('success', null, 'Image Scraped', false, 3000, '<i class="fas fa-trash-alt"></i>');

        // If currently viewing scraps, reload them
        switchGalleryView(currentGalleryView, true);
    } catch (error) {
        console.error('Error moving to scraps:', error);
        showError('Failed to move image to scraps');
    }
}

// Direct function to move image to scraps by filename (used by gallery context menu)
async function moveImageToScrapsDirect(filename, event = null) {
    try {
        if (!filename) {
            showError('No filename provided for moving to scraps');
            return;
        }

        // Show confirmation dialog
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to move this image to scraps?',
            [
                { text: 'Move to Scraps', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            event
        );

        if (!confirmed) {
            return;
        }

        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.addScrap(activeWorkspace, filename);
            } catch (wsError) {
                showError('Failed to move to scraps: ' + wsError.message);
                throw new Error('Failed to move to scraps');
            }
        } else {
            console.error('WebSocket not connected for moving to scraps');
            showError('Failed to move to scraps: WebSocket not connected');
            return;
        }

        showGlassToast('success', null, 'Image Scraped', false, 3000, '<i class="fas fa-trash-alt"></i>');

        // If currently viewing scraps, reload them
        switchGalleryView(currentGalleryView, true);
    } catch (error) {
        console.error('Error moving image to scraps:', error);
        showError('Failed to move image to scraps');
    }
}

// Move manual preview image to scraps and advance to next image
async function moveManualPreviewToScraps() {
    if (!window.currentManualPreviewImage) {
        showError('No image to move to scraps');
        return;
    }

    try {
        // Show navigation loading overlay
        showManualPreviewNavigationLoading(true);
        
        const filename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            showManualPreviewNavigationLoading(false);
            return;
        }

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        await window.wsClient.addScrap(activeWorkspace, filename);

        // Get the current index and view type
        const currentIndex = window.currentManualPreviewIndex ?? 0;
        const viewType = currentGalleryView || 'images';

        // Request the same image at the current index (which will now be a different image)
        try {
            const newImage = await window.wsClient.requestImageByIndex(currentIndex, viewType);
            
            if (newImage) {
                // Update the preview with the new image at the same index
                await updateManualPreview(currentIndex, null, newImage.metadata);
                showGlassToast('success', null, 'Image scrapped');
            } else {
                // No image at this index anymore, try the previous index
                if (currentIndex > 0) {
                    const prevImage = await window.wsClient.requestImageByIndex(currentIndex - 1, viewType);
                    if (prevImage) {
                        await updateManualPreview(currentIndex - 1, null, prevImage.metadata);
                        showGlassToast('success', null, 'Image scrapped');
                    } else {
                        resetManualPreview();
                        showGlassToast('success', null, 'Image scrapped!');
                    }
                } else {
                    resetManualPreview();
                    showGlassToast('success', null, 'Image scrapped!');
                }
            }
        } catch (error) {
            console.warn('Failed to load new image after scrap:', error);
            resetManualPreview();
            showGlassToast('success', null, 'Image scrapped!');
        }

        // Refresh gallery after processing is complete
        loadGallery(true);
    } catch (error) {
        console.error('Error moving to scraps:', error);
        showError('Failed to move image to scraps');
    } finally {
        // Hide navigation loading overlay
        showManualPreviewNavigationLoading(false);
    }
}

// Remove image from scraps
async function removeFromScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        await window.wsClient.removeScrap(activeWorkspace, filename);

        showGlassToast('success', null, 'Image removed from scraps', false, 3000, '<i class="mdi mdi-1-5 mdi-archive-arrow-up"></i>');

        // If currently viewing scraps, reload them
        switchGalleryView(currentGalleryView, true);
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
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }
            
            await window.wsClient.removePinned(activeWorkspace, filename);
            showGlassToast('success', null, 'Image unpinned', false, 5000, '<i class="fa-regular fa-star"></i>');
        } else {
            // Add to pinned
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }
            
            await window.wsClient.addPinned(activeWorkspace, filename);
            showGlassToast('success', null, 'Image pinned', false, 5000, '<i class="fa-solid fa-star"></i>');
        }

        // Update the specific pin button that was clicked
        if (pinBtn) {
            await updatePinButtonAppearance(pinBtn, filename);
        } else {
            await updateSpecificPinButton(filename);
        }
        
        // Update lightbox pin button if lightbox is open
        if (window.lightboxPinBtn && !window.lightboxPinBtn.classList.contains('hidden')) {
            await updateLightboxPinButtonAppearance(filename);
        }
        
        // Update the local gallery data to reflect the pin status change
        if (allImages && Array.isArray(allImages)) {
            const imageIndex = findTrueImageIndexInGallery(filename);
            if (imageIndex !== -1) {
                allImages[imageIndex].isPinned = !isPinned;
            }
        }
        
        // Update all pin buttons in the gallery for this image
        updateGalleryPinButtons(filename, !isPinned);
    } catch (error) {
        console.error('Error toggling pin status:', error);
        showError('Failed to toggle pin status');
    }
}

// Check if an image is pinned
async function checkIfImageIsPinned(filename) {
    try {
        // First try to get pin status from current gallery data if available
        if (allImages && Array.isArray(allImages)) {
            const image = allImages.find(img => {
                const imgFilename = img.filename || img.original || img.upscaled;
                return imgFilename === filename;
            });
            if (image && image.isPinned !== undefined) {
                return image.isPinned;
            }
        }
        
        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const pinnedData = await window.wsClient.getWorkspacePinned(activeWorkspace);
        return pinnedData.pinned && pinnedData.pinned.includes(filename);
    } catch (error) {
        console.error('Error checking pin status:', error);
        return false;
    }
}

// Get image metadata via WebSocket with fallback to HTTP
async function getImageMetadata(filename) {
    try {
        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
                const metadata = await window.wsClient.requestImageMetadata(filename);
                return metadata;
    } catch (error) {
        console.error('Error getting image metadata:', error);
        showGlassToast('error', 'Image metadata request error', error.message, false);
        throw error;
    }
}

// Update pin button appearance based on pin status
async function updatePinButtonAppearance(pinBtn, filename) {
    try {
        const isPinned = await checkIfImageIsPinned(filename);
        if (isPinned) {
            pinBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
            pinBtn.title = 'Unpin image';
        } else {
            pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
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

// Update all pin buttons in the gallery for a specific image
function updateGalleryPinButtons(filename, isPinned) {
    try {
        // Find all gallery items with this filename
        const galleryItems = document.querySelectorAll(`.gallery-item[data-filename="${filename}"]`);
        
        galleryItems.forEach(item => {
            const pinBtn = item.querySelector('.btn-secondary[title*="Pin"], .btn-secondary[title*="Unpin"]');
            if (pinBtn) {
                if (isPinned) {
                    pinBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
                    pinBtn.title = 'Unpin image';
                } else {
                    pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
                    pinBtn.title = 'Pin image';
                }
            }
        });
    } catch (error) {
        console.error('Error updating gallery pin buttons:', error);
    }
}

function setSeedInputGroupState(open) {
    if (open) {
        manualSeed?.classList.remove('hidden');
        // Only show sprout seed button if there's a seed available
        if (window.lastLoadedSeed) {
            sproutSeedBtn?.classList.remove('hidden');
        }
        clearSeedBtn?.classList.toggle('hidden', !manualSeed?.value);
        editSeedBtn?.classList.add('hidden');
    } else {
        manualSeed?.classList.add('hidden');
        // Don't hide sprout seed button here - it should only be hidden when no seed is available
        // sproutSeedBtn?.classList.add('hidden');
        clearSeedBtn?.classList.add('hidden');
        editSeedBtn?.classList.remove('hidden');
    }
}

// Flag to track if app data has been loaded
let appDataLoaded = false;

// Utility function to check if app data is ready
function isAppDataReady() {
    return appDataLoaded && window.optionsData && window.optionsData.ok;
}

// Load options from server with retry logic
async function loadOptions(maxRetries = 5, retryDelay = 500) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Ensure WebSocket is connected and ready
            if (!window.wsClient) {
                throw new Error('WebSocket client not initialized');
            }
            
            // Additional validation that the connection is stable
            if (window.wsClient.getConnectionState() !== 'connected') {
                throw new Error('WebSocket connection not in stable state');
            }
            
            // Create a timeout promise for the request
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 1500); // 2.5 second timeout
            });
            
            // Race between the actual request and timeout
            const options = await Promise.race([
                window.wsClient.getAppOptions(),
                timeoutPromise
            ]);
            
            if (!options || !options.ok) {
                throw new Error("Failed to load application configuration: " + (options?.error || 'Unknown error'));
            }
            
            window.optionsData = options;

            // Initialize datasetBias dynamically from config
            if (window.optionsData?.datasets) {
                window.optionsData.datasets.forEach(dataset => {
                    datasetBias[dataset.value] = 1.0;
                });
            }

            if (window.optionsData?.user?.ok !== true) {
                showGlassToast('warning', 'User Data Error', window.optionsData.user.error || 'Failed to load user data', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }

            // Handle active workspace data if provided
            if (window.optionsData?.activeWorkspace) {
                await handleWorkspaceDataFromOptions(window.optionsData.activeWorkspace);
            }

            // Update subscription notifications
            updateSubscriptionNotifications().catch(error => {
            });

            // Check user type and show appropriate message
            const userType = localStorage.getItem('userType');
            if (userType === 'readonly') {
                showGlassToast('info', 'Read-Only Mode', 'You are logged in as a read-only user. Some features are restricted.', false, 8000, '<i class="fas fa-eye"></i>');
                disableReadOnlyFeatures();
            }
            
            // Mark app data as loaded
            appDataLoaded = true;
            
            return; // Success, exit the retry loop
            
        } catch (error) {
            lastError = error;
            console.error(`❌ Failed to load app options (attempt ${attempt}/${maxRetries}):`, error);
            
            // Show user-friendly error message
            if (attempt === 1) {
                showGlassToast('warning', 'Loading Application Data', 'Attempting to load application configuration...', false, 3000, '<i class="fas fa-sync"></i>');
            }
            
            if (attempt < maxRetries) {
                // Show retry notification
                showGlassToast('info', 'Retrying...', `Attempt ${attempt + 1} of ${maxRetries}`, false, 2000, '<i class="fas fa-redo"></i>');
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                
                // Increase delay for exponential backoff
                retryDelay = Math.min(retryDelay * 1.5, 10000);
            }
        }
    }
    
    // All retries failed
    const errorMessage = `Failed to load application configuration after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`;
    console.error(errorMessage);
    
    // Show critical error to user
    showGlassToast('error', 'Critical Error', 'Failed to load application data. Please refresh the page or contact support.', false, 0, '<i class="fas fa-exclamation-triangle"></i>');
    
    // Throw the error to be handled by the caller
    throw new Error(errorMessage);
}

// Handle workspace data received from app options
async function handleWorkspaceDataFromOptions(workspaceInfo) {
    try {
        if (!workspaceInfo || !workspaceInfo.id || !workspaceInfo.data) {
            console.warn('⚠️ No valid workspace data in app options');
            return;
        }
        
        // Set the current workspace
        window.currentWorkspace = workspaceInfo.id;
        
        // Update workspace UI if the function exists
        if (window.updateWorkspaceUI && typeof window.updateWorkspaceUI === 'function') {
            window.updateWorkspaceUI(workspaceInfo.id);
        }
        
        // Update workspace selector if it exists
        const workspaceSelector = document.getElementById('workspace-selector');
        if (workspaceSelector) {
            workspaceSelector.value = workspaceInfo.id;
        }
        
        // Update workspace name display
        const workspaceNameElement = document.getElementById('workspace-name');
        if (workspaceNameElement && workspaceInfo.data.name) {
            workspaceNameElement.textContent = workspaceInfo.data.name;
        }
    } catch (error) {
        console.error('❌ Error handling workspace data from options:', error);
    }
}

// Dataset Dropdown Functions
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

function openDatasetDropdown() {
    openDropdown(datasetDropdownMenu, datasetDropdownBtn);
}

function closeDatasetDropdown() {
    closeDropdown(datasetDropdownMenu, datasetDropdownBtn);
}

// Function to adjust dataset bias from dropdown controls
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

// Sub Toggles Functions
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

function openSubTogglesDropdown() {
    openDropdown(subTogglesDropdownMenu, subTogglesBtn);
}

function closeSubTogglesDropdown() {
    closeDropdown(subTogglesDropdownMenu, subTogglesBtn);
}

// Quality Toggle Functions
function toggleQuality() {
    const currentState = qualityToggleBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    qualityToggleBtn.setAttribute('data-state', newState);
    appendQuality = newState === 'on';
    updatePromptStatusIcons();
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

        option.addEventListener('click', (e) => {
            e.preventDefault();
            selectUcPreset(preset.value);
            closeUcPresetsDropdown();
        });

        ucPresetsDropdownMenu.appendChild(option);
    });
}

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

function openUcPresetsDropdown() {
    openDropdown(ucPresetsDropdownMenu, ucPresetsDropdownBtn);
}

function closeUcPresetsDropdown() {
    closeDropdown(ucPresetsDropdownMenu, ucPresetsDropdownBtn);
}

let focusCoverEnabled = true;
// Setup event listeners
// MANUAL MODAL MANAGEMENT SYSTEM EVENT LISTENERS - Move to manualModalManager.js
function setupEventListeners() {
    // MANUAL MODAL SYSTEM - Load saved blur preference (belongs to modal system)
    loadBlurPreference();

    // GENERATE BUTTON POPOVER SYSTEM - Move to generateButtonPopoverManager.js
    if (manualGenerateBtn) {
        manualGenerateBtn.addEventListener('mouseenter', showGenerateButtonPopover);
        manualGenerateBtn.addEventListener('mouseleave', hideGenerateButtonPopover);
        //manualGenerateBtn.addEventListener('click', handleManualGeneration);
    }

    // MANUAL MODAL SYSTEM - Core modal show/hide events
    openGenEditorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showManualModal();
    });
    closeManualBtn.addEventListener('click', (e) => {
        e.preventDefault();
        hideManualModal();
    });
    manualPreviewCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();

        if (window.innerWidth > 1400) {
            hideManualModal(e, false);
        } else {
            hideManualPreviewResponsive();
        }
    });

    // PRESET MANAGEMENT SYSTEM - Preset name input and button events
    manualPresetName.addEventListener('input', () => {
        validatePresetWithTimeout();
        manualPresetToggleText.textContent = manualPresetName.value.trim();
    });
    manualPresetName.addEventListener('keyup', () => {
        validatePresetWithTimeout();
        manualPresetToggleText.textContent = manualPresetName.value.trim();
    });
    manualPresetName.addEventListener('change', () => {
        validatePresetWithTimeout();
        manualPresetToggleText.textContent = manualPresetName.value.trim();
    });

    // PRESET MANAGEMENT SYSTEM - Load, delete, and save button events
    manualLoadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const presetName = manualPresetName.value.trim();
        if (presetName) {
            loadPresetIntoForm(presetName);
        }
    });
    manualPresetDeleteBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const presetName = manualPresetName.value.trim();
        if (presetName) {
            deletePreset(presetName);
        }
    });
    manualSaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleManualSave();
    });

    // MANUAL FORM SYSTEM - Form submission handling
    manualForm.addEventListener('submit', (e) => {
            e.preventDefault();
        // Prevent form submission if it was triggered by Enter key in preset name input
        if (document.activeElement === manualPresetName) {
            return;
        }
        handleManualGeneration(e);
    });

    // MANUAL PREVIEW SYSTEM - Preview control button events (download, copy, upscale, etc.)
    manualPreviewDownloadBtn.addEventListener('click', (e) => {
        e.preventDefault();
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

    manualPreviewCopyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const previewImage = document.getElementById('manualPreviewImage');
        if (previewImage && previewImage.dataset.blobUrl) {
            try {
                // Fetch the image as a blob
                const response = await fetch(previewImage.dataset.blobUrl);
                const blob = await response.blob();
                
                // Copy to clipboard
                await navigator.clipboard.write([
                    new ClipboardItem({
                        [blob.type]: blob
                    })
                ]);
                
                // Calculate and format file size
                const sizeInBytes = blob.size;
                let sizeText;
                if (sizeInBytes < 1024 * 1024) {
                    sizeText = `${(sizeInBytes / 1024).toFixed(1)} KB`;
                } else {
                    sizeText = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
                }
                
                // Show success notification with size
                if (window.showGlassToast) {
                    window.showGlassToast('success', 'Image copied to clipboard!', `(${sizeText})`, false, 3000, '<i class="fas fa-clipboard-check"></i>');
                }
            } catch (error) {
                console.error('Failed to copy image to clipboard:', error);
                if (window.showGlassToast) {
                    window.showGlassToast('error', 'Failed to copy image to clipboard', '', false, 3000, '<i class="fas fa-clipboard"></i>');
                }
            }
        }
    });

    manualPreviewUpscaleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.currentManualPreviewImage) {
            upscaleImage(window.currentManualPreviewImage, e);
        } else {
            showGlassToast('error', 'Upscale Failed', 'No image available');
        }
    });

    manualPreviewLoadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.currentManualPreviewImage) {
            if (window.innerWidth <= 1400 && manualModal.classList.contains('show-preview')) {
                hideManualPreviewResponsive();
            }
            rerollImageWithEdit(window.currentManualPreviewImage);
        } else {
            showGlassToast('error', 'Load Failed', 'No image available');
        }
    });

    manualPreviewVariationBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.currentManualPreviewImage) {
            // For preview, only set the base image without replacing dialog contents
            const filename = window.currentManualPreviewImage.original;
            if (filename) {
                const source = `file:${filename}`;
                const previewUrl = `/images/${filename}`;

                window.uploadedImageData = {
                    image_source: source,
                    width: 0, // Will be updated when image loads
                    height: 0,
                    bias: 2, // Default center bias
                    isBiasMode: true,
                    isClientSide: false
                };

                // Load actual image dimensions
                const tempImg = new Image();
                tempImg.onload = () => {
                    window.uploadedImageData.width = tempImg.width;
                    window.uploadedImageData.height = tempImg.height;
                    
                    // Update image bias orientation after setting image dimensions
                    updateImageBiasOrientation();
                };
                tempImg.onerror = () => {
                    console.warn('Failed to load image dimensions, using defaults');
                    window.uploadedImageData.width = 512;
                    window.uploadedImageData.height = 512;
                    
                    // Update image bias orientation after setting image dimensions
                    updateImageBiasOrientation();
                };
                tempImg.src = previewUrl;

                // Set the variation image
                variationImage.src = previewUrl;
                variationImage.classList.remove('hidden');
        

                // Set strength to 0.8 and noise to 0.1 for variation
                if (manualStrengthValue) manualStrengthValue.value = '0.8';
                if (manualNoiseValue) manualNoiseValue.value = '0.1';
                
                // Update percentage overlays after setting default values
                updatePercentageOverlays();

                // Set transformation type to variation
                updateTransformationDropdownState('variation');

                // Show transformation section content
                if (transformationRow) {
                    transformationRow.classList.add('display-image');
                }
                document.getElementById('manualImg2ImgGroup').classList.remove('hidden');

                // Update inpaint button state
                updateInpaintButtonState();
                renderImageBiasDropdown('2');
                
                updateUploadDeleteButtonVisibility();
                hideManualPreviewResponsive();

            } else {
                showGlassToast('error', 'Variation Failed', 'No image found');
            }
        } else {
            showGlassToast('error', 'Variation Failed', 'No image available');
        }
    });

    manualPreviewSeedBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.lastGeneratedSeed) {
            manualSeed.value = window.lastGeneratedSeed; 
            setSeedInputGroupState(true);
            
            // Check if sprout seed button is active and update it
            if (sproutSeedBtn && sproutSeedBtn.getAttribute('data-state') === 'off') {
                window.lastLoadedSeed = window.lastGeneratedSeed;
                manualSeed.value = window.lastLoadedSeed;
            }
            
            if (window.innerWidth <= 1400 && manualModal.classList.contains('show-preview')) {
                hideManualPreviewResponsive();
            }
        } else {
            showGlassToast('error', null, 'No seed available', false, 5000, '<i class="fas fa-seedling"></i>');
        }
    });

    manualPreviewDeleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        deleteManualPreviewImage();
    });

    manualPreviewPinBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.currentManualPreviewImage) {
            togglePinImage(window.currentManualPreviewImage, manualPreviewPinBtn);
        } else {
            showGlassToast('error', 'Pin Failed', 'No image available');
        }
    });

    manualPreviewScrapBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.currentManualPreviewImage) {
            if (currentGalleryView === 'scraps') {
                removeFromScraps(window.currentManualPreviewImage);
            } else {
                moveManualPreviewToScraps();
            }
        } else {
            showGlassToast('error', 'Load Failed', 'No image available');
        }
    });

    // SEARCH SYSTEM - Search toggle button events
    if (searchToggleBtn) {
        searchToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleSearchContainer();
        });
    }

    // SEED MANAGEMENT SYSTEM - Seed input and button events
    manualSeed.addEventListener('input', (e) => {
        clearSeedBtn?.classList.toggle('hidden', !e.target.value);
    });

    manualSeed.addEventListener('change', (e) => {
        clearSeedBtn?.classList.toggle('hidden', !e.target.value);
    });

    manualSeed.addEventListener('blur', (e) => {
       clearSeedBtn?.classList.toggle('hidden', !e.target.value);
    });

    // SEED MANAGEMENT SYSTEM - Clear and edit seed button events
    clearSeedBtn.addEventListener('click', (e) => {
        e.preventDefault();
        clearSeed();
    });

    editSeedBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setSeedInputGroupState(true);
        manualSeed?.focus();
    });

    // TOGGLE SYSTEM - Various toggle button events (paid request, quality, vibe normalize)
    paidRequestToggle.addEventListener('click', (e) => {
        e.preventDefault();
        forcePaidRequest = !forcePaidRequest;
        paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
    });

    qualityToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleQuality();
    });

    vibeNormalizeToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const currentState = vibeNormalizeToggle.getAttribute('data-state') === 'on';
        const newState = !currentState;
        vibeNormalizeToggle.setAttribute('data-state', newState ? 'on' : 'off');
    });

    // CHARACTER AUTOCOMPLETE SYSTEM - Character prompt and UC field autocomplete events
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

    // TEXTAREA AUTOCOMPLETE SYSTEM - Auto-resize functionality for manual UC field
    manualUc.addEventListener('input', () => autoResizeTextarea(manualUc));

    // PRESET AUTOCOMPLETE SYSTEM - Preset name field autocomplete events
    manualPresetName.addEventListener('input', handlePresetAutocompleteInput);
    manualPresetName.addEventListener('keydown', handlePresetAutocompleteKeydown);
    document.addEventListener('click', hideCharacterAutocomplete);
    document.addEventListener('click', hidePresetAutocomplete);

    // AUTOCOMPLETE POSITIONING SYSTEM - Update autocomplete positions on scroll and resize
    window.addEventListener('scroll', updateAutocompletePositions);
    window.addEventListener('resize', updateAutocompletePositions);

    // Title bar scroll visibility with high-performance throttling
    let scrollTimeout;
    let lastScrollTop = 0;
    let isScrolling = false;
    
    const updateTitleBarVisibility = (scrollTop) => {
        const shouldShow = scrollTop > 100;
        const isCurrentlyScrolled = document.documentElement.classList.contains('scrolled');
        
        // Only update if state actually changed
        if (shouldShow !== isCurrentlyScrolled) {
            if (shouldShow) {
                document.documentElement.classList.add('scrolled');
                generateStarField(); // Generate stars when title bar appears
            } else {
                document.documentElement.classList.remove('scrolled');
                clearStarField(); // Clear stars when title bar disappears
            }
        }
    };

    // Star field generation and management
    const generateStarField = () => {
        const starField = document.getElementById('star-field');
        const titleBar = document.getElementById('title-bar');
        if (!starField || !titleBar) return;
        
        // Clear existing stars
        starField.innerHTML = '';
        
        // Generate more stars (40-60) with higher density in top-left
        const numStars = Math.floor(Math.random() * 21) + 40;
        const starSizes = ['small', 'medium', 'large'];
        
        for (let i = 0; i < numStars; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            
            // Random size
            const sizeClass = starSizes[Math.floor(Math.random() * starSizes.length)];
            star.classList.add(sizeClass);
            
            // Position with higher density in top-left area
            let x, y;
            if (Math.random() < 0.6) {
                // 60% chance to be in top-left quadrant (0-50% x, 0-50% y)
                x = Math.random() * 50;
                y = Math.random() * 50;
            } else {
                // 40% chance to be anywhere else
                x = Math.random() * 100;
                y = Math.random() * 100;
            }
            
            star.style.left = `${x}%`;
            star.style.top = `${y}%`;
            
            // Random animation delay
            const delay = Math.random() * 2;
            star.style.animationDelay = `${delay}s`;
            
            // Random animation duration (1.5s to 3s)
            const duration = 1.5 + Math.random() * 1.5;
            star.style.animationDuration = `${duration}s`;
            
            starField.appendChild(star);
        }
    };

    const clearStarField = () => {
        const starField = document.getElementById('star-field');
        if (starField) {
            starField.innerHTML = '';
        }
    };

    // Focus star field generation and management
    const generateFocusStarField = () => {
        const focusStarField = document.getElementById('focus-star-field');
        if (!focusStarField) return;

        // Clear existing focus stars
        focusStarField.innerHTML = '';

        // Generate stars across the entire viewport (25-40 stars)
        const numStars = Math.floor(Math.random() * 16) + 25;
        const starSizes = ['small', 'medium', 'large'];

        for (let i = 0; i < numStars; i++) {
            const star = document.createElement('div');
            star.className = 'focus-star';

            // Random size
            const sizeClass = starSizes[Math.floor(Math.random() * starSizes.length)];
            star.classList.add(sizeClass);

            // Position randomly across the entire viewport
            const x = Math.random() * 100;
            const y = Math.random() * 100;

            star.style.left = `${x}%`;
            star.style.top = `${y}%`;

            // Random animation delays
            const twinkleDelay = Math.random() * 3; // 0-3s for twinkling
            const driftDelay = Math.random() * 60; // 0-60s for drifting
            star.style.animationDelay = `${twinkleDelay}s, ${driftDelay}s`;

            // Random twinkling duration (2s to 4s)
            const twinkleDuration = 2 + Math.random() * 2;
            star.style.animationDuration = `${twinkleDuration}s, 60s`;

            focusStarField.appendChild(star);
        }
    };

    const clearFocusStarField = () => {
        const focusStarField = document.getElementById('focus-star-field');
        if (focusStarField) {
            focusStarField.innerHTML = '';
        }
    };
    
    const handleScroll = () => {
        if (!isScrolling) {
            isScrolling = true;
            requestAnimationFrame(() => {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                
                // Only process if scroll position actually changed significantly
                if (Math.abs(scrollTop - lastScrollTop) > 5) {
                    updateTitleBarVisibility(scrollTop);
                    lastScrollTop = scrollTop;
                }
                
                isScrolling = false;
            });
        }
        
        // Clear existing timeout and set new one for scroll end detection
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Final update when scrolling stops
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            updateTitleBarVisibility(scrollTop);
        }, 16); // ~60fps timing
    };
    
    // UI SCROLL MANAGEMENT SYSTEM - Title bar visibility and star field generation
    window.addEventListener('scroll', handleScroll, { passive: true });

    // UI SCROLL MANAGEMENT SYSTEM - Initialize title bar state
    const initialScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    updateTitleBarVisibility(initialScrollTop);
    lastScrollTop = initialScrollTop;

    // FOCUS OVERLAY SYSTEM - Prevent accidental interactions when window loses focus
    if (focusOverlay) {
        let focusTimeout;
        
        const showFocusOverlay = () => {
            // Check if focus cover is enabled via toggle button
            if (!focusCoverEnabled) {
                return; // Don't show overlay if disabled
            }

            focusOverlay.style.pointerEvents = 'auto';
            focusOverlay.classList.add('active');
            generateFocusStarField(); // Generate focus stars when overlay appears
        };
        
        const hideFocusOverlay = () => {
            focusOverlay.classList.remove('active');
            clearFocusStarField(); // Clear focus stars when overlay disappears
            // Delay releasing pointer events to prevent accidental interactions during fade-out
            setTimeout(() => {
                focusOverlay.style.pointerEvents = 'none';
            }, 300); // Match the CSS transition duration
        };
        
        // FOCUS OVERLAY SYSTEM - Window blur/focus events
        window.addEventListener('blur', () => {
            // Small delay to prevent flickering during quick focus changes
            focusTimeout = setTimeout(showFocusOverlay, 100);
        });

        window.addEventListener('focus', () => {
            clearTimeout(focusTimeout);
            hideFocusOverlay();
        });

        // FOCUS OVERLAY SYSTEM - Document visibility change (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                showFocusOverlay();
            } else {
                hideFocusOverlay();
            }
        });

        // FOCUS OVERLAY SYSTEM - Click and keyboard events to return focus
        focusOverlay.addEventListener('click', () => {
            window.focus();
            hideFocusOverlay();
        });

        document.addEventListener('keydown', (e) => {
            if (focusOverlay.classList.contains('active') &&
                (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
                window.focus();
                hideFocusOverlay();
            }
        });
    }

    // METADATA DIALOG SYSTEM - Dialog close and expansion toggle events
    if (closeMetadataDialog) {
        closeMetadataDialog.addEventListener('click', (e) => {
            e.preventDefault();
            hideMetadataDialog();
        });
    }
    if (dialogPromptBtn) {
        dialogPromptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDialogExpanded('prompt');
        });
    }
    if (dialogUcBtn) {
        dialogUcBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDialogExpanded('uc');
        });
    }

    // METADATA DIALOG SYSTEM - Close expanded sections
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-expanded')) {
            const expandedSection = e.target.closest('.metadata-expanded');
            if (expandedSection) {
                expandedSection.classList.add('hidden');
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
            if (!metadataDialog.classList.contains('hidden')) {
                hideMetadataDialog();
            } else if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
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
            } else {
                // Handle textbox deselection/unfocus behavior
                const activeElement = document.activeElement;
                if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                    const selection = window.getSelection();
                    if (selection && selection.toString().length > 0) {
                        // Text is selected - deselect and place cursor at end of selection
                        const range = selection.getRangeAt(0);
                        const endOffset = range.endOffset;
                        selection.removeAllRanges();
                        
                        // Place cursor at the end of the previous selection
                        if (activeElement.setSelectionRange) {
                            activeElement.setSelectionRange(endOffset, endOffset);
                        }
                    } else {
                        // No text selected - unfocus the textbox
                        activeElement.blur();
                    }
                    return; // Don't continue with other ESC handlers
                }
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Handle arrow key navigation for character detail
            if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                const autocompleteList = document.querySelector('.character-autocomplete-list');
                if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                    
                    handleCharacterDetailArrowKeys(e.key);
                }
            }
        } else if (e.key === 'Enter') {
            // Handle Enter key for character detail selection
            if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                const autocompleteList = document.querySelector('.character-autocomplete-list');
                if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                    
                    handleCharacterDetailEnter();
                }
            }
        }
    });


    // GENERATION CONTROLS SYSTEM - Preset selection and generate button events
    presetSelect.addEventListener('change', updateGenerateButton);
    // Mirror desktop generate button click to compact one
    generatePresetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        generateImage(e);
    });

    // UPLOAD SYSTEM - Upload button and input events
    const uploadBtn = document.getElementById('uploadBtn');
    const imageUploadInput = document.getElementById('imageUploadInput');

    if (uploadBtn) {
        uploadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showUnifiedUploadModal();
            closeSubMenu();
        });
    }

    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', handleImageUpload);
    }

    // CLIPBOARD SYSTEM - Paste functionality
    document.addEventListener('paste', handleClipboardPaste);

    // TOGGLE SYSTEM - Upscale toggle functionality
    manualUpscale.addEventListener('click', (e) => {
        e.preventDefault();
        toggleManualUpscale();
    });

    // CUSTOM RESOLUTION SYSTEM - Custom resolution button and dimension input events
    if (manualCustomResolutionBtn) {
        manualCustomResolutionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (manualSelectedResolution === 'custom') {
                // Switch back to dropdown mode
                selectManualResolution('normal_portrait', 'Normal');
            }
        });
    }

    // CUSTOM RESOLUTION SYSTEM - Update hidden resolution value when custom dimensions change
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

    // BASE IMAGE MANAGEMENT SYSTEM - Delete and preview base image events
    if (deleteImageBaseBtn) {
        deleteImageBaseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleDeleteBaseImage();
        });
    }

    if (previewBaseImageBtn) {
        previewBaseImageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Get the base image source
            const variationImage = document.getElementById('manualVariationImage');
            if (variationImage && variationImage.src && variationImage.src !== '') {
                showLightbox({ url: variationImage.src });
            } else {
                showGlassToast('error', 'Preview Failed', 'No base image available');
            }
        });
    }

    // CACHE BROWSER SYSTEM - Close cache browser events
    const closeCacheBrowserBtn = document.getElementById('closeCacheBrowserBtn');
    const closeCacheBrowserContainerBtn = document.getElementById('closeCacheBrowserContainerBtn');

    if (closeCacheBrowserBtn) {
        closeCacheBrowserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hideCacheBrowser();
        });
    }

    if (closeCacheBrowserContainerBtn) {
        closeCacheBrowserContainerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hideCacheBrowser();
        });
    }

    // CACHE BROWSER SYSTEM - Cache browser tab event listeners
    const cacheBrowserTabButtons = document.querySelectorAll('.cache-browser-tabs .gallery-toggle-btn');
    cacheBrowserTabButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
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

    // UPLOAD/DELETE BUTTON VISIBILITY SYSTEM - Ensure correct initial state
    updateUploadDeleteButtonVisibility();

    // PRICE CALCULATION SYSTEM - Price calculation event listeners
    if (manualSteps) {
        manualSteps.addEventListener('input', updateManualPriceDisplay);
    }

    if (manualStrengthValue) {
        manualStrengthValue.addEventListener('input', updateManualPriceDisplay);
        
        // Add scroll wheel functionality for strength input
        manualStrengthValue.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.00;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateManualPriceDisplay();
            if (manualStrengthOverlay)
                updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay);
        });
        if (manualStrengthOverlay) {
            manualStrengthValue.addEventListener('input', () => updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay));
            manualStrengthValue.addEventListener('blur', () => updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay));
            updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay);
        }
    }

    if (manualNoiseValue) {
        manualNoiseValue.addEventListener('input', updateManualPriceDisplay);
        
        // Add scroll wheel functionality for noise input
        manualNoiseValue.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.00;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateManualPriceDisplay();
            if (manualNoiseOverlay)
                updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay);
        });
        if (manualNoiseOverlay) {
            manualNoiseValue.addEventListener('input', () => updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay));
            manualNoiseValue.addEventListener('blur', () => updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay));
            updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay);
        }
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
        manualPreviewPrevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateManualPreview(e);
        });
    }
    if (manualPreviewNextBtn) {
        manualPreviewNextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateManualPreview(e);
        });
    }

    // Bulk action event listeners removed - now handled by context menu

    // Character prompts event listeners
    if (addCharacterBtn) {
        addCharacterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addCharacterPrompt(e);
        });
    }

    // Auto position toggle event listener
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    if (autoPositionBtn) {
        autoPositionBtn.addEventListener('click', function(e) {
            e.preventDefault();
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
        cancelPositionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hidePositionDialog();
        });
    }

    if (confirmPositionBtn) {
        confirmPositionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            confirmPosition();
        });
    }

    // Mouse wheel functionality for numeric inputs
    let manualStepsWheelTimeout = false;
    if (manualSteps) {
        manualSteps.addEventListener('wheel', function(e) {
            const currentValue = parseInt(this.value) || 25;
            const delta = e.deltaY > 0 ? -1 : 1;

            if (currentValue < 28) {
                if (!manualStepsWheelTimeout) {
                    const nextValue = currentValue + delta;
                    if (nextValue >= 28) {
                        this.value = 28;
                        manualStepsWheelTimeout = true;
                        setTimeout(() => {
                            manualStepsWheelTimeout = false;
                        }, 1000);
                    } else {
                        this.value = Math.max(1, nextValue);
                    }
                }
                // If timeout is active, ignore further scrolls under 28
            } else if (currentValue === 28) {
                // Require a pause before allowing to go above 28
                if (!manualStepsWheelTimeout && delta > 0) {
                    this.value = 29;
                    manualStepsWheelTimeout = true;
                    setTimeout(() => {
                        manualStepsWheelTimeout = false;
                    }, 1000);
                } else if (delta < 0) {
                    this.value = 27;
                }
                // If timeout is active, ignore further scrolls above 28
            } else {
                // At or above 29, allow normal scrolling up to 50
                const newValue = Math.max(1, Math.min(50, currentValue + delta));
                this.value = newValue;
            }
            updateManualPriceDisplay();
        });
    }

    if (manualGuidance) {
        manualGuidance.addEventListener('wheel', function(e) {
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0.0, Math.min(10.0, currentValue + delta));
            this.value = newValue.toFixed(1);
        });
    }

    if (manualRescale) {
        manualRescale.addEventListener('wheel', function(e) {
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.0;
            const newValue = Math.max(0.0, Math.min(1.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            if (manualRescaleOverlay)
                updatePercentageOverlay(manualRescale, manualRescaleOverlay);
        });
        if (manualRescaleOverlay) {
            manualRescale.addEventListener('input', () => updatePercentageOverlay(manualRescale, manualRescaleOverlay));
            manualRescale.addEventListener('blur', () => updatePercentageOverlay(manualRescale, manualRescaleOverlay));
            updatePercentageOverlay(manualRescale, manualRescaleOverlay);
        }
    }

    // Tab switching functionality for prompt/UC tabs (Manual Generation Model)
    const manualTabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
    const showBothBtn = document.getElementById('showBothBtn');

    // Track the last focused textarea globally
    let lastFocusedTextarea = null;
    
    // Add focus event listeners to all textareas to track the last focused one
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
            lastFocusedTextarea = e.target;
        }
    });
    
    manualTabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = button.getAttribute('data-tab');
            switchManualTab(targetTab, lastFocusedTextarea);
        });
    });

    // Show both panes functionality
    if (showBothBtn) {
        showBothBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleManualShowBoth();
        });
    }



    // RANDOM PROMPT SYSTEM - Move to randomPromptManager.js
    // This system handles random prompt generation, toggling, and transfer functionality
    // Includes functions: toggleRandomPrompt, executeRandomPrompt, transferRandomPrompt, etc.

    document.getElementById('randomPromptToggleBtn').addEventListener('click', (e) => {
        e.preventDefault();
        toggleRandomPrompt();
    });
    document.getElementById('randomPromptRefreshBtn').addEventListener('click', (e) => {
        e.preventDefault();
        executeRandomPrompt();
    });
    document.getElementById('randomPromptTransferBtn').addEventListener('click', (e) => {
        e.preventDefault();
        transferRandomPrompt();
    });
    document.getElementById('randomPromptNsfwBtn').addEventListener('click', (e) => {
        e.preventDefault();
        const btn = e.currentTarget;
        const state = btn.dataset.state === 'on' ? 'off' : 'on';
        btn.dataset.state = state;
        btn.classList.toggle('active', state === 'on');
        executeRandomPrompt();
    });

    document.getElementById('manualPreviewHandle').addEventListener('click', (e) => {
        e.preventDefault();
        
        e.stopPropagation();
        if (!manualModal.classList.contains('show-preview')) {
            showManualPreview();
        } else {
            hideManualPreviewResponsive();
        }
    });
    // Update the click event for manualPresetToggleBtn to toggle the group and button state
    manualPresetToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const presetName = manualPresetName.value.trim();
        const valid = isValidPresetName(presetName);
        if (presetName === "" && !valid) {
            // Only toggle group visibility and button state if name is empty
            if (manualPresetGroup.classList.contains('hidden')) {
                manualPresetGroup.classList.remove('hidden');
                manualPresetToggleBtn.classList.add('toggle-btn');
                manualPresetToggleBtn.classList.remove('hover-show');
                manualPresetToggleBtn.setAttribute('data-state', 'on');
                manualPresetToggleIcon.classList.remove('hidden');
                manualPresetToggleText.classList.add('hidden');
            } else {
                manualPresetGroup.classList.add('hidden');
                manualPresetToggleBtn.classList.add('toggle-btn');
                manualPresetToggleBtn.classList.remove('hover-show');
                manualPresetToggleBtn.setAttribute('data-state', 'off');
                manualPresetToggleIcon.classList.remove('hidden');
                manualPresetToggleText.classList.add('hidden');
                manualPresetToggleText.textContent = presetName;
            }
        } else {
            if (manualPresetGroup.classList.contains('hidden')) {
                manualPresetGroup.classList.remove('hidden');
                manualPresetToggleBtn.classList.add('toggle-btn');
                manualPresetToggleBtn.classList.remove('hover-show');
                manualPresetToggleIcon.classList.remove('hidden');
                manualPresetToggleText.classList.add('hidden');
            } else {
                manualPresetGroup.classList.add('hidden');
                manualPresetToggleBtn.classList.remove('toggle-btn');
                manualPresetToggleBtn.classList.add('hover-show');
                manualPresetToggleIcon.classList.add('hidden');
                manualPresetToggleText.classList.remove('hidden');
                manualPresetToggleText.textContent = presetName;
            }
        }
        // If there is a valid preset name, do nothing (button is not a toggle)
    });

    // GALLERY COLUMN CONTROLS SYSTEM - Move to galleryColumnManager.js
    // This system handles gallery column adjustment via scroll wheel and buttons
    // Includes functions: setGalleryColumns, updateGalleryColumnsFromLayout, etc.

    // Gallery columns scroll wheel functionality
    const galleryToggleGroup = document.getElementById('galleryToggleGroup');
    if (galleryToggleGroup) {
        galleryToggleGroup.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Disable on mobile displays
            if (window.innerWidth <= 577) {
                return false;
            }
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentColumns = parseInt(galleryToggleGroup.dataset.columns) || 5;
            const newColumns = Math.max(3, Math.min(10, currentColumns + delta));
            galleryToggleGroup.dataset.columns = newColumns;
            setGalleryColumns(newColumns);
        });
    }

    // Gallery columns button controls
    const decreaseColumnsBtn = document.getElementById('decreaseColumnsBtn');
    const increaseColumnsBtn = document.getElementById('increaseColumnsBtn');
    
    if (decreaseColumnsBtn) {
        decreaseColumnsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Disable on mobile displays
            if (window.innerWidth <= 577) {
                return false;
            }
            const currentColumns = parseInt(galleryToggleGroup.dataset.columns) || 5;
            const newColumns = Math.max(3, currentColumns - 1);
            galleryToggleGroup.dataset.columns = newColumns;
            setGalleryColumns(newColumns);
        });
    }
    
    if (increaseColumnsBtn) {
        increaseColumnsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Disable on mobile displays
            if (window.innerWidth <= 577) {
                return false;
            }
            const currentColumns = parseInt(galleryToggleGroup.dataset.columns) || 5;
            const newColumns = Math.min(10, currentColumns + 1);
            galleryToggleGroup.dataset.columns = newColumns;
            setGalleryColumns(newColumns);
        });
    }

    // Sort order toggle button
    const sortOrderToggleBtn = document.getElementById('sortOrderToggleBtn');
    if (sortOrderToggleBtn) {
        sortOrderToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.toggleGallerySortOrder) {
                window.toggleGallerySortOrder();
            }
        });
    }

    // Mobile sort order toggle button
    const mobileSortOrderToggleBtn = document.getElementById('mobileSortOrderToggleBtn');
    if (mobileSortOrderToggleBtn) {
        mobileSortOrderToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.toggleGallerySortOrder) {
                window.toggleGallerySortOrder();
            }
        });
    }

    // Gallery toggle group
    galleryToggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.currentTarget.getAttribute('data-view');
            switchGalleryView(view);
        });
    });

    // === Select All functionality removed - now handled by context menu ===
    document.getElementById('cacheBrowserOptionsBtn').addEventListener('click', (e) => {
        e.preventDefault();
        showCacheManagerModal();
    });

    // Reference browser show all references button
    const showAllReferencesBtn = document.getElementById('showAllReferencesBtn');
    if (showAllReferencesBtn) {
        showAllReferencesBtn.addEventListener('click', () => {
            // Call the toggle function from referenceManager.js
            if (typeof toggleShowAllReferences === 'function') {
                toggleShowAllReferences();
            }
        });
    }

    // Handle window resize to update infinite scroll configuration
    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            // Update batch size and trigger distances for new viewport
            imagesPerPage = calculateDynamicBatchSize();
            
            // Recalculate infinite scrolling layout if needed
            if (gallery && gallery.children.length > 0) {
                updateGalleryGrid();
                updateGalleryColumnsFromLayout();
            }
        }, 250); // Debounce resize events
    });

    // Handle orientation change for mobile devices
    window.addEventListener('orientationchange', () => {
        // Use a longer timeout for orientation change to allow the browser to complete the rotation
        setTimeout(() => {
            if (gallery && gallery.children.length > 0) {
                updateGalleryGrid();
                updateGalleryColumnsFromLayout();
            }
        }, 500);
    });


    if (clearPresetBtn) {
        clearPresetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            selectCustomPreset('', 1);
        });
    }

    // Set up preset generation handlers
    sproutSeedBtn.addEventListener('click', toggleSproutSeed);
    updateSproutSeedButton();

    const varietyBtn = document.getElementById('varietyBtn');
    if (varietyBtn) {
        varietyBtn.addEventListener('click', function(e) {
            e.preventDefault();
            varietyEnabled = !varietyEnabled;
            if (varietyEnabled) {
                this.setAttribute('data-state', 'on');
            } else {
                this.setAttribute('data-state', 'off');
            }
        });
    }
    
    setupDropdown(
        manualResolutionDropdown,
        manualResolutionDropdownBtn,
        manualResolutionDropdownMenu,
        renderManualResolutionDropdown,
        () => manualSelectedResolution,
        { preventFocusTransfer: true }
    );
    
    setupDropdown(manualSamplerDropdown, manualSamplerDropdownBtn, manualSamplerDropdownMenu, renderManualSamplerDropdown, () => manualSelectedSampler, { preventFocusTransfer: true });
    
    setupDropdown(manualNoiseSchedulerDropdown, manualNoiseSchedulerDropdownBtn, manualNoiseSchedulerDropdownMenu, renderManualNoiseSchedulerDropdown, () => manualSelectedNoiseScheduler, { preventFocusTransfer: true });
    
    setupDropdown(manualModelDropdown, manualModelDropdownBtn, manualModelDropdownMenu, renderManualModelDropdown, () => manualSelectedModel, { preventFocusTransfer: true });
    
    setupDropdown(transformationDropdown, transformationDropdownBtn, transformationDropdownMenu, renderTransformationDropdown, () => document.getElementById('transformationType').value, { preventFocusTransfer: true });
    
    setupDropdown(datasetDropdown, datasetDropdownBtn, datasetDropdownMenu, renderDatasetDropdown, () => selectedDatasets, { preventFocusTransfer: true });

    setupDropdown(subTogglesDropdown, subTogglesBtn, subTogglesDropdownMenu, renderSubTogglesDropdown, () => selectedDatasets, { preventFocusTransfer: true });

    setupDropdown(ucPresetsDropdown, ucPresetsDropdownBtn, ucPresetsDropdownMenu, renderUcPresetsDropdown, () => selectedUcPreset, { preventFocusTransfer: true });

    setupDropdown(customPresetDropdown, customPresetDropdownBtn, customPresetDropdownMenu, (sel) => renderCustomPresetDropdown(sel), () => selectedPreset, { preventFocusTransfer: true });
    
    updatePresetLoadSaveState();

    setupTransformationDropdownListeners();

    // Exit confirmation system - intercept page exits, refresh, and tab/window closing
    let isExiting = false;

    // Function to show exit confirmation
    async function showExitConfirmation(event, action = 'leave') {
        if (isExiting) return;
        
        const messages = {
            leave: 'Are you sure you want to leave the application?',
            refresh: 'Are you sure you want to restart the application?',
            close: 'Are you sure you want to close the application?'
        };
        
        const message = messages[action] || messages.leave;
        
        try {
            const confirmed = await showConfirmationDialog(message, [
                { text: 'Yes, Leave', value: true, className: 'btn-danger' },
                { text: 'Stay', value: false, className: 'btn-secondary' }
            ], event);
            
            if (confirmed) {
                isExiting = true;
                
                // For refresh actions, we need to actually refresh the page
                if (action === 'refresh') {
                    window.location.reload();
                    return;
                }
                
                // For close actions, we can't programmatically close tabs/windows due to security restrictions
                // But we can allow navigation to proceed
                if (action === 'close') {
                    // Try to close the tab (this may not work due to browser security)
                    try {
                        window.close();
                    } catch (e) {
                        // Browser security prevents programmatic tab closing
                    }
                    return;
                }
                
                // For navigation actions, allow them to proceed
                if (event && event.target) {
                    // Remove preventDefault and allow the action
                    event.stopImmediatePropagation();
                    // Re-trigger the original action
                    if (event.target.click) {
                        event.target.click();
                    }
                }
            } else {
                // User cancelled - prevent the action
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }
        } catch (error) {
            console.error('Error showing exit confirmation:', error);
            // Fallback: prevent the action
            if (event) {
                event.preventDefault();
            }

        }
    }

    // Always show browser warning for unsaved changes
    // This ensures the browser shows its native dialog for tab/window closing
    window.addEventListener('beforeunload', (event) => {
        // Always prevent unload and show browser warning
        if (bypassConfirmation) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
        return '';
    });

    // Intercept page visibility change (tab switching, minimizing)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Page is now hidden (user switched tabs)
        }
    });
    
    // Intercept browser back/forward buttons
    window.addEventListener('popstate', (event) => {
        event.preventDefault();
        // Show confirmation dialog
        window.showExitConfirmation(event, 'leave');
    });

    // Intercept link clicks that might cause navigation
    document.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (link && link.href && !link.target && !link.hasAttribute('download')) {
            const href = link.href;
            const currentOrigin = window.location.origin;
            
            // Check if link navigates away from current page
            if (href.startsWith(currentOrigin) && href !== window.location.href) {
                event.preventDefault();
                window.showExitConfirmation(event, 'close');
            }
        }
    });

    // Function to force refresh the page (used when user confirms refresh)
    window.forceRefresh = () => {
        window.location.reload();
    };
    
    // Function to force close the tab (used when user confirms close)
    window.forceClose = () => {
        try {
            window.close();
        } catch (e) {
            // Browser security prevents programmatic tab closing
            // Fallback: show a message that user needs to close manually
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', 'Close Tab', 'Please close this tab manually using Ctrl+W or the close button', false, 3000);
            }
        }
    };
}

// =====================================================================================
// EVENT LISTENERS MIGRATION SUMMARY - Comprehensive System Analysis
// =====================================================================================
//
// This setupEventListeners function contains ~150+ event listeners across 15+ functional systems.
// When migrating these to separate files, consider the following:
//
// 1. DEPENDENCY MANAGEMENT:
//    - Many systems share common DOM elements (manualModal, manualGenerateBtn, etc.)
//    - Event listeners often call functions from other systems
//    - Consider creating a shared event manager that coordinates between systems
//
// 2. MIGRATION STRATEGY:
//    - Create individual event managers for each system (e.g., ManualModalEventManager)
//    - Use a pub/sub pattern for cross-system communication
//    - Initialize systems in the correct dependency order
//
// 3. FUNCTIONAL SYSTEM BREAKDOWN:
//    - MANUAL MODAL SYSTEM: Modal show/hide, preview management
//    - GENERATE BUTTON SYSTEM: Button hover effects and generation
//    - PRESET MANAGEMENT: Preset input validation and button handlers
//    - MANUAL PREVIEW: Download, copy, upscale, variation, seed buttons
//    - SEARCH SYSTEM: Search toggle functionality
//    - SEED MANAGEMENT: Seed input, clear, and edit functionality
//    - TOGGLE SYSTEMS: Various UI toggles (paid, quality, vibe normalize)
//    - AUTOCOMPLETE SYSTEMS: Character and preset autocomplete
//    - DROPDOWN SYSTEMS: Multiple dropdown event handling
//    - UI MANAGEMENT: Scroll, resize, focus overlay, metadata dialogs
//    - UPLOAD/DOWNLOAD: File upload and clipboard paste
//    - GALLERY MANAGEMENT: Gallery controls and navigation
//    - EXIT CONFIRMATION: Page unload, refresh, and close prevention
//
// 4. POTENTIAL MIGRATION ISSUES:
//    - Circular dependencies between systems
//    - Shared global state variables
//    - Event listener cleanup and memory leaks
//    - Timing issues with DOM element availability
//    - Cross-system function calls within event handlers
//
// 5. RECOMMENDED APPROACH:
//    - Create a main EventCoordinator class that manages all system event managers
//    - Use dependency injection for shared services
//    - Implement proper cleanup methods for each system
//    - Add error boundaries for event handler failures
//    - Consider lazy loading of event systems for better performance
//
// =====================================================================================

// TAB SWITCHING SYSTEM - Move to tabManagement.js
// This system handles tab switching between prompt/UC tabs in the manual generation modal
// Includes functions: switchManualTab, syncCharacterPromptTabs, syncCharacterPromptTabsShowBoth,
// toggleManualShowBoth, and related tab management functionality.

// Tab switching functionality for prompt/UC tabs (Manual Generation Model)
function switchManualTab(targetTab, previouslyFocused = null) {
    // Target ONLY the tab buttons within the manual modal's prompt-tabs section
    const tabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
    // Target ONLY the tab panes within the manual modal's prompt-tabs section
    const tabPanes = document.querySelectorAll('#manualModal .prompt-tabs .tab-content .tab-pane');
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const toggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');

    // Use the previously focused element if provided, otherwise fall back to current active element
    const currentlyFocused = previouslyFocused || document.activeElement;
    let focusTarget = null;

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

    // Determine which textarea to focus based on what was previously focused
    if (currentlyFocused && currentlyFocused.matches('.prompt-textarea, .character-prompt-textarea')) {
        // If a textarea was focused, focus the corresponding textarea in the new tab
        if (currentlyFocused.matches('.character-prompt-textarea')) {
            // Character textarea was focused, find the corresponding character textarea in the new tab
            const characterItem = currentlyFocused.closest('.character-prompt-item');
            if (characterItem) {
                const characterId = characterItem.id;
                const targetId = `${characterId}_${targetTab}`;
                focusTarget = document.getElementById(targetId);

            }
        } else if (currentlyFocused.matches('.prompt-textarea') && !currentlyFocused.matches('.character-prompt-textarea')) {
            // Main prompt textarea was focused (not character), focus main target tab textarea
            if (targetTab === 'prompt') {
                focusTarget = document.getElementById('manualPrompt');
            } else if (targetTab === 'uc') {
                focusTarget = document.getElementById('manualUc');
            }

        }
    } else {
        // If nothing was focused or something else was focused, default to main textarea
        if (targetTab === 'prompt') {
            focusTarget = document.getElementById('manualPrompt');
        } else if (targetTab === 'uc') {
            focusTarget = document.getElementById('manualUc');
        }

    }

    // Only focus if there was a previously focused textarea
    if (focusTarget) {
        // Use setTimeout to ensure the tab switch is complete before focusing
        setTimeout(() => {
            if (focusTarget && focusTarget.focus) {
                focusTarget.focus();
                // Update emphasis highlighting for the focused textarea
                updateEmphasisHighlighting(focusTarget);
            }
        }, 10);
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

        // Update emphasis highlighting for the active textarea (but don't change focus)
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

function toggleSubMenu() {
    const menu = document.querySelectorAll('.sub-menu-toggle');
    if (menu) {
        menu.forEach(menu => {
            menu.classList.toggle('hidden');
        });
    }
}

function closeSubMenu() {
    const menu = document.querySelectorAll('.sub-menu-toggle');
    if (menu) {
        menu.forEach(menu => {
            menu.classList.add('hidden');
        });
    }
}

function toggleSearchContainer() {
    const searchContainer = document.querySelector('#main-menu-bar .file-search-container');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const mainMenuContents = document.querySelector('#main-menu-bar .main-menu-contents');
    
    if (searchContainer) {
        const isClosed = searchContainer.classList.contains('closed');
        
        if (isClosed) {
            // Opening search - close submenu and open search
            closeSubMenu();
            searchContainer.classList.remove('closed');
            if (clearSearchBtn) {
                clearSearchBtn.classList.remove('hidden');
            }
            if (searchToggleBtn) {
                searchToggleBtn.classList.add('active');
            }
            // Hide main menu contents when search is open
            if (mainMenuContents) {
                mainMenuContents.classList.add('hidden');
            }
            // Focus the search input
            const searchInput = document.getElementById('fileSearchInput');
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 100);
            }
        } else {
            // Closing search - return to main menu mode
            closeSearchContainer();
        }
    }
}

function closeSearchContainer() {
    const searchContainer = document.querySelector('.file-search-container');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const searchInput = document.getElementById('fileSearchInput');
    const mainMenuContents = document.querySelector('.main-menu-contents');
    
    if (searchContainer) {
        searchContainer.classList.add('closed');
        if (clearSearchBtn) {
            clearSearchBtn.classList.add('hidden');
        }
        if (searchToggleBtn) {
            searchToggleBtn.classList.remove('active');
        }
        // Show main menu contents again when search is closed
        if (mainMenuContents) {
            mainMenuContents.classList.remove('hidden');
        }
        // Clear search input and hide autofill
        if (searchInput) {
            searchInput.value = '';
            searchInput.blur();
        }
        // Clear search results if fileSearch instance exists
        if (window.fileSearch) {
            window.fileSearch.clearSearch(true, true);
        }
    }
}

// Make functions globally accessible
window.toggleSearchContainer = toggleSearchContainer;
window.closeSearchContainer = closeSearchContainer;

// Show both panes functionality for manual generation model
function toggleManualShowBoth() {
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    
    const isShowingBoth = promptTabs.classList.contains('show-both');

    if (isShowingBoth) {
        // Return to single tab mode
        promptTabs.classList.remove('show-both');
        showBothBtn.dataset.state = 'off';
        showBothBtn.classList.remove('active');

        // Set Base Prompt as default when returning from show both mode
        syncCharacterPromptTabs('prompt');
    } else {
        // Show both panes
        promptTabs.classList.add('show-both');
        showBothBtn.dataset.state = 'on';
        showBothBtn.classList.add('active');

        // Sync character prompts to show both tabs
        syncCharacterPromptTabsShowBoth();
    }
    
    // Update prompt status icons after toggling show both
    updatePromptStatusIcons();
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
    const balanceDisplay = document.querySelectorAll('.balanceDisplay');
    const balanceAmount = document.querySelectorAll('.balanceAmount');
    
    const balanceFixed = document.querySelectorAll('.balanceFixed');
    const balancePaid = document.querySelectorAll('.balancePaid');
    
    if (!balanceDisplay || !balanceAmount) return;

    const balanceIcon = balanceDisplay[0].querySelector('i');


    const totalCredits = balance?.totalCredits || 0;
    const fixedCredits = balance?.fixedTrainingStepsLeft || 0;
    const purchasedCredits = balance?.purchasedTrainingSteps || 0;

    // Update amount
    balanceAmount.forEach(amount => {
        amount.textContent = totalCredits;
    });

    if (balanceFixed) {
        balanceFixed.forEach(fixed => {
            fixed.textContent = fixedCredits;
        });
    }
    if (balancePaid) {
        balancePaid.forEach(paid => {
            paid.textContent = purchasedCredits;
        });
    }

    // Update tooltip with detailed breakdown
    const tooltip = `Free Credits: ${fixedCredits}\nPaid Credits: ${purchasedCredits}`;
    balanceDisplay.forEach(display => {
        display.title = tooltip;
        display.classList.remove('low-credits');
    });

    if (totalCredits !== -1) {
        currentBalance = totalCredits;
    }

    if (totalCredits === -1) {
        balanceIcon.className = 'nai-anla';
        balanceAmount.forEach(amount => {
            amount.textContent = 'Error';
        });
        balanceDisplay.forEach(display => {
            display.classList.add('low-credits');
        });
    } else if (totalCredits === 0) {
        // No credits - show dollar sign and warning styling
        balanceIcon.className = 'nai-anla';
        balanceDisplay.forEach(display => {
            display.classList.add('low-credits');
        });
    } else if (fixedCredits === 0) {
        // No free credits - show dollar sign
        balanceIcon.className = 'nai-anla';
    } else if (totalCredits < 5000) {
        // Low credits - show warning triangle and orange styling
        balanceIcon.className = 'fas fa-exclamation-triangle';
        balanceDisplay.forEach(display => {
            display.classList.add('low-credits');
        });
    } else {
        // Normal credits - show coin icon
        balanceIcon.className = 'nai-anla';
    }
}

async function rerollImage(image, event = null) {
    // Check if we're in a modal context
    const isInModal = !document.getElementById('manualModal').classList.contains('hidden');
    
    let toastId;
    let progressInterval;

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


        // Get current workspace
        const workspace = activeWorkspace || null;

        // Check if this is an upscaled image and show confirmation dialog if needed
        let isUpscaled = false;
        if (image.upscaled || filenameForMetadata.includes('_upscaled')) {
            isUpscaled = true;
        }

        // Check if this is a large or wallpaper image that will cost credits
        let isLargeOrWallpaper = false;
        if (filenameForMetadata.includes('large_') || filenameForMetadata.includes('wallpaper_')) {
            isLargeOrWallpaper = true;
        }

        // If upscaled and user hasn't already allowed paid requests, show confirmation
        if (isUpscaled && !forcePaidRequest) {
            const cost = 7; // Upscaling cost (same as upscaleImage function)
            const confirmed = await showCreditCostDialog(cost, event);
            if (!confirmed) {
                if (!isInModal) {
                    clearInterval(progressInterval);
                    removeGlassToast(toastId);
                } else {
                    hideManualLoading();
                }
                return;
            }
        }

        // If large/wallpaper image and user hasn't already allowed paid requests, show confirmation
        if (isLargeOrWallpaper && !forcePaidRequest) {
            const confirmed = await showConfirmationDialog(
                'This image was generated with a large or wallpaper resolution, which costs credits to regenerate. Do you want to continue?',
                [
                    { text: 'Yes, use credits', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                event
            );
            if (!confirmed) {
                if (!isInModal) {
                    clearInterval(progressInterval);
                    removeGlassToast(toastId);
                } else {
                    hideManualLoading();
                }
                return;
            }
            // Set the paid flag for this request
            forcePaidRequest = true;
        }
    
        if (!isInModal) {
            // Use glass toast with progress when not in modal
            toastId = showGlassToast('info', 'Rerolling Image', 'Generating new image...', true, false, '<i class="fas fa-dice"></i>');
            
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

        // Use WebSocket reroll functionality (preferred method)
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                const result = await window.wsClient.rerollImage(filenameForMetadata, workspace, null, forcePaidRequest || false);
                
                // Handle successful reroll
                if (result && result.image) {
                    // Convert base64 to blob
                    const byteCharacters = atob(result.image);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'image/png' });
                    
                    // Create image URL
                    const imageUrl = URL.createObjectURL(blob);
                    
                    // Extract seed from result
                    if (result.seed) {
                        window.lastGeneratedSeed = parseInt(result.seed);
                        const sproutSeedBtn = document.getElementById('sproutSeedBtn');
                        const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
                        if (sproutSeedBtn) sproutSeedBtn.classList.add('available');
                        if (manualPreviewSeedNumber) manualPreviewSeedNumber.textContent = parseInt(result.seed);
                        if (typeof updateSproutSeedButtonFromPreviewSeed === 'function') {
                            updateSproutSeedButtonFromPreviewSeed();
                        }
                    }
                    
                    // Show success message
                    if (!isInModal) {
                        clearInterval(progressInterval);
                        updateGlassToastProgress(toastId, 100);
                        updateGlassToastComplete(toastId, {
                            type: 'success',
                            title: 'Reroll Complete',
                            message: 'Image generated successfully!',
                            customIcon: '<i class="nai-check"></i>',
                            showProgress: false
                        });
                    } else {
                        showGlassToast('success', 'Reroll Complete', 'Image generated successfully!');
                        hideManualLoading();
                    }
                    
                    // Refresh gallery and show new image
                    setTimeout(async () => {
                        await loadGallery(true);
                        
                        if (!isInModal) {
                            // Find the newly generated image and show in lightbox
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
                        }
                        
                        // Clean up modal state
                        document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(element => {
                            element.classList.remove('swapped');
                        });
                    }, 1000);
                    
                    return;
                }
            } catch (wsError) {
                console.warn('WebSocket reroll failed, falling back to HTTP:', wsError);
                // Fall back to HTTP method if WebSocket fails
            }
        }
    } catch (error) {
        console.error('Direct reroll error:', error);
        if (!isInModal) {
            clearInterval(progressInterval);
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Reroll Failed',
                message: 'Image reroll failed: ' + error.message,
                customIcon: '<i class="nai-cross"></i>',
                showProgress: false
            });
        } else {
            showError('Image reroll failed: ' + error.message);
            hideManualLoading();
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
        // Close lightbox
        hideLightbox();
        
        openModal(manualModal);
        
        // Add initializing class to show loading state
        manualModal.classList.add('initializing');
        
        // Show spinner overlay
        const spinnerOverlay = manualModal.querySelector('.spinner-overlay');
        if (spinnerOverlay) {
            spinnerOverlay.classList.remove('hidden');
        }
        
        if (!document.body.classList.contains('editor-open')) {
            document.body.classList.add('editor-open');
        }

        let metadata;
        
        // Check if this is a temp file (from blueprint upload)
        if (image.isTempFile && image.metadata) {
            // Use the metadata from the image object
            metadata = image.metadata;
        } else {
            // Regular saved image - use existing logic
            // Determine filename for metadata
            let filenameForMetadata = image.filename || image.upscaled || image.original;
            if (!filenameForMetadata) {
                throw new Error('No filename available for metadata lookup');
            }

            // Get metadata
            metadata = await getImageMetadata(filenameForMetadata);
            if (!metadata) {
                throw new Error('No metadata found for this image');
            }
        }


        // Store metadata and image
        window.currentEditMetadata = metadata;
        window.currentEditImage = image;

        // For gallery editing, we want to edit the prompt/parameters, not use the image as a source
        // Set isVariationEdit to true to indicate this is a variation edit, not img2img
        metadata.isVariationEdit = true;
        
        // Set image_source for preview purposes, but this won't trigger img2img mode due to isVariationEdit flag
        if (!metadata.image_source && image.filename) {
            metadata.image_source = `file:${image.filename}`;
        }

        await loadIntoManualForm(metadata, image);

        // Only call cropImageToResolution if uploadedImageData is available
        if (window.uploadedImageData?.image_source) {
            try {
                // Wait a bit for the image to load before cropping
                await new Promise(resolve => setTimeout(resolve, 100));
                await cropImageToResolution();
            } catch (error) {
                console.warn('Failed to crop image to resolution:', error);
                // Continue without cropping - the image will still be displayed
            }
        }
        
        // Set up preview to show the image being edited
        if (allImages && Array.isArray(allImages)) {
            const filename = image.filename || image.upscaled || image.original;
            if (filename) {
                const galleryIndex = findTrueImageIndexInGallery(filename);
                if (galleryIndex >= 0) {
                    await updateManualPreview(galleryIndex);
                }
            }
        }
        
        manualPreviewOriginalImage.classList.add('hidden');
        
        // Save current gallery position
        const firstNonPlaceholder = document.querySelector('.gallery-item:not(.gallery-placeholder)');
        if (firstNonPlaceholder) {
            savedGalleryPosition = parseInt(firstNonPlaceholder.dataset.index);
        } else {
            // If no real items found, save position 0
            savedGalleryPosition = 0;
        }
        
        // Clear gallery after 5 seconds
        galleryClearTimeout = setTimeout(() => {
            if (!manualModal.classList.contains('hidden')) {
                clearGallery();
            }
        }, 5000);

        // Auto-resize textareas after modal is shown
        autoResizeTextareasAfterModalShow();
        manualPrompt.focus();

        // Remove initializing class after all async processes are complete
        manualModal.classList.remove('initializing');
        
        // Hide spinner overlay
        if (spinnerOverlay) {
            spinnerOverlay.classList.add('hidden');
        }

    } catch (error) {
        console.error('Reroll with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
        // Remove initializing class on error as well
        manualModal.classList.remove('initializing');
        
        // Hide spinner overlay on error as well
        const spinnerOverlay = manualModal.querySelector('.spinner-overlay');
        if (spinnerOverlay) {
            spinnerOverlay.classList.add('hidden');
        }
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
    const isInModal = !document.getElementById('manualModal').classList.contains('hidden');
    
    let toastId;
    let progressInterval;
    
    if (!isInModal) {
        // Use glass toast with progress when not in modal
        toastId = showGlassToast('info', 'Upscaling Image', 'Upscaling image...', true, false, '<i class="nai-upscale"></i>');
        
        // Start progress animation (1% per second)
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += 1;
            updateGlassToastProgress(toastId, progress);
        }, 1000);
    } else {
        // Use preview animation when in modal for upscaling
        showManualLoading(true, 'Upscaling image...');
    }

    try {
        // Prepare upscaling parameters
        const filename = image.original || image.filename || image.upscaled;
        if (!filename) {
            throw new Error('No valid filename found in image object');
        }
        
        const upscaleParams = {
            filename: filename,
            workspace: activeWorkspace || null
        };

        // Upscale image via WebSocket
        try {
            const result = await window.wsClient.upscaleImage(upscaleParams);
            
            if (result) {
                const { image: upscaledImage, filename } = result;

                // Show success message
                if (!isInModal) {
                    clearInterval(progressInterval);
                    updateGlassToastProgress(toastId, 100);
                    updateGlassToastComplete(toastId, {
                        type: 'success',
                        title: 'Upscale Complete',
                        message: 'Image upscaled successfully!',
                        customIcon: '<i class="nai-check"></i>',
                        showProgress: false
                    });
                } else {
                    showGlassToast('success', 'Upscale Complete', 'Image upscaled successfully!');
                }

                // Use the universal image handling function
                const byteCharacters = atob(upscaledImage);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'image/png' });

                // Create a response-like object with the upscaled filename for proper preview update
                const mockResponse = {
                    headers: {
                        get: (headerName) => {
                            if (headerName === 'X-Generated-Filename') {
                                return filename; // This is the upscaled filename from the result
                            }
                            return null;
                        }
                    }
                };

                // Use the universal handleImageResult function with the mock response
                await handleImageResult(blob, 'Image upscaled successfully!', undefined, undefined, mockResponse);
            } else {
                throw new Error('Invalid response from WebSocket');
            }
            
        } catch (error) {
            console.error('Upscaling error:', error);
            if (!isInModal) {
                if (progressInterval) clearInterval(progressInterval);
                updateGlassToastComplete(toastId, {
                    type: 'error',
                    title: 'Upscale Failed',
                    message: 'Image upscaling failed. Please try again.',
                    customIcon: '<i class="nai-cross"></i>',
                    showProgress: false
                });
            } else {
                showError('Image upscaling failed. Please try again.');
            }
        }

    } catch (error) {
        console.error('Upscaling error:', error);
        if (!isInModal) {
            if (progressInterval) clearInterval(progressInterval);
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Upscale Failed',
                message: 'Image upscaling failed. Please try again.',
                customIcon: '<i class="nai-cross"></i>',
                showProgress: false
            });
        } else {
            showError('Image upscaling failed. Please try again.');
        }
    } finally {
        if (isInModal) {
            showManualLoading(false);
        } else if (progressInterval) {
            clearInterval(progressInterval);
        }
    }
}

// Handle logout
async function handleLogout() {
    try {
        const response = await fetchWithAuth('/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'logout'
            })
        });
        if (response.ok) {
            // Clear authentication-related data from localStorage
            try {
                // Remove user authentication data
                localStorage.removeItem('userType');
                localStorage.removeItem('userData');
                localStorage.removeItem('loginTimestamp');

                // Remove master window/session data
                localStorage.removeItem('staticforge_master_window');
                localStorage.removeItem('staticforge_master_session');

                // Disconnect WebSocket client
                if (window.wsClient && typeof window.wsClient.disconnect === 'function') {
                    console.log('🔌 Disconnecting WebSocket client');
                    window.wsClient.disconnect();
                }

                // Clear master window status
                if (window.masterWindowClient && typeof window.masterWindowClient.clearMaster === 'function') {
                    window.masterWindowClient.clearMaster();
                }
            } catch (error) {
                console.warn('⚠️ Failed to clear some localStorage keys or disconnect services:', error);
            }

            window.location.href = '/';
        } else {
            showError('Logout failed');
        }
    } catch (error) {
        // Already redirected on 401
    }
}
// Show manual modal
async function showManualModal(presetName = null) {
    // Disable on mobile displays
    if (window.innerWidth <= 577) {
        return false;
    }
    
    // Track if we were in search mode before opening modal
    wasInSearchMode = isInSearchMode();
    
    // Always return to gallery mode when opening manual modal
    if (wasInSearchMode) {
        closeSearchContainer();
    }
    
    // Prevent body scrolling when modal is open
    if (!document.body.classList.contains('editor-open')) {
        document.body.classList.add('editor-open');
    }
    
    // Stop any existing preview animation when opening modal
    if (generationAnimationActive) {
        stopPreviewAnimation();
    }
    
    // Show loading overlay for manual modal opening
    const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
    if (manualLoadingOverlay) {
        const loadingText = manualLoadingOverlay.querySelector('p');
        if (loadingText) {
            loadingText.textContent = 'Opening manual generation...';
        }
        manualLoadingOverlay.classList.remove('hidden');
        manualLoadingOverlay.classList.remove('return');
    }

    // Close editor if open
    manualLoadingOverlay.classList.remove('hidden');
    manualLoadingOverlay.classList.add('return');
    manualPreviewOriginalImage.classList.add('hidden');
    openModal(manualModal);
    manualPrompt.focus();
    
    // Calculate previewRatio after modal is opened and visible
    setTimeout(() => {
        calculatePreviewRatio();
    }, 100);

    // Check if a preset is selected for editing
    const selectedValue = presetSelect.value;
    if (presetName) {
        // Load preset for editing
        await loadIntoManualForm('preset:' + presetName);
    } else if (selectedValue) {
        // Load preset for editing
        await loadIntoManualForm(selectedValue);
    } else {
        // Clear form for new generation
        clearManualForm();
    }

    // Auto-resize textareas after modal is shown
    autoResizeTextareasAfterModalShow();
    
    // Update prompt status icons
    updatePromptStatusIcons();

    // Update load button state
    updatePresetLoadSaveState();
    updateManualPresetToggleBtn();

    // Update button state
    updateManualGenerateBtnState();

    // Calculate initial price display
    updateManualPriceDisplay();

    // Check if "show both" mode is active and hide tab buttons container if needed
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const showBothBtn = document.getElementById('showBothBtn');
    const tabButtonsContainer = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');

    if (promptTabs && promptTabs.classList.contains('show-both') && showBothBtn && showBothBtn.classList.contains('active')) {
        // "Show both" mode is active, hide the tab buttons container
        if (tabButtonsContainer) {
            tabButtonsContainer.classList.add('hidden');
        }
    }
    
    // Hide loading overlay after modal is fully loaded
    if (manualLoadingOverlay) {
        manualLoadingOverlay.classList.add('return');
        setTimeout(() => {
            manualLoadingOverlay.classList.add('hidden');
        }, 300); // Match the transition duration
    }
    
    // Save current gallery position
    const firstNonPlaceholder = document.querySelector('.gallery-item:not(.gallery-placeholder)');
    if (firstNonPlaceholder) {
        savedGalleryPosition = parseInt(firstNonPlaceholder.dataset.index);
    } else {
        // If no real items found, save position 0
        savedGalleryPosition = 0;
    }
    
    // Clear gallery after 5 seconds
    galleryClearTimeout = setTimeout(() => {
        if (!manualModal.classList.contains('hidden')) {
            clearGallery();
        }
    }, 5000);
}

// Hide manual modal
function hideManualModal(e, preventModalReset = false) {
    if (!preventModalReset) {
        // Handle loading overlay when modal is closed
        const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
        if (manualLoadingOverlay && !manualLoadingOverlay.classList.contains('hidden')) {
            // If manual loading overlay is visible, switch to regular loading overlay
            const loadingMessage = manualLoadingOverlay.querySelector('p')?.textContent || 'Generating your image...';
            manualLoadingOverlay.classList.add('hidden', 'return');
            showManualLoading(true, loadingMessage);
        }

        // Stop preview animation if it's running when modal is closed
        if (generationAnimationActive) {
            stopPreviewAnimation();
        }

        if (previewSection) {
            previewSection.classList.remove('active', 'show');
            hideManualPreview();
        }

        closeModal(manualModal);
        if (document.body.classList.contains('editor-open')) {
            document.body.classList.remove('editor-open');
        }
        clearManualForm();

        // Reset manual preview
        resetManualPreview();
        
        // Deregister manual preview event listeners when modal is closed
        deregisterManualPreviewEventListeners();

        // Hide request type toggle row
        const requestTypeRow = document.getElementById('requestTypeRow');
        if (requestTypeRow) {
            requestTypeRow.classList.add('hidden');
        }

        directorInstance.hideDirector();

        // Clear edit context
        window.currentEditMetadata = null;
        window.currentEditImage = null;
        window.currentRequestType = null;
        window.initialEdit = null;
        window.lastGeneration = null;
        // Director new session functionality is always available

        // Reset random prompt state
        savedRandomPromptState = null;
        lastPromptState = null;
        
        // Reset background update state
        backgroundUpdateState.isAnimating = false;
        backgroundUpdateState.pendingRequest = null;
        backgroundUpdateState.lastRequest = null;
        backgroundUpdateState.animationPromise = null;

        // Reset random prompt buttons and icons
        const toggleBtn = document.getElementById('randomPromptToggleBtn');
        const refreshBtn = document.getElementById('randomPromptRefreshBtn');
        const transferBtn = document.getElementById('randomPromptTransferBtn');
        const nsfwBtn = document.getElementById('randomPromptNsfwBtn');
        const divider = document.getElementById('randomPromptDivider');

        if (toggleBtn) {
            toggleBtn.dataset.state = 'off';
            toggleBtn.classList.remove('active');
        }
        if (refreshBtn) {
            refreshBtn.classList.add('hidden');
        }
        if (transferBtn) {
            transferBtn.classList.add('hidden');
        }
        if (nsfwBtn) {
            nsfwBtn.dataset.state = 'off';
            nsfwBtn.classList.remove('active');
            nsfwBtn.classList.add('hidden');
        }
        if (divider) {
            divider.classList.add('hidden');
        }
        // Hide keyboard shortcuts overlay
        hideShortcutsOverlay();
        
        // Update button state
        updateManualGenerateBtnState();
    }
    
    // Always clear gallery clear timeout and restore gallery when modal is closed
    // regardless of whether preventModalReset is true or not
    clearTimeout(galleryClearTimeout);

    // Return to search mode if we were in it before opening the modal
    if (wasInSearchMode) {
        // Reopen search container and restore search results
        const searchContainer = document.querySelector('#main-menu-bar .file-search-container');
        if (searchContainer) {
            searchContainer.classList.remove('closed');
            const clearSearchBtn = document.getElementById('clearSearchBtn');
            if (clearSearchBtn) {
                clearSearchBtn.classList.remove('hidden');
            }
            const searchToggleBtn = document.getElementById('searchToggleBtn');
            if (searchToggleBtn) {
                searchToggleBtn.classList.add('active');
            }
            const mainMenuContents = document.querySelector('#main-menu-bar .main-menu-contents');
            if (mainMenuContents) {
                mainMenuContents.classList.add('hidden');
            }
            
            // Restore search results if fileSearch instance exists
            if (window.fileSearch && window.fileSearch.currentQuery) {
                // Trigger search to restore results
                window.fileSearch.performSearch(window.fileSearch.currentQuery);
            }
        }
        wasInSearchMode = false; // Reset the flag
        savedGalleryPosition = null;
    } else if (savedGalleryPosition !== null) {
        loadGalleryFromIndex(savedGalleryPosition);
        savedGalleryPosition = null;
    } else {
        loadGalleryFromIndex(0);
    }
}

// Clear gallery when manual modal is open
function clearGallery() {
    if (gallery) {
        gallery.innerHTML = '';
    }
}

// Load gallery from specific index and scroll to it
async function loadGalleryFromIndex(index) {
    try {
        
        // Load gallery data if needed
        if (allImages.length === 0) {
            await loadGallery();
        }
        
        // Reset infinite scroll state but set custom start position
        window.scrollTo({ top: 0, behavior: 'instant' });
        
        // Set the display range to include our target index
        const itemHeight = 256;
        const itemsPerCol = Math.floor(window.innerHeight / itemHeight);
        const buffer = Math.ceil(itemsPerCol * 0.15);
        // Get gallery columns from gallery element or fallback to 5
        const cols = window.realGalleryColumns || parseInt(gallery?.style?.gridTemplateColumns?.match(/repeat\((\d+),/)?.[1]) || 5;
        const itemsPerPage = (itemsPerCol + buffer) * cols;
        
        // Calculate which "page" our target index is on
        const pageNumber = Math.floor(index / itemsPerPage);
        const startIndex = pageNumber * itemsPerPage;
        
        // Set the infinite scroll state to display the correct range
        displayedStartIndex = startIndex;
        displayedEndIndex = Math.min(startIndex + itemsPerPage, allImages.length);
        
        // Update scroll state variables
        isLoadingMore = false;
        hasMoreImages = displayedEndIndex < allImages.length;
        hasMoreImagesBefore = displayedStartIndex > 0;
                
        // Display gallery with the calculated range
        displayGalleryFromStartIndex(displayedStartIndex);
        
        // Wait for DOM to update, then find and scroll to target
        setTimeout(() => {
            const targetItem = document.querySelector(`[data-index="${index}"]`);
            if (targetItem) {
                // Scroll to the item with offset to avoid triggering upper placeholders
                const itemRect = targetItem.getBoundingClientRect();
                const scrollTop = window.pageYOffset + itemRect.top - 100; // 100px offset from top
                window.scrollTo({ top: scrollTop, behavior: 'instant' });
            } else {
                // Calculate approximate scroll position based on index
                const approximateScrollTop = (index / cols) * itemHeight;
                window.scrollTo({ top: approximateScrollTop - 100, behavior: 'instant' });
            }
        }, 200); // Give DOM time to render
        
    } catch (error) {
        console.error('❌ Error restoring gallery from index:', error);
        // Fallback to normal gallery display
        try {
            resetInfiniteScroll();
            displayCurrentPageOptimized();
        } catch (fallbackError) {
            console.error('❌ Fallback gallery display also failed:', fallbackError);
        }
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
    selectManualModel('v4_5', '', true);
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
    datasetBias = {};
    if (window.optionsData?.datasets) {
        window.optionsData.datasets.forEach(dataset => {
            datasetBias[dataset.value] = 1.0;
        });
    }
    updateDatasetDisplay();
    renderDatasetDropdown();

    appendQuality = true;
    if (qualityToggleBtn) {
        qualityToggleBtn.setAttribute('data-state', 'on');
    }

    autoPositionBtn.setAttribute('data-state', 'on');

    selectedUcPreset = 3; // Default to "Heavy"
    selectUcPreset(3);
    renderUcPresetsDropdown();
    
    // Update prompt status icons after clearing form
    updatePromptStatusIcons();

    // Clear generating state
    isGenerating = false;
    updateManualGenerateBtnState();

    // Reset preset name field
    manualPresetName.disabled = false;
    manualPresetName.style.opacity = '1';

    variationImage.src = '';

    // Reset transformation section states
    if (transformationRow) {
        transformationRow.classList.remove('display-image');
    }

    document.getElementById('manualImg2ImgGroup').classList.add('hidden');

    const transformationDropdown = document.getElementById('transformationDropdown');
    if (transformationDropdown) {
        transformationDropdown.classList.remove('disabled');
    }


    if (vibeReferencesContainer) {
        vibeReferencesContainer.classList.add('hidden');
        vibeReferencesContainer.innerHTML = '';
    }
    if (transformationRow) {
        transformationRow.classList.remove('display-vibe');
    }
    if (vibeNormalizeToggle) {
        vibeNormalizeToggle.classList.add('hidden');
    }
    // Update transformation dropdown button active state
    updateTransformationDropdownForVibes();

    // Clear variation context
    if (window.currentEditMetadata) {
        delete window.currentEditMetadata.sourceFilename;
        delete window.currentEditMetadata.isVariationEdit;
    }

    // Restore UI elements
    const presetNameGroup = document.querySelector('.form-group:has(#manualPresetName)');
    const saveButton = document.getElementById('manualSaveBtn');

    if (presetNameGroup) {
        presetNameGroup.classList.remove('hidden');
    }
    if (saveButton) {
        saveButton.classList.remove('hidden');
    }

    // Clear character prompts
    clearCharacterPrompts();

    // Reset sprout seed button state
    if (sproutSeedBtn) {
        sproutSeedBtn.setAttribute('data-state', 'on');
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
    sproutSeedBtn.classList.remove('available');
    manualPreviewSeedNumber.textContent = '---'
    updateSproutSeedButtonFromPreviewSeed();

    updateAutoPositionToggle();

    // Hide image bias dropdown
    hideImageBiasDropdown();

    if (clearSeedBtn) clearSeedBtn.classList.toggle('hidden', !manualSeed?.value);

    // Reset transformation dropdown state
    updateTransformationDropdownState();

    updateUploadDeleteButtonVisibility();

    // Hide autocomplete overlays
    hideCharacterAutocomplete();
    hidePresetAutocomplete();

    updatePresetLoadSaveState();
}

// Handle manual generation
// Utility: Collect common form values
function collectManualFormValues() {
    // Ensure manualResolutionHidden has a value
    if (manualResolutionHidden && !manualResolutionHidden.value) {
        manualResolutionHidden.value = 'normal_square';
    }

    let values = {
        model: manualModel.value,
        prompt: manualPrompt.value.trim() + '',
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

    // Process resolution value to determine if it's custom or predefined
    const resolutionData = processResolutionValue(manualResolution.value);
    values.resolutionValue = manualResolution.value;
    // Add width and height for custom resolutions
    if (resolutionData.isCustom) {
        values.width = resolutionData.width;
        values.height = resolutionData.height;
    }

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
        const ratioInput = item.querySelector('input.vibe-reference-ratio-input');
        const disabledVibe = item.querySelector('.vibe-reference-controls .indicator[data-state="off"]');
        // Skip disabled vibe references
        if (disabledVibe) {
            return;
        }

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
        sproutSeedBtn.classList.add('available');
        manualPreviewSeedNumber.textContent = parseInt(seed);
        updateSproutSeedButtonFromPreviewSeed();
    }

    if (response && response.headers) {
        // Extract seed from response header if available
        const headerSeed = response.headers.get('X-Seed');
        if (headerSeed) {
            window.lastGeneratedSeed = parseInt(headerSeed);
            sproutSeedBtn.classList.add('available');
            manualPreviewSeedNumber.textContent = parseInt(headerSeed);
            updateSproutSeedButtonFromPreviewSeed();
        }
        // Fetch metadata for the generated image if we have a filename
        const filename = response.headers.get('X-Generated-Filename');
        if (filename) {
            try {
                const metadata = await getImageMetadata(filename);
                window.lastGeneration = metadata;
                window.lastGeneration.filename = filename;
                manualPreviewOriginalImage.classList.remove('hidden');
                // Director new session functionality is always available
            } catch (error) {
                console.warn('Failed to fetch metadata for generated image:', error);
            }
        }
    }

    const imageUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = async function() {
        createConfetti();
        await loadGallery(true);

        if (!manualModal.classList.contains('hidden')) {
            // Update manual modal preview instead of opening lightbox
            // Don't clear context when modal is open in wide viewport mode

            document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(element => {
                element.classList.remove('swapped');
            });

            // Only update allImages array, don't update gallery display
            await updateManualPreview(0, response);
        } else {
            // Clear context only when modal is not open or not in wide viewport mode
            if (typeof clearContextFn === "function") clearContextFn();
            // Normal behavior - open lightbox
            setTimeout(async () => {
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


// Utility functions for background update management
function canUpdateBackground() {
    return !backgroundUpdateState.isAnimating;
}

function getPendingBackgroundRequest() {
    return backgroundUpdateState.pendingRequest;
}

function forceBackgroundUpdate(imageUrl) {
    // Cancel any pending animation and force immediate update
    if (backgroundUpdateState.animationPromise) {
        // We can't cancel the promise, but we can mark it as no longer needed
        backgroundUpdateState.pendingRequest = null;
    }
    
    // Clear any pending requests and force immediate execution
    backgroundUpdateState.pendingRequest = null;
    backgroundUpdateState.isAnimating = false;
    
    // Call the function directly for immediate update
    return updateManualPreviewBlurredBackground(imageUrl);
}

function cancelPendingBackgroundUpdates() {
    // Clear any pending background update requests
    backgroundUpdateState.pendingRequest = null;
    // Note: We can't cancel the current animation, but we can prevent new ones from queuing
}

function isBackgroundUpdateInProgress() {
    return backgroundUpdateState.isAnimating || !!backgroundUpdateState.pendingRequest;
}

function waitForBackgroundUpdateComplete() {
    if (backgroundUpdateState.animationPromise) {
        return backgroundUpdateState.animationPromise;
    }
    return Promise.resolve();
}

function getBackgroundUpdateStats() {
    return {
        totalCalls: backgroundUpdateState.callCount,
        lastCallTime: backgroundUpdateState.lastCallTime,
        isAnimating: backgroundUpdateState.isAnimating,
        hasPending: !!backgroundUpdateState.pendingRequest,
        lastRequest: backgroundUpdateState.lastRequest,
        pendingRequest: backgroundUpdateState.pendingRequest
    };
}

function resetBackgroundUpdateStats() {
    backgroundUpdateState.callCount = 0;
    backgroundUpdateState.lastCallTime = 0;
}

// Function to update blurred background for manual preview
async function updateManualPreviewBlurredBackground(imageUrl) {
    try {
        // Extract filename from imageUrl
        const filename = imageUrl.split('/').pop();
        const baseName = filename
            .replace(/\.(png|jpg|jpeg)$/i, '')
            .replace(/_upscaled$/, '');
        
        // Get the blurred preview URL - encode the baseName to handle spaces and special characters
        const blurPreviewUrl = `/previews/${encodeURIComponent(baseName)}_blur.jpg`;
        
        // Check if the blurred preview exists
        try {
            const response = await fetch(blurPreviewUrl, { method: 'HEAD' });
            if (!response.ok) {
                // Blurred preview doesn't exist, hide backgrounds
                const bg1 = document.getElementById('manualPreviewBlurBackground1');
                const bg2 = document.getElementById('manualPreviewBlurBackground2');
                if (bg1) bg1.style.opacity = '0';
                if (bg2) bg2.style.opacity = '0';
                return;
            }
        } catch (error) {
            // Blurred preview doesn't exist, hide backgrounds
            const bg1 = document.getElementById('manualPreviewBlurBackground1');
            const bg2 = document.getElementById('manualPreviewBlurBackground2');
            if (bg1) bg1.style.opacity = '0';
            if (bg2) bg2.style.opacity = '0';
            return;
        }
        
        // Get the two background containers
        const bg1 = document.getElementById('manualPreviewBlurBackground1');
        const bg2 = document.getElementById('manualPreviewBlurBackground2');
        
        if (!bg1 || !bg2) return;
        
        // Preload the image before applying it to prevent flashing
        const preloadImage = new Image();
        preloadImage.crossOrigin = 'anonymous';
        
        // Wait for the image to load completely
        await new Promise((resolve, reject) => {
            preloadImage.onload = resolve;
            preloadImage.onerror = reject;
            preloadImage.src = blurPreviewUrl;
        });
        
        // Determine which background is currently active
        // Check if either background has opacity > 0 (is visible)
        const bg1Opacity = parseFloat(bg1.style.opacity) || 0;
        const bg2Opacity = parseFloat(bg2.style.opacity) || 0;
        const activeBg = bg1Opacity > 0 ? bg1 : bg2;
        const inactiveBg = bg1Opacity > 0 ? bg2 : bg1;
        

        
        // Set the new image on the inactive background
        inactiveBg.style.backgroundImage = `url(${blurPreviewUrl})`;
        
        // Ensure the inactive background starts completely transparent
        inactiveBg.style.opacity = '0';
        
        // Force a reflow to ensure the background image is applied before transition
        inactiveBg.offsetHeight;
        
        // Start the CSS transition by changing opacity values
        // The CSS transition: opacity 0.5s ease-in-out will handle the animation
        activeBg.style.opacity = '0';
        inactiveBg.style.opacity = '0.45';
        

        
        // Return a promise that resolves when the CSS transition completes
        return new Promise((resolve) => {
            // Wait for the CSS transition duration (500ms) plus a small buffer
            setTimeout(() => {
                // Clean up the old background image
                if (parseFloat(activeBg.style.opacity) === 0) {
                    activeBg.style.backgroundImage = 'none';
    
                }
                resolve();
            }, 550); // 500ms transition + 50ms buffer
        });
        
    } catch (error) {
        console.warn('Failed to update blurred background:', error);
        // On error, hide backgrounds to prevent showing broken images
        const bg1 = document.getElementById('manualPreviewBlurBackground1');
        const bg2 = document.getElementById('manualPreviewBlurBackground2');
        if (bg1) bg1.style.opacity = '0';
        if (bg2) bg2.style.opacity = '0';
        throw error; // Re-throw to maintain promise rejection
    }
}

// Function to update manual modal preview
async function updateManualPreview(index = 0, response = null, metadata = null) {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const seedBtn = document.getElementById('manualPreviewSeedBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');
    

    if (previewImage && previewPlaceholder) {
        // Get the image at the specified index
        let imageData = null;
        let imageUrl = null;
        
        if (response && response.headers) {
            // For newly generated images, use the response data
            const generatedFilename = response.headers.get('X-Generated-Filename');
            if (generatedFilename) {
                imageUrl = `/images/${generatedFilename}`;
                imageData = {
                    original: generatedFilename,
                    base: generatedFilename,
                    upscaled: null
                };
            }
        } else {
            // For existing images, request from server by index
            try {
                const viewType = currentGalleryView || 'images';
                imageData = await window.wsClient.requestImageByIndex(index, viewType);
                if (imageData) {
                    imageUrl = `/images/${imageData.original}`;
                }
            } catch (error) {
                console.warn('Failed to get image by index:', error);
                return;
            }
        }
        
        if (!imageData || !imageUrl) {
            console.warn('No image data available for index:', index);
            return;
        }
        
        // Wait for the manual preview preload to complete before applying the image
        let imageWidth, imageHeight;
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Store image dimensions for container sizing
                imageWidth = img.naturalWidth;
                imageHeight = img.naturalHeight;
                // Preload completed successfully
                resolve();
            };
            img.onerror = () => {
                reject(new Error('Failed to preload image'));
            };
            img.src = imageUrl;
        });
        
        // Now apply the image after preload is complete
        previewImage.src = imageUrl;
        previewImage.classList.remove('hidden');
        previewPlaceholder.classList.add('hidden');

        // Store the blob URL for download functionality
        previewImage.dataset.blobUrl = imageUrl;
        
        // Stop generation animation when image is actually loaded
        previewImage.onload = () => {
            if (generationAnimationActive) {
                stopPreviewAnimation();
            }
        };
        
        // Apply dynamic container sizing based on image aspect ratio
        if (imageWidth && imageHeight) {
            sizeManualPreviewContainer(imageWidth, imageHeight);
        }

        // Update blurred background with debouncing
        // Always use the debounced version to prevent duplicate calls
        updateBlurredBackground(imageUrl);

        // Check if we have initialEdit data for side-by-side preview
        if (window.initialEdit && window.initialEdit.image) {
            // Show original image for comparison
            if (originalImage) {
                const originalImageUrl = `/images/${window.initialEdit.image.original || window.initialEdit.image.filename}`;
                originalImage.src = originalImageUrl;
                originalImage.classList.remove('hidden');
                
                // Add click handler to load original image into main preview
                originalImage.onclick = function() {
                    swapManualPreviewImages();
                };
                
                // Enable dual mode
                imageContainers.forEach(container => {
                    container.classList.add('dual-mode');
                });
            }
        } else if (index !== 0) {
            // If we're navigating to a different image (not index 0), try to show last generation on the right
            // First, try to get the last generation from window.lastGeneration
            let lastGenImage = null;
            if (window.lastGeneration && window.lastGeneration.filename) {
                lastGenImage = window.lastGeneration;
            } else if (allImages && allImages.length > 0) {
                // If no lastGeneration, use the first image (index 0) as the "last generation"
                lastGenImage = allImages[0];
            }
            
            if (lastGenImage && originalImage) {
                const lastGenFilename = lastGenImage.original || lastGenImage.filename || lastGenImage.upscaled;
                if (lastGenFilename) {
                    originalImage.src = `/images/${lastGenFilename}`;
                    originalImage.classList.remove('hidden');
                    originalImage.onclick = function() {
                        // When clicked, restore the original image
                        restoreOriginalImage();
                    };
                    
                    // Enable dual mode
                    imageContainers.forEach(container => {
                        container.classList.add('dual-mode');
                    });
                }
            }
        } else if (index === 0) {
            // For index 0, show the last generation on the right side if available
            let lastGenImage = null;
            if (window.lastGeneration && window.lastGeneration.filename) {
                lastGenImage = window.lastGeneration;
            } else if (allImages && allImages.length > 0) {
                // Use the first image as the "last generation"
                lastGenImage = allImages[0];
            }
            
            if (lastGenImage && originalImage) {
                const lastGenFilename = lastGenImage.original || lastGenImage.filename || lastGenImage.upscaled;
                if (lastGenFilename) {
                    originalImage.src = `/images/${lastGenFilename}`;
                    originalImage.classList.remove('hidden');
                    originalImage.onclick = function() {
                        swapManualPreviewImages();
                    };
                    
                    // Enable dual mode
                    imageContainers.forEach(container => {
                        container.classList.add('dual-mode');
                    });
                } else {
                }
            } else {
            }
        } else {
            // Single image mode
            if (originalImage) {
                originalImage.classList.add('hidden');
            }
            imageContainers.forEach(container => {
                container.classList.remove('dual-mode', 'original-hidden');
            });
        }

        // Set the current image and index
        window.currentManualPreviewImage = imageData;
        // Director new session functionality is always available
        window.currentManualPreviewIndex = index;

        // Use passed metadata if available, otherwise use metadata from imageData
            if (metadata) {
            imageData.metadata = metadata;
        } else if (imageData.metadata) {
            // Metadata already included from server
        } else if (imageData.original) {
            // Load metadata if not available
            try {
                const loadedMetadata = await getImageMetadata(imageData.original);
                imageData.metadata = loadedMetadata;
                } catch (error) {
                    console.warn('Failed to load metadata for image:', error);
                }
        }

        // Show control buttons
        if (downloadBtn) downloadBtn.classList.remove('hidden');
        if (manualPreviewCopyBtn) manualPreviewCopyBtn.classList.remove('hidden');
        if (upscaleBtn) upscaleBtn.classList.remove('hidden');
        if (rerollBtn) rerollBtn.classList.remove('hidden');
        if (variationBtn) variationBtn.classList.remove('hidden');
        if (manualPreviewLoadBtn) manualPreviewLoadBtn.classList.remove('hidden');
        
        // Show and update pin button
        if (manualPreviewPinBtn) {
            manualPreviewPinBtn.classList.remove('hidden');
            if (window.currentManualPreviewImage) {
                const filename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
                if (filename) {
                    updatePinButtonAppearance(manualPreviewPinBtn, filename);
                }
            }
        }
        
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) {
            scrapBtn.classList.remove('hidden');
            // Update scrap button based on current view
            if (currentGalleryView === 'scraps') {
                scrapBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-archive-arrow-up"></i>';
                scrapBtn.title = 'Remove from scraps';
            } else {
                scrapBtn.innerHTML = '<i class="mdi mdi-1-25 mdi-archive"></i>';
                scrapBtn.title = 'Move to scraps';
            }
        }
        if (seedBtn) seedBtn.classList.remove('hidden');
        if (deleteBtn) deleteBtn.classList.remove('hidden');

        // Initialize lightbox functionality
        setTimeout(() => {
            initializeManualPreviewLightbox();
        }, 100);

        // Update seed display
        if (window.currentManualPreviewImage && window.currentManualPreviewImage.metadata && window.currentManualPreviewImage.metadata.seed !== undefined) {
            manualPreviewSeedNumber.textContent = window.currentManualPreviewImage.metadata.seed;
            window.lastGeneratedSeed = window.currentManualPreviewImage.metadata.seed;
            sproutSeedBtn.classList.add('available');
            updateSproutSeedButtonFromPreviewSeed();
        } else {
            manualPreviewSeedNumber.textContent = '---';
            window.lastGeneratedSeed = null;
            sproutSeedBtn.classList.remove('available');
            updateSproutSeedButtonFromPreviewSeed();
        }
        if (window.currentManualPreviewImage) {
            if (window.currentManualPreviewImage.metadata) {
                window.lastGeneration = window.currentManualPreviewImage.metadata;
            }
            if (window.currentManualPreviewImage.filename) {
                window.lastGeneration.filename = window.currentManualPreviewImage.filename;
            }
            // Director new session functionality is always available
        }

        // Update navigation buttons
        updateManualPreviewNavigation();
    }
}

// Function to update manual preview directly with image object (for search mode navigation)
async function updateManualPreviewDirectly(imageObj, metadata = null) {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const seedBtn = document.getElementById('manualPreviewSeedBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');

    if (previewImage && previewPlaceholder) {
        // Construct image URL from the image object
        const imageUrl = `/images/${imageObj.upscaled || imageObj.original || imageObj.filename}`;
        
        // Wait for the manual preview preload to complete before applying the image
        let imageWidth, imageHeight;
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Store image dimensions for container sizing
                imageWidth = img.naturalWidth;
                imageHeight = img.naturalHeight;
                // Preload completed successfully
                resolve();
            };
            img.onerror = () => {
                reject(new Error('Failed to preload image'));
            };
            img.src = imageUrl;
        });
        
        // Now apply the image after preload is complete
        previewImage.src = imageUrl;
        previewImage.classList.remove('hidden');
        previewPlaceholder.classList.add('hidden');

        // Store the blob URL for download functionality
        previewImage.dataset.blobUrl = imageUrl;
        
        // Stop generation animation when image is actually loaded
        previewImage.onload = () => {
            if (generationAnimationActive) {
                stopPreviewAnimation();
            }
        };
        
        // Apply dynamic container sizing based on image aspect ratio
        if (imageWidth && imageHeight) {
            sizeManualPreviewContainer(imageWidth, imageHeight);
        }

        // Update blurred background
        updateBlurredBackground(imageUrl);

        // Set the current image
        window.currentManualPreviewImage = imageObj;
        if (window.currentManualPreviewImage.metadata) {
            window.lastGeneration = window.currentManualPreviewImage.metadata;
        }
        if (window.currentManualPreviewImage.filename) {
            window.lastGeneration.filename = window.currentManualPreviewImage.filename;
        }
        // Director new session functionality is always available
        
        // Try to find the index of this image in the gallery
        let imageIndex = -1;
        if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
            // Search mode - use filtered results
            imageIndex = window.originalAllImages.findIndex(img => {
                return img.upscaled === imageObj.upscaled || 
                       img.original === imageObj.original ||
                       img.filename === imageObj.filename;
            });
        } else if (allImages && allImages.length > 0) {
            // Normal mode - use current allImages
            imageIndex = allImages.findIndex(img => {
                return img.upscaled === imageObj.upscaled || 
                       img.original === imageObj.original ||
                       img.filename === imageObj.filename;
            });
        }
        
        // Update the current index (use found index or keep as -1 if not found)
        window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;
        
        // Use passed metadata if available
        if (metadata) {
            imageObj.metadata = metadata;
        }

        // Show control buttons
        if (downloadBtn) downloadBtn.classList.remove('hidden');
        if (manualPreviewCopyBtn) manualPreviewCopyBtn.classList.remove('hidden');
        if (upscaleBtn) upscaleBtn.classList.remove('hidden');
        if (rerollBtn) rerollBtn.classList.remove('hidden');
        if (variationBtn) variationBtn.classList.remove('hidden');
        if (manualPreviewLoadBtn) manualPreviewLoadBtn.classList.remove('hidden');
        
        // Show and update pin button
        if (manualPreviewPinBtn) {
            manualPreviewPinBtn.classList.remove('hidden');
            if (window.currentManualPreviewImage) {
                const filename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
                if (filename) {
                    updatePinButtonAppearance(manualPreviewPinBtn, filename);
                }
            }
        }
        
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) {
            scrapBtn.classList.remove('hidden');
            // Update scrap button based on current view
            if (currentGalleryView === 'scraps') {
                scrapBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-archive-arrow-up"></i>';
                scrapBtn.title = 'Remove from scraps';
            } else {
                scrapBtn.innerHTML = '<i class="mdi mdi-1-25 mdi-archive"></i>';
                scrapBtn.title = 'Move to scraps';
            }
        }
        if (seedBtn) seedBtn.classList.remove('hidden');
        if (deleteBtn) deleteBtn.classList.remove('hidden');

        // Initialize lightbox functionality
        setTimeout(() => {
            initializeManualPreviewLightbox();
        }, 100);

        // Update seed display
        if (window.currentManualPreviewImage && window.currentManualPreviewImage.metadata && window.currentManualPreviewImage.metadata.seed !== undefined) {
            manualPreviewSeedNumber.textContent = window.currentManualPreviewImage.metadata.seed;
            window.lastGeneratedSeed = window.currentManualPreviewImage.metadata.seed;
            sproutSeedBtn.classList.add('available');
            updateSproutSeedButtonFromPreviewSeed();
        } else {
            manualPreviewSeedNumber.textContent = '---';
            window.lastGeneratedSeed = null;
            sproutSeedBtn.classList.remove('available');
            updateSproutSeedButtonFromPreviewSeed();
        }

        // Update navigation buttons
        updateManualPreviewNavigation();
    }
}

// Function to handle image swapping in manual preview
function swapManualPreviewImages() {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
    
    if (!previewImage || !originalImage || !imageContainers || !window.lastGeneration || !window.initialEdit) return;
    
    // Check if we're currently showing the original image
    if (Array.from(imageContainers).some(container => container.classList.contains('swapped'))) {
        // Switch back to generated image
        if (window.lastGeneration && window.lastGeneration.filename) {
            const generatedImageUrl = `/images/${window.lastGeneration.filename}`;
            previewImage.src = generatedImageUrl;
            manualPreviewSeedNumber.textContent = window.lastGeneration.seed;
            updateSproutSeedButtonFromPreviewSeed();
            
            // Update blurred background
            updateBlurredBackground(generatedImageUrl);
            
            // Update global variables to reflect the generated image
            window.currentManualPreviewImage = window.lastGeneration;
            // Director new session functionality is always available
            // Try to find the index of the generated image
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === window.lastGeneration.filename || 
                           img.original === window.lastGeneration.filename;
                });
            } else if (allImages && allImages.length > 0) {
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === window.lastGeneration.filename || 
                           img.original === window.lastGeneration.filename;
                });
            }
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;
        }
        imageContainers.forEach(container => {
            container.classList.remove('swapped');
        });
    } else {
        // Switch to original image
        if (window.initialEdit && window.initialEdit.image) {
            const originalImageUrl = `/images/${window.initialEdit.image.upscaled || window.initialEdit.image.original}`;
            previewImage.src = originalImageUrl;
            manualPreviewSeedNumber.textContent = window.initialEdit.source.seed;
            updateSproutSeedButtonFromPreviewSeed();
            
            // Update blurred background
            updateBlurredBackground(originalImageUrl);
            
            // Update global variables to reflect the original image
            window.currentManualPreviewImage = window.initialEdit.image;
            // Director new session functionality is always available
            // Try to find the index of the original image
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === window.initialEdit.image.upscaled || 
                           img.original === window.initialEdit.image.original;
                });
            } else if (allImages && allImages.length > 0) {
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === window.initialEdit.image.upscaled || 
                           img.original === window.initialEdit.image.original;
                });
            }
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;
        }
        imageContainers.forEach(container => {
            container.classList.add('swapped');
        });
    }
}

// Function to reset manual modal preview
function resetManualPreview() {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const seedBtn = document.getElementById('manualPreviewSeedBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');

    if (previewImage && previewPlaceholder) {
        // Hide the image and show placeholder
        previewImage.classList.add('hidden');
        previewImage.src = '';
        previewImage.dataset.blobUrl = '';
        previewPlaceholder.classList.remove('hidden');

        // Hide original image and reset dual mode
        if (originalImage) {
            originalImage.classList.add('hidden');
            originalImage.src = '';
            originalImage.onclick = null;
            originalImage.classList.add('hidden');
        }
        if (imageContainers) {
            imageContainers.forEach(container => {
                container.classList.remove('dual-mode', 'original-hidden', 'swapped');
            });
        }

        // Hide control buttons
        if (downloadBtn) downloadBtn.classList.add('hidden');
        if (manualPreviewCopyBtn) manualPreviewCopyBtn.classList.add('hidden');
        if (upscaleBtn) upscaleBtn.classList.add('hidden');
        if (rerollBtn) rerollBtn.classList.add('hidden');
        if (variationBtn) variationBtn.classList.add('hidden');
        if (manualPreviewLoadBtn) manualPreviewLoadBtn.classList.add('hidden');
        if (manualPreviewPinBtn) manualPreviewPinBtn.classList.add('hidden');
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) scrapBtn.classList.add('hidden');
        if (seedBtn) seedBtn.classList.add('hidden');
        if (deleteBtn) deleteBtn.classList.add('hidden');
        hideManualPreview();

        // Clear stored seed and current image
        window.lastGeneratedSeed = null;
        window.lastGeneration = null;
        manualPreviewSeedNumber.textContent = '---';
        sproutSeedBtn.classList.remove('available');
        updateSproutSeedButtonFromPreviewSeed();
        window.currentManualPreviewImage = null;
        window.currentManualPreviewIndex = null;
        // Director new session functionality is always available
        
        // Reset blurred backgrounds
        const bg1 = document.getElementById('manualPreviewBlurBackground1');
        const bg2 = document.getElementById('manualPreviewBlurBackground2');
        if (bg1) {
            bg1.style.backgroundImage = 'none';
            bg1.style.opacity = '0';
        }
        if (bg2) {
            bg2.style.backgroundImage = 'none';
            bg2.style.opacity = '0';
        }

        // Disable navigation buttons
        updateManualPreviewNavigation();

        // Force preview animation back to default state
        if (generationAnimationActive) {
            stopPreviewAnimation();
        }
        // Ensure animation container is reset to default state
        if (previewContainer) {
            previewContainer.classList.remove('preview-animation-active', 'preview-fade-out');
        }
        if (previewStars) {
            previewStars.classList.add('hidden');
            previewStars.style.opacity = '0';
        }
        if (previewBackgroundLines) {
            previewBackgroundLines.classList.add('hidden');
            previewBackgroundLines.classList.remove('fadeOut');
        }
        if (previewForegroundLines) {
            previewForegroundLines.classList.add('hidden');
            previewForegroundLines.classList.remove('fadeOut');
        }
    }
}

// Function to update manual preview navigation buttons
function updateManualPreviewNavigation() {
    const prevBtn = document.getElementById('manualPreviewPrevBtn');
    const nextBtn = document.getElementById('manualPreviewNextBtn');

    if (!prevBtn || !nextBtn) return;

    // Disable both buttons if no current image or no gallery
    if (!window.currentManualPreviewImage || !allImages || allImages.length === 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    // Find current image index in gallery using filename comparison
    const currentFilename = window.currentManualPreviewImage.original || window.currentManualPreviewImage.filename;
    const currentIndex = findTrueImageIndexInGallery(currentFilename);

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
    if (!window.currentManualPreviewImage) return;
    // Use WebSocket to get image by index
    if (!window.wsClient || !window.wsClient.isConnected()) {
        throw new Error('WebSocket not connected');
    }

    try {
        // Show navigation loading overlay
        showManualPreviewNavigationLoading(true);
        
        // Get current view type based on current gallery view
        const viewType = currentGalleryView || 'images';
        
        // Determine navigation approach based on search mode
        let newImage, newIndex;
        
        if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
            // We're in search mode - navigate through filtered results (same logic as lightbox)
            const currentFilename = window.currentManualPreviewImage.original || window.currentManualPreviewImage.filename;
            
            // Use the filtered allImages array for navigation (this contains the filtered results)
            const navigationArray = allImages;
            const currentImageIndex = navigationArray.findIndex(img => {
                const imgFilename = img.filename || img.original || img.upscaled;
                return imgFilename === currentFilename;
            });
            
            if (currentImageIndex === -1) {
                console.warn('Current image not found in filtered results');
                showManualPreviewNavigationLoading(false);
                return;
            }
            
            // Calculate new index within the filtered results
            let newIndex = currentImageIndex + direction;
            
            // Handle wrapping within filtered results
            if (newIndex < 0) {
                newIndex = navigationArray.length - 1;
            } else if (newIndex >= navigationArray.length) {
                newIndex = 0;
            }
            
            // Get the new image from the filtered results
            const newImageObj = navigationArray[newIndex];
            if (!newImageObj) {
                console.warn('No image found at filtered index:', newIndex);
                showManualPreviewNavigationLoading(false);
                return;
            }
            
            // Construct the image object for the preview (same as lightbox)
            let filenameToShow = newImageObj.original;
            if (newImageObj.upscaled) {
                filenameToShow = newImageObj.upscaled;
            }
            
            const imageToShow = {
                filename: filenameToShow,
                base: newImageObj.base,
                upscaled: newImageObj.upscaled,
                metadata: newImageObj.metadata
            };
            
            // Update the preview with the new image directly (like lightbox does)
            await updateManualPreviewDirectly(imageToShow, newImageObj.metadata);
            
        } else {
            // Normal mode - use WebSocket API with global indices
            const currentIndex = window.currentManualPreviewIndex ?? 0;
            newIndex = currentIndex + direction;

            // Check for negative index
            if (newIndex < 0) {
                console.warn('Cannot navigate before first image');
                showManualPreviewNavigationLoading(false);
                return;
            }
            
            // Request the image at the new index from the server
            newImage = await window.wsClient.requestImageByIndex(newIndex, viewType);
            
            if (!newImage) {
                console.warn('No image found at index:', newIndex);
                showManualPreviewNavigationLoading(false);
                return;
            }

            // Update the current index
            window.currentManualPreviewIndex = newIndex;
            window.currentManualPreviewImage = newImage;
            // Director new session functionality is always available

            // Update the preview with the new image and metadata
            await updateManualPreview(newIndex, null, newImage.metadata);
        }
        
        // Check if we're navigating to index 0 (last generation) or a different image
        // Note: In search mode, index 0 refers to the first filtered result, not necessarily the global first image
        if (newIndex === 0 && !window.originalAllImages) {
            // For global index 0 in normal mode, switch preview to the right side (last generation is always on the right)
            // Clear any stored navigation original image since we're back to the main image
            window.navigationOriginalImage = null;
            
            // Remove swapped state to show the main image on the right
            document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(container => {
                container.classList.remove('swapped');
            });
        } else {
            // For other indices or in search mode, move placeholder to left side and show last generation on right
            // First, store the current image as the "original" for comparison
            if (window.currentManualPreviewImage) {
                window.navigationOriginalImage = {
                    image: window.currentManualPreviewImage,
                    seed: window.currentManualPreviewImage.metadata?.seed
                };
            }
            
            // Mark as swapped to show the new image on the left
            document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(container => {
                container.classList.add('swapped');
            });
        }
        
    } catch (error) {
        console.error('Failed to navigate manual preview:', error);
        showError('Failed to navigate to next image: ' + error.message);
    } finally {
        // Hide navigation loading overlay
        showManualPreviewNavigationLoading(false);
    }
}

// Function to restore the original image when navigating back
async function restoreOriginalImage() {
    if (window.navigationOriginalImage) {
        const previewImage = document.getElementById('manualPreviewImage');
        const originalImage = document.getElementById('manualPreviewOriginalImage');
        const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
        
        if (previewImage && originalImage) {
            // Restore the original image to the main preview
            const imageUrl = `/images/${window.navigationOriginalImage.image.original || window.navigationOriginalImage.image.filename}`;
            previewImage.src = imageUrl;
            
            // Update blurred background
            updateBlurredBackground(imageUrl);
            
            // Update the seed display to show the original image's seed
            const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
            if (manualPreviewSeedNumber) {
                manualPreviewSeedNumber.textContent = window.navigationOriginalImage.seed || '---';
                if (window.navigationOriginalImage.seed) {
                    window.lastGeneratedSeed = window.navigationOriginalImage.seed;
                    sproutSeedBtn.classList.add('available');
                } else {
                    window.lastGeneratedSeed = null;
                    sproutSeedBtn.classList.remove('available');
                }
                updateSproutSeedButtonFromPreviewSeed();
            }

            if (window.navigationOriginalImage.image.filename) {
                const metadata = await getImageMetadata(window.navigationOriginalImage.image.filename);
                window.lastGeneration = metadata;
                window.lastGeneration.filename = window.navigationOriginalImage.image.filename;
            }
            
            // Remove swapped state to show original image on the right
            imageContainers.forEach(container => {
                container.classList.remove('swapped');
            });
            
            // Update global variables to reflect the restored original image
            window.currentManualPreviewImage = window.navigationOriginalImage.image;
            // Director new session functionality is always available
            // Try to find the index of the restored image
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === window.navigationOriginalImage.image.upscaled || 
                           img.original === window.navigationOriginalImage.image.original ||
                           img.filename === window.navigationOriginalImage.image.filename;
                });
            } else if (allImages && allImages.length > 0) {
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === window.navigationOriginalImage.image.upscaled || 
                           img.original === window.navigationOriginalImage.image.original ||
                           img.filename === window.navigationOriginalImage.image.filename;
                });
            }
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;
            
            // Clear the stored navigation original image
            window.navigationOriginalImage = null;
        }
    }
}

async function handleManualGeneration(e) {
    e.preventDefault();

    // Set generating state
    isGenerating = true;
    updateManualGenerateBtnState();

    const isImg2Img = window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.isVariationEdit);
    const values = collectManualFormValues();

    // Helper: Validate required fields
    function validateFields(requiredFields, msg) {
        for (const field of requiredFields) {
            if (field === 'resolutionValue') {
                // Special handling for resolution: check for either resolutionValue or custom dimensions
                if (!values[field] && (!values.width || !values.height)) {
                    showError(msg);
                    return false;
                }
            } else if (!values[field]) {
                showError(msg);
                return false;
            }
        }
        return true;
    }

    // Validate required fields for both paths
    if (!validateFields(['model', 'prompt', 'resolutionValue'], 'Please fill in all required fields (Model, Prompt, Resolution)')) {
        isGenerating = false;
        updateManualGenerateBtnState();
        return;
    }

    // Prepare base requestBody (shared between both paths)
    const requestBody = {
        prompt: values.prompt,
        steps: values.steps,
        guidance: values.guidance,
        rescale: values.rescale,
        allow_paid: forcePaidRequest,
        workspace: activeWorkspace
    };

    // Process resolution to determine if it's custom or predefined
    const resolutionData = processResolutionValue(values.resolutionValue);
    if (resolutionData.isCustom) {
        requestBody.width = resolutionData.width;
        requestBody.height = resolutionData.height;
    } else {
        requestBody.resolution = resolutionData.resolution;
    }

    // Add img2img specific parameters if applicable
    if (isImg2Img) {
        requestBody.strength = parseFloat(manualStrengthValue.value) || 0.8;
        requestBody.noise = parseFloat(manualNoiseValue.value) || 0.1;

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
    }

    // Add shared fields and preset name
    addSharedFieldsToRequestBody(requestBody, values);
    if (values.presetName) requestBody.preset = values.presetName;

    // Check if this requires paid credits and user hasn't already allowed paid
    const cost = calculateCreditCost(requestBody);
    if (cost > 0 && !forcePaidRequest) {
        const confirmed = await showCreditCostDialog(cost, e);
        
        if (!confirmed) {
            isGenerating = false;
            updateManualGenerateBtnState();
            return;
        }
        
        // Set allow_paid to true for this request only (don't change UI)
        requestBody.allow_paid = true;
        forcePaidRequest = true;
        paidRequestToggle.setAttribute('data-state', 'on');
    }

    // Show loading and hide modal
    hideManualModal(undefined, true);
    showManualLoading(true, 'Generating Image...');
    
    // Show the manual preview when generation starts
    if (typeof showManualPreview === 'function') {
        showManualPreview();
    }


    const generationParams = {
        model: values.model.toLowerCase(),
        ...requestBody
    };

    try {
        // Use WebSocket for image generation
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const result = await window.wsClient.generateImage(generationParams);
        
        if (result) {
            const { image, filename, seed } = result;
            
            // Convert base64 to blob
            const byteCharacters = atob(image);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });

            if (filename) {
                const metadata = await getImageMetadata(filename);
                window.lastGeneration = metadata;
                window.lastGeneration.filename = filename;
                // Director new session functionality is always available
            }
            
            // Extract seed if available
            if (seed) {
                window.lastGeneratedSeed = parseInt(seed);
                sproutSeedBtn.classList.add('available');
            }

            // Use the universal handleImageResult function
            await handleImageResult(blob, 'Image generated successfully!', undefined, seed || values.seed);
        } else {
            throw new Error('Invalid response from WebSocket');
        }
            
    } catch (error) {
        hideManualModal(undefined, true);
        console.error(`Image generation error:`, error);
        showError(`Image generation failed. Please try again.`);
    } finally {
        stopPreviewAnimation();
        showManualLoading(false);
        isGenerating = false;
        updateManualGenerateBtnState();
    }
}

// Save manual preset using WebSocket
async function saveManualPreset(presetName, config) {
    try {
        // Use WebSocket for preset saving
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.savePreset(presetName, config);
        
        // Handle the response properly
        if (result && result.data && result.data.message) {
            showGlassToast('success', null, result.data.message);
        } else if (result && result.message) {
            showGlassToast('success', null, result.message);
        } else {
            showGlassToast('success', null, `Preset "${presetName}" saved successfully`);
        }

        // Refresh the preset list
        await loadOptions();

        updateGenerateButton();
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

    const isImg2Img = window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.isVariationEdit);
    const values = collectManualFormValues();

    // Helper: Validate required fields
    function validateFields(requiredFields, msg) {
        for (const field of requiredFields) {
            if (field === 'resolutionValue') {
                // Special handling for resolution: check for either resolutionValue or custom dimensions
                if (!values[field] && (!values.width || !values.height)) {
                    showError(msg);
                    return false;
                }
            } else if (!values[field]) {
                showError(msg);
                return false;
            }
        }
        return true;
    }

    // Validate required fields for both paths
    if (!validateFields(['model', 'prompt', 'resolutionValue'], 'Please fill in all required fields (Model, Prompt, Resolution)')) return;

    // Prepare base requestBody (shared between both paths)
    const requestBody = {
        prompt: values.prompt,
        steps: values.steps,
        guidance: values.guidance,
        rescale: values.rescale,
        allow_paid: forcePaidRequest,
        workspace: activeWorkspace
    };

    // Process resolution to determine if it's custom or predefined
    const resolutionData = processResolutionValue(values.resolutionValue);
    if (resolutionData.isCustom) {
        requestBody.width = resolutionData.width;
        requestBody.height = resolutionData.height;
    } else {
        requestBody.resolution = resolutionData.resolution;
    }

    // Add img2img specific parameters if applicable
    if (isImg2Img) {
        requestBody.strength = parseFloat(manualStrengthValue.value) || 0.8;
        requestBody.noise = parseFloat(manualNoiseValue.value) || 0.1;

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
    }

    // Add shared fields and preset name
    addSharedFieldsToRequestBody(requestBody, values);
    if (values.presetName) requestBody.preset = values.presetName;

    const generationParams = {
        model: values.model.toLowerCase(),
        ...requestBody
    };
    

    await saveManualPreset(presetName, generationParams);
}

// PRESET AUTOCOMPLETE SYSTEM - Move to presetAutocompleteManager.js or integrate with existing autocompleteUtils.js
// This system handles preset autocomplete functionality and suggestions
// Includes functions: handlePresetAutocompleteInput, handlePresetAutocompleteKeydown,
// showPresetAutocompleteSuggestions, updatePresetAutocompleteSelection, updatePresetAutocompleteSelection,
// hidePresetAutocomplete, hideCharacterAutocomplete, transferRandomPrompt, etc.
// Note: Check autocompleteUtils.js for existing autocomplete functions before moving

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
        
        // Use WebSocket for preset search
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
        generatePresetBtn.disabled = true;
        return;
    }

    if (selectedValue.startsWith('preset:')) {
        generatePresetBtn.disabled = false;
    } else {
        generatePresetBtn.disabled = true;
    }   
}

// IMAGE GENERATION SYSTEM - Move to imageGenerationManager.js
// This system handles image generation, result processing, and related operations
// Includes functions: generateImage, handleImageResult, downloadImage, deleteImage,
// deleteManualPreviewImage, createConfetti, showManualLoading, showManualPreviewNavigationLoading,
// showError, showErrorSubHeader, hideErrorSubHeader, handleAuthError, etc.

// Generate image
async function generateImage(event = null) {
    closeSubMenu();
    
    // Check if queue is blocked
    if (isQueueStopped || isQueueProcessing) {
        showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait for the queue to clear.', false, 5000);
        return;
    }
    
    // Set generating state
    isGenerating = true;
    updateManualGenerateBtnState();
    
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
    const isInModal = !document.getElementById('manualModal').classList.contains('hidden');
    
    let toastId;
    let progressInterval;
    
    if (!isInModal) {
        // Use glass toast with progress when not in modal
        toastId = showGlassToast('info', 'Generating Image', 'Generating image...', true, false, '<i class="nai-sparkles"></i>');
        
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
        // Generate image using WebSocket
        const result = await window.wsClient.generatePreset(presetName, window.currentWorkspace || null);
        
        // Extract data from the standard response format
        const filename = result.filename;
        const seed = result.seed;

        // Update the existing toast to show completion
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Image Generated',
            message: 'Image generated successfully and added to gallery',
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
        
        createConfetti();
        
        // Refresh gallery to show the new image
        await loadGallery(true);
        
        if (manualModal.classList.contains('hidden')) {
            // Find the generated image in the gallery
            const found = allImages.find(img => img.original === filename || img.upscaled === filename);
            if (found) {
                // Construct proper image object with filename property
                const imageToShow = {
                    filename: filename,
                    base: found.base,
                    original: found.original,
                    upscaled: found.upscaled
                };
                showLightbox(imageToShow);
            }
        }

    } catch (error) {
        console.error('Generation error:', error);
        // Update the existing toast to show error
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Generation Failed',
            message: error.message,
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
    } finally {
        // Reset generating state
        isGenerating = false;
        updateManualGenerateBtnState();
        
        // Clear progress and loading states
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        if (isInModal) {
            showManualLoading(false);
        }
    }
}

function initializeManualPreviewLightbox() {
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const image = document.getElementById('manualPreviewImage');

    if (!imageContainer || !image) return;
    
    // Only register event listeners if there's actually an image to preview
    if (window.currentManualPreviewImage && !image.classList.contains('hidden')) {
        registerManualPreviewEventListeners();
    } else {
        // Deregister event listeners if there's no image to prevent errors
        deregisterManualPreviewEventListeners();
    }
}

// Prevent multiple lightbox openings
let isOpeningLightbox = false;

function handleManualPreviewClick(e) {
    e.preventDefault();
    
    // Prevent multiple rapid calls
    if (isOpeningLightbox) {
        return;
    }
    
    // Check if we have a current manual preview image
    if (!window.currentManualPreviewImage) {
        console.warn('No current manual preview image to open in lightbox');
        return;
    }
    
    // Check if the image is actually visible
    const image = document.getElementById('manualPreviewImage');
    if (!image || image.classList.contains('hidden')) {
        console.warn('Preview image is not visible');
        return;
    }
    
    // Use the current manual preview index that was set by the update functions
    let imageIndex = window.currentManualPreviewIndex;
    
    // If we have a valid index, use it directly (trust the update functions)
    if (imageIndex !== null && imageIndex !== undefined && imageIndex >= 0) {
        // Open lightbox with the index set by the update functions
        if (window.showLightbox) {
            isOpeningLightbox = true;
            try {
                window.showLightbox(imageIndex);
            } finally {
                // Reset flag after a delay to allow lightbox to open
                setTimeout(() => {
                    isOpeningLightbox = false;
                }, 1000);
            }
        } else {
            console.warn('showLightbox function not available');
        }
    } else {
        // If no valid index, try to find the image by filename in the gallery
        let foundIndex = -1;
        
        if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
            // Search mode - use filtered results
            foundIndex = window.originalAllImages.findIndex(img => {
                return img.upscaled === window.currentManualPreviewImage.upscaled || 
                       img.original === window.currentManualPreviewImage.original ||
                       img.filename === window.currentManualPreviewImage.filename;
            });
        } else if (allImages && allImages.length > 0) {
            // Normal mode - use current allImages
            foundIndex = allImages.findIndex(img => {
                return img.upscaled === window.currentManualPreviewImage.upscaled || 
                       img.original === window.currentManualPreviewImage.original ||
                       img.filename === window.currentManualPreviewImage.filename;
            });
        }
        
        if (foundIndex !== -1) {
            // Found the image in the gallery, open lightbox at that index
            if (window.showLightbox) {
                isOpeningLightbox = true;
                try {
                    window.showLightbox(foundIndex);
                } finally {
                    // Reset flag after a delay to allow lightbox to open
                    setTimeout(() => {
                        isOpeningLightbox = false;
                    }, 1000);
                }
            } else {
                console.warn('showLightbox function not available');
            }
        } else {
            // Image not found in gallery, open as standalone image
            if (window.showLightbox) {
                const imageUrl = window.currentManualPreviewImage.upscaled || 
                               window.currentManualPreviewImage.original || 
                               window.currentManualPreviewImage.filename;
                isOpeningLightbox = true;
                try {
                    window.showLightbox({ url: `/images/${imageUrl}` });
                } finally {
                    // Reset flag after a delay to allow lightbox to open
                    setTimeout(() => {
                        isOpeningLightbox = false;
                    }, 1000);
                }
            } else {
                console.warn('showLightbox function not available');
            }
        }
    }
}

// Throttle scroll events to prevent rapid-fire calls
let lastOpenLightboxScrollTime = 0;
const SCROLL_THROTTLE_MS = 500; // 500ms throttle

function handleManualPreviewScroll(e) {
    // Only trigger on scroll up (negative deltaY)
    if (e.deltaY < 0) {
        e.preventDefault();
        
        // Throttle scroll events to prevent rapid calls
        const now = Date.now();
        if (now - lastOpenLightboxScrollTime < SCROLL_THROTTLE_MS) {
            return; // Skip if called too recently
        }
        lastOpenLightboxScrollTime = now;
        
        // Use a small delay to ensure scroll event has settled
        setTimeout(() => {
            handleManualPreviewClick(e);
        }, 100);
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
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
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


        // Use WebSocket bulk delete request
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const result = await window.wsClient.deleteImagesBulk([filenameToDelete]);

        if (result.successful > 0) {
            showGlassToast('success', null, 'Image deleted!', false, 5000, '<i class="fas fa-trash"></i>');

            // Close lightbox
            hideLightbox();

            // Remove image from gallery and add placeholder
            removeImageFromGallery(image);
        } else {
            throw new Error('Delete failed');
        }

    } catch (error) {
        console.error('Delete error:', error);
        showError('Failed to delete image: ' + error.message);
    }
}

async function deleteManualPreviewImage() {
    if (!window.currentManualPreviewImage) {
        showError('No image to delete');
        return;
    }

    try {
        // Show navigation loading overlay
        showManualPreviewNavigationLoading(true);
        
        // Determine which filename to use for deletion
        let filenameToDelete = null;

        // For regular images, prioritize original, then upscaled
        if (window.currentManualPreviewImage.original) {
            filenameToDelete = window.currentManualPreviewImage.original;
        } else if (window.currentManualPreviewImage.upscaled) {
            filenameToDelete = window.currentManualPreviewImage.upscaled;
        }

        if (!filenameToDelete) {
            throw new Error('No filename available for deletion');
        }

        // Use WebSocket bulk delete request
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        const result = await window.wsClient.deleteImagesBulk([filenameToDelete]);

        if (result.successful > 0) {
            // Get the current index and view type
            const currentIndex = window.currentManualPreviewIndex ?? 0;
            const viewType = currentGalleryView || 'images';

            // Request the same image at the current index (which will now be a different image)
            try {
                const newImage = await window.wsClient.requestImageByIndex(currentIndex, viewType);
                
                if (newImage) {
                    // Update the preview with the new image at the same index
                    await updateManualPreview(currentIndex, null, newImage.metadata);
                    showGlassToast('success', null, 'Image deleted');
                } else {
                    // No image at this index anymore, try the previous index
                    if (currentIndex > 0) {
                        const prevImage = await window.wsClient.requestImageByIndex(currentIndex - 1, viewType);
                        if (prevImage) {
                            await updateManualPreview(currentIndex - 1, null, prevImage.metadata);
                            showGlassToast('success', null, 'Image deleted');
                        } else {
                            resetManualPreview();
                            showGlassToast('success', null, 'Image deleted');
                        }
                    } else {
                        resetManualPreview();
                        showGlassToast('success', null, 'Image deleted');
                    }
                }
            } catch (error) {
                console.warn('Failed to load new image after delete:', error);
                resetManualPreview();
                showGlassToast('success', null, 'Image deleted');
            }
        } else {
            throw new Error('Delete failed');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showError('Failed to delete image: ' + error.message);
    } finally {
        // Hide navigation loading overlay
        showManualPreviewNavigationLoading(false);
    }

    // Refresh gallery after processing is complete
    loadGallery(true);
}

// Create confetti effect
function createConfetti() {
    // Multi-colored confetti palette with vibrant colors
    const colors = [
        '#ff4500', '#ff6347', '#ff8c00', '#ffa500', '#ff6b35', '#ff7f50', // Orange/Red variants
        '#ff1493', '#ff69b4', '#ffb6c1', '#ffc0cb', '#db7093', '#c71585', // Pink variants
        '#00ff00', '#32cd32', '#90ee90', '#98fb98', '#00fa9a', '#00ff7f', // Green variants
        '#4169e1', '#1e90ff', '#00bfff', '#87ceeb', '#87cefa', '#b0e0e6', // Blue variants
        '#9370db', '#8a2be2', '#9932cc', '#ba55d3', '#da70d6', '#ee82ee', // Purple variants
        '#ffff00', '#ffd700', '#ffeb3b', '#f0e68c', '#bdb76b', '#f4a460', // Yellow/Gold variants
        '#ff4500', '#ff6347', '#ff8c00', '#ffa500', '#ff6b35', '#ff7f50'  // Additional orange/red
    ];
    const shapes = ['rect', 'circle', 'triangle'];

    // Increase the number of confetti pieces for more intensity
    const totalPieces = 175; // Added 25 more pieces

    for (let i = 0; i < totalPieces; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';

            // Random position across the entire screen width
            confetti.style.left = Math.random() * 100 + 'vw';

            // Random color from expanded palette
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

            // Slower animation duration and longer delay for more screen time
            const duration = 4.5 + Math.random() * 3; // 4.5 to 7.5 seconds (slower)
            const delay = Math.random() * 1.5; // 0 to 1.5 seconds delay (longer)
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
        }, i * 25); // Slightly increased delay between pieces for better distribution
    }
}

// Show manual modal loading overlay
function showManualLoading(show, message = 'Generating Image...') {
    if (!manualModal.classList.contains('hidden') && show && isPreviewAnimationAvailable()) {
        // Start preview animation for image generation
        startPreviewAnimation();
        return;
    } else if (show && isPreviewAnimationAvailable()) {
        // Stop preview animation when generation completes
        stopPreviewAnimation();
        return;
    }

    // FALLBACK: If animation system fails, use manual loading overlay for critical operations
    if (!manualModal.classList.contains('hidden') && !isPreviewAnimationAvailable()) {
        console.warn('Animation system not available, using manual loading overlay');
        if (manualLoadingOverlay) {
            manualLoadingOverlay.classList.remove('hidden');
            manualLoadingOverlay.classList.remove('return');
            const loadingText = manualLoadingOverlay.querySelector('p');
            if (loadingText) {
                loadingText.textContent = message;
            }
        }
    }
}

// Show manual preview navigation loading overlay
function showManualPreviewNavigationLoading(show) {
    const navigationLoadingOverlay = document.getElementById('manualPreviewNavigationLoading');
    
    if (navigationLoadingOverlay) {
        if (show) {
            navigationLoadingOverlay.classList.remove('hidden');
        } else {
            navigationLoadingOverlay.classList.add('hidden');
        }
    }
}

// Show error message (simple glass toast)
function showError(message) {
    showGlassToast('error', null, message);
}

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

// Debounced resize handler
async function handleResize() {
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }

    resizeTimeout = setTimeout(() => {
        // Recalculate rows based on new viewport dimensions
        const newRows = calculateGalleryRows();
        const galleryToggleGroup = document.getElementById('galleryToggleGroup');
        const newImagesPerPage = parseInt(galleryToggleGroup?.dataset?.columns || 5) * newRows;

        // Only update if the number of images per page has changed
        if (newImagesPerPage !== imagesPerPage || newRows !== galleryRows) {
            galleryRows = newRows;
            imagesPerPage = newImagesPerPage;
        }

        updateGalleryItemToolbars();
        updateGalleryPlaceholders(); // Update placeholders after resize
        updateGalleryColumnsFromLayout();
        updateMenuBarHeight();
        
        // Recalculate previewRatio if manual modal is open
        if (manualModal && !manualModal.classList.contains('hidden')) {
            calculatePreviewRatio();
        }
    }, 250); // 250ms delay
}

async function updateMenuBarHeight() {
    const menubarStyle = getComputedStyle(document.getElementById('main-menu-bar'));
    const menuBarHeight = menubarStyle?.height ? `calc(${menubarStyle.height} + ${menubarStyle.marginTop})` : '8.5em';
    document.body.style.setProperty('--menubar-height', menuBarHeight);
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
        metadataDialog.classList.add('hidden');
    }

    // Hide expanded sections
    if (dialogPromptExpanded) dialogPromptExpanded.classList.add('hidden');
    if (dialogUcExpanded) dialogUcExpanded.classList.add('hidden');
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
                if (nameCell) nameCell.classList.remove('hidden');
            } else {
                if (nameCell) nameCell.classList.add('hidden');
            }
        } else {
            typeElement.textContent = '-';
            const nameCell = nameElement.closest('.metadata-cell');
            if (nameCell) nameCell.classList.add('hidden');
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
                seed1Cell.classList.remove('hidden');
                seed2Cell.classList.remove('hidden');
            } else {
                // Single seed - hide seed 2 and rename seed 1
                seed1Label.textContent = 'Seed';
                seed1Element.textContent = metadata.layer1Seed || metadata.seed || '-';
                seed1Cell.classList.remove('hidden');
                seed2Cell.classList.add('hidden');
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
        if (dialogPromptExpanded.classList.contains('hidden')) {
            dialogPromptExpanded.classList.remove('hidden');
            dialogUcExpanded.classList.add('hidden');
        } else {
            dialogPromptExpanded.classList.add('hidden');
        }
    } else if (type === 'uc' && dialogUcExpanded && dialogPromptExpanded) {
        if (dialogUcExpanded.classList.contains('hidden')) {
            dialogUcExpanded.classList.remove('hidden');
            dialogPromptExpanded.classList.add('hidden');
        } else {
            dialogUcExpanded.classList.add('hidden');
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
        if (nameCell) nameCell.classList.remove('hidden');
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
            seed1Cell.classList.remove('hidden');
            seed2Cell.classList.remove('hidden');
        }
    }

    // Hide prompt/UC buttons
    const promptBtn = document.getElementById('promptBtn');
    const ucBtn = document.getElementById('ucBtn');
    if (promptBtn) promptBtn.classList.add('hidden');
    if (ucBtn) ucBtn.classList.add('hidden');

    // Hide expanded sections
    const expandedSections = document.querySelectorAll('.metadata-expanded');
    expandedSections.forEach(section => {
        section.classList.add('hidden');
    });
}

// Clear seed function
function clearSeed() {
    if (manualSeed && manualSeed.value) {
        manualSeed.value = '';
        manualSeed.focus();
        
        // Reset sprout seed button state if it was active
        if (sproutSeedBtn && sproutSeedBtn.getAttribute('data-state') === 'off') {
            sproutSeedBtn.setAttribute('data-state', 'on');
            manualSeed.disabled = false;
        }
        
        // Update placeholder to show the seed value if available, or "Random" if not
        if (window.lastLoadedSeed) {
            manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
        } else {
            manualSeed.placeholder = 'Randomize';
        }
    } else {
        setSeedInputGroupState(false);
    }
}

function updateSproutSeedButton() {
    if (sproutSeedBtn) {
        if (window.lastLoadedSeed) {
            sproutSeedBtn.classList.remove('hidden');
            // Update placeholder to show the seed value
            if (manualSeed) {
                manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
            }
        } else {
            sproutSeedBtn.classList.add('hidden');
            // Reset toggle state when no seed is available
            sproutSeedBtn.setAttribute('data-state', 'on');
            // Update placeholder to show "Random"
            if (manualSeed) {
                manualSeed.placeholder = 'Randomize';
            }
        }
    }
}

function updateSproutSeedButtonFromPreviewSeed() {
    if (sproutSeedBtn) {
        const seedValue = manualPreviewSeedNumber.textContent;
        if (seedValue && seedValue !== '---') {
            // Enable the sprout seed button and show it
            sproutSeedBtn.classList.remove('hidden');
            // Set the lastLoadedSeed so the button can function
            window.lastLoadedSeed = parseInt(seedValue);
            
            // Update placeholder to show the seed value
            if (manualSeed) {
                manualSeed.placeholder = seedValue || 'Randomize';
            }
            
            // Check if the button is currently in 'on' state
            const currentState = sproutSeedBtn.getAttribute('data-state');
            if (currentState === 'off') {
                // If button is active, update the seed input value
                if (manualSeed) {
                    manualSeed.value = window.lastLoadedSeed;
                }
            } else {
                // Reset button state to off initially
                sproutSeedBtn.setAttribute('data-state', 'on');
            }
        } else {
            // Hide the button when no seed is available
            sproutSeedBtn.classList.add('hidden');
            sproutSeedBtn.setAttribute('data-state', 'on');
            // Clear the lastLoadedSeed
            window.lastLoadedSeed = null;
            
            // Update placeholder to show "Random"
            if (manualSeed) {
                manualSeed.placeholder = 'Randomize';
            }
        }
    }
}

function toggleSproutSeed() {
    if (!sproutSeedBtn || !window.lastLoadedSeed) return;

    const currentState = sproutSeedBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    sproutSeedBtn.setAttribute('data-state', newState);

    if (newState === 'off') {
        // Set the seed value and disable the field
        manualSeed.value = window.lastLoadedSeed;
        setSeedInputGroupState(true);
        manualSeed.disabled = true;
        // Hide the clear seed button
        if (clearSeedBtn) clearSeedBtn.classList.add('hidden');
        // Update placeholder to show the seed value
        if (manualSeed) {
            manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
        }
    } else {
        // Clear the seed value and enable the field, but don't hide the sprout button
        manualSeed.value = '';
        manualSeed.disabled = false;
        // Show the clear seed button
        if (clearSeedBtn) clearSeedBtn.classList.add('hidden');
        // Don't call setSeedInputGroupState(false) here as it would hide the sprout button
        // Update placeholder to show the seed value (since it's still available)
        if (manualSeed) {
            manualSeed.placeholder = window.lastLoadedSeed || 'Randomize';
        }
    }
}

// Add event listener for manualSampler to auto-set noise scheduler
async function fetchWithAuth(url, options = {}) {
    if (!(await ensureSessionValid())) {
        handleAuthError(new Error('Unauthorized access'), 'fetchWithAuth');
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

function showGlassToast(type, title, message, showProgress = false, timeout = 5000, customIcon = null, buttons = null) {
    const toastId = `toast-${++toastCounter}`;
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();

    const toast = document.createElement('div');
    const isSimple = !title || !message;
    toast.className = `glass-toast glass-toast-${type} ${showProgress ? 'upload-progress' : ''} ${isSimple ? 'simple' : ''}`;
    toast.id = toastId;

    // Use custom icon if provided, otherwise use default icon
    const icon = customIcon || getToastIcon(type, showProgress);

    // Generate buttons HTML if provided
    const buttonsElement = buttons ? generateButtonsHtml(buttons, toastId) : null;

    // If only message is provided (no title), create a simple one-line toast
    if (title && message) {
        // Full toast with title and message
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
        
        // Add buttons as DOM elements to preserve event handlers
        if (buttonsElement) {
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.appendChild(buttonsElement);
            }
        }
    } else {
        // Simple one-line toast (message only) - now with icon
        const messageText = title || message;
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-message">${messageText}</div>
                ${showProgress ? '<div class="toast-progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;
        
        // Add buttons as DOM elements to preserve event handlers
        if (buttonsElement) {
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.appendChild(buttonsElement);
            }
        }
    }

    toastContainer.prepend(toast);

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Auto-remove after timeout (unless it's a progress toast or timeout is false) 
    if (timeout !== false && !showProgress) {
        setTimeout(() => {
            removeGlassToast(toastId);
        }, timeout);
    }

    activeToasts.set(toastId, { type, title, message, showProgress, customIcon, buttons });
    return toastId;
}

function updateGlassToast(toastId, type, title, message, customIcon = null) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const icon = customIcon || getToastIcon(type);
    const isSimple = !title || !message;
    const messageText = title || message;

    // Preserve existing classes and only update necessary ones
    const existingClasses = toast.className.split(' ').filter(cls => 
        cls !== 'glass-toast' && 
        !cls.startsWith('glass-toast-') && 
        cls !== 'simple' && 
        cls !== 'upload-progress'
    );
    
    // Build new class list
    const newClasses = ['glass-toast', `glass-toast-${type}`];
    if (isSimple) newClasses.push('simple');
    if (existingClasses.includes('upload-progress')) newClasses.push('upload-progress');
    if (existingClasses.includes('show')) newClasses.push('show');
    
    toast.className = newClasses.join(' ');
    
    // Update icon
    const iconElement = toast.querySelector('.toast-icon');
    if (iconElement) {
        iconElement.innerHTML = icon;
    }

    if (isSimple) {
        // Simple toast - only update message
        const messageElement = toast.querySelector('.toast-message');
        if (messageElement) {
            messageElement.textContent = messageText;
        }
    } else {
        // Full toast - update both title and message
        const titleElement = toast.querySelector('.toast-title');
        const messageElement = toast.querySelector('.toast-message');
        
        if (titleElement) {
            titleElement.textContent = title;
        }
        if (messageElement) {
            messageElement.textContent = message;
        }
    }

    // Update stored data
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.type = type;
        stored.title = title;
        stored.message = message;
        stored.customIcon = customIcon;
        activeToasts.set(toastId, stored);
    }

}

function removeGlassToast(toastId) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    // Clean up button handlers for this toast
    for (const [buttonId, handler] of buttonHandlers.entries()) {
        if (handler.toastId === toastId) {
            buttonHandlers.delete(buttonId);
        }
    }

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

function generateButtonsHtml(buttons, toastId) {
    if (!buttons || !Array.isArray(buttons)) return '';
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'toast-buttons';
    
    buttons.forEach((button, index) => {
        const btn = document.createElement('button');
        btn.className = `toast-button btn-${button.type || 'secondary'}`;
        btn.textContent = button.text;
        btn.type = 'button'; // Prevent form submission
        
        if (button.onClick) {
            // Generate unique button ID
            const buttonId = nextButtonId++;
            
            // Store the button handler
            buttonHandlers.set(buttonId, {
                onClick: button.onClick,
                toastId: toastId,
                closeOnClick: button.closeOnClick
            });
            
            // Set onclick attribute to call global handler
            btn.setAttribute('onclick', `handleToastButtonClick(${buttonId})`);
            
            // Add data attributes for debugging
            btn.setAttribute('data-button-id', buttonId);
            btn.setAttribute('data-button-index', index);
            btn.setAttribute('data-toast-id', toastId);
        }
        
        buttonsContainer.appendChild(btn);
    });
    
    return buttonsContainer;
}

function updateGlassToastButtons(toastId, buttons) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    // Remove existing buttons
    const existingButtons = toast.querySelector('.toast-buttons');
    if (existingButtons) {
        existingButtons.remove();
    }

    // Add new buttons
    if (buttons && Array.isArray(buttons)) {
        const buttonsElement = generateButtonsHtml(buttons, toastId);
        const content = toast.querySelector('.toast-content');
        if (content && buttonsElement) {
            content.appendChild(buttonsElement);
        }
    }

    // Update stored data
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.buttons = buttons;
        activeToasts.set(toastId, stored);
    }
}

// Comprehensive toast update function that handles all aspects
function updateGlassToastComplete(toastId, options = {}) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const {
        type,
        title,
        message,
        customIcon,
        buttons,
        showProgress = null,
        timeout = null
    } = options;

    // Update basic content if provided
    if (type || title || message || customIcon) {
        updateGlassToast(toastId, type, title, message, customIcon);
    }

    // Update buttons if provided
    if (buttons !== undefined) {
        updateGlassToastButtons(toastId, buttons);
    }

    // Update progress state if provided
    if (showProgress !== null) {
        const progressElement = toast.querySelector('.toast-progress');
        if (showProgress && !progressElement) {
            // Add progress bar
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.insertAdjacentHTML('beforeend', '<div class="toast-progress"><div class="toast-progress-bar"></div></div>');
            }
            toast.classList.add('upload-progress');
        } else if (!showProgress && progressElement) {
            // Remove progress bar
            progressElement.remove();
            toast.classList.remove('upload-progress');
            
            // When removing progress, add close button and set default timeout
            const existingCloseBtn = toast.querySelector('.toast-close');
            if (!existingCloseBtn) {
                const closeBtn = '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';
                toast.insertAdjacentHTML('beforeend', closeBtn);
            }
            
            // Set default timeout for completed progress toasts
            const stored = activeToasts.get(toastId);
            if (stored) {
                if (stored.timeoutId) {
                    clearTimeout(stored.timeoutId);
                }
                stored.timeoutId = setTimeout(() => {
                    removeGlassToast(toastId);
                }, 5000); // 5 second default timeout
                activeToasts.set(toastId, stored);
            }
        }
    }

    // Update timeout if provided
    if (timeout !== null) {
        const stored = activeToasts.get(toastId);
        if (stored) {
            stored.timeout = timeout;
            activeToasts.set(toastId, stored);
            
            // Clear existing timeout and set new one
            if (stored.timeoutId) {
                clearTimeout(stored.timeoutId);
            }
            
            if (timeout !== false) {
                stored.timeoutId = setTimeout(() => {
                    removeGlassToast(toastId);
                }, timeout);
                activeToasts.set(toastId, stored);
            }
        }
    }

    // Ensure toast is visible
    if (!toast.classList.contains('show')) {
        toast.classList.add('show');
    }
}

// Test functions for toast system
let testProgressIntervals = new Map();
let vibeEncodingProgressIntervals = new Map();

function completeTestProgress(toastId) {
    const interval = testProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        testProgressIntervals.delete(toastId);
    }
    
    // Complete the progress to 100%
    updateGlassToastProgress(toastId, 100);
    
    // Update the toast to show completion using the unified function
    updateGlassToastComplete(toastId, {
        type: 'success',
        title: 'Test Complete',
        message: 'Progress completed!',
        customIcon: '<i class="nai-check"></i>',
        showProgress: false
    });
}

function completeAllTestProgress() {
    testProgressIntervals.forEach((interval, toastId) => {
        completeTestProgress(toastId);
    });
}

// Vibe encoding progress functions
function startVibeEncodingProgress(toastId) {
    let progress = 0;
    const interval = setInterval(() => {
        progress += 5; // Add 5% every 500ms
        updateGlassToastProgress(toastId, progress);
        
        if (progress >= 100) {
            clearInterval(interval);
            vibeEncodingProgressIntervals.delete(toastId);
        }
    }, 250); // Every 500ms
    
    vibeEncodingProgressIntervals.set(toastId, interval);
    return interval;
}

function completeVibeEncodingProgress(toastId, successMessage = 'Vibe encoding completed!') {
    const interval = vibeEncodingProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        vibeEncodingProgressIntervals.delete(toastId);
    }
    
    // Set progress to 100%
    updateGlassToastProgress(toastId, 100);
    
    // Update the toast to show completion
    setTimeout(() => {
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Vibe Created',
            message: successMessage,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
    }, 200); // Small delay to show 100% completion
}

function failVibeEncodingProgress(toastId, errorMessage = 'Vibe encoding failed') {
    const interval = vibeEncodingProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        vibeEncodingProgressIntervals.delete(toastId);
    }
    
    // Update the toast to show error
        updateGlassToastComplete(toastId, {
        type: 'error',
        title: 'Encoding Failed',
        message: errorMessage,
        customIcon: '<i class="nai-cross"></i>',
        showProgress: false
    });
}

let showSubscriptionExpirationToast = false;
async function checkSubscriptionExpiration() {
    const expiresAt = new Date(window.optionsData.user.subscription.expiresAt * 1000);
    const subTier = window.optionsData.user.subscription.tier;
    const subName = subTier === 3 ? 'Opus' : subTier === 2 ? 'Scroll' : subTier === 1 ? 'Tablet' : 'Enterprise';
    const now = new Date();
    const daysUntilExpiration = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    const renewalDateStr = expiresAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

    if (daysUntilExpiration <= 7 && daysUntilExpiration > 0) {
        if (!showSubscriptionExpirationToast) {
            let message = daysUntilExpiration === 1 
                ? `Your NovelAI ${subName} subscription renews tomorrow!` 
                : `Your NovelAI ${subName} subscription will renew in ${daysUntilExpiration} days! (${renewalDateStr})`;
            showGlassToast('warning', 'NovelAI Subscription Status', message, false, 15000);
            showSubscriptionExpirationToast = true;
        }
    }
}

let showFixedTrainingStepsToast = false;
async function checkFixedTrainingSteps() {
    if (!window.optionsData?.balance) {
        console.error('No balance data available');
        return;
    }

    const fixedSteps = window.optionsData.balance.fixedTrainingStepsLef || 0;
    const expiresAt = new Date(window.optionsData.user.subscription.expiresAt * 1000);
    const now = new Date();
    const daysUntilRenewal = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    const usePerDay = parseInt((fixedSteps / daysUntilRenewal).toFixed(0));    
    if (fixedSteps > 500 && daysUntilRenewal <= 15 && daysUntilRenewal > 0) {
        if (!showFixedTrainingStepsToast) {
            showGlassToast('info', 'Account Fixed Anlas Expiring', 
                `You have <i class="nai-anla"></i> ${fixedSteps} Fixed Anlas remaining.<br/>
                Consider using <i class="nai-anla"></i> ${usePerDay} Anlas per day in the next ${daysUntilRenewal} days.`, false, 60000, '<i class="nai-anla"></i>');
            showFixedTrainingStepsToast = true;
        }
    }
}

async function updateSubscriptionNotifications() {
    await checkSubscriptionExpiration();
    await checkFixedTrainingSteps();
}

// Upload multiple images to server
async function uploadImages(files) {
    if (files.length === 0) return;

    const toastId = showGlassToast('info', 'Uploading Images', `Starting upload of ${files.length} images...`, true);

    try {
        const uploadPromises = files.map(async (file, index) => {
            const base64 = await fileToBase64(file);
            const batchInfo = {
                currentIndex: index,
                totalCount: files.length
            };
            return window.wsClient.uploadWorkspaceImage(base64, activeWorkspace, file.name, batchInfo);
        });

        const results = await Promise.all(uploadPromises);
        
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.length - successCount;

        if (errorCount > 0) {
            updateGlassToastComplete(toastId, {
                type: 'warning',
                title: 'Upload Complete',
                message: `Successfully uploaded ${successCount} images, ${errorCount} failed`,
                customIcon: '<i class="fas fa-thumbtack"></i>',
                showProgress: false
            });
        } else {
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Upload Complete',
                message: `Successfully uploaded ${successCount} images`,
                customIcon: '<i class="fas fa-thumbtack"></i>',
                showProgress: false
            });
        }

        // Refresh gallery to show the new images - gallery updates are broadcast automatically by WebSocket
        setTimeout(async () => {
            await loadGallery();
        }, 1000);

    } catch (error) {
        console.error('Upload error:', error);
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Upload Failed',
            message: error.message,
            customIcon: '<i class="fas fa-thumbtack"></i>',
            showProgress: false
        });
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

        // Crop and update preview
        await cropImageToResolution();
        updateImageBiasOrientation();
        
        if (imageBiasHidden != null) imageBiasHidden.value = biasToUse.toString();
        await renderImageBiasDropdown(biasToUse.toString());
    
        // Set transformation type to upload (successful)
        updateTransformationDropdownState('upload', 'Upload');

        // Show transformation section content
        if (transformationRow) {
            transformationRow.classList.add('display-image');
        }

        document.getElementById('manualImg2ImgGroup').classList.remove('hidden');
        updateUploadDeleteButtonVisibility();
        updateInpaintButtonState();
        showGlassToast('success', null, 'Reference Image Added');

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
    document.getElementById('manualImg2ImgGroup').classList.add('hidden');

    // Hide image bias dropdown
    hideImageBiasDropdown();
    
    // Update image bias orientation after clearing image data
    updateImageBiasOrientation();

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
            deleteImageBaseBtn.classList.remove('hidden');
        } else {
            // No image uploaded or it's a placeholder, hide delete button
            deleteImageBaseBtn.classList.add('hidden');
        }
    }
    
    if (previewBaseImageBtn) {
        if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            // Image is uploaded (not a placeholder), show preview button
            previewBaseImageBtn.classList.remove('hidden');
        } else {
            // No image uploaded or it's a placeholder, hide preview button
            previewBaseImageBtn.classList.add('hidden');
        }
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
        [
            { text: 'Unpin', value: true, className: 'btn-secondary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
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

        let responseData = null;
        
        // Unpin all files at once using WebSocket
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        responseData = await window.wsClient.removePinnedBulk(activeWorkspace, validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { removedCount, failed } = responseData;
            let toastMessage = `Unpinned ${removedCount} image(s)`;
            
            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }
            
            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-thumbtack"></i>');
        } else {
            showGlassToast('success', null, `Unpinned ${validFilenames.length} image(s)`, false, 5000, '<i class="fas fa-thumbtack"></i>');
        }
        
        // Update pin buttons for the affected images
        for (const filename of validFilenames) {
            await updateSpecificPinButton(filename);
        }

    } catch (error) {
        console.error('Bulk unpin error:', error);
        showError('Failed to unpin images: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and refresh gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
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
        [
            { text: 'Pin', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
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

        let responseData = null;
        
        // Pin all files at once using WebSocket
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        responseData = await window.wsClient.addPinnedBulk(activeWorkspace, validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { addedCount, failed } = responseData;
            let toastMessage = `Pinned ${addedCount} image(s)`;
            
            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }
            
            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-thumbtack"></i>');
        } else {
            showGlassToast('success', null, `Pinned ${validFilenames.length} image(s)`, false, 5000, '<i class="fas fa-thumbtack"></i>');
        }
        
        // Update pin buttons for the affected images (images stay in gallery)
        for (const filename of validFilenames) {
            await updateSpecificPinButton(filename);
        }

    } catch (error) {
        console.error('Bulk pin error:', error);
        showError('Failed to pin images: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and update pin buttons for the affected images
        clearSelection();
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

        let responseData = null;
        
        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        responseData = await window.wsClient.updateImagePresetBulk(validFilenames, newPresetName || null);

        // Use server response data for accurate toast message
        if (responseData) {
            const { updatedCount, failed, message } = responseData;
            let toastMessage = message || `Updated ${updatedCount} image(s)`;
            
            if (newPresetName) {
                toastMessage += ` with preset "${newPresetName}"`;
            } else {
                toastMessage += ' (preset cleared)';
            }
            
            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }
            
            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-edit"></i>');
        } else {
            const action = newPresetName ? `with preset "${newPresetName}"` : '(preset cleared)';
            showGlassToast('success', null, `Updated ${validFilenames.length} image(s) ${action}`, false, 5000, '<i class="fas fa-edit"></i>');
        }

    } catch (error) {
        console.error('Bulk change preset error:', error);
        showError('Failed to update preset names: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);
        closeModal(modal);

        // Clear selection and refresh gallery based on current view
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

/**
 * Determines the request type for random prompt generation based on the selected model.
 * @returns {number} - The request type (0, 1, or 2).
 */
function getRequestTypeForRandomPrompt() {
    const modelValue = document.getElementById('manualModel').value || '';
    const modelLower = modelValue.toLowerCase();

    if (modelLower.includes('v4')) {
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
    const divider = document.getElementById('randomPromptDivider');

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
    refreshBtn.classList.add('hidden');
    transferBtn.classList.add('hidden');
    nsfwBtn.classList.add('hidden');
    divider.classList.add('hidden');
    // Clear saved states
    savedRandomPromptState = null;
    lastPromptState = null;

    // Show success message
            showGlassToast('success', null, 'Transferred to editor', false, 5000, '<i class="fas fa-edit"></i>');
}

/**
 * Toggles the random prompt generation feature on and off.
 */
async function toggleRandomPrompt() {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
    const transferBtn = document.getElementById('randomPromptTransferBtn');
    const nsfwBtn = document.getElementById('randomPromptNsfwBtn');
    const divider = document.getElementById('randomPromptDivider');
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
        refreshBtn.classList.add('hidden');
        transferBtn.classList.add('hidden');
        nsfwBtn.classList.add('hidden');
        divider.classList.add('hidden');

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
        refreshBtn.classList.remove('hidden');
        transferBtn.classList.remove('hidden');
        nsfwBtn.classList.remove('hidden');
        divider.classList.remove('hidden');

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
                        <button type="button" class="btn-secondary position-btn hidden" onclick="showPositionDialog('${characterId}')">
                            <i class="fas fa-crosshairs"></i>
                        </button>
                        <button type="button" class="btn-danger" onclick="deleteCharacterPrompt('${characterId}')">
                            <i class="nai-trash"></i>
                        </button>
                        <button type="button" class="btn-secondary indicator" id="${characterId}_enabled" data-state="on" onclick="toggleCharacterPromptEnabled('${characterId}')" title="Enable/Disable Character">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </div>
                </div>
                <div class="tab-content">
                    <div class="tab-pane ${promptTabActive}" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <span class="token-count">0 tokens</span>
                                    <!-- Search Mode Elements (Hidden by default) -->
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <!-- Regular Toolbar Buttons -->
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div class="divider"></div>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                                            <i class="fas fa-scale-unbalanced-flip"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="search" title="Inline Find">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-skull"></i>
                                        </button>
                                    </div>
                                    <!-- Search Mode Buttons (Hidden by default) -->
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane ${ucTabActive}" id="${characterId}_uc-tab" data-label="UC">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <span class="token-count">0 tokens</span>
                                    <!-- Search Mode Elements (Hidden by default) -->
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <!-- Regular Toolbar Buttons -->
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div class="divider"></div>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                                            <i class="fas fa-scale-unbalanced-flip"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="search" title="Inline Find">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-skull"></i>
                                        </button>
                                    </div>
                                    <!-- Search Mode Buttons (Hidden by default) -->
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
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
            addSafeEventListener(promptField, 'input', handleCharacterAutocompleteInput);
            addSafeEventListener(promptField, 'keydown', handleCharacterAutocompleteKeydown);
            addSafeEventListener(promptField, 'focus', () => startEmphasisHighlighting(promptField));
            addSafeEventListener(promptField, 'blur', () => {
                applyFormattedText(promptField, true);
                updateEmphasisHighlighting(promptField);
                stopEmphasisHighlighting();
            });
            // Add auto-resize functionality
            addSafeEventListener(promptField, 'input', () => autoResizeTextarea(promptField));
            // Initialize emphasis highlighting overlay
            initializeEmphasisOverlay(promptField);
            // Initialize toolbar for dynamic textarea
            if (window.handleDynamicTextarea) {
                window.handleDynamicTextarea(promptField);
            }
        }

            if (ucField) {
            addSafeEventListener(ucField, 'input', handleCharacterAutocompleteInput);
            addSafeEventListener(ucField, 'keydown', handleCharacterAutocompleteKeydown);
            addSafeEventListener(ucField, 'focus', () => startEmphasisHighlighting(ucField));
            addSafeEventListener(ucField, 'blur', () => {
                applyFormattedText(ucField, true);
                updateEmphasisHighlighting(ucField);
                stopEmphasisHighlighting();
            });
            // Add auto-resize functionality
            addSafeEventListener(ucField, 'input', () => autoResizeTextarea(ucField));
            initializeEmphasisOverlay(ucField);
            // Initialize toolbar for dynamic textarea
            if (window.handleDynamicTextarea) {
                window.handleDynamicTextarea(ucField);
            }
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
        autoPositionBtn.classList.add('hidden');
        return;
    }

    if (characterItems.length === 1) {
        autoPositionBtn.classList.add('hidden');
        // Force enable auto position for single character
        autoPositionBtn.setAttribute('data-state', 'on');
        // Hide position buttons and move buttons for single character
        characterItems.forEach(item => {
            const positionBtn = item.querySelector('.position-btn');
            const moveUpBtn = item.querySelector('.move-up-btn');
            const moveDownBtn = item.querySelector('.move-down-btn');
            if (positionBtn) positionBtn.classList.add('hidden');
            if (moveUpBtn) moveUpBtn.classList.add('hidden');
            if (moveDownBtn) moveDownBtn.classList.add('hidden');
        });
    } else {
        autoPositionBtn.classList.remove('hidden');
        // Show/hide position buttons based on auto position state
        const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';
        characterItems.forEach((item, index) => {
            const positionBtn = item.querySelector('.position-btn');
            const moveUpBtn = item.querySelector('.move-up-btn');
            const moveDownBtn = item.querySelector('.move-down-btn');

            if (positionBtn) {
                positionBtn.classList.toggle('hidden', isAutoPosition);
            }

            // Show move buttons for multiple characters
            if (moveUpBtn) {
                moveUpBtn.classList.remove('hidden');
                if (index === 0) {
                    moveUpBtn.disabled = true;
                    moveUpBtn.style.opacity = '0.4';
                } else {
                    moveUpBtn.disabled = false;
                    moveUpBtn.style.opacity = '1';
                }
            }
            if (moveDownBtn) {
                moveDownBtn.classList.remove('hidden');
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
    document.getElementById('positionDialog').classList.remove('hidden');

    // Add event listeners to position cells
    document.querySelectorAll('.position-cell').forEach(cell => {
        cell.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.position-cell').forEach(c => c.classList.remove('selected'));
            this.classList.add('selected');
            selectedPositionCell = this;
        });
    });
}

function hidePositionDialog() {
    document.getElementById('positionDialog').classList.add('hidden');
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
                        <button type="button" class="btn-secondary position-btn hidden" onclick="showPositionDialog('${characterId}')">
                            ${positionBtnText}
                        </button>
                        <button type="button" class="btn-danger" onclick="deleteCharacterPrompt('${characterId}')">
                            <i class="nai-trash"></i>
                        </button>
                        <button type="button" class="btn-secondary indicator" id="${characterId}_enabled" data-state="${character.enabled ? 'on' : 'off'}" onclick="toggleCharacterPromptEnabled('${characterId}')" title="Enable/Disable Character">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </div>
                </div>
                <div class="tab-content">
                    <div class="tab-pane ${promptTabActive}" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${character.prompt || ''}</textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <span class="token-count">0 tokens</span>
                                    <!-- Search Mode Elements (Hidden by default) -->
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <!-- Regular Toolbar Buttons -->
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div class="divider"></div>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                                            <i class="fas fa-scale-unbalanced-flip"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="search" title="Inline Find">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-skull"></i>
                                        </button>
                                    </div>
                                    <!-- Search Mode Buttons (Hidden by default) -->
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane ${ucTabActive}" id="${characterId}_uc-tab" data-label="UC">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_uc" class="form-control character-prompt-textarea" placeholder="Enter undesired content..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${character.uc || ''}</textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <span class="token-count">0 tokens</span>
                                    <!-- Search Mode Elements (Hidden by default) -->
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <!-- Regular Toolbar Buttons -->
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div class="divider"></div>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Emphasis">
                                            <i class="fas fa-scale-unbalanced-flip"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="search" title="Inline Find">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-skull"></i>
                                        </button>
                                    </div>
                                    <!-- Search Mode Buttons (Hidden by default) -->
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
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
            addSafeEventListener(promptField, 'input', handleCharacterAutocompleteInput);
            addSafeEventListener(promptField, 'keydown', handleCharacterAutocompleteKeydown);
            addSafeEventListener(promptField, 'focus', () => startEmphasisHighlighting(promptField));
            addSafeEventListener(promptField, 'blur', () => {
                applyFormattedText(promptField, true);
                updateEmphasisHighlighting(promptField);
                stopEmphasisHighlighting();
            });
            // Add auto-resize functionality
            addSafeEventListener(promptField, 'input', () => autoResizeTextarea(promptField));
            // Initialize emphasis highlighting overlay
            initializeEmphasisOverlay(promptField);
            // Apply initial resizing and highlighting after content is set
            autoResizeTextarea(promptField);
            updateEmphasisHighlighting(promptField);
            // Initialize toolbar for dynamic textarea
            if (window.handleDynamicTextarea) {
                window.handleDynamicTextarea(promptField);
            }
        }

        if (ucField) {
            addSafeEventListener(ucField, 'input', handleCharacterAutocompleteInput);
            addSafeEventListener(ucField, 'keydown', handleCharacterAutocompleteKeydown);
            addSafeEventListener(ucField, 'focus', () => startEmphasisHighlighting(ucField));
            addSafeEventListener(ucField, 'blur', () => {
                applyFormattedText(ucField, true);
                updateEmphasisHighlighting(ucField);
                stopEmphasisHighlighting();
            });
            // Add auto-resize functionality
            addSafeEventListener(ucField, 'input', () => autoResizeTextarea(ucField));
            // Initialize emphasis highlighting overlay
            initializeEmphasisOverlay(ucField);
            // Apply initial resizing and highlighting after content is set
            autoResizeTextarea(ucField);
            updateEmphasisHighlighting(ucField);
            // Initialize toolbar for dynamic textarea
            if (window.handleDynamicTextarea) {
                window.handleDynamicTextarea(ucField);
            }
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

// Cell Label Functions - Do not remove or modify this function
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

// PRICE CALCULATION AND DISPLAY SYSTEM - Move to priceManager.js
// This system handles price calculation, display, and credit management
// Includes functions: updatePercentageOverlay, updatePercentageOverlays, updateManualPriceDisplay,
// calculatePriceUnified, calculateCreditCost, updateBalanceDisplay, etc.

// Timeout for debouncing price display updates
let manualPriceDisplayTimeout = null;


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

// Generate button hover popover functions
function showGenerateButtonPopover() {
    const counter = imageCount || '0';
    const popover = createGenerateButtonPopover(counter);
    
    // Add to DOM first to get dimensions
    document.body.appendChild(popover);
    
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Position the popover above the button
    const buttonRect = manualGenerateBtn.getBoundingClientRect();
    popover.style.position = 'fixed';
    
    // Calculate initial position (above the button)
    let top = buttonRect.top - popover.offsetHeight - 10;
    let left = buttonRect.left + (buttonRect.width / 2) - (popover.offsetWidth / 2);
    
    // Check if popover goes above viewport
    if (top < 10) {
        // Position below the button instead
        top = buttonRect.bottom + 10;
        popover.classList.add('below');
    }
    
    // Check if popover goes below viewport
    if (top + popover.offsetHeight > viewportHeight - 10) {
        // Position above the button (original position)
        top = buttonRect.top - popover.offsetHeight - 10;
        popover.classList.remove('below');
    }
    
    // Check if popover goes left of viewport
    if (left < 10) {
        left = 10;
    }
    
    // Check if popover goes right of viewport
    if (left + popover.offsetWidth > viewportWidth - 10) {
        left = viewportWidth - popover.offsetWidth - 10;
    }
    
    // Apply final position
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    
    // Store reference for cleanup
    manualGenerateBtn.popoverElement = popover;
}

function hideGenerateButtonPopover() {
    if (manualGenerateBtn.popoverElement) {
        manualGenerateBtn.popoverElement.remove();
        manualGenerateBtn.popoverElement = null;
    }
}

function createGenerateButtonPopover(counter) {
    const popover = document.createElement('div');
    popover.className = 'generate-button-popover';
    popover.innerHTML = `
        <div class="popover-content">
            <div class="popover-header">
                <i class="fas fa-chart-line"></i>
                <span>Generation Count</span>
            </div>
            <div class="popover-body">
                <div class="counter-value">${counter}</div>
                <div class="counter-label">Images Generated</div>
            </div>
        </div>
        <div class="popover-arrow"></div>
    `;
    return popover;
}

function saveBlurPreference(disabled) {
    try {
        // Save preference to localStorage
        localStorage.setItem('disable-blur', disabled.toString());
    } catch (e) {
        console.error('Error saving blur preference:', e);
    }
}

function loadBlurPreference() {
    try {
        const disabled = localStorage.getItem('disable-blur');
        if (disabled !== null) {
            if (disabled === 'true') {
                document.documentElement.classList.add('disable-blur');
            } else {
                document.documentElement.classList.remove('disable-blur');
            }
        }
        
        const savedFocusCoverState = localStorage.getItem('focusCoverEnabled');
        if (savedFocusCoverState !== null) {
            focusCoverEnabled = savedFocusCoverState === 'true';
        }
    } catch (e) {
        console.error('Error loading blur preference:', e);
    }
}
// SERVER CONNECTION MANAGEMENT SYSTEM - Move to connectionManager.js
// This system handles server ping, connection status, balance updates, and queue management
// Includes functions: handleServerPing, updateBalanceDisplay, updateSubscriptionNotifications,
// disableReadOnlyFeatures, startPreviewAnimation, isPreviewAnimationAvailable, etc.

// Ping management
let lastPingTime = null;
let pingTimeoutId = null;
let connectionToastId = null;
let imageCount = 0;
// websocketToastId is now global (window.websocketToastId)

function handleServerPing(data) {
    lastPingTime = Date.now();
    
    // Update UI with server data
    if (data.image_count !== undefined) {
        imageCount = data.image_count;
    }
    if (data.balance !== undefined) {
        updateBalanceDisplay(data.balance);
        // Check for subscription notifications when balance updates
        updateSubscriptionNotifications().catch(error => {
        });
    }
    
    // Handle queue status
    if (data.queue_status !== undefined) {
        if (data.queue_status === 2) {
            isQueueStopped = true;
            isQueueProcessing = false;
        } else if (data.queue_status === 1) {
            isQueueStopped = false;
            isQueueProcessing = true;
        } else {
            isQueueStopped = false;
            isQueueProcessing = false;
        }
        updateManualGenerateBtnState();
    }
    
    // Clear connection warning toast if it exists
    if (connectionToastId) {
        removeGlassToast(connectionToastId);
        connectionToastId = null;
    }
    
    // Clear WebSocket connection toast if it exists
    if (window.websocketToastId) {
        removeGlassToast(window.websocketToastId);
        window.websocketToastId = null;
    }
    
    // Reset ping timeout
    if (pingTimeoutId) {
        clearTimeout(pingTimeoutId);
    }
    
    // Set timeout for next ping (15 seconds)
    pingTimeoutId = setTimeout(() => {
        if (!connectionToastId) {
            connectionToastId = showGlassToast('warning', 'Connection Warning', 'No server response detected. Check your connection.', false);
        }
    }, 15000);
}

async function ensureSessionValid() {
    // Use WebSocket ping if available, otherwise fall back to HTTP
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.pingWithAuth();
            return true;
            } catch (wsError) {
                console.warn('WebSocket ping failed, authentication required:', wsError);
        }
        }
        
        // Show PIN modal for re-authentication
        if (pinModalPromise) return pinModalPromise;
        pinModalPromise = await window.showPinModal();
        
        // After re-authentication, try WebSocket first, then HTTP
        if (window.wsClient) {
            try {
                // Wait for WebSocket to reconnect after authentication
                await window.wsClient.waitForConnection(10000);
                
                // Verify authentication with WebSocket ping
                await window.wsClient.pingWithAuth();
            pinModalPromise = null;
            return true;
            } catch (wsError) {
                console.warn('WebSocket authentication after re-auth failed:', wsError);
                // Fall through to HTTP fallback
            }
        }
        pinModalPromise = null;
    } catch (error) {
        // User cancelled or other error
        console.error('Session validation error:', error);
        window.location.href = '/';
        return false;
    }
}

// Initialize session validation after WebSocket is ready
async function initializeSessionValidation() {
    // Wait a bit for WebSocket to connect if it's available
    if (window.wsClient) {
        try {
            await window.wsClient.waitForConnection(5000);
        } catch (error) {
            console.warn('WebSocket not available, proceeding with HTTP authentication');
        }
    }
    
    await ensureSessionValid();
    
    // Set up periodic session validation
    pingTimeoutId = setTimeout(() => {
        ensureSessionValid();
    }, 15000);
}

// Bulk operations with WebSocket support
async function handleBulkMoveToWorkspace() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }

    try {
        // Use the new gallery move modal with cross-fade functionality
        if (typeof triggerGalleryMoveWithSelection === 'function') {
            triggerGalleryMoveWithSelection();
        } else {
            // Fallback to old modal if function not available
            showError('Gallery move functionality not available');
            // Clear selection even if modal fails to prevent stuck state
            clearSelection();
        }
    } catch (error) {
        console.error('Error in handleBulkMoveToWorkspace:', error);
        showError('Failed to open move modal: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    }
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

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        // Determine the type based on current gallery view
        let moveType = 'files'; // default
            if (isScrapsView) {
            moveType = 'scraps';
            } else if (isPinnedView) {
            moveType = 'pinned';
        }
        
        await window.wsClient.moveFilesToWorkspace(validFilenames, workspaceId, null, moveType);

        const workspace = workspaces[workspaceId];
        let itemType;
        if (isScrapsView) {
            itemType = 'scraps';
        } else if (isPinnedView) {
            itemType = 'pinned images';
        } else {
            itemType = 'images';
        }

        showGlassToast('success', null, `Moved ${validFilenames.length} ${itemType} to ${workspace.name}`, false, 5000, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
    } catch (error) {
        console.error('Error moving items to workspace:', error);
        showError('Failed to move items: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);
        // Clear selection and reload gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
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
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
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

        let responseData = null;
        
        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        responseData = await window.wsClient.deleteImagesBulk(validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { successful, failed, message } = responseData;
            let toastMessage = message || `Successfully removed ${successful} image(s)`;
            
            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }
            
            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-trash"></i>');
        } else {
            showGlassToast('success', null, `Successfully removed ${validFilenames.length} image(s)`, false, 5000, '<i class="fas fa-trash"></i>');
        }
    } catch (error) {
        console.error('Bulk delete error:', error);
        showError('Bulk delete failed: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and remove images from gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
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
        [
            { text: 'Send to Sequenzia', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
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

        let responseData = null;
        
        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        responseData = await window.wsClient.sendToSequenziaBulk(validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { successful, failed, message } = responseData;
            let toastMessage = message || `Successfully sent ${successful} image(s) to Sequenzia`;
            
            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }
            
            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-share"></i>');
        } else {
            showGlassToast('success', null, `Successfully sent ${validFilenames.length} image(s) to Sequenzia`, false, 5000, '<i class="fas fa-share"></i>');
        }
    } catch (error) {
        console.error('Send to Sequenzia error:', error);
        showError('Send to Sequenzia failed: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and remove images from gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
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
        [
            { text: 'Move', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
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

        let responseData = null;
        
        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        responseData = await window.wsClient.addScrapBulk(activeWorkspace, validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { addedCount, failed } = responseData;
            let toastMessage = `Successfully moved ${addedCount} image(s) to scraps`;
            
            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }
            
            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-trash-alt"></i>');
        } else {
            showGlassToast('success', null, `Successfully moved ${validFilenames.length} image(s) to scraps`, false, 5000, '<i class="fas fa-trash-alt"></i>');
        }
    } catch (error) {
        console.error('Bulk move to scraps error:', error);
        showError('Failed to move images to scraps: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and remove images from gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

// Function to disable features for read-only users
function disableReadOnlyFeatures() {
    // Disable destructive buttons
    const destructiveButtons = [
        'manualPreviewDeleteBtn',
        'bulkSelectAllBtn'
    ];
    
    destructiveButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.title = 'Not available in read-only mode';
            btn.style.opacity = '0.5';
        }
    });
    
    // Disable workspace management buttons if they exist
    const workspaceButtons = document.querySelectorAll('[data-action="workspace-delete"], [data-action="workspace-rename"], [data-action="workspace-create"]');
    workspaceButtons.forEach(btn => {
        btn.disabled = true;
        btn.title = 'Not available in read-only mode';
        btn.style.opacity = '0.5';
    });
    
    // Disable upload functionality
    const uploadInputs = document.querySelectorAll('input[type="file"]');
    uploadInputs.forEach(input => {
        input.disabled = true;
        input.title = 'Not available in read-only mode';
    });
    
    // Disable text replacement management
    const textReplacementBtns = document.querySelectorAll('[data-action="save-text-replacements"], [data-action="delete-text-replacement"]');
    textReplacementBtns.forEach(btn => {
        btn.disabled = true;
        btn.title = 'Not available in read-only mode';
        btn.style.opacity = '0.5';
    });
    
    console.log('🔒 Read-only mode: Destructive features disabled');
}

function startPreviewAnimation() {
    if (generationAnimationActive) return;
    
    // Safety check: ensure all required elements exist
    if (!previewContainer || !previewStars || !previewBackgroundLines || !previewForegroundLines) {
        console.warn('Preview animation elements not found, falling back to manual loading overlay');
        return;
    }
    
    try {
        generationAnimationActive = true;
        const toggleBtn = document.getElementById('previewAnimationToggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-stop"></i>';
            toggleBtn.title = 'Stop Preview Animation';
        }
        
        if (manualPreviewImage && !manualPreviewImage.classList.contains('hidden')) {
            // Initialize manual block container if not already done
            if (!manualBlockContainer) {
                initializeManualBlockContainer();
            }
            
            // Start wave animation in manual block container
            if (manualBlockContainer) {
                try {
                    manualBlockContainer.ensureWaveReady();
                    manualBlockContainer.createOpacityWave('rand');
                } catch (error) {
                    console.warn('Failed to start manual block container wave:', error);
                }
            }
        }
        
        previewStars.classList.remove('hidden');
        previewBackgroundLines.classList.remove('hidden');
        previewForegroundLines.classList.remove('hidden');
        
        // Add active class for CSS animations
        previewContainer.classList.add('preview-animation-active');
        
        // Fade in stars (0.25s)
        setTimeout(() => {
            if (previewStars) {
                previewStars.style.opacity = '1';
            }
        }, 10);
        
        // Start lines rising
        const lines = document.querySelectorAll('.preview-line');
        lines.forEach((line, index) => {
            line.style.animationPlayState = 'running';
            line.style.transition = 'opacity 0.3s ease-out, visibility 0.3s ease-out';
            line.style.opacity = '1';
            line.style.visibility = 'visible';
        });
        
        // Debug: ensure background lines are visible
    } catch (error) {
        console.error('Error starting preview animation:', error);
        generationAnimationActive = false;
        // Fall back to manual loading overlay if animation fails
        if (manualLoadingOverlay) {
            manualLoadingOverlay.classList.remove('hidden');
            manualLoadingOverlay.classList.remove('return');
        }
    }
}

async function stopPreviewAnimation() {
    if (!generationAnimationActive) return;
    
    // Safety check: ensure all required elements exist
    if (!previewContainer || !previewStars || !previewBackgroundLines || !previewForegroundLines) {
        console.warn('Preview animation elements not found during stop');
        generationAnimationActive = false;
        return;
    }
    
    try {
        generationAnimationActive = false;
        const toggleBtn = document.getElementById('previewAnimationToggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-magic"></i>';
            toggleBtn.title = 'Toggle Preview Animation';
        }
        
        // Add fade out class to pause animations
        previewContainer.classList.add('preview-fade-out');
        
        // Fade out the entire line containers
        previewBackgroundLines.classList.add('fadeOut');
        previewForegroundLines.classList.add('fadeOut');
        
        // Fade out stars after lines start fading (1.5s)
        setTimeout(() => {
            if (previewStars) {
                previewStars.style.opacity = '0';
            }
        }, 1500);
        
        // Hide everything after fade out completes (2.5s total)
        setTimeout(() => {
            if (previewContainer) {
                previewContainer.classList.remove('preview-animation-active', 'preview-fade-out');
            }
            if (previewStars) {
                previewStars.classList.add('hidden');
            }
            if (previewBackgroundLines) {
                previewBackgroundLines.classList.add('hidden');
                previewBackgroundLines.classList.remove('fadeOut');
            }
            if (previewForegroundLines) {
                previewForegroundLines.classList.add('hidden');
                previewForegroundLines.classList.remove('fadeOut');
            }
            
            // Reset line states
            const lines = document.querySelectorAll('.preview-line');
            lines.forEach(line => {
                line.style.opacity = '1';
                line.style.visibility = 'visible';
            });
        }, 2500);
        
        if (manualBlockContainer) {
            try {
                await manualBlockContainer.returnToNormalOpacity(true);
                // Add 1.5 second delay before unloading the block container
                await new Promise(resolve => setTimeout(resolve, 1500));
                // Unload the container to free up resources
                await manualBlockContainer.unload();
                manualBlockContainer = null;
            } catch (error) {
                console.warn('Failed to stop manual block container wave:', error);
            }
        }
    } catch (error) {
        console.error('Error stopping preview animation:', error);
        // Force reset animation state
        forceStopPreviewAnimation().catch(err => {
            console.error('Error in force stop preview animation:', err);
        });
    }
}

// Check if preview animation system is available
function isPreviewAnimationAvailable() {
    return !!(previewContainer && previewStars && previewBackgroundLines && previewForegroundLines);
}

// Force stop preview animation (utility function for emergency stops)
async function forceStopPreviewAnimation() {
    if (generationAnimationActive) {
        generationAnimationActive = false;
    }
    
    // Reset button state
    const toggleBtn = document.getElementById('previewAnimationToggle');
    if (toggleBtn) {
        toggleBtn.innerHTML = '<i class="fas fa-magic"></i>';
        toggleBtn.title = 'Toggle Preview Animation';
    }
    
    // Force reset all animation states
    if (previewContainer) {
        previewContainer.classList.remove('preview-animation-active', 'preview-fade-out');
    }
    if (previewStars) {
        previewStars.classList.add('hidden');
        previewStars.style.opacity = '0';
    }
    if (previewBackgroundLines) {
        previewBackgroundLines.classList.add('hidden');
        previewBackgroundLines.classList.remove('fadeOut');
    }
    if (previewForegroundLines) {
        previewForegroundLines.classList.add('hidden');
        previewForegroundLines.classList.remove('fadeOut');
    }
    
    // Reset line states
    const lines = document.querySelectorAll('.preview-line');
    lines.forEach(line => {
        line.style.opacity = '1';
        line.style.visibility = 'visible';
        line.style.animationPlayState = 'paused';
    });
    
    // Force unload manual block container with 1.5 second delay
    if (manualBlockContainer) {
        try {
            manualBlockContainer.unload();
            manualBlockContainer = null;
        } catch (error) {
            console.warn('Failed to unload manual block container:', error);
        }
    }
}

async function clearAllCachesAndReload() {
    try {
        // Clear all caches
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        // Clear service worker registration
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => registration.unregister()));
        }

        await window.serviceWorkerManager.checkStaticFileUpdates();

    } catch (error) {
        console.error('Error clearing caches:', error);
        if (typeof showGlassToast === 'function') {
            showGlassToast('error', 'Cache Clear Failed', 'Failed to clear caches: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Main Menu Bar Context Menu Configuration
function setupMainMenuContextMenus() {
    if (!window.contextMenu) return;
    
    // Create workspace submenu options function
    function getWorkspaceOptions(target) {
        const workspaceOptions = [];
        
        // Sort workspaces by their sort order - same as main dropdown
        const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));
        
        // Generate workspace options
        sortedWorkspaces.forEach((workspace, index) => {
            const workspaceId = workspace.id || workspace;
            const workspaceName = workspace.name || workspaceId;
            const workspaceColor = workspace.color || '#6366f1';
            // Use the same activeWorkspace variable as the main dropdown
            const isActive = workspaceId === activeWorkspace;
            
            workspaceOptions.push({
                content: `
                    <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                        <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                        <span class="context-menu-item-text">${workspaceName}</span>
                        ${isActive ? '<i class="fas fa-check" style="margin-left: auto; color: var(--success-color);"></i>' : ''}
                    </div>
                `,
                action: `switch-workspace-${workspaceId}`,
                disabled: isActive,
                workspaceId: workspaceId
            });
        });
        
        return workspaceOptions;
    }
    
    // Create workspace submenu handler function
    function handleWorkspaceAction(subItem, target) {
        const action = subItem.action;
        if (action && action.startsWith('switch-workspace-')) {
            const workspaceId = action.replace('switch-workspace-', '');
            
            // Try to switch workspace using available methods
            if (wsClient && wsClient.isConnected()) {
                // Use WebSocket to switch workspace
                setActiveWorkspace(workspaceId)
                .catch(error => {
                    console.error('Error switching workspace:', error);
                    showGlassToast('error', 'Workspace Switch Failed', 'Failed to switch workspace: ' + error.message, false, 5000);
                });
            }
        }
    }
    
    // Create the shared context menu configuration
    const contextMenuConfig = {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fa-light fa-chevron-double-up',
                            text: 'Jump to Top',
                            action: 'jump-to-top'
                        },
                        {
                            content: (target) => {
                                const sortBtn = document.getElementById('sortOrderToggleBtn');
                                const isDesc = sortBtn && sortBtn.dataset.state === 'desc';
                                const iconClass = isDesc ? 'fa-light fa-sort-amount-down' : 'fa-light fa-sort-amount-up';
                                const stateText = isDesc ? 'Newest' : 'Oldest';
                                return `
                                    <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                                        <i class="${iconClass}"></i>
                                        <div style="display: flex; flex-direction: row; justify-content: space-between; align-items: center; flex: 1;">
                                            <span class="context-menu-item-text">Sort</span>
                                            <span class="context-menu-item-state">${stateText}</span>
                                        </div>
                                    </div>
                                `;
                            },
                            action: 'invert-sort'
                        },
                        {
                            content: (target) => {
                                // Get current workspace from workspaces object using activeWorkspace variable
                                let workspaceName = 'Workspace';
                                let workspaceColor = '#6366f1';
                                
                                // Use the same activeWorkspace variable as the main dropdown
                                if (typeof workspaces !== 'undefined' && workspaces && typeof workspaces === 'object' && activeWorkspace) {
                                    const currentWorkspace = workspaces[activeWorkspace];
                                    if (currentWorkspace) {
                                        workspaceName = currentWorkspace.name || activeWorkspace;
                                        workspaceColor = currentWorkspace.color || '#6366f1';
                                    }
                                }
                                
                                return `
                                    <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                                        <div class="workspace-color-indicator" style="background-color: ${workspaceColor};"></div>
                                        <span class="context-menu-item-text">${workspaceName}</span>
                                    </div>
                                `;
                            },
                            optionsfn: getWorkspaceOptions,
                            handlerfn: handleWorkspaceAction,
                            openOnHover: true
                        }
                    ]
                },
                {
                    type: 'list',
                    title: 'Management',
                    items: [
                        {
                            icon: 'nai-import',
                            text: 'Import',
                            action: 'upload'
                        },
                        {
                            icon: 'fa-light fa-shelves',
                            text: 'Workspaces',
                            action: 'workspace-manage'
                        },
                        {
                            icon: 'fa-light fa-book-copy',
                            text: 'Spellbook',
                            action: 'preset-manager'
                        },
                        {
                            icon: 'fa-light fa-swatchbook',
                            text: 'References',
                            action: 'cache-manager'
                        },
                        {
                            icon: 'fa-light fa-language',
                            text: 'Expanders',
                            action: 'text-replacement-manager'
                        },
                        /* {
                            icon: 'fa-light fa-messages',
                            text: 'Chat Persona',
                            action: 'chat-manager'
                        }, */
                        {
                            icon: 'fa-light fa-ban',
                            text: 'Blocked Clients',
                            action: 'ip-manager'
                        }
                    ]
                },
                {
                    type: 'custom',
                    content: `
                        <div class="anlas-subscription-section" style="padding: 0 10px; gap: var(--spacing-xs);">
                            <div class="menu-item-row balance-list">
                                <i class="nai-anla"></i>
                                <div class="price-list-container">
                                    <div class="price-list-fixed">
                                        <span class="price-list-label">Fixed</span> 
                                        <span id="contextAnlasBalanceFixed" class="price-list balanceFixed">-</span>
                                    </div>
                                    <i class="fas fa-circle" style="font-size: 0.35rem; padding-top: 0.15rem;"></i>
                                    <div class="price-list-paid">
                                        <span class="price-list-label">Paid</span>
                                        <span id="contextAnlasBalancePaid" class="price-list balancePaid">-</span>
                                    </div>
                                </div>
                            </div>
                            <div class="menu-item-row balance-list">
                                <i class="nai-opus" style="font-size: 1.15rem; margin: calc(-1.15rem / 2) 0;"></i>
                                <div class="price-list-container">
                                    <span class="anlas-subscription-value" id="contextAnlasSubscriptionTier">Free</span>
                                    <i class="fas fa-circle hidden" id="contextAnlasSubscriptionDivider" style="font-size: 0.35rem; padding-top: 0.15rem;"></i>
                                    <span class="anlas-subscription-value" id="contextAnlasDaysTillExpire">
                                        <i class="fas fa-exclamation-triangle anlas-warning-icon hidden"></i>
                                        <span class="anlas-days-text">Loading...</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    `,
                    loadfn: (section, target) => {
                        // Update balance values directly (copied from updateBalanceDisplay)
                        if (window.optionsData?.balance) {
                            const balance = window.optionsData.balance;
                            const totalCredits = balance?.totalCredits || 0;
                            const fixedCredits = balance?.fixedTrainingStepsLeft || 0;
                            const purchasedCredits = balance?.purchasedTrainingSteps || 0;

                            // Update context menu balance elements
                            const contextBalanceFixed = document.getElementById('contextAnlasBalanceFixed');
                            const contextBalancePaid = document.getElementById('contextAnlasBalancePaid');
                            
                            if (contextBalanceFixed) {
                                contextBalanceFixed.textContent = fixedCredits;
                            }
                            if (contextBalancePaid) {
                                contextBalancePaid.textContent = purchasedCredits;
                            }

                            // Update main balance display elements
                            const balanceDisplay = document.querySelectorAll('.balanceDisplay');
                            const balanceAmount = document.querySelectorAll('.balanceAmount');
                            const balanceFixed = document.querySelectorAll('.balanceFixed');
                            const balancePaid = document.querySelectorAll('.balancePaid');
                            
                            if (balanceDisplay && balanceAmount) {
                                const balanceIcon = balanceDisplay[0].querySelector('i');

                                // Update amount
                                balanceAmount.forEach(amount => {
                                    amount.textContent = totalCredits;
                                });

                                if (balanceFixed) {
                                    balanceFixed.forEach(fixed => {
                                        fixed.textContent = fixedCredits;
                                    });
                                }
                                if (balancePaid) {
                                    balancePaid.forEach(paid => {
                                        paid.textContent = purchasedCredits;
                                    });
                                }

                                // Update tooltip with detailed breakdown
                                const tooltip = `Free Credits: ${fixedCredits}\nPaid Credits: ${purchasedCredits}`;
                                balanceDisplay.forEach(display => {
                                    display.title = tooltip;
                                    display.classList.remove('low-credits');
                                });

                                if (totalCredits !== -1) {
                                    currentBalance = totalCredits;
                                }

                                if (totalCredits === -1) {
                                    balanceIcon.className = 'nai-anla';
                                    balanceAmount.forEach(amount => {
                                        amount.textContent = 'Error';
                                    });
                                    balanceDisplay.forEach(display => {
                                        display.classList.add('low-credits');
                                    });
                                } else if (totalCredits === 0) {
                                    // No credits - show dollar sign and warning styling
                                    balanceIcon.className = 'nai-anla';
                                    balanceDisplay.forEach(display => {
                                        display.classList.add('low-credits');
                                    });
                                } else if (fixedCredits === 0) {
                                    // No free credits - show dollar sign
                                    balanceIcon.className = 'nai-anla';
                                } else if (totalCredits < 5000) {
                                    // Low credits - show warning triangle and orange styling
                                    balanceIcon.className = 'fas fa-exclamation-triangle';
                                    balanceDisplay.forEach(display => {
                                        display.classList.add('low-credits');
                                    });
                                } else {
                                    // Normal credits - show coin icon
                                    balanceIcon.className = 'nai-anla';
                                }
                            }
                        }
                        
                        // Update subscription values directly (copied from updateAnlasSubscriptionInfo)
                        try {
                            const subscriptionTierElement = document.getElementById('contextAnlasSubscriptionTier');
                            const daysTillExpireElement = document.getElementById('contextAnlasDaysTillExpire');
                            const subscriptionDivider = document.getElementById('contextAnlasSubscriptionDivider');
                            const warningIcon = document.querySelector('#contextAnlasDaysTillExpire .anlas-warning-icon');
                            const daysText = document.querySelector('#contextAnlasDaysTillExpire .anlas-days-text');
                            
                            if (subscriptionTierElement && daysTillExpireElement && warningIcon && daysText) {
                                const accountData = window.optionsData;
                                
                                if (accountData?.user?.subscription?.tier !== undefined) {
                                    // Update subscription tier
                                    const subscriptionTier = accountData.user.subscription.tier || 'Unknown';
                                    subscriptionTierElement.textContent = subscriptionTier === 3 ? 'Opus' : 
                                                                          subscriptionTier === 2 ? 'Scroll' :
                                                                          subscriptionTier === 1 ? 'Tablet' : 
                                                                          subscriptionTier === 0 ? 'Free' : 'Unknown';
                                    
                                    if (subscriptionDivider) {
                                        subscriptionDivider.classList.toggle('hidden', subscriptionTier < 0 || subscriptionTier === 'Unknown');
                                    }
                                    daysTillExpireElement.classList.toggle('hidden', subscriptionTier < 0 || subscriptionTier === 'Unknown');

                                    // Calculate days till expire
                                    let daysTillExpire = 0;
                                    if (accountData.user.subscription.expiresAt) {
                                        const expireDate = new Date(accountData.user.subscription.expiresAt * 1000);
                                        const now = new Date();
                                        const diffTime = expireDate.getTime() - now.getTime();
                                        daysTillExpire = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                    }
                                    
                                    daysText.textContent = `${daysTillExpire} days`;
                                    
                                    // Show warning icon if expiring in a week or less
                                    if (daysTillExpire <= 7 && daysTillExpire > 0) {
                                        warningIcon.classList.remove('hidden');
                                    } else {
                                        warningIcon.classList.add('hidden');
                                    }

                                    // Add color coding for urgency
                                    if (daysTillExpire <= 3) {
                                        daysTillExpireElement.style.color = 'var(--danger-color, #ff6b6b)';
                                    } else if (daysTillExpire <= 7) {
                                        daysTillExpireElement.style.color = 'var(--warning-color, #ffc107)';
                                    } else {
                                        daysTillExpireElement.style.color = '';
                                    }
                                } else {
                                    subscriptionTierElement.textContent = 'No data';
                                    daysText.textContent = 'No data';
                                }
                            }
                        } catch (error) {
                            console.error('Error updating subscription info in context menu:', error);
                        }
                    }
                },
                {
                    type: 'icons',
                    icons: [
                        {
                            icon: 'fa-light fa-droplet',
                            tooltip: 'Liquid Glass',
                            action: 'toggle-glass',
                            loadfn: (icon, target) => {
                                const isOn = document.documentElement.classList.contains('disable-blur');
                                icon.dataState = !isOn ? 'on' : 'off';
                            }
                        },
                        {
                            icon: 'fa-light fa-blinds',
                            tooltip: 'Focus Cover',
                            action: 'toggle-privacy-mode',
                            loadfn: (icon, target) => {
                                icon.dataState = focusCoverEnabled ? 'on' : 'off';
                            }
                        },
                        {
                            icon: 'fa-light fa-sync',
                            tooltip: 'Update',
                            action: 'refresh-cache'
                        },
                        {
                            icon: 'fa-light fa-laptop-arrow-down',
                            tooltip: 'Reinstall',
                            action: 'clear-cache'
                        },
                        {
                            icon: 'fa-light fa-power-off',
                            tooltip: 'Logout',
                            action: 'logout'
                        }
                    ]
                }
            ],
            maxHeight: true
        };
    
    // Attach the same configuration to multiple elements
    window.contextMenu.attachToElements('#main-menu-bar, #galleryToggleGroup', contextMenuConfig);
    
    // Handle context menu actions
    document.addEventListener('contextMenuAction', async function(event) {
        const { action, target, item } = event.detail;

        switch (action) {
            case 'jump-to-top':
                loadGalleryFromIndex(0);
                window.scrollTo(0, {behavior: 'instant'});
                break;
                
            case 'invert-sort':
                // Toggle sort order directly
                toggleGallerySortOrder();
                break;
                
            case 'workspace-manage':
                // Open workspace management modal directly
                showWorkspaceManagementModal();
                break;
                
            case 'preset-manager':
                // Open preset manager modal directly
                showPresetManager();
                break;
                
            case 'cache-manager':
                // Open cache manager modal directly
                showCacheManagerModal();
                break;
                
            case 'chat-manager':
                // Open chat manager modal directly
                window.chatSystem.openPersonaSettingsModal();
                break;

            case 'ip-manager':
                // Open IP manager modal directly
                window.ipManagement.openIPManagementModal();
                break;
                
            case 'text-replacement-manager':
                // Open text replacement manager modal directly
                showTextReplacementManager();
                break;
                
            case 'upload':
                // Open upload modal directly
                showUnifiedUploadModal();
                closeSubMenu();
                break;
                
            case 'toggle-glass':
                // Toggle blur effect directly            
                const isBlurDisabled = document.documentElement.classList.contains('disable-blur');
                if (isBlurDisabled) {
                    // Enable blur effects
                    document.documentElement.classList.remove('disable-blur');
                    saveBlurPreference(false);
                } else {
                    // Disable blur effects
                    document.documentElement.classList.add('disable-blur');
                    saveBlurPreference(true);
                }
                break;
                
            case 'toggle-privacy-mode':
                // Toggle focus cover directly
                focusCoverEnabled = !focusCoverEnabled;
                localStorage.setItem('focusCoverEnabled', focusCoverEnabled.toString());
                break;
                
            case 'refresh-cache':
                // Refresh cache directly
                await serviceWorkerManager.refreshServerCacheAndCheck();
                break;
                
            case 'clear-cache':
                // Clear cache directly
                const confirmedClear = await showConfirmationDialog(
                    `Are you sure you want to reinstall the application?`,
                    [
                        { text: 'Reinstall', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ],
                    event
                );
                if (confirmedClear) {
                    event.preventDefault();
                    await clearAllCachesAndReload();
                }
                break;
                
            case 'logout':
                // Logout directly
                const confirmed = await showConfirmationDialog(
                    `Are you sure you want to log out?`,
                    [
                        { text: 'Log Out', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                    // Don't pass event for context menu - it will center the dialog
                );
                if (confirmed) {
                    bypassConfirmationDialog = true;
                    handleLogout();
                }
                break;
        }
    });
}

// Register main app initialization steps with WebSocket client
if (window.wsClient) {
    wsClient.on('disconnected', (event) => {
        console.log('🔌 WebSocket disconnected:', event);
    });

    // Handle server pings
    wsClient.on('ping', (data) => {
        if (data.data) {
            handleServerPing(data.data);
        }
    });

    // Handle system messages
    wsClient.on('system_message', (data) => {
        console.log('📢 System message received:', data);
        if (data.data && data.data.message) {
            // Show system message as toast
            if (typeof showGlassToast === 'function') {
                showGlassToast(data.data.level || 'info', null, data.data.message);
            }
        }
    });

    // Handle notifications
    wsClient.on('notification', (data) => {
        console.log('🔔 Notification received:', data);
        if (data.data && data.data.message) {
            if (typeof showGlassToast === 'function') {
                showGlassToast(data.data.type || 'info', null, data.data.message);
            }
        }
    });

    // Handle receipt notifications
    wsClient.on('receipt', (data) => {
        if (data.data && data.data.message) {
            if (typeof showGlassToast === 'function') {
                showGlassToast(data.data.type || 'info', null, data.data.message, false);
            }
        }
    });

    // Handle gallery responses
    wsClient.on('galleryResponse', (data) => {
        if (data.data && (data.data.gallery || Array.isArray(data.data))) {
            if (window.workspaceLoadingCompleteCallback) {
                window.workspaceLoadingCompleteCallback();
            }
        }
    });

    // Handle gallery updates
    wsClient.on('galleryUpdated', (data) => {
        // Refresh the current gallery view if it matches the updated view type
        if (data.data && data.data.viewType) {
            allImages = data.data.gallery;
            
            // Apply current sort order to the updated gallery data
            if (window.sortGalleryData && typeof window.sortGalleryData === 'function') {
                window.sortGalleryData();
            }
            
            const currentView = window.currentGalleryView || 'images';
            if (data.data.viewType === currentView) {
                // Refresh the current gallery view
                switchGalleryView(currentView, true);
            }
        }
    });

    // Handle receipt notifications
    wsClient.on('receipt_notification', (data) => {
        if (data.receipt && data.receipt?.cost > 0) {
            const receipt = data.receipt;
            let message = '';
            let type = 'info';
            let header = '';
            
            switch (receipt.type) {
                case 'generation':
                    header = 'Generation Receipt';
                    message = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'success';
                    break;
                case 'upscaling':
                    header = 'Upscaling Receipt';
                    message = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'success';
                    break;
                case 'vibe_encoding':
                    header = 'Vibe Encoding Receipt';
                    message = ` <i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'info';
                    break;
                case 'deposit':
                    header = 'Deposit Receipt';
                    message = `<i class="nai-anla"></i> +${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'success';
                    break;
                default:
                    header = 'Operation Receipt';
                    message = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'info';
            }
            
            if (message) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast(type, header, message, false, 10000, '<i class="fas fa-file-invoice-dollar"></i>');
                }
            }
        }
    });

    // Handle workspace restoration when reconnecting
    wsClient.on('workspace_restored', (data) => {
        // Only process workspace events after app data is loaded
        if (!isAppDataReady()) {
            return;
        }

        if (data.workspace && data.message) {
            // Update the UI to show the restored workspace
            if (window.updateWorkspaceUI && typeof window.updateWorkspaceUI === 'function') {
                window.updateWorkspaceUI(data.workspace);
            }
        }
    });

    // Handle workspace data updates
    wsClient.on('workspace_data', (data) => {
        // Only process workspace events after app data is loaded
        if (!isAppDataReady()) {
            return;
        }
        
        if (data.data) {
            // Update the current workspace display
            if (window.currentWorkspace !== data.data.id) {
                window.currentWorkspace = data.data.id;
                
                // Update workspace selector if it exists
                const workspaceSelector = document.getElementById('workspace-selector');
                if (workspaceSelector) {
                    workspaceSelector.value = data.data.id;
                }
                
                // Update workspace name display
                const workspaceNameElement = document.getElementById('workspace-name');
                if (workspaceNameElement) {
                    workspaceNameElement.textContent = data.data.name || data.data.id;
                }
            }
        }
    });        
    
    window.wsClient.on('presetUpdated', (message) => {
        handlePresetUpdate(message.data);
    });

    window.wsClient.on('queue_update', (data) => {        
        // Update global queue status
        if (window.optionsData) {
            window.optionsData.queue_status = data.value;
        }
        
        // Update queue state variables
        if (data.value === 2) {
            isQueueStopped = true;
            isQueueProcessing = false;
        } else if (data.value === 1) {
            isQueueStopped = false;
            isQueueProcessing = true;
        } else {
            isQueueStopped = false;
            isQueueProcessing = false;
        }
        
        // Update generation button state
        updateManualGenerateBtnState();
        
        // Show notification if queue is blocked
        if (data.value === 2) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait.', false, 5000);
            }
        } else if (data.value === 0 && (isQueueStopped || isQueueProcessing)) {
            // Queue was unblocked
            if (typeof showGlassToast === 'function') {
                showGlassToast('success', 'Queue Unblocked', 'Generation is now available.', false, 3000);
            }
        }
    });

    // Listen for queue status requests from other modules
    document.addEventListener('requestQueueStatus', (event) => {
        const queueStatus = {
            isBlocked: isQueueStopped || isQueueProcessing,
            isQueueStopped,
            isQueueProcessing,
            value: isQueueStopped ? 2 : (isQueueProcessing ? 1 : 0)
        };
        
        // Dispatch response event
        const responseEvent = new CustomEvent('queueStatusResponse', {
            detail: queueStatus
        });
        document.dispatchEvent(responseEvent);
    });
    
    // Priority 5: Initialize main app components
    window.wsClient.registerInitStep(1, 'Loading Application Data', async () => {
        try {
            await loadOptions();
        } catch (error) {
            console.error('❌ Critical: Failed to load application data:', error);
            
            // Show critical error and provide recovery options
            const confirmed = await showConfirmationDialog(
                'Failed to load application data. This may be due to a server issue or connection problem.',
                [
                    { text: 'Retry', value: 'retry', className: 'btn-primary' },
                    { text: 'Restart', value: 'refresh', className: 'btn-secondary' }
                ],
                'Critical Error'
            );
            
            if (confirmed === 'retry') {
                // Retry loading options
                await loadOptions();
            } else if (confirmed === 'refresh') {
                // Refresh the page
                window.location.reload();
                return; // Don't continue with initialization
            }
        }
    }, true);

    window.wsClient.registerInitStep(10, 'Configuring Application', async () => {
        updateBalanceDisplay(window.optionsData?.balance);
        // Handle queue status
        if (window.optionsData?.queue_status === 2) {
            isQueueStopped = true;
            isQueueProcessing = false;
        } else if (window.optionsData?.queue_status === 1) {
            isQueueStopped = false;
            isQueueProcessing = true;
        } else {
            isQueueStopped = false;
            isQueueProcessing = false;
        }
        
        updateManualGenerateBtnState();
        generateSamplerOptions();
        generateResolutionOptions();
        generateModelOptions();
        generateNoiseSchedulerOptions();

        renderManualSamplerDropdown(manualSelectedSampler);
        renderManualResolutionDropdown(manualSelectedResolution);
        renderManualNoiseSchedulerDropdown(manualSelectedNoiseScheduler);
        renderManualModelDropdown(manualSelectedModel);
        await renderCustomPresetDropdown('');
        renderDatasetDropdown();

        selectManualSampler('k_euler_ancestral');
        selectManualResolution('normal_square', 'Normal');
        selectManualNoiseScheduler('karras');
        selectManualModel('v4_5', '', true);
        
        updateDatasetDisplay();
        updateSubTogglesButtonState();
        renderUcPresetsDropdown();
        selectUcPreset(0);

        galleryRows = calculateGalleryRows();
        const galleryToggleGroup = document.getElementById('galleryToggleGroup');
        imagesPerPage = parseInt(galleryToggleGroup?.dataset?.columns || 5) * galleryRows;
        galleryToggleGroup.setAttribute('data-active', currentGalleryView);
    });

    // Priority 7: Load gallery and finalize UI
    window.wsClient.registerInitStep(90, 'Loading Gallery', async () => {
        await loadGallery();
        await updateGalleryColumnsFromLayout();
        await updateMenuBarHeight();
    }, true);

    // Priority 7: Load gallery and finalize UI
    window.wsClient.registerInitStep(100, 'Finalizing', async () => {
        updateGenerateButton();

        // Initialize background gradient
        await setupEventListeners();

        setupMainMenuContextMenus();
        
        initializeSessionValidation();
        
        // Initialize emphasis highlighting for manual fields
        await initializeEmphasisOverlay(manualPrompt);
        await initializeEmphasisOverlay(manualUc);

        // Start closed
        setSeedInputGroupState(false);
    });
}

// Window Controls Overlay API - OS Detection and class addition
document.addEventListener('DOMContentLoaded', () => {
    // Function to update window controls overlay classes
    function updateWindowControlsOverlayClasses() {

        const titlebarX = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-x');
        const titlebarY = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-y');
        const titlebarWidth = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-width');
        const titlebarHeight = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-height');

        // Check if overlay is truly enabled - prioritize WCO API over CSS properties
        const apiAvailable = 'windowControlsOverlay' in navigator;
        let wcoRect = null;

        if (apiAvailable) {
            try {
                wcoRect = navigator.windowControlsOverlay.getTitlebarAreaRect();
            } catch (error) {
                console.error('🎛️ WCO: Error getting rect:', error.message);
            }
        }

        // If WCO API gives us a valid rect, use that as the authoritative source
        const wcoHasValidRect = wcoRect && wcoRect.width > 0 && wcoRect.height > 0;

        // Fallback to CSS properties only if WCO API is not available or gives invalid data
        const widthValid = titlebarWidth && titlebarWidth !== '0px' && titlebarWidth !== '';
        const heightValid = titlebarHeight && titlebarHeight !== '0px' && titlebarHeight !== '';
        const cssHasValidDimensions = widthValid && heightValid;

        // Prioritize WCO API, fallback to CSS
        const isOverlayEnabled = wcoHasValidRect || (!apiAvailable && cssHasValidDimensions);

        if (isOverlayEnabled) {
            // Overlay is enabled - add classes and hide original elements
            document.documentElement.classList.add('window-controls-overlay');
            const xValue = parseInt(titlebarX) || 0;
            if (xValue > 0) {
                document.documentElement.classList.add('titlebar-mac');
            } else {
                // Titlebar starts at 0 = Windows (controls on right)
                document.documentElement.classList.add('titlebar-windows');
            }

            // Hide original elements in overlay (menubar elements handled by CSS)
            toggleOverlayElements(false);
        } else {
            // Overlay is disabled - remove classes and show original elements in overlay
            document.documentElement.classList.remove('window-controls-overlay', 'titlebar-mac', 'titlebar-windows');
            toggleOverlayElements(true);
        }
    }

    // Check if Window Controls Overlay API is supported and has valid titlebar area
    function isWindowControlsOverlayAvailable() {
        // First check if the API exists
        if (!('windowControlsOverlay' in navigator)) {
            return false;
        }

        try {
            const rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
            // Check if the rect has meaningful dimensions (not empty or zero-sized)
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                return false;
            }

            // Additional check: ensure the titlebar area is not the entire viewport
            // (which would indicate the overlay is not properly configured)
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // If titlebar area covers more than 95% of viewport, it's likely not configured properly
            if (rect.width > viewportWidth * 0.95 || rect.height > viewportHeight * 0.95) {
                return false;
            }
            return true;
        } catch (error) {
            // If getTitlebarAreaRect() throws an error, overlay is not available
            console.error('🎛️ WCO Error:', error.message);
            return false;
        }
    }

    if (isWindowControlsOverlayAvailable()) {
        // Initial setup
        updateWindowControlsOverlayClasses();

        // Listen for geometry changes (when window controls overlay updates)
        if (navigator.windowControlsOverlay.ongeometrychange !== undefined) {
            navigator.windowControlsOverlay.ongeometrychange = () => {
                updateWindowControlsOverlayClasses();
            };
        }

        // Also listen for window resize events as a fallback
        window.addEventListener('resize', () => {
            // Debounce the update to avoid excessive calls
            clearTimeout(window._wcoResizeTimeout);
            window._wcoResizeTimeout = setTimeout(() => {
                if (isWindowControlsOverlayAvailable()) {
                    updateWindowControlsOverlayClasses();
                }
            }, 100);
        });

        // Listen for CSS custom property changes (titlebar-area-x, titlebar-area-height)
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const target = mutation.target;
                    const style = getComputedStyle(target);
                    const currentX = style.getPropertyValue('--titlebar-area-x');
                    const currentHeight = style.getPropertyValue('--titlebar-area-height');

                    // Check if the values have actually changed
                    if (target._lastTitlebarX !== currentX || target._lastTitlebarHeight !== currentHeight) {
                        target._lastTitlebarX = currentX;
                        target._lastTitlebarHeight = currentHeight;
                        shouldUpdate = true;
                    }
                }
            });

            if (shouldUpdate) {
                updateWindowControlsOverlayClasses();
            }
        });

        // Observe the document element for style changes
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style']
        });

        // Expose utility function for external access
        window.getWindowControlsOverlayState = () => {
            const apiAvailable = 'windowControlsOverlay' in navigator;
            const titlebarX = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-x');
            const titlebarY = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-y');
            const titlebarWidth = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-width');
            const titlebarHeight = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-height');

            let rect = null;
            if (apiAvailable) {
                try {
                    rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
                } catch (error) {
                    rect = { error: error.message };
                }
            }

            return {
                apiAvailable,
                titlebarArea: { x: titlebarX, y: titlebarY, width: titlebarWidth, height: titlebarHeight },
                rect,
                classes: {
                    hasOverlay: document.documentElement.classList.contains('window-controls-overlay'),
                    isMac: document.documentElement.classList.contains('titlebar-mac'),
                    isWindows: document.documentElement.classList.contains('titlebar-windows')
                },
                isEnabled: rect && rect.width > 0 && rect.height > 0
            };
        };
    }
    
    // Hide original balanceDisplay and pendingRequestsSpinner in main-menu-bar-overlay
    // when menubar is enabled (elements are now shown in menu-bar-controls-right)
    function toggleOverlayElements(show) {
        const selectors = [
            '#main-controls-bar .main-menu-bar-overlay #pendingRequestsSpinner',
            '#main-controls-bar .main-menu-bar-overlay .balanceDisplay',
            '#main-controls-bar .main-menu-bar-overlay #websocketIndicatorOverlay',
            '#manualPendingRequestsSpinner',
            '#manualBalanceDisplay'
        ];

        const displayValue = show ? '' : 'none';

        selectors.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                element.style.display = displayValue;
            }
        });
    }

});

/* // Development Mode Toggle Functions (always available)
window.enableDevMode = function() {
    localStorage.setItem('staticforge_dev_mode', 'true');
    console.log('🔧 Development mode enabled. Please refresh the page.');
    return true;
};

window.disableDevMode = function() {
    localStorage.removeItem('staticforge_dev_mode');
    console.log('🔧 Development mode disabled. Please refresh the page.');
    return false;
};

window.toggleDevMode = function() {
    const currentMode = localStorage.getItem('staticforge_dev_mode') === 'true';
    if (currentMode) {
        return window.disableDevMode();
    } else {
        return window.enableDevMode();
    }
};

window.isDevModeEnabled = function() {
    return localStorage.getItem('staticforge_dev_mode') === 'true';
};

// Master Window Management Functions
window.setAsMasterWindow = function() {
    if (window.masterWindowClient) {
        window.masterWindowClient.setAsMaster();
        console.log('🔧 Master Window: Set as master window');
    } else {
        console.error('🔧 Master Window: Master window client not available');
    }
};

// Function to update transformation dropdown button active state based on vibe presence
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

window.clearMasterWindow = function() {
    if (window.masterWindowClient) {
        window.masterWindowClient.clearMaster();
        console.log('🔧 Master Window: Cleared master window status');
    } else {
        console.error('🔧 Master Window: Master window client not available');
    }
};

window.isMasterWindow = function() {
    if (window.masterWindowClient) {
        return window.masterWindowClient.isMasterWindow();
    }
    return false;
};

// MCP Take Ownership (dumb function - always available)
window.mcpTakeOwnership = function() {
    if (window.masterWindowClient) {
        // Use the full master window client if available
        window.masterWindowClient.setAsMaster();
        console.log('🔧 MCP: Set as master window via master window client');
    } else {
        // Dumb function - just set localStorage and suggest refresh
        localStorage.setItem('staticforge_master_window', JSON.stringify({
            isMaster: true,
            sessionId: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now()
        }));
        console.log('🔧 MCP: Master window status set in localStorage. Please refresh the page to activate.');
    }
};

// Add master window status to the UI
document.addEventListener('DOMContentLoaded', function() {
    // Update master window indicator periodically
    setInterval(function() {
        if (window.masterWindowClient) {
            const isMaster = window.masterWindowClient.isMasterWindow();
            const indicators = document.querySelectorAll('.master-indicator');
            indicators.forEach(indicator => {
                if (isMaster) {
                    indicator.textContent = '🔧 Master';
                    indicator.style.color = '#4CAF50';
                } else {
                    indicator.textContent = '⚪ Client';
                    indicator.style.color = '#666';
                }
            });
        }
    }, 1000);
});

// showManualModal is now handled internally by the Director class
 */