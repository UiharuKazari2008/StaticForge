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
const showAllReferencesBtn = document.getElementById('showAllReferencesBtn');
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

const importModelMapping = {
    'v4full': 'v4',
    'v4-5full': 'v4_5',
    'v4curated': 'v4_cur',
    'v4-5curated': 'v4_5_cur'
};

// Reference Browser Functions
let cacheImages = [];
let cacheCurrentPage = 1;
let cacheImagesPerPage = 20;
let cacheShowAllReferences = false;

// Toggle show all references functionality for cache browser
async function toggleShowAllReferences() {
    cacheShowAllReferences = !cacheShowAllReferences;
    
    // Update button state
    if (showAllReferencesBtn) {
        showAllReferencesBtn.setAttribute('data-state', cacheShowAllReferences ? 'on' : 'off');
    }
    
    // Reload images with new filter
    await loadCacheImages();
    displayCacheImagesContainer();
}

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
let cacheManagerShowAllReferences = false;
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

async function refreshReferenceBrowserIfOpen() {
    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    const previewOpen = (previewSection && previewSection.getAttribute('data-active-panel') === 'cache-browser');
    if (previewOpen) {
        displayCacheImagesContainer();
    }
    if (vibeReferencesContainer) {
        const vibeReferenceItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');
        if (vibeReferenceItems.length > 0) {
            refreshReferenceBrowserForModelChange();
        }
    }
}

// Unified function to load reference images for both cache browser and manager
async function loadReferenceImages(workspace = null, showAll = false) {
    try {
        // Load unified references (cache images and vibe images together)
        let response;
        if (showAll) {
            response = await wsClient.getWorkspaceReferences('all');
        } else if (workspace) {
            response = await wsClient.getWorkspaceReferences(workspace);
        } else {
            response = await wsClient.getReferences();
        }

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
                        mtime: vibe.createdAt || vibe.mtime,
                        size: vibe.size,
                        source: vibe.source,
                        hasPreview: vibe.preview,
                        type: 'vibe',
                        vibes: [vibe],
                        hasVibes: true,
                        isStandalone: true,
                        workspaceId: vibe.workspaceId,
                        importedFrom: vibe.importedFrom,
                        locked: vibe.locked
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
            
            return combinedImages;
        } else {
            throw new Error('Failed to load references');
        }
    } catch (error) {
        console.error('Error loading reference images:', error);
        throw error;
    }
}

async function loadCacheImages() {
    try {
        const images = await loadReferenceImages(null, cacheShowAllReferences);
        cacheImages = images;
    } catch (error) {
        console.error('Error loading cache images:', error);
        throw error;
    }
}

// Unified function to display reference images in any container
function displayReferenceImages(container, images, createItemFunction, options = {}) {
    if (!container) return;

    container.innerHTML = '';

    if (images.length === 0) {
        const noImagesMessage = options.noImagesMessage || 'No cache images found';
        container.innerHTML = `
        <div class="no-images">
            <i class="fas fa-image-slash"></i>
            <span>${noImagesMessage}</span>
        </div>
    `;
        return;
    }

    // Separate default workspace items from current workspace items if requested
    if (options.separateWorkspaces) {
        const currentWorkspaceItems = [];
        const defaultWorkspaceItems = [];

        images.forEach(image => {
            if (image.workspaceId === 'default') {
                defaultWorkspaceItems.push(image);
            } else {
                currentWorkspaceItems.push(image);
            }
        });

        // Display current workspace items first, then default workspace items
        currentWorkspaceItems.forEach(image => {
            const galleryItem = createItemFunction(image);
            container.appendChild(galleryItem);
        });

        defaultWorkspaceItems.forEach(image => {
            const galleryItem = createItemFunction(image);
            container.appendChild(galleryItem);
        });
    } else {
        // Display all images in order
        images.forEach(image => {
            const galleryItem = createItemFunction(image);
            container.appendChild(galleryItem);
        });
    }

    // Add few-items class if there are 3 or fewer items
    if (options.addFewItemsClass && images.length <= 3) {
        container.classList.add('few-items');
    } else if (options.addFewItemsClass) {
        container.classList.remove('few-items');
    }
}

function displayCacheImagesContainer() {
    displayReferenceImages(cacheGalleryContainer, cacheImages, createCacheGalleryItem, {
        separateWorkspaces: true,
        addFewItemsClass: true,
        noImagesMessage: 'No cache images found'
    });
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
            img.src = '/background.jpg';
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
    
    // Check if there are available encodings for the current model
    const currentModel = getCurrentSelectedModel();
    let hasCompatibleEncodings = false;
    
    if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
        hasCompatibleEncodings = cacheImage.vibes.some(vibe => 
            vibe.encodings && vibe.encodings.some(encoding => 
                encoding.model.toLowerCase() === currentModel.toLowerCase()
            )
        );
    }
    
    if (hasCompatibleEncodings) {
        vibeBtn.disabled = false;
        vibeBtn.title = 'Add as vibe reference';
    } else if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
        vibeBtn.disabled = true;
        vibeBtn.title = `No encodings available for ${getCurrentSelectedModelDisplayName()}`;
    } else {
        vibeBtn.disabled = true;
        vibeBtn.title = 'No vibe encodings available';
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
    
    // Create comment button if any vibes have comments
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        const vibesWithComments = cacheImage.vibes.filter(vibe => vibe.comment && vibe.comment.trim() !== '');
        if (vibesWithComments.length > 0) {
            const commentBtn = document.createElement('button');
            commentBtn.className = 'btn-secondary btn-small';
            commentBtn.innerHTML = '<i class="fas fa-comment"></i>';
            commentBtn.title = `View comments (${vibesWithComments.length} vibe${vibesWithComments.length > 1 ? 's' : ''})`;
            commentBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showVibesCommentsDialog(vibesWithComments);
            });
            buttonsContainer.appendChild(commentBtn);
        }
    }

    // Create vibe encode button (always show to allow adding more IEs)
    const vibeEncodeBtn = document.createElement('button');
    vibeEncodeBtn.className = 'btn-secondary btn-small';
    vibeEncodeBtn.innerHTML = '<i class="nai-plus"></i> <span>IE</span>';
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

    // Create preview button
    if (cacheImage.hasPreview) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'btn-secondary btn-small';
        previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        previewBtn.title = 'Preview image';
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Get the full image source - prefer original image if available
            let imageSrc;
            if (cacheImage.isStandalone) {
                // For standalone vibes, use the vibe's preview or fallback
                if (cacheImage.type === 'base64' && cacheImage.source) {
                    imageSrc = `data:image/png;base64,${cacheImage.source}`;
                } else if (cacheImage.type === 'vibe' && cacheImage.source) {
                    imageSrc = `data:image/png;base64,${cacheImage.source}`;
                } else if (cacheImage.hasPreview) {
                    imageSrc = `/cache/preview/${cacheImage.hasPreview}`;
                }
            } else {
                if (cacheImage.hash) {
                    imageSrc = `/cache/upload/${cacheImage.hash}`;
                } else if (cacheImage.hasPreview) {
                    imageSrc = `/cache/preview/${cacheImage.hash}.webp`;
                }
            }

            if (imageSrc) {
                showImagePreview(imageSrc, `Reference image ${cacheImage.hash}`);
            } else {
                showError('No image found');
            }
        });

        buttonsContainer.appendChild(previewBtn);
    }
    
    buttonsContainer.appendChild(vibeEncodeBtn);

    overlay.appendChild(info);
    overlay.appendChild(actionButtonsContainer);
    overlay.appendChild(buttonsContainer);

    // Create badges container
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'cache-badges';

    // Add workspace badge if show all references is enabled and this has a workspaceId
    if (cacheShowAllReferences && cacheImage.workspaceId) {
        const workspaceBadge = document.createElement('div');
        if (cacheImage.workspaceId === 'default') {
            workspaceBadge.className = 'cache-badge default-workspace-badge';
            workspaceBadge.innerHTML = '<i class="fas fa-home"></i><span>Default</span>';
        } else {
            workspaceBadge.className = 'cache-badge workspace-badge';
            const workspaceName = getWorkspaceDisplayName(cacheImage.workspaceId);
            workspaceBadge.innerHTML = `<i class="fas fa-folder"></i><span>${workspaceName}</span>`;
            workspaceBadge.title = `Workspace: ${workspaceName}`;
        }
        badgesContainer.appendChild(workspaceBadge);
    } else if (!cacheShowAllReferences && cacheImage.workspaceId === 'default') {
        // Show default badge only when not showing all references (current behavior)
        const badge = document.createElement('div');
        badge.className = 'cache-badge default-workspace-badge';
        badge.innerHTML = '<i class="fas fa-home"></i><span>Default</span>';
        badgesContainer.appendChild(badge);
    }


    // Add NovelAI badge if imported from NovelAI
    if (cacheImage.importedFrom === 'novelai') {
        const novelaiBadge = document.createElement('div');
        novelaiBadge.className = 'cache-badge novelai-badge';
        novelaiBadge.innerHTML = '<i class="nai-pen-tip-light"></i> NovelAI';
        novelaiBadge.title = 'Imported from NovelAI Vibe Bundle';
        badgesContainer.appendChild(novelaiBadge);
    }

    // Add locked badge if vibe is locked
    if (cacheImage.locked) {
        const lockedBadge = document.createElement('div');
        lockedBadge.className = 'cache-badge locked-badge';
        lockedBadge.innerHTML = '<i class="fas fa-lock"></i> Locked';
        lockedBadge.title = 'Vibe is locked - cannot add new Information Extractions';
        badgesContainer.appendChild(lockedBadge);
    }


    // Add base image badge only for actual cache images (not standalone vibes)
    if (!cacheImage.isStandalone) {
        const baseBadge = document.createElement('div');
        baseBadge.className = 'cache-badge base-image';
        baseBadge.innerHTML = '<i class="nai-img2img"></i> Base Image';
        badgesContainer.appendChild(baseBadge);
    }

    // Add vibe encoding badges
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        cacheImage.vibes.forEach(vibe => {
            if (vibe.encodings && Array.isArray(vibe.encodings)) {
                vibe.encodings.forEach(encoding => {
                    const encodingBadge = document.createElement('div');
                    const currentModel = getCurrentSelectedModel();
                    const isAvailable = encoding.model.toLowerCase() === currentModel.toLowerCase();
                    
                    encodingBadge.className = 'cache-badge encoding' + 
                        (modelBadges[encoding.model]?.badge ? ' encoding-' + modelBadges[encoding.model].badge.toLowerCase() : '') +
                        (!isAvailable ? ' unavailable' : '');
                    
                    // Get model display name
                    const modelKey = encoding.model;
                    const modelDisplayName = modelBadges[modelKey] ? modelBadges[modelKey].display : modelKey;
                    encodingBadge.innerHTML = `
                        <div class="badge-model"><i class="nai-vibe-transfer"></i> <span>${modelDisplayName}</span></div>
                        <span class="badge-ie">${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%</span>
                    `;
                    encodingBadge.title = `Model: ${modelDisplayName}, IE: ${((encoding.informationExtraction || 0.0) * 100).toFixed(0)}%${!isAvailable ? ' (Unavailable for current model)' : ''}`;
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

// Helper function to get current selected model display name
function getCurrentSelectedModelDisplayName() {
    const currentModel = getCurrentSelectedModel();
    if (window.optionsData?.models?.[currentModel]) {
        return window.optionsData.models[currentModel];
    }
    return currentModel || 'Selected Model';
}

// Function to refresh reference browser when model changes
function refreshReferenceBrowserForModelChange() {
    // Refresh the reference browser display
    if (cacheImages && Array.isArray(cacheImages)) {
        displayCacheImagesContainer();
    }
    
    // Refresh vibe references in the modal
    refreshVibeReferencesDisplay();
}

// Function to refresh vibe references display
function refreshVibeReferencesDisplay() {
    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    if (!vibeReferencesContainer) return;
    
    // Get all current vibe reference items
    const vibeReferenceItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');
    
    vibeReferenceItems.forEach(item => {
        const vibeId = item.getAttribute('data-vibe-id');
        if (!vibeId) return;
        
        // Store current IE and strength values before replacing
        const ieDropdownBtn = item.querySelector('.custom-dropdown-btn');
        const ratioInput = item.querySelector('.vibe-reference-ratio-input');
        
        const currentIe = ieDropdownBtn?.dataset.selectedIe || null;
        const currentStrength = ratioInput?.value || null;
        
        // Find the vibe reference data
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
        
        if (vibeRef) {
            // Create new item with preserved IE and strength values
            const newItem = createVibeReferenceItem(vibeRef, currentIe, currentStrength);
            item.parentNode.replaceChild(newItem, item);
        }
    });
}

function createVibeReferenceItem(vibeRef, selectedIe = null, strength = null) {
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
    } else if (vibeRef.type === 'base64' && vibeRef.image) {
        preview.src = `data:image/png;base64,${vibeRef.image}`;
    } else {
        // Fallback to a placeholder
        preview.src = '/background.jpg';
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
    const controlsBottom = document.createElement('div');
    controlsBottom.className = 'vibe-reference-controls-bottom';

    // Create preview button
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn-secondary blur';
    previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
    previewBtn.title = 'Preview image';
    previewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Get the full image source - prefer original image if available
        let imageSrc;
        if (vibeRef.type === 'base64' && vibeRef.source) {
            imageSrc = `data:image/png;base64,${vibeRef.source}`;
        } else if (vibeRef.type === 'cache' && vibeRef.source) {
            imageSrc = `/cache/upload/${vibeRef.source}`;
        } else if (vibeRef.preview) {
            imageSrc = `/cache/preview/${vibeRef.preview}`;
        }
                
        if (imageSrc) {
            showImagePreview(imageSrc, `Vibe reference ${vibeRef.id}`);
        } else {
            showError('No image found');
        }
    });
    controlsBottom.appendChild(previewBtn);

    // Create comment button if vibe has a comment
    if (vibeRef.comment && vibeRef.comment.trim() !== '') {
        const commentBtn = document.createElement('button');
        commentBtn.type = 'button';
        commentBtn.className = 'btn-secondary blur';
        commentBtn.innerHTML = '<i class="fas fa-comment"></i>';
        commentBtn.title = 'View comment';
        commentBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showVibesCommentsDialog([vibeRef]);
        });
        controls.appendChild(commentBtn);
    }

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger blur';
    deleteBtn.innerHTML = '<i class="nai-thin-cross"></i>';
    deleteBtn.title = 'Remove vibe reference';
    deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
    const currentModel = getCurrentSelectedModel();

    // Get available encodings for this vibe (filtered by current model)
    const availableEncodings = vibeRef.encodings ?
        vibeRef.encodings.filter(encoding => encoding.model.toLowerCase() === currentModel.toLowerCase()) : [];

    // Check if there are any encodings for any model (to show missing IE option)
    const allEncodings = vibeRef.encodings || [];
    
    // Determine which encoding to use
    let targetEncoding = null;
    
    if (selectedIe !== null) {
        // Try to find the exact encoding with the selected IE for the current model
        targetEncoding = availableEncodings.find(enc => 
            parseFloat(enc.informationExtraction) === parseFloat(selectedIe)
        );
        
        // If not found for current model, check if it exists for any model
        if (!targetEncoding && allEncodings.length > 0) {
            const anyModelEncoding = allEncodings.find(enc => 
                parseFloat(enc.informationExtraction) === parseFloat(selectedIe)
            );
            if (anyModelEncoding) {
                // Show that this IE exists but for a different model
                ieText.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${(parseFloat(selectedIe) * 100).toFixed(0)}%`;
                ieDropdownBtn.title = `IE ${(parseFloat(selectedIe) * 100).toFixed(0)}% not available for ${getCurrentSelectedModelDisplayName()}`;
                ieDropdownBtn.dataset.selectedIe = selectedIe;
                ieDropdownBtn.disabled = false;
            }
        }
    }
    
    // Fall back to first available encoding if no specific IE or not found
    if (!targetEncoding && availableEncodings.length > 0) {
        targetEncoding = availableEncodings[0];
    }
    
    if (targetEncoding) {
        ieText.innerHTML = `<span>${(parseFloat(targetEncoding.informationExtraction) * 100).toFixed(0)}%</span>`;
        ieDropdownBtn.dataset.selectedModel = targetEncoding.model;
        ieDropdownBtn.dataset.selectedIe = targetEncoding.informationExtraction;
        ieDropdownBtn.disabled = false;
    } else if (allEncodings.length > 0) {
        // Has encodings for other models but not current model
        if (selectedIe !== null) {
            // Show the requested IE value that's not available
            ieText.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>${(parseFloat(selectedIe) * 100).toFixed(0)}%</span>`;
            ieDropdownBtn.title = `IE ${(parseFloat(selectedIe) * 100).toFixed(0)}% not available for ${getCurrentSelectedModelDisplayName()}`;
            ieDropdownBtn.dataset.selectedIe = selectedIe;
        } else {
            // No specific IE requested
            ieText.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>0%</span>`;
            ieDropdownBtn.title = `No encodings available for ${getCurrentSelectedModelDisplayName()}`;
        }
        ieDropdownBtn.disabled = false;
    } else {
        // No encodings at all
        ieText.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>No encodings</span>';
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
    
    // Add "Request New IE" option if no encodings available for current model
    if (availableEncodings.length === 0 && allEncodings.length > 0) {
        const requestOption = document.createElement('div');
        requestOption.className = 'custom-dropdown-option missing-ie';
        requestOption.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>${(parseFloat(selectedIe) * 100).toFixed(0)}%</span>`;
        
        requestOption.addEventListener('click', async () => {
            ieDropdownMenu.style.display = 'none';
            
            // Check if vibe is locked
            if (vibeRef.locked) {
                const shouldRemove = await window.showConfirmationDialog(
                    'This reference cannot be modified. Would you like to remove it from your references?',
                    [
                        { text: 'Remove Reference', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                );
                
                if (shouldRemove) {
                    removeVibeReference(vibeRef.id);
                }
                return;
            }
            
            // Open Request New IE modal with current model and target IE
            const currentModel = getCurrentSelectedModel();
            const targetIe = ieDropdownBtn.dataset.selectedIe || null;
            showVibeEncodingModal('ie', vibeRef, currentModel, targetIe);
        });
        
        ieDropdownMenu.appendChild(requestOption);
    }

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
    ratioInput.value = strength !== null ? strength.toString() : '0.7';

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

    previewContainer.appendChild(controlsBottom);

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
        
        await loadCacheImages();
        await refreshReferenceBrowserIfOpen();
        
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
        
        await loadCacheImages();
        await refreshReferenceBrowserIfOpen();
        
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

    // Create item with the specific IE and strength values
    const item = createVibeReferenceItem(vibeRef, selectedIe, strength);

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
        updateTransformationDropdownState('browse');

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

// Unified function to delete reference images (cache images with optional vibes)
async function deleteReferenceImage(cacheImage, workspace = null, refreshCallback = null) {
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

    const targetWorkspace = workspace || cacheImage.workspaceId || 'default';

    try {
        if (deleteType === 'base' || deleteType === 'both') {
            // Delete the base image
            const response = await wsClient.deleteReference(cacheImage.hash, targetWorkspace);
            if (!response.success) {
                throw new Error(`Failed to delete cache image: ${response.message}`);
            }
        }
        
        if (deleteType === 'vibes' || deleteType === 'both') {
            // Delete the vibes
            if (cacheImage.vibes && cacheImage.vibes.length > 0) {
                for (const vibe of cacheImage.vibes) {
                    const vibeResponse = await wsClient.deleteVibeImage(vibe.id, targetWorkspace);
                    if (!vibeResponse.success) {
                        console.error(`Failed to delete vibe ${vibe.id}: ${vibeResponse.message}`);
                    }
                }
            }
        }

        // Execute refresh callback if provided
        if (refreshCallback) {
            await refreshCallback();
        }

        showGlassToast('success', null, 'Reference deleted');
    } catch (error) {
        console.error('Error deleting reference image:', error);
        showError('Failed to delete reference');
    }
}

async function deleteCacheImage(cacheImage) {
    await deleteReferenceImage(cacheImage, null, async () => {
        // Remove from local array
        cacheImages = cacheImages.filter(img => img.hash !== cacheImage.hash);
        if (cacheBrowserContainer.style.display !== 'none') {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();
    });
}


// Workspace helper moved to utils/referenceUtils.js

// Modal management functions - moved to shared modal system

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

async function hideCacheManagerModal() {
    if (cacheManagerModal) {
        closeModal(cacheManagerModal);
    }
    
    if (cacheBrowserContainer.style.display !== 'none') {
        await loadCacheManagerImages();
    } else {
        await loadCacheImages();
    }
    await refreshReferenceBrowserIfOpen();
}

// Unified workspace dropdown setup
function setupWorkspaceDropdown(config) {
    const { dropdown, button, menu, selected, getCurrentWorkspace, onWorkspaceChange, markupId } = config;
    
    if (!dropdown || !button || !menu || !selected) return;

    // Update selected workspace
    selected.textContent = getWorkspaceDisplayName(getCurrentWorkspace());

    // Check if dropdown is already set up
    if (dropdown.dataset.setup === 'true') {
        return; // Already set up, don't add duplicate event listeners
    }

    // Create a render function that captures the config
    const renderFunction = (selectedValue) => {
        renderReferenceWorkspaceDropdown(config, selectedValue);
    };

    // Setup dropdown functionality
    setupDropdown(dropdown, button, menu, renderFunction, getCurrentWorkspace);

    // Mark as set up
    dropdown.dataset.setup = 'true';
}

function renderReferenceWorkspaceDropdown(config, selectedValue = null) {
    const { menu, getCurrentWorkspace, onWorkspaceChange, filterCurrentWorkspace = false } = config;
    
    if (!menu) return '';

    menu.innerHTML = '';

    Object.values(workspaces).forEach(workspace => {
        // Skip current workspace if filtering enabled
        if (filterCurrentWorkspace && workspace.id === getCurrentWorkspace()) {
            return;
        }

        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (workspace.id === getCurrentWorkspace() ? ' selected' : '');
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
            if (onWorkspaceChange) {
                onWorkspaceChange(workspace);
            }
            closeDropdown(menu, config.button);
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

function setupCacheManagerWorkspaceDropdown() {
    setupWorkspaceDropdown({
        dropdown: cacheManagerWorkspaceDropdown,
        button: cacheManagerWorkspaceDropdownBtn,
        menu: cacheManagerWorkspaceDropdownMenu,
        selected: cacheManagerWorkspaceSelected,
        getCurrentWorkspace: () => cacheManagerCurrentWorkspace,
        onWorkspaceChange: (workspace) => {
            if (workspace.id !== cacheManagerCurrentWorkspace) {
                cacheManagerCurrentWorkspace = workspace.id;
                loadCacheManagerImages();
                if (cacheManagerWorkspaceSelected) {
                    cacheManagerWorkspaceSelected.textContent = workspace.name;
                }
            }
        }
    });
}

function renderCacheManagerWorkspaceDropdown() {
    renderReferenceWorkspaceDropdown({
        menu: cacheManagerWorkspaceDropdownMenu,
        getCurrentWorkspace: () => cacheManagerCurrentWorkspace,
        onWorkspaceChange: (workspace) => {
            if (workspace.id !== cacheManagerCurrentWorkspace) {
                cacheManagerCurrentWorkspace = workspace.id;
                loadCacheManagerImages();
                if (cacheManagerWorkspaceSelected) {
                    cacheManagerWorkspaceSelected.textContent = workspace.name;
                }
            }
        }
    });
}

async function loadCacheManagerImages() {
    if (cacheManagerLoading) cacheManagerLoading.style.display = 'flex';
    if (cacheManagerGallery) cacheManagerGallery.innerHTML = '';

    try {
        const images = await loadReferenceImages(cacheManagerCurrentWorkspace, false);
        cacheManagerImages = images;
        displayCacheManagerImages();
    } catch (error) {
        console.error('Error loading cache manager images:', error);
        showError('Failed to load cache images');
    } finally {
        if (cacheManagerLoading) cacheManagerLoading.style.display = 'none';
    }
}

function displayCacheManagerImages() {
    displayReferenceImages(cacheManagerGallery, cacheManagerImages, createCacheManagerGalleryItem, {
        separateWorkspaces: false,
        addFewItemsClass: false,
        noImagesMessage: 'No cache images found in this workspace'
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
            img.src = '/background.jpg';
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
    const buttonsContainerTop = document.createElement('div');
    const buttonsContainerBottom = document.createElement('div');
    buttonsContainerTop.className = 'cache-manager-gallery-item-buttons';
    buttonsContainerBottom.className = 'cache-manager-gallery-item-buttons';

    // Create comment button if any vibes have comments
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        const vibesWithComments = cacheImage.vibes.filter(vibe => vibe.comment);
        if (vibesWithComments.length > 0) {
            const commentBtn = document.createElement('button');
            commentBtn.className = 'btn-secondary btn-small';
            commentBtn.innerHTML = '<i class="fas fa-comment"></i>';
            commentBtn.title = `View comments (${vibesWithComments.length} vibe${vibesWithComments.length > 1 ? 's' : ''})`;
            commentBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showVibesCommentsDialog(vibesWithComments);
            });
            buttonsContainerTop.appendChild(commentBtn);
        }
    }

    // Create preview button
    if (cacheImage.hasPreview) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'btn-secondary btn-small';
        previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        previewBtn.title = 'Preview image';
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let imageSrc;
            if (cacheImage.isStandalone) {
                if (cacheImage.type === 'base64' && cacheImage.source) {
                    imageSrc = `data:image/png;base64,${cacheImage.source}`;
                } else if (cacheImage.type === 'vibe' && cacheImage.source) {
                    imageSrc = `data:image/png;base64,${cacheImage.source}`;
                } else if (cacheImage.hasPreview) {
                    imageSrc = `/cache/preview/${cacheImage.hasPreview}`;
                }
            } else {
                if (cacheImage.hash) {
                    imageSrc = `/cache/upload/${cacheImage.hash}`;
                } else if (cacheImage.hasPreview) {
                    imageSrc = `/cache/preview/${cacheImage.hash}.webp`;
                }
            }

            if (imageSrc) {
                showImagePreview(imageSrc, `Reference image ${cacheImage.hash}`);
            } else {
                showError('No image found');
            }
        });
        buttonsContainerBottom.appendChild(previewBtn);
    }

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
    buttonsContainerBottom.appendChild(vibeBtn);

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCacheManagerImage(cacheImage, cacheManagerCurrentWorkspace);
    });

    buttonsContainerBottom.appendChild(moveBtn);
    buttonsContainerBottom.appendChild(deleteBtn);

    overlay.appendChild(buttonsContainerTop);
    overlay.appendChild(buttonsContainerBottom);

    // Create badges container
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'cache-manager-badges';

    // Add NovelAI badge if imported from NovelAI
    if (cacheImage.importedFrom === 'novelai') {
        const novelaiBadge = document.createElement('div');
        novelaiBadge.className = 'cache-badge novelai-badge';
        novelaiBadge.innerHTML = '<i class="nai-import"></i> NovelAI';
        novelaiBadge.title = 'Imported from NovelAI Vibe Bundle';
        badgesContainer.appendChild(novelaiBadge);
    }

    // Add locked badge if vibe is locked
    if (cacheImage.locked) {
        const lockedBadge = document.createElement('div');
        lockedBadge.className = 'cache-badge locked-badge';
        lockedBadge.innerHTML = '<i class="fas fa-lock"></i> Locked';
        lockedBadge.title = 'Vibe is locked - cannot add new Information Extractions';
        badgesContainer.appendChild(lockedBadge);
    }

    // Add base image badge only for actual cache images (not standalone vibes)
    if (!cacheImage.isStandalone) {
        const baseBadge = document.createElement('div');
        baseBadge.className = 'cache-badge base-image';
        baseBadge.innerHTML = '<i class="nai-img2img"></i> Base Image';
        badgesContainer.appendChild(baseBadge);
    }

    // Add vibe encoding badges
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        cacheImage.vibes.forEach(vibe => {
            if (vibe.encodings && Array.isArray(vibe.encodings)) {
                vibe.encodings.forEach(encoding => {
                    const encodingBadge = document.createElement('div');
                    
                    encodingBadge.className = 'cache-badge encoding' + 
                        (modelBadges[encoding.model]?.badge ? ' encoding-' + modelBadges[encoding.model].badge.toLowerCase() : '');
                    
                    // Get model display name
                    const modelKey = encoding.model;
                    const modelDisplayName = modelBadges[modelKey] ? modelBadges[modelKey].display : modelKey;
                    
                    encodingBadge.innerHTML = `
                        <div class="badge-model"><i class="nai-vibe-transfer"></i> <span>${modelDisplayName}</span></div>
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
    await deleteReferenceImage(cacheImage, workspace || cacheManagerCurrentWorkspace, async () => {
        // Remove from local array
        cacheManagerImages = cacheManagerImages.filter(img => img.hash !== cacheImage.hash);
        // Refresh display
        if (cacheBrowserContainer.style.display !== 'none') {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        displayCacheManagerImages();
        await refreshReferenceBrowserIfOpen();
    });
}



// Unified Upload Modal Functions
function showUnifiedUploadModal() {
    if (!unifiedUploadModal) return;

    // Reset form
    if (unifiedUploadFileInput) unifiedUploadFileInput.value = '';
    if (unifiedUploadIeInput) unifiedUploadIeInput.value = '0.35';
    if (unifiedUploadConfirmBtn) unifiedUploadConfirmBtn.disabled = true;
    
    // Reset comment input
    const commentInput = document.getElementById('unifiedUploadCommentInput');
    if (commentInput) commentInput.value = '';
    
    // Use the mode that was set before opening, or default to reference mode
    if (typeof window.unifiedUploadCurrentMode === 'string') {
        unifiedUploadCurrentMode = window.unifiedUploadCurrentMode;
        // Reset the global variable
        window.unifiedUploadCurrentMode = 'reference';
    } else {
        unifiedUploadCurrentMode = 'reference';
    }
    
    // Reset UI elements
    hideVibeBundlePreview();
    showModeSelector();
    resetUploadModal();
    updateUnifiedUploadMode();
    
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
    
    // Update file input configuration but preserve file selection
    if (unifiedUploadFileInput) {
        if (unifiedUploadCurrentMode === 'vibe') {
            unifiedUploadFileInput.removeAttribute('multiple');
        } else {
            unifiedUploadFileInput.setAttribute('multiple', '');
        }
        
        // Don't reset file input - preserve selection
        // Only update the UI to reflect the current mode
        if (unifiedUploadFileInput.files.length > 0) {
            // Re-trigger file change handler to update UI for current mode
            handleUnifiedUploadFileChange();
        }
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
    
    // Validate file types - accept images, JSON files, and .naiv4vibebundle files
    const invalidFiles = files.filter(file => {
        const isImage = file.type.startsWith('image/');
        const isJson = file.type === 'application/json';
        const isNaiv4Bundle = file.name.endsWith('.naiv4vibebundle');
        return !isImage && !isJson && !isNaiv4Bundle;
    });
    if (invalidFiles.length > 0) {
        showError('Please select valid image files, JSON files, or .naiv4vibebundle files only.');
        return;
    }
    
    // Check if any JSON files or .naiv4vibebundle files are selected
    const jsonFiles = files.filter(file => file.type === 'application/json' || file.name.endsWith('.naiv4vibebundle'));
    if (jsonFiles.length > 0) {
        // Handle JSON file import
        await handleJsonFileImport(jsonFiles);
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
        
        // If this was uploaded as a base image (reference mode), add it to the manual form
        if (unifiedUploadCurrentMode === 'reference' && results.length > 0) {
            const uploadedHash = results[0].hash;
            if (uploadedHash) {
                // Add as base image to the manual form
                await addAsBaseImage({ hash: uploadedHash, type: 'cache' });
            }
        }
        
        // Refresh cache manager
        if (cacheBrowserContainer.style.display !== 'none') {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();
        
        // Close modal
        hideUnifiedUploadModal();
        
    } catch (error) {
        removeGlassToast(toastId);
        showError('Upload failed: ' + error.message);
    }
}

async function handleJsonFileImport(files) {
    let toastId = showGlassToast('info', 'Importing Vibe Bundle', 'Processing JSON files...', true, false, '<i class="nai-import"></i>');
    try {
        let targetWorkspace = cacheManagerCurrentWorkspace;
        if (cacheManagerModal && cacheManagerModal.classList.contains('modal-open')) {
            const selectedWorkspaceElement = cacheManagerWorkspaceSelected;
            if (selectedWorkspaceElement && selectedWorkspaceElement.textContent) {
                const workspaceName = selectedWorkspaceElement.textContent.trim();
                const workspace = Object.values(workspaces).find(w => w.name === workspaceName);
                if (workspace) {
                    targetWorkspace = workspace.id;
                }
            }
        }
        if (!targetWorkspace) {
            showError('No workspace selected. Please select a workspace first.');
            return;
        }
        const commentInput = document.getElementById('unifiedUploadCommentInput');
        const comment = commentInput ? commentInput.value.trim() : '';
        const importPromises = files.map(async (file, index) => {
            updateGlassToast(toastId, 'info', 'Importing Vibe Bundle', `Processing ${file.name}...`);
            const fileContent = await file.text();
            let jsonData = JSON.parse(fileContent);
            
            // Handle missing preview images for vibes (both single and bundle formats)
            const vibesToProcess = jsonData.identifier === 'novelai-vibe-transfer' ? [jsonData] : (jsonData.vibes || []);
            
            // Get any user-added images from the UI before importing
            const updatedJsonData = { ...jsonData };
            
            // Check if we have modified vibe data from button interactions
            if (window.modifiedVibeData && window.modifiedVibeData.length > 0) {
                if (jsonData.identifier === 'novelai-vibe-transfer') {
                    // Single vibe format - check if this vibe was modified
                    const modifiedVibe = window.modifiedVibeData.find(v => v.id === jsonData.id);
                    if (modifiedVibe) {
                        if (modifiedVibe.thumbnail) {
                            updatedJsonData.thumbnail = modifiedVibe.thumbnail;
                        }
                        if (modifiedVibe.image) {
                            updatedJsonData.image = modifiedVibe.image;
                            updatedJsonData.type = 'base64';
                        }
                    }
                } else if (jsonData.identifier === 'novelai-vibe-transfer-bundle') {
                    // Bundle format - update vibes with any modifications
                    const updatedVibes = vibesToProcess.map(vibe => {
                        const modifiedVibe = window.modifiedVibeData.find(v => v.id === vibe.id);
                        if (modifiedVibe) {
                            return {
                                ...vibe,
                                thumbnail: modifiedVibe.thumbnail || vibe.thumbnail,
                                image: modifiedVibe.image || vibe.image,
                                type: modifiedVibe.image ? 'base64' : vibe.type
                            };
                        }
                        return vibe;
                    });
                    updatedJsonData.vibes = updatedVibes;
                }
            }
            
            // Send updated data to server for processing
            const response = await wsClient.importVibeBundle(updatedJsonData, targetWorkspace, comment);
            if (!response.success) {
                throw new Error(response.message || 'Import failed');
            }
            return response;
        });
        const results = await Promise.all(importPromises);
        removeGlassToast(toastId);
        showGlassToast('success', 'Import Complete', `Successfully imported ${results.length} vibe bundle(s)`, false, true, '<i class="nai-check"></i>');
        
        // Clear modified vibe data after successful import
        window.modifiedVibeData = [];
        
        if (cacheBrowserContainer.style.display !== 'none') {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();
        hideUnifiedUploadModal();
    } catch (error) {
        removeGlassToast(toastId);
        showError('Import failed: ' + error.message);
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
        if (cacheBrowserContainer.style.display !== 'none') {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();
        
        // Add the vibe to the vibe references container
        if (response.vibeData && response.vibeData.id) {
            // Refresh cache images to get the latest vibe data
            await loadCacheImages();
            await addVibeReferenceToContainer(response.vibeData.id, informationExtraction, 0.7);
        }
        
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
                backgroundImage.src = '/background.jpg';
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
    
    setupWorkspaceDropdown({
        dropdown: modal.querySelector('#cacheManagerMoveWorkspaceDropdown'),
        button: modal.querySelector('#cacheManagerMoveWorkspaceDropdownBtn'),
        menu: modal.querySelector('#cacheManagerMoveWorkspaceDropdownMenu'),
        selected: modal.querySelector('#cacheManagerMoveWorkspaceSelected'),
        getCurrentWorkspace: () => cacheManagerCurrentWorkspace,
        filterCurrentWorkspace: true,
        onWorkspaceChange: (workspace) => {
            const selectedSpan = modal.querySelector('#cacheManagerMoveWorkspaceSelected');
            const confirmBtn = modal.querySelector('#cacheManagerMoveConfirmBtn');
            
            const workspaceColor = workspace.color || '#124';
            selectedSpan.innerHTML = `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                <div class="workspace-name">${workspace.name}</div></div>`;
            selectedSpan.dataset.value = workspace.id;
            confirmBtn.disabled = false;
        }
    });
}

// Render function for cache manager move workspace dropdown
function renderCacheManagerMoveWorkspaceDropdown() {
    const modal = document.getElementById('cacheManagerMoveModal');
    if (!modal) return;
    
    renderReferenceWorkspaceDropdown({
        menu: modal.querySelector('#cacheManagerMoveWorkspaceDropdownMenu'),
        getCurrentWorkspace: () => cacheManagerCurrentWorkspace,
        filterCurrentWorkspace: true,
        onWorkspaceChange: (workspace) => {
            const selectedSpan = modal.querySelector('#cacheManagerMoveWorkspaceSelected');
            const confirmBtn = modal.querySelector('#cacheManagerMoveConfirmBtn');
            
            const workspaceColor = workspace.color || '#124';
            selectedSpan.innerHTML = `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                <div class="workspace-name">${workspace.name}</div></div>`;
            selectedSpan.dataset.value = workspace.id;
            confirmBtn.disabled = false;
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
            if (cacheBrowserContainer.style.display !== 'none') {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();
        } else {
            throw new Error(`Failed to move image: ${response.message}`);
        }
    } catch (error) {
        console.error('Error moving cache image:', error);
        showError('Failed to move image');
    }
}

// Combined Vibe Encoding Modal Functions
function showVibeEncodingModal(mode, data = null, targetModel = null, targetIe = null) {
    if (!vibeEncodingModal) return;
    
    vibeEncodingCurrentMode = mode;
    
    // Reset form
    if (vibeEncodingFileInput) vibeEncodingFileInput.value = '';
    if (vibeEncodingIeInput) vibeEncodingIeInput.value = targetIe || '0.35';
    if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = true;
    
    // Reset comment input
    const commentInput = document.getElementById('vibeEncodingCommentInput');
    if (commentInput) commentInput.value = '';
    
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
            if (backgroundImage) backgroundImage.src = '/background.jpg';
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
            // Set title based on whether we have a target model
            const ieTitle = targetModel 
                ? `<i class="nai-vibe-transfer"></i> <span>Request IE for ${window.optionsData?.models?.[targetModel] || targetModel}</span>`
                : '<i class="nai-vibe-transfer"></i> <span>Request New IE</span>';
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = ieTitle;
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Encode';
            if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = false;
            vibeEncodingCurrentVibeImage = data;
            if (backgroundImage && data && data.preview) {
                backgroundImage.src = `/cache/preview/${data.preview}`;
            }
            if (modeDisplay) modeDisplay.textContent = 'IE Request';
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
    
    // Set target model if provided
    if (targetModel) {
        vibeEncodingSelectedModel = targetModel;
    }
    
    // Update model display
    if (modelDisplay) {
        const displayName = window.optionsData?.models?.[vibeEncodingSelectedModel] || vibeEncodingSelectedModel || 'V4.5';
        modelDisplay.textContent = displayName;
    }
    
    // Populate model dropdown
    populateVibeEncodingModelDropdown();
    
    // Update model dropdown selection if target model was provided
    if (targetModel && vibeEncodingModelSelected) {
        const displayName = window.optionsData?.models?.[targetModel] || targetModel;
        vibeEncodingModelSelected.textContent = displayName;
    }
    
    // Open modal
    openModal(vibeEncodingModal);
}

async function hideVibeEncodingModal() {
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
    
    if (cacheBrowserContainer.style.display !== 'none') {
        await loadCacheManagerImages();
    } else {
        await loadCacheImages();
    }
    await refreshReferenceBrowserIfOpen();
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
    
    // Get comment from input
    const commentInput = document.getElementById('vibeEncodingCommentInput');
    const comment = commentInput ? commentInput.value.trim() : '';
    
    let toastId;
    let requestParams = {
        informationExtraction: informationExtraction,
        model: model,
        workspace: cacheManagerCurrentWorkspace, // Default, will be updated based on mode
        comment: comment || null
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
                
                // Use the vibe's workspace instead of current workspace
                if (vibeEncodingCurrentVibeImage.workspaceId) {
                    requestParams.workspace = vibeEncodingCurrentVibeImage.workspaceId;
                }
                break;
                
            case 'reference':
                if (!vibeEncodingCurrentCacheImage) {
                    showError('No reference image selected');
                    return;
                }
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from reference image...', true, false, '<i class="fas fa-binary"></i>');
                
                requestParams.cacheFile = vibeEncodingCurrentCacheImage.hash;
                
                // Use the source cache image's workspace instead of current workspace
                if (vibeEncodingCurrentCacheImage.workspaceId) {
                    requestParams.workspace = vibeEncodingCurrentCacheImage.workspaceId;
                }
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
            await hideVibeEncodingModal();
            if (cacheBrowserContainer.style.display !== 'none') {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();
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
        img.src = '/background.jpg'; // Fallback image
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

    // Add NovelAI badge if imported from NovelAI
    if (vibeImage.importedFrom === 'novelai') {
        const novelaiBadge = document.createElement('div');
        novelaiBadge.className = 'vibe-badge novelai-badge';
        novelaiBadge.innerHTML = '<i class="nai-import"></i> NovelAI';
        novelaiBadge.title = 'Imported from NovelAI Vibe Bundle';
        encodingsContainer.appendChild(novelaiBadge);
    }

    // Add locked badge if vibe is locked
    if (vibeImage.locked) {
        const lockedBadge = document.createElement('div');
        lockedBadge.className = 'vibe-badge locked-badge';
        lockedBadge.innerHTML = '<i class="fas fa-lock"></i> Locked';
        lockedBadge.title = 'Vibe is locked - cannot add new Information Extractions';
        encodingsContainer.appendChild(lockedBadge);
    }

    if (vibeImage.encodings && vibeImage.encodings.length > 0) {
        // Create enhanced badges container
        const badgesContainer = document.createElement('div');
        badgesContainer.className = 'vibe-image-badges';

        vibeImage.encodings.forEach(encoding => {
            // Get model display name
            const modelKey = encoding.model || 'kayra';
            const modelDisplayName = modelBadges[modelKey] ? (modelBadges[modelKey].display + (modelBadges[modelKey].badge ? ' ' + modelBadges[modelKey].badge : '')) : modelKey;

            // Combined model and IE badge with split colors
            const combinedBadge = document.createElement('div');
            combinedBadge.className = 'vibe-badge split';
            combinedBadge.innerHTML = `
                <div class="badge-model"><i class="nai-vibe-transfer"></i> <span>${modelDisplayName}</span></div>
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

    // Create IE request button (only if not locked)
    if (!vibeImage.locked) {
        const ieBtn = document.createElement('button');
        ieBtn.className = 'btn-secondary btn-small';
        ieBtn.innerHTML = '<i class="nai-plus"></i>';
        ieBtn.title = 'Request new Information Extraction';
        ieBtn.addEventListener('click', (e) => {z``
            e.stopPropagation();
            showVibeEncodingModal('ie', vibeImage);
        });
        buttonsContainer.appendChild(ieBtn);
    }

    // Create comment button if comment exists
    if (vibeImage.comment) {
        const commentBtn = document.createElement('button');
        commentBtn.className = 'btn-secondary btn-small';
        commentBtn.innerHTML = '<i class="fas fa-comment"></i>';
        commentBtn.title = 'View comment';
        commentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showCommentDialog(vibeImage.comment, vibeImage.originalName || 'Vibe Comment');
        });
        buttonsContainer.appendChild(commentBtn);
    }

    // Create preview button
    const previewBtn = document.createElement('button');
    previewBtn.className = 'btn-secondary btn-small';
    previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
    previewBtn.title = 'Preview image';
    previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Get the full image source
        let imageSrc;
        if (vibeImage.type === 'base64' && vibeImage.source) {
            imageSrc = `data:image/png;base64,${vibeImage.source}`;
        } else if (vibeImage.type === 'cache' && vibeImage.source) {
            imageSrc = `/cache/upload/${vibeImage.source}`;
        } else if (vibeImage.preview) {
            imageSrc = `/cache/preview/${vibeImage.preview}`;
        }
        if (imageSrc) {
            showImagePreview(imageSrc, `Vibe image ${vibeImage.id}`);
        } else {
            showError('No preview image found');
        }
    });

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.innerHTML = '<i class="nai-trash"></i>';
    deleteBtn.title = 'Delete vibe encoding';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vibeManagerSelectedImages.clear();
        vibeManagerSelectedImages.add(vibeImage.id);
        showVibeManagerDeleteModal();
    });

    buttonsContainer.appendChild(previewBtn);
    buttonsContainer.appendChild(moveBtn);
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
            if (cacheBrowserContainer.style.display !== 'none') {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();
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
            if (cacheBrowserContainer.style.display !== 'none') {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            displayVibeManagerImages();
            await refreshReferenceBrowserIfOpen();
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
        if (cacheBrowserContainer.style.display !== 'none') {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        displayVibeManagerImages();
        await refreshReferenceBrowserIfOpen();
        
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

// Handle file input changes for unified upload modal
async function handleUnifiedUploadFileChange() {
    if (unifiedUploadConfirmBtn) {
        unifiedUploadConfirmBtn.disabled = !unifiedUploadFileInput.files.length;
    }
    
    // Reset UI elements
    hideVibeBundlePreview();
    showModeSelector();
    
    // Display uploaded file in background (for both modes)
    if (unifiedUploadFileInput.files.length > 0) {
        const file = unifiedUploadFileInput.files[0];
        const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
        
        if (backgroundImage && file) {
            try {
                if (file.type === 'application/json' || file.name.endsWith('.naiv4vibebundle')) {
                    await handleVibeBundleFile(file, backgroundImage);
                } else {
                    await handleImageFile(file, backgroundImage);
                }
            } catch (error) {
                console.error('Error creating file preview:', error);
                backgroundImage.src = '/background.jpg';
            }
        }
    } else {
        resetUploadModal();
    }
}

// Handle vibe bundle file selection
async function handleVibeBundleFile(file, backgroundImage) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const jsonData = JSON.parse(e.target.result);
            
            // Check if it's a vibe bundle or single vibe
            const isVibeBundle = jsonData.identifier === 'novelai-vibe-transfer-bundle' && jsonData.vibes && jsonData.vibes.length > 0;
            const isSingleVibe = jsonData.identifier === 'novelai-vibe-transfer';
            
            if (isVibeBundle || isSingleVibe) {
                const vibes = isVibeBundle ? jsonData.vibes : [jsonData];
                
                // Hide mode selection for vibe bundles
                hideModeSelector();
                
                // Show vibe bundle preview
                showVibeBundlePreview(vibes);
                
                // Set background image to first vibe's thumbnail
                const firstVibe = vibes[0];
                if (firstVibe.thumbnail && firstVibe.thumbnail.startsWith('data:image/')) {
                    backgroundImage.src = firstVibe.thumbnail;
                } else {
                    backgroundImage.src = '/background.jpg';
                }
                
                // Update UI for bundle import
                updateUIForVibeBundleImport(vibes.length, isVibeBundle);
            } else {
                handleInvalidBundle(backgroundImage);
            }
        } catch (parseError) {
            console.error('Error parsing JSON:', parseError);
            handleInvalidBundle(backgroundImage);
        }
    };
    reader.readAsText(file);
}

// Handle regular image file selection
async function handleImageFile(file, backgroundImage) {
    // Create a preview URL for the uploaded image
    const imageUrl = URL.createObjectURL(file);
    backgroundImage.src = imageUrl;
    
    // Clean up the object URL when the image loads
    backgroundImage.onload = () => {
        URL.revokeObjectURL(imageUrl);
    };
}

// Show vibe bundle preview
function showVibeBundlePreview(vibes) {
    const vibeBundlePreview = document.getElementById('unifiedUploadVibeBundlePreview');
    const vibeBundleList = document.getElementById('unifiedUploadVibeBundleList');
    
    if (!vibeBundlePreview || !vibeBundleList) return;
    
    // Initialize modified vibe data tracking
    window.modifiedVibeData = [];
    
    vibeBundleList.innerHTML = '';
    
    vibes.forEach(vibe => {
        const item = document.createElement('div');
        item.className = 'vibe-bundle-item';
        item.setAttribute('data-vibe-id', vibe.id);
        
        // Create image element
        const img = document.createElement('img');
        img.className = 'vibe-bundle-item-image';
        if (vibe.thumbnail && vibe.thumbnail.startsWith('data:image/')) {
            img.src = vibe.thumbnail;
        } else {
            img.src = '/background.jpg';
        }
        img.alt = vibe.name || 'Vibe';
        
        // Create details section
        const details = document.createElement('div');
        details.className = 'vibe-bundle-item-details';
        
        const name = document.createElement('div');
        name.className = 'vibe-bundle-item-name';
        name.textContent = vibe.name || 'Unnamed Vibe';
        
        const info = document.createElement('div');
        info.className = 'vibe-bundle-item-info';
        
        // Add encoding badges using the same system as gallery - exactly like createVibeManagerGalleryItem
        if (vibe.encodings && Object.keys(vibe.encodings).length > 0) {
            // Create badges container like cache manager
            const badgesContainer = document.createElement('div');
            badgesContainer.className = 'vibe-badges';
            
            let hasEncodings = false;
            
            Object.entries(vibe.encodings).forEach(([bundleModel, encodings]) => {
                // Map the bundle model name to the correct internal model name
                const mappedModel = importModelMapping[bundleModel] || bundleModel;
                
                // Extract IE values from encoding structure
                const ieValues = new Set();
                
                Object.entries(encodings).forEach(([encodingId, encodingData]) => {
                    let ie;
                    if (encodingId !== 'unknown') {
                        // Use the IE from params if available
                        ie = encodingData.params?.information_extracted;
                    } else {
                        // For unknown encodingId, try params first, then fallback to importInfo
                        if (encodingData.params && encodingData.params.information_extracted && 
                            typeof encodingData.params.information_extracted === 'number' && 
                            encodingData.params.information_extracted > 0) {
                            ie = encodingData.params.information_extracted;
                        } else if (vibe.importInfo && vibe.importInfo.information_extracted) {
                            ie = vibe.importInfo.information_extracted;
                        } else {
                            ie = 1; // Default fallback
                        }
                    }
                    
                    if (ie !== undefined && ie !== null && !isNaN(ie)) {
                        ieValues.add(ie);
                    }
                });
                
                // Create badges for each unique IE value exactly like cache manager
                ieValues.forEach(ieValue => {
                    hasEncodings = true;
                    // Get model display name exactly like cache manager
                    const modelKey = mappedModel || 'kayra';
                    const modelDisplayName = window.modelBadges?.[modelKey] ? window.modelBadges[modelKey].display : modelKey;

                    // Create encoding badge with proper cache-badge classes like cache manager
                    const encodingBadge = document.createElement('div');
                    encodingBadge.className = 'cache-badge encoding' + 
                        (window.modelBadges?.[modelKey]?.badge ? ' encoding-' + window.modelBadges[modelKey].badge.toLowerCase() : '');
                    
                    encodingBadge.innerHTML = `
                        <div class="badge-model"><i class="nai-vibe-transfer"></i> <span>${modelDisplayName}</span></div>
                        <span class="badge-ie">${(ieValue * 100).toFixed(0)}%</span>
                    `;
                    encodingBadge.title = `Model: ${modelDisplayName}, IE: ${(ieValue * 100).toFixed(0)}%`;
                    badgesContainer.appendChild(encodingBadge);
                });
            });
            
            if (hasEncodings) {
                info.appendChild(badgesContainer);
            } else {
                // No encodings found - add "No IE" badge like createVibeManagerGalleryItem
                const noEncodingsBadge = document.createElement('div');
                noEncodingsBadge.className = 'vibe-manager-encoding-badge no-encodings';
                noEncodingsBadge.textContent = 'No IE';
                info.appendChild(noEncodingsBadge);
            }
        } else {
            // No encodings - add "No IE" badge like createVibeManagerGalleryItem
            const noEncodingsBadge = document.createElement('div');
            noEncodingsBadge.className = 'vibe-manager-encoding-badge no-encodings';
            noEncodingsBadge.textContent = 'No IE';
            info.appendChild(noEncodingsBadge);
        }
        
        // Add buttons for vibes missing thumbnails or source images
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.gap = '8px';
        buttonsContainer.style.margin = '8px 0';
        
        // Add thumbnail selection button for vibes missing thumbnails
        if (!vibe.thumbnail) {
            const thumbnailButton = document.createElement('button');
            thumbnailButton.className = 'btn-primary btn-small';
            thumbnailButton.innerHTML = '<i class="fas fa-image"></i> Preview';
            
            // Handle thumbnail selection
            thumbnailButton.onclick = async () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.style.display = 'none';
                document.body.appendChild(input);
                
                input.onchange = async () => {
                    const selectedFile = input.files[0];
                    document.body.removeChild(input);
                    
                    if (selectedFile) {
                        try {
                            const base64 = await fileToBase64(selectedFile);
                            vibe.thumbnail = 'data:image/png;base64,' + base64;
                            
                            // Update the image preview
                            img.src = vibe.thumbnail;
                            
                            // Update button to show success
                            thumbnailButton.innerHTML = '<i class="fas fa-check"></i>';
                            thumbnailButton.className = 'btn-secondary btn-small';
                            thumbnailButton.style.background = 'rgb(0 162 37 / 57%)';
                            thumbnailButton.style.borderColor = 'rgb(84 255 123)';
                            thumbnailButton.style.color = '#ccffc8';
                            thumbnailButton.disabled = true;
                            
                            // Store the modified vibe data for import
                            const existingIndex = window.modifiedVibeData.findIndex(v => v.id === vibe.id);
                            if (existingIndex >= 0) {
                                window.modifiedVibeData[existingIndex].thumbnail = vibe.thumbnail;
                            } else {
                                window.modifiedVibeData.push({
                                    id: vibe.id,
                                    thumbnail: vibe.thumbnail
                                });
                            }
                        } catch (error) {
                            showError('Failed to process thumbnail image: ' + error.message);
                        }
                    }
                };
                
                input.click();
            };
            
            buttonsContainer.appendChild(thumbnailButton);
        }
        
        // Add source image selection button for vibes missing source images
        if (!vibe.image) {
            const sourceButton = document.createElement('button');
            sourceButton.className = 'btn-primary btn-small';
            sourceButton.innerHTML = '<i class="fas fa-file-image"></i> Source';
            
            // Handle source image selection
            sourceButton.onclick = async () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.style.display = 'none';
                document.body.appendChild(input);
                
                input.onchange = async () => {
                    const selectedFile = input.files[0];
                    document.body.removeChild(input);
                    
                    if (selectedFile) {
                        try {
                            const base64 = await fileToBase64(selectedFile);
                            vibe.image = base64;
                            vibe.type = 'base64';
                            
                            // Update button to show success
                            sourceButton.innerHTML = '<i class="fas fa-check"></i>';
                            sourceButton.className = 'btn-secondary btn-small';
                            sourceButton.style.background = 'rgb(0 162 37 / 57%)';
                            sourceButton.style.borderColor = 'rgb(84 255 123)';
                            sourceButton.style.color = '#ccffc8';
                            sourceButton.disabled = true;
                            
                            // Store the modified vibe data for import
                            const existingIndex = window.modifiedVibeData.findIndex(v => v.id === vibe.id);
                            if (existingIndex >= 0) {
                                window.modifiedVibeData[existingIndex].image = vibe.image;
                                window.modifiedVibeData[existingIndex].type = 'base64';
                            } else {
                                window.modifiedVibeData.push({
                                    id: vibe.id,
                                    image: vibe.image,
                                    type: 'base64'
                                });
                            }
                        } catch (error) {
                            showError('Failed to process source image: ' + error.message);
                        }
                    }
                };
                
                input.click();
            };
            
            buttonsContainer.appendChild(sourceButton);
        }
        
        // Only add the buttons container if there are buttons to show
        if (buttonsContainer.children.length > 0) {
            info.appendChild(buttonsContainer);
        }
        
        details.appendChild(name);
        details.appendChild(info);
        
        item.appendChild(img);
        item.appendChild(details);
        vibeBundleList.appendChild(item);
    });
    
    vibeBundlePreview.style.display = 'block';
}

// Hide vibe bundle preview
function hideVibeBundlePreview() {
    const vibeBundlePreview = document.getElementById('unifiedUploadVibeBundlePreview');
    if (vibeBundlePreview) {
        vibeBundlePreview.style.display = 'none';
    }
}

// Hide mode selector buttons
function hideModeSelector() {
    const modeSelector = document.querySelector('.unified-upload-mode-selector');
    if (modeSelector) {
        modeSelector.style.display = 'none';
    }
}

// Show mode selector buttons
function showModeSelector() {
    const modeSelector = document.querySelector('.unified-upload-mode-selector');
    if (modeSelector) {
        modeSelector.style.display = '';
    }
}

// Update UI for vibe bundle import
function updateUIForVibeBundleImport(vibeCount, isBundle) {
    const modalTitle = document.getElementById('unifiedUploadModalTitle');
    const confirmText = document.getElementById('unifiedUploadConfirmText');
    
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="nai-import"></i> Import Vibe Bundle';
    }
    
    if (confirmText) {
        confirmText.textContent = 'Import Bundle';
    }
}

// Handle invalid bundle
function handleInvalidBundle(backgroundImage) {
    backgroundImage.src = '/background.jpg';
    // Invalid bundle handling - could show toast notification instead
    console.warn('Invalid vibe bundle format');
}

// Reset upload modal to default state
function resetUploadModal() {
    const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
    if (backgroundImage) {
        backgroundImage.src = '/background.jpg';
    }
    
    const modalTitle = document.getElementById('unifiedUploadModalTitle');
    const confirmText = document.getElementById('unifiedUploadConfirmText');
    
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="nai-import"></i> Upload & Encode';
    }
    if (confirmText) {
        confirmText.textContent = 'Upload';
    }
    
    hideVibeBundlePreview();
    showModeSelector();
}

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
            await handleUnifiedUploadFileChange();
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
    if (closeVibeEncodingBtn) closeVibeEncodingBtn.addEventListener('click', async () => await hideVibeEncodingModal());
    if (vibeEncodingCancelBtn) vibeEncodingCancelBtn.addEventListener('click', async () => await hideVibeEncodingModal());
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
                        backgroundImage.src = '/background.jpg';
                    }
                }
            } else {
                // Reset to placeholder if no file selected
                const backgroundImage = document.getElementById('vibeEncodingBackgroundImage');
                if (backgroundImage) {
                    backgroundImage.src = '/background.jpg';
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