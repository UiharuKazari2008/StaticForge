// Global variables
let isAuthenticated = false;
let authToken = getCookie('authToken');
let imagesPerPage = 12;
let currentPage = 1;
let allImages = [];
let presets = [];
let pipelines = [];
let resolutions = [];
let models = [];
let samplers = [];
let noiseSchedulers = [];
let textReplacements = {};
let resizeTimeout = null;

// Cookie helpers
function setCookie(name, value, days) {
    let expires = '';
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days*24*60*60*1000));
        expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + (value || '')  + expires + '; path=/';
}
function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for(let i=0;i < ca.length;i++) {
        let c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}
function eraseCookie(name) {   
    document.cookie = name+'=; Max-Age=-99999999; path=/';  
}

// DOM elements
const loginModal = document.getElementById('loginModal');
const loginButton = document.getElementById('loginButton');
const loginBtn = document.getElementById('loginBtn');
const closeLoginBtn = document.getElementById('closeLoginBtn');
const loginPassword = document.getElementById('loginPassword');
const manualModal = document.getElementById('manualModal');
const manualBtn = document.getElementById('manualBtn');
const closeManualBtn = document.getElementById('closeManualBtn');
const manualForm = document.getElementById('manualForm');
const manualGenerateBtn = document.getElementById('manualGenerateBtn');
const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const closeLightbox = document.querySelector('.close-lightbox');
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

// Autocomplete elements
const autocompleteOverlay = document.getElementById('autocompleteOverlay');
const autocompleteList = document.querySelector('.autocomplete-list');

// Global variables for autocomplete
let currentAutocompleteTarget = null;
let selectedAutocompleteIndex = -1;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Check for auth cookie
    const cookieToken = getCookie('authToken');
    if (cookieToken) {
        isAuthenticated = true;
        authToken = cookieToken;
    }
    updateLoginButton();
    updateControlsVisibility();
    initializeApp();
    setupEventListeners();
});

// Initialize the application
async function initializeApp() {
    try {
        // Calculate initial images per page based on current window size
        imagesPerPage = calculateImagesPerPage();
        
        if (isAuthenticated) {
            await loadOptions();
        }
        await loadGallery();
        updateGenerateButton();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load application data');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Login modal events
    loginBtn.addEventListener('click', handleLogin);
    closeLoginBtn.addEventListener('click', hideLoginModal);
    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Manual modal events
    manualBtn.addEventListener('click', showManualModal);
    closeManualBtn.addEventListener('click', hideManualModal);
    manualForm.addEventListener('submit', handleManualGeneration);
    manualSaveBtn.addEventListener('click', handleManualSave);

    // Autocomplete events
    manualPrompt.addEventListener('input', handleAutocompleteInput);
    manualUc.addEventListener('input', handleAutocompleteInput);
    manualPrompt.addEventListener('keydown', handleAutocompleteKeydown);
    manualUc.addEventListener('keydown', handleAutocompleteKeydown);
    document.addEventListener('click', hideAutocomplete);

    // Lightbox events
    if (closeLightboxBtn) {
        closeLightboxBtn.addEventListener('click', hideLightbox);
    }
    
    if (closeLightbox) {
        closeLightbox.addEventListener('click', hideLightbox);
    }
    
    // ESC key to close lightbox and modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (lightboxModal.style.display === 'block') {
                hideLightbox();
            }
            if (loginModal.style.display === 'block') {
                hideLoginModal();
            }
            if (manualModal.style.display === 'block') {
                hideManualModal();
            }
        }
    });


    // Generation controls
    presetSelect.addEventListener('change', updateGenerateButton);
    resolutionSelect.addEventListener('change', updateGenerateButton);
    generateBtn.addEventListener('click', generateImage);
    maskPreviewBtn.addEventListener('click', showMaskPreview);

    // Pagination
    prevPage.addEventListener('click', () => changePage(-1));
    nextPage.addEventListener('click', () => changePage(1));

    // Login button
    loginButton.addEventListener('click', showLoginModal);
    
    // Close modals on outside click
    window.addEventListener('click', function(e) {
        if (e.target === loginModal) hideLoginModal();
        if (e.target === lightboxModal) hideLightbox();
        if (e.target === manualModal) hideManualModal();
    });
    
    // Resize handler for dynamic gallery sizing
    window.addEventListener('resize', handleResize);
}

// Load options from server
async function loadOptions() {
    try {
        const response = await fetch('/options?auth=' + encodeURIComponent(getCookie('authToken')));
        if (!response.ok) throw new Error('Failed to load options');
        
        const options = await response.json();
        
        // Populate presets
        presets = options.presets;
        pipelines = options.pipelines || [];
        console.log('=== LOADING PRESETS AND PIPELINES ===');
        console.log('Available presets:', presets);
        console.log('Available pipelines:', pipelines);
        presetSelect.innerHTML = '<option value="">Select preset or pipeline...</option>';
        
        // Add presets
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = `preset:${preset}`;
            option.textContent = preset;
            option.dataset.type = 'preset';
            presetSelect.appendChild(option);
            console.log('Added preset option:', preset);
        });
        
        // Add pipelines
        pipelines.forEach(pipeline => {
            const option = document.createElement('option');
            option.value = `pipeline:${pipeline}`;
            option.textContent = `🔗 ${pipeline}`;
            option.dataset.type = 'pipeline';
            presetSelect.appendChild(option);
            console.log('Added pipeline option:', pipeline);
        });
        console.log('=== END LOADING PRESETS AND PIPELINES ===');

        // Populate resolutions
        resolutions = Object.keys(options.resolutions);
        resolutionSelect.innerHTML = '<option value="">Select resolution...</option>';
        manualResolution.innerHTML = '<option value="">Select resolution...</option>';
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
        manualModel.innerHTML = '<option value="">Select model...</option>';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.toLowerCase(); // Use lowercase to match config
            option.textContent = model;
            manualModel.appendChild(option);
        });

        // Populate samplers for manual form
        samplers = Object.keys(options.samplers);
        manualSampler.innerHTML = '<option value="">Default</option>';
        samplers.forEach(sampler => {
            const option = document.createElement('option');
            option.value = sampler;
            option.textContent = sampler;
            manualSampler.appendChild(option);
        });

        // Populate noise schedulers for manual form
        noiseSchedulers = Object.keys(options.noiseSchedulers);
        manualNoiseScheduler.innerHTML = '<option value="">Default</option>';
        noiseSchedulers.forEach(scheduler => {
            const option = document.createElement('option');
            option.value = scheduler;
            option.textContent = scheduler;
            manualNoiseScheduler.appendChild(option);
        });

        // Store text replacements for autocomplete
        textReplacements = options.textReplacements || {};

    } catch (error) {
        console.error('Error loading options:', error);
        throw error;
    }
}

// Load gallery images
async function loadGallery() {
    try {
        const response = await fetch('/images');
        if (!response.ok) throw new Error('Failed to load gallery');
        
        allImages = await response.json();
        displayCurrentPage();
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
    
    // Extract preset name from filename (everything between timestamp and seed)
    const parts = image.base.split('_');
    const presetName = parts.length >= 3 ? parts.slice(1, -1).join('_') : 'generated';
    const seed = image.base.split('_').pop().replace('.png', '');
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
    downloadBtn.className = 'btn-primary download-btn';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadImage(image);
    };
    
    // Direct reroll button (left side)
    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'btn-primary reroll-btn';
    rerollBtn.innerHTML = '<i class="fas fa-dice"></i>';
    rerollBtn.title = 'Reroll with same settings';
    rerollBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImage(image);
    };
    
    // Reroll with edit button (right side with cog)
    const rerollEditBtn = document.createElement('button');
    rerollEditBtn.className = 'btn-primary reroll-edit-btn';
    rerollEditBtn.innerHTML = '<i class="fas fa-cog"></i>';
    rerollEditBtn.title = 'Reroll with Edit';
    rerollEditBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImageWithEdit(image);
    };
    
    // Upscale button (only for non-upscaled images)
    const upscaleBtn = document.createElement('button');
    upscaleBtn.className = 'btn-primary upscale-btn';
    upscaleBtn.innerHTML = '<i class="fas fa-expand"></i>';
    upscaleBtn.title = 'Upscale';
    upscaleBtn.onclick = (e) => {
        e.stopPropagation();
        upscaleImage(image);
    };
    
    // Only show upscale button for non-upscaled images
    if (!image.upscaled) {
        upscaleBtn.style.display = 'inline-block';
    } else {
        upscaleBtn.style.display = 'none';
    }
    
    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(rerollBtn);
    actionsDiv.appendChild(rerollEditBtn);
    actionsDiv.appendChild(upscaleBtn);
    
    overlay.appendChild(actionsDiv);
    
    item.appendChild(img);
    item.appendChild(overlay);
    
    // Click to show lightbox - prefer upscaled version
    item.addEventListener('click', () => {
        const imageToShow = {
            filename: image.upscaled || image.original,
            base: image.base,
            upscaled: image.upscaled
        };
        showLightbox(imageToShow);
    });
    
    return item;
}

// Direct reroll an image (same settings)
async function rerollImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    try {
        // Determine which filename to use for metadata
        const filenameForMetadata = image.upscaled || image.original;
        
        if (!filenameForMetadata) {
            throw new Error('No filename available for metadata lookup');
        }
        
        console.log('Direct reroll - fetching metadata for:', filenameForMetadata);
        
        // Get metadata from the image
        const response = await fetch(`/metadata/${filenameForMetadata}?auth=${encodeURIComponent(getCookie('authToken'))}`);
        
        if (!response.ok) {
            throw new Error(`Failed to load image metadata: ${response.status} ${response.statusText}`);
        }

        const metadata = await response.json();
        
        if (!metadata) {
            throw new Error('No metadata found for this image');
        }
        
        // Show loading
        showLoading(true);

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
        
        if (metadata.seed) {
            requestBody.seed = metadata.seed;
        }
        
        if (metadata.sampler) {
            requestBody.sampler = metadata.sampler;
        }
        
        if (metadata.noise_schedule) {
            requestBody.noiseScheduler = metadata.noise_schedule;
        }
        
        // Generate image with same settings
        const model = metadata.model ? metadata.model.toLowerCase() : 'v4_5';
        const url = `/${model}/generate?auth=${encodeURIComponent(getCookie('authToken'))}`;
        const generateResponse = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

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

    console.log('Reroll with edit called with image:', image);

    try {
        // Determine which filename to use for metadata
        const filenameForMetadata = image.upscaled || image.original;
        
        if (!filenameForMetadata) {
            throw new Error('No filename available for metadata lookup');
        }
        
        console.log('Fetching metadata for:', filenameForMetadata);
        
        // Get metadata from the image
        const response = await fetch(`/metadata/${filenameForMetadata}?auth=${encodeURIComponent(getCookie('authToken'))}`);
        
        if (!response.ok) {
            throw new Error(`Failed to load image metadata: ${response.status} ${response.statusText}`);
        }

        const metadata = await response.json();
        
        console.log('Received metadata:', metadata);
        
        if (!metadata) {
            throw new Error('No metadata found for this image');
        }

        // Close lightbox if it's open
        if (lightboxModal.style.display === 'block') {
            hideLightbox();
        }

        // Load metadata into manual form
        loadMetadataIntoManualForm(metadata, image);
        
        // Show manual modal directly (bypass preset selection logic)
        manualModal.style.display = 'block';
        if (manualPrompt) manualPrompt.focus();

    } catch (error) {
        console.error('Reroll with edit error:', error);
        showError('Failed to load image metadata: ' + error.message);
    }
}

// Load metadata into manual form
function loadMetadataIntoManualForm(metadata, image) {
    console.log('=== LOADING METADATA INTO FORM ===');
    console.log('Metadata received:', metadata);
    console.log('Image object:', image);
    console.log('Metadata keys:', Object.keys(metadata));
    console.log('UC value from metadata:', metadata.uc);
    console.log('Resolution value from metadata:', metadata.resolution);
    
    // Clear form first
    console.log('Clearing form...');
    clearManualForm();
    
    // Fill form with metadata
    console.log('Filling form fields...');
    
    if (manualPrompt) {
        manualPrompt.value = metadata.prompt || '';
        console.log('Set prompt to:', manualPrompt.value);
    } else {
        console.error('manualPrompt element not found!');
    }
    
    if (manualUc) {
        manualUc.value = metadata.uc || '';
        console.log('Set UC to:', manualUc.value);
    } else {
        console.error('manualUc element not found!');
    }
    
    // Map model to lowercase for form compatibility
    const modelValue = metadata.model ? metadata.model.toLowerCase() : '';
    if (manualModel) {
        manualModel.value = modelValue;
        console.log('Set model to:', manualModel.value);
    } else {
        console.error('manualModel element not found!');
    }
    
    if (manualResolution) {
        // Handle both resolution and width/height fields
        let resolutionValue = metadata.resolution || '';
        
        // If we have a resolution value, ensure it's uppercase for form compatibility
        if (resolutionValue) {
            resolutionValue = resolutionValue.toUpperCase();
        } else if (metadata.width && metadata.height) {
            // Try to match dimensions to a known resolution
            const dimensions = `${metadata.width}x${metadata.height}`;
            const resolutionMap = {
                '512x768': 'SMALL_PORTRAIT',
                '768x512': 'SMALL_LANDSCAPE',
                '640x640': 'SMALL_SQUARE',
                '832x1216': 'NORMAL_PORTRAIT',
                '1216x832': 'NORMAL_LANDSCAPE',
                '1024x1024': 'NORMAL_SQUARE',
                '1024x1536': 'LARGE_PORTRAIT',
                '1536x1024': 'LARGE_LANDSCAPE',
                '1472x1472': 'LARGE_SQUARE',
                '1088x1920': 'WALLPAPER_PORTRAIT',
                '1920x1088': 'WALLPAPER_LANDSCAPE'
            };
            resolutionValue = resolutionMap[dimensions] || '';
        }
        
        manualResolution.value = resolutionValue;
        console.log('Set resolution to:', manualResolution.value, '(from metadata resolution:', metadata.resolution, ', width:', metadata.width, ', height:', metadata.height, ')');
    } else {
        console.error('manualResolution element not found!');
    }
    
    if (manualSteps) {
        manualSteps.value = metadata.steps || 25;
        console.log('Set steps to:', manualSteps.value);
    } else {
        console.error('manualSteps element not found!');
    }
    
    if (manualGuidance) {
        manualGuidance.value = metadata.scale || 5.0;
        console.log('Set guidance to:', manualGuidance.value);
    } else {
        console.error('manualGuidance element not found!');
    }
    
    if (manualRescale) {
        manualRescale.value = metadata.cfg_rescale || 0.0;
        console.log('Set rescale to:', manualRescale.value);
    } else {
        console.error('manualRescale element not found!');
    }
    
    if (manualSeed) {
        manualSeed.value = metadata.seed || '';
        console.log('Set seed to:', manualSeed.value);
    } else {
        console.error('manualSeed element not found!');
    }
    
    if (manualSampler) {
        // Map NovelAI sampler values to dropdown options
        const samplerMapping = {
            'k_euler': 'EULER',
            'k_euler_ancestral': 'EULER_ANC',
            'dpm2s_ancestral': 'DPM2S_ANC',
            'dpm2m': 'DPM2M',
            'dpmsde': 'DPMSDE',
            'dpm2msde': 'DPM2MSDE',
            'ddim': 'DDIM'
        };
        
        const mappedSampler = samplerMapping[metadata.sampler] || metadata.sampler || '';
        manualSampler.value = mappedSampler;
        console.log('Set sampler to:', manualSampler.value, '(from metadata.sampler:', metadata.sampler, ', mapped to:', mappedSampler, ')');
        console.log('Available sampler options:', Array.from(manualSampler.options).map(opt => opt.value));
    } else {
        console.error('manualSampler element not found!');
    }
    
    if (manualNoiseScheduler) {
        // Map NovelAI noise schedule values to dropdown options
        const noiseMapping = {
            'native': 'NATIVE',
            'karras': 'KARRAS',
            'exponential': 'EXPONENTIAL',
            'polyexponential': 'POLYEXPONENTIAL'
        };
        
        const mappedNoise = noiseMapping[metadata.noise_schedule] || metadata.noise_schedule || '';
        manualNoiseScheduler.value = mappedNoise;
        console.log('Set noise scheduler to:', manualNoiseScheduler.value, '(from metadata.noise_schedule:', metadata.noise_schedule, ', mapped to:', mappedNoise, ')');
        console.log('Available noise scheduler options:', Array.from(manualNoiseScheduler.options).map(opt => opt.value));
    } else {
        console.error('manualNoiseScheduler element not found!');
    }
    
    if (manualUpscale) {
        manualUpscale.checked = false; // Default to no upscale for reroll
        console.log('Set upscale to: false');
    } else {
        console.error('manualUpscale element not found!');
    }
    
    // Set preset name based on image filename or base
    let presetName = 'generated';
    if (image && image.base) {
        const parts = image.base.split('_');
        if (parts.length >= 3) {
            presetName = parts.slice(1, -1).join('_');
        }
    } else if (image && image.filename) {
        const parts = image.filename.split('_');
        if (parts.length >= 3) {
            presetName = parts.slice(1, -1).join('_');
        }
    }
    
    if (manualPresetName) {
        manualPresetName.value = `${presetName}_edited`;
        console.log('Set preset name to:', manualPresetName.value);
    } else {
        console.error('manualPresetName element not found!');
    }
    
    console.log('=== FORM POPULATION COMPLETE ===');
}

// Upscale an image
async function upscaleImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    // Show upscaling dialog
    showUpscalingDialog();

    try {
        const response = await fetch(`/upscale/${image.original}?auth=${encodeURIComponent(getCookie('authToken'))}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Upscaling failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        // Hide upscaling dialog
        hideUpscalingDialog();
        
        // Show success message
        showSuccess('Image upscaled successfully!');
        
        // Reload gallery to show new upscaled image
        await loadGallery();
        
        // Find the upscaled image in the gallery and show it in lightbox
        const upscaledFilename = image.original.replace('.png', '_upscaled.png');
        const upscaledImage = allImages.find(img => img.original === upscaledFilename || img.upscaled === upscaledFilename);
        
        if (upscaledImage) {
            const imageToShow = {
                filename: upscaledImage.upscaled || upscaledImage.original,
                base: upscaledImage.base,
                upscaled: upscaledImage.upscaled
            };
            showLightbox(imageToShow);
        }
        
    } catch (error) {
        console.error('Upscaling error:', error);
        hideUpscalingDialog();
        showError('Image upscaling failed. Please try again.');
    }
}

// Show upscaling dialog
function showUpscalingDialog() {
    const dialog = document.createElement('div');
    dialog.id = 'upscalingDialog';
    dialog.className = 'modal';
    dialog.style.display = 'block';
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="loading-content">
                <div class="spinner"></div>
                <p>Upscaling image...</p>
                <p style="font-size: 0.9rem; color: #ccc;">This may take a few moments</p>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
}

// Hide upscaling dialog
function hideUpscalingDialog() {
    const dialog = document.getElementById('upscalingDialog');
    if (dialog) {
        dialog.remove();
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

// Show login modal
function showLoginModal() {
    loginModal.style.display = 'block';
    loginPassword.focus();
}

// Hide login modal
function hideLoginModal() {
    loginModal.style.display = 'none';
    loginPassword.value = '';
}

// Handle login
async function handleLogin() {
    const password = loginPassword.value.trim();
    if (!password) {
        showError('Please enter a password');
        return;
    }

    try {
        // Test authentication with a simple request
        const response = await fetch('/options?auth=' + encodeURIComponent(password));
        if (response.ok) {
            isAuthenticated = true;
            setCookie('authToken', password, 7);
            authToken = password;
            hideLoginModal();
            updateLoginButton();
            updateControlsVisibility();
            showSuccess('Login successful!');
            await loadOptions();
            updateGenerateButton();
        } else {
            showError('Invalid password');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Login failed. Please try again.');
    }
}

// Update login button
function updateLoginButton() {
    if (isAuthenticated) {
        loginButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
        loginButton.onclick = logout;
    } else {
        loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
        loginButton.onclick = showLoginModal;
    }
}

// Show/hide controls based on login
function updateControlsVisibility() {
    if (isAuthenticated) {
        controlsWrapper.style.display = '';
    } else {
        controlsWrapper.style.display = 'none';
    }
}

// Logout
function logout() {
    isAuthenticated = false;
    authToken = null;
    eraseCookie('authToken');
    updateLoginButton();
    updateControlsVisibility();
    updateGenerateButton();
    showSuccess('Logged out successfully');
}

// Show manual modal
function showManualModal() {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
    // Check if a preset is selected for editing
    const selectedPreset = presetSelect.value;
    if (selectedPreset) {
        loadPresetIntoManualForm(selectedPreset);
    } else {
        // Clear form for new generation
        clearManualForm();
    }
    
    manualModal.style.display = 'block';
    manualPrompt.focus();
}

// Hide manual modal
function hideManualModal() {
    manualModal.style.display = 'none';
    clearManualForm();
}

// Clear manual form
function clearManualForm() {
    manualForm.reset();
    manualPresetName.value = '';
    manualSeed.value = '';
    manualSampler.value = '';
    manualNoiseScheduler.value = '';
}

// Load preset into manual form
async function loadPresetIntoManualForm(presetName) {
    try {
        const response = await fetch(`/preset/${presetName}/raw?auth=${encodeURIComponent(getCookie('authToken'))}`);
        if (response.ok) {
            const data = await response.json();
            
            // Fill form with raw preset data (no text replacement processing)
            manualPrompt.value = data.prompt || '';
            manualUc.value = data.uc || '';
            manualModel.value = data.model || '';
            manualResolution.value = data.resolution || '';
            manualSteps.value = data.steps || 25;
            manualGuidance.value = data.guidance || 5.0;
            manualRescale.value = data.rescale || 0.0;
            manualSeed.value = data.seed || '';
            manualSampler.value = data.sampler || '';
            manualNoiseScheduler.value = data.noiseScheduler || '';
            manualUpscale.checked = data.upscale || false;
            
            // Set preset name for saving
            manualPresetName.value = presetName;
            
        } else {
            throw new Error('Failed to load preset data');
        }
    } catch (error) {
        console.error('Error loading preset:', error);
        showError('Failed to load preset data');
    }
}

// Handle manual generation
async function handleManualGeneration(e) {
    e.preventDefault();
    
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
    // Validate required fields
    const model = manualModel.value;
    const prompt = manualPrompt.value.trim();
    const resolution = manualResolution.value;
    
    if (!model || !prompt || !resolution) {
        showError('Please fill in all required fields (Model, Prompt, Resolution)');
        return;
    }
    
    // Capture all form values BEFORE hiding the modal (which clears the form)
    const ucValue = manualUc.value.trim();
    const seedValue = manualSeed.value.trim();
    const samplerValue = manualSampler.value;
    const noiseSchedulerValue = manualNoiseScheduler.value;
    const stepsValue = parseInt(manualSteps.value) || 25;
    const guidanceValue = parseFloat(manualGuidance.value) || 5.0;
    const rescaleValue = parseFloat(manualRescale.value) || 0.0;
    const upscaleValue = manualUpscale.checked;
    
    showLoading(true);
    hideManualModal();
    
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
        
        if (ucValue) {
            requestBody.uc = ucValue;
            console.log('Adding UC to request:', ucValue);
        } else {
            console.log('UC field is empty, not adding to request');
        }
        
        if (seedValue) {
            requestBody.seed = parseInt(seedValue);
            console.log('Adding seed to request:', requestBody.seed);
        }
        
        if (samplerValue) {
            // Map dropdown values back to NovelAI API format
            const reverseSamplerMapping = {
                'EULER': 'k_euler',
                'EULER_ANC': 'k_euler_ancestral',
                'DPM2S_ANC': 'dpm2s_ancestral',
                'DPM2M': 'dpm2m',
                'DPMSDE': 'dpmsde',
                'DPM2MSDE': 'dpm2msde',
                'DDIM': 'ddim'
            };
            
            const apiSampler = reverseSamplerMapping[samplerValue] || samplerValue;
            requestBody.sampler = apiSampler;
            console.log('Adding sampler to request:', apiSampler, '(from dropdown:', samplerValue, ')');
        } else {
            console.log('Sampler field is empty, not adding to request');
        }
        
        if (noiseSchedulerValue) {
            // Map dropdown values back to NovelAI API format
            const reverseNoiseMapping = {
                'NATIVE': 'native',
                'KARRAS': 'karras',
                'EXPONENTIAL': 'exponential',
                'POLYEXPONENTIAL': 'polyexponential'
            };
            
            const apiNoise = reverseNoiseMapping[noiseSchedulerValue] || noiseSchedulerValue;
            requestBody.noiseScheduler = apiNoise;
            console.log('Adding noise scheduler to request:', apiNoise, '(from dropdown:', noiseSchedulerValue, ')');
        } else {
            console.log('Noise scheduler field is empty, not adding to request');
        }
        
        // Add upscale if enabled
        if (upscaleValue) {
            requestBody.upscale = true;
            console.log('Adding upscale to request');
        }
        
        // Generate image
        const url = `/${model.toLowerCase()}/generate?auth=${encodeURIComponent(getCookie('authToken'))}`;
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
            
            // Save preset if name is provided
            const presetName = manualPresetName.value.trim();
            if (presetName) {
                saveManualPreset(presetName, requestBody);
            }
            
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
    }
}

// Save manual preset (this would need a backend endpoint)
async function saveManualPreset(presetName, config) {
    try {
        const response = await fetch('/preset/save?auth=' + encodeURIComponent(getCookie('authToken')), {
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
        upscale: manualUpscale.checked
    };
    
    // Add optional fields if they have values
    if (manualSeed.value.trim()) {
        presetData.seed = parseInt(manualSeed.value);
    }
    
    if (manualSampler.value) {
        presetData.sampler = manualSampler.value;
    }
    
    if (manualNoiseScheduler.value) {
        presetData.noiseScheduler = manualNoiseScheduler.value;
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
        generateBtn.disabled = !resolution;
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
    const upscale = upscaleToggle.checked;

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

    showLoading(true);

    try {
        let url;
        
        if (type === 'preset') {
            // For presets, resolution is required
            if (!resolution) {
                showError('Please select a resolution for preset generation');
                showLoading(false);
                return;
            }
            url = `/preset/${name}/${resolution}?auth=${encodeURIComponent(getCookie('authToken'))}&forceGenerate=true${upscale ? '&upscale=true' : ''}`;
        } else if (type === 'pipeline') {
            // For pipelines, resolution is optional (uses pipeline's resolution if not specified)
            const params = new URLSearchParams({
                auth: getCookie('authToken'),
                forceGenerate: 'true'
            });
            if (upscale) params.append('upscale', 'true');
            if (resolution) params.append('resolution', resolution);
            
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
        
        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = function() {
            const generatedImage = {
                filename: `generated_${Date.now()}.png`,
                width: img.width,
                height: img.height,
                url: imageUrl
            };
            
            showLightbox(generatedImage);
            createConfetti();
            showSuccess('Image generated successfully!');
            
            // Refresh gallery after a short delay
            setTimeout(() => {
                loadGallery();
            }, 1000);
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

    // Update lightbox controls based on image type
    updateLightboxControls(image);

    // Load and display metadata
    await loadAndDisplayMetadata(image.filename);
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
    const metadataDiv = document.getElementById('lightboxMetadata');
    const metadataContent = document.getElementById('metadataContent');
    
    try {
        const response = await fetch(`/metadata/${filename}?auth=${encodeURIComponent(getCookie('authToken'))}`);
        
        if (response.ok) {
            const metadata = await response.json();
            
            if (metadata && Object.keys(metadata).length > 0) {
                // Display metadata
                let html = '';
                
                // Define field mappings for better labels
                const fieldMappings = {
                    'prompt': 'Prompt',
                    'uc': 'Undesired Content',
                    'model_display_name': 'Model',
                    'steps': 'Steps',
                    'scale': 'Prompt Guidance',
                    'cfg_rescale': 'Prompt Guidance Rescale',
                    'sampler': 'Sampler',
                    'noise_schedule': 'Noise Schedule',
                    'seed': 'Seed',
                    'resolution': 'Resolution',
                    'width': 'Width',
                    'height': 'Height'
                };
                
                // Display key metadata fields in order
                const keyFields = ['prompt', 'uc', 'model_display_name', 'steps', 'scale', 'cfg_rescale', 'sampler', 'noise_schedule', 'seed'];
                
                keyFields.forEach(field => {
                    if (metadata[field] !== undefined && metadata[field] !== null) {
                        html += `<div class="metadata-item">`;
                        html += `<span class="metadata-label">${fieldMappings[field] || field.replace('_', ' ')}:</span>`;
                        
                        if (field === 'prompt' || field === 'uc') {
                            html += `<span class="metadata-value ${field}">${metadata[field]}</span>`;
                        } else {
                            html += `<span class="metadata-value">${metadata[field]}</span>`;
                        }
                        
                        html += `</div>`;
                    }
                });
                
                // Handle resolution vs width/height
                if (metadata.resolution) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Resolution:</span>`;
                    html += `<span class="metadata-value">${formatResolution(metadata.resolution)}</span>`;
                    html += `</div>`;
                } else if (metadata.width && metadata.height) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Dimensions:</span>`;
                    html += `<span class="metadata-value">${metadata.width} × ${metadata.height}</span>`;
                    html += `</div>`;
                }
                
                // Display source/software info if available
                if (metadata.source) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Source:</span>`;
                    html += `<span class="metadata-value">${metadata.source}</span>`;
                    html += `</div>`;
                }
                
                if (metadata.software) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Software:</span>`;
                    html += `<span class="metadata-value">${metadata.software}</span>`;
                    html += `</div>`;
                }
                
                metadataContent.innerHTML = html;
                metadataDiv.style.display = 'block';
            } else {
                metadataDiv.style.display = 'none';
            }
        } else {
            metadataDiv.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading metadata:', error);
        metadataDiv.style.display = 'none';
    }
}

// Hide lightbox
function hideLightbox() {
    lightboxModal.style.display = 'none';
    lightboxImage.src = '';
    
    // Restore body scrolling
    document.body.style.overflow = '';
    
    // Clear metadata
    const metadataDiv = document.getElementById('lightboxMetadata');
    const metadataContent = document.getElementById('metadataContent');
    if (metadataDiv) metadataDiv.style.display = 'none';
    if (metadataContent) metadataContent.innerHTML = '';
    
    if (lightboxUpscaleBtn) {
        lightboxUpscaleBtn.style.display = 'none';
        lightboxUpscaleBtn.onclick = null;
    }
    
    if (lightboxRerollBtn) {
        lightboxRerollBtn.style.display = 'none';
        lightboxRerollBtn.onclick = null;
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
        // For gallery images - prefer upscaled version if available
        filename = image.upscaled || image.original;
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
        const filenameToDelete = image.upscaled || image.original;
        
        if (!filenameToDelete) {
            throw new Error('No filename available for deletion');
        }
        
        console.log('Deleting image:', filenameToDelete);
        
        // Send delete request
        const response = await fetch(`/images/${filenameToDelete}?auth=${encodeURIComponent(getCookie('authToken'))}`, {
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
    const colors = ['#ff4500', '#ff6347', '#ff8c00', '#ffa500'];
    
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = (Math.random() * 10 + 5) + 'px';
            confetti.style.height = (Math.random() * 10 + 5) + 'px';
            
            confettiContainer.appendChild(confetti);
            
            // Remove confetti after animation
            setTimeout(() => {
                if (confetti.parentNode) {
                    confetti.parentNode.removeChild(confetti);
                }
            }, 3000);
        }, i * 50);
    }
}

// Show loading overlay
function showLoading(show) {
    if (show) {
        loadingOverlay.classList.remove('hidden');
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
    const upscaleBtn = document.getElementById('lightboxUpscaleBtn');
    const deleteBtn = document.getElementById('lightboxDeleteBtn');
    
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
    
    // Show both reroll buttons for all images (both original and upscaled)
    rerollBtn.style.display = 'inline-block';
    rerollEditBtn.style.display = 'inline-block';
    
    // Show upscale button only for non-upscaled images
    if (image.upscaled) {
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
    
    // Construct proper image object for functions
    const imageObj = {
        filename: image.filename,
        base: image.base,
        original: image.upscaled ? image.filename.replace('_upscaled.png', '.png') : image.filename,
        upscaled: image.upscaled ? image.filename : null
    };
    
    // Set up event listeners
    downloadBtn.onclick = (e) => {
        e.preventDefault();
        downloadImage(imageObj);
    };
    rerollBtn.onclick = () => rerollImage(imageObj); // Direct reroll
    rerollEditBtn.onclick = () => rerollImageWithEdit(imageObj); // Reroll with edit
    upscaleBtn.onclick = () => upscaleImage(imageObj);
    deleteBtn.onclick = () => deleteImage(imageObj); // Delete image
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
    
    console.log(`Gallery width: ${galleryWidth}px, Effective width: ${effectiveWidth}px, Items per row: ${safeItemsPerRow}, Images per page: ${newImagesPerPage}`);
    
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
            console.log(`Updating images per page from ${imagesPerPage} to ${newImagesPerPage}`);
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
        const url = `/pipeline/${name}/mask?auth=${encodeURIComponent(getCookie('authToken'))}`;
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