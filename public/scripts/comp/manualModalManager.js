/**
 * Manual Modal Management System
 *
 * This file contains all functionality related to:
 * - Manual modal show/hide operations
 * - Form clearing and reset functionality
 * - Preview management within the modal
 * - Modal state management
 *
 * Dependencies:
 * - app.js (for shared DOM elements and utilities)
 * - dropdown.js (for dropdown functionality)
 * - toast notifications
 */

// ============================================================================
// DOM ELEMENTS (MOVED FROM app.js)
// ============================================================================

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Update the display of the generated image name
 * @param {string|null} imageName - The generated image name to display, or null to hide
 */
function updateGeneratedImageNameDisplay(imageName) {
    const displayElement = document.getElementById('generatedImageNameDisplay');
    const textElement = document.getElementById('generatedImageNameText');

    if (!displayElement || !textElement) {
        return;
    }

    if (imageName && imageName.trim()) {
        textElement.textContent = imageName;
        displayElement.classList.remove('hidden');
        displayElement.title = `Generated Name: ${imageName}`;
    } else {
        displayElement.classList.add('hidden');
        textElement.textContent = '';
    }
}

/**
 * Splash screen management for manual modal
 */
const splashScreen = document.getElementById('manualModalSplash');
let splashScreenStartTime = null;
let splashScreenMinDisplayTime = 1250; // Minimum display time in ms
let splashScreenCloseTimeout = null;

function showSplashScreen() {
    if (!window.isDesktop) return; // Only show in desktop mode

    splashScreenStartTime = Date.now();
    splashScreen.classList.remove('hidden');
}

function updateSplashScreenStatus(status) {
    if (splashScreen.classList.contains('hidden')) return;

    const statusText = splashScreen.querySelector('.splash-status-text');
    if (statusText) {
        statusText.textContent = status;
    }
}

function hideSplashScreen() {
    const elapsed = Date.now() - splashScreenStartTime;
    const remaining = splashScreenMinDisplayTime - elapsed;


    if (splashScreenCloseTimeout) {
        clearTimeout(splashScreenCloseTimeout);
    }
    splashScreenCloseTimeout = setTimeout(() => {
        splashScreen.classList.add('hidden');
        splashScreenCloseTimeout = null;
    }, (Math.min(Math.max(0, remaining), 500) + 750));
}

/**
 * Update the manual modal titlebar with preset name
 */
function updateManualModalTitlebar(value = null, skipTaskbarUpdate = false) {
    const _windowTitle = (value || manualPresetName.value)?.trim();
    manualModal.querySelector('.manual-modal-title .modal-window-title-main span').textContent = 'DreamStudio 2025 R3' + (_windowTitle ? ` - ${_windowTitle}` : '');
    if (!skipTaskbarUpdate) updateTaskbarWindows();
}

// Manual Modal DOM Elements - Move these from app.js
const manualModal = document.getElementById('manualModal');
const manualGenerateBtn = document.getElementById('manualGenerateBtn');
const manualForm = document.getElementById('manualForm');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualPreviewCloseBtn = document.getElementById('manualPreviewCloseBtn');
const presetSelect = document.getElementById('presetSelect');
const gallery = document.getElementById('gallery');
const cacheGallery = document.getElementById('cacheGallery');
const confettiContainer = document.getElementById('confettiContainer');

/** Celebration after a successful image generation: `'sakura'` (default) or classic `'confetti'`. Persists via localStorage key `generationCelebrationEffect`. */
var generationCelebrationEffect = 'sakura';
try {
    const _storedCelebration = localStorage.getItem('generationCelebrationEffect');
    if (_storedCelebration === 'sakura' || _storedCelebration === 'confetti') {
        generationCelebrationEffect = _storedCelebration;
    }
} catch (e) { /* ignore */ }
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
const manualUpscale = document.getElementById('manualUpscale');
const clearSeedBtn = document.getElementById('clearSeedBtn');
const focusOverlay = document.getElementById('focus-overlay');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const metadataDialog = document.getElementById('metadataDialog');
const closeMetadataDialog = document.getElementById('closeMetadataDialogBtn');
const dialogPromptBtn = document.getElementById('dialogPromptBtn');
const dialogUcBtn = document.getElementById('dialogUcBtn');
const dialogPromptExpanded = document.getElementById('dialogPromptExpanded');
const dialogUcExpanded = document.getElementById('dialogUcExpanded');
const dialogPromptContent = document.getElementById('dialogPromptContent');
const dialogUcContent = document.getElementById('dialogUcContent');
const deleteImageBaseBtn = document.getElementById('deleteImageBaseBtn');
const previewBaseImageBtn = document.getElementById('previewBaseImageBtn');
const manualPreviewDownloadBtn = document.getElementById('manualPreviewDownloadBtn');
const manualPreviewCopyBtn = document.getElementById('manualPreviewCopyBtn');
const manualPreviewUpscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
const manualPreviewVariationBtn = document.getElementById('manualPreviewVariationBtn');
const manualPreviewDeleteBtn = document.getElementById('manualPreviewDeleteBtn');
const manualStrengthValue = document.getElementById('manualStrengthValue');
const manualNoiseValue = document.getElementById('manualNoiseValue');
const paidRequestToggle = document.getElementById('paidRequestToggle');
const manualControlsToggle = document.getElementById('controlsToggle');
const previewContainer = document.getElementById('manualPreviewContainer');
const previewStars = document.getElementById('previewStars');
const previewBackgroundLines = document.getElementById('previewBackgroundLines');
const previewForegroundLines = document.getElementById('previewForegroundLines');
const manualLoadBtn = document.getElementById('manualLoadBtn');
const manualSaveBtn = document.getElementById('manualSaveBtn');
const manualPreviewLoadBtn = document.getElementById('manualPreviewLoadBtn');
const manualPreviewPinBtn = document.getElementById('manualPreviewPinBtn');
const manualPreviewScrapBtn = document.getElementById('manualPreviewScrapBtn');
const characterPromptsContainer = document.getElementById('characterPromptsContainer');
const textOverlaysContainer = document.getElementById('textOverlaysContainer');
const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
const transformationRow = document.getElementById('transformationRow');
const addItemDropdown = document.getElementById('addItemDropdown');
const addItemDropdownBtn = document.getElementById('addItemDropdownBtn');
const addItemDropdownMenu = document.getElementById('addItemDropdownMenu');
const pipelineStagesContainer = document.getElementById('pipelineStagesContainer');
const pipelineStagesHeader = document.getElementById('pipelineStagesHeader');
const enableStageGenerationBtn = document.getElementById('enableStageGenerationBtn');
const saveStage0Btn = document.getElementById('saveStage0Btn');
const manualPreviewOriginalImage = document.getElementById('manualPreviewOriginalImage');
const sproutSeedBtn = document.getElementById('sproutSeedBtn');
const previewSection = document.getElementById('manualPanelSection');
const variationImage = document.getElementById('manualVariationImage');
const previewCharacterReferenceImageBtn = document.getElementById('previewCharacterReferenceImageBtn');
const manualRescaleOverlay = manualRescale?.parentElement?.querySelector('.percentage-input-overlay');
const manualStrengthOverlay = manualStrengthValue?.parentElement?.querySelector('.percentage-input-overlay');
const manualNoiseOverlay = manualNoiseValue?.parentElement?.querySelector('.percentage-input-overlay');
const manualPresetPlaceholder = document.getElementById('manualPresetPlaceholder');
const manualPresetPlaceholderText = document.getElementById('manualPresetPlaceholderText');
const loadSeedBtn = document.getElementById('loadSeedBtn');
const manualPresetManagerBtn = document.getElementById('manualPresetManagerBtn');
const manualPreviewImage = document.getElementById('manualPreviewImage');
const manualPreviewImageContainerInner = document.getElementById('manualPreviewImageContainerInner');
const textReplacementLockBtn = document.getElementById('textReplacementLockBtn');
const textReplacementLockModal = document.getElementById('textReplacementLockModal');
const closeTextReplacementLockModalBtn = document.getElementById('closeTextReplacementLockModalBtn');
const selectAllTextReplacementsBtn = document.getElementById('selectAllTextReplacementsBtn');
const deselectAllTextReplacementsBtn = document.getElementById('deselectAllTextReplacementsBtn');
// Creative directive elements
const creativeDirectiveInput = document.getElementById('creativeDirectiveInput');
const windowPaidToggle = document.getElementById('windowPaidRequestToggle');
const manualRequestSaveBtn = document.getElementById('manualRequestSaveBtn');
const manualPreviewToggleDialogsBtn = document.getElementById('manualPreviewToggleDialogsBtn');

// Dynamic Generation System
const dynamicGenerationToggleBtn = document.getElementById('dynamicGenerationToggleBtn');
const dynamicGenerationGroup = document.getElementById('dynamicGenerationGroup');
const todBtn = document.getElementById('todBtn');
const weatherBtn = document.getElementById('weatherBtn');
const seasonBtn = document.getElementById('seasonBtn');
const creativeBtn = document.getElementById('creativeBtn');
const dynamicGenerationUndoBtn = document.getElementById('dynamicGenerationUndoBtn');
const dynamicCarousel = document.getElementById('dynamicCarousel');

// Director Reference Elements
const directorReferenceSection = document.getElementById('directorReferenceSection');
const directorReferenceGroup = document.getElementById('directorReferenceGroup');
const directorReferenceImage = document.getElementById('directorReferenceImage');
const addDirectorReferenceBtn = document.getElementById('addDirectorReferenceBtn');
const clearDirectorReferenceBtn = document.getElementById('clearDirectorReferenceBtn');
const directorReferenceStyleBtn = document.getElementById('directorReferenceStyleBtn');
const directorReferenceFidelityInput = document.getElementById('directorReferenceFidelityInput');
const directorReferenceFidelityOverlay = directorReferenceFidelityInput?.parentElement?.querySelector('.percentage-input-overlay');
let directorReferenceData = null; // Store the current director reference data

// ============================================================================
// GLOBAL VARIABLES (MOVED FROM app.js)
// ============================================================================

// Manual Modal variables - Move these from app.js
let manualBlockContainer = null; // Manual block container for wave animation
let manualPreviewEventListenersRegistered = false;
let wasInSearchMode = false; // Track if user was in search mode before opening manual modal
let manualPriceDisplayTimeout = null;
let generationAnimationActive = false;
window.currentManualPreviewImage = null;
window.currentManualPreviewIndex = null;
let lastLoadedSeed = null;
let manualSeedHistory = []; // Array to store seeds from generations and loaded images (never cleared)
let varietyEnabled = false;
let characterPromptCounter = 0;
let textOverlayCounter = 0;
let pipelineStageCounter = 0;
let currentPositionCharacterId = null;
let selectedPositionCell = null;
let lastPromptState = null;
let savedRandomPromptState = null;
let forcePaidRequest = false;


// ============================================================================
// SPROUT SEED CONTEXT MENU FUNCTIONS
// ============================================================================

/**
 * Adds a seed to the history if it's not already present
 * Adds to the bottom of the array (newest last)
 */
function addSeedToHistory(seed) {
    if (!seed || isNaN(parseInt(seed))) return;

    const seedInt = parseInt(seed);
    if (seedInt <= 0) return;

    // Only add if not already in array
    if (!manualSeedHistory.includes(seedInt)) {
        // Add to the bottom (newest last)
        manualSeedHistory.push(seedInt);
    }
}

/**
 * Creates the context menu configuration for sprout seed button
 */
function getSproutSeedContextMenuConfig() {
    return {
        sections: [
            {
                type: 'list',
                title: 'Recent Seeds',
                items: [], // Will be populated dynamically by loadfn
                initfn: function (section, target) {
                    // Generate items dynamically when menu opens
                    const items = [];

                    if (manualSeedHistory.length === 0) {
                        items.push({
                            icon: 'fas fa-seedling',
                            text: 'No seed available',
                            action: 'no-history',
                            disabled: true
                        });
                    } else {
                        // Display seeds (oldest first, so reverse the array)
                        manualSeedHistory.slice().reverse().forEach((seed, index) => {
                            items.push({
                                icon: 'fas fa-seedling',
                                text: seed.toString(),
                                action: `select-seed-${seed}`
                            });
                        });
                    }

                    section.items = items;
                }
            }
        ],
        onAction: handleSproutSeedContextMenuAction
    };
}

/**
 * Handles context menu actions for sprout seed button
 */
function handleSproutSeedContextMenuAction(action, target, item) {
    if (action.startsWith('select-seed-')) {
        const seed = parseInt(action.replace('select-seed-', ''));

        // Set the seed value
        if (manualSeed) {
            manualSeed.value = seed.toString();
        }

        // Update the last generated seed to this selected seed
        window.lastGeneratedSeed = seed;

        // Update sprout seed button state if it's not already active
        if (sproutSeedBtn && sproutSeedBtn.getAttribute('data-state') !== 'on') {
            sproutSeedBtn.setAttribute('data-state', 'on');
            manualSeed.disabled = true;
            if (manualSeed) {
                manualSeed.placeholder = seed.toString();
            }
        }
    }
}

// ============================================================================
// MANUAL PREVIEW IMAGE CONTEXT MENU FUNCTIONS
// ============================================================================

/**
 * Creates the context menu configuration for manual preview image
 * Cloned from gallery items context menu
 */
function createManualPreviewImageContextMenuConfig() {
    const contextMenuConfig = {
        maxHeight: true,
        sections: [
            {
                type: 'icons',
                position: 'outer',
                icons: [
                    {
                        icon: 'fas fa-drafting-compass',
                        tooltip: 'Modify Image',
                        action: 'modify-preview'
                    },
                    {
                        icon: 'nai-img2img',
                        tooltip: 'Use as Base Image',
                        action: 'load-base-image'
                    },
                    {
                        icon: 'fa-regular fa-star', // Default icon, will be updated by loadfn
                        tooltip: 'Favorite', // Default text, will be updated by loadfn
                        action: 'toggle-favorite',
                        loadfn: (menuItem, target) => {
                            // Get image data from currentManualPreviewImage
                            const image = window.currentManualPreviewImage;

                            if (image) {
                                // Update favorite icon and tooltip based on current pin status
                                const isPinned = checkIfImageIsPinned(image.filename || image.original || image.upscaled);
                                menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                                menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                            }
                        }
                    },
                    {
                        icon: 'fas fa-clipboard',
                        tooltip: 'Copy',
                        action: 'copy'
                    },
                    {
                        icon: 'fas fa-download',
                        tooltip: 'Download',
                        action: 'download'
                    },
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-external-link-alt',
                        text: 'Open in Window',
                        action: 'open-in-window'
                    },
                    { separator: true },
                    {
                        icon: 'mdi mdi-1-25 mdi-relative-scale',
                        text: 'Expand',
                        action: 'expand-canvas'
                    },
                    {
                        icon: 'nai-upscale',
                        text: 'Upscale',
                        action: 'upscale'
                    },
                    {
                        icon: 'fas fa-person-to-portal',
                        text: 'New Persona',
                        action: 'start-chat'
                    },
                    {
                        separator: true,
                        hidden: () => !document.body.classList.contains('desktop-mode')
                    },
                    {
                        icon: 'fas fa-image',
                        text: 'Set as Wallpaper',
                        action: 'set-wallpaper',
                        hidden: () => !document.body.classList.contains('desktop-mode')
                    },
                    {
                        icon: 'fas fa-arrow-down-left',
                        text: 'Add to Desktop',
                        action: 'create-desktop-shortcut',
                        hidden: () => !document.body.classList.contains('desktop-mode')
                    },
                ]
            },
            {
                type: 'list',
                title: 'Management',
                items: [
                    {
                        icon: 'fas fa-bin-recycle',
                        text: 'Scrap',
                        action: 'scrap-preview',
                        loadfn: (menuItem, target) => {
                            // Update scrap tooltip based on current view
                            const currentView = currentGalleryView || 'images';
                            if (currentView === 'scraps') {
                                menuItem.tooltip = 'Restore';
                                menuItem.icon = 'nai-dot-reset';
                            }
                        }
                    },
                    {
                        icon: 'fas fa-fire',
                        text: 'Incinerate',
                        action: 'delete-preview'
                    }
                ]
            }
        ]
    };

    return contextMenuConfig;
}

/**
 * Handles context menu actions for manual preview image
 */
async function handleManualPreviewImageContextMenuAction(event) {
    const { action, target, item } = event.detail;

    // Only handle actions for manualPreviewImage
    if (!target || target.id !== 'manualPreviewImage') {
        return;
    }

    // Get the current preview image
    const previewImage = document.getElementById('manualPreviewImage');
    const image = window.currentManualPreviewImage;

    if (!image) return;

    const filename = image.filename || image.original || image.upscaled;

    switch (action) {
        case 'load-base-image':
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
                    showGlassToast('error', 'Variation Failed', 'No image found', false, undefined, '<i class="fas fa-image-slash"></i>');
                }
            } else {
                showGlassToast('error', 'Variation Failed', 'No image available', false, undefined, '<i class="fas fa-image-slash"></i>');
            }
            break;
        case 'modify-preview':
            if (window.currentManualPreviewImage) {
                await openManualModalWithContent({
                    type: 'image',
                    image: window.currentManualPreviewImage
                }, event);
            } else {
                showGlassToast('error', 'Load Failed', 'No image available', false, undefined, '<i class="fas fa-camera-slash"></i>');
            }
            break;
        case 'delete-preview':
            deleteManualPreviewImage();
            break;
        case 'toggle-favorite':
            if (window.currentManualPreviewImage) {
                togglePinImage(window.currentManualPreviewImage, manualPreviewPinBtn);
            } else {
                showGlassToast('error', 'Pin Failed', 'No image available', false, undefined, '<i class="fas fa-image-slash"></i>');
            }
            break;

        case 'download':
            if (previewImage && previewImage.dataset.blobUrl) {
                const blobUrl = previewImage.dataset.blobUrl;
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `generated-image-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
            break;

        case 'copy':
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
                    if (showGlassToast) {
                        showGlassToast('success', 'Image copied to clipboard!', `(${sizeText})`, false, 3000, '<i class="fa-regular fa-clipboard-check"></i>');
                    }
                } catch (error) {
                    console.error('Failed to copy image to clipboard:', error);
                    if (showGlassToast) {
                        showGlassToast('error', 'Failed to copy image to clipboard', '', false, 3000, '<i class="fa-regular fa-clipboard"></i>');
                    }
                }
            }
            break;

        case 'open-in-window':
            // Open image in a new image viewer window with full image data
            const viewer = openGalleryImageInViewer(image);
            if (viewer && viewer.element) {
                // Store the full image data in the modal's dataset for future features
                viewer.element.dataset.imageData = JSON.stringify(image);
            }
            break;

        case 'scrap-preview':
            if (window.currentManualPreviewImage) {
                if (currentGalleryView === 'scraps') {
                    removeFromScraps(window.currentManualPreviewImage);
                } else {
                    moveManualPreviewToScraps();
                }
            }
            break;

        case 'start-chat':
            if (window.currentManualPreviewImage && window.chatSystem) {
                const imageData = window.currentManualPreviewImage;
                const filename = imageData.upscaled || imageData.original || imageData.filename;
                if (filename) {
                    const characterName = imageData.characterName || imageData.metadata?.character_name || null;
                    window.chatSystem.openChatModal(filename, characterName);
                }
            }
            break;

        case 'set-wallpaper':
            // Open desktop settings modal with this image
            openDesktopSettingsModal(`file:${filename}`);
            break;

        case 'upscale':
            if (window.currentManualPreviewImage) {
                upscaleImage(window.currentManualPreviewImage, event);
            } else {
                showGlassToast('error', 'Upscale Failed', 'No image available', false, undefined, '<i class="fas fa-image-slash"></i>');
            }
            break;

        case 'expand-canvas':
            if (window.currentManualPreviewImage) {
                try {
                    // Check if WebSocket is connected
                    if (!wsClient || !wsClient.isConnected()) {
                        throw new Error('WebSocket not connected. Please check your connection.');
                    }

                    const filename = window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;

                    // Use existing metadata and dimensions from currentManualPreviewImage
                    const imageDimensions = {
                        width: window.currentManualPreviewImage.width,
                        height: window.currentManualPreviewImage.height,
                        resPreset: window.currentManualPreviewImage.metadata?.resPreset || window.currentManualPreviewImage.metadata?.resolution
                    };

                    // Open the expansion modal
                    openImageExpansionModal(filename, imageDimensions);
                } catch (error) {
                    console.error('Expand error:', error);
                    showGlassToast('error', 'Error', error.message || 'Failed to open expansion modal', false, 5000, '<i class="nai-cross"></i>');
                }
            } else {
                showGlassToast('error', 'Expand Failed', 'No image available', false, undefined, '<i class="fas fa-image-slash"></i>');
            }
            break;

        case 'create-desktop-shortcut':
            // Create desktop shortcut for this image
            createDesktopShortcutFromImage(image);
            break;
    }
}

/**
 * Initialize context menu for manual preview image
 */
function initializeManualPreviewImageContextMenu() {
    if (!window.contextMenu || !manualPreviewImage) {
        console.warn('Context menu system or manualPreviewImage element not available');
        return;
    }

    // Create and store the context menu configuration
    const contextMenuConfig = createManualPreviewImageContextMenuConfig();

    // Attach context menu to manualPreviewImage
    window.contextMenu.attachToElement(manualPreviewImage, contextMenuConfig);
}

// Add context menu event listener for manual preview image
document.addEventListener('contextMenuAction', handleManualPreviewImageContextMenuAction);

// ============================================================================
// MANUAL MODAL MANAGEMENT FUNCTIONS (MOVED FROM app.js)
// ============================================================================

function showManualPreview(setResolutionDimensions = false) {
    // Check modal width for windowed modals, window width for non-windowed
    const isWindowed = manualModal.classList.contains('windowed');
    const modalWidth = isWindowed ? manualModal.offsetWidth : window.innerWidth;
    const shouldShowPreview = modalWidth <= 1100;

    if (shouldShowPreview) {
        const previewSection = document.getElementById('manualPanelSection');
        if (previewSection) {
            previewSection.classList.add('active');
        }
        manualModal.classList.add('show-preview');
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
    manualModal.classList.remove('show-preview');
}

function calculatePreviewRatio() {
    const container = document.querySelector('.manual-preview-image-container');
    if (!container) return 1;

    const computedStyle = getComputedStyle(container);
    const width = parseFloat(computedStyle.width);
    const height = parseFloat(computedStyle.height);

    if (width > 0 && height > 0) {
        previewRatio = width / height;
    }

    return previewRatio;
}


let manualPreviewSize = { height: 0, width: 0 };

function sizeManualPreviewContainer(imageWidth, imageHeight) {
    const container = document.querySelector('.manual-preview-image-container-inner');
    if (!container) return;

    if (!imageWidth || !imageHeight) {
        if (manualPreviewSize.width === 0 && manualPreviewSize.height === 0)
            return;

        imageWidth = manualPreviewSize.width;
        imageHeight = manualPreviewSize.height;
    } else {
        manualPreviewSize.width = imageWidth;
        manualPreviewSize.height = imageHeight;
    }

    const imageAspectRatio = imageWidth / imageHeight;

    // Reset orientation classes
    container.classList.remove('tall', 'wide');

    // Add orientation classes based on image aspect ratio compared to outer container
    if (imageAspectRatio > calculatePreviewRatio()) {
        // Image is wider than container ratio
        container.classList.add('wide');
    } else {
        // Image is taller than container ratio
        container.classList.add('tall');
    }
}

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

function createConfettiClassic() {
    if (!confettiContainer) return;

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
                confetti.style.borderLeft = (size / 2) + 'px solid transparent';
                confetti.style.borderRight = (size / 2) + 'px solid transparent';
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

function createSakuraPetals() {
    if (!confettiContainer) return;

    const petalColors = [
        ['#fff5f7', '#ffe4ec'],
        ['#ffe4ec', '#ffb7c5'],
        ['#ffd6e0', '#ff9ebb'],
        ['#fff0f5', '#ffc0cb'],
        ['#fce4ec', '#f8bbd9'],
        ['#ffffff', '#ffe4ec']
    ];

    const totalPieces = 160;

    for (let i = 0; i < totalPieces; i++) {
        setTimeout(() => {
            const petal = document.createElement('div');
            petal.className = 'sakura-petal';

            const w = Math.random() * 8 + 8;
            const h = Math.random() * 10 + 12;
            petal.style.width = w + 'px';
            petal.style.height = h + 'px';
            petal.style.left = Math.random() * 100 + 'vw';

            const [c1, c2] = petalColors[Math.floor(Math.random() * petalColors.length)];
            const angle = Math.floor(Math.random() * 40) + 100;
            petal.style.background = `linear-gradient(${angle}deg, ${c1}, ${c2})`;
            petal.style.borderRadius = '50% 50% 50% 0';

            const startRot = Math.random() * 360;
            petal.style.setProperty('--sakura-start-rot', startRot + 'deg');
            petal.style.setProperty('--sakura-drift', (Math.random() * 80 - 40) + 'px');

            if (i % 3 === 0) {
                petal.style.left = (Math.random() * 25 - 12) + 'vw';
            } else if (i % 3 === 1) {
                petal.style.left = (78 + Math.random() * 22) + 'vw';
            }

            const duration = 6 + Math.random() * 4;
            const delay = Math.random() * 2;
            petal.style.animationDuration = duration + 's';
            petal.style.animationDelay = delay + 's';

            confettiContainer.appendChild(petal);

            setTimeout(() => {
                if (petal.parentNode) {
                    petal.parentNode.removeChild(petal);
                }
            }, (duration + delay) * 1000 + 1000);
        }, i * 28);
    }
}

function createConfetti() {
    if (generationCelebrationEffect === 'sakura') {
        createSakuraPetals();
    } else {
        createConfettiClassic();
    }
}

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

function startPreviewAnimation() {
    if (generationAnimationActive) return;

    // Safety check: ensure all required elements exist
    if (!previewContainer || !previewStars || !previewBackgroundLines || !previewForegroundLines) {
        console.warn('Preview animation elements not found, falling back to manual loading overlay');
        return;
    }

    try {
        generationAnimationActive = true;

        manualForm.classList.add('generating');

        const toggleBtn = document.getElementById('previewAnimationToggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-stop"></i>';
            toggleBtn.title = 'Stop Preview Animation';
        }

        /* if (manualPreviewImage && !manualPreviewImage.classList.contains('hidden')) {
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
        } */

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

        // Note: Don't hide dynamic generation progress overlay here
        // It should manage its own visibility based on generation phases
        // Debug: ensure background lines are visible
    } catch (error) {
        console.error('Error starting preview animation:', error);
        generationAnimationActive = false;
    }
}

async function stopPreviewAnimation() {
    // Note: Don't hide dynamic generation progress overlay here
    // It should manage its own visibility based on generation phases

    if (!generationAnimationActive) return;

    manualForm.classList.remove('generating');

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

        // Track completion of both line container animations
        let linesCompleted = 0;
        const totalLines = 2;

        const handleLineFadeComplete = (e) => {
            // Only handle fadeOutContainer animation
            if (e.animationName === 'fadeOutContainer') {
                e.target.removeEventListener('animationend', handleLineFadeComplete);
                linesCompleted++;

                // When both lines have finished, fade out stars
                if (linesCompleted === totalLines && previewStars) {
                    previewStars.style.opacity = '0';

                    // Wait for stars transition to complete (3s), then hide everything
                    const handleStarsFadeComplete = (e) => {
                        if (e.target === previewStars && e.propertyName === 'opacity') {
                            previewStars.removeEventListener('transitionend', handleStarsFadeComplete);

                            // Hide everything after fade out completes
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
                        }
                    };
                    previewStars.addEventListener('transitionend', handleStarsFadeComplete);
                }
            }
        };

        // Listen for animation end on both line containers
        previewBackgroundLines.addEventListener('animationend', handleLineFadeComplete);
        previewForegroundLines.addEventListener('animationend', handleLineFadeComplete);

        /* if (manualBlockContainer) {
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
        } */
    } catch (error) {
        console.error('Error stopping preview animation:', error);
        // Force reset animation state
        forceStopPreviewAnimation().catch(err => {
            console.error('Error in force stop preview animation:', err);
        });
    }
}

// Force stop preview animation (utility function for emergency stops)
async function forceStopPreviewAnimation() {
    if (generationAnimationActive) {
        generationAnimationActive = false;
    }

    manualForm.classList.remove('generating');

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
    /* if (manualBlockContainer) {
        try {
            manualBlockContainer.unload();
            manualBlockContainer = null;
        } catch (error) {
            console.warn('Failed to unload manual block container:', error);
        }
    } */
}

// Show manual modal loading overlay
function showManualLoading(show, message = 'Generating Image...') {
    if (!manualModal.classList.contains('hidden') && show) {
        // Check if preview section is visible before starting animation
        const previewIsVisible = previewSection && (previewSection.classList.contains('active') || previewSection.classList.contains('show'));

        if (previewIsVisible) {
            // Preview is visible, use preview animation
            startPreviewAnimation();
            return;
        } else {
            // Preview not visible yet, show and activate it first
            if (previewSection) {
                previewSection.classList.add('active', 'show');
            }
            showManualPreview();
            // Small delay to ensure DOM updates, then start animation
            setTimeout(() => {
                startPreviewAnimation();
            }, 10);
            return;
        }
    } else if (!show) {
        // Stop preview animation when generation completes (show=false), but not during streaming
        if (!manualForm || !manualForm.classList.contains('streaming')) {
            stopPreviewAnimation();
        }
        return;
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

/**
 * Clear manual form - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function clearManualForm() {
    // Clean up any existing blob URLs
    cleanupBlobUrls();

    manualForm.reset();

    manualModal.classList.remove('show-preview', 'min-controls');

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

    // Reset auto-clean UC toggle
    if (ucPresetsDropdownBtn) {
        ucPresetsDropdownBtn.dataset.autoClean = 'on';
    }

    // Clear generated image name display
    window.lastGeneratedImageName = null;
    updateGeneratedImageNameDisplay(null);

    // Reset dynamic generation buttons to default states
    const dynamicGenButtons = [
        { btn: todBtn, defaultState: 'off' },
        { btn: weatherBtn, defaultState: 'off' },
        { btn: seasonBtn, defaultState: 'off' },
        { btn: dynamicCarousel, defaultState: 'off' },
        { btn: creativeBtn, defaultState: 'off' }
    ];

    dynamicGenButtons.forEach(({ btn, defaultState }) => {
        if (btn) {
            btn.setAttribute('data-state', defaultState);
            btn.classList.toggle('active', defaultState === 'on');
            btn.removeAttribute('data-override'); // Clear any overrides
            btn.removeAttribute('data-context-locked'); // Clear context lock

            // Clear weather location data for weather button
            if (btn === weatherBtn) {
                btn.removeAttribute('data-location');
                delete btn.dataset.locationDisplay;
            }

            // Update TOD button icon when reset
            if (btn.id === 'todBtn') {
                updateTodButtonIcon();
            }

            // Clear creative button options
            if (btn.id === 'creativeBtn') {
                btn.removeAttribute('data-toggle-clothing');
                btn.removeAttribute('data-toggle-action');
            }

            // Reset season button holiday and guidance toggles to default (true)
            if (btn.id === 'seasonBtn') {
                btn.setAttribute('data-toggle-holiday', 'true');
                btn.setAttribute('data-toggle-guidance', 'true');
            }

            // Reset dynamicCarousel specific attributes
            if (btn === dynamicCarousel) {
                btn.removeAttribute('data-fast-mode');
                btn.removeAttribute('data-chain-updates');
                btn.removeAttribute('data-expire-preview');
                btn.removeAttribute('data-force-refresh');
                btn.removeAttribute('data-use-cache');
                btn.removeAttribute('data-creative-directive-strategy');
                btn.removeAttribute('data-creative-directive-tool-passes');
                btn.removeAttribute('data-creative-directive-dialogs');
                btn.removeAttribute('data-ai-temperature');
            }
        }
    });

    // Clear dynamic generation data
    if (window.dynamicGenerationData) {
        delete window.dynamicGenerationData;
    }

    // Reset new parameters
    selectedDatasets = []; // Default to anime enabled
    datasetBias = {};
    if (window.optionsData?.datasets) {
        window.optionsData.datasets.forEach(dataset => {
            datasetBias[dataset.value] = 1.0;
        });
    }

    // Reset NSFW settings to defaults
    selectedNsfwValue = 0; // Default to Neutral
    nsfwBias = 1.0; // Default bias

    // Update NSFW button display
    updateNsfwButtonDisplay();
    updateDatasetDisplay();
    renderDatasetDropdown();

    appendQuality = true;

    autoPositionBtn.setAttribute('data-state', 'on');

    selectedUcPreset = 3; // Default to "Heavy"
    selectUcPreset(3);
    renderUcPresetsDropdown();

    // Update prompt status icons after clearing form
    updatePromptStatusIcons();

    // Clear generating state
    isGenerating = false;
    updateManualGenerateBtnState();
    forceStopPreviewAnimation();


    // Reset preset name field
    manualPresetName.disabled = false;

    // Reset creative directive input
    if (creativeDirectiveInput) {
        creativeDirectiveInput.value = '';
    }

    // Reset creative tab state and show-both mode
    const creativeTabBtn = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-btn[data-tab="creative"]');
    const toggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
    const creativeTab = document.getElementById('creative-tab');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const showBothBtn = document.getElementById('showBothBtn');

    // Reset show-both mode
    if (promptTabs) {
        promptTabs.classList.remove('show-both');
    }
    if (showBothBtn) {
        showBothBtn.dataset.state = 'off';
        showBothBtn.classList.remove('active');
    }

    // Hide creative tab button
    if (creativeTabBtn) {
        creativeTabBtn.classList.add('hidden');
    }
    if (toggleGroup) {
        toggleGroup.classList.remove('three-tabs');
    }

    // If creative tab is active, switch to prompt tab
    if (creativeTab && creativeTab.classList.contains('active')) {
        switchManualTab('prompt');
    }

    manualPresetName.style.opacity = '1';

    // Reset text replacement locks
    window.lockedTextReplacements = [];
    if (window.lastGenerationTextReplacements) {
        delete window.lastGenerationTextReplacements;
    }
    updateMainLockButtonState();
    updateDynamicGenerationToggleBtn();

    variationImage.src = '';

    // Reset transformation section states
    if (transformationRow) {
        transformationRow.classList.remove('display-image');
    }

    document.getElementById('manualImg2ImgGroup').classList.add('hidden');

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

    const directorBtn = document.getElementById('directorBtn');
    if (directorBtn) {
        delete directorBtn.dataset.directorSessionId;
        delete directorBtn.dataset.directorMessageId;
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
    clearDirectorReference();

    // Clear pipeline stages
    clearPipelineStages();
    clearTextOverlays();

    // Clear request body replacements
    if (typeof requestBodyReplacements !== 'undefined') {
        requestBodyReplacements = [];
    }

    // Reset sprout seed button state
    if (sproutSeedBtn) {
        sproutSeedBtn.setAttribute('data-state', 'off');
        manualSeed.disabled = false;
    }
    varietyBtn.setAttribute('data-state', 'off');

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
    window.lastLoadedSeed = null;
    updateSproutSeedButtonFromPreviewSeed();

    updateAutoPositionToggle();
    updatePercentageOverlays();

    // Hide image bias dropdown
    hideImageBiasDropdown();

    if (clearSeedBtn) clearSeedBtn.classList.add('hidden');

    updateUploadDeleteButtonVisibility();
    updatePipelineStagesHeaderVisibility();
    // Hide autocomplete overlays
    hideCharacterAutocomplete();
    hidePresetAutocomplete();


    manualModal.classList.remove('min-controls');
    manualControlsToggle.querySelector('i').classList.remove('fa-down-to-dotted-line');
    manualControlsToggle.querySelector('i').classList.add('fa-square-sliders');

    // Reset dynamic generation buttons and clear stored data
    const dynamicGenerationButtons = ['todBtn', 'weatherBtn', 'seasonBtn', 'creativeBtn'];
    dynamicGenerationButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.setAttribute('data-state', 'off');
            btn.classList.remove('active');
            btn.removeAttribute('data-override');
            btn.removeAttribute('data-season-mode');
            btn.removeAttribute('data-location');
            btn.removeAttribute('data-location-display');
            btn.removeAttribute('data-token-count');
            btn.removeAttribute('data-lock-subject');
            btn.removeAttribute('data-pipeline-aware');
            btn.removeAttribute('data-initial-prompt-aware');
            btn.removeAttribute('data-use-cache');
            btn.removeAttribute('data-toggle-clothing');
            btn.removeAttribute('data-toggle-action');

            // Reset season button holiday and guidance toggles to default (true)
            if (btnId === 'seasonBtn') {
                btn.setAttribute('data-toggle-holiday', 'true');
                btn.setAttribute('data-toggle-guidance', 'true');
            }
        }
    });

    // Clear stored dynamic generation data
    delete window.dynamicGenerationData;
    dynamicGenerationGroup.classList.add('hidden');

    // Update creative directive visibility
    updateCreativeDirectiveVisibility();

    updatePresetLoadSaveState();
}

/**
 * Collect manual form values - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
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
        presetName: manualPresetName.value ? manualPresetName.value.trim() : undefined,
        autoPositionBtn: document.getElementById('autoPositionBtn'),
        container: characterPromptsContainer,
        characterItems: characterPromptsContainer ? characterPromptsContainer.querySelectorAll('.character-prompt-item') : [],
        characterPrompts: getCharacterPrompts(),
        pipelineStages: getPipelineStages(),
        save_base_output: saveStage0Btn?.dataset.state === 'on',
        skip_pipeline_stages: enableStageGenerationBtn?.dataset.state === 'off'
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

    // Add NSFW settings
    values.dataset_config.nsfw = selectedNsfwValue;
    if (nsfwBias !== 1.0) {
        values.dataset_config.nsfw_bias = nsfwBias;
    }
    values.append_quality = appendQuality;
    if (qualityPresetBias !== 1.0) {
        values.quality_preset_bias = qualityPresetBias;
    }
    values.append_uc = selectedUcPreset;

    // Collect vibe transfer data
    values.vibe_transfer = collectVibeTransferData();
    values.normalize_vibes = vibeNormalizeToggle.getAttribute('data-state') === 'on';

    values.upscale = manualUpscale.getAttribute('data-state') === 'on' ? 2 : undefined;

    // Add request body replacements
    if (typeof requestBodyReplacements !== 'undefined' && requestBodyReplacements.length > 0) {
        values.text_replacements = requestBodyReplacements;
    }

    return values;
}

/**
 * Collect vibe transfer data - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function collectVibeTransferData() {
    if (!vibeReferencesContainer) return [];

    const vibeTransferItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');
    const vibeTransfers = [];

    vibeTransferItems.forEach(item => {
        const vibeId = item.getAttribute('data-vibe-id');
        const ieDropdownBtn = item.querySelector('.custom-dropdown-btn');
        const ratioInput = item.querySelector('input.vibe-reference-ratio-input');
        // Check if the main vibe toggle (power icon) is disabled
        const allIndicators = item.querySelectorAll('.vibe-reference-controls .indicator');
        let mainToggle = null;
        let textInjectionToggle = null;

        allIndicators.forEach(indicator => {
            if (indicator.querySelector('.fa-power-off')) {
                mainToggle = indicator;
            } else if (indicator.querySelector('.fa-indent')) {
                textInjectionToggle = indicator;
            }
        });

        const disabledVibe = mainToggle && mainToggle.getAttribute('data-state') === 'off';

        // Skip disabled vibe references (main toggle is off)
        if (disabledVibe) {
            return;
        }

        // Get text injection toggle state
        const textInjectionEnabled = textInjectionToggle ? textInjectionToggle.getAttribute('data-state') === 'on' : true;

        if (vibeId && ieDropdownBtn && ratioInput) {
            const selectedIe = ieDropdownBtn.dataset.selectedIe;
            const strength = parseFloat(ratioInput.value) || 0.7;

            if (selectedIe) {
                vibeTransfers.push({
                    id: vibeId,
                    ie: selectedIe,
                    strength: strength,
                    inject_text: textInjectionEnabled
                });
            }
        }
    });

    return vibeTransfers;
}

/**
 * Extract locked dynamic replacements from the compiled prompt
 * @returns {Array} Array of locked replacements
 */
function extractLockedDynamicReplacements() {
    const lockedReplacements = [];

    if (!window.dynamicGenerationData?.compiled_prompt?.text_replacements) {
        return lockedReplacements;
    }

    const textReplacements = window.dynamicGenerationData.compiled_prompt.text_replacements;

    // Extract locked replacements from prompt
    if (textReplacements.prompt && Array.isArray(textReplacements.prompt)) {
        textReplacements.prompt.forEach(rep => {
            if (rep.locked === true) {
                lockedReplacements.push({
                    ...rep,
                    targetType: 'prompt',
                    targetSource: 'base'
                });
            }
        });
    }

    // Extract locked replacements from UC (negative prompt)
    if (textReplacements.uc && Array.isArray(textReplacements.uc)) {
        textReplacements.uc.forEach(rep => {
            if (rep.locked === true) {
                lockedReplacements.push({
                    ...rep,
                    targetType: 'uc',
                    targetSource: 'base'
                });
            }
        });
    }

    // Extract locked replacements from character prompts
    if (textReplacements.character_prompts && Array.isArray(textReplacements.character_prompts)) {
        textReplacements.character_prompts.forEach((char, charIndex) => {
            if (char?.prompt && Array.isArray(char.prompt)) {
                char.prompt.forEach(rep => {
                    if (rep.locked === true) {
                        lockedReplacements.push({
                            ...rep,
                            targetType: 'character',
                            targetSource: charIndex,
                            targetField: 'prompt'
                        });
                    }
                });
            }
            if (char?.uc && Array.isArray(char.uc)) {
                char.uc.forEach(rep => {
                    if (rep.locked === true) {
                        lockedReplacements.push({
                            ...rep,
                            targetType: 'character',
                            targetSource: charIndex,
                            targetField: 'uc'
                        });
                    }
                });
            }
        });
    }

    return lockedReplacements;
}

/**
 * Add shared fields to request body - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
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

    // Add auto-clean UC setting
    if (ucPresetsDropdownBtn) {
        requestBody.auto_clean_uc = ucPresetsDropdownBtn.dataset.autoClean === 'on';
    }

    // Collect dynamic generation data from current button states
    const todBtn = document.getElementById('todBtn');
    const weatherBtn = document.getElementById('weatherBtn');
    const seasonBtn = document.getElementById('seasonBtn');
    const creativeBtn = document.getElementById('creativeBtn');

    // Collect current button states
    const dynamicData = {
        tod: collectDynamicButtonState(todBtn),
        weather: collectDynamicButtonState(weatherBtn),
        season: collectDynamicButtonState(seasonBtn),
        observeHoliday: seasonBtn?.dataset.toggleHoliday !== 'false', // Default true
        guidance: seasonBtn?.dataset.toggleGuidance !== 'false', // Default true
        clothing: creativeBtn?.dataset.toggleClothing === 'true',
        action: creativeBtn?.dataset.toggleAction === 'true',
        creative: creativeBtn?.dataset.state === 'on',
        optimize: dynamicCarousel?.dataset.optimizeEnabled === 'true' ? {
            enabled: true,
            tokenCount: dynamicCarousel.dataset.tokenCount === 'true',
            pipelineAware: dynamicCarousel.dataset.pipelineAware === 'true',
            initialPromptAware: dynamicCarousel.dataset.initialPromptAware === 'true',
            twoStage: dynamicCarousel.dataset.twoStage === 'true'
        } : false,
        pipelineAware: dynamicCarousel?.dataset.pipelineAware === 'true',
        initialPromptAware: dynamicCarousel?.dataset.initialPromptAware === 'true',
        lockSubject: dynamicCarousel?.dataset.lockSubject === 'true',
        fast_mode: dynamicCarousel?.dataset.fastMode === 'true',
        cache_locked: dynamicCarousel?.dataset.state === 'on',
        context_locked: dynamicCarousel?.dataset.contextLocked === 'true',
        expire_preview: dynamicCarousel?.dataset.expirePreview === 'true',
        use_cache_responses: dynamicCarousel?.getAttribute('data-use-cache') === 'false' ? false : undefined,
        chain_updates: dynamicCarousel?.dataset.chainUpdates === 'true' ? true : false, // Default to false
        force_context_refresh: dynamicCarousel?.dataset.forceRefresh === 'true' ? true : undefined // Force context update in chain mode
    };

    // Add weather location data if available
    if (weatherBtn && dynamicData.weather && weatherBtn.getAttribute('data-location')) {
        dynamicData.location = weatherBtn.getAttribute('data-location');
    }

    // Add AI temperature if available
    if (dynamicCarousel && dynamicCarousel.dataset.aiTemperature) {
        dynamicData.ai_temperature = parseFloat(dynamicCarousel.dataset.aiTemperature);
    }

    // Always include dynamic_generation if any button has been configured (even if turned off)
    // This ensures the server receives the seasonal parameter even when set to false
    const hasAnyConfiguration = Object.values(dynamicData).some(value =>
        value !== undefined && value !== false && value !== null && value !== ''
    );

    if (hasAnyConfiguration && dynamicGenerationToggleBtn?.getAttribute('data-state') !== 'off') {
        // Preserve existing compiled prompt and other data
        const existingData = window.dynamicGenerationData || {};

        const fullDynamicData = {
            ...dynamicData,
            compiled_prompt: existingData.compiled_prompt // Always include compiled_prompt (preserves previousResponseId for stateful conversation)
        };

        // Add creative directive if present (regardless of optimize button state)
        // Directive should always be collected when dynamic generation is enabled
        if (creativeDirectiveInput && creativeDirectiveInput.value && creativeDirectiveInput.value.trim() !== '') {
            fullDynamicData.directive = creativeDirectiveInput.value.trim();
        }

        // Add forced strategy if set (null means auto, so only add if explicitly set)
        const strategyValue = dynamicCarousel?.dataset.creativeDirectiveStrategy;
        if (strategyValue && strategyValue !== '' && strategyValue !== null && strategyValue !== undefined) {
            fullDynamicData.force_strategy = strategyValue;
        }

        // Add tool passes setting from carousel dataset
        const toolPassesValue = dynamicCarousel?.dataset.creativeDirectiveToolPasses;
        if (toolPassesValue) {
            const parsedValue = parseInt(toolPassesValue);
            if (!isNaN(parsedValue)) {
                fullDynamicData.tool_passes = parsedValue;
            }
        }

        // Add dialogs count setting from carousel dataset
        const dialogsValue = dynamicCarousel?.dataset.creativeDirectiveDialogs;
        if (dialogsValue !== undefined && dialogsValue !== null && dialogsValue !== '') {
            const parsedValue = parseInt(dialogsValue);
            if (!isNaN(parsedValue)) {
                fullDynamicData.dialogs_count = parsedValue;
            }
        }

        // Add locked dynamic replacements if any exist
        const lockedReplacements = extractLockedDynamicReplacements();
        if (lockedReplacements.length > 0) {
            fullDynamicData.locked_replacements = lockedReplacements;
        }

        // Convert observeHoliday to disable_holiday for backend
        if (fullDynamicData.season && fullDynamicData.observeHoliday !== undefined) {
            fullDynamicData.disable_holiday = !fullDynamicData.observeHoliday;
            console.log(`🎄 Season enabled with observeHoliday=${fullDynamicData.observeHoliday}, setting disable_holiday=${fullDynamicData.disable_holiday}`);
        }

        window.dynamicGenerationData = fullDynamicData;
        requestBody.dynamic_generation = fullDynamicData;
    } else {
        if (window.dynamicGenerationData) {
            delete window.dynamicGenerationData;
        }
    }

    // Add director reference data
    const directorRefData = getDirectorReferenceForForgeData();
    if (directorRefData) {
        requestBody.chara_reference_source = `${directorRefData.type}:${directorRefData.id}`;
        if (directorRefData.with_style) {
            requestBody.chara_reference_with_style = true;
        }
        if (directorRefData.fidelity) {
            requestBody.chara_reference_fidelity = directorRefData.fidelity;
        }
    }

    // Add text replacement locks
    if (window.lockedTextReplacements && Array.isArray(window.lockedTextReplacements)) {
        requestBody.text_replacements_seed = window.lockedTextReplacements;
    }

    // Add request body replacements (for stage-specific text replacements)
    if (values.text_replacements && Array.isArray(values.text_replacements) && values.text_replacements.length > 0) {
        requestBody.text_replacements = values.text_replacements;
    }

    // Add locked text replacements if any are set
    if (window.lockedTextReplacements && Array.isArray(window.lockedTextReplacements) && window.lockedTextReplacements.length > 0) {
        requestBody.text_replacements_seed = window.lockedTextReplacements;
    }

    // Add pipeline stages if any exist
    const pipelineStages = getPipelineStages();
    if (pipelineStages && pipelineStages.length > 0) {
        requestBody.pipeline = pipelineStages;
        // Add saveStage0 flag if button is enabled
        if (saveStage0Btn?.dataset.state === 'on') {
            requestBody.save_base_output = true;
        }
        // Add skip_pipeline_stages flag
        if (enableStageGenerationBtn?.dataset.state === 'off') {
            requestBody.skip_pipeline_stages = true;
        }

        // Add compiled prompts array if we have stage seeds loaded
        if (window.lastGenerationStageSeeds && Array.isArray(window.lastGenerationStageSeeds)) {
            const compiledPrompts = [];
            window.lastGenerationStageSeeds.forEach((stageSeed) => {
                if (stageSeed?.dynamic_generation) {
                    compiledPrompts.push(stageSeed.dynamic_generation);
                } else {
                    compiledPrompts.push(null);
                }
            });
            if (compiledPrompts.length > 0) {
                requestBody.stage_compiled_prompts = compiledPrompts;
                console.log(`📋 Sending ${compiledPrompts.length} compiled prompts with request`);
            }
        }
    }

    // Add text overlay data if any exist
    const textOverlayData = getTextOverlayData();
    if (textOverlayData && textOverlayData.length > 0) {
        requestBody.text_overlays = textOverlayData;
    }
}

// Get current weather units preference from localStorage
function getUseMetricPreference() {
    return localStorage.getItem('weather_units_metric') !== 'false'; // Default to true if not set
}

// Convert temperature based on preference
function formatTemperature(celsius) {
    if (celsius === null || celsius === undefined) {
        return { number: '--', unit: '°C' };
    }

    const useMetric = getUseMetricPreference();
    if (useMetric) {
        return { number: Math.round(celsius).toString(), unit: '°C' };
    } else {
        const fahrenheit = Math.round((celsius * 9 / 5) + 32);
        return { number: fahrenheit.toString(), unit: '°F' };
    }
}

// Get weather icon using Weather Icons theme
function getWeatherIcon(condition, isNight = false) {
    if (!condition) return isNight ? '<i class="wi wi-night-clear"></i>' : '<i class="wi wi-day-sunny"></i>';

    const timePrefix = isNight ? 'night-alt' : 'day';

    // Icons that don't change between day/night (no sun/moon influence)
    const timeNeutralIcons = {
        'overcast': 'cloudy',
        'fog': 'fog',
        'depositing rime fog': 'fog',
        'moderate snow fall': 'snow',
        'heavy snow fall': 'snow',
        'snow grains': 'snow',
        'heavy snow showers': 'snow'
    };

    // Check if this condition uses a time-neutral icon
    if (timeNeutralIcons[condition]) {
        return `<i class="wi wi-${timeNeutralIcons[condition]}"></i>`;
    }

    // Time-dependent icons (different for day/night)
    const iconMap = {
        'clear sky': isNight ? 'night-clear' : 'day-sunny',
        'mainly clear': isNight ? 'night-alt-partly-cloudy' : 'day-sunny-overcast',
        'partly cloudy': `${timePrefix}-cloudy`,
        'light drizzle': `${timePrefix}-showers`,
        'moderate drizzle': `${timePrefix}-showers`,
        'dense drizzle': `${timePrefix}-showers`,
        'light freezing drizzle': `${timePrefix}-snow`,
        'dense freezing drizzle': `${timePrefix}-snow`,
        'slight rain': `${timePrefix}-rain`,
        'moderate rain': `${timePrefix}-rain`,
        'heavy rain': `${timePrefix}-rain`,
        'light freezing rain': `${timePrefix}-snow`,
        'heavy freezing rain': `${timePrefix}-snow`,
        'slight snow fall': `${timePrefix}-snow`,
        'slight rain showers': `${timePrefix}-showers`,
        'moderate rain showers': `${timePrefix}-rain`,
        'violent rain showers': `${timePrefix}-storm-showers`,
        'slight snow showers': `${timePrefix}-snow`,
        'thunderstorm': `${timePrefix}-thunderstorm`,
        'thunderstorm with slight hail': `${timePrefix}-thunderstorm`,
        'thunderstorm with heavy hail': `${timePrefix}-thunderstorm`
    };

    const iconClass = iconMap[condition] || (isNight ? 'night-clear' : 'day-sunny');
    return `<i class="wi wi-${iconClass}"></i>`;
}

// Update dynamic generation overlay in manual preview
function updateDynamicGenerationOverlay(context) {
    const overlay = document.getElementById('dynamicGenerationOverlay');
    const overlayBody = document.getElementById('dynamicGenerationOverlayBody');

    if (!overlay || !overlayBody) return;

    if (context) {
        const weather = context.weather || {};
        const time = context.time || {};
        const location = context.location || {};
        const timePeriod = context.timePeriod || {};

        // Format actual time
        const timeString = (time.hour !== undefined && time.minute !== undefined)
            ? `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`
            : 'Unknown';

        // Determine if it's night based on isDaytime
        const isNight = timePeriod.isDaytime === false;

        // Get weather icon HTML
        const weatherIconHtml = getWeatherIcon(weather.condition, isNight);

        // Update time display
        const timeDisplay = document.getElementById('overlayTimeDisplay');
        if (timeDisplay) {
            timeDisplay.textContent = timeString;
        }

        // Update weather condition
        const weatherCondition = document.getElementById('overlayWeatherCondition');
        if (weatherCondition) {
            const conditionText = weather.condition || 'Unknown';
            weatherCondition.textContent = conditionText;
        }


        // Update weather condition
        const weatherLocation = document.getElementById('overlayWeatherLocation');
        if (weatherLocation) {
            let conditionText = null;
            // Add city and country if available
            if (location.city && location.country) {
                conditionText = `${location.city}, ${location.country}`;
            } else if (location.city) {
                conditionText = location.city;
            } else if (location.country) {
                conditionText = location.country;
            }
            if (conditionText) {
                weatherLocation.classList.remove('hidden');
                weatherLocation.textContent = conditionText;
            } else {
                weatherLocation.classList.add('hidden');
            }
        }

        // Update weather feels like temperature
        const weatherFeelsLike = document.getElementById('overlayWeatherFeelsLike');
        if (weatherFeelsLike) {
            const tempValue = weather.feelsLike || weather.temperature;
            const tempData = formatTemperature(tempValue);
            const tempNumber = weatherFeelsLike.querySelector('.temp-number');
            const tempUnit = weatherFeelsLike.querySelector('.temp-unit');
            if (tempNumber) tempNumber.textContent = tempData.number;
            if (tempUnit) tempUnit.textContent = tempData.unit;
        }

        // Update weather icon
        const weatherIconContainer = document.getElementById('overlayWeatherIcon');
        if (weatherIconContainer) {
            if (weather.condition) {
                weatherIconContainer.innerHTML = weatherIconHtml;
            } else {
                weatherIconContainer.innerHTML = '<span class="weather-fallback-icon">🌤️</span>';
            }
        }

        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// Unified function to open manual modal and load content
// content: Object with type field, or string (preset name for backwards compatibility). Can be:
//   - null/undefined: Just show modal, don't clear if already open
//   - string: Preset name (legacy format, converted to {type: 'preset', name: string})
//   - {type: 'preset', name: string, uuid: string}: Load preset by name or UUID
//   - {type: 'metadata', data: object}: Load metadata object directly
//   - {type: 'image', image: object}: Load image (metadata fetched automatically)
//   - {type: 'image', metadata: object, image: object}: Load image with provided metadata
// event: Optional event for dialog positioning
// skipContentCheck: If true, skip confirmation check (caller handles it)
// skipContentLoad: If true, skip loading content (just show modal)
async function openManualModalWithContent(content = null, event = null) {
    // Check if modal is already open
    const isRunning = manualModal && !manualModal.classList.contains('hidden');
    const isActiveWindow = isRunning && (!window.isDesktop || modalStack?.indexOf(manualModal) !== -1);

    // Determine what we're loading
    let loadPreset = null;
    let loadMetadata = null;
    let loadImage = null;
    let isImageType = false;
    let needsMetadataFetch = false;
    let hasContentToLoad = false;
    let titleToSet = null;

    if (content && typeof content === 'object' && content?.title) {
        titleToSet = content?.title?.trim();
    }

    if (content && typeof content === 'object' && content.type) {
        switch (content.type) {
            case 'preset':
                if (content.uuid) {
                    loadPreset = { presetUuid: content.uuid };
                    hasContentToLoad = true;
                } else if (content.name) {
                    loadPreset = { presetName: content.name.replace('preset:', '') };
                    hasContentToLoad = true;
                }
                break;
            case 'metadata':
                loadMetadata = content.data;
                hasContentToLoad = true;
                break;
            case 'image':
                isImageType = true;
                loadImage = content.image;
                loadMetadata = content.metadata;
                needsMetadataFetch = !content.metadata && content.image;
                hasContentToLoad = true;
                break;
            case 'none':
                hasContentToLoad = false;
                break;
            default:
                console.warn('Unknown content type:', content.type);
        }
    }

    manualModal.classList.add('initializing');

    // Handle confirmation if we have content to load and modal is already open
    let shouldLoadContent = hasContentToLoad;
    if (hasContentToLoad && window.isDesktop && isRunning) {
        if (!(await checkManualModalBeforeLoad(event))) {
            shouldLoadContent = false;
        }
    }

    // Determine if we need to do destructive setup
    // Only skip destructive actions if modal is already open AND we're not loading content
    const needSetup = !isRunning || shouldLoadContent;

    // Show splash screen if modal is not open and in desktop mode
    if (!isRunning && window.isDesktop) {
        showSplashScreen();
        updateSplashScreenStatus('Opening DreamStudio...');
    }

    // Do destructive setup to put window in known state (only if needed)
    if (needSetup) {
        // Track if we were in search mode before opening modal
        if (!window.isDesktop) {
            wasInSearchMode = isInSearchMode();
            if (wasInSearchMode) closeSearchContainer();
        }

        // Stop any existing preview animation
        if (generationAnimationActive) stopPreviewAnimation();
        manualPreviewOriginalImage.classList.add('hidden');

        manualModal.classList.toggle('windowed', window.isDesktop);
        document.body.classList.toggle('editor-open', !manualModal.classList.contains('windowed'));
        windowPaidToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');

        // Update Android persistent notification body when editor state changes
        if (typeof updateAndroidNotificationBody === 'function') {
            updateAndroidNotificationBody();
        }
    }

    hideLightbox();

    if (isRunning || !window.isDesktop) {
        openModal(manualModal);
    } else {
        manualModal.classList.add('hidden-alt');
        manualModal.classList.remove('hidden');
    }

    // Sync Android caption bar button colors for manualModal open state
    if (window.updateAndroidCaptionControlsOverlay) {
        window.updateAndroidCaptionControlsOverlay();
    }


    // Only load content if user didn't cancel
    if (shouldLoadContent) {
        // For image type, show loading state and fetch metadata if needed
        if (isImageType) {
            const spinnerOverlay = manualModal.querySelector('.spinner-overlay');
            if (spinnerOverlay) spinnerOverlay.classList.remove('hidden');

            if (needsMetadataFetch) {
                try {
                    updateSplashScreenStatus('Fetching metadata...');
                    // Fetch metadata for image
                    if (loadImage.isTempFile && loadImage.metadata) {
                        loadMetadata = loadImage.metadata;
                    } else {
                        const filenameForMetadata = loadImage.filename || loadImage.upscaled || loadImage.original;
                        if (!filenameForMetadata) {
                            throw new Error('No filename available for metadata lookup');
                        }
                        loadMetadata = await getImageMetadata(filenameForMetadata);
                        if (!loadMetadata) {
                            throw new Error('No metadata found for this image');
                        }
                    }
                } catch (error) {
                    manualModal.classList.remove('initializing');
                    if (spinnerOverlay) spinnerOverlay.classList.add('hidden');
                    hideSplashScreen();
                    console.error('Failed to fetch image metadata:', error);
                    throw error;
                }
            }

            // Store metadata and image
            // loadMetadata should always be set (either from content.metadata or fetched)
            // If it's still null/undefined, that's an error condition
            if (!loadMetadata) {
                const filename = loadImage?.filename || loadImage?.upscaled || loadImage?.original;
                showGlassToast('error', 'Metadata Error', `Failed to load metadata for image: ${filename || 'unknown'}`, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
            }
            window.currentEditMetadata = loadMetadata;
            window.currentEditImage = loadImage;
        } else {
            window.currentEditMetadata = null;
            window.currentEditImage = null;
        }

        // Load content into form
        if (loadPreset) {
            updateSplashScreenStatus('Loading preset...');
            const _presetData = await window.wsClient.loadPreset(loadPreset);
            if (_presetData) {
                updateSplashScreenStatus('Processing preset data...');
                let presetData = await convertPresetToMetadataFormat(_presetData);
                if (!presetData.preset_name) {
                    presetData.preset_name = loadPreset.presetName || '';
                }

                // Preprocess sampler and noiseScheduler
                if (presetData.sampler && presetData.sampler !== undefined) {
                    const samplerObj = getSamplerMeta(presetData.sampler);
                    presetData.sampler = samplerObj ? samplerObj.meta : 'k_euler_ancestral';
                }
                if ((presetData.noiseScheduler && presetData.noiseScheduler !== undefined) || (presetData.noise_schedule && presetData.noise_schedule !== undefined)) {
                    const noiseObj = getNoiseMeta(presetData.noiseScheduler || presetData.noise_schedule);
                    presetData.noiseScheduler = noiseObj ? noiseObj.meta : 'karras';
                }

                await loadIntoManualForm('preset', presetData);
            } else {
                console.error('❌ Invalid response structure:', _presetData);
                throw new Error(`Invalid preset response format. Response: ${JSON.stringify(_presetData)}`);
            }
        } else if (loadMetadata) {
            updateSplashScreenStatus('Loading metadata...');
            await loadIntoManualForm('metadata', loadMetadata, loadImage);
        } else if (!isRunning) {
            clearManualForm();
        }

        // Hide loading state for image type
        if (isImageType) {
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
                const filename = loadImage.filename || loadImage.upscaled || loadImage.original;
                if (filename) {
                    const galleryIndex = findTrueImageIndexInGallery(filename);
                    if (galleryIndex >= 0) {
                        await updateManualPreview(galleryIndex);
                    }
                }
            }

            // Save current gallery position
            const isWindowed = manualModal.classList.contains('windowed')
            const firstNonPlaceholder = document.querySelector('.gallery-item:not(.gallery-placeholder)');
            if (!isWindowed && firstNonPlaceholder) {
                savedGalleryPosition = parseInt(firstNonPlaceholder.dataset.index);
            } else {
                savedGalleryPosition = 0;
            }

            if (!isWindowed) {
                galleryClearTimeout = setTimeout(clearGallery, 5000);
            } else {
                clearTimeout(galleryClearTimeout);
            }
        }
    }

    // Set title if provided (works for all content types)
    if (titleToSet) {
        manualPresetName.value = titleToSet;
        updateManualModalTitlebar(titleToSet, true);
    }

    // Update UI states after loading
    updateMainLockButtonState();
    autoResizeTextareasAfterModalShow();
    updateCreativeDirectiveVisibility();
    updatePromptStatusIcons();

    manualModal.classList.remove('initializing');
    manualModal.querySelector('.spinner-overlay').classList.add('hidden');

    openModal(manualModal);

    hideSplashScreen();
    manualPrompt.focus();
}

// Update creative directive visibility based on creative mode and dynamic generation visibility
function updateCreativeDirectiveVisibility() {
    try {
        const creativeBtnEl = document.getElementById('creativeBtn');
        const isCreativeOn = creativeBtnEl && creativeBtnEl.dataset.state === 'on';
        const isDynamicGenVisible = dynamicGenerationGroup && !dynamicGenerationGroup.classList.contains('hidden');

        // Get the creative tab button and toggle group
        const creativeTabBtn = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-btn[data-tab="creative"]');
        const toggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');

        const shouldShowCreativeTab = isCreativeOn && isDynamicGenVisible;

        if (creativeTabBtn) {
            // Show/hide the creative tab button
            creativeTabBtn.classList.toggle('hidden', !shouldShowCreativeTab);
        }

        if (toggleGroup) {
            // Add/remove three-tabs class for proper layout
            toggleGroup.classList.toggle('three-tabs', shouldShowCreativeTab);
        }

        // If creative tab is being hidden and it's currently active, switch to prompt tab
        if (!shouldShowCreativeTab) {
            const creativeTab = document.getElementById('creative-tab');
            if (creativeTab && creativeTab.classList.contains('active')) {
                // Switch to prompt tab using existing function
                switchManualTab('prompt');
            }
        }

        // Ensure single-line until overflow
        if (creativeDirectiveInput) {
            autoResizeTextarea(creativeDirectiveInput, 23);
        }
    } catch (e) {
        // no-op
    }
}

// Update load button state
function updateLoadButtonState() {
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

    // Save current gallery position
    const firstNonPlaceholder = document.querySelector('.gallery-item:not(.gallery-placeholder)');
    if (firstNonPlaceholder) {
        savedGalleryPosition = parseInt(firstNonPlaceholder.dataset.index);
    } else {
        // If no real items found, save position 0
        savedGalleryPosition = 0;
    }

    // Clear gallery after 5 seconds (only if modal is maximized)
    galleryClearTimeout = setTimeout(() => {
        if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) {
            clearGallery();
        }
    }, 5000);
}

// Hide manual modal
async function hideManualModal(e) {
    // Don't close the modal if preventModalReset is true (for generation)
    await closeModal(manualModal);

    // Sync Android caption bar button colors for manualModal closed state
    if (window.updateAndroidCaptionControlsOverlay) {
        window.updateAndroidCaptionControlsOverlay();
    }

    // Update Android persistent notification body when editor closes
    if (typeof updateAndroidNotificationBody === 'function') {
        updateAndroidNotificationBody();
    }

    if (document.body.classList.contains('editor-open')) {
        document.body.classList.remove('editor-open');
    }

    // Handle loading overlay when modal is closed
    showManualLoading(true, 'Generating your image...');

    // Stop preview animation if it's running when modal is closed
    if (generationAnimationActive) {
        stopPreviewAnimation();
    }

    if (previewSection) {
        previewSection.classList.remove('active', 'show');
        hideManualPreview();
    }
    clearManualForm();

    // Reset manual preview
    resetManualPreview();

    // Hide stage indicators when modal is closed
    hideStageIndicators();

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
    window.lastGeneratedImageName = null;
    // Director new session functionality is always available

    // Clear generated image name display
    updateGeneratedImageNameDisplay(null);

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
    if (divider) {
        divider.classList.add('hidden');
    }
    // Hide keyboard shortcuts overlay
    hideShortcutsOverlay();

    // Update button state
    updateManualGenerateBtnState();

    if (!window.isDesktop) {
        restoreGalleryState();
    }
}

async function restoreGalleryState() {
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
    }
    if (savedGalleryPosition !== null) {
        displayGalleryFromStartIndex(savedGalleryPosition);
        savedGalleryPosition = null;
    } else {
        displayGalleryFromStartIndex(0);
    }
}

async function loadIntoManualForm(type = 'metadata', source, image = null) {
    try {
        updateSplashScreenStatus('Loading File...');

        let data = {};
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

        if (typeof source === 'object' && source !== null) {
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
        updateSplashScreenStatus('Configuring Parameters...');
        if (manualPrompt) {
            manualPrompt.value = data.prompt || '';
        }
        if (manualUc) {
            manualUc.value = data.uc || '';
            autoResizeTextarea(manualUc);
            updateEmphasisHighlighting(manualUc);
        }

        // Load creative directive if present in dynamic_generation
        if (creativeDirectiveInput && data.dynamic_generation && data.dynamic_generation.directive) {
            creativeDirectiveInput.value = data.dynamic_generation.directive;
            autoResizeTextarea(creativeDirectiveInput, 23);
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
                // No exact match found, use custom resolution
                resolutionToSet = 'custom';
                resolutionGroup = 'Custom';
                // Set custom dimensions before calling selectManualResolution
                if (manualWidth) manualWidth.value = data.width;
                if (manualHeight) manualHeight.value = data.height;
            }
        } else if (data.resolution) {
            // Fall back to existing resolution field if no dimensions
            resolutionToSet = data.resolution.toLowerCase();
        }
        await selectManualResolution(resolutionToSet, resolutionGroup);

        // Handle custom dimensions after resolution is set
        if (data.width && data.height && resolutionToSet === 'custom') {
            if (manualWidth && manualHeight) {
                manualWidth.value = data.width;
                manualHeight.value = data.height;
                // Update the hidden resolution field immediately after setting values
                updateCustomResolutionValue();
            }
            // Sanitize dimensions after setting
            sanitizeCustomDimensions();
        }

        // Update resolution area toggle based on image area
        if (data.width && data.height) {
            const imageArea = data.width * data.height;
            const resolutionAreaToggle = document.getElementById('resolutionAreaToggle');

            if (resolutionAreaToggle) {
                // Set area limit based on image size
                if (imageArea > 2166784) {
                    currentMaxArea = 3047424; // Max (3MP)
                    resolutionAreaToggle.textContent = 'Max';
                } else if (imageArea > 1048576) {
                    currentMaxArea = 2166784; // Large (2MP)
                    resolutionAreaToggle.textContent = 'Large';
                } else {
                    currentMaxArea = 1048576; // Normal (1MP)
                    resolutionAreaToggle.textContent = 'Normal';
                }
            }
        }

        if (manualSteps) manualSteps.value = data.steps || 25;
        if (manualGuidance) {
            // Handle both preset (guidance) and metadata (scale) formats
            const guidanceValue = data.guidance ?? data.scale ?? 5.0;
            manualGuidance.value = guidanceValue !== undefined ? (Number(guidanceValue) >= 10 ? Number(guidanceValue).toString() : Number(guidanceValue).toFixed(2)) : '';
        }
        if (manualRescale) {
            // Handle both preset (rescale) and metadata (cfg_rescale) formats
            const rescaleValue = data.rescale ?? data.cfg_rescale ?? 0.0;
            manualRescale.value = rescaleValue !== undefined ? Number(rescaleValue).toFixed(2) : '';
        }

        if (manualSeed) manualSeed.value = ''; // Do not autofill for metadata, undefined for others
        if (data.seed) {
            // Handle both preset (seed) and metadata (layer2_seed) formats
            window.lastGeneratedSeed = data.seed;
            sproutSeedBtn.classList.add('available');
            updateSproutSeedButtonFromPreviewSeed();
            addSeedToHistory(data.seed);
        }

        // Ensure sampler and noiseScheduler have valid values before calling select functions
        const samplerValue = (data.sampler && data.sampler !== undefined && data.sampler !== null) ? data.sampler : 'k_euler_ancestral';
        const noiseValue = (data.noiseScheduler && data.noiseScheduler !== undefined && data.noiseScheduler !== null) ? data.noiseScheduler : 'karras';

        selectManualSampler(samplerValue);
        selectManualNoiseScheduler(noiseValue);

        if (document.getElementById('varietyBtn')) {
            const varietyBtn = document.getElementById('varietyBtn');
            // Handle both preset (variety) and metadata (skip_cfg_above_sigma) formats
            const isVarietyEnabled = data.variety !== null && data.variety !== undefined ? data.variety :
                (data.skip_cfg_above_sigma !== null && data.skip_cfg_above_sigma !== undefined);
            varietyBtn.setAttribute('data-state', isVarietyEnabled ? 'on' : 'off');
            // Update the global varietyEnabled variable used for generation requests
            varietyEnabled = isVarietyEnabled;
        }

        // Handle upscale
        const upscaleState = data.upscale ? 'on' : 'off';
        if (manualUpscale) manualUpscale.setAttribute('data-state', upscaleState);

        // Handle character prompts and auto position
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        if (data.allCharacterPrompts && Array.isArray(data.allCharacterPrompts)) {
            // Handle new allCharacterPrompts format

            // Check if any character has valid coordinates to determine actual use_coords
            const hasValidCoords = data.allCharacterPrompts.some(char =>
                char.center &&
                char.center.x !== null &&
                char.center.y !== null &&
                (char.center.x !== 0.5 || char.center.y !== 0.5)
            );
            const actualUseCoords = hasValidCoords || data.use_coords || false;

            loadCharacterPrompts(data.allCharacterPrompts, actualUseCoords);
            autoPositionBtn.setAttribute('data-state', actualUseCoords ? 'off' : 'on');
        } else if (data.characterPrompts && Array.isArray(data.characterPrompts)) {
            // Check if any character has valid coordinates to determine actual use_coords
            const hasValidCoords = data.characterPrompts.some(char =>
                char.center &&
                char.center.x !== null &&
                char.center.y !== null &&
                (char.center.x !== 0.5 || char.center.y !== 0.5)
            );
            const actualUseCoords = hasValidCoords || data.use_coords || false;

            loadCharacterPrompts(data.characterPrompts, actualUseCoords);
            autoPositionBtn.setAttribute('data-state', actualUseCoords ? 'off' : 'on');
        } else {
            clearCharacterPrompts();
        }

        updateAutoPositionToggle();

        // Load pipeline stages if present
        if (data.pipeline_stages && Array.isArray(data.pipeline_stages)) {
            loadPipelineStages(data.pipeline_stages);
            updateTextOverlayStageVisibility();
        } else {
            clearPipelineStages();
        }

        // Load saveStage0 state
        if (saveStage0Btn && data.save_base_output !== undefined) {
            saveStage0Btn.dataset.state = data.save_base_output ? 'on' : 'off';
        }

        // Load director session and message IDs from metadata if available
        if (data.director_session_id || data.director_message_id) {
            const directorBtn = document.getElementById('directorBtn');
            if (directorBtn) {
                if (data.director_session_id) {
                    directorBtn.dataset.directorSessionId = data.director_session_id;
                }
                if (data.director_message_id) {
                    directorBtn.dataset.directorMessageId = data.director_message_id;
                }
            }
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
                const invalidSettings = [];

                Object.keys(data.dataset_config.settings).forEach(dataset => {
                    const datasetSettings = data.dataset_config.settings[dataset];

                    // Find the dataset config from server options
                    const datasetConfig = window.optionsData?.datasets?.find(d => d.value === dataset);

                    Object.keys(datasetSettings).forEach(settingId => {
                        const setting = datasetSettings[settingId];

                        // Validate that the setting still exists in the server configuration
                        const settingExists = datasetConfig?.sub_toggles?.some(toggle => toggle.id === settingId);

                        if (!settingExists) {
                            // Track invalid settings for notification
                            invalidSettings.push({
                                dataset: dataset,
                                settingId: settingId,
                                datasetDisplay: datasetConfig?.display || dataset
                            });
                        } else if (setting.enabled !== undefined) {
                            // Store setting state for UI updates (only if it exists)
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

                // Show persistent notification if any settings are invalid
                if (invalidSettings.length > 0) {
                    const settingsList = invalidSettings
                        .map(s => `${s.datasetDisplay}: ${s.settingId}`)
                        .join(', ');

                    showGlassToast(
                        'warning',
                        'Dataset Settings',
                        `The following settings are no longer available on the server: ${settingsList}`,
                        false,
                        0, // No timeout - persistent
                        '<i class="fas fa-exclamation-triangle"></i>'
                    );
                }
            }

            // Load NSFW settings
            if (data.dataset_config.nsfw !== undefined) {
                selectedNsfwValue = data.dataset_config.nsfw;
            }
            if (data.dataset_config.nsfw_bias !== undefined) {
                nsfwBias = data.dataset_config.nsfw_bias;
            }

            // Update NSFW button display after loading
            updateNsfwButtonDisplay();
        } else {
            selectedDatasets = []; // Default
            // Reset bias values to defaults for all datasets from config
            datasetBias = {};
            if (window.optionsData?.datasets) {
                window.optionsData.datasets.forEach(dataset => {
                    // Use default value from config, fallback to 1.0
                    datasetBias[dataset.value] = dataset.default !== undefined ? dataset.default : 1.0;
                });
            }
        }

        updateDatasetDisplay();
        renderDatasetDropdown();
        updateSubTogglesButtonState();

        if (data.append_quality !== undefined) {
            appendQuality = !!data.append_quality;
        } else {
            appendQuality = true;
        }

        // Load quality preset bias if available
        if (data.quality_preset_bias !== undefined) {
            qualityPresetBias = parseFloat(data.quality_preset_bias);
        } else {
            qualityPresetBias = 1.0;
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

        // Handle text replacement locks
        if (data.text_replacements_seed && Array.isArray(data.text_replacements_seed)) {
            // Loading from metadata - use the stored replacements
            const replacementsWithLockStatus = data.text_replacements_seed.map(replacement => ({
                ...replacement,
                locked: (replacement.locked === true && replacement.can_lock === true)
            }));

            window.lastGenerationTextReplacements = replacementsWithLockStatus;
            window.lockedTextReplacements = replacementsWithLockStatus.filter(r => r.locked === true);
        } else {
            window.lockedTextReplacements = [];
            window.lastGenerationTextReplacements = [];
        }
        updateMainLockButtonState();

        // Handle vibe transfer data from forge data (disabled when inpainting is enabled)
        updateSplashScreenStatus('Loading References...');
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
                    const textInjectionState = vibeTransfer.inject_text !== false ? 'on' : 'off';
                    await addVibeReferenceToContainer(vibeTransfer.id, vibeTransfer.ie, vibeTransfer.strength, textInjectionState);
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
                // Check if this is a temporary file from URL download
                if (image && image.isTempFile && image.tempFilename) {
                    previewUrl = `/temp/${image.tempFilename}`;
                } else {
                    previewUrl = `/images/${identifier}`;
                }
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

            if (data.image_bias !== undefined && data.image_bias !== null) {
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

        // Type-specific handling
        if (name) {
            manualPresetName.value = name;
            manualPresetPlaceholderText.textContent = name;
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
                        updateManualPreviewDirectly(image, window.currentEditMetadata);
                    }
                }
            }
        }
        // Restore the preset name that was entered by the user
        if (manualPresetName && currentPresetName) {
            manualPresetName.value = currentPresetName;
            manualPresetPlaceholderText.textContent = currentPresetName;
        }

        // Handle director reference data from metadata
        if (data.chara_reference_source) {
            try {
                const [refType, refId] = data.chara_reference_source.split(':', 2);

                // Construct reference data directly from stored metadata
                let referenceData;
                if (refType === 'cache') {
                    referenceData = {
                        type: 'cache',
                        id: refId,
                        hash: refId,
                        filename: refId,
                        url: `/cache/preview/${refId}.webp`
                    };
                } else if (refType === 'vibe') {
                    referenceData = {
                        type: 'vibe',
                        id: refId,
                        url: `/cache/preview/${refId}.webp`
                    };
                } else if (refType === 'file') {
                    referenceData = {
                        type: 'file',
                        id: refId,
                        filename: refId,
                        url: `/images/${refId}`
                    };
                }

                if (referenceData) {
                    setDirectorReference(referenceData);
                    directorReferenceStyleBtn.setAttribute('data-state', (data.chara_reference_with_style) ? 'on' : 'off');
                    if (directorReferenceFidelityInput && data.chara_reference_fidelity !== undefined) {
                        directorReferenceFidelityInput.value = data.chara_reference_fidelity;
                        updatePercentageOverlay(directorReferenceFidelityInput, directorReferenceFidelityOverlay, 0);
                    }
                } else {
                    clearDirectorReference();
                }
            } catch (error) {
                console.warn('Failed to load director reference from metadata:', error);
                clearDirectorReference();
            }
        } else {
            clearDirectorReference();
        }

        updateSplashScreenStatus('Loading Tendai...');
        // Load dynamic generation data from forge_data if available
        if (data.dynamic_generation) {
            window.dynamicGenerationData = data.dynamic_generation;

            // Update carousel cache attributes
            if (dynamicCarousel) {
                dynamicCarousel.setAttribute('data-has-cache', (!!window.dynamicGenerationData.compiled_prompt).toString());
                // Check if cache is not expired (use dynamic expiration if available, otherwise 15 minutes)
                const now = Date.now();
                const isNotExpired = window.dynamicGenerationData.compiled_prompt?.expiresAt
                    ? now < window.dynamicGenerationData.compiled_prompt.expiresAt
                    : (now - (window.dynamicGenerationData.compiled_prompt?.timestamp || 0)) < 1000 * 60 * 15;
                if (isNotExpired) {
                    dynamicCarousel.setAttribute('data-use-cache', 'true');
                }

                // Restore fast_mode from dynamic_generation if present
                if (window.dynamicGenerationData.fast_mode !== undefined) {
                    dynamicCarousel.setAttribute('data-fast-mode', window.dynamicGenerationData.fast_mode.toString());
                }

                // Restore AI temperature if present
                if (window.dynamicGenerationData.ai_temperature !== undefined && window.dynamicGenerationData.ai_temperature !== null) {
                    dynamicCarousel.dataset.aiTemperature = window.dynamicGenerationData.ai_temperature.toString();
                } else {
                    dynamicCarousel.removeAttribute('data-ai-temperature');
                }

                // Restore lock states from compiled prompt
                const compiledPrompt = window.dynamicGenerationData.compiled_prompt;
                if (compiledPrompt) {
                    if (compiledPrompt.cache_locked !== undefined) {
                        dynamicCarousel.setAttribute('data-state', compiledPrompt.cache_locked ? 'on' : 'off');
                    }
                    if (compiledPrompt.context_locked !== undefined) {
                        dynamicCarousel.setAttribute('data-context-locked', compiledPrompt.context_locked ? 'true' : 'false');
                    }
                    // Only set chain_updates if it's explicitly true, otherwise leave undefined (defaults to false on client)
                    if (compiledPrompt.chain_updates === true) {
                        dynamicCarousel.setAttribute('data-chain-updates', 'true');
                    } else if (compiledPrompt.chain_updates === false) {
                        dynamicCarousel.setAttribute('data-chain-updates', 'false');
                    }
                    // If undefined, leave attribute unset (client will default to false)
                }

                // Load character names from compiled_prompt if available
                if (compiledPrompt.character_names && Array.isArray(compiledPrompt.character_names)) {
                    const charaContainers = document.querySelectorAll('.character-container');
                    compiledPrompt.character_names.forEach((name, index) => {
                        if (name && charaContainers[index]) {
                            const nameInput = charaContainers[index].querySelector('input[id^="charaName"]');
                            if (nameInput) {
                                nameInput.value = name;
                                console.log(`✨ Loaded character name ${index + 1}: "${name}"`);
                            }
                        }
                    });

                    // Update character prompt item names
                    updateCharacterPromptItemNames(compiledPrompt.character_names);
                }

                // Display generated image name if available, clear if not
                if (compiledPrompt.generated_image_name) {
                    window.lastGeneratedImageName = compiledPrompt.generated_image_name;
                    console.log(`🖼️ Generated image name: "${compiledPrompt.generated_image_name}"`);
                    updateGeneratedImageNameDisplay(compiledPrompt.generated_image_name);
                } else {
                    window.lastGeneratedImageName = null;
                    updateGeneratedImageNameDisplay(null);
                }
            } else {
                // No dynamic_generation data, clear display
                window.lastGeneratedImageName = null;
                updateGeneratedImageNameDisplay(null);
            }

            // Update dynamic generation button states based on loaded data
            const buttonMappings = {
                tod: 'todBtn',
                weather: 'weatherBtn',
                season: 'seasonBtn',
                observeHoliday: 'seasonBtn',
                guidance: 'seasonBtn',
                clothing: 'creativeBtn',
                action: 'creativeBtn',
                locked: 'dynamicCarousel',
                creative: 'creativeBtn',
                optimize: 'dynamicCarousel'
            };

            let hasAnyEnabled = false;
            Object.entries(buttonMappings).forEach(([key, btnId]) => {
                const btn = document.getElementById(btnId);
                if (btn && window.dynamicGenerationData[key] !== undefined) {
                    // Special handling for observeHoliday - uses dataset attribute on season button
                    if (key === 'observeHoliday') {
                        btn.setAttribute('data-toggle-holiday', window.dynamicGenerationData[key] ? 'true' : 'false');
                        return;
                    }
                    // Special handling for guidance - uses dataset attribute on season button
                    if (key === 'guidance') {
                        btn.setAttribute('data-toggle-guidance', window.dynamicGenerationData[key] ? 'true' : 'false');
                        return;
                    }
                    // Special handling for clothing and action - they use dataset attributes on creative button
                    if (key === 'clothing') {
                        btn.setAttribute('data-toggle-clothing', window.dynamicGenerationData[key] ? 'true' : 'false');
                        return;
                    }
                    if (key === 'action') {
                        btn.setAttribute('data-toggle-action', window.dynamicGenerationData[key] ? 'true' : 'false');
                        return;
                    }

                    // Special handling for optimize - restore to dynamicCarousel dataset attributes
                    if (key === 'optimize' && typeof window.dynamicGenerationData[key] === 'object') {
                        const optimizeData = window.dynamicGenerationData[key];
                        const optimizeEnabled = optimizeData.enabled ? 'true' : 'false';
                        dynamicCarousel.setAttribute('data-optimize-enabled', optimizeEnabled);

                        // Restore optimize-related attributes to dynamicCarousel
                        if (optimizeData.tokenCount !== undefined) {
                            dynamicCarousel.setAttribute('data-token-count', optimizeData.tokenCount.toString());
                        }
                        if (optimizeData.pipelineAware !== undefined) {
                            dynamicCarousel.setAttribute('data-pipeline-aware', optimizeData.pipelineAware.toString());
                        }
                        if (optimizeData.initialPromptAware !== undefined) {
                            dynamicCarousel.setAttribute('data-initial-prompt-aware', optimizeData.initialPromptAware.toString());
                        }
                        if (optimizeData.twoStage !== undefined) {
                            dynamicCarousel.setAttribute('data-two-stage', optimizeData.twoStage.toString());
                        }

                        if (optimizeData.enabled) {
                            hasAnyEnabled = true;
                        }
                        return;
                    }

                    // Special handling for fast_mode - restore to dynamicCarousel
                    if (key === 'fast_mode' && window.dynamicGenerationData[key] !== undefined) {
                        const fastModeValue = window.dynamicGenerationData[key];
                        if (dynamicCarousel) {
                            dynamicCarousel.setAttribute('data-fast-mode', fastModeValue.toString());
                        }
                        return;
                    }

                    const state = window.dynamicGenerationData[key] ? 'on' : 'off';
                    btn.setAttribute('data-state', state);
                    btn.classList.toggle('active', state === 'on');
                    // Set override if there's an override value
                    if (typeof window.dynamicGenerationData[key] === 'number' || typeof window.dynamicGenerationData[key] === 'string') {
                        btn.setAttribute('data-override', window.dynamicGenerationData[key]);
                    } else {
                        btn.removeAttribute('data-override');
                    }

                    // Update TOD button icon when loaded
                    if (btnId === 'todBtn') {
                        updateTodButtonIcon();
                    }

                    // Track if any value is enabled
                    if (state === 'on') {
                        hasAnyEnabled = true;
                    }
                }
            });

            // Restore weather location data if available
            if (window.dynamicGenerationData.location && weatherBtn) {
                weatherBtn.setAttribute('data-location', window.dynamicGenerationData.location);
            }

            // Unhide dynamicGenerationGroup if any values are enabled
            if (hasAnyEnabled) {
                dynamicGenerationGroup.classList.remove('hidden');
            } else {
                dynamicGenerationGroup.classList.add('hidden');
            }

            // Restore creative directive settings from dynamicGenerationData
            if (window.dynamicGenerationData.force_strategy !== undefined) {
                const strategyValue = window.dynamicGenerationData.force_strategy;
                if (strategyValue === null || strategyValue === '') {
                    dynamicCarousel.removeAttribute('data-creative-directive-strategy');
                } else {
                    dynamicCarousel.setAttribute('data-creative-directive-strategy', strategyValue);
                }
            }
            if (window.dynamicGenerationData.tool_passes !== undefined) {
                dynamicCarousel.setAttribute('data-creative-directive-tool-passes', window.dynamicGenerationData.tool_passes.toString());
            }
            if (window.dynamicGenerationData.dialogs_count !== undefined) {
                dynamicCarousel.setAttribute('data-creative-directive-dialogs', window.dynamicGenerationData.dialogs_count.toString());
            }
        } else {
            dynamicGenerationGroup.classList.add('hidden');
        }

        // Check for compiled prompt context and switch carousel to compiled mode
        // Do this outside the hasAnyEnabled check so hasCompiledContext is accessible later
        let hasCompiledContext = false;
        if (window.dynamicGenerationData?.compiled_prompt?.context) {
            const context = window.dynamicGenerationData.compiled_prompt.context;
            // Store compiled context and switch to compiled mode
            // Update carousel with compiled context and switch to compiled mode
            updateDynamicCarousel(context, 'compiled');
            hasCompiledContext = true;
        }

        // Update creative directive visibility after dynamic generation visibility changes
        updateCreativeDirectiveVisibility();

        // Load request body replacements from forge_data if available
        if (data.text_replacements && Array.isArray(data.text_replacements)) {
            if (typeof requestBodyReplacements !== 'undefined') {
                requestBodyReplacements = data.text_replacements;
            }
        } else {
            // Clear request body replacements if no data
            if (typeof requestBodyReplacements !== 'undefined') {
                requestBodyReplacements = [];
            }
        }

        // Load auto-clean UC setting from forge_data
        if (ucPresetsDropdownBtn && data.forge_data && data.forge_data.auto_clean_uc !== undefined) {
            ucPresetsDropdownBtn.dataset.autoClean = data.forge_data.auto_clean_uc ? 'on' : 'off';
        }

        updateSplashScreenStatus('Loading Pipelines...');
        // Handle staged generation data from forge_data
        if (data.forge_data && data.forge_data.pipeline && Array.isArray(data.forge_data.pipeline)) {
            console.log('🎬 Loading staged generation data from forge_data');

            // Load pipeline stages
            const pipelineStages = data.forge_data.pipeline;
            const stageSeeds = data.forge_data.stage_seeds || data.stage_seeds || null;

            // Store stage seeds globally so they can be sent with reroll requests
            if (stageSeeds && Array.isArray(stageSeeds) && stageSeeds.length > 0) {
                window.lastGenerationStageSeeds = stageSeeds;
                console.log(`💾 Stored ${stageSeeds.length} stage seeds for potential reroll`);
            }

            if (pipelineStages.length > 0) {
                // Clear existing stages first
                clearPipelineStages();

                // Load the pipeline stages with stage_seeds
                loadPipelineStages(pipelineStages, stageSeeds);
                updateTextOverlayStageVisibility();

                // Set saveStage0Btn from stored value
                if (saveStage0Btn && data.forge_data.save_base_output) {
                    saveStage0Btn.dataset.state = data.forge_data.save_base_output ? 'on' : 'off';
                }

                // Update saveStage0Btn visibility
                updateSaveStage0BtnVisibility();
            }
        } else {
            // No staged generation data, ensure pipeline UI is clean
            clearPipelineStages();
            if (saveStage0Btn) {
                saveStage0Btn.dataset.state = 'off';
            }
            updateSaveStage0BtnVisibility();
        }

        // Handle text overlays from forge_data or extracted from prompt
        if (data.text_overlays && Array.isArray(data.text_overlays)) {
            console.log('📝 Loading text overlays from forge_data');
            loadTextOverlays(data.text_overlays);
        } else if (data.prompt) {
            // Try to extract text from prompt if no text_overlays in forge data
            const extractedText = extractTextFromPrompt(data.prompt);
            if (extractedText) {
                console.log('📝 Extracted text overlay from prompt:', extractedText);
                loadTextOverlays([{
                    text: extractedText,
                    target: 0,
                    stage: 0,
                    type: 'speech',
                    disabled: false
                }]);
            } else {
                // No text overlays, ensure UI is clean
                clearTextOverlays();
            }
        } else {
            // No text overlays, ensure UI is clean
            clearTextOverlays();
        }

        updateSplashScreenStatus('Loading...');
        updateDynamicGenerationToggleBtn();
        updatePercentageOverlays();
        updateUploadDeleteButtonVisibility();
        updateManualPriceDisplay(true);
        updatePresetLoadSaveState();
        updateManualPresetToggleBtn();
        updatePromptStatusIcons();
        updatePipelineStagesHeaderVisibility();
        updateMainLockButtonState();
        if (!hasCompiledContext) {
            await requestDynamicContextResolution();
        }
        updateSplashScreenStatus('');
    } catch (error) {
        console.error('Error loading into form:', error);
        showError('Failed to load data');
    }
}

/**
 * Auto-resize textareas after modal show - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
function autoResizeTextareasAfterModalShow() {
    // Auto-resize main prompt and UC textareas
    if (manualPrompt) {
        applyFormattedText(manualPrompt, true);
        updateEmphasisHighlighting(manualPrompt);
        stopEmphasisHighlighting();
        autoResizeTextarea(manualPrompt);
    }
    if (manualUc) {
        applyFormattedText(manualUc, true);
        updateEmphasisHighlighting(manualUc);
        stopEmphasisHighlighting();
        autoResizeTextarea(manualUc);
    }

    // Auto-resize character prompt textareas
    const characterPromptItems = document.querySelectorAll('.character-prompt-item');
    characterPromptItems.forEach(item => {
        const characterId = item.id;
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);

        if (promptField) {
            applyFormattedText(promptField, true);
            updateEmphasisHighlighting(promptField);
            stopEmphasisHighlighting();
            autoResizeTextarea(promptField);
        }
        if (ucField) {
            applyFormattedText(ucField, true);
            updateEmphasisHighlighting(ucField);
            stopEmphasisHighlighting();
            autoResizeTextarea(ucField);
        }
    });

    // Auto-resize creative directive if present
    if (creativeDirectiveInput) {
        autoResizeTextarea(creativeDirectiveInput, 23);

        // Add input event listener for continuous auto-resizing
        creativeDirectiveInput.addEventListener('input', () => {
            autoResizeTextarea(creativeDirectiveInput, 23);
        });
    }
}

/**
 * Handle manual generation - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
async function handleManualGeneration(e) {
    e.preventDefault();

    // Set generating state
    isGenerating = true;
    updateManualGenerateBtnState();

    // Fade out existing dialogs when starting new generation
    clearManualPreviewDialogs();

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
    if ((cost.isFree ? cost.opus : cost.list) > 0 && !forcePaidRequest) {
        const confirmed = await showCreditCostDialog((cost.isFree ? cost.opus : cost.list), e);

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
    if (!window.isDesktop) {
        restoreGalleryState();
    }
    showManualLoading(true, 'Generating Image...');

    // Show the manual preview when generation starts
    showManualPreview();

    // Initialize stage indicators if this is a staged generation
    if (requestBody.pipeline && Array.isArray(requestBody.pipeline) && requestBody.pipeline.length > 0 && !requestBody.skip_pipeline_stages) {
        const totalStages = requestBody.pipeline.length + 1; // +1 for base generation
        console.log(`🎬 Staged generation detected: ${totalStages} stages total`);
        initializeStageIndicators(totalStages);
    } else {
        // Hide stage indicators for non-staged generations
        hideStageIndicators();
    }

    // Add "generating" class when generation starts
    manualForm.classList.add('generating');

    const generationParams = {
        model: values.model.toLowerCase(),
        ...requestBody
    };

    // Add director session and message IDs from director button dataset
    const directorBtn = document.getElementById('directorBtn');
    if (directorBtn && directorBtn.dataset.directorSessionId) {
        generationParams.director_session_id = directorBtn.dataset.directorSessionId;
    }
    if (directorBtn && directorBtn.dataset.directorMessageId) {
        generationParams.director_message_id = directorBtn.dataset.directorMessageId;
    }

    try {
        // Use WebSocket for image generation
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        // Reset and prepare dynamic generation progress overlay for new session
        if (window.dynamicGenerationData) {
            resetProgressOverlay();
        }

        const result = await window.wsClient.generateImage(generationParams, null, true); // Enable streaming

        // Reset ephemeral flags after request is sent
        if (dynamicCarousel) {
            dynamicCarousel.dataset.expirePreview = 'false';
            dynamicCarousel.dataset.forceRefresh = 'false'; // Auto-clear force refresh after use
        }

        // Show completion phase if dynamic generation overlay is active
        if (window.dynamicGenerationData) {
            updateDynamicGenerationProgressOverlay('completion');
        }

        if (result) {
            const { filename, seed, compiled_prompt, text_replacements_seed, stage_seeds, metadata } = result;

            // Store text replacement seeds for the lock modal
            if (text_replacements_seed && Array.isArray(text_replacements_seed)) {
                window.lastGenerationTextReplacements = text_replacements_seed;
                // Update the main lock button state
                updateMainLockButtonState();

                // Refresh the text replacement lock modal if it's currently open
                refreshTextReplacementLockModalIfOpen();
            }

            // Store stage_seeds if this was a staged generation
            if (stage_seeds && Array.isArray(stage_seeds)) {
                console.log('🎬 Received stage_seeds from generation:', stage_seeds);
                window.lastGenerationStageSeeds = stage_seeds;

                // Update stages with the seeds (only after fresh generation, not when loading)
                // Seeds are already set during loadPipelineStages when loading from metadata
                updateStagesWithSeeds(stage_seeds);
            }

            // Store compiled prompt if it was included in the response
            if (compiled_prompt && window.dynamicGenerationData) {
                window.dynamicGenerationData.compiled_prompt = compiled_prompt;

                // Update carousel attributes
                if (dynamicCarousel) {
                    dynamicCarousel.setAttribute('data-has-cache', 'true');
                    dynamicCarousel.setAttribute('data-use-cache', 'true');

                    // Restore lock states from compiled prompt
                    if (compiled_prompt.cache_locked !== undefined) {
                        dynamicCarousel.setAttribute('data-state', compiled_prompt.cache_locked ? 'on' : 'off');
                    }
                    if (compiled_prompt.context_locked !== undefined) {
                        dynamicCarousel.setAttribute('data-context-locked', compiled_prompt.context_locked ? 'true' : 'false');
                    }
                }

                // Clear any stored request data
                delete window.dynamicGenerationRequestData;

                // Update carousel with compiled prompt context and switch to compiled mode
                if (compiled_prompt?.context) {
                    updateDynamicCarousel(compiled_prompt.context, 'compiled');
                }

                // Update UI to reflect compiled state
                updateDynamicGenerationToggleBtn();

                // Update text replacement lock button to show if there are text replacements
                updateMainLockButtonState();

                // Refresh the text replacement lock modal if it's currently open
                refreshTextReplacementLockModalIfOpen();
            }
 
            if (filename && metadata) {
                window.lastGeneration = metadata;
                window.lastGeneration.filename = filename;
                window.currentManualPreviewImage = { filename, original: filename, upscaled: null, base: filename };
                if (typeof updateAndroidNotificationImageFromCurrentPreview === 'function') {
                    updateAndroidNotificationImageFromCurrentPreview();
                }
                // Director new session functionality is always available

                // Update character names and generated image name from metadata
                if (metadata?.dynamic_generation?.compiled_prompt) {
                    const compiledPrompt = metadata.dynamic_generation.compiled_prompt;

                    // Load character names into inputs
                    if (compiledPrompt.character_names && Array.isArray(compiledPrompt.character_names)) {
                        const charaContainers = document.querySelectorAll('.character-container');
                        compiledPrompt.character_names.forEach((name, index) => {
                            if (name && charaContainers[index]) {
                                const nameInput = charaContainers[index].querySelector('input[id^="charaName"]');
                                if (nameInput && nameInput.value !== name) {
                                    nameInput.value = name;
                                    console.log(`✨ Updated character name ${index + 1}: "${name}"`);
                                }
                            }
                        });

                        // Update character prompt item names
                        updateCharacterPromptItemNames(compiledPrompt.character_names);
                    }

                    // Display generated image name, clear if not provided
                    if (compiledPrompt.generated_image_name) {
                        window.lastGeneratedImageName = compiledPrompt.generated_image_name;
                        console.log(`🖼️ Generated image name: "${compiledPrompt.generated_image_name}"`);
                        updateGeneratedImageNameDisplay(compiledPrompt.generated_image_name);
                    } else {
                        window.lastGeneratedImageName = null;
                        updateGeneratedImageNameDisplay(null);
                    }
                } else {
                    // No dynamic_generation data, clear display
                    window.lastGeneratedImageName = null;
                    updateGeneratedImageNameDisplay(null);
                }
            }

            // Extract seed if available and add to history
            if (seed) {
                const seedInt = parseInt(seed);
                window.lastGeneratedSeed = seedInt;
                sproutSeedBtn.classList.add('available');
                addSeedToHistory(seedInt);
            }

            // Wait for all queued streaming steps to be displayed before finalizing
            if (window.wsClient && window.wsClient.waitForStreamingStepsComplete) {
                console.log('⏳ Waiting for streaming steps to complete...');
                await window.wsClient.waitForStreamingStepsComplete('manual');
                console.log('✅ All streaming steps displayed');
            }

            // Load final image from disk via /images/ (service worker caches)
            if (filename) {
                const imageSrc = `/images/${filename}`;
                const mockResponse = {
                    headers: {
                        get: (headerName) => {
                            if (headerName === 'X-Generated-Filename') {
                                return filename;
                            }
                            return null;
                        }
                    }
                };

                await handleImageResult(imageSrc, undefined, seed || values.seed, mockResponse, metadata);
            } else {
                console.log('✅ Streaming image generation completed');
            }

            // Remove streaming class before setting final image
            manualForm.classList.remove('streaming');

            // Now stop the animation AFTER the image is displayed
            stopPreviewAnimation();
        } else {
            throw new Error('Invalid response from WebSocket');
        }

    } catch (error) {
        if (!window.isDesktop) {
            restoreGalleryState();
        }
        console.error(`Image generation error:`, error);

        // Extract detailed error message
        let errorMessage = 'Image generation failed. Please try again.';
        if (error && error.message) {
            errorMessage = error.message;
            // If the error message starts with the generic prefix, use it as is
            // Otherwise, prepend a more descriptive message
            if (!errorMessage.includes('Image generation failed')) {
                errorMessage = `Image generation failed: ${errorMessage}`;
            }
        }

        showError(errorMessage);
        stopPreviewAnimation();
        hideDynamicGenerationProgressOverlay();
    } finally {
        // Animation cleanup is handled in the success path after image display
        // Just clean up classes and state
        if (manualForm) {
            manualForm.classList.remove('generating', 'streaming');
        }
        showManualLoading(false);
        isGenerating = false;
        updateManualGenerateBtnState();
    }
}

/**
 * Handle image result - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
async function handleImageResult(imageSrc, clearContextFn, seed = null, response = null, metadata = null) {
    // Store the seed for manual preview
    if (seed !== null) {
        window.lastGeneratedSeed = seed;
        sproutSeedBtn.classList.add('available');
        updateSproutSeedButtonFromPreviewSeed();
        addSeedToHistory(seed);
    }

    if (response && response.headers) {
        const filename = response.headers.get('X-Generated-Filename');
        if (filename) {
            window.lastGeneration.filename = filename;
        }
    }

    // Handle metadata - either from direct parameter or from response headers (legacy)
    if (metadata) {
        // Use metadata passed directly (new WebSocket flow)
        window.lastGeneration = metadata;
        manualPreviewOriginalImage.classList.remove('hidden');

        // Update character names and generated image name from metadata
        if (metadata?.dynamic_generation?.compiled_prompt) {
            const compiledPrompt = metadata.dynamic_generation.compiled_prompt;

            // Load character names into inputs
            if (compiledPrompt.character_names && Array.isArray(compiledPrompt.character_names)) {
                const charaContainers = document.querySelectorAll('.character-container');
                compiledPrompt.character_names.forEach((name, index) => {
                    if (name && charaContainers[index]) {
                        const nameInput = charaContainers[index].querySelector('input[id^="charaName"]');
                        if (nameInput && nameInput.value !== name) {
                            nameInput.value = name;
                            console.log(`✨ Updated character name ${index + 1}: "${name}"`);
                        }
                    }
                });

                // Update character prompt item names
                updateCharacterPromptItemNames(compiledPrompt.character_names);
            }

            // Display generated image name, clear if not provided
            if (compiledPrompt.generated_image_name) {
                window.lastGeneratedImageName = compiledPrompt.generated_image_name;
                console.log(`🖼️ Generated image name: "${compiledPrompt.generated_image_name}"`);
                updateGeneratedImageNameDisplay(compiledPrompt.generated_image_name);
            } else {
                window.lastGeneratedImageName = null;
                updateGeneratedImageNameDisplay(null);
            }
        } else {
            // No dynamic_generation data, clear display
            window.lastGeneratedImageName = null;
            updateGeneratedImageNameDisplay(null);
        }
    } else if (response && response.headers) {
        // Legacy flow: Extract seed from response header if available
        const headerSeed = response.headers.get('X-Seed');
        if (headerSeed) {
            const seedInt = parseInt(headerSeed);
            window.lastGeneratedSeed = seedInt;
            sproutSeedBtn.classList.add('available');
            updateSproutSeedButtonFromPreviewSeed();
            addSeedToHistory(seedInt);
        }
        // Fetch metadata for the generated image if we have a filename
        const filename = response.headers.get('X-Generated-Filename');
        if (filename) {
            try {
                const fetchedMetadata = await getImageMetadata(filename);
                window.lastGeneration = fetchedMetadata;
                window.lastGeneration.filename = filename;
                manualPreviewOriginalImage.classList.remove('hidden');
                // Director new session functionality is always available

                // Update character names and generated image name from metadata
                if (fetchedMetadata?.dynamic_generation?.compiled_prompt) {
                    const compiledPrompt = fetchedMetadata.dynamic_generation.compiled_prompt;

                    // Load character names into inputs
                    if (compiledPrompt.character_names && Array.isArray(compiledPrompt.character_names)) {
                        const charaContainers = document.querySelectorAll('.character-container');
                        compiledPrompt.character_names.forEach((name, index) => {
                            if (name && charaContainers[index]) {
                                const nameInput = charaContainers[index].querySelector('input[id^="charaName"]');
                                if (nameInput && nameInput.value !== name) {
                                    nameInput.value = name;
                                    console.log(`✨ Updated character name ${index + 1}: "${name}"`);
                                }
                            }
                        });

                        // Update character prompt item names
                        updateCharacterPromptItemNames(compiledPrompt.character_names);
                    }

                    // Display generated image name, clear if not provided
                    if (compiledPrompt.generated_image_name) {
                        window.lastGeneratedImageName = compiledPrompt.generated_image_name;
                        console.log(`🖼️ Generated image name: "${compiledPrompt.generated_image_name}"`);
                        updateGeneratedImageNameDisplay(compiledPrompt.generated_image_name);
                    } else {
                        window.lastGeneratedImageName = null;
                        updateGeneratedImageNameDisplay(null);
                    }
                } else {
                    // No dynamic_generation data, clear display
                    window.lastGeneratedImageName = null;
                    updateGeneratedImageNameDisplay(null);
                }
            } catch (error) {
                console.warn('Failed to fetch metadata for generated image:', error);
                // Clear display on error
                window.lastGeneratedImageName = null;
                updateGeneratedImageNameDisplay(null);
            }
        }
    }

    if (!manualModal.classList.contains('hidden')) {
        document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(element => {
            element.classList.remove('swapped');
        });
        await updateManualPreview(0, response, metadata);
        createConfetti();
        return;
    }

    const img = new Image();
    img.onload = async function () {
        createConfetti();
        clearContextFn();
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

        img.onload = null;
    };
    img.src = imageSrc;
}

function setDirectorReference(referenceData) {
    if (!referenceData) return;

    directorReferenceData = referenceData;

    // Set the image source
    if (directorReferenceImage) {
        directorReferenceImage.src = referenceData.url;
    }

    // Reset style toggle to on for new reference
    if (directorReferenceStyleBtn) {
        directorReferenceStyleBtn.setAttribute('data-state', 'on');
    }

    // Reset fidelity to default for new reference
    if (directorReferenceFidelityInput) {
        directorReferenceFidelityInput.value = '1.0';
        updatePercentageOverlay(directorReferenceFidelityInput, directorReferenceFidelityOverlay, 0);
    }

    // Show the director reference section and update display classes
    if (directorReferenceSection) {
        directorReferenceSection.classList.remove('hidden');
    }

    // Add display-image class to transformation row (similar to other image sections)
    if (transformationRow) {
        transformationRow.classList.add('display-character');
    }

    // Disable vibe references when director reference is active
    updateManualPriceDisplay();

    disableVibeReferences();
}

// Clear the current director reference
function clearDirectorReference() {
    directorReferenceData = null;

    // Clear the image
    if (directorReferenceImage) {
        directorReferenceImage.src = '';
    }

    // Reset style toggle to on
    if (directorReferenceStyleBtn) {
        directorReferenceStyleBtn.setAttribute('data-state', 'on');
    }

    // Reset fidelity to default
    if (directorReferenceFidelityInput) {
        directorReferenceFidelityInput.value = '1.0';
        updatePercentageOverlay(directorReferenceFidelityInput, directorReferenceFidelityOverlay, 0);
    }

    // Hide the director reference section and update display classes
    if (directorReferenceSection) {
        directorReferenceSection.classList.add('hidden');
    }

    // Remove display-image class from transformation row
    if (transformationRow) {
        transformationRow.classList.remove('display-character');
    }

    // Re-enable vibe references
    enableVibeReferences();

    updateManualPriceDisplay();
}

// Toggle the director reference style option
function toggleDirectorReferenceStyle() {
    if (!directorReferenceStyleBtn) return;

    const currentState = directorReferenceStyleBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';
    directorReferenceStyleBtn.setAttribute('data-state', newState);
}

// Disable vibe references when director reference is active
function disableVibeReferences() {
    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    if (vibeReferencesContainer) {
        vibeReferencesContainer.classList.add('disabled');
        // Add visual indicator that vibe references are disabled
        vibeReferencesContainer.style.opacity = '0.5';
        vibeReferencesContainer.style.pointerEvents = 'none';
    }
}

// Re-enable vibe references when director reference is cleared
function enableVibeReferences() {
    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    if (vibeReferencesContainer) {
        vibeReferencesContainer.classList.remove('disabled');
        vibeReferencesContainer.style.opacity = '';
        vibeReferencesContainer.style.pointerEvents = '';
    }
}

// Get the current director reference data for forgeData
function getDirectorReferenceForForgeData() {
    if (!directorReferenceData) return null;

    const styleEnabled = directorReferenceStyleBtn.getAttribute('data-state') === 'on';
    const fidelityLevel = parseFloat(directorReferenceFidelityInput.value) || 0.5;

    return {
        type: directorReferenceData.type,
        id: directorReferenceData.id,
        with_style: styleEnabled,
        fidelity: fidelityLevel
    };
}

// Track if overlay is in completion/hide phase
let progressOverlayCompleting = false;

// Reset progress overlay for new dynamic generation session
function resetProgressOverlay() {
    // Reset state flags
    progressOverlayCompleting = false;

    // Ensure overlay is visible for new session
    const overlay = document.getElementById('dynamicGenerationProgressOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }

    // Clear reasoning container
    const reasoningContainer = document.getElementById('progressReasoningContainer');
    if (reasoningContainer) {
        reasoningContainer.innerHTML = '';
    }

    // Clear stored positions for new session
    reasoningPositions.length = 0;
}

// Update dynamic generation progress overlay
function updateDynamicGenerationProgressOverlay(phase, data) {
    const overlay = document.getElementById('dynamicGenerationProgressOverlay');
    if (!overlay) return;

    // Detect if this is the start of a new generation session
    // If overlay is hidden and we're getting a non-completion phase, treat it as a new session
    const isNewSession = overlay.classList.contains('hidden') && phase !== 'completion' && phase !== 'error';

    // If starting a new session, reset the overlay state
    if (isNewSession) {
        progressOverlayCompleting = false;
        resetProgressOverlay();
    }

    // Don't show overlay if it's already completing/hiding (except for context/error/new session)
    if (progressOverlayCompleting && phase !== 'error' && phase !== 'context' && !isNewSession) {
        // Still update content for completion/error phases
        if (phase === 'completion') {
            updateProgressStatus('Starting Generation...');
        }
        return;
    }

    // Update content based on phase
    switch (phase) {
        case 'context':
            //updateProgressContext(data); // This handles the reset and shows overlay
            overlay.classList.remove('hidden'); // Ensure overlay is visible for new session
            return; // Skip the general show logic since we handled it here
            break;
        case 'thinking':
            updateProgressStatus('Getting Ready...');
            break;
        case 'streaming':
            updateProgressStatus('Reading Response...');
            addProgressReasoning(data?.reason);
            break;
        case 'tool_execution':
            if (overlay?.classList?.contains('hidden') && !isNewSession) return;
            if (data?.currentKey && data?.totalKeys) {
                updateProgressStatus(`Executing Tools (${data.currentKey}/${data.totalKeys})...`);
            } else {
                updateProgressStatus('Executing Tools...');
            }
            if (data?.reason) {
                addProgressReasoning(data.reason, data?.toolName, data?.toolState, data?.toolReasoningId, data);
            }
            break;
        case 'optimizing':
            updateProgressStatus('Optimizing...');
            // Clear existing reasoning items to make room for optimization text
            const reasoningContainer = document.getElementById('progressReasoningContainer');
            let existingItems = null;
            if (reasoningContainer) {
                // Fade out existing items quickly
                existingItems = reasoningContainer.querySelectorAll('.progress-reasoning-item');
                existingItems.forEach((item, index) => {
                    setTimeout(() => {
                        item.classList.add('fade-out');
                        if (index === existingItems.length - 1) {
                            // After last item starts fading, clear container and positions
                            setTimeout(() => {
                                reasoningContainer.innerHTML = '';
                                reasoningPositions.length = 0;
                            }, 400);
                        }
                    }, index * 50); // Quick stagger
                });
            }
            // Add the optimization reason if provided
            if (data?.reason) {
                setTimeout(() => {
                    addProgressReasoning(data.reason);
                }, existingItems?.length > 0 ? (existingItems.length * 50 + 400) : 0);
            }
            break;
        case 'completion':
            if (overlay?.classList?.contains('hidden') && !isNewSession) return;
            updateProgressStatus('Starting Generation...');
            progressOverlayCompleting = true; // Prevent further shows
            // Show completion for 2 seconds then hide (unless debug flag is set)
            if (!window.DEBUG_KEEP_REASONING_OVERLAY) {
                setTimeout(() => {
                    hideDynamicGenerationProgressOverlay();
                }, 2000);
            } else {
                console.log('🔧 DEBUG_KEEP_REASONING_OVERLAY enabled - overlay will not hide');
            }
            break;
        case 'error':
            updateProgressStatus('Error: ' + (data?.error || 'Enshutsuka processing failed'));
            progressOverlayCompleting = true; // Prevent further shows
            // Hide overlay after showing error for 3 seconds
            setTimeout(() => {
                hideDynamicGenerationProgressOverlay();
            }, 3000);
            break;
    }

    // Show the overlay
    overlay.classList.remove('hidden');
}

// Update progress context (time, date, season, holiday, weather)
function updateProgressContext(data) {
    if (!data) return;

    // Complete reset for new dynamic generation session
    resetProgressOverlay();

    // Update time
    const timeElement = document.getElementById('progressTime');
    if (timeElement && data.time) {
        const time = new Date(`2000-01-01T${data.time}`);
        timeElement.textContent = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    // Update date
    const dateElement = document.getElementById('progressDate');
    if (dateElement && data.date) {
        let formattedDate;
        if (typeof data.date === 'object' && data.date.year !== undefined) {
            // Date sent as components - reconstruct properly to avoid timezone issues
            const date = new Date(data.date.year, data.date.month, data.date.day);
            formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else {
            // Fallback for string format
            const date = new Date(data.date);
            formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        dateElement.textContent = formattedDate;
    }

    // Update season - handle both object and string formats (for backward compatibility with compiled prompts)
    const seasonElement = document.getElementById('progressSeason');
    if (seasonElement && data.season) {
        // Extract season name from object or use string directly
        const seasonName = typeof data.season === 'object' && data.season.name ? data.season.name : data.season;
        seasonElement.textContent = seasonName;
    }

    // Update holiday (only show if present)
    const holidayElement = document.getElementById('progressHoliday');
    if (holidayElement) {
        if (data.holiday?.primaryHoliday?.name) {
            holidayElement.textContent = data.holiday.primaryHoliday.name;
            holidayElement.style.display = 'inline';
        } else {
            holidayElement.style.display = 'none';
        }
    }

    // Update weather using existing overlay weather functions
    if (data.weather) {
        // Update weather condition
        const weatherCondition = document.getElementById('progressWeatherCondition');
        if (weatherCondition) {
            const conditionText = data.weather.condition || 'Unknown';
            weatherCondition.textContent = conditionText;
        }
        // Update weather condition
        const weatherLocation = document.getElementById('progressWeatherLocation');
        if (weatherLocation) {
            let conditionText = null;
            // Add city and country if available
            if (data.location && data.location.city && data.location.country) {
                conditionText = `${data.location.city}, ${data.location.country}`;
            } else if (data.location && data.location.city) {
                conditionText = data.location.city;
            } else if (data.location && data.location.country) {
                conditionText = data.location.country;
            }
            if (conditionText) {
                weatherLocation.classList.remove('hidden');
                weatherLocation.textContent = conditionText;
            } else {
                weatherLocation.classList.add('hidden');
            }
        }

        // Update weather temperature
        const weatherFeelsLike = document.getElementById('progressWeatherFeelsLike');
        if (weatherFeelsLike && data.weather.feelsLike !== undefined) {
            const tempData = formatTemperature(data.weather.feelsLike);
            const tempNumber = weatherFeelsLike.querySelector('.temp-number');
            const tempUnit = weatherFeelsLike.querySelector('.temp-unit');
            if (tempNumber) tempNumber.textContent = tempData.number;
            if (tempUnit) tempUnit.textContent = tempData.unit;
        }

        // Update weather icon
        const weatherIconContainer = document.getElementById('progressWeatherIcon');
        if (weatherIconContainer && data.weather.condition) {
            // Determine if it's night based on timePeriod data
            const isNight = data.timePeriod?.isDaytime === false;
            const weatherIconHtml = getWeatherIcon(data.weather.condition, isNight);
            weatherIconContainer.innerHTML = weatherIconHtml;
        }
    }
}

// Update progress status text
function updateProgressStatus(status) {
    const statusElement = document.getElementById('progressStatusText');
    if (statusElement) {
        statusElement.textContent = status;
    }
}

// Helper function to check if a position overlaps with existing reasoning items
function checkReasoningOverlap(x, y, existingPositions, minDistance = 15) {
    for (const pos of existingPositions) {
        const distance = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
        if (distance < minDistance) {
            return true;
        }
    }
    return false;
}

// Store positions of reasoning items to avoid overlaps
const reasoningPositions = [];

/**
 * Get FontAwesome icon for context field type
 * @param {string} fieldName - Field name (time, season, holiday, etc.)
 * @returns {string} FontAwesome icon class
 */
function getContextFieldIcon(fieldName) {
    const iconMap = {
        'time': 'fa-clock',
        'season': 'fa-leaf',
        'holiday': 'fa-gift',
        'lighting': 'fa-lightbulb',
        'location': 'fa-map-marker-alt',
        'weather_condition': 'fa-cloud-rain',
        'sky': 'fa-cloud',
        'character_clothing': 'fa-tshirt',
        'character_actions': 'fa-running',
        'character_attributes': 'fa-user'
    };
    return iconMap[fieldName] || 'fa-circle';
}

/**
 * Check if a field should be muted (no value or has change)
 * @param {Object} existing - Existing field data
 * @param {Object} planned - Planned field data (optional)
 * @returns {boolean} True if should be muted
 */
function shouldMuteField(existing, planned = null) {
    if (!existing) return true;
    if (!existing.found || !existing.value || existing.value === 'none' || existing.value === '') {
        return true;
    }
    // If planned is provided and needs_update, also mute
    if (planned && planned.needs_update) {
        return true;
    }
    return false;
}

/**
 * Get count for array fields
 * @param {Object} existing - Existing field data
 * @returns {number} Count of items
 */
function getArrayFieldCount(existing) {
    if (!existing || !Array.isArray(existing)) return 0;
    return existing.filter(item => item && item.found).length;
}

// Add reasoning text progressively as individual divs at random positions
function addProgressReasoning(reason, toolName = null, toolState = 'completed', toolReasoningId = null, data = null) {
    if (!reason) return;

    const reasoningContainer = document.getElementById('progressReasoningContainer');
    if (!reasoningContainer) return;

    // If this is a tool with an ID and we already have an item, update it
    if (toolName && toolReasoningId) {
        const existingDiv = document.getElementById(toolReasoningId);
        if (existingDiv) {
            const toolStyle = getToolIconAndBackground(toolName, toolState);

            // Update background and border
            existingDiv.style.background = toolStyle.backgroundColor;
            existingDiv.style.borderLeft = `3px solid ${toolStyle.borderColor}`;

            // Update icon in row 1
            const iconSpan = existingDiv.querySelector('.tool-icon');
            if (iconSpan) {
                iconSpan.innerHTML = toolStyle.icon;
            }

            // Update status in row 2
            const statusRow = existingDiv.querySelector('.tool-status-row');
            if (statusRow && toolState === 'completed') {
                statusRow.textContent = reason.trim();
            } else if (statusRow && toolState === 'executing' && !data?.appendReason) {
                // Update action text while executing (but not for append operations)
                statusRow.textContent = getToolActionText(toolName);
            } else if (statusRow && data?.appendReason) {
                // For batch operations, append to row 3 instead of row 2
                const reasoningRow = existingDiv.querySelector('.tool-reasoning-row');
                if (reasoningRow) {
                    const currentText = reasoningRow.textContent;
                    reasoningRow.textContent = currentText ? `${currentText}\n${reason.trim()}` : reason.trim();
                }
            }

            return; // Don't create a new item
        }
    }

    // Create new div for this reasoning
    const reasonDiv = document.createElement('div');
    reasonDiv.className = 'progress-reasoning-item';

    // Set ID if this is a tool
    if (toolName && toolReasoningId) {
        reasonDiv.id = toolReasoningId;
    }

    // Apply tool-specific styling if this is a tool execution
    if (toolName) {
        const toolStyle = getToolIconAndBackground(toolName, toolState);
        reasonDiv.classList.add('tool-reasoning-item');
        reasonDiv.style.background = toolStyle.backgroundColor;
        reasonDiv.style.borderLeft = `3px solid ${toolStyle.borderColor}`;

        // Create 3-row layout for tools
        // Row 1: Icon + Tool Name
        const headerRow = document.createElement('div');
        headerRow.className = 'tool-header-row';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'tool-icon';
        iconSpan.innerHTML = toolStyle.icon;

        const toolNameSpan = document.createElement('span');
        toolNameSpan.className = 'tool-name';
        toolNameSpan.textContent = getToolDisplayName(toolName);

        headerRow.appendChild(iconSpan);
        headerRow.appendChild(toolNameSpan);
        reasonDiv.appendChild(headerRow);

        // Row 2: Status/result (skip for completeTooling since it has no executing state)
        if (toolName !== 'completeTooling') {
            const statusRow = document.createElement('div');
            statusRow.className = 'tool-status-row';
            if (toolState === 'completed') {
                statusRow.textContent = reason.trim();
            } else {
                // Show appropriate action text based on tool type
                statusRow.textContent = getToolActionText(toolName);
            }
            reasonDiv.appendChild(statusRow);
        }

        // Row 3: Original reasoning
        const reasoningRow = document.createElement('div');
        reasoningRow.className = 'tool-reasoning-row';
        reasoningRow.textContent = reason.trim();
        reasonDiv.appendChild(reasoningRow);
    } else {
        // Non-tool reasoning (standard format)
        const reasonSpan = document.createElement('span');
        reasonSpan.textContent = reason.trim();
        reasonDiv.appendChild(reasonSpan);
    }
    reasoningContainer.appendChild(reasonDiv);

    // Generate random position as percentages, avoiding center and existing text
    // Define zones: prefer edges and corners, avoid center (30-70% range)
    let randomXPercent, randomYPercent;
    let attempts = 0;
    const maxAttempts = 20;

    do {
        // Generate position favoring edges
        const favorEdge = Math.random() < 0.7; // 70% chance to favor edges

        if (favorEdge) {
            // Choose a quadrant (top-left, top-right, bottom-left, bottom-right)
            const quadrant = Math.floor(Math.random() * 4);

            switch (quadrant) {
                case 0: // Top-left
                    randomXPercent = Math.random() * 25 + 5; // 5-30%
                    randomYPercent = Math.random() * 25 + 15; // 15-40%
                    break;
                case 1: // Top-right
                    randomXPercent = Math.random() * 25 + 70; // 70-95%
                    randomYPercent = Math.random() * 25 + 15; // 15-40%
                    break;
                case 2: // Bottom-left
                    randomXPercent = Math.random() * 25 + 5; // 5-30%
                    randomYPercent = Math.random() * 30 + 60; // 60-90%
                    break;
                case 3: // Bottom-right
                    randomXPercent = Math.random() * 25 + 70; // 70-95%
                    randomYPercent = Math.random() * 30 + 60; // 60-90%
                    break;
            }
        } else {
            // Random position avoiding center
            randomXPercent = Math.random() * 90 + 5; // 5-95%
            randomYPercent = Math.random() * 75 + 15; // 15-90%

            // If in center zone, push to edges
            if (randomXPercent > 30 && randomXPercent < 70) {
                randomXPercent = randomXPercent < 50 ? Math.random() * 25 + 5 : Math.random() * 25 + 70;
            }
            if (randomYPercent > 35 && randomYPercent < 65) {
                randomYPercent = randomYPercent < 50 ? Math.random() * 20 + 15 : Math.random() * 30 + 60;
            }
        }

        attempts++;
    } while (checkReasoningOverlap(randomXPercent, randomYPercent, reasoningPositions) && attempts < maxAttempts);

    // Store position for overlap checking
    reasoningPositions.push({ x: randomXPercent, y: randomYPercent });

    // Switch between left/right and top/bottom based on 50% threshold
    if (randomXPercent > 50) {
        // Position from right edge
        reasonDiv.style.right = `${100 - randomXPercent}%`;
    } else {
        // Position from left edge
        reasonDiv.style.left = `${randomXPercent}%`;
    }

    if (randomYPercent > 50) {
        // Position from bottom edge
        reasonDiv.style.bottom = `${100 - randomYPercent}%`;
    } else {
        // Position from top edge
        reasonDiv.style.top = `${randomYPercent}%`;
    }

    // Trigger fade-in with slight delay
    setTimeout(() => {
        reasonDiv.classList.add('visible');
    }, 50);
}

// Hide dynamic generation progress overlay with fade-out animations
function hideDynamicGenerationProgressOverlay() {
    const overlay = document.getElementById('dynamicGenerationProgressOverlay');
    if (!overlay) return;

    // Get all reasoning items
    const reasoningItems = document.querySelectorAll('.progress-reasoning-item');

    if (reasoningItems.length === 0) {
        // No reasoning items, just hide the overlay
        overlay.classList.add('hidden');
        // Clean up reasoning items
        const reasoningContainer = document.getElementById('progressReasoningContainer');
        if (reasoningContainer) {
            reasoningContainer.innerHTML = '';
        }
        // Reset completing flag so overlay can show again
        progressOverlayCompleting = false;
        return;
    }

    // Fade out each reasoning item with staggered delays
    let lastItemTransitionComplete = false;
    const lastItemIndex = reasoningItems.length - 1;

    reasoningItems.forEach((item, index) => {
        setTimeout(() => {
            item.classList.add('fade-out');

            // After the last item starts fading out, wait for it to complete then hide overlay
            if (index === lastItemIndex) {
                const handleLastItemFadeComplete = (e) => {
                    if (e.target === item && e.propertyName === 'opacity') {
                        item.removeEventListener('transitionend', handleLastItemFadeComplete);
                        if (!lastItemTransitionComplete) {
                            lastItemTransitionComplete = true;
                            overlay.classList.add('hidden');
                            // Clean up reasoning items
                            const reasoningContainer = document.getElementById('progressReasoningContainer');
                            if (reasoningContainer) {
                                reasoningContainer.innerHTML = '';
                            }
                            // Reset completing flag so overlay can show again
                            progressOverlayCompleting = false;
                        }
                    }
                };
                item.addEventListener('transitionend', handleLastItemFadeComplete);
            }
        }, index * 150); // Stagger by 150ms
    });

    // Fallback timeout: if transitionend doesn't fire, complete after max expected time
    // Last item starts at (lastItemIndex * 150ms) + 400ms transition = ~(items.length * 150 + 400)ms
    const fallbackTimeout = (lastItemIndex * 150) + 500;
    setTimeout(() => {
        if (!lastItemTransitionComplete) {
            lastItemTransitionComplete = true;
            overlay.classList.add('hidden');
            const reasoningContainer = document.getElementById('progressReasoningContainer');
            if (reasoningContainer) {
                reasoningContainer.innerHTML = '';
            }
            progressOverlayCompleting = false;
        }
    }, fallbackTimeout);
}


// ============================================================================
// MODAL MANAGEMENT FUNCTIONS
// ============================================================================

// These functions will remain global to avoid breaking existing code
// TODO: Move implementations from app.js here when ready
