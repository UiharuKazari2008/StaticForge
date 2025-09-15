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

// Manual Modal DOM Elements - Move these from app.js
const manualModal = document.getElementById('manualModal');
const manualLoadingOverlay = document.getElementById('manualLoadingOverlay');
const manualGenerateBtn = document.getElementById('manualGenerateBtn');
const manualForm = document.getElementById('manualForm');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualPreviewCloseBtn = document.getElementById('manualPreviewCloseBtn');
const openGenEditorBtn = document.getElementById('openGenEditorBtn');
const presetSelect = document.getElementById('presetSelect');
const gallery = document.getElementById('gallery');
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
const manualUpscale = document.getElementById('manualUpscale');
const clearSeedBtn = document.getElementById('clearSeedBtn');
const editSeedBtn = document.getElementById('editSeedBtn');
const focusOverlay = document.getElementById('focus-overlay');
const searchToggleBtn = document.getElementById('searchToggleBtn');
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
const manualPreviewDownloadBtn = document.getElementById('manualPreviewDownloadBtn');
const manualPreviewCopyBtn = document.getElementById('manualPreviewCopyBtn');
const manualPreviewUpscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
const manualPreviewVariationBtn = document.getElementById('manualPreviewVariationBtn');
const manualPreviewSeedBtn = document.getElementById('manualPreviewSeedBtn');
const manualPreviewDeleteBtn = document.getElementById('manualPreviewDeleteBtn');
const manualPreviewSeedNumber = document.getElementById('manualPreviewSeedNumber');
const manualStrengthValue = document.getElementById('manualStrengthValue');
const manualNoiseValue = document.getElementById('manualNoiseValue');
const paidRequestToggle = document.getElementById('paidRequestToggle');
const previewContainer = document.getElementById('manualPreviewContainer');
const previewStars = document.getElementById('previewStars');
const previewBackgroundLines = document.getElementById('previewBackgroundLines');
const previewForegroundLines = document.getElementById('previewForegroundLines');
const manualLoadBtn = document.getElementById('manualLoadBtn');
const manualSaveBtn = document.getElementById('manualSaveBtn');
const manualPreviewLoadBtn = document.getElementById('manualPreviewLoadBtn');
const manualPreviewPinBtn = document.getElementById('manualPreviewPinBtn');
const manualPreviewScrapBtn = document.getElementById('manualPreviewScrapBtn');
const qualityToggleBtn = document.getElementById('qualityToggleBtn');
const addCharacterBtn = document.getElementById('addCharacterBtn');
const characterPromptsContainer = document.getElementById('characterPromptsContainer');
const vibeNormalizeToggle = document.getElementById('vibeNormalizeToggle');
const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
const transformationRow = document.getElementById('transformationRow');
const manualPreviewOriginalImage = document.getElementById('manualPreviewOriginalImage');
const sproutSeedBtn = document.getElementById('sproutSeedBtn');
const previewSection = document.getElementById('manualPanelSection');
const variationImage = document.getElementById('manualVariationImage');
const previewCharacterReferenceImageBtn = document.getElementById('previewCharacterReferenceImageBtn');
const manualRescaleOverlay = manualRescale?.parentElement?.querySelector('.percentage-input-overlay');
const manualStrengthOverlay = manualStrengthValue?.parentElement?.querySelector('.percentage-input-overlay');
const manualNoiseOverlay = manualNoiseValue?.parentElement?.querySelector('.percentage-input-overlay');

// Director Reference Elements
const directorReferenceSection = document.getElementById('directorReferenceSection');
const directorReferenceGroup = document.getElementById('directorReferenceGroup');
const directorReferenceImage = document.getElementById('directorReferenceImage');
const addDirectorReferenceBtn = document.getElementById('addDirectorReferenceBtn');
const clearDirectorReferenceBtn = document.getElementById('clearDirectorReferenceBtn');
const directorReferenceStyleBtn = document.getElementById('directorReferenceStyleBtn');
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
let varietyEnabled = false;
let characterPromptCounter = 0;
let currentPositionCharacterId = null;
let selectedPositionCell = null;
let lastPromptState = null;
let savedRandomPromptState = null;
let forcePaidRequest = false;

// ============================================================================
// MANUAL MODAL MANAGEMENT FUNCTIONS (MOVED FROM app.js)
// ============================================================================

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

/**
 * Clear manual form - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
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
    clearDirectorReference();

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

    // Add director reference data
    const directorRefData = getDirectorReferenceForForgeData();
    if (directorRefData) {
        requestBody.chara_reference_source = `${directorRefData.type}:${directorRefData.id}`;
        if (directorRefData.with_style) {
            requestBody.chara_reference_with_style = true;
        }
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
        
        // Update prompt status icons after loading form data
        updatePromptStatusIcons();
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

/**
 * Handle manual generation - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
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

/**
 * Handle image result - MOVED FROM app.js
 * TODO: Move function implementation from app.js
 */
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

function setDirectorReference(referenceData) {
    if (!referenceData) return;

    directorReferenceData = referenceData;

    // Set the image source
    if (directorReferenceImage) {
        directorReferenceImage.src = referenceData.url;
    }

    // Reset style toggle to off for new reference
    if (directorReferenceStyleBtn) {
        directorReferenceStyleBtn.setAttribute('data-state', 'on');
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

    // Reset style toggle to off
    if (directorReferenceStyleBtn) {
        directorReferenceStyleBtn.setAttribute('data-state', 'on');
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

    return {
        type: directorReferenceData.type,
        id: directorReferenceData.id,
        with_style: styleEnabled
    };
}

// ============================================================================
// MODAL MANAGEMENT FUNCTIONS
// ============================================================================

// These functions will remain global to avoid breaking existing code
// TODO: Move implementations from app.js here when ready
