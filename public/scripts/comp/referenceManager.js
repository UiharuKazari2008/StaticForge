const cacheBrowserContainer = document.getElementById('cacheBrowserContainer');
const cacheBrowserLoadingContainer = document.getElementById('cacheBrowserLoadingContainer');
const cacheGalleryContainer = document.getElementById('cacheGalleryContainer');
const referencesTab = document.getElementById('references-tab');
const cacheManagerModal = document.getElementById('cacheManagerModal');
const unifiedUploadModal = document.getElementById('unifiedUploadModal');
const cacheManagerMoveModal = document.getElementById('cacheManagerMoveModal');
const cacheManagerDeleteModal = document.getElementById('cacheManagerDeleteModal');
const vibeManagerModal = document.getElementById('vibeManagerModal');
const vibeEncodingModal = document.getElementById('vibeEncodingModal');
const vibeEncodingModelDropdown = document.getElementById('vibeEncodingModelDropdown');
const cacheManagerBtn = document.getElementById('cacheManagerBtn');
const closeCacheManagerBtn = document.getElementById('closeCacheManagerBtn');
const closeCacheManagerMoveModalBtn = document.getElementById('closeCacheManagerMoveModalBtn');
const cacheManagerRefreshBtn = document.getElementById('cacheManagerRefreshBtn');
const cacheManagerUploadBtn = document.getElementById('cacheManagerUploadBtn');
const closeVibeEncodingBtn = document.getElementById('closeVibeEncodingBtn');
const vibeEncodingCancelBtn = document.getElementById('vibeEncodingCancelBtn');
const vibeEncodingConfirmBtn = document.getElementById('vibeEncodingConfirmBtn');
const vibeEncodingFileInput = document.getElementById('vibeEncodingFileInput');
const vibeEncodingIeInput = document.getElementById('vibeEncodingIeInput');
const vibeEncodingModelDropdownBtn = document.getElementById('vibeEncodingModelDropdownBtn');
const vibeEncodingModelDropdownMenu = document.getElementById('vibeEncodingModelDropdownMenu');
const vibeEncodingModelSelected = document.getElementById('vibeEncodingModelSelected');
const vibeEncodingModalTitle = document.getElementById('vibeEncodingModalTitle');
const vibeEncodingConfirmText = document.getElementById('vibeEncodingConfirmText');
const vibeEncodingUploadSection = document.getElementById('vibeEncodingUploadSection');
const vibeEncodingReferenceSection = document.getElementById('vibeEncodingReferenceSection');
const vibeEncodingReferencePreview = document.getElementById('vibeEncodingReferencePreview');
const closeVibeManagerMoveModalBtn = document.getElementById('closeVibeManagerMoveModalBtn');
const closeVibeManagerDeleteModalBtn = document.getElementById('closeVibeManagerDeleteModalBtn');
const vibeManagerDeleteCancelBtn = document.getElementById('vibeManagerDeleteCancelBtn');
const vibeManagerDeleteConfirmBtn = document.getElementById('vibeManagerDeleteConfirmBtn');
const cacheManagerMoveCancelBtn = document.getElementById('cacheManagerMoveCancelBtn');
const cacheManagerMoveConfirmBtn = document.getElementById('cacheManagerMoveConfirmBtn');
const vibeManagerMoveCancelBtn = document.getElementById('vibeManagerMoveCancelBtn');
const vibeManagerMoveConfirmBtn = document.getElementById('vibeManagerMoveConfirmBtn');
const vibeManagerMoveBtn = document.getElementById('vibeManagerMoveBtn');
const manualStrengthGroup = document.getElementById('manualStrengthGroup');
const manualNoiseGroup = document.getElementById('manualNoiseGroup');
const cacheManagerWorkspaceDropdown = document.getElementById('cacheManagerWorkspaceDropdown');
const cacheManagerWorkspaceDropdownBtn = document.getElementById('cacheManagerWorkspaceDropdownBtn');
const cacheManagerWorkspaceDropdownMenu = document.getElementById('cacheManagerWorkspaceDropdownMenu');
const cacheManagerWorkspaceSelected = document.getElementById('cacheManagerWorkspaceSelected');
const cacheManagerLoading = document.getElementById('cacheManagerLoading');
const cacheManagerGallery = document.getElementById('cacheManagerGallery');
const cacheManagerMoveBtn = document.getElementById('cacheManagerMoveBtn');
const cacheManagerProgressFill = document.getElementById('cacheManagerProgressFill');
const cacheManagerProgressText = document.getElementById('cacheManagerProgressText');
const cacheManagerMoveCount = document.getElementById('cacheManagerMoveCount');
const cacheManagerMoveTargetSelect = document.getElementById('cacheManagerMoveTargetSelect');
const vibeManagerFromReferenceModal = document.getElementById('vibeManagerFromReferenceModal');
const vibeManagerFromReferencePreview = document.getElementById('vibeManagerFromReferencePreview');
const vibeManagerFromReferenceModelSelected = document.getElementById('vibeManagerFromReferenceModelSelected');
const vibeManagerDeleteModal = document.getElementById('vibeManagerDeleteModal');
const vibeManagerMoveModal = document.getElementById('vibeManagerMoveModal');
const vibeManagerGallery = document.getElementById('vibeManagerGallery');
const vibeManagerLoading = document.getElementById('vibeManagerLoading');
const vibeManagerMoveCount = document.getElementById('vibeManagerMoveCount');
const vibeManagerMoveTargetSelect = document.getElementById('vibeManagerMoveTargetSelect');
const closeUnifiedUploadBtn = document.getElementById('closeUnifiedUploadBtn');
const unifiedUploadCancelBtn = document.getElementById('unifiedUploadCancelBtn');
const unifiedUploadConfirmBtn = document.getElementById('unifiedUploadConfirmBtn');
const unifiedUploadFileInput = document.getElementById('unifiedUploadFileInput');
const unifiedUploadFileText = document.getElementById('unifiedUploadFileText');
const unifiedUploadProgress = document.getElementById('unifiedUploadProgress');
const unifiedUploadProgressFill = document.getElementById('unifiedUploadProgressFill');
const unifiedUploadProgressText = document.getElementById('unifiedUploadProgressText');
const unifiedUploadVibeControls = document.getElementById('unifiedUploadVibeControls');
const unifiedUploadModelDropdown = document.getElementById('unifiedUploadModelDropdown');
const unifiedUploadModelDropdownBtn = document.getElementById('unifiedUploadModelDropdownBtn');
const unifiedUploadModelDropdownMenu = document.getElementById('unifiedUploadModelDropdownMenu');
const unifiedUploadModelSelected = document.getElementById('unifiedUploadModelSelected');
const unifiedUploadIeInput = document.getElementById('unifiedUploadIeInput');
const unifiedUploadModalTitle = document.getElementById('unifiedUploadModalTitle');
const unifiedUploadConfirmText = document.getElementById('unifiedUploadConfirmText');
const unifiedUploadModeDisplay = document.getElementById('unifiedUploadModeDisplay');
const unifiedUploadModelDisplay = document.getElementById('unifiedUploadModelDisplay');
const unifiedUploadBackgroundImage = document.getElementById('unifiedUploadBackgroundImage');

// Reference Browser Functions
let cacheImages = [];
let cacheCurrentPage = 1;
let cacheImagesPerPage = 20;

// Combined Vibe Encoding Modal Variables
let vibeEncodingCurrentMode = null; // 'upload', 'ie', 'reference'
let vibeEncodingSelectedModel = 'v4_5';
let vibeEncodingCurrentVibeImage = null;
let vibeEncodingCurrentCacheImage = null;

// Unified Upload Modal Variables
let unifiedUploadCurrentMode = 'reference'; // 'reference', 'vibe'
let unifiedUploadSelectedModel = 'v4_5';

// Reference Manager Variables
let cacheManagerImages = [];
let cacheManagerCurrentWorkspace = 'default';
let vibeManagerImages = [];
let vibeManagerMoveTargetImage = null;
let vibeManagerSelectedImages = new Set();
let cacheManagerMoveTargetImage = null;


async function showCacheBrowser() {
    // Show as container in preview section

    if (!cacheBrowserContainer || !cacheBrowserLoadingContainer || !cacheGalleryContainer || !previewSection) return;

    // Set active panel to cache browser
    previewSection.setAttribute('data-active-panel', 'cache-browser');
    cacheBrowserLoadingContainer.style.display = 'flex';
    cacheGalleryContainer.innerHTML = '';

    if (window.innerWidth <= 1400) {
        previewSection.classList.add('show');
        setTimeout(() => { previewSection.classList.add('active'); }, 1);
    }

    try {
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error loading cache images:', error);
        showError('Failed to load cache images');
    } finally {
        cacheBrowserLoadingContainer.style.display = 'none';
    }
}

function hideCacheBrowser() {
    // Hide both modal and container versions
    if (cacheBrowserContainer) {
        cacheBrowserContainer.style.display = 'none';
    }

    // Clear active panel to show manual preview
    if (previewSection) {
        if (window.innerWidth <= 1400) {
            previewSection.classList.remove('show');
            setTimeout(() => { previewSection.classList.remove('active'); }, 1);
            setTimeout(() => { previewSection.removeAttribute('data-active-panel'); }, 1000);
        } else {
            previewSection.removeAttribute('data-active-panel');
        }
    }
}

async function loadCacheImages() {
    try {
        // Load unified references (cache images and vibe images together)
        const response = await wsClient.getReferences();

        if (response.success) {
            const data = response.data;
            const cacheImagesData = data.cacheFiles || [];
            const vibeImagesData = data.vibeImages || [];
            
            // Create a map of cache images by hash
            const cacheMap = new Map();
            cacheImagesData.forEach(cache => {
                cacheMap.set(cache.hash, {
                    ...cache,
                    type: 'cache',
                    vibes: []
                });
            });
            
            // Add vibe images to their corresponding cache images
            vibeImagesData.forEach(vibe => {
                if (vibe.type === 'cache' && cacheMap.has(vibe.source)) {
                    // This vibe is based on a cache image
                    const cacheItem = cacheMap.get(vibe.source);
                    cacheItem.vibes.push(vibe);
                    cacheItem.hasVibes = true;
                } else {
                    // This is a standalone vibe (base64)
                    const standaloneVibe = {
                        hash: vibe.id,
                        filename: vibe.filename,
                        mtime: vibe.mtime,
                        size: vibe.size,
                        hasPreview: vibe.preview,
                        type: 'vibe',
                        vibes: [vibe],
                        hasVibes: true,
                        isStandalone: true
                    };
                    cacheMap.set(vibe.id, standaloneVibe);
                }
            });
            
            // Convert map to array and sort by newest first
            const combinedImages = Array.from(cacheMap.values());
            
            // Sort by mtime (newest first)
            combinedImages.sort((a, b) => {
                const aTime = a.mtime || 0;
                const bTime = b.mtime || 0;
                return bTime - aTime;
            });
            
            cacheImages = combinedImages;
        } else {
            throw new Error('Failed to load references');
        }
    } catch (error) {
        console.error('Error loading cache images:', error);
        throw error;
    }
}

function displayCacheImages() {
    // Get the references tab gallery (modal version)
    const cacheGallery = referencesTab ? referencesTab.querySelector('#cacheGallery') : null;

    if (!cacheGallery) return;

    cacheGallery.innerHTML = '';

    if (cacheImages.length === 0) {
        cacheGallery.innerHTML = `
        <div class="no-images">
            <i class="fas fa-image-slash"></i>
            <span>No cache images found</span>
        </div>
    `;
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
    if (!cacheGalleryContainer) return;

    cacheGalleryContainer.innerHTML = '';

    if (cacheImages.length === 0) {
        cacheGalleryContainer.innerHTML = `
        <div class="no-images">
            <i class="fas fa-image-slash"></i>
            <span>No cache images found</span>
        </div>
    `;
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

function createCacheGalleryItem(cacheImage) {
    const item = document.createElement('div');
    item.className = 'cache-gallery-item';

    // Create image element
    const img = document.createElement('img');
    if (cacheImage.isStandalone) {
        // For standalone vibes, use the vibe's preview or fallback
        if (cacheImage.hasPreview) {
            img.src = `/cache/preview/${cacheImage.hasPreview}`;
        } else {
            img.src = '/images/placeholder.png';
        }
    } else {
        // For cache images (with or without vibes)
        if (cacheImage.hasPreview) {
            img.src = `/cache/preview/${cacheImage.hash}.webp`;
        } else {
            img.src = `/cache/${cacheImage.hash}`;
        }
    }
    img.alt = `Reference image ${cacheImage.hash}`;
    img.loading = 'lazy';

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'cache-gallery-item-overlay';

    // Create info
    const info = document.createElement('div');
    info.className = 'cache-gallery-item-info';

    info.innerHTML = ``;

    // Create action buttons container (middle section)
    const actionButtonsContainer = document.createElement('div');
    actionButtonsContainer.className = 'cache-gallery-item-action-buttons';
    
    // Create "Add as Base Image" button
    const baseImageBtn = document.createElement('button');
    baseImageBtn.className = 'btn-primary';
    baseImageBtn.innerHTML = '<i class="nai-img2img"></i>';
    baseImageBtn.title = 'Add as base image';
    baseImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addAsBaseImage(cacheImage);
    });
    
    // Create "Add as Vibe" button
    const vibeBtn = document.createElement('button');
    vibeBtn.className = 'btn-primary';
    vibeBtn.innerHTML = '<i class="nai-vibe-transfer"></i>';
    vibeBtn.title = 'Add as vibe reference';
    vibeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addAsVibeReference(cacheImage);
    });
    
    if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
        vibeBtn.disabled = false;
    } else {
        vibeBtn.disabled = true;
    }
    if (cacheImage.isStandalone) {
        baseImageBtn.disabled = true;
        baseImageBtn.title = 'Cannot add vibe as base image';
    } else {
        baseImageBtn.disabled = false;
        baseImageBtn.title = 'Add as base image';
    }
    
    actionButtonsContainer.appendChild(baseImageBtn);
    actionButtonsContainer.appendChild(vibeBtn);
    
    // Create management buttons container (top section)
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cache-gallery-item-buttons';
    
    // Create vibe encode button (always show to allow adding more IEs)
    const vibeEncodeBtn = document.createElement('button');
    vibeEncodeBtn.className = 'btn-secondary btn-small';
    vibeEncodeBtn.innerHTML = '<span>New IE</span><i class="nai-vibe-transfer"></i>';
    vibeEncodeBtn.title = cacheImage.hasVibes ? 'Add Another Vibe Encoding' : 'Create Vibe Encoding';
    vibeEncodeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
            // Use 'ie' mode to add additional IEs to existing vibe
            showVibeEncodingModal('ie', cacheImage.vibes[0]);
        } else {
            // Use 'reference' mode to create new vibe from cache image
            showVibeEncodingModal('reference', cacheImage);
        }
    });

    buttonsContainer.appendChild(vibeEncodeBtn);

    overlay.appendChild(info);
    overlay.appendChild(actionButtonsContainer);
    overlay.appendChild(buttonsContainer);

    // Create badges container
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'cache-badges';

    // Add default workspace badge if this is a default workspace item
    if (cacheImage.workspaceId === 'default') {
        const badge = document.createElement('div');
        badge.className = 'cache-badge default-workspace-badge';
        badge.innerHTML = '<i class="fas fa-home"></i><span>Default</span>';
        badgesContainer.appendChild(badge);
    }

    // Add base image badge only for actual cache images (not standalone vibes)
    if (!cacheImage.isStandalone) {
        const baseBadge = document.createElement('div');
        baseBadge.className = 'cache-badge base-image';
        baseBadge.textContent = 'Base Image';
        badgesContainer.appendChild(baseBadge);
    }

    // Add vibe encoding badges
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        cacheImage.vibes.forEach(vibe => {
            if (vibe.encodings && Array.isArray(vibe.encodings)) {
                vibe.encodings.forEach(encoding => {
                    const encodingBadge = document.createElement('div');
                    encodingBadge.className = 'cache-badge encoding';
                    
                    // Get model display name
                    const modelKey = encoding.model;
                    const modelDisplayName = modelBadges[modelKey] ? modelBadges[modelKey].display : modelKey;
                    
                    encodingBadge.innerHTML = `
                        <span class="badge-model">${modelDisplayName}</span>
                        <span class="badge-ie">${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%</span>
                    `;
                    encodingBadge.title = `Model: ${modelDisplayName}, IE: ${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%`;
                    badgesContainer.appendChild(encodingBadge);
                });
            }
        });
    }

    item.appendChild(img);
    item.appendChild(overlay);
    item.appendChild(badgesContainer);

    return item;
}

function createVibeReferenceItem(vibeRef) {
    const item = document.createElement('div');
    item.className = 'vibe-reference-item';
    item.setAttribute('data-vibe-id', vibeRef.id);

    const previewContainer = document.createElement('div');
    previewContainer.className = 'variation-image-container';

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

    previewContainer.appendChild(preview);

    const overlayIconContainer = document.createElement('div');
    overlayIconContainer.className = 'overlay-icon-container';
    overlayIconContainer.innerHTML = '<i class="nai-vibe-transfer"></i>';
    previewContainer.appendChild(overlayIconContainer);

    // Create controls
    const controls = document.createElement('div');
    controls.className = 'vibe-reference-controls';

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger blur';
    deleteBtn.innerHTML = '<i class="nai-thin-cross"></i>';
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

    const ieText = document.createElement('span');

    // Get current model
    const currentModel = manualSelectedModel || manualModelHidden?.value || '';

    // Get available encodings for this vibe (filtered by current model)
    const availableEncodings = vibeRef.encodings ?
        vibeRef.encodings.filter(encoding => encoding.model.toLowerCase() === currentModel.toLowerCase()) : [];

    if (availableEncodings.length > 0) {
        // Use the first encoding as default
        const defaultEncoding = availableEncodings[0];
        ieText.textContent = `${(parseFloat(defaultEncoding.informationExtraction) * 100).toFixed(0)}%`;
        ieDropdownBtn.dataset.selectedModel = defaultEncoding.model;
        ieDropdownBtn.dataset.selectedIe = defaultEncoding.informationExtraction;
    } else {
        ieText.textContent = 'No encodings';
        ieDropdownBtn.disabled = true;
    }
    ieDropdownBtn.appendChild(ieText);

    const ieSuffix = document.createElement('span');
    ieSuffix.style.opacity = '0.5';
    ieSuffix.textContent = 'IE';
    ieDropdownBtn.appendChild(ieSuffix);

    const ieDropdownMenu = document.createElement('div');
    ieDropdownMenu.className = 'custom-dropdown-menu';
    ieDropdownMenu.style.display = 'none';

    // Add encoding options (only for current model)
    availableEncodings.forEach(encoding => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.textContent = `${(parseFloat(encoding.informationExtraction) * 100).toFixed(0)}%`;
        option.dataset.model = encoding.model;
        option.dataset.ie = encoding.informationExtraction;

        option.addEventListener('click', () => {
            const optionText = document.createElement('span');
            optionText.textContent = `${(parseFloat(encoding.informationExtraction) * 100).toFixed(0)}%`;
            ieDropdownBtn.innerHTML = '';
            ieDropdownBtn.appendChild(optionText);
            ieDropdownBtn.appendChild(ieSuffix);
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

    item.appendChild(previewContainer);
    item.appendChild(controls);
    item.appendChild(info);

    return item;
}

async function addAsBaseImage(cacheImage) {
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
        
        // Close cache browser
        hideCacheBrowser();
        
        showGlassToast('success', null, 'Base image set successfully');
    } catch (error) {
        console.error('Error adding as base image:', error);
        showError('Failed to set base image');
    }
}

async function addAsVibeReference(cacheImage) {
    try {
    // Check if inpainting is enabled (mask is present)
    if (window.currentMaskData) {
        console.warn('Cannot add vibe references during inpainting');
        showError('Vibe transfers are disabled during inpainting');
        return;
    }

        // Find the vibe reference in the cache images array
        let vibeRef = null;
        if (cacheImage.isStandalone) {
            // This is a standalone vibe, use it directly
            vibeRef = cacheImage.vibes[0];
        } else if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
            // This cache image has vibes, use the first one
            vibeRef = cacheImage.vibes[0];
        } else {
            showError('No vibe encodings found for this image');
            return;
        }

    if (!vibeRef) {
            showError('No vibe reference found');
            return;
        }

        // Add to vibe references container
        await addVibeReferenceToContainer(vibeRef.id);

        // Close cache browser
        hideCacheBrowser();
        
        showGlassToast('success', null, 'Vibe reference added successfully');
            } catch (error) {
        console.error('Error adding as vibe reference:', error);
        showError('Failed to add vibe reference');
    }
}

async function addVibeReferenceToContainer(vibeId, selectedIe, strength) {
    // Check if inpainting is enabled (mask is present)
    if (window.currentMaskData) {
        console.warn('Cannot add vibe references during inpainting');
        showError('Vibe transfers are disabled during inpainting');
        return;
    }

    // Find the vibe reference in the cache images array
    let vibeRef = null;
    for (const cacheImage of cacheImages) {
        if (cacheImage.vibes) {
            const foundVibe = cacheImage.vibes.find(vibe => vibe.id === vibeId);
            if (foundVibe) {
                vibeRef = foundVibe;
                break;
            }
            }
        }

        if (!vibeRef) {
            console.error(`Vibe reference with ID ${vibeId} not found`);
            return;
    }

    if (!vibeReferencesContainer) return;

    // Check if already exists
    const existingItem = vibeReferencesContainer.querySelector(`[data-vibe-id="${vibeId}"]`);
    if (existingItem) {
        console.warn(`Vibe reference ${vibeId} already exists in container`);
        return;
    }

    const item = createVibeReferenceItem(vibeRef);

    // Set the specific IE and strength values
    const ieDropdownBtn = item.querySelector('.custom-dropdown-btn');
    const ratioInput = item.querySelector('.vibe-reference-ratio-input');

    const ieSuffix = document.createElement('span');
    ieSuffix.style.opacity = '0.5';
    ieSuffix.textContent = 'IE';
    
    if (ieDropdownBtn && selectedIe) {
        // Find the encoding with the specified IE
        const encoding = vibeRef.encodings?.find(enc => enc.informationExtraction === selectedIe);
        if (encoding) {
            const optionText = document.createElement('span');
            optionText.textContent = `${(parseFloat(encoding.informationExtraction) * 100).toFixed(0)}%`;
            ieDropdownBtn.innerHTML = '';
            ieDropdownBtn.appendChild(optionText);
            ieDropdownBtn.appendChild(ieSuffix);
            ieDropdownBtn.dataset.selectedModel = encoding.model;
            ieDropdownBtn.dataset.selectedIe = encoding.informationExtraction;
        }
    }

    if (ratioInput && strength !== undefined) {
        ratioInput.value = strength.toString();
    }

    vibeReferencesContainer.appendChild(item);

    // Show the section
    if (vibeReferencesContainer) {
        vibeReferencesContainer.style.display = '';
        if (vibeNormalizeToggle) {
            vibeNormalizeToggle.style.display = '';
        }
        if (transformationRow) {
            transformationRow.classList.add('display-vibe');
        }
    }
}

function removeVibeReference(vibeId) {
    if (!vibeReferencesContainer) return;

    const item = vibeReferencesContainer.querySelector(`[data-vibe-id="${vibeId}"]`);
    if (item) {
        item.remove();

        // Hide section if no more items
        const remainingItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');
        if (remainingItems.length === 0) {
            if (vibeReferencesContainer) {
                vibeReferencesContainer.style.display = 'none';
            }
            if (transformationRow) {
                transformationRow.classList.remove('display-vibe');
            }
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.style.display = 'none';
            }
        }
    }
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
        if (transformationRow) {
            transformationRow.classList.add('display-image');
        }
        if (manualStrengthGroup) manualStrengthGroup.style.display = '';
        if (manualNoiseGroup) manualNoiseGroup.style.display = '';

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

    } catch (error) {
        console.error('Error selecting cache image:', error);
        showError('Failed to select cache image');
    }
}

async function deleteCacheImage(cacheImage) {
    let deleteType = 'both';
    
    // If the item has both base image and vibes, ask what to delete
    if (cacheImage.hasVibes && !cacheImage.isStandalone) {
        const deleteOptions = await showConfirmationDialog(
            'What would you like to delete?',
            [
                { text: 'Base Image', value: 'base', className: 'btn-warning' },
                { text: 'Vibe Encoding(s)', value: 'vibes', className: 'btn-warning' },
                { text: 'All', value: 'both', className: 'btn-danger' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ]
        );
        
        if (!deleteOptions) return;
        deleteType = deleteOptions;
    } else {
        // Simple confirmation for base image only or standalone vibe
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to delete this item?',
            [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (!confirmed) return;
        deleteType = cacheImage.isStandalone ? 'vibes' : 'base';
    }

    try {
        if (deleteType === 'base' || deleteType === 'both') {
            // Delete the base image
            const response = await wsClient.deleteReference(cacheImage.hash, cacheImage.workspaceId || 'default');
            if (!response.success) {
                throw new Error(`Failed to delete cache image: ${response.message}`);
            }
        }
        
        if (deleteType === 'vibes' || deleteType === 'both') {
            // Delete the vibes
            if (cacheImage.vibes && cacheImage.vibes.length > 0) {
                for (const vibe of cacheImage.vibes) {
                    const vibeResponse = await wsClient.deleteVibeImage(vibe.id, cacheImage.workspaceId || 'default');
                    if (!vibeResponse.success) {
                        console.error(`Failed to delete vibe ${vibe.id}: ${vibeResponse.message}`);
                    }
                }
            }
        }

        // Remove from local array
        cacheImages = cacheImages.filter(img => img.hash !== cacheImage.hash);

        // Refresh both displays
        displayCacheImages();
        displayCacheImagesContainer();

        showGlassToast('success', null, 'Reference image deleted');
    } catch (error) {
        console.error('Error deleting cache image:', error);
        showError('Failed to delete reference');
    }
}


// Helper function to get workspace display name
function getWorkspaceDisplayName(workspaceId) {
    const workspace = workspaces[workspaceId];
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

    // Setup workspace dropdown
    setupCacheManagerWorkspaceDropdown();

    // Load cache images for current workspace
    loadCacheManagerImages();

    if (cacheManagerModal) {
        openModal(cacheManagerModal);
    }
}

function hideCacheManagerModal() {
    if (cacheManagerModal) {
        closeModal(cacheManagerModal);
    }
}

function setupCacheManagerWorkspaceDropdown() {
    if (!cacheManagerWorkspaceDropdown || !cacheManagerWorkspaceDropdownBtn || !cacheManagerWorkspaceDropdownMenu || !cacheManagerWorkspaceSelected) return;

    // Update selected workspace
    cacheManagerWorkspaceSelected.textContent = getWorkspaceDisplayName(cacheManagerCurrentWorkspace);

    // Check if dropdown is already set up
    if (cacheManagerWorkspaceDropdown.dataset.setup === 'true') {
        return; // Already set up, don't add duplicate event listeners
    }

    // Setup dropdown functionality
    setupDropdown(cacheManagerWorkspaceDropdown, cacheManagerWorkspaceDropdownBtn, cacheManagerWorkspaceDropdownMenu, renderCacheManagerWorkspaceDropdown, () => cacheManagerCurrentWorkspace);

    // Mark as set up
    cacheManagerWorkspaceDropdown.dataset.setup = 'true';
}

function renderCacheManagerWorkspaceDropdown() {
    if (!cacheManagerWorkspaceDropdownMenu) return '';

    cacheManagerWorkspaceDropdownMenu.innerHTML = '';

    Object.values(workspaces).forEach(workspace => {
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
                loadCacheManagerImages();

                // Update selected workspace display
                if (cacheManagerWorkspaceSelected) {
                    cacheManagerWorkspaceSelected.textContent = workspace.name;
                }
            }
            closeDropdown(cacheManagerWorkspaceDropdownMenu, cacheManagerWorkspaceDropdownBtn);
        };

        option.addEventListener('click', action);
        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                action();
            }
        });

        cacheManagerWorkspaceDropdownMenu.appendChild(option);
    });
}

async function loadCacheManagerImages() {
    if (cacheManagerLoading) cacheManagerLoading.style.display = 'flex';
    if (cacheManagerGallery) cacheManagerGallery.innerHTML = '';

    try {
        // Load unified references (cache images and vibe images together)
        const response = await wsClient.getWorkspaceReferences(cacheManagerCurrentWorkspace);

        if (response.success) {
            const data = response.data;
            const cacheImages = data.cacheFiles || [];
            const vibeImages = data.vibeImages || [];
            
            // Create a map of cache images by hash
            const cacheMap = new Map();
            cacheImages.forEach(cache => {
                cacheMap.set(cache.hash, {
                    ...cache,
                    type: 'cache',
                    vibes: []
                });
            });
            
            // Add vibe images to their corresponding cache images
            vibeImages.forEach(vibe => {
                if (vibe.type === 'cache' && cacheMap.has(vibe.source)) {
                    // This vibe is based on a cache image
                    const cacheItem = cacheMap.get(vibe.source);
                    cacheItem.vibes.push(vibe);
                    cacheItem.hasVibes = true;
                } else {
                    // This is a standalone vibe (base64)
                    const standaloneVibe = {
                        hash: vibe.id,
                        filename: vibe.filename,
                        mtime: vibe.mtime,
                        size: vibe.size,
                        hasPreview: vibe.preview,
                        type: 'vibe',
                        vibes: [vibe],
                        hasVibes: true,
                        isStandalone: true
                    };
                    cacheMap.set(vibe.id, standaloneVibe);
                }
            });
            
            // Convert map to array and sort by newest first
            const combinedImages = Array.from(cacheMap.values());
            
            // Sort by mtime (newest first)
            combinedImages.sort((a, b) => {
                const aTime = a.mtime || 0;
                const bTime = b.mtime || 0;
                return bTime - aTime;
            });
            
            cacheManagerImages = combinedImages;
        } else {
            throw new Error('Failed to load images');
        }

        displayCacheManagerImages();
    } catch (error) {
        console.error('Error loading cache manager images:', error);
        showError('Failed to load cache images');
    } finally {
        if (cacheManagerLoading) cacheManagerLoading.style.display = 'none';
    }
}

function displayCacheManagerImages() {
    if (!cacheManagerGallery) return;

    cacheManagerGallery.innerHTML = '';

    if (cacheManagerImages.length === 0) {
        cacheManagerGallery.innerHTML = `
            <div class="no-images">
                <i class="fas fa-image-slash"></i>
                <span>No cache images found in this workspace</span>
            </div>
        `;
        return;
    }

    cacheManagerImages.forEach(cacheImage => {
        const galleryItem = createCacheManagerGalleryItem(cacheImage);
        cacheManagerGallery.appendChild(galleryItem);
    });
}

function createCacheManagerGalleryItem(cacheImage) {
    const item = document.createElement('div');
    item.className = 'cache-manager-gallery-item';
    item.dataset.hash = cacheImage.hash;

    // Create image element
    const img = document.createElement('img');
    if (cacheImage.isStandalone) {
        // For standalone vibes, use the vibe's preview or fallback
        if (cacheImage.hasPreview) {
            img.src = `/cache/preview/${cacheImage.hasPreview}`;
        } else {
            img.src = '/images/placeholder.png';
        }
    } else {
        // For cache images (with or without vibes)
        if (cacheImage.hasPreview) {
            img.src = `/cache/preview/${cacheImage.hash}.webp`;
        } else {
            img.src = `/cache/${cacheImage.hash}`;
        }
    }
    img.alt = `Reference image ${cacheImage.hash}`;
    img.loading = 'lazy';

    // Create move button
    const moveBtn = document.createElement('button');
    moveBtn.className = 'btn-secondary btn-small';
    moveBtn.innerHTML = '<i class="fas fa-copy"></i>';
    moveBtn.title = 'Move image';
    moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveCacheManagerImage(cacheImage);
    });

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'cache-manager-gallery-item-overlay';


    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cache-manager-gallery-item-buttons';

    // Create vibe encode button (always show to allow adding more IEs)
    const vibeBtn = document.createElement('button');
    vibeBtn.className = 'btn-secondary btn-small';
    vibeBtn.innerHTML = '<i class="nai-vibe-transfer"></i>';
    vibeBtn.title = cacheImage.hasVibes ? 'Add Another Vibe Encoding' : 'Create Vibe Encoding';
    vibeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
            // Use 'ie' mode to add additional IEs to existing vibe
            showVibeEncodingModal('ie', cacheImage.vibes[0]);
        } else {
            // Use 'reference' mode to create new vibe from cache image
            showVibeEncodingModal('reference', cacheImage);
        }
    });
    buttonsContainer.appendChild(vibeBtn);

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCacheManagerImage(cacheImage, cacheManagerCurrentWorkspace);
    });

    buttonsContainer.appendChild(moveBtn);
    buttonsContainer.appendChild(deleteBtn);

    overlay.appendChild(buttonsContainer);

    // Create badges container
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'cache-manager-badges';

    // Add base image badge only for actual cache images (not standalone vibes)
    if (!cacheImage.isStandalone) {
        const baseBadge = document.createElement('div');
        baseBadge.className = 'cache-badge base-image';
        baseBadge.textContent = 'Base Image';
        badgesContainer.appendChild(baseBadge);
    }

    // Add vibe encoding badges
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        cacheImage.vibes.forEach(vibe => {
            if (vibe.encodings && Array.isArray(vibe.encodings)) {
                vibe.encodings.forEach(encoding => {
                    const encodingBadge = document.createElement('div');
                    encodingBadge.className = 'cache-badge encoding';
                    
                    // Get model display name
                    const modelKey = encoding.model;
                    const modelDisplayName = modelBadges[modelKey] ? modelBadges[modelKey].display : modelKey;
                    
                    encodingBadge.innerHTML = `
                        <span class="badge-model">${modelDisplayName}</span>
                        <span class="badge-ie">${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%</span>
                    `;
                    encodingBadge.title = `Model: ${modelDisplayName}, IE: ${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%`;
                    badgesContainer.appendChild(encodingBadge);
                });
            }
        });
    }

    item.appendChild(img);
    item.appendChild(overlay);
    item.appendChild(badgesContainer);

    return item;
}

async function moveCacheManagerImage(cacheImage) {
    try {
        // Check if this item has both base image and vibes
        if (cacheImage.hasVibes && !cacheImage.isStandalone) {
            // Show confirmation that both base image and vibes will be moved
            const confirmed = await showConfirmationDialog(
                'This item contains both a base image and vibe encodings. Both will be moved to the target workspace. Continue?',
                [
                    { text: 'Move', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            
            if (!confirmed) return;
        }
        
        // Store the cache image for reference during move
        cacheManagerMoveTargetImage = cacheImage;        
        
        // Show workspace selection modal
        showCacheManagerMoveModal();     
    } catch (error) {
        console.error('Error setting up move for cache manager image:', error);
        showError('Failed to set up move operation');
    }
}

async function deleteCacheManagerImage(cacheImage, workspace) {
    let deleteType = 'both';
    
    // If the item has both base image and vibes, ask what to delete
    if (cacheImage.hasVibes && !cacheImage.isStandalone) {
        const deleteOptions = await showConfirmationDialog(
            'What would you like to delete?',
            [
                { text: 'Base Image', value: 'base', className: 'btn-warning' },
                { text: 'Vibe Encoding(s)', value: 'vibes', className: 'btn-warning' },
                { text: 'All', value: 'both', className: 'btn-danger' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ]
        );
        
        if (!deleteOptions) return;
        deleteType = deleteOptions;
    } else {
        // Simple confirmation for base image only or standalone vibe
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to delete this item?',
            [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        
        if (!confirmed) return;
        deleteType = cacheImage.isStandalone ? 'vibes' : 'base';
    }

    try {
        if (deleteType === 'base' || deleteType === 'both') {
            // Delete the base image
            const response = await wsClient.deleteReference(cacheImage.hash, workspace || cacheManagerCurrentWorkspace);
            if (!response.success) {
                throw new Error(`Failed to delete cache image: ${response.message}`);
            }
        }
        
        if (deleteType === 'vibes' || deleteType === 'both') {
            // Delete the vibes
            if (cacheImage.vibes && cacheImage.vibes.length > 0) {
                for (const vibe of cacheImage.vibes) {
                    const vibeResponse = await wsClient.deleteVibeImage(vibe.id, workspace || cacheManagerCurrentWorkspace);
                    if (!vibeResponse.success) {
                        console.error(`Failed to delete vibe ${vibe.id}: ${vibeResponse.message}`);
                    }
                }
            }
        }

        // Remove from local array
        cacheManagerImages = cacheManagerImages.filter(img => img.hash !== cacheImage.hash);

        // Refresh display
        displayCacheManagerImages();

        showGlassToast('success', null, 'Reference deleted');
    } catch (error) {
        console.error('Error deleting cache manager image:', error);
        showError('Failed to delete reference');
    }
}



// Unified Upload Modal Functions
function showUnifiedUploadModal() {
    if (!unifiedUploadModal) return;

    // Reset form
    if (unifiedUploadFileInput) unifiedUploadFileInput.value = '';
    if (unifiedUploadIeInput) unifiedUploadIeInput.value = '0.35';
    if (unifiedUploadConfirmBtn) unifiedUploadConfirmBtn.disabled = true;
    
    // Reset to reference mode
    unifiedUploadCurrentMode = 'reference';
    updateUnifiedUploadMode();
    
    // Reset background image
    if (unifiedUploadBackgroundImage) {
        unifiedUploadBackgroundImage.src = '/images/placeholder.png';
    }
    
    // Update displays
    if (unifiedUploadModeDisplay) unifiedUploadModeDisplay.textContent = 'Upload Reference';
    if (unifiedUploadModelDisplay) unifiedUploadModelDisplay.textContent = unifiedUploadSelectedModel || 'V4.5';
    if (unifiedUploadModalTitle) unifiedUploadModalTitle.innerHTML = '<i class="nai-import"></i> Upload & Encode';
    if (unifiedUploadConfirmText) unifiedUploadConfirmText.textContent = 'Upload';
    
    // Populate model dropdown
    populateUnifiedUploadModelDropdown();
    
    // Open modal
    openModal(unifiedUploadModal);
}

function hideUnifiedUploadModal() {
    if (unifiedUploadModal) {
        closeModal(unifiedUploadModal);
    }
}

function updateUnifiedUploadMode() {
    const modeSliderContainer = document.querySelector('.mode-slider-container');
    const vibeControls = unifiedUploadVibeControls;
    
    if (modeSliderContainer) {
        modeSliderContainer.setAttribute('data-active', unifiedUploadCurrentMode);
    }
    
    // Update slider button active states
    const modeSliderBtns = document.querySelectorAll('.mode-slider-btn');
    modeSliderBtns.forEach(btn => {
        if (btn.dataset.mode === unifiedUploadCurrentMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update mode display
    if (unifiedUploadModeDisplay) {
        unifiedUploadModeDisplay.textContent = unifiedUploadCurrentMode === 'reference' ? 'Upload Reference' : 'Upload & Encode';
    }
    
    // Update modal title
    if (unifiedUploadModalTitle) {
        unifiedUploadModalTitle.innerHTML = unifiedUploadCurrentMode === 'reference' 
            ? '<i class="nai-img2img"></i> Upload Reference' 
            : '<i class="nai-vibe-transfer"></i> Encode Vibe Transfer';
    }
    
    // Update confirm button text
    if (unifiedUploadConfirmText) {
        unifiedUploadConfirmText.textContent = unifiedUploadCurrentMode === 'reference' ? 'Upload' : 'Upload & Encode';
    }
    
    // Show/hide vibe controls
    if (vibeControls) {
        if (unifiedUploadCurrentMode === 'vibe') {
            vibeControls.classList.remove('hide');
            vibeControls.classList.add('show');
        } else {
            vibeControls.classList.remove('show');
            vibeControls.classList.add('hide');
        }
    }
    
    // Update file input configuration
    if (unifiedUploadFileInput) {
        if (unifiedUploadCurrentMode === 'vibe') {
            unifiedUploadFileInput.removeAttribute('multiple');
        } else {
            unifiedUploadFileInput.setAttribute('multiple', '');
        }
        
        // Reset file input when mode changes
        unifiedUploadFileInput.value = '';
        
        // Update confirm button state
        if (unifiedUploadConfirmBtn) {
            unifiedUploadConfirmBtn.disabled = true;
        }
        
        // Reset background image
        if (unifiedUploadBackgroundImage) {
            unifiedUploadBackgroundImage.src = '/images/placeholder.png';
        }
    }
    
    // Update file input text
    if (unifiedUploadFileText) {
        unifiedUploadFileText.textContent = unifiedUploadCurrentMode === 'reference' 
            ? 'Select one or more images to upload to the cache' 
            : 'Select an image to upload and encode for vibe transfer';
    }
}

function populateUnifiedUploadModelDropdown() {
    if (!unifiedUploadModelDropdownMenu || !unifiedUploadModelSelected) return;

    unifiedUploadModelDropdownMenu.innerHTML = '';

    // Get V4+ models from optionsData
    if (window.optionsData?.models) {
        const v4Models = Object.entries(window.optionsData?.models)
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
            option.className = 'custom-dropdown-option' + (unifiedUploadSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;

            option.addEventListener('click', () => {
                unifiedUploadSelectedModel = key;
                unifiedUploadModelSelected.textContent = displayName;
                
                // Update the model display in the overlay
                const modelDisplay = document.getElementById('unifiedUploadModelDisplay');
                if (modelDisplay) {
                    modelDisplay.textContent = displayName;
                }
                
                closeDropdown(unifiedUploadModelDropdownMenu, unifiedUploadModelDropdownBtn);
            });

            unifiedUploadModelDropdownMenu.appendChild(option);
        });
    }

    // Update selected display
    if (window.optionsData?.models[unifiedUploadSelectedModel]) {
        unifiedUploadModelSelected.textContent = window.optionsData?.models[unifiedUploadSelectedModel];
    }
}

async function handleUnifiedUploadConfirm() {
    if (!unifiedUploadCurrentMode) return;
    
    if (!unifiedUploadFileInput || !unifiedUploadFileInput.files.length) {
        showError('Please select an image file');
        return;
    }
    
    const files = Array.from(unifiedUploadFileInput.files);
    
    // Add validation for vibe mode
    if (unifiedUploadCurrentMode === 'vibe' && files.length > 1) {
        showError('Vibe encoding only supports single file upload. Please select only one image.');
        return;
    }
    
    // Validate file types
    const invalidFiles = files.filter(file => !file.type.startsWith('image/'));
    if (invalidFiles.length > 0) {
        showError('Please select valid image files only.');
        return;
    }
    
    // Validate file sizes (max 10MB per file)
    const maxSize = 10 * 1024 * 1024; // 10MB
    const oversizedFiles = files.filter(file => file.size > maxSize);
    if (oversizedFiles.length > 0) {
        showError('File size too large. Please select images smaller than 10MB.');
        return;
    }
    
    try {
        if (unifiedUploadCurrentMode === 'reference') {
            // Upload as reference images
            await uploadUnifiedReferenceImages(files);
        } else if (unifiedUploadCurrentMode === 'vibe') {
            // Upload and encode as vibe (only first file)
            const file = files[0];
            await uploadUnifiedVibeImage(file);
        }
    } catch (error) {
        console.error('Error in unified upload:', error);
        showError('Upload failed: ' + error.message);
    }
}

async function uploadUnifiedReferenceImages(files) {
    let toastId = showGlassToast('info', 'Uploading Images', 'Uploading reference images...', true, false, '<i class="nai-import"></i>');
    
    try {
        // Get the current workspace from the cache manager dropdown
        let targetWorkspace = cacheManagerCurrentWorkspace;
        
        // If cache manager modal is open, get the workspace from the dropdown
        if (cacheManagerModal && cacheManagerModal.classList.contains('modal-open')) {
            const selectedWorkspaceElement = cacheManagerWorkspaceSelected;
            if (selectedWorkspaceElement && selectedWorkspaceElement.textContent) {
                // Find the workspace by display name
                const workspaceName = selectedWorkspaceElement.textContent.trim();
                const workspace = Object.values(workspaces).find(w => w.name === workspaceName);
                if (workspace) {
                    targetWorkspace = workspace.id;
                }
            }
        }
        
        const uploadPromises = files.map(async (file, index) => {
            const base64 = await fileToBase64(file);
            
            const response = await wsClient.uploadReference(base64, targetWorkspace);

            if (!response.success) {
                throw new Error(response.message || 'Upload failed');
            }
            
            return response;
        });
        
        const results = await Promise.all(uploadPromises);
        
        removeGlassToast(toastId);
        showGlassToast('success', 'Upload Complete', `Successfully uploaded ${results.length} image(s)`, false, true, '<i class="nai-check"></i>');
        
        // Refresh cache manager
        await loadCacheManagerImages();
        
        // Close modal
        hideUnifiedUploadModal();
        
    } catch (error) {
        removeGlassToast(toastId);
        showError('Upload failed: ' + error.message);
    }
}

async function uploadUnifiedVibeImage(file) {
    const informationExtraction = unifiedUploadIeInput ? parseFloat(unifiedUploadIeInput.value) : 0.35;
    const model = unifiedUploadSelectedModel;
    
    // Add model validation
    if (!model || !window.optionsData?.models?.[model]) {
        showError('Please select a valid model for vibe encoding');
        return;
    }
    
    // Validate IE value
    if (isNaN(informationExtraction) || informationExtraction < 0 || informationExtraction > 1) {
        showError('Information Extraction value must be between 0 and 1');
        return;
    }
    
    // Get the current workspace from the cache manager dropdown
    let targetWorkspace = cacheManagerCurrentWorkspace;
    
    // If cache manager modal is open, get the workspace from the dropdown
    if (cacheManagerModal && cacheManagerModal.classList.contains('modal-open')) {
        const selectedWorkspaceElement = cacheManagerWorkspaceSelected;
        if (selectedWorkspaceElement && selectedWorkspaceElement.textContent) {
            // Find the workspace by display name
            const workspaceName = selectedWorkspaceElement.textContent.trim();
            const workspace = Object.values(workspaces).find(w => w.name === workspaceName);
            if (workspace) {
                targetWorkspace = workspace.id;
            }
        }
    }
    
    // Validate workspace
    if (!targetWorkspace) {
        showError('No workspace selected. Please select a workspace first.');
        return;
    }
    
    let toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from uploaded image...', true, false, '<i class="nai-vibe-transfer"></i>');
    
    try {
        // Show progress for large files
        if (file.size > 5 * 1024 * 1024) { // 5MB
            updateGlassToast(toastId, 'info', 'Processing Large File', 'Converting image to base64...');
        }
        
        const base64 = await fileToBase64(file);
        
        // Update toast for encoding phase
        updateGlassToast(toastId, 'info', 'Vibe Encoding', 'Sending to encoding service...');
        
        const response = await wsClient.encodeVibe({
            image: base64,
            informationExtraction: informationExtraction,
            model: model,
            workspace: targetWorkspace
        });
        
        if (!response.success) {
            throw new Error(response.message || 'Vibe encoding failed');
        }
        
        removeGlassToast(toastId);
        showGlassToast('success', 'Vibe Created', 'Successfully created vibe encoding', false, true, '<i class="nai-check"></i>');
        
        // Use consistent refresh function
        await loadCacheManagerImages();
        
        // Close modal
        hideUnifiedUploadModal();
        
    } catch (error) {
        removeGlassToast(toastId);
        
        // Provide more specific error messages
        let errorMessage = 'Vibe encoding failed';
        if (error.message.includes('model') || error.message.includes('Model')) {
            errorMessage = 'Invalid model selection. Please choose a valid V4+ model.';
        } else if (error.message.includes('file') || error.message.includes('image')) {
            errorMessage = 'Invalid file format. Please select a valid image file.';
        } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
            errorMessage = 'Encoding timed out. Please try with a smaller image.';
        } else if (error.message.includes('information') || error.message.includes('IE')) {
            errorMessage = 'Invalid Information Extraction value. Please use a value between 0 and 1.';
        } else if (error.message.includes('workspace')) {
            errorMessage = 'Workspace error. Please try again or select a different workspace.';
        } else {
            errorMessage = 'Vibe encoding failed: ' + error.message;
        }
        
        showError(errorMessage);
    }
}

function showCacheManagerMoveModal() {
    if (!cacheManagerMoveModal) return;

    if (!cacheManagerMoveTargetImage) {
        showError('No image selected for move');
        return;
    }

    // Update background image and info
    const backgroundImage = document.getElementById('cacheManagerMoveBackgroundImage');
    const moveCount = document.getElementById('cacheManagerMoveCount');
    const currentWorkspace = document.getElementById('cacheManagerMoveCurrentWorkspace');
    const confirmBtn = document.getElementById('cacheManagerMoveConfirmBtn');
    const selectedSpan = document.getElementById('cacheManagerMoveWorkspaceSelected');

    if (backgroundImage) {
        if (cacheManagerMoveTargetImage.isStandalone) {
            if (cacheManagerMoveTargetImage.hasPreview) {
                backgroundImage.src = `/cache/preview/${cacheManagerMoveTargetImage.hasPreview}`;
            } else {
                backgroundImage.src = '/images/placeholder.png';
            }
        } else {
            if (cacheManagerMoveTargetImage.hasPreview) {
                backgroundImage.src = `/cache/preview/${cacheManagerMoveTargetImage.hash}.webp`;
            } else {
                backgroundImage.src = `/cache/${cacheManagerMoveTargetImage.hash}`;
            }
        }
        backgroundImage.alt = `Image to move: ${cacheManagerMoveTargetImage.filename || cacheManagerMoveTargetImage.hash}`;
    }

    if (moveCount) {
        moveCount.textContent = '1';
    }

    if (currentWorkspace) {
        const workspace = workspaces[cacheManagerCurrentWorkspace];
        currentWorkspace.textContent = workspace ? workspace.name : 'Default';
    }

    if (confirmBtn) {
        confirmBtn.disabled = true;
    }

    if (selectedSpan) {
        selectedSpan.textContent = 'Select workspace...';
        selectedSpan.dataset.value = '';
    }

    // Setup workspace dropdown
    setupCacheManagerMoveWorkspaceDropdown();

    openModal(cacheManagerMoveModal);
}

// Setup workspace dropdown for cache manager move modal
function setupCacheManagerMoveWorkspaceDropdown() {
    const modal = document.getElementById('cacheManagerMoveModal');
    if (!modal) return;
    
    const dropdownContainer = modal.querySelector('#cacheManagerMoveWorkspaceDropdown');
    const dropdownBtn = modal.querySelector('#cacheManagerMoveWorkspaceDropdownBtn');
    const dropdownMenu = modal.querySelector('#cacheManagerMoveWorkspaceDropdownMenu');
    const selectedSpan = modal.querySelector('#cacheManagerMoveWorkspaceSelected');
    const confirmBtn = modal.querySelector('#cacheManagerMoveConfirmBtn');
    
    // Check if dropdown is already set up
    if (dropdownContainer.dataset.setup === 'true') {
        return; // Already set up, don't add duplicate event listeners
    }
    
    // Setup dropdown functionality using the main dropdown system
    setupDropdown(
        dropdownContainer, 
        dropdownBtn, 
        dropdownMenu, 
        renderCacheManagerMoveWorkspaceDropdown, 
        () => selectedSpan.dataset.value || null,
        {
            onSelectOption: (value) => {
                const workspace = workspaces[value];
                if (workspace) {
                    const workspaceColor = workspace.color || '#124';
                    selectedSpan.innerHTML = `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                        <div class="workspace-name">${workspace.name}</div></div>`;
                    selectedSpan.dataset.value = workspace.id;
                    confirmBtn.disabled = false;
                }
            }
        }
    );
    
    // Mark as set up
    dropdownContainer.dataset.setup = 'true';
}

// Render function for cache manager move workspace dropdown
function renderCacheManagerMoveWorkspaceDropdown() {
    const modal = document.getElementById('cacheManagerMoveModal');
    if (!modal) return;
    
    const dropdownMenu = modal.querySelector('#cacheManagerMoveWorkspaceDropdownMenu');
    if (!dropdownMenu) return;
    
    dropdownMenu.innerHTML = '';
    
    Object.values(workspaces).forEach(workspace => {
        if (workspace.id !== cacheManagerCurrentWorkspace) {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option';
            option.tabIndex = 0;
            option.dataset.value = workspace.id;
            
            const workspaceColor = workspace.color || '#124';
            
            option.innerHTML = `
                <div class="workspace-option-content">
                    <div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                    <div class="workspace-name">${workspace.name}</div>
                </div>
            `;
            
            option.addEventListener('click', () => {
                const selectedSpan = modal.querySelector('#cacheManagerMoveWorkspaceSelected');
                const confirmBtn = modal.querySelector('#cacheManagerMoveConfirmBtn');
                
                selectedSpan.innerHTML = `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                    <div class="workspace-name">${workspace.name}</div></div>`;
                selectedSpan.dataset.value = workspace.id;
                confirmBtn.disabled = false;
                
                const dropdownBtn = modal.querySelector('#cacheManagerMoveWorkspaceDropdownBtn');
                closeDropdown(dropdownMenu, dropdownBtn);
            });
            
            option.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    option.click();
                }
            });
            
            dropdownMenu.appendChild(option);
        }
    });
}

function hideCacheManagerMoveModal() {
    if (cacheManagerMoveModal) {
        closeModal(cacheManagerMoveModal);
    }
}

async function moveCacheManagerImages() {
    const modal = document.getElementById('cacheManagerMoveModal');
    if (!modal) return;
    
    const selectedSpan = modal.querySelector('#cacheManagerMoveWorkspaceSelected');
    const targetWorkspace = selectedSpan.dataset.value;
    
    if (!targetWorkspace) {
        showError('Please select a target workspace');
        return;
    }

    if (!cacheManagerMoveTargetImage) {
        showError('No image selected for move');
        return;
    }

    const cacheImage = cacheManagerMoveTargetImage;

    try {
        let response;
        
        if (cacheImage.isStandalone) {
            // For standalone vibe images, use moveVibeImage
            if (cacheImage.vibes && cacheImage.vibes.length > 0) {
                // Move the standalone vibe image
                response = await wsClient.moveVibeImage(cacheImage.vibes[0].id, targetWorkspace, cacheManagerCurrentWorkspace);
            } else {
                throw new Error('Standalone image has no vibe data');
            }
        } else {
            // For cache images (with or without associated vibes), use moveReferences
            response = await wsClient.moveReferences([cacheImage.hash], targetWorkspace, cacheManagerCurrentWorkspace);

        if (response.success) {
            // Also move associated vibe images if they exist
            let vibeMovePromises = [];
                if (cacheImage.hasVibes) {
                // Move each vibe image associated with this cache image
                for (const vibe of cacheImage.vibes) {
                    if (vibe.type === 'cache') {
                        vibeMovePromises.push(
                            wsClient.moveVibeImage(vibe.id, targetWorkspace, cacheManagerCurrentWorkspace)
                        );
                    }
                }
            }

            // Wait for all vibe moves to complete
            if (vibeMovePromises.length > 0) {
                try {
                    await Promise.all(vibeMovePromises);
                } catch (vibeError) {
                    console.warn('Some vibe images failed to move:', vibeError);
                    }
                }
                }
            }

        if (response.success) {
            showGlassToast('success', null, 'Image moved successfully');
            hideCacheManagerMoveModal();
            loadCacheManagerImages(); // Refresh the gallery
        } else {
            throw new Error(`Failed to move image: ${response.message}`);
        }
    } catch (error) {
        console.error('Error moving cache image:', error);
        showError('Failed to move image');
    }
}

// Combined Vibe Encoding Modal Functions
function showVibeEncodingModal(mode, data = null) {
    if (!vibeEncodingModal) return;
    
    vibeEncodingCurrentMode = mode;
    
    // Reset form
    if (vibeEncodingFileInput) vibeEncodingFileInput.value = '';
    if (vibeEncodingIeInput) vibeEncodingIeInput.value = '0.35';
    if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = true;
    
    // Hide all sections initially
    if (vibeEncodingUploadSection) vibeEncodingUploadSection.style.display = 'none';
    if (vibeEncodingReferenceSection) vibeEncodingReferenceSection.style.display = 'none';
    
    // Update background image and mode display
    const backgroundImage = document.getElementById('vibeEncodingBackgroundImage');
    const modeDisplay = document.getElementById('vibeEncodingModeDisplay');
    const modelDisplay = document.getElementById('vibeEncodingModelDisplay');
    
    // Configure modal based on mode
    switch (mode) {
        case 'upload':
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="nai-vibe-transfer"></i> <span>Upload & Encode Vibe Image</span>';
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Upload';
            if (vibeEncodingUploadSection) vibeEncodingUploadSection.style.display = 'block';
            if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = true;
            if (backgroundImage) backgroundImage.src = '/images/placeholder.png';
            if (modeDisplay) modeDisplay.textContent = 'Upload Mode';
            break;
            
        case 'gallery':
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="nai-vibe-transfer"></i> <span>Encode Image as Vibe</span>';
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Encode';
            if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = false;
            if (backgroundImage && window.galleryToolbarVibeImage) {
                backgroundImage.src = `data:image/png;base64,${window.galleryToolbarVibeImage}`;
            }
            if (modeDisplay) modeDisplay.textContent = 'Gallery Mode';
            break;
            
        case 'ie':
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="nai-vibe-transfer"></i> <span>Request New IE</span>';
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Encode';
            if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = false;
            vibeEncodingCurrentVibeImage = data;
            if (backgroundImage && data && data.preview) {
                backgroundImage.src = `/cache/preview/${data.preview}`;
            }
            if (modeDisplay) modeDisplay.textContent = 'IE Request Mode';
            break;
            
        case 'reference':
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="nai-vibe-transfer"></i> <span>Create Vibe from Reference</span>';
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Encode';
            if (vibeEncodingReferenceSection) vibeEncodingReferenceSection.style.display = 'none'; // Hide the preview section
            if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = false;
            vibeEncodingCurrentCacheImage = data;
            
            // Show reference image only as background
            if (data && backgroundImage) {
                if (data.hasPreview) {
                    backgroundImage.src = `/cache/preview/${data.hash}.webp`;
                } else {
                    backgroundImage.src = `/cache/${data.hash}`;
                }
            }
            if (modeDisplay) modeDisplay.textContent = 'Reference Mode';
            break;
    }
    
    // Update model display
    if (modelDisplay) {
        modelDisplay.textContent = vibeEncodingSelectedModel || 'V4.5';
    }
    
    // Populate model dropdown
    populateVibeEncodingModelDropdown();
    
    // Open modal
    openModal(vibeEncodingModal);
}

function hideVibeEncodingModal() {
    if (vibeEncodingModal) {
        closeModal(vibeEncodingModal);
    }
    
    // Reset state
    vibeEncodingCurrentMode = null;
    vibeEncodingCurrentVibeImage = null;
    vibeEncodingCurrentCacheImage = null;
    
    // Clean up gallery image data
    if (window.galleryToolbarVibeImage) {
        delete window.galleryToolbarVibeImage;
    }
}

function populateVibeEncodingModelDropdown() {
    if (!vibeEncodingModelDropdownMenu || !vibeEncodingModelSelected) return;

    vibeEncodingModelDropdownMenu.innerHTML = '';

    // Get V4+ models from optionsData
    if (window.optionsData?.models) {
        const v4Models = Object.entries(window.optionsData?.models)
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
            option.className = 'custom-dropdown-option' + (vibeEncodingSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;

            option.addEventListener('click', () => {
                vibeEncodingSelectedModel = key;
                vibeEncodingModelSelected.textContent = displayName;
                
                // Update the model display in the overlay
                const modelDisplay = document.getElementById('vibeEncodingModelDisplay');
                if (modelDisplay) {
                    modelDisplay.textContent = displayName;
                }
                
                closeDropdown(vibeEncodingModelDropdownMenu, vibeEncodingModelDropdownBtn);
            });

            vibeEncodingModelDropdownMenu.appendChild(option);
        });
    }

    // Update selected display
    if (window.optionsData?.models[vibeEncodingSelectedModel]) {
        vibeEncodingModelSelected.textContent = window.optionsData?.models[vibeEncodingSelectedModel];
    }
}





async function handleVibeEncodingConfirm() {
    if (!vibeEncodingCurrentMode) return;
    
    const informationExtraction = vibeEncodingIeInput ? parseFloat(vibeEncodingIeInput.value) : 0.35;
    const model = vibeEncodingSelectedModel;
    
    let toastId;
    let requestParams = {
        informationExtraction: informationExtraction,
        model: model,
        workspace: cacheManagerCurrentWorkspace
    };
    
    try {
        switch (vibeEncodingCurrentMode) {
            case 'upload':
                if (!vibeEncodingFileInput || !vibeEncodingFileInput.files.length) {
                    showError('Please select an image file');
                    return;
                }
                
                const file = vibeEncodingFileInput.files[0];
                const base64 = await fileToBase64(file);
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from image...', true, false, '<i class="fas fa-binary"></i>');
                
                requestParams.image = base64;
                break;
                
            case 'gallery':
                if (!window.galleryToolbarVibeImage) {
                    showError('No gallery image data found');
                    return;
                }
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from gallery image...', true, false, '<i class="fas fa-binary"></i>');
                
                requestParams.image = window.galleryToolbarVibeImage;
                break;
                
            case 'ie':
                if (!vibeEncodingCurrentVibeImage) {
                    showError('No vibe image selected');
                    return;
                }
                
                toastId = showGlassToast('info', 'Requesting IE', 'Processing new Information Extraction...', true, false, '<i class="fas fa-binary"></i>');
                
                requestParams.id = vibeEncodingCurrentVibeImage.id;
                break;
                
            case 'reference':
                if (!vibeEncodingCurrentCacheImage) {
                    showError('No reference image selected');
                    return;
                }
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from reference image...', true, false, '<i class="fas fa-binary"></i>');
                
                requestParams.cacheFile = vibeEncodingCurrentCacheImage.hash;
                break;
        }
        
        // Send to encode endpoint via WebSocket
        const response = await wsClient.encodeVibe(requestParams);

        if (response.success) {
            const successMessages = {
                'upload': 'Vibe image uploaded and encoded successfully',
                'gallery': 'Gallery image encoded as vibe successfully',
                'ie': 'New Information Extraction successful',
                'reference': 'Vibe encoding created successfully from reference image'
            };
            
            updateGlassToast(toastId, 'success', 'Encoding Complete', successMessages[vibeEncodingCurrentMode]);
            hideVibeEncodingModal();
                loadCacheManagerImages();
        } else {
            throw new Error(response.message || 'Failed to process vibe encoding');
        }
    } catch (error) {
        console.error('Error processing vibe encoding:', error);
        const errorMessages = {
            'upload': 'Failed to upload vibe image: ' + error.message,
            'gallery': 'Failed to encode gallery image: ' + error.message,
            'ie': 'Failed to request Information Extraction: ' + error.message,
            'reference': 'Failed to create vibe encoding: ' + error.message
        };
        updateGlassToast(toastId, 'error', 'Processing Failed', errorMessages[vibeEncodingCurrentMode]);
    } finally {
        // Toast will auto-remove after 3 seconds
    }
}

function displayVibeManagerImages() {
    if (!vibeManagerGallery) return;

    vibeManagerGallery.innerHTML = '';

    if (vibeManagerImages.length === 0) {
        vibeManagerGallery.innerHTML = `
        <div class="no-images">
            <i class="fas fa-binary-slash"></i>
            <span>No Vibe encodings found in this workspace</span>
        </div>
    `;
        return;
    }

    vibeManagerImages.forEach(vibeImage => {
        const galleryItem = createVibeManagerGalleryItem(vibeImage);
        vibeManagerGallery.appendChild(galleryItem);
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

    // Create move button
    const moveBtn = document.createElement('button');
    moveBtn.className = 'btn-secondary btn-small';
    moveBtn.innerHTML = '<i class="fas fa-copy"></i>';
    moveBtn.title = 'Move vibe image';
    moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveVibeManagerImage(vibeImage);
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
            const modelDisplayName = modelBadges[modelKey] ? modelBadges[modelKey].display : modelKey;

            // Combined model and IE badge with split colors
            const combinedBadge = document.createElement('div');
            combinedBadge.className = 'vibe-badge split';
            combinedBadge.innerHTML = `
                <span class="badge-model">${modelDisplayName}</span>
                <span class="badge-ie">${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%</span>
            `;
            combinedBadge.title = `Model: ${modelDisplayName}, IE: ${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%`;
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
        <div>Source: ${vibeImage.type.charAt(0).toUpperCase() + vibeImage.type.slice(1)}</div>
        <div>Date: ${date}</div>
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
        showVibeEncodingModal('ie', vibeImage);
    });

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete vibe encoding';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Show vibe delete selection dialog
        vibeManagerSelectedImages.clear();
        vibeManagerSelectedImages.add(vibeImage.id);
        showVibeManagerDeleteModal();
    });

    buttonsContainer.appendChild(moveBtn);
    buttonsContainer.appendChild(ieBtn);
    buttonsContainer.appendChild(deleteBtn);

    overlay.appendChild(infoSection);
    overlay.appendChild(buttonsContainer);

    item.appendChild(img);
    item.appendChild(encodingsContainer);
    item.appendChild(overlay);

    return item;
}


function showVibeManagerDeleteModal() {
    if (vibeManagerSelectedImages.size === 0) {
        showError('No vibe images selected');
        return;
    }

    // Populate the delete items list
    const deleteItemsList = document.getElementById('vibeManagerDeleteItemsList');
    if (!deleteItemsList) {
        console.error('Delete items list not found');
        return;
    }

    deleteItemsList.innerHTML = '';

    // Add selected vibe images and their encodings to the list
    vibeManagerSelectedImages.forEach(vibeId => {
        const vibe = vibeManagerImages.find(v => v.id === vibeId);
        if (!vibe) return;

        // Create vibe item container
        const vibeItem = document.createElement('div');
        vibeItem.className = 'vibe-delete-item';
        vibeItem.dataset.vibeId = vibeId;
        vibeItem.dataset.type = 'vibe';
        vibeItem.innerHTML = `
            <div class="vibe-delete-item-content">
                <div class="vibe-delete-item-info">
                    <div class="vibe-badge vibe-only">Entire Vibe</div>
                </div>
            </div>
        `;
        
        // Add click handler to toggle all encodings for this vibe
        vibeItem.addEventListener('click', () => {
            const isSelected = vibeItem.classList.contains('selected');
            vibeItem.classList.toggle('selected');
            
            // Toggle all encodings for this vibe
            const encodingItems = deleteItemsList.querySelectorAll(`[data-vibe-id="${vibeId}"][data-type="encoding"]`);
            encodingItems.forEach(encodingItem => {
                if (isSelected) {
                    encodingItem.classList.remove('selected');
                } else {
                    encodingItem.classList.add('selected');
                }
            });
        });
        
        deleteItemsList.appendChild(vibeItem);

        // Add individual encodings for this vibe
        if (vibe.encodings && Array.isArray(vibe.encodings)) {
            vibe.encodings.forEach(encoding => {
                const encodingItem = document.createElement('div');
                encodingItem.className = 'vibe-delete-item';
                encodingItem.dataset.vibeId = vibeId;
                encodingItem.dataset.model = encoding.model;
                encodingItem.dataset.informationExtraction = encoding.informationExtraction;
                encodingItem.dataset.type = 'encoding';
                encodingItem.innerHTML = `
                    <div class="vibe-delete-item-content">
                            <div class="vibe-delete-item-name">${(encoding.informationExtraction * 100).toFixed(0)}% IE</div>
                            <div class="vibe-badge">${window.modelNames[encoding.model] || encoding.model}</div>
                    </div>
                `;
                
                // Add click handler to toggle selection
                encodingItem.addEventListener('click', () => {
                    encodingItem.classList.toggle('selected');
                });
                
                deleteItemsList.appendChild(encodingItem);
            });
        }
    });

    if (vibeManagerDeleteModal) {
        openModal(vibeManagerDeleteModal);
    }
}
function hideVibeManagerDeleteModal() {
    if (vibeManagerDeleteModal) {
        closeModal(vibeManagerDeleteModal);
    }
}

function showVibeManagerMoveModal() {
    if (!vibeManagerMoveModal || !vibeManagerMoveTargetSelect) return;

    if (!vibeManagerMoveTargetImage) {
        showError('No vibe image selected for move');
        return;
    }

    // Populate workspace options
    vibeManagerMoveTargetSelect.innerHTML = '';
    Object.values(workspaces).forEach(workspace => {
        if (workspace.id !== cacheManagerCurrentWorkspace) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            vibeManagerMoveTargetSelect.appendChild(option);
        }
    });

    openModal(vibeManagerMoveModal);
}

async function moveVibeManagerImages() {
    if (!vibeManagerMoveTargetSelect || !vibeManagerMoveTargetSelect.value) {
        showError('Please select a target workspace');
        return;
    }

    if (!vibeManagerMoveTargetImage) {
        showError('No vibe image selected for move');
        return;
    }

    const targetWorkspace = vibeManagerMoveTargetSelect.value;
    const vibeImage = vibeManagerMoveTargetImage;

    try {
        const response = await wsClient.moveVibeImage(vibeImage.id, targetWorkspace, cacheManagerCurrentWorkspace);

        if (response.success) {
            showGlassToast('success', null, 'Vibe image moved successfully');

            hideVibeManagerMoveModal();
            loadCacheManagerImages(); // Refresh the gallery
        } else {
            throw new Error(`Failed to move vibe image: ${response.message}`);
        }
    } catch (error) {
        console.error('Error moving vibe image:', error);
        showError('Failed to move vibe image');
    }
}

function hideVibeManagerMoveModal() {
    if (vibeManagerMoveModal) {
        closeModal(vibeManagerMoveModal);
    }
}

async function moveVibeManagerImage(vibeImage) {
    try {
        // Show workspace selection modal
        showVibeManagerMoveModal();
        
        // Store the vibe image for reference during move
        vibeManagerMoveTargetImage = vibeImage;
        
    } catch (error) {
        console.error('Error setting up move for vibe manager image:', error);
        showError('Failed to set up move operation');
    }
}

async function deleteVibeManagerImage(vibeImage) {
    try {
        // Check if this is a standalone vibe or has a cache reference
        if (vibeImage.type === 'base64') {
            // Standalone vibe - just delete the vibe
            const confirmed = await showConfirmationDialog(
                'Are you sure you want to delete this vibe encoding?',
                [
                    { text: 'Delete', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            
            if (!confirmed) return;
            
            // Delete the vibe
            const response = await wsClient.deleteVibeImage(vibeImage.id, cacheManagerCurrentWorkspace);
            if (response.success) {
                // Remove from local array
                vibeManagerImages = vibeManagerImages.filter(img => img.id !== vibeImage.id);
                displayVibeManagerImages();
                showGlassToast('success', null, 'Vibe encoding deleted');
            } else {
                throw new Error(response.message || 'Failed to delete vibe');
            }
        } else if (vibeImage.type === 'cache') {
            // This vibe uses a cache image - check if the cache image has other vibes
            const cacheImage = cacheManagerImages.find(img => img.hash === vibeImage.source);
            
            if (cacheImage && cacheImage.hasVibes && cacheImage.vibes.length > 1) {
                // Multiple vibes exist - show options
                const deleteOptions = await showConfirmationDialog(
                    'What would you like to delete?',
                    [
                        { text: 'Base Image', value: 'base', className: 'btn-warning' },
                        { text: 'Vibe Encoding(s)', value: 'vibes', className: 'btn-warning' },
                        { text: 'Delete', value: 'both', className: 'btn-danger' },
                        { text: 'Cancel', value: null, className: 'btn-secondary' }
                    ]
                );
                
                if (!deleteOptions) return;
                
                if (deleteOptions === 'base') {
                    // Delete base image - server will automatically convert vibes to base64
                    await deleteBaseImage(cacheImage);
                } else if (deleteOptions === 'vibes') {
                    // Show vibe IE delete modal for this specific vibe
                    showVibeManagerDeleteModal();
                    // Set up the vibe for deletion
                    vibeManagerSelectedImages.clear();
                    vibeManagerSelectedImages.add(vibeImage.id);
                } else if (deleteOptions === 'both') {
                    // Delete both base image and vibe
                    await deleteBaseImage(cacheImage);
                    await deleteVibeImage(vibeImage);
                }
            } else {
                // Only one vibe exists - show simple confirmation
                const confirmed = await showConfirmationDialog(
                    'Are you sure you want to delete this vibe encoding?',
                    [
                        { text: 'Delete', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                );
                
                if (!confirmed) return;
                
                // Delete the vibe
                await deleteVibeImage(vibeImage);
            }
        }
    } catch (error) {
        console.error('Error deleting vibe manager image:', error);
        showError('Failed to delete vibe encoding');
    }
}



async function deleteBaseImage(cacheImage) {
    try {
        const response = await wsClient.deleteReference(cacheImage.hash, cacheManagerCurrentWorkspace);
        if (response.success) {
            displayCacheManagerImages();
            return true;
        } else {
            throw new Error(response.message || 'Failed to delete base image');
        }
    } catch (error) {
        console.error('Error deleting base image:', error);
        throw error;
    }
}

async function deleteVibeImage(vibeImage) {
    try {
        const response = await wsClient.deleteVibeImage(vibeImage.id, cacheManagerCurrentWorkspace);
        if (response.success) {
            displayVibeManagerImages();
            showGlassToast('success', null, 'Vibe encoding deleted');
            return true;
        } else {
            throw new Error(response.message || 'Failed to delete vibe');
        }
    } catch (error) {
        console.error('Error deleting vibe image:', error);
        throw error;
    }
}

async function handleVibeManagerDeleteConfirm() {
    try {
        const deleteItemsList = document.getElementById('vibeManagerDeleteItemsList');
        if (!deleteItemsList) {
            showError('Delete items list not found');
            return;
        }

        // Get selected items
        const selectedVibes = new Set();
        const selectedEncodings = new Map(); // vibeId -> array of encoding indices

        // Find selected vibe items (entire vibes)
        const selectedVibeItems = deleteItemsList.querySelectorAll('.vibe-delete-item[data-type="vibe"].selected');
        selectedVibeItems.forEach(item => {
            selectedVibes.add(item.dataset.vibeId);
        });

        // Find selected encoding items
        const selectedEncodingItems = deleteItemsList.querySelectorAll('.vibe-delete-item[data-type="encoding"].selected');
        selectedEncodingItems.forEach(item => {
            const vibeId = item.dataset.vibeId;
            const model = item.dataset.model;
            const informationExtraction = parseFloat(item.dataset.informationExtraction);
            
            if (!selectedEncodings.has(vibeId)) {
                selectedEncodings.set(vibeId, []);
            }
            
            // Find the encoding index in the vibe
            const vibe = vibeManagerImages.find(v => v.id === vibeId);
            if (vibe && vibe.encodings) {
                const encodingIndex = vibe.encodings.findIndex(enc => 
                    enc.model === model && enc.informationExtraction === informationExtraction
                );
                if (encodingIndex !== -1) {
                    selectedEncodings.get(vibeId).push(encodingIndex);
                }
            }
        });

        // Process deletions
        let deletedCount = 0;

        // Delete entire vibes
        for (const vibeId of selectedVibes) {
            const vibe = vibeManagerImages.find(v => v.id === vibeId);
            if (vibe) {
                try {
                    const response = await wsClient.deleteVibeImage(vibeId, cacheManagerCurrentWorkspace);
                    if (response.success) {
                        deletedCount++;
                    }
                } catch (error) {
                    console.error(`Failed to delete vibe ${vibeId}:`, error);
                }
            }
        }

        // Delete specific encodings
        for (const [vibeId, encodingIndices] of selectedEncodings) {
            if (selectedVibes.has(vibeId)) continue; // Skip if entire vibe is being deleted
            
            const vibe = vibeManagerImages.find(v => v.id === vibeId);
            if (vibe && vibe.encodings) {
                const encodingsToDelete = encodingIndices.map(index => vibe.encodings[index]).filter(Boolean);
                if (encodingsToDelete.length > 0) {
                    try {
                        const response = await wsClient.deleteVibeEncodings(vibeId, encodingsToDelete, cacheManagerCurrentWorkspace);
                        if (response.success) {
                            deletedCount += encodingsToDelete.length;
                        }
                    } catch (error) {
                        console.error(`Failed to delete encodings from vibe ${vibeId}:`, error);
                    }
                }
            }
        }

        // Refresh the display
        await loadCacheManagerImages();
        displayVibeManagerImages();
        
        // Show success message
        if (deletedCount > 0) {
            showGlassToast('success', null, `Deleted ${deletedCount} item(s)`);
        } else {
            showGlassToast('warning', null, 'No items were deleted');
        }

        // Close the modal
        hideVibeManagerDeleteModal();
        
    } catch (error) {
        console.error('Error handling vibe manager delete confirm:', error);
        showError('Failed to delete selected items');
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
    if (cacheManagerBtn) {
        cacheManagerBtn.addEventListener('click', showCacheManagerModal);
    }

    // Reference manager modal close button
    if (closeCacheManagerBtn) {
        closeCacheManagerBtn.addEventListener('click', hideCacheManagerModal);
    }

    // Reference manager refresh button
    if (cacheManagerRefreshBtn) {
        cacheManagerRefreshBtn.addEventListener('click', () => {
                loadCacheManagerImages();
        });
    }

    // Reference manager upload button
    if (cacheManagerUploadBtn) {
        cacheManagerUploadBtn.addEventListener('click', () => {
            showUnifiedUploadModal();
        });
    }

// Export functions for use in other modules
window.showVibeEncodingModal = showVibeEncodingModal;
window.hideVibeEncodingModal = hideVibeEncodingModal;
window.showUnifiedUploadModal = showUnifiedUploadModal;
window.hideUnifiedUploadModal = hideUnifiedUploadModal;

    // Reference manager move button
    if (cacheManagerMoveBtn) {
        cacheManagerMoveBtn.addEventListener('click', showCacheManagerMoveModal);
    }

    // Unified Upload Modal Controls
    if (closeUnifiedUploadBtn) closeUnifiedUploadBtn.addEventListener('click', hideUnifiedUploadModal);
    if (unifiedUploadCancelBtn) unifiedUploadCancelBtn.addEventListener('click', hideUnifiedUploadModal);
    if (unifiedUploadConfirmBtn) unifiedUploadConfirmBtn.addEventListener('click', handleUnifiedUploadConfirm);

    // Mode slider controls
    const modeSliderBtns = document.querySelectorAll('.mode-slider-btn');
    modeSliderBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode) {
                unifiedUploadCurrentMode = mode;
                updateUnifiedUploadMode();
            }
        });
    });

    // File input change handler for unified upload
    if (unifiedUploadFileInput) {
        unifiedUploadFileInput.addEventListener('change', async () => {
            if (unifiedUploadConfirmBtn) {
                unifiedUploadConfirmBtn.disabled = !unifiedUploadFileInput.files.length;
            }
            
            // Display uploaded image in background (for both modes)
            if (unifiedUploadFileInput.files.length > 0) {
                const file = unifiedUploadFileInput.files[0];
                const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
                
                if (backgroundImage && file) {
                    try {
                        // Create a preview URL for the uploaded image
                        const imageUrl = URL.createObjectURL(file);
                        backgroundImage.src = imageUrl;
                        
                        // Clean up the object URL when the image loads
                        backgroundImage.onload = () => {
                            URL.revokeObjectURL(imageUrl);
                        };
                    } catch (error) {
                        console.error('Error creating image preview:', error);
                        // Fallback to placeholder
                        backgroundImage.src = '/images/placeholder.png';
                    }
                }
            } else if (unifiedUploadFileInput.files.length === 0) {
                // Reset to placeholder if no file selected
                const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
                if (backgroundImage) {
                    backgroundImage.src = '/images/placeholder.png';
                }
            }
        });
    }

    // Add scroll wheel functionality for IE input
    if (unifiedUploadIeInput) {
        unifiedUploadIeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.35;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }

    // Unified upload model dropdown
    if (unifiedUploadModelDropdownBtn && unifiedUploadModelDropdownMenu) {
        unifiedUploadModelDropdownBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDropdown(unifiedUploadModelDropdownMenu, unifiedUploadModelDropdownBtn);
        });
    }

    // Combined Vibe Encoding Modal Controls
    if (closeVibeEncodingBtn) closeVibeEncodingBtn.addEventListener('click', hideVibeEncodingModal);
    if (vibeEncodingCancelBtn) vibeEncodingCancelBtn.addEventListener('click', hideVibeEncodingModal);
    if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.addEventListener('click', handleVibeEncodingConfirm);

    // File input change handler for upload mode
    if (vibeEncodingFileInput) {
        vibeEncodingFileInput.addEventListener('change', async () => {
            if (vibeEncodingConfirmBtn && vibeEncodingCurrentMode === 'upload') {
                vibeEncodingConfirmBtn.disabled = !vibeEncodingFileInput.files.length;
            }
            
            // Display uploaded image in background
            if (vibeEncodingFileInput.files.length > 0) {
                const file = vibeEncodingFileInput.files[0];
                const backgroundImage = document.getElementById('vibeEncodingBackgroundImage');
                
                if (backgroundImage && file) {
                    try {
                        // Create a preview URL for the uploaded image
                        const imageUrl = URL.createObjectURL(file);
                        backgroundImage.src = imageUrl;
                        
                        // Clean up the object URL when the image loads
                        backgroundImage.onload = () => {
                            URL.revokeObjectURL(imageUrl);
                        };
                    } catch (error) {
                        console.error('Error creating image preview:', error);
                        // Fallback to placeholder
                        backgroundImage.src = '/images/placeholder.png';
                    }
                }
            } else {
                // Reset to placeholder if no file selected
                const backgroundImage = document.getElementById('vibeEncodingBackgroundImage');
                if (backgroundImage) {
                    backgroundImage.src = '/images/placeholder.png';
                }
            }
        });
    }

    // Add scroll wheel functionality for IE input
    if (vibeEncodingIeInput) {
        vibeEncodingIeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.35;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }

    // Vibe encoding model dropdown
    if (vibeEncodingModelDropdownBtn && vibeEncodingModelDropdownMenu) {
        vibeEncodingModelDropdownBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleDropdown(vibeEncodingModelDropdownMenu, vibeEncodingModelDropdownBtn);
        });
    }

    // Move modal controls

    if (closeCacheManagerMoveBtn) closeCacheManagerMoveBtn.addEventListener('click', hideCacheManagerMoveModal);
    if (cacheManagerMoveCancelBtn) cacheManagerMoveCancelBtn.addEventListener('click', hideCacheManagerMoveModal);
    if (cacheManagerMoveConfirmBtn) cacheManagerMoveConfirmBtn.addEventListener('click', moveCacheManagerImages);

    // Vibe Manager bulk action controls

    if (vibeManagerMoveBtn) vibeManagerMoveBtn.addEventListener('click', showVibeManagerMoveModal);

    // Vibe Manager delete modal controls

    if (closeVibeManagerDeleteModalBtn) closeVibeManagerDeleteModalBtn.addEventListener('click', hideVibeManagerDeleteModal);
    if (vibeManagerDeleteCancelBtn) vibeManagerDeleteCancelBtn.addEventListener('click', hideVibeManagerDeleteModal);
    if (vibeManagerDeleteConfirmBtn) vibeManagerDeleteConfirmBtn.addEventListener('click', handleVibeManagerDeleteConfirm);
    // Vibe Manager move modal controls

    if (closeVibeManagerMoveModalBtn) closeVibeManagerMoveModalBtn.addEventListener('click', hideVibeManagerMoveModal);
    if (vibeManagerMoveCancelBtn) vibeManagerMoveCancelBtn.addEventListener('click', hideVibeManagerMoveModal);
    if (vibeManagerMoveConfirmBtn) vibeManagerMoveConfirmBtn.addEventListener('click', moveVibeManagerImages);

    // Close modals when clicking outside
    const modals = ['cacheManagerModal', 'unifiedUploadModal', 'cacheManagerMoveModal', 'vibeEncodingModal', 'vibeManagerDeleteModal', 'vibeManagerMoveModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal(modal);
                }
            });
        }
    });
}