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
const manualImg2ImgGroup = document.getElementById('manualImg2ImgGroup');
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
const unifiedUploadOpenInEditorBtn = document.getElementById('unifiedUploadOpenInEditorBtn');
const unifiedUploadConfirmBtn = document.getElementById('unifiedUploadConfirmBtn');
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
const unifiedUploadBackgroundImage = document.getElementById('unifiedUploadBackgroundImage');

// Unified Upload Workspace Selector Elements
const unifiedUploadWorkspaceDropdown = document.getElementById('unifiedUploadWorkspaceDropdown');
const unifiedUploadWorkspaceDropdownBtn = document.getElementById('unifiedUploadWorkspaceDropdownBtn');
const unifiedUploadWorkspaceDropdownMenu = document.getElementById('unifiedUploadWorkspaceDropdownMenu');
const unifiedUploadWorkspaceColorDot = document.getElementById('unifiedUploadWorkspaceColorDot');

const importModelMapping = {
    'v4full': 'v4',
    'v4-5full': 'v4_5',
    'v4curated': 'v4_cur',
    'v4-5curated': 'v4_5_cur'   
};

// Reference Browser Functions
let cacheImages = false;
let cacheCurrentPage = 1;
let cacheImagesPerPage = 20;
let cacheShowAllReferences = false;

// Toggle show all references functionality for cache browser
async function toggleShowAllReferences() {
    // Show loading overlay
    if (cacheBrowserLoadingContainer) {
        cacheBrowserLoadingContainer.classList.remove('hidden');
    }
    
    try {
        cacheShowAllReferences = !cacheShowAllReferences;
        
        // Update button state
        if (showAllReferencesBtn) {
            showAllReferencesBtn.setAttribute('data-state', cacheShowAllReferences ? 'on' : 'off');
        }
        
        // Reload images with new filter
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error toggling show all references:', error);
        showError('Failed to toggle show all references');
    } finally {
        // Hide loading overlay
        if (cacheBrowserLoadingContainer) {
            cacheBrowserLoadingContainer.classList.add('hidden');
        }
    }
}

// Combined Vibe Encoding Modal Variables
let vibeEncodingCurrentMode = null; // 'upload', 'ie', 'reference'
let vibeEncodingSelectedModel = 'v4_5';
let vibeEncodingCurrentVibeImage = null;
let vibeEncodingCurrentCacheImage = null;

// Unified Upload Modal Variables
let unifiedUploadCurrentMode = 'reference'; // 'reference', 'vibe', 'blueprint'
let unifiedUploadSelectedModel = 'v4_5';
let unifiedUploadFiles = []; // Array of selected files
let unifiedUploadCurrentIndex = 0; // Current file index
let unifiedUploadFileMetadata = []; // Array of file metadata/validation results
let unifiedUploadSelectedWorkspace = 'default'; // Selected workspace for uploads

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
    cacheBrowserLoadingContainer.classList.remove('hidden');
    cacheGalleryContainer.innerHTML = '';

    // Show the manual preview when cache browser is opened
    if (typeof showManualPreview === 'function') {
        showManualPreview();
    }
    try {
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error loading cache images:', error);
        showError('Failed to load cache images');
    } finally {
        cacheBrowserLoadingContainer.classList.add('hidden');
    }
}

function hideCacheBrowser() {
    // Hide both modal and container versions
    if (cacheBrowserContainer) {
        cacheBrowserContainer.classList.add('hidden');
    }

    // Clear active panel to show manual preview
    if (!window.innerWidth <= 1400) {
        previewSection.removeAttribute('data-active-panel');
    }
    
    // Close the manual preview when cache browser is closed
    if (typeof hideManualPreview === 'function') {
        hideManualPreview();
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
        // Show loading overlay for reference image loading
        if (cacheBrowserLoadingContainer && cacheBrowserContainer && !cacheBrowserContainer.classList.contains('hidden')) {
            cacheBrowserLoadingContainer.classList.remove('hidden');
        }
        
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
} finally {
    // Hide loading overlay for reference image loading
    if (cacheBrowserLoadingContainer && cacheBrowserContainer && !cacheBrowserContainer.classList.contains('hidden')) {
        cacheBrowserLoadingContainer.classList.add('hidden');
    }
}
}

async function loadCacheImages() {
    // Show loading overlay if cache browser is open
    if (cacheBrowserContainer && !cacheBrowserContainer.classList.contains('hidden') && cacheBrowserLoadingContainer) {
        cacheBrowserLoadingContainer.classList.remove('hidden');
    }
    
    try {
        cacheImages = await loadReferenceImages(null, cacheShowAllReferences);
    } catch (error) {
        console.error('Error loading cache images:', error);
        throw error;
    } finally {
        // Hide loading overlay
        if (cacheBrowserLoadingContainer) {
            cacheBrowserLoadingContainer.classList.add('hidden');
        }
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

    // Group images by workspace
    if (options.separateWorkspaces) {
        const workspaceGroups = {};
        images.forEach(image => {
            const workspaceId = image.workspaceId || 'default';
            if (!workspaceGroups[workspaceId]) {
                workspaceGroups[workspaceId] = [];
            }
            workspaceGroups[workspaceId].push(image);
        });

        // Get current workspace ID for comparison - check multiple sources
        let currentWorkspaceId = getCurrentWorkspaceId();
        
        // Try to get the actual current workspace from the workspace system
        // Check if we can access the activeWorkspace from workspaceUtils
        if (typeof activeWorkspace !== 'undefined' && activeWorkspace !== 'default') {
            currentWorkspaceId = activeWorkspace;
        } else if (window.cacheManagerCurrentWorkspace && window.cacheManagerCurrentWorkspace !== 'default') {
            currentWorkspaceId = window.cacheManagerCurrentWorkspace;
        }

        // Sort workspace IDs: current workspace first, then others, default last
        const workspaceIds = Object.keys(workspaceGroups).sort((a, b) => {
            if (a === currentWorkspaceId) return -1;
            if (b === currentWorkspaceId) return 1;
            if (a === 'default') return 1;
            if (b === 'default') return -1;
            return a.localeCompare(b);
        });

        workspaceIds.forEach(workspaceId => {
            const workspaceItems = workspaceGroups[workspaceId];
            const workspaceName = getWorkspaceDisplayName(workspaceId);
            
            // Create workspace container
            const workspaceContainer = document.createElement('div');
            workspaceContainer.className = 'workspace-reference-container';
            workspaceContainer.setAttribute('data-workspace-id', workspaceId);
            
            // Create workspace header logic:
            // - When show all is OFF: hide header for current workspace, show for others
            // - When show all is ON: show headers for all workspaces
            const shouldShowHeader = cacheShowAllReferences || workspaceId !== currentWorkspaceId;
            
            if (shouldShowHeader) {
                const workspaceHeader = document.createElement('div');
                workspaceHeader.className = 'workspace-reference-header';
                
                const workspaceNameSpan = document.createElement('span');
                workspaceNameSpan.className = 'workspace-reference-name';
                workspaceNameSpan.textContent = workspaceName;
                
                workspaceHeader.appendChild(workspaceNameSpan);
                workspaceContainer.appendChild(workspaceHeader);
            }
            
            // Create workspace items container
            const workspaceItemsContainer = document.createElement('div');
            workspaceItemsContainer.className = 'workspace-reference-items';
            
            // Add all items for this workspace
            workspaceItems.forEach(image => {
                const galleryItem = createItemFunction(image);
                workspaceItemsContainer.appendChild(galleryItem);
            });
            
            workspaceContainer.appendChild(workspaceItemsContainer);
            container.appendChild(workspaceContainer);
        });
    } else {
        // Display all images in order without workspace grouping
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
            img.src = '/static_images/background.jpg';
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
    baseImageBtn.type = 'button';
    baseImageBtn.className = 'btn-primary';
    baseImageBtn.innerHTML = '<i class="nai-img2img"></i>';
    baseImageBtn.title = 'Add as base image';
    baseImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addAsBaseImage(cacheImage);
    });
    
    // Create "Add as Vibe" button
    const vibeBtn = document.createElement('button');
    vibeBtn.type = 'button';
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
    
    // Create "Add as Character Reference" button
    const characterRefBtn = document.createElement('button');
    characterRefBtn.type = 'button';
    characterRefBtn.className = 'btn-primary';
    characterRefBtn.innerHTML = '<i class="nai-image-tool-line-art"></i>';
    characterRefBtn.title = 'Add as character reference';
    characterRefBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await addAsCharacterReference(cacheImage);
    });

    actionButtonsContainer.appendChild(baseImageBtn);
    actionButtonsContainer.appendChild(vibeBtn);
    actionButtonsContainer.appendChild(characterRefBtn);

    // Create management buttons container (top section)
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cache-gallery-item-buttons';
    
    // Create comment button if any vibes have comments
    if (cacheImage.vibes && cacheImage.vibes.length > 0) {
        const vibesWithComments = cacheImage.vibes.filter(vibe => vibe.comment && vibe.comment.trim() !== '');
        if (vibesWithComments.length > 0) {
            const commentBtn = document.createElement('button');
            commentBtn.type = 'button';
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
    

    // Create "Replace with Last Generated" button
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'btn-secondary btn-small';
    replaceBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    replaceBtn.title = 'Replace with last generated image';
    replaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        replaceReferenceWithLastGenerated(cacheImage);
    });
    buttonsContainer.appendChild(replaceBtn);

    // Create preview button
    if (cacheImage.hasPreview) {
        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
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
                showLightbox({ url: imageSrc });
            } else {
                showError('No image found');
            }
        });

        buttonsContainer.appendChild(previewBtn);
    }
    
    // Create "Create Director Session" button
    if (!cacheImage.isStandalone) {
        const directorBtn = document.createElement('button');
        directorBtn.type = 'button';
        directorBtn.className = 'btn-secondary btn-small';
        directorBtn.innerHTML = '<i class="xai-icon"></i>';
        directorBtn.title = 'Create director session';
        directorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            createDirectorSessionWithImage(cacheImage);
        });
        buttonsContainer.appendChild(directorBtn);
    }

    // Create vibe encode button (always show to allow adding more IEs)
    if (!cacheImage.locked) {
        const vibeEncodeBtn = document.createElement('button');
        vibeEncodeBtn.type = 'button';
        vibeEncodeBtn.className = 'btn-secondary btn-small';
        vibeEncodeBtn.innerHTML = `<i class="${cacheImage.hasVibes ? 'mdi mdi-data-matrix-plus' : 'mdi mdi-data-matrix-scan'}"></i> <span>IE</span>`;
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
    }

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

// Add image as character reference
async function addAsCharacterReference(cacheImage) {
    try {
        console.log('addAsCharacterReference called with:', cacheImage);

        if (!cacheImage || !cacheImage.hash) {
            throw new Error('Invalid cache image data');
        }

        // Create reference data directly - simple approach
        const referenceData = {
            type: 'cache',
            id: cacheImage.hash,
            url: `/cache/preview/${cacheImage.hash}.webp`,
            filename: cacheImage.filename,
            hash: cacheImage.hash
        };

        console.log('Created reference data:', referenceData);

        // Call the global setDirectorReference function
        if (typeof setDirectorReference === 'function') {
            console.log('Calling setDirectorReference with:', referenceData);
            setDirectorReference(referenceData);
            showGlassToast('success', 'Character Reference Added', 'Character reference has been set successfully');
        } else {
            throw new Error('setDirectorReference function not available');
        }

        // Close cache browser
        hideCacheBrowser();
    } catch (error) {
        console.error('Error adding character reference:', error);
        showGlassToast('error', 'Failed to Add Reference', 'Could not add character reference');
    }
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
async function refreshVibeReferencesDisplay() {
    const vibeReferencesContainer = document.getElementById('vibeReferencesContainer');
    if (!vibeReferencesContainer) return;
    
    // Get all current vibe reference items
    const vibeReferenceItems = vibeReferencesContainer.querySelectorAll('.vibe-reference-item');
    
    if (vibeReferenceItems.length > 0 && cacheImages === false) {
        await loadCacheImages();
    }

    vibeReferenceItems.forEach(item => {
        const vibeId = item.getAttribute('data-vibe-id');
        if (!vibeId) return;
        
        // Store current IE, strength, and toggle values before replacing
        const ieDropdownBtn = item.querySelector('.custom-dropdown-btn');
        const ratioInput = item.querySelector('input.vibe-reference-ratio-input');
        const toggleBtn = item.querySelector('.toggle-btn');
        
        const currentIe = ieDropdownBtn?.dataset.selectedIe || null;
        const currentStrength = ratioInput?.value || null;
        const currentToggleState = toggleBtn?.getAttribute('data-state') || 'on';
        
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
            // Create new item with preserved IE, strength, and toggle values
            const newItem = createVibeReferenceItem(vibeRef, currentIe, currentStrength, currentToggleState);
            item.parentNode.replaceChild(newItem, item);
        }
    });
}

// Function to refresh reference manager after vibe operations
async function refreshReferenceManagerAfterVibeOperation() {
    try {
        // Show loading overlay for cache browser if it's open
        if (cacheBrowserContainer && !cacheBrowserContainer.classList.contains('hidden') && cacheBrowserLoadingContainer) {
            cacheBrowserLoadingContainer.classList.remove('hidden');
        }
        
        // Show loading overlay for cache manager if it's open
        if (cacheManagerModal && cacheManagerModal.classList.contains('modal-open') && cacheManagerLoading) {
            cacheManagerLoading.classList.remove('hidden');
        }
        
        // Refresh cache images to get the latest vibe data
        await loadCacheImages();
        
        // Refresh the reference browser if it's open
        await refreshReferenceBrowserIfOpen();
        
        // Refresh vibe references display if they exist
        await refreshVibeReferencesDisplay();
    } catch (error) {
        console.error('Error refreshing reference manager after vibe operation:', error);
    } finally {
        // Hide loading overlays
        if (cacheBrowserLoadingContainer) {
            cacheBrowserLoadingContainer.classList.add('hidden');
        }
        if (cacheManagerLoading) {
            cacheManagerLoading.classList.add('hidden');
        }
    }
}

function createVibeReferenceItem(vibeRef, selectedIe = null, strength = null, toggleState = 'on') {
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
        preview.src = '/static_images/background.jpg';
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
            showLightbox({ url: imageSrc });
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

    // Create toggle button for enabling/disabling the vibe reference
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'indicator btn-secondary blur';
    toggleBtn.setAttribute('data-state', toggleState); // Use passed toggle state
    toggleBtn.innerHTML = '<i class="fas fa-power-off"></i>';
    toggleBtn.title = toggleState === 'on' ? 'Toggle vibe reference (enabled)' : 'Toggle vibe reference (disabled)';
    if (toggleState === 'off') {
        toggleBtn.classList.add('disabled');
    }
    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentState = toggleBtn.getAttribute('data-state');
        const newState = currentState === 'on' ? 'off' : 'on';
        
        toggleBtn.setAttribute('data-state', newState);
        if (newState === 'on') {
            toggleBtn.title = 'Toggle vibe reference (enabled)';
            toggleBtn.classList.remove('disabled');
        } else {
            toggleBtn.title = 'Toggle vibe reference (disabled)';
            toggleBtn.classList.add('disabled');
        }
    });
    controls.appendChild(toggleBtn);

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
    ieDropdownMenu.className = 'custom-dropdown-menu hidden';

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
            ieDropdownMenu.classList.add('hidden');
        });

        ieDropdownMenu.appendChild(option);
    });
    
    // Add "Request New IE" option if no encodings available for current model
    if (availableEncodings.length === 0 && allEncodings.length > 0) {
        const requestOption = document.createElement('div');
        requestOption.className = 'custom-dropdown-option missing-ie';
        requestOption.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>${(parseFloat(selectedIe) * 100).toFixed(0)}%</span>`;
        
        requestOption.addEventListener('click', async () => {
            ieDropdownMenu.classList.add('hidden');
            
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
        if (ieDropdownMenu.classList.contains('hidden')) {
            ieDropdownMenu.classList.remove('hidden');
        } else {
            ieDropdownMenu.classList.add('hidden');
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!ieDropdown.contains(e.target)) {
            ieDropdownMenu.classList.add('hidden');
        }
    });

    ieDropdown.appendChild(ieDropdownBtn);
    ieDropdown.appendChild(ieDropdownMenu);
    ieControl.appendChild(ieDropdown);

    // Ratio Control
    const ratioControl = document.createElement('div');
    ratioControl.className = 'vibe-reference-ratio-control';

    const ratioInputContainer = document.createElement('div');
    ratioInputContainer.className = 'percentage-input-container hover-show colored vibe-reference-ratio-input right';

    const ratioInput = document.createElement('input');
    ratioInput.type = 'number';
    ratioInput.className = 'form-control vibe-reference-ratio-input right';
    ratioInput.min = '-1.00';
    ratioInput.max = '1.00';
    ratioInput.step = '0.01';
    ratioInput.value = strength !== null ? parseFloat(strength).toFixed(2) || '0.70' : '0.70';

    // Create percentage overlay
    const ratioOverlay = document.createElement('span');
    ratioOverlay.className = 'percentage-input-overlay';
    const currentValue = strength !== null ? parseFloat(strength) || 0.7 : 0.7;
    ratioOverlay.textContent = `${(currentValue * 100).toFixed(0)}%`;

    // Add wheel event for scrolling
    ratioInput.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.01 : 0.01;
        const newValue = Math.max(-1, Math.min(1, parseFloat(this.value) + delta));
        this.value = newValue.toFixed(2);
        ratioOverlay.textContent = `${(newValue * 100).toFixed(0)}%`;
        if (this.value < 0 && !this.parentElement.classList.contains('negative-value')) {
            this.parentElement.classList.add('negative-value');
        } else if (this.value >= 0 && this.parentElement.classList.contains('negative-value')) {
            this.parentElement.classList.remove('negative-value');
        }
    });

    // Add input event to update overlay
    ratioInput.addEventListener('input', function() {
        const value = parseFloat(this.value) || 0;
        ratioOverlay.textContent = `${(value * 100).toFixed(0)}%`;
        if (this.value < 0 && !this.parentElement.classList.contains('negative-value')) {
            this.parentElement.classList.add('negative-value');
        } else if (this.value >= 0 && this.parentElement.classList.contains('negative-value')) {
            this.parentElement.classList.remove('negative-value');
        }
    });

    ratioInputContainer.appendChild(ratioOverlay);
    ratioInputContainer.appendChild(ratioInput);
    ratioControl.appendChild(ratioInputContainer);

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

        // Add to vibe references container with default IE and strength values
        await addVibeReferenceToContainer(vibeRef.id, vibeRef.ie || 'default', 0.7);

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

    if (cacheImages === false) {
        await loadCacheImages();
    }

    // First, try to find the vibe reference in the cacheImages array
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

    // If not found in cacheImages, make WebSocket request
    if (!vibeRef) {
        try {
            const response = await wsClient.getReferencesByIds([{ type: 'vibe', id: vibeId }]);
            
            if (!response.success || !response.data || !response.data.references || response.data.references.length === 0) {
                console.error(`Vibe reference with ID ${vibeId} not found on server`);
                return;
            }

            vibeRef = response.data.references[0].data;
        } catch (error) {
            console.error(`Error getting vibe reference ${vibeId} from server:`, error);
            showError('Failed to get vibe reference from server');
            return;
        }
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
        vibeReferencesContainer.classList.remove('hidden');
        if (vibeNormalizeToggle) {
            vibeNormalizeToggle.classList.remove('hidden');
        }
        if (transformationRow) {
            transformationRow.classList.add('display-vibe');
        }

        // Update transformation dropdown button active state based on vibe presence
        updateTransformationDropdownForVibes();
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
                vibeReferencesContainer.classList.add('hidden');
            }
            if (transformationRow) {
                transformationRow.classList.remove('display-vibe');
            }
            if (vibeNormalizeToggle) {
                vibeNormalizeToggle.classList.add('hidden');
            }
        }
    }

    // Update transformation dropdown button active state based on vibe presence
    updateTransformationDropdownForVibes();
}

// Function to update transformation dropdown button active state based on vibe presence
function updateTransformationDropdownForVibes() {
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
        // Set the uploaded image data with temporary dimensions
        window.uploadedImageData = {
            image_source: `cache:${cacheImage.hash}`,
            width: 0, // Will be updated when image loads
            height: 0,
            bias: 2, // Reset bias to center (2)
            isBiasMode: true,
            isClientSide: 2
        };

        // Load actual image dimensions
        const previewUrl = `/cache/preview/${cacheImage.hash}.webp`;
        await new Promise((resolve) => {
            const tempImg = new Image();
            tempImg.onload = () => {
                window.uploadedImageData.width = tempImg.width;
                window.uploadedImageData.height = tempImg.height;
                resolve();
            };
            tempImg.onerror = () => {
                console.warn('Failed to load cache image dimensions, using defaults');
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
        if (manualImg2ImgGroup) manualImg2ImgGroup.classList.remove('hidden');

        // Update image bias - reset to center (2)
        if (imageBiasHidden != null) imageBiasHidden.value = '2';
        renderImageBiasDropdown('2');
        
        // Update image bias orientation after setting image dimensions
        updateImageBiasOrientation();

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
        
        // Ensure reference manager is refreshed after delete operation
        await refreshReferenceManagerAfterVibeOperation();

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
        if (!cacheBrowserContainer.classList.contains('hidden')) {
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
    // Disable on mobile displays
    if (window.innerWidth <= 577) {
        return false;
    }
    
    closeSubMenu();
    
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
    
    if (!cacheBrowserContainer.classList.contains('hidden')) {
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

        const workspaceColor = workspace.color || '#102040';

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
        onWorkspaceChange: async (workspace) => {
            if (workspace.id !== cacheManagerCurrentWorkspace) {
                // Show loading overlay for workspace change
                if (cacheManagerLoading) cacheManagerLoading.classList.remove('hidden');
                
                try {
                    cacheManagerCurrentWorkspace = workspace.id;
                    await loadCacheManagerImages();
                    if (cacheManagerWorkspaceSelected) {
                        cacheManagerWorkspaceSelected.textContent = workspace.name;
                    }
                } catch (error) {
                    console.error('Error changing workspace:', error);
                    showError('Failed to change workspace');
                } finally {
                    // Hide loading overlay
                    if (cacheManagerLoading) cacheManagerLoading.classList.add('hidden');
                }
            }
        }
    });
}

// Setup unified upload workspace dropdown
function setupUnifiedUploadWorkspaceDropdown() {
    setupWorkspaceDropdown({
        dropdown: unifiedUploadWorkspaceDropdown,
        button: unifiedUploadWorkspaceDropdownBtn,
        menu: unifiedUploadWorkspaceDropdownMenu,
        selected: () => unifiedUploadSelectedWorkspace,
        getCurrentWorkspace: () => unifiedUploadSelectedWorkspace,
        onWorkspaceChange: (workspace) => {
            unifiedUploadSelectedWorkspace = workspace.id;
            if (unifiedUploadWorkspaceColorDot) {
                const workspaceColor = workspace.color || '#6366f1';
                unifiedUploadWorkspaceColorDot.style.backgroundColor = workspaceColor;
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
    if (cacheManagerLoading) cacheManagerLoading.classList.remove('hidden');
    if (cacheManagerGallery) cacheManagerGallery.innerHTML = '';

    try {
        const images = await loadReferenceImages(cacheManagerCurrentWorkspace, false);
        cacheManagerImages = images;
        displayCacheManagerImages();
    } catch (error) {
        console.error('Error loading cache manager images:', error);
        showError('Failed to load cache images');
    } finally {
        if (cacheManagerLoading) cacheManagerLoading.classList.add('hidden');
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
            img.src = '/static_images/background.jpg';
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
    moveBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-folder-move"></i>';
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
                showLightbox({ url: imageSrc });
            } else {
                showError('No image found');
            }
        });
        buttonsContainerBottom.appendChild(previewBtn);
    }

    if (!cacheImage.locked) {
        // Create vibe encode button (always show to allow adding more IEs)
        const vibeBtn = document.createElement('button');
        vibeBtn.className = 'btn-secondary btn-small';
        vibeBtn.innerHTML = `<i class="${cacheImage.hasVibes ? 'mdi mdi-data-matrix-plus' : 'mdi mdi-data-matrix-scan'}"></i>`;
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
    }

    if (!cacheImage.isStandalone) {
        // Create director session button
        const directorBtn = document.createElement('button');
        directorBtn.className = 'btn-secondary btn-small';
        directorBtn.innerHTML = '<i class="xai-icon"></i>';
        directorBtn.title = 'Create director session';
        directorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            createDirectorSessionWithImage(cacheImage);
        });
        buttonsContainerBottom.appendChild(directorBtn);
    }

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
        if (!cacheBrowserContainer.classList.contains('hidden')) {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        displayCacheManagerImages();
        await refreshReferenceBrowserIfOpen();
    });
}



// Gallery Move Right Panel Cover Control Functions
function showGalleryMoveRightPanelCover(message = 'Processing upload...') {
    const cover = document.getElementById('galleryMoveRightPanelCover');
    if (cover) {
        const textElement = cover.querySelector('.cover-text');
        if (textElement) {
            textElement.textContent = message;
        }
        cover.classList.add('show');
    }
}

function hideGalleryMoveRightPanelCover() {
    const cover = document.getElementById('galleryMoveRightPanelCover');
    if (cover) {
        cover.classList.remove('show');
    }
}

// Unified Upload Modal Functions
function showUnifiedUploadModal() {
    if (!unifiedUploadModal) return;

    // Reset form
    if (unifiedUploadIeInput) unifiedUploadIeInput.value = '0.35';
    if (unifiedUploadConfirmBtn) {
        unifiedUploadConfirmBtn.disabled = true;
        unifiedUploadConfirmBtn.innerHTML = '<span id="unifiedUploadConfirmText">Upload</span> <i class="fas fa-upload"></i>';
    }
    
    // Reset modal title to initial state
    const modalTitle = document.getElementById('unifiedUploadModalTitle');
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="nai-import"></i> Import File';
    }
    
    // Reset downloaded file state
    unifiedUploadDownloadedFile = null;
    
    // Reset pending URL state
    unifiedUploadPendingUrl = null;
    
    // Hide downloaded file info section
    const downloadedInfo = document.getElementById('unifiedUploadDownloadedInfo');
    if (downloadedInfo) {
        downloadedInfo.classList.add('hidden');
    }
    
    // Reset comment input
    const commentInput = document.getElementById('unifiedUploadCommentInput');
    if (commentInput) commentInput.value = '';
    
    // Reset mode to reference
    unifiedUploadCurrentMode = 'reference';
    
    // Reset UI elements
    hideModeSelector();
    hideVibeBundlePreview();
    hideBlueprintPreview();
    resetUploadModal();
    updateUnifiedUploadMode();
    
    // Reset files array
    unifiedUploadFiles = [];
    unifiedUploadCurrentIndex = 0;
    unifiedUploadFileMetadata = [];
    
    // Show initial upload options
    showInitialUploadOptions();
    
    // Setup workspace dropdown
    setupUnifiedUploadWorkspaceDropdown();
    
    // Set default workspace - use cache manager workspace if available, otherwise current workspace
    if (typeof cacheManagerCurrentWorkspace !== 'undefined' && cacheManagerCurrentWorkspace) {
        unifiedUploadSelectedWorkspace = cacheManagerCurrentWorkspace;
    } else if (typeof activeWorkspace !== 'undefined' && activeWorkspace) {
        unifiedUploadSelectedWorkspace = activeWorkspace;
    } else {
        unifiedUploadSelectedWorkspace = 'default';
    }
    
    // Update workspace color dot
    if (unifiedUploadWorkspaceColorDot && typeof workspaces !== 'undefined' && workspaces) {
        const workspace = workspaces[unifiedUploadSelectedWorkspace];
        if (workspace) {
            const workspaceColor = workspace.color || '#6366f1';
            unifiedUploadWorkspaceColorDot.style.backgroundColor = workspaceColor;
        }
    }
    
    // Hide comment input container initially
    const commentContainer = document.getElementById('unifiedUploadCommentInputContainer');
    if (commentContainer) {
        commentContainer.classList.add('hidden');
    }
    
    // Hide footer actions initially
    const footerActions = document.querySelector('.gallery-move-actions');
    if (footerActions) {
        footerActions.classList.add('hidden');
    }
    
    // Hide Open in Editor button initially
    if (unifiedUploadOpenInEditorBtn) {
        unifiedUploadOpenInEditorBtn.classList.add('hidden');
    }
    
    // Reset overlay content
    resetUploadOverlay();
    
    // Populate model dropdown
    populateUnifiedUploadModelDropdown();
    
    // Open modal
    openModal(unifiedUploadModal);
}

function hideUnifiedUploadModal() {
    if (unifiedUploadModal) {
        // Hide cover overlay when closing modal
        hideGalleryMoveRightPanelCover();
        
        // Close the modal
        closeModal(unifiedUploadModal);

        // Reset all state before closing
        unifiedUploadDownloadedFile = null;
        unifiedUploadPendingUrl = null;
        unifiedUploadFiles = [];
        unifiedUploadCurrentIndex = 0;
        unifiedUploadFileMetadata = [];
        unifiedUploadCurrentMode = 'reference';
        
        // Reset UI elements
        hideModeSelector();
        hideVibeBundlePreview();
        hideBlueprintPreview();
        
        // Reset overlay content
        resetUploadOverlay();
        
        // Reset background image
        const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
        if (backgroundImage) {
            backgroundImage.src = '/static_images/background.jpg';
        }
        
        // Hide Open in Editor button
        if (unifiedUploadOpenInEditorBtn) {
            unifiedUploadOpenInEditorBtn.classList.add('hidden');
        }
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
    
    // Update mode display only when we have files or are in a specific mode
    if (unifiedUploadModeDisplay) {
        // Only update mode display if we have files or are in a specific mode
        if (unifiedUploadFiles.length > 0 || unifiedUploadDownloadedFile || unifiedUploadPendingUrl) {
            if (unifiedUploadCurrentMode === 'reference') {
                unifiedUploadModeDisplay.textContent = 'Upload Reference';
            } else if (unifiedUploadCurrentMode === 'vibe') {
                // Check if we have vibe files for import or images for encoding
                const hasVibeFilesForImport = unifiedUploadFileMetadata.some(meta =>
                    meta.valid && meta.metadata &&
                    (meta.metadata.type === 'vibe_bundle' || meta.metadata.type === 'vibe_single')
                ) || (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single'));
                unifiedUploadModeDisplay.textContent = hasVibeFilesForImport ? 'Import Vibe File' : 'Upload & Encode';
            } else if (unifiedUploadCurrentMode === 'blueprint') {
                unifiedUploadModeDisplay.textContent = 'Import Image';
            }
        } else {
            // In initial state, show default text
            unifiedUploadModeDisplay.textContent = 'Import File';
        }
    }
    
    // Update modal title only when we have files or are in a specific mode
    if (unifiedUploadModalTitle) {
        // Only update title if we have files or are in a specific mode
        if (unifiedUploadFiles.length > 0 || unifiedUploadDownloadedFile || unifiedUploadPendingUrl) {
            if (unifiedUploadCurrentMode === 'reference') {
                unifiedUploadModalTitle.innerHTML = '<i class="nai-img2img"></i> <span>Upload Reference</span>';
            } else if (unifiedUploadCurrentMode === 'vibe') {
                // Check if we have vibe files for import or images for encoding
                const hasVibeFilesForImport = unifiedUploadFileMetadata.some(meta =>
                    meta.valid && meta.metadata &&
                    (meta.metadata.type === 'vibe_bundle' || meta.metadata.type === 'vibe_single')
                ) || (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single'));
                const title = hasVibeFilesForImport ? 'Import Vibe File' : 'Encode Vibe';
                const icon = hasVibeFilesForImport ? 'nai-import' : 'mdi mdi-data-matrix';
                unifiedUploadModalTitle.innerHTML = `<i class="${icon}"></i> <span>${title}</span>`;
            } else if (unifiedUploadCurrentMode === 'blueprint') {
                unifiedUploadModalTitle.innerHTML = '<i class="nai-import"></i> <span>Import Image</span>';
            }
        }
        // If no files and no specific mode, keep the default "Import File" title
    }
    
    // Update confirm button text and state
    if (unifiedUploadConfirmText) {
        if (unifiedUploadCurrentMode === 'reference') {
            unifiedUploadConfirmText.textContent = 'Upload';
        } else if (unifiedUploadCurrentMode === 'vibe') {
            // Check if we have vibe files for import or images for encoding
            const hasVibeFilesForImport = unifiedUploadFileMetadata.some(meta =>
                meta.valid && meta.metadata &&
                (meta.metadata.type === 'vibe_bundle' || meta.metadata.type === 'vibe_single')
            ) || (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single'));
            unifiedUploadConfirmText.textContent = hasVibeFilesForImport ? 'Import' : 'Encode';
        } else if (unifiedUploadCurrentMode === 'blueprint') {
            unifiedUploadConfirmText.textContent = 'Import';
        }
    }
    
    // Update confirm button state (enabled/disabled)
    if (unifiedUploadConfirmBtn) {
        // Enable button if we have files OR a downloaded file OR a pending URL
        const hasFiles = unifiedUploadFiles.length > 0;
        const hasDownloadedFile = unifiedUploadDownloadedFile !== null;
        const hasPendingUrl = unifiedUploadPendingUrl !== null;
        
        unifiedUploadConfirmBtn.disabled = !(hasFiles || hasDownloadedFile || hasPendingUrl);
    }
    
    // Show/hide vibe controls - only show when encoding images, not when importing vibe files
    if (vibeControls) {
        // Check if we have vibe files selected for import (not encoding)
        const hasVibeFilesForImport = unifiedUploadFileMetadata.some(meta =>
            meta.valid && meta.metadata &&
            (meta.metadata.type === 'vibe_bundle' || meta.metadata.type === 'vibe_single')
        ) || (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single'));

        if (unifiedUploadCurrentMode === 'vibe' && !hasVibeFilesForImport) {
            // Show controls only when encoding images (no vibe files for import)
            vibeControls.classList.remove('hide');
            vibeControls.classList.add('show');
        } else {
            // Hide controls when importing vibe files or not in vibe mode
            vibeControls.classList.remove('show');
            vibeControls.classList.add('hide');
        }
    }
    
    // Show/hide blueprint info based on mode
    const blueprintPreview = document.getElementById('unifiedUploadBlueprintPreview');
    if (blueprintPreview) {
        if (unifiedUploadCurrentMode === 'blueprint') {
            blueprintPreview.classList.remove('hidden');
        } else {
            blueprintPreview.classList.add('hidden');
        }
    }
    
    // Show/hide reference comment based on mode
    const referenceComment = document.getElementById('unifiedUploadCommentInputContainer');
    if (referenceComment) {
        if (unifiedUploadCurrentMode === 'blueprint') {
            referenceComment.classList.add('hidden');
        } else if (unifiedUploadCurrentMode === 'vibe') {
            // Check if we have vibe files for import (show comment) or images for encoding (hide comment)
            const hasVibeFilesForImport = unifiedUploadFileMetadata.some(meta =>
                meta.valid && meta.metadata &&
                (meta.metadata.type === 'vibe_bundle' || meta.metadata.type === 'vibe_single')
            ) || (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single'));
            if (hasVibeFilesForImport) {
                referenceComment.classList.remove('hidden');
            } else {
                referenceComment.classList.add('hidden');
            }
        } else {
            referenceComment.classList.remove('hidden');
        }
    }
    
    // Show/hide Open in Editor button based on mode
    if (unifiedUploadOpenInEditorBtn) {
        if (unifiedUploadCurrentMode === 'blueprint') {
            unifiedUploadOpenInEditorBtn.classList.remove('hidden');
        } else {
            unifiedUploadOpenInEditorBtn.classList.add('hidden');
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
    
    // Show cover overlay to indicate processing
    showGalleryMoveRightPanelCover('Processing...');
    
    // Check if we have a pending URL download
    if (unifiedUploadPendingUrl) {
        await handlePendingUrlDownload();
        return;
    }
    
    // Check if we have either files or a downloaded file
    if (!unifiedUploadFiles.length && !unifiedUploadDownloadedFile) {
        hideGalleryMoveRightPanelCover();
        showError('Please select an image file or download from clipboard');
        return;
    }
    
    // Add validation for vibe mode
    if (unifiedUploadCurrentMode === 'vibe' && unifiedUploadFiles.length > 1) {
        hideGalleryMoveRightPanelCover();
        showError('Vibe encoding only supports single file upload. Please select only one image.');
        return;
    }
    
    // If we have a downloaded file, skip file validation and proceed directly
    // Downloaded files are already validated on the server side
    if (!unifiedUploadDownloadedFile) {
        // Validate file types - accept images, JSON files, and .naiv4vibe/.naiv4vibebundle files
        const invalidFiles = unifiedUploadFiles.filter(file => {
            const isImage = file.type.startsWith('image/');
            const isJson = file.type === 'application/json';
            const fileName = file.name.toLowerCase();
            const isNaiv4File = fileName.includes('.naiv4vibe') || fileName.includes('.naiv4vibebundle');
            return !isImage && !isJson && !isNaiv4File;
        });
        if (invalidFiles.length > 0) {
            hideGalleryMoveRightPanelCover();
            showError('Please select valid image files, JSON files, or .naiv4vibe/.naiv4vibebundle files only.');
            return;
        }

        // Check if any JSON files or .naiv4vibe/.naiv4vibebundle files are selected
        const vibeFiles = unifiedUploadFiles.filter(file => {
            const fileNameLower = file.name.toLowerCase();
            return file.type === 'application/json' || fileNameLower.includes('.naiv4vibe') || fileNameLower.includes('.naiv4vibebundle');
        });
        if (vibeFiles.length > 0) {
            // Handle vibe file import (unified system handles both bundle and single files)
            await handleJsonFileImport(vibeFiles);
            return;
        }
        
        // For blueprint mode, filter to only valid files
        if (unifiedUploadCurrentMode === 'blueprint') {
            if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.type === 'image') {
                // Handle downloaded file for blueprint import
                await importUnifiedBlueprint(null);
                hideUnifiedUploadModal();
                return;
            }
            
            const validFiles = [];
            const validMetadata = [];
            
            unifiedUploadFiles.forEach((file, index) => {
                if (unifiedUploadFileMetadata[index]?.valid) {
                    validFiles.push(file);
                    validMetadata.push(unifiedUploadFileMetadata[index]);
                }
            });
            
            if (validFiles.length === 0) {
                hideGalleryMoveRightPanelCover();
                showError('None of the selected images contain valid NovelAI metadata.');
                return;
            }
            
            // Process only valid files for blueprints
            for (const file of validFiles) {
                await importUnifiedBlueprint(file);
            }
            hideUnifiedUploadModal();
            return;
        }
    }

    try {
        if (unifiedUploadCurrentMode === 'reference') {
            // Upload as reference images
            await uploadUnifiedReferenceImages();
        } else if (unifiedUploadCurrentMode === 'vibe') {
            // Handle vibe files (import, not encode)
            if (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single')) {
                // Handle downloaded vibe file import (unified system handles both bundle and single)
                await importDownloadedVibeBundle();
            } else {
                // Handle locally selected vibe files - import them
                await importUnifiedVibeFiles();
            }
        } else if (unifiedUploadCurrentMode === 'blueprint') {
            // Handle blueprint import
            if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.type === 'image') {
                // Handle downloaded file for blueprint import
                await importUnifiedBlueprint(null);
            } else if (unifiedUploadFiles.length > 0) {
                // Handle uploaded files for blueprint import
                const validFiles = [];
                const validMetadata = [];
                
                unifiedUploadFiles.forEach((file, index) => {
                    if (unifiedUploadFileMetadata[index]?.valid) {
                        validFiles.push(file);
                        validMetadata.push(unifiedUploadFileMetadata[index]);
                    }
                });
                
                if (validFiles.length === 0) {
                    hideGalleryMoveRightPanelCover();
                    showError('None of the selected images contain valid NovelAI metadata.');
                    return;
                }
                
                // Process only valid files for blueprints
                for (const file of validFiles) {
                    await importUnifiedBlueprint(file);
                }
            } else {
                hideGalleryMoveRightPanelCover();
                showError('No valid blueprint files found.');
                return;
            }
            hideUnifiedUploadModal();
        }
        hideGalleryMoveRightPanelCover();
    } catch (error) {
        console.error('Error in unified upload:', error);
        hideGalleryMoveRightPanelCover();
        showError('Upload failed: ' + error.message);
    }
}

async function handleUnifiedUploadOpenInEditor() {
    try {
        let metadata = null;
        
        if (unifiedUploadCurrentMode === 'blueprint') {
            // Get metadata from current file
            if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.type === 'image') {
                // For URL uploads, check if we already have the metadata
                if (unifiedUploadDownloadedFile.metadata && unifiedUploadDownloadedFile.isBlueprint) {
                    metadata = unifiedUploadDownloadedFile.metadata;
                } else if (unifiedUploadDownloadedFile.filename) {
                    // Fallback: get metadata from server
                    try {
                        metadata = await window.wsClient.requestUrlUploadMetadata(unifiedUploadDownloadedFile.filename);
                    } catch (error) {
                        console.error('Failed to get URL upload metadata:', error);
                        showError('Failed to get image metadata for editor');
                        return;
                    }
                }
            } else if (unifiedUploadFiles.length > 0) {
                // For file uploads, try to get metadata from multiple sources
                let currentMetadata = null;
                // First try to get from unifiedUploadFileMetadata array
                if (unifiedUploadFileMetadata.length > 0 && unifiedUploadCurrentIndex < unifiedUploadFileMetadata.length) {
                    currentMetadata = unifiedUploadFileMetadata[unifiedUploadCurrentIndex];
                    if (currentMetadata && currentMetadata.valid && currentMetadata.metadata) {
                        metadata = currentMetadata.metadata;
                    }
                }
                
                // Check if there's metadata in the window object (from blueprint processing)
                if (!metadata && window.currentBlueprintMetadata) {
                    metadata = window.currentBlueprintMetadata;
                }
                
                // If no metadata found, try to extract it from the current file
                if (!metadata && unifiedUploadFiles[unifiedUploadCurrentIndex]) {
                    try {
                        const currentFile = unifiedUploadFiles[unifiedUploadCurrentIndex];
                        metadata = await extractPNGMetadata(currentFile);
                        
                        // Check if it's a valid NovelAI image
                        if (!metadata || !metadata.source || !metadata.source.includes('NovelAI')) {
                            throw new Error('No NovelAI metadata found in file');
                        }
                    } catch (error) {
                        console.error('Failed to extract metadata from file:', error);
                        showError('Failed to extract metadata from file: ' + error.message);
                        return;
                    }
                }
            }
            
            if (!metadata) {
                showError('No valid metadata found to open in editor');
                return;
            }

            // Prepare image data for preview
            let imageData = null;
            let finalMetadata = metadata;
            
            if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.type === 'image') {
                // For URL uploads, transform raw metadata to the format expected by the manual form
                // The raw metadata has fields nested under metadata.forge_data, metadata.v4_prompt, etc.
                finalMetadata = transformRawMetadataForEditor(metadata);
                
                imageData = {
                    filename: unifiedUploadDownloadedFile.originalFilename || 'downloaded_image.png',
                    tempFilename: unifiedUploadDownloadedFile.tempFilename,
                    isTempFile: true, // Flag to indicate this is not a saved file
                    width: metadata.width || 1024,
                    height: metadata.height || 1024
                };
            } else if (unifiedUploadFiles.length > 0 && unifiedUploadFiles[unifiedUploadCurrentIndex]) {
                // For file uploads, transform metadata to the format expected by the manual form
                finalMetadata = transformMetadataForEditor(metadata);
                
                const currentFile = unifiedUploadFiles[unifiedUploadCurrentIndex];
                imageData = {
                    filename: currentFile.name,
                    file: currentFile,
                    isTempFile: true, // Flag to indicate this is not a saved file
                    width: metadata.width || 1024,
                    height: metadata.height || 1024
                };
            }
            
            // Close upload modal
            hideUnifiedUploadModal();
            
            // Open manual modal directly without img2img functionality
            // This is a blueprint edit, not an image variation edit
            window.showManualModal();
            
            // Load the blueprint metadata into the manual form
            await window.loadIntoManualForm(finalMetadata);

        } else {
            showError('Open in Editor is only available for blueprint mode');
        }
    } catch (error) {
        console.error('Error opening in editor:', error);
        showError('Failed to open in editor: ' + error.message);
    }
}

// Transform raw metadata from server to the format expected by the manual form
function transformRawMetadataForEditor(metadata) {
    // Create a copy of the metadata to avoid modifying the original
    const transformed = { ...metadata };
    
    // Extract fields from the nested structure
    if (metadata.forge_data) {
        const forgeData = metadata.forge_data;

        // Handle character prompts from forge_data
        if (forgeData.allCharacters && Array.isArray(forgeData.allCharacters)) {
            transformed.allCharacterPrompts = forgeData.allCharacters;

            // Check if any character has valid coordinates to determine use_coords
            const hasValidCoords = forgeData.allCharacters.some(char =>
                char.center &&
                char.center.x !== null &&
                char.center.y !== null &&
                (char.center.x !== 0.5 || char.center.y !== 0.5)
            );
            transformed.use_coords = hasValidCoords || forgeData.use_coords || false;
        }

        // Extract basic fields
        if (forgeData.input_prompt !== undefined) {
            transformed.prompt = forgeData.input_prompt;
        }
        if (forgeData.input_uc !== undefined) {
            transformed.uc = forgeData.input_uc;
        }
        if (forgeData.append_quality !== undefined) {
            transformed.append_quality = forgeData.append_quality;
        }
        if (forgeData.append_uc !== undefined) {
            transformed.append_uc = forgeData.append_uc;
        }
        if (forgeData.dataset_config !== undefined) {
            transformed.dataset_config = forgeData.dataset_config;
        }
        if (forgeData.vibe_transfer !== undefined) {
            transformed.vibe_transfer = forgeData.vibe_transfer;
        }
        if (forgeData.normalize_vibes !== undefined) {
            transformed.normalize_vibes = forgeData.normalize_vibes;
        }
        if (forgeData.image_source !== undefined) {
            transformed.image_source = forgeData.image_source;
        }
        if (forgeData.image_bias !== undefined) {
            transformed.image_bias = forgeData.image_bias;
        }
        if (forgeData.mask_compressed !== undefined) {
            transformed.mask_compressed = forgeData.mask_compressed;
        }
        if (forgeData.mask_bias !== undefined) {
            transformed.mask_bias = forgeData.mask_bias;
        }
        if (forgeData.chara_reference_source !== undefined) {
            transformed.chara_reference_source = forgeData.chara_reference_source;
        }
        if (forgeData.chara_reference_with_style !== undefined) {
            transformed.chara_reference_with_style = forgeData.chara_reference_with_style;
        }
        if (forgeData.img2img_strength !== undefined) {
            transformed.strength = forgeData.img2img_strength;
        }
        if (forgeData.img2img_noise !== undefined) {
            transformed.noise = forgeData.img2img_noise;
        }
        if (forgeData.layer1_seed !== undefined) {
            transformed.layer1_seed = forgeData.layer1_seed;
            transformed.layer2_seed = forgeData.layer2_seed;
        }
        
        // Extract character prompts
        if (forgeData.allCharacters && Array.isArray(forgeData.allCharacters)) {
            // Transform the allCharacters format to match what loadCharacterPrompts expects
            const characterPrompts = forgeData.allCharacters.map(character => ({
                prompt: character.prompt || character.input_prompt || '',
                uc: character.uc || character.input_uc || '',
                center: character.center || character.centers?.[0] || { x: 0.5, y: 0.5 },
                enabled: character.enabled !== false, // Default to true if not specified
                chara_name: character.chara_name || character.name || ''
            }));
            transformed.allCharacterPrompts = characterPrompts;
            transformed.use_coords = forgeData.use_coords || false;
        }
    }
    
    // Extract fields from v4_prompt if available
    if (metadata.v4_prompt && !transformed.allCharacterPrompts) {
        const v4Prompt = metadata.v4_prompt;
        
        if (v4Prompt.caption && v4Prompt.caption.char_captions) {
            const charCaptions = v4Prompt.caption.char_captions;
            if (Array.isArray(charCaptions) && charCaptions.length > 0) {
                // Process characters by index - simple and straightforward
                const characterPrompts = [];
                
                // Process positive captions by index
                charCaptions.forEach((caption, index) => {
                    if (caption.char_caption) {
                        // Only use actual coordinates if they exist and are valid
                        const center = caption.centers && Array.isArray(caption.centers) && caption.centers.length > 0
                            ? caption.centers[0]
                            : null;

                        characterPrompts.push({
                            prompt: caption.char_caption,
                            uc: '',
                            center: center,
                            enabled: true,
                            chara_name: ''
                        });
                    }
                });
                
                // Handle negative prompts if available
                if (metadata.v4_negative_prompt && metadata.v4_negative_prompt.caption && metadata.v4_negative_prompt.caption.char_captions) {
                    const negativeCaptions = metadata.v4_negative_prompt.caption.char_captions;
                    negativeCaptions.forEach((caption, index) => {
                        if (caption.char_caption && characterPrompts[index]) {
                            characterPrompts[index].uc = caption.char_caption;
                        }
                    });
                }
                
                // Set allCharacterPrompts from v4_prompt (since we don't have them from forge_data)
                transformed.allCharacterPrompts = characterPrompts;
                
                // Check if any character has valid coordinates to determine use_coords
                const hasValidCoords = characterPrompts.some(char =>
                    char.center &&
                    char.center.x !== null &&
                    char.center.y !== null &&
                    (char.center.x !== 0.5 || char.center.y !== 0.5)
                );
                transformed.use_coords = hasValidCoords || v4Prompt.use_coords || false;
            }
        }
    }
    
    // Extract other fields
    if (metadata.model) {
        transformed.model = metadata.model;
    } else if (metadata.source) {
        // Use the existing comprehensive model detection function
        const detectedModel = determineModelFromMetadata(metadata);
        if (detectedModel !== 'unknown') {
            // Convert the detected model to the format expected by the form
            switch (detectedModel) {
                case 'V4_5':
                    transformed.model = 'v4_5';
                    break;
                case 'V4_5_CUR':
                    transformed.model = 'v4_5_cur';
                    break;
                case 'V4':
                    transformed.model = 'v4';
                    break;
                case 'V4_CUR':
                    transformed.model = 'v4_cur';
                    break;
                case 'V3':
                    transformed.model = 'v3';
                    break;
                case 'FURRY':
                    transformed.model = 'v3_furry';
                    break;
                default:
                    transformed.model = 'v4_5'; // Default fallback
            }
        } else {
            transformed.model = 'v4_5'; // Default fallback
        }
    }
    
    if (metadata.sampler) {
        transformed.sampler = metadata.sampler;
    }
    if (metadata.noise_schedule) {
        transformed.noiseScheduler = metadata.noise_schedule;
    }
    if (metadata.steps) {
        transformed.steps = metadata.steps;
    }
    if (metadata.scale) {
        transformed.scale = metadata.scale;
    }
    if (metadata.seed) {
        transformed.seed = metadata.seed;
    }
    if (metadata.upscale) {
        transformed.upscale = metadata.upscale;
    }
    if (metadata.skip_cfg_above_sigma !== undefined) {
        transformed.skip_cfg_above_sigma = metadata.skip_cfg_above_sigma;
    }
    
    return transformed;
}

// Transform metadata to the format expected by the manual form
function transformMetadataForEditor(metadata) {
    // Create a copy of the metadata to avoid modifying the original
    const transformed = { ...metadata };
    
    // Map fields to match what loadIntoManualForm expects
    if (transformed.characterPrompts && Array.isArray(transformed.characterPrompts)) {
        transformed.allCharacterPrompts = transformed.characterPrompts;

        // Check if any character has valid coordinates to determine use_coords
        const hasValidCoords = transformed.characterPrompts.some(char =>
            char.center &&
            char.center.x !== null &&
            char.center.y !== null &&
            (char.center.x !== 0.5 || char.center.y !== 0.5)
        );
        transformed.use_coords = hasValidCoords || transformed.use_coords || false;
    }
    
    // Handle v4_prompt character data if available
    if (transformed.v4_prompt && transformed.v4_prompt.caption && transformed.v4_prompt.caption.char_captions) {
        const charCaptions = transformed.v4_prompt.caption.char_captions;
        if (Array.isArray(charCaptions) && charCaptions.length > 0) {
            // Process characters by index - simple and straightforward
            const characterPrompts = [];
            
            // Process positive captions by index
            charCaptions.forEach((caption, index) => {
                if (caption.char_caption) {
                    // Only use actual coordinates if they exist and are valid
                    const center = caption.centers && Array.isArray(caption.centers) && caption.centers.length > 0 
                        ? caption.centers[0] 
                        : null;
                    
                    characterPrompts.push({
                        prompt: caption.char_caption,
                        uc: '',
                        center: center,
                        enabled: true,
                        chara_name: ''
                    });
                }
            });
            
            // Handle negative prompts if available
            if (transformed.v4_negative_prompt && transformed.v4_negative_prompt.caption && transformed.v4_negative_prompt.caption.char_captions) {
                const negativeCaptions = transformed.v4_negative_prompt.caption.char_captions;
                negativeCaptions.forEach((caption, index) => {
                    if (caption.char_caption && characterPrompts[index]) {
                        characterPrompts[index].uc = caption.char_caption;
                    }
                });
            }
            
            transformed.allCharacterPrompts = characterPrompts;
            
            // Check if any character has valid coordinates to determine use_coords
            const hasValidCoords = characterPrompts.some(char =>
                char.center &&
                char.center.x !== null &&
                char.center.y !== null &&
                (char.center.x !== 0.5 || char.center.y !== 0.5)
            );
            transformed.use_coords = hasValidCoords || transformed.v4_prompt.use_coords || false;
        }
    }
    
    // Handle forge_data if available
    if (transformed.forge_data) {
        // Extract character prompts from forge data
        if (transformed.forge_data.allCharacters && Array.isArray(transformed.forge_data.allCharacters)) {
            transformed.allCharacterPrompts = transformed.forge_data.allCharacters;

            // Check if any character has valid coordinates to determine use_coords
            const hasValidCoords = transformed.forge_data.allCharacters.some(char =>
                char.center &&
                char.center.x !== null &&
                char.center.y !== null &&
                (char.center.x !== 0.5 || char.center.y !== 0.5)
            );
            transformed.use_coords = hasValidCoords || transformed.forge_data.use_coords || false;
        }
        
        // Extract other forge data fields
        if (transformed.forge_data.input_prompt !== undefined) {
            transformed.prompt = transformed.forge_data.input_prompt;
        }
        if (transformed.forge_data.input_uc !== undefined) {
            transformed.uc = transformed.forge_data.input_uc;
        }
        if (transformed.forge_data.append_quality !== undefined) {
            transformed.append_quality = transformed.forge_data.append_quality;
        }
        if (transformed.forge_data.append_uc !== undefined) {
            transformed.append_uc = transformed.forge_data.append_uc;
        }
        if (transformed.forge_data.dataset_config !== undefined) {
            transformed.dataset_config = transformed.forge_data.dataset_config;
        }
        if (transformed.forge_data.vibe_transfer !== undefined) {
            transformed.vibe_transfer = transformed.forge_data.vibe_transfer;
        }
        if (transformed.forge_data.normalize_vibes !== undefined) {
            transformed.normalize_vibes = transformed.forge_data.normalize_vibes;
        }
        if (transformed.forge_data.image_source !== undefined) {
            transformed.image_source = transformed.forge_data.image_source;
        }
        if (transformed.forge_data.image_bias !== undefined) {
            transformed.image_bias = transformed.forge_data.image_bias;
        }
        if (transformed.forge_data.mask_compressed !== undefined) {
            transformed.mask_compressed = transformed.forge_data.mask_compressed;
        }
        if (transformed.forge_data.mask_bias !== undefined) {
            transformed.mask_bias = transformed.forge_data.mask_bias;
        }
        if (transformed.forge_data.img2img_strength !== undefined) {
            transformed.strength = transformed.forge_data.img2img_strength;
        }
        if (transformed.forge_data.img2img_noise !== undefined) {
            transformed.noise = transformed.forge_data.img2img_noise;
        }
        if (transformed.forge_data.layer1_seed !== undefined) {
            transformed.layer1_seed = transformed.forge_data.layer1_seed;
            transformed.layer2_seed = transformed.seed;
        }
    }
    
    // Ensure resolution is properly set
    if (transformed.resolution) {
        transformed.resolution = transformed.resolution.toLowerCase();
    } else if (transformed.width && transformed.height) {
        // Try to determine resolution from dimensions
        if (transformed.width === 832 && transformed.height === 1216) {
            transformed.resolution = 'normal_portrait';
        } else if (transformed.width === 1216 && transformed.height === 832) {
            transformed.resolution = 'normal_landscape';
        } else if (transformed.width === 1024 && transformed.height === 1024) {
            transformed.resolution = 'normal_square';
        } else if (transformed.width === 1472 && transformed.height === 1472) {
            transformed.resolution = 'large_square';
        } else if (transformed.width === 1600 && transformed.height === 1600) {
            transformed.resolution = 'wallpaper_square';
        } else {
            transformed.resolution = 'custom';
        }
    }
    
    // Ensure model is in the correct format
    if (transformed.model) {
        // Map model names to the format expected by the form
        const modelMapping = {
            'v4': 'v4',
            'v4_5': 'v4_5',
            'v4_cur': 'v4_cur',
            'v4_5_cur': 'v4_5_cur',
            'v4full': 'v4',
            'v4-5full': 'v4_5',
            'v4curated': 'v4_cur',
            'v4-5curated': 'v4_5_cur'
        };
        
        if (modelMapping[transformed.model]) {
            transformed.model = modelMapping[transformed.model];
        }
    } else if (transformed.source) {
        // Extract model from source field if no model field exists
        const detectedModel = determineModelFromMetadata(transformed);
        if (detectedModel !== 'unknown') {
            // Convert the detected model to the format expected by the form
            switch (detectedModel) {
                case 'V4_5':
                    transformed.model = 'v4_5';
                    break;
                case 'V4_5_CUR':
                    transformed.model = 'v4_5_cur';
                    break;
                case 'V4':
                    transformed.model = 'v4';
                    break;
                case 'V4_CUR':
                    transformed.model = 'v4_cur';
                    break;
                case 'V3':
                    transformed.model = 'v3';
                    break;
                case 'FURRY':
                    transformed.model = 'v3_furry';
                    break;
                default:
                    transformed.model = 'v4_5'; // Default fallback
            }
        } else {
            transformed.model = 'v4_5'; // Default fallback
        }
    }
    
    // Ensure sampler and noise scheduler are in the correct format
    if (transformed.sampler) {
        // The form expects the meta value, not the display name
        const samplerObj = window.getSamplerMeta ? window.getSamplerMeta(transformed.sampler) : null;
        if (samplerObj) {
            transformed.sampler = samplerObj.meta;
        }
    }
    
    if (transformed.noise_schedule) {
        // The form expects the meta value, not the display name
        const noiseObj = window.getNoiseMeta ? window.getNoiseMeta(transformed.noise_schedule) : null;
        if (noiseObj) {
            transformed.noiseScheduler = noiseObj.meta;
        }
    }
    
    // Handle dataset configuration
    if (transformed.dataset_config && transformed.dataset_config.include) {
        // Ensure it's an array
        if (!Array.isArray(transformed.dataset_config.include)) {
            transformed.dataset_config.include = [transformed.dataset_config.include];
        }
    }
    
    return transformed;
}

async function importUnifiedBlueprint(file) {
    let toastId = showGlassToast('info', 'Importing Image', 'Importing image to workspace...', true, false, '<i class="nai-import"></i>');
    
    try {        
        // Update cover message for server processing
        showGalleryMoveRightPanelCover('Importing Blueprint...');
        
        let metadata = null;
        
        // Handle downloaded files differently - metadata is already available
        if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.type === 'image') {
            metadata = unifiedUploadDownloadedFile.metadata;
        } else if (file) {
            // Extract metadata from the PNG file to verify it's a NovelAI image
            metadata = await extractPNGMetadata(file);
        } else {
            throw new Error('No file provided for blueprint import');
        }
        
        if (!metadata || !metadata.source || !metadata.source.includes('NovelAI')) {
            throw new Error('Invalid blueprint file: No NovelAI metadata found');
        }
        
        // Get the selected workspace from the unified upload modal
        let targetWorkspace = unifiedUploadSelectedWorkspace;
        
        let uploadResponse;
        
        if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.type === 'image') {
            // Handle downloaded image file
            const batchInfo = {
                currentIndex: 0,
                totalCount: 1
            };
            
            uploadResponse = await wsClient.uploadWorkspaceImage(
                null, 
                targetWorkspace, 
                unifiedUploadDownloadedFile.originalFilename || 'downloaded_image', 
                batchInfo, 
                unifiedUploadDownloadedFile.tempFilename
            );
        } else if (file) {
            // Handle uploaded file
            const base64 = await fileToBase64(file);
            const batchInfo = {
                currentIndex: 0,
                totalCount: 1
            };
            uploadResponse = await wsClient.uploadWorkspaceImage(base64, targetWorkspace, file.name, batchInfo);
        } else {
            throw new Error('No file provided for blueprint import');
        }
        
        if (!uploadResponse.success) {
            throw new Error(uploadResponse.message || 'Upload failed');
        }
        
        removeGlassToast(toastId);
        showGlassToast('success', 'Image Imported', 'Successfully imported image to workspace', false, true, '<i class="nai-check"></i>');
                
        // Refresh gallery to show the new image
        await loadGallery(true);

        // Close the modal
        hideUnifiedUploadModal();
    } catch (error) {
        console.error('Error importing blueprint:', error);
        removeGlassToast(toastId);
        hideGalleryMoveRightPanelCover();
        showGlassToast('error', null, 'Blueprint import failed: ' + (error.message || 'Unknown error'));
    }
}

async function uploadUnifiedReferenceImages() {
    let toastId = showGlassToast('info', 'Uploading Images', 'Uploading reference images...', true, false, '<i class="nai-import"></i>');
    
    // Update cover message for upload
    showGalleryMoveRightPanelCover('Uploading Reference...');
    
    try {
        // Get the selected workspace from the unified upload modal
        let targetWorkspace = unifiedUploadSelectedWorkspace;
        
        let results = [];
        
        // Check if we have a downloaded file
        if (unifiedUploadDownloadedFile) {
            // For downloaded files, we need to handle them differently based on type
            if (unifiedUploadDownloadedFile.type === 'image') {
                // Use the downloaded file temp filename
                const response = await wsClient.uploadReference(null, targetWorkspace, unifiedUploadDownloadedFile.tempFilename);
                
                if (!response.success) {
                    throw new Error(response.message || 'Upload failed');
                }
                
                results.push(response);
            } else if (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single') {
                // For vibe files, we'll handle them in the vibe mode
                throw new Error('Vibe files should be imported using vibe mode, not reference mode');
            } else {
                throw new Error(`Unsupported file type for reference upload: ${unifiedUploadDownloadedFile.type}`);
            }
        } else {
            // Use the file input files
            const uploadPromises = unifiedUploadFiles.map(async (file, index) => {
                const base64 = await fileToBase64(file);
                
                const response = await wsClient.uploadReference(base64, targetWorkspace);

                if (!response.success) {
                    throw new Error(response.message || 'Upload failed');
                }
                
                return response;
            });
            
            results = await Promise.all(uploadPromises);
        }
        
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Upload Complete',
            message: `Successfully uploaded ${results.length} image(s)`,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
        

        // Refresh cache manager
        if (!cacheManagerModal.classList.contains('hidden') || !manualModal.classList.contains('hidden')) {    
            await loadCacheImages();
            await loadCacheManagerImages();
            await refreshReferenceBrowserIfOpen();
            await refreshReferenceManagerAfterVibeOperation();
        }
        
        if (!manualModal.classList.contains('hidden')) {
            // If this was uploaded as a base image (reference mode), add it to the manual form
            if (unifiedUploadCurrentMode === 'reference' && results.length > 0) {
                const uploadedHash = results[0].hash;
                if (uploadedHash) {
                    // Add as base image to the manual form
                    await addAsBaseImage({ hash: uploadedHash, type: 'cache' });
                }
            }
        }

        
        // Close modal
        hideUnifiedUploadModal();
        
    } catch (error) {
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Upload Failed',
            message: 'Upload failed: ' + (error.message || 'Unknown error'),
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
        hideGalleryMoveRightPanelCover();
    }
}

// Unified vibe detection and parsing function for client-side
function detectAndParseVibeFile(data) {
    const result = {
        isValid: false,
        type: null, // 'bundle' or 'single'
        vibes: [],
        error: null
    };

    try {
        // Validate basic structure
        if (!data || typeof data !== 'object') {
            result.error = 'Invalid data format: expected object';
            return result;
        }

        // Check for required identifier
        if (!data.identifier) {
            result.error = 'Missing identifier: not a valid NovelAI vibe file';
            return result;
        }

        // Handle different vibe file types
        if (data.identifier === 'novelai-vibe-transfer-bundle') {
            // Bundle format - contains multiple vibes
            if (!data.vibes || !Array.isArray(data.vibes)) {
                result.error = 'Invalid bundle format: missing or invalid vibes array';
                return result;
            }

            if (data.vibes.length === 0) {
                result.error = 'Empty bundle: no vibes found';
                return result;
            }

            // Validate each vibe in the bundle
            const validVibes = [];
            for (const vibe of data.vibes) {
                if (validateVibeStructure(vibe)) {
                    validVibes.push(vibe);
                } else {
                    console.warn(`Skipping invalid vibe in bundle: ${vibe.name || vibe.id || 'unnamed'}`);
                }
            }

            if (validVibes.length === 0) {
                result.error = 'Bundle contains no valid vibes';
                return result;
            }

            result.isValid = true;
            result.type = 'bundle';
            result.vibes = validVibes;

        } else if (data.identifier === 'novelai-vibe-transfer') {
            // Single vibe format
            if (!validateVibeStructure(data)) {
                result.error = 'Invalid single vibe format';
                return result;
            }

            result.isValid = true;
            result.type = 'single';
            result.vibes = [data];

        } else {
            result.error = `Unsupported identifier: ${data.identifier}`;
            return result;
        }

        return result;

    } catch (error) {
        result.error = `Parse error: ${error.message}`;
        return result;
    }
}

// Helper function to validate individual vibe structure
function validateVibeStructure(vibe) {
    if (!vibe || typeof vibe !== 'object') {
        return false;
    }

    // Check for required fields
    if (!vibe.identifier || vibe.identifier !== 'novelai-vibe-transfer') {
        return false;
    }

    // At minimum, a vibe should have encodings or be a valid structure
    if (!vibe.encodings && !vibe.id && !vibe.name) {
        return false;
    }

    return true;
}

async function handleJsonFileImport(files) {
    // Update cover message for JSON import
    showGalleryMoveRightPanelCover('Processing Vibe File...');

    let toastId = showGlassToast('info', 'Importing Vibe File', 'Processing JSON files...', true, false, '<i class="nai-import"></i>');
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
            showGlassToast('error', null, 'No workspace selected. Please select a workspace first.');
            hideGalleryMoveRightPanelCover();
            return;
        }
        const commentInput = document.getElementById('unifiedUploadCommentInput');
        const comment = commentInput ? commentInput.value.trim() : '';
        const importPromises = files.map(async (file, index) => {
            updateGlassToast(toastId, 'info', 'Importing Vibe File', `Processing ${file.name}...`);
            const fileContent = await file.text();
            let jsonData = JSON.parse(fileContent);

            // Use unified detection system
            const detectionResult = detectAndParseVibeFile(jsonData);
            if (!detectionResult.isValid) {
                throw new Error(`Invalid vibe file: ${detectionResult.error}`);
            }

            console.log(`📦 Client detected ${detectionResult.type} vibe file with ${detectionResult.vibes.length} vibe(s)`);

            // Get any user-added images from the UI before importing
            const updatedJsonData = { ...jsonData };

            // Check if we have modified vibe data from button interactions
            if (window.modifiedVibeData && window.modifiedVibeData.length > 0) {
                if (detectionResult.type === 'single') {
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
                } else if (detectionResult.type === 'bundle') {
                    // Bundle format - update vibes with any modifications
                    const updatedVibes = detectionResult.vibes.map(vibe => {
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
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Import Complete',
            message: `Successfully imported ${results.length} vibe bundle(s)`,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
        
        // Clear modified vibe data after successful import
        window.modifiedVibeData = [];
        
        if (!cacheBrowserContainer.classList.contains('hidden')) {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();
        
        // Ensure reference manager is refreshed after vibe operation
        await refreshReferenceManagerAfterVibeOperation();
        
        hideUnifiedUploadModal();
    } catch (error) {
        removeGlassToast(toastId);
        hideGalleryMoveRightPanelCover();
        showGlassToast('error', null, 'Import failed: ' + (error.message || 'Unknown error'));
    }
}

async function uploadUnifiedVibeImage(file) {
    const informationExtraction = unifiedUploadIeInput ? parseFloat(unifiedUploadIeInput.value) : 0.35;
    const model = unifiedUploadSelectedModel;
    
    // Add model validation
    if (!model || !window.optionsData?.models?.[model]) {
        showGlassToast('error', null, 'Please select a valid model for vibe encoding');
        return;
    }
    
    // Validate IE value
    if (isNaN(informationExtraction) || informationExtraction < 0 || informationExtraction > 1) {
        showGlassToast('error', null, 'Information Extraction value must be between 0 and 1');
        return;
    }
    
    // Get the selected workspace from the unified upload modal
    let targetWorkspace = unifiedUploadSelectedWorkspace;
        
        // Validate workspace
    if (!targetWorkspace) {
        showGlassToast('error', null, 'No workspace selected. Please select a workspace first.');
        return;
    }
    
    // Determine if we're processing a downloaded file or uploaded file
    const isDownloadedFile = !file && unifiedUploadDownloadedFile;
    const isImageFile = file && file.type && file.type.startsWith('image/');
    
    // Validate file type for vibe encoding
    if (isDownloadedFile) {
        if (unifiedUploadDownloadedFile.type !== 'image' && unifiedUploadDownloadedFile.type !== 'vibe_bundle' && unifiedUploadDownloadedFile.type !== 'vibe_single') {
            showGlassToast('error', null, 'Only image files and vibe files can be used for vibe encoding');
            return;
        }
    } else if (!isImageFile) {
        showGlassToast('error', null, 'Please select a valid image file for vibe encoding');
        return;
    }
    
    // Update cover message for vibe encoding
    showGalleryMoveRightPanelCover('Generating Vibe Encoding...');
    
    let toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe...', true, false, '<i class="mdi mdi-data-matrix-scan"></i>');
    
    // Start progress tracking
    startVibeEncodingProgress(toastId);
    
    try {
        // Update toast for encoding phase
        updateGlassToast(toastId, 'info', 'Vibe Encoding', 'Sending to encoding service...');
        
        let response;
        
        if (isDownloadedFile) {
            // Handle downloaded file
            if (unifiedUploadDownloadedFile.type === 'vibe_bundle') {
                // For vibe bundles, we need to handle them differently
                showGlassToast('error', null, 'Vibe bundles should be imported, not encoded. Please use the import functionality.');
            return;
            } else {
                // Use the downloaded file temp filename
                response = await wsClient.encodeVibe({
                    tempFile: unifiedUploadDownloadedFile.tempFilename,
                    informationExtraction: informationExtraction,
                    model: model,
                    workspace: targetWorkspace
                });
            }
        } else {
            // Handle uploaded file
            const base64 = await fileToBase64(file);
            
            response = await wsClient.encodeVibe({
                image: base64,
                informationExtraction: informationExtraction,
                model: model,
                workspace: targetWorkspace
            });
        }
        
        if (!response.success) {
            throw new Error(response.message || 'Vibe encoding failed');
        }
        
        completeVibeEncodingProgress(toastId, 'Successfully created vibe encoding');
        
        // Use consistent refresh function
        if (!cacheBrowserContainer.classList.contains('hidden')) {
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
        
        // Ensure reference manager is refreshed after vibe operation
        await refreshReferenceManagerAfterVibeOperation();
        
        // Close modal
        hideUnifiedUploadModal();
        
    } catch (error) {
        // Hide cover overlay on error
        hideGalleryMoveRightPanelCover();
        
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
        
        failVibeEncodingProgress(toastId, errorMessage);
    }
}

// Import downloaded vibe bundle
async function importUnifiedVibeFiles() {
    // Filter to only get vibe files from the selected files
    const vibeFiles = unifiedUploadFiles.filter(file => {
        const fileNameLower = file.name.toLowerCase();
        return file.type === 'application/json' || fileNameLower.includes('.naiv4vibe') || fileNameLower.includes('.naiv4vibebundle');
    });

    if (vibeFiles.length === 0) {
        throw new Error('No vibe files found to import');
    }

    // Update cover message for vibe file import
    showGalleryMoveRightPanelCover('Importing Vibe Files...');

    let toastId = showGlassToast('info', 'Importing Vibe Files', `Processing ${vibeFiles.length} vibe file(s)...`, true, false, '<i class="nai-import"></i>');

    try {
        // Get the selected workspace from the unified upload modal
        let targetWorkspace = unifiedUploadSelectedWorkspace;

        if (!targetWorkspace) {
            showGlassToast('error', null, 'No workspace selected. Please select a workspace first.');
            return;
        }

        const commentInput = document.getElementById('unifiedUploadCommentInput');
        const comment = commentInput ? commentInput.value.trim() : '';

        // Process each vibe file
        const importPromises = vibeFiles.map(async (file, index) => {
            updateGlassToast(toastId, 'info', 'Importing Vibe Files', `Processing ${file.name}...`);

            const fileContent = await file.text();
            let jsonData = JSON.parse(fileContent);

            // Use unified detection system
            const detectionResult = detectAndParseVibeFile(jsonData);
            if (!detectionResult.isValid) {
                throw new Error(`Invalid vibe file: ${detectionResult.error}`);
            }

            console.log(`📦 Importing ${detectionResult.type} vibe file: ${file.name} with ${detectionResult.vibes.length} vibes`);

            // Get any user-added images from the UI before importing
            const updatedJsonData = { ...jsonData };

            // Check if we have modified vibe data from button interactions
            if (window.modifiedVibeData && window.modifiedVibeData.length > 0) {
                if (detectionResult.type === 'single') {
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
                } else if (detectionResult.type === 'bundle') {
                    // Bundle format - update vibes with any modifications
                    const updatedVibes = detectionResult.vibes.map(vibe => {
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

        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Vibe Files Imported',
            message: `Successfully imported ${results.length} vibe file(s)`,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });

        // Clear modified vibe data after successful import
        window.modifiedVibeData = [];

        // Refresh cache manager
        if (!cacheBrowserContainer.classList.contains('hidden')) {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();

        // Ensure reference manager is refreshed after vibe operation
        await refreshReferenceManagerAfterVibeOperation();

        // Close modal
        hideUnifiedUploadModal();

    } catch (error) {
        console.error('Error importing vibe files:', error);
        removeGlassToast(toastId);
        hideGalleryMoveRightPanelCover();
        showGlassToast('error', null, 'Import failed: ' + (error.message || 'Unknown error'));
        throw error;
    }
}

async function importDownloadedVibeBundle() {
    if (!unifiedUploadDownloadedFile || (unifiedUploadDownloadedFile.type !== 'vibe_bundle' && unifiedUploadDownloadedFile.type !== 'vibe_single')) {
        throw new Error('No vibe file downloaded');
    }
    
    // Update cover message for downloaded vibe file import
    const isBundle = unifiedUploadDownloadedFile.type === 'vibe_bundle';
    const fileType = isBundle ? 'Bundle' : 'File';
    showGalleryMoveRightPanelCover(`Importing Vibe ${fileType}...`);

    let toastId = showGlassToast('info', `Importing Vibe ${fileType}`, `Processing downloaded vibe ${fileType.toLowerCase()}...`, true, false, '<i class="nai-import"></i>');
    
    try {
        // Get the selected workspace from the unified upload modal
        let targetWorkspace = unifiedUploadSelectedWorkspace;
        
        if (!targetWorkspace) {
            showGlassToast('error', null, 'No workspace selected. Please select a workspace first.');
            return;
        }
        
        const commentInput = document.getElementById('unifiedUploadCommentInput');
        const comment = commentInput ? commentInput.value.trim() : '';
        
        // Import the vibe bundle using raw JSON data
        const response = await wsClient.importVibeBundle(unifiedUploadDownloadedFile.jsonData, targetWorkspace, comment);
        
        if (!response.success) {
            throw new Error(response.message || 'Vibe bundle import failed');
        }
        
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: `Vibe ${fileType} Imported`,
            message: `Successfully imported ${unifiedUploadDownloadedFile.vibeCount} vibe(s)`,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
        
        // Refresh cache manager
        if (!cacheBrowserContainer.classList.contains('hidden')) {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        await refreshReferenceBrowserIfOpen();
        
        // Ensure reference manager is refreshed after vibe operation
        await refreshReferenceManagerAfterVibeOperation();
        
        // Close modal
        hideUnifiedUploadModal();
        
    } catch (error) {
        console.error('Error importing downloaded vibe bundle:', error);
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Import Failed',
            message: 'Vibe bundle import failed: ' + error.message,
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
        hideGalleryMoveRightPanelCover();
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
                backgroundImage.src = '/static_images/background.jpg';
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
            
            const workspaceColor = workspace.color || '#102040';
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
            
            const workspaceColor = workspace.color || '#102040';
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
            if (!cacheBrowserContainer.classList.contains('hidden')) {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();
            
            // Ensure reference manager is refreshed after move operation
            await refreshReferenceManagerAfterVibeOperation();
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
    if (vibeEncodingUploadSection) vibeEncodingUploadSection.classList.add('hidden');
    if (vibeEncodingReferenceSection) vibeEncodingReferenceSection.classList.add('hidden');
    
    // Update background image and mode display
    const backgroundImage = document.getElementById('vibeEncodingBackgroundImage');
    const modeDisplay = document.getElementById('vibeEncodingModeDisplay');
    const modelDisplay = document.getElementById('vibeEncodingModelDisplay');
    
    // Configure modal based on mode
    switch (mode) {
        case 'upload':
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="mdi mdi-data-matrix"></i> <span>Upload & Encode Vibe Image</span>';
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Upload';
            if (vibeEncodingUploadSection) vibeEncodingUploadSection.classList.remove('hidden');
            if (vibeEncodingConfirmBtn) vibeEncodingConfirmBtn.disabled = true;
            if (backgroundImage) backgroundImage.src = '/static_images/background.jpg';
            if (modeDisplay) modeDisplay.textContent = 'Upload Mode';
            break;
            
        case 'gallery':
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="mdi mdi-data-matrix"></i> <span>Encode Image as Vibe</span>';
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
                ? `<i class="mdi mdi-data-matrix-plus"></i> <span>Request IE for ${window.optionsData?.models?.[targetModel] || targetModel}</span>`
                : '<i class="mdi mdi-data-matrix-plus"></i> <span>Request New IE</span>';
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
            if (vibeEncodingModalTitle) vibeEncodingModalTitle.innerHTML = '<i class="mdi mdi-data-matrix-plus"></i> <span>Create Vibe from Reference</span>';
            if (vibeEncodingConfirmText) vibeEncodingConfirmText.textContent = 'Encode';
            if (vibeEncodingReferenceSection) vibeEncodingReferenceSection.classList.add('hidden'); // Hide the preview section
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

    // Set target model if provided, otherwise use manual selected model for upload/reference modes
    if (targetModel) {
        vibeEncodingSelectedModel = targetModel;
    } else if ((mode === 'upload' || mode === 'reference') && manualSelectedModel) {
        // Use the currently selected model from manual generation modal
        vibeEncodingSelectedModel = manualSelectedModel;
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
    
    if (!cacheBrowserContainer.classList.contains('hidden')) {
        await loadCacheManagerImages();
    } else {
        await loadCacheImages();
    }
    await refreshReferenceBrowserIfOpen();
    
    // Ensure reference manager is refreshed after vibe operation
    await refreshReferenceManagerAfterVibeOperation();
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
        workspace: unifiedUploadSelectedWorkspace, // Use selected workspace from unified upload modal
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
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from image...', true, false, '<i class="mdi mdi-data-matrix-scan"></i>');
                
                requestParams.image = base64;
                break;
                
            case 'gallery':
                if (!window.galleryToolbarVibeImage) {
                    showError('No gallery image data found');
                    return;
                }
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from gallery image...', true, false, '<i class="mdi mdi-data-matrix-scan"></i>');
                
                requestParams.image = window.galleryToolbarVibeImage;
                break;
                
            case 'ie':
                if (!vibeEncodingCurrentVibeImage) {
                    showError('No vibe image selected');
                    return;
                }
                
                toastId = showGlassToast('info', 'Requesting IE', 'Processing new Information Extraction...', true, false, '<i class="mdi mdi-data-matrix-scan"></i>');
                
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
                
                toastId = showGlassToast('info', 'Vibe Encoding', 'Generating vibe from reference image...', true, false, '<i class="mdi mdi-data-matrix-scan"></i>');
                
                requestParams.cacheFile = vibeEncodingCurrentCacheImage.hash;
                
                // Use the source cache image's workspace instead of current workspace
                if (vibeEncodingCurrentCacheImage.workspaceId) {
                    requestParams.workspace = vibeEncodingCurrentCacheImage.workspaceId;
                }
                break;
        }
        
        // Start progress tracking if toast was created
        if (toastId) {
            startVibeEncodingProgress(toastId);
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
            
            completeVibeEncodingProgress(toastId, successMessages[vibeEncodingCurrentMode]);
            await hideVibeEncodingModal();
            if (!cacheBrowserContainer.classList.contains('hidden')) {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();
            
            // Ensure reference manager is refreshed after vibe operation
            await refreshReferenceManagerAfterVibeOperation();
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
        failVibeEncodingProgress(toastId, errorMessages[vibeEncodingCurrentMode]);
    }
}

function displayVibeManagerImages() {
    if (!vibeManagerGallery) return;

    vibeManagerGallery.innerHTML = '';

    if (vibeManagerImages.length === 0) {
        vibeManagerGallery.innerHTML = `
        <div class="no-images">
            <i class="mdi mdi-data-matrix-remove"></i>
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
        img.src = '/static_images/background.jpg'; // Fallback image
    }
    img.alt = `Vibe image ${vibeImage.id}`;
    img.loading = 'lazy';

    // Create move button
    const moveBtn = document.createElement('button');
    moveBtn.className = 'btn-secondary btn-small';
    moveBtn.innerHTML = '<i class="mdi mdi-1-5 mdi-folder-move"></i>';
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
            showLightbox({ url: imageSrc });
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
            if (!cacheBrowserContainer.classList.contains('hidden')) {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();
            
            // Ensure reference manager is refreshed after vibe operation
            await refreshReferenceManagerAfterVibeOperation();
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
            
            // Ensure reference manager is refreshed after delete operation
            await refreshReferenceManagerAfterVibeOperation();
            
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
            if (!cacheBrowserContainer.classList.contains('hidden')) {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            displayVibeManagerImages();
            await refreshReferenceBrowserIfOpen();
            
            // Ensure reference manager is refreshed after vibe operation
            await refreshReferenceManagerAfterVibeOperation();
            
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
        if (!cacheBrowserContainer.classList.contains('hidden')) {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        displayVibeManagerImages();
        await refreshReferenceBrowserIfOpen();
        
        // Ensure reference manager is refreshed after vibe operation
        await refreshReferenceManagerAfterVibeOperation();
        
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
async function handleUnifiedUploadFileChange(event) {
    // Handle cases where function is called without event parameter
    let files;
    if (event && event.target && event.target.files) {
        files = event.target.files;
    } else {
        return;
    }
    
    if (!files || files.length === 0) return;
    
    // Reset UI elements
    hideVibeBundlePreview();
    hideBlueprintPreview();
    
    // Update confirm button state
    if (unifiedUploadConfirmBtn) {
        // Enable button if we have files OR a downloaded file
        unifiedUploadConfirmBtn.disabled = !(files.length > 0 || unifiedUploadDownloadedFile);
    }
    
    // Store files and reset index
    unifiedUploadFiles = Array.from(files);
    unifiedUploadCurrentIndex = 0;
    unifiedUploadFileMetadata = [];
    
    // Process all files first to check for blueprint metadata and vibe bundles
    const metadataPromises = unifiedUploadFiles.map(async (file) => {
        if (file.type === 'image/png') {
            try {
                const metadata = await extractPNGMetadata(file);
                if (metadata && metadata.source && metadata.source.includes('NovelAI')) {
                    return { valid: true, metadata };
                } else {
                    return { 
                        valid: false, 
                        error: 'No Valid NovelAI / StaticForge metadata found' 
                    };
                }
            } catch (error) {
                console.warn('Error extracting PNG metadata:', error.message, 'for file:', file.name);
                return { 
                    valid: false, 
                    error: `Invalid PNG: ${error.message}` 
                };
            }
        } else if (file.type === 'application/json' || file.name.toLowerCase().includes('.naiv4vibe') || file.name.toLowerCase().includes('.naiv4vibebundle')) {
            console.log(`🔍 Processing potential vibe file: ${file.name}, type: ${file.type}, size: ${file.size}`);
            // Check if it's a valid vibe bundle
            try {
                const fileContent = await file.text();
                const jsonData = JSON.parse(fileContent);
                
                // Use unified vibe detection system
                const detectionResult = detectAndParseVibeFile(jsonData);

                if (detectionResult.isValid) {
                    console.log(`✅ Valid vibe file detected: ${detectionResult.type} with ${detectionResult.vibes.length} vibes`);
                    return {
                        valid: true,
                        metadata: {
                            type: detectionResult.type === 'bundle' ? 'vibe_bundle' : 'vibe_single',
                            vibes: detectionResult.vibes,
                            isBundle: detectionResult.type === 'bundle'
                        }
                    };
                } else {
                    console.log(`❌ Invalid vibe file: ${detectionResult.error}`);
                    return {
                        valid: false,
                        error: 'Not a valid NovelAI vibe transfer or bundle file'
                    };
                }
            } catch (error) {
                console.warn('Error parsing JSON file:', error.message, 'for file:', file.name);
                return { 
                    valid: false, 
                    error: `Invalid JSON: ${error.message}` 
                };
            }
        } else {
            return { 
                valid: false, 
                error: 'Not a PNG file or JSON vibe bundle' 
            };
        }
    });
    
    // Wait for all metadata checks to complete using Promise.allSettled to avoid failing on individual errors
    const metadataResults = await Promise.allSettled(metadataPromises);
    unifiedUploadFileMetadata = metadataResults.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.warn('Promise rejected for file:', unifiedUploadFiles[index].name, 'Error:', result.reason);
            return { 
                valid: false, 
                error: `Processing failed: ${result.reason.message || result.reason}` 
            };
        }
    });
    
    // Count valid blueprints and vibe files (both bundles and singles)
    const validBlueprintCount = unifiedUploadFileMetadata.filter(meta => meta.valid && meta.metadata && !meta.metadata.type).length;
    const validVibeCount = unifiedUploadFileMetadata.filter(meta => meta.valid && meta.metadata && (meta.metadata.type === 'vibe_bundle' || meta.metadata.type === 'vibe_single')).length;
    const hasValidBlueprint = validBlueprintCount > 0;
    const hasValidVibe = validVibeCount > 0;
    
    // ALWAYS enable blueprint mode option if at least one valid blueprint exists
    const modeSliderContainer = document.querySelector('.mode-slider-container');
    if (modeSliderContainer) {
        // Always add the blueprint-enabled class if we have any valid blueprints
        if (hasValidBlueprint) {
            modeSliderContainer.classList.add('blueprint-enabled');
        } else {
            modeSliderContainer.classList.remove('blueprint-enabled');
        }
    }
    
    // If we have vibe files (bundles or singles), switch to vibe mode and hide mode selector
    if (hasValidVibe) {
        console.log(`🎵 Switching to vibe mode: found ${validVibeCount} valid vibe files`);
        unifiedUploadCurrentMode = 'vibe';
        updateUnifiedUploadMode();
        hideModeSelector();
        
        // Clear any existing warnings
        const warningContainer = document.getElementById('unifiedUploadWarnings');
        if (warningContainer) {
            warningContainer.classList.add('hidden');
        }
    }
    // If at least one file has valid NovelAI metadata, switch to blueprint mode
    else if (hasValidBlueprint) {
        // Switch to blueprint mode
        unifiedUploadCurrentMode = 'blueprint';
        updateUnifiedUploadMode();
        
        // Show warning if some files are invalid
        const warningContainer = document.getElementById('unifiedUploadWarnings');
        if (warningContainer) {
            if (validBlueprintCount < unifiedUploadFiles.length) {
                const invalidCount = unifiedUploadFiles.length - validBlueprintCount;
                warningContainer.classList.remove('hidden');
                warningContainer.querySelector('.warning-message').textContent = 
                    `${invalidCount} of ${unifiedUploadFiles.length} files cannot be imported as blueprints.`;
            } else {
                warningContainer.classList.add('hidden');
            }
        }
    } else {
        // Clear any existing warnings if no blueprints detected
        const warningContainer = document.getElementById('unifiedUploadWarnings');
        if (warningContainer) {
            warningContainer.classList.add('hidden');
        }
    }
    
    // Show mode selector if we have image files (not just vibe bundles)
    const hasImageFiles = unifiedUploadFiles.some(file => file.type.startsWith('image/'));
    if (hasImageFiles) {
        showModeSelector();
    }
    
    // Hide initial options
    hideInitialUploadOptions();
    
    // Update overlay with file information
    const fileInfo = createFileInfoHTML(unifiedUploadFiles[0], unifiedUploadFiles.length);
    updateUploadOverlayWithFileInfo(fileInfo);
    
    // Process first file immediately
    await updateUnifiedUploadPreview();
}

// Handle vibe bundle file selection
async function handleVibeBundleFile(file, backgroundImage) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const jsonData = JSON.parse(e.target.result);
            
            // Use unified vibe detection system
            const detectionResult = detectAndParseVibeFile(jsonData);

            if (detectionResult.isValid) {
                const vibes = detectionResult.vibes;
                
                // Hide mode selection for vibe bundles
                hideModeSelector();
                
                // Show vibe bundle preview
                showVibeBundlePreview(vibes);
                
                // Set background image to first vibe's thumbnail or image
                const firstVibe = vibes[0];
                if (firstVibe.thumbnail && firstVibe.thumbnail.startsWith('data:image/')) {
                    backgroundImage.src = firstVibe.thumbnail;
                } else if (firstVibe.image && firstVibe.image.startsWith('data:image/')) {
                    backgroundImage.src = firstVibe.image;
                } else if (firstVibe.image && (firstVibe.image.startsWith('/9j/') || firstVibe.image.startsWith('iVBOR'))) {
                    // Handle base64 data without data:image/ prefix
                    const mimeType = firstVibe.image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                    backgroundImage.src = `data:${mimeType};base64,${firstVibe.image}`;
                } else {
                    backgroundImage.src = '/static_images/background.jpg';
                }

                // Add error handling for background image
                backgroundImage.onerror = function() {
                    this.src = '/static_images/background.jpg';
                    console.warn(`Failed to load background image for vibe: ${firstVibe.name || firstVibe.id}`);
                };
                
                // Update UI for bundle import
                updateUIForVibeFileImport(vibes.length, detectionResult.type === 'bundle');
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

// Extract PNG metadata from a File object
async function extractPNGMetadata(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const metadata = readPNGMetadata(buffer);
                
                const enhancedMetadata = await extractMetadataWithDimensions(metadata, buffer, file);
                resolve(enhancedMetadata);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

// Read PNG metadata from ArrayBuffer
function readPNGMetadata(buffer) {
    const data = new Uint8Array(buffer);
    if (!isValidPNGHeader(data)) {
        throw new Error('Invalid PNG file header');
    }
    
    const result = {};
    let idx = 8;
    
    while (idx < data.length) {
        if (idx + 8 > data.length) break;
        
        const length = readUint32(data, idx);
        const name = String.fromCharCode(...data.slice(idx + 4, idx + 8));
        idx += 8;
        
        if (name === 'IEND') break;
        
        if (name === 'tEXt') {
            const chunkData = data.slice(idx, idx + length);
            const textChunk = textDecode(chunkData);
            if (!result.tEXt) result.tEXt = {};
            result.tEXt[textChunk.keyword] = textChunk.text;
        }
        
        idx += length + 4; // Skip data and CRC
    }
    
    if (result.tEXt && result.tEXt.Comment) {
        try {
            const commentData = JSON.parse(result.tEXt.Comment);
            return { ...commentData, source: result.tEXt.Source, software: result.tEXt.Software };
        } catch (e) {
            // Comment is not JSON, return basic metadata
            return { source: result.tEXt.Source, software: result.tEXt.Software };
        }
    }
    
    return result;
}

// Enhance metadata with actual image dimensions and scale ratio detection
async function extractMetadataWithDimensions(metadata, buffer, file) {
    try {
        // Create an image element to get actual dimensions
        const imageUrl = URL.createObjectURL(file);
        const img = new Image();
        
        const dimensions = await new Promise((resolve, reject) => {
            img.onload = () => {
                const actualWidth = img.naturalWidth;
                const actualHeight = img.naturalHeight;
                URL.revokeObjectURL(imageUrl);
                resolve({ width: actualWidth, height: actualHeight });
            };
            img.onerror = () => {
                URL.revokeObjectURL(imageUrl);
                reject(new Error('Failed to load image for dimension extraction'));
            };
            img.src = imageUrl;
        });
        
        // Add actual dimensions to metadata
        metadata.actual_width = dimensions.width;
        metadata.actual_height = dimensions.height;
        
        // Calculate scale ratio if both embedded and actual dimensions are present
        if (metadata.width && metadata.height) {
            const embeddedWidth = metadata.width;
            const embeddedHeight = metadata.height;
            
            // Check if image was scaled up (both dimensions increased)
            if (dimensions.width > embeddedWidth && dimensions.height > embeddedHeight) {
                const scaleX = (dimensions.width / embeddedWidth).toFixed(2);
                const scaleY = (dimensions.height / embeddedHeight).toFixed(2);
                
                // Use the smaller scale factor for display (more conservative)
                const displayScale = Math.min(parseFloat(scaleX), parseFloat(scaleY));
                
                // Add scale ratio information
                metadata.scale_ratio = {
                    x: parseFloat(scaleX),
                    y: parseFloat(scaleY),
                    display: `${displayScale % 1 === 0 ? displayScale : displayScale.toFixed(1)}×`,
                    original_dimensions: `${embeddedWidth}×${embeddedHeight}`,
                    current_dimensions: `${dimensions.width}×${dimensions.height}`
                };
            }
        }
        
        return metadata;
    } catch (error) {
        console.warn('Could not extract image dimensions:', error.message);
        return metadata; // Return original metadata if dimension extraction fails
    }
}

// Helper function to determine model from metadata
function determineModelFromMetadata(metadata) {
    if (!metadata || !metadata.source) {
        return "unknown";
    }
    
    const source = metadata.source;
    
    // NovelAI Diffusion V4/V4.5 models
    if (source.includes("NovelAI Diffusion V4")) {
        switch (source) {
            case "NovelAI Diffusion V4.5 4BDE2A90":
            case "NovelAI Diffusion V4.5 1229B44F":
            case "NovelAI Diffusion V4.5 B9F340FD":
            case "NovelAI Diffusion V4.5 F3D95188":
                return "V4_5";
            case "NovelAI Diffusion V4.5 C02D4F98":
            case "NovelAI Diffusion V4.5 5AB81C7C":
            case "NovelAI Diffusion V4.5 B5A2A797":
            case "NovelAI Diffusion V4 5AB81C7C":
            case "NovelAI Diffusion V4 B5A2A797":
                return "V4_5_CUR";
            case "NovelAI Diffusion V4 37442FCA":
            case "NovelAI Diffusion V4 4F49EC75":
            case "NovelAI Diffusion V4 CA4B7203":
            case "NovelAI Diffusion V4 79F47848":
            case "NovelAI Diffusion V4 F6302A9D":
                return "V4";
            case "NovelAI Diffusion V4 7ABFFA2A":
            case "NovelAI Diffusion V4 C1CCBA86":
            case "NovelAI Diffusion V4 770A9E12":
                return "V4_CUR";
            default:
                return "V4_5";
        }
    }
    
    // Stable Diffusion models
    switch (source) {
        case "Stable Diffusion XL B0BDF6C1":
        case "Stable Diffusion XL C1E1DE52":
        case "Stable Diffusion XL 7BCCAA2C":
        case "Stable Diffusion XL 1120E6A9":
        case "Stable Diffusion XL 8BA2AF87":
            return "V3";
        case "Stable Diffusion XL 4BE8C60C":
        case "Stable Diffusion XL C8704949":
        case "Stable Diffusion XL 37C2B166":
        case "Stable Diffusion XL F306816B":
        case "Stable Diffusion XL 9CC2F394":
            return "FURRY";
        default:
            return source;
    }
}

// Helper function to get model display name
function getModelDisplayName(model) {
    return model === "V4_5" ? "<span class='model-name'>NovelAI v4.5</span><span class='badge custom-dropdown-badge'>F</span>" : 
           model === "V4_5_CUR" ? "<span class='model-name'>NovelAI v4.5</span><span class='badge custom-dropdown-badge curated-badge'>C</span>" : 
           model === "V4" ? "<span class='model-name'>NovelAI v4</span><span class='badge custom-dropdown-badge'>F</span>" : 
           model === "V4_CUR" ? "<span class='model-name'>NovelAI v4</span><span class='badge custom-dropdown-badge curated-badge'>C</span>" : 
           model === "V3" ? "<span class='model-name'>NovelAI v3</span><span class='badge custom-dropdown-badge legacy-badge'>L</span>" :  
           model === "FURRY" ? "<span class='model-name'>NovelAI v3</span><span class='badge custom-dropdown-badge furry-badge'>LF</span>" :
           model;
}

// Helper functions for PNG parsing
function isValidPNGHeader(data) {
    return (
        data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
        data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A
    );
}

function readUint32(data, offset) {
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

function textDecode(data) {
    let naming = true;
    let text = '';
    let name = '';
    
    for (let i = 0; i < data.length; i++) {
        if (naming) {
            if (data[i]) {
                name += String.fromCharCode(data[i]);
            } else {
                naming = false;
            }
        } else {
            const textDecoder = new TextDecoder("utf-8");
            text = textDecoder.decode(data.slice(i));
            break;
        }
    }
    
    return { keyword: name, text };
}

// Update the preview and metadata display for the current file
async function updateUnifiedUploadPreview() {
    const currentFile = unifiedUploadFiles[unifiedUploadCurrentIndex];
    if (!currentFile && !unifiedUploadDownloadedFile) return;

    // Show overlay since we now have file data to display
    const overlay = document.querySelector('#unifiedUploadModal .gallery-move-image-info-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }

    // Update navigation display
    const navContainer = document.getElementById('unifiedUploadNavigation');
    const currentIndexSpan = document.getElementById('unifiedUploadCurrentIndex');
    const totalCountSpan = document.getElementById('unifiedUploadTotalCount');
    
    if (navContainer && currentIndexSpan && totalCountSpan) {
        navContainer.classList.toggle('hidden', unifiedUploadFiles.length <= 1);
        currentIndexSpan.textContent = (unifiedUploadCurrentIndex + 1).toString();
        totalCountSpan.textContent = unifiedUploadFiles.length.toString();
    }

    // Update background preview
    const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
    if (backgroundImage) {
        // Check if this is a vibe file - handle both local files and URL downloads
        const currentMetadata = unifiedUploadFileMetadata[unifiedUploadCurrentIndex];
        const isVibeFile = (unifiedUploadCurrentMode === 'vibe' && currentMetadata && currentMetadata.valid && currentMetadata.metadata && (currentMetadata.metadata.type === 'vibe_bundle' || currentMetadata.metadata.type === 'vibe_single')) ||
                          (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single'));

        if (isVibeFile) {
            // For vibe files, try to set background from thumbnail data
            let thumbnailFound = false;

            if (unifiedUploadDownloadedFile && unifiedUploadDownloadedFile.jsonData) {
                // For downloaded vibe files, use the raw JSON data
                try {
                    const detectionResult = detectAndParseVibeFile(unifiedUploadDownloadedFile.jsonData);
                    if (detectionResult.isValid && detectionResult.vibes.length > 0) {
                        const firstVibe = detectionResult.vibes[0];
                        if (firstVibe.thumbnail && firstVibe.thumbnail.startsWith('data:image/')) {
                            backgroundImage.src = firstVibe.thumbnail;
                            thumbnailFound = true;
                        } else if (firstVibe.image && firstVibe.image.startsWith('data:image/')) {
                            backgroundImage.src = firstVibe.image;
                            thumbnailFound = true;
                        } else if (firstVibe.image && (firstVibe.image.startsWith('/9j/') || firstVibe.image.startsWith('iVBOR'))) {
                            // Handle base64 data without data:image/ prefix
                            const mimeType = firstVibe.image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                            backgroundImage.src = `data:${mimeType};base64,${firstVibe.image}`;
                            thumbnailFound = true;
                        }
                    }
                } catch (error) {
                    console.warn('Error parsing downloaded vibe data for thumbnail:', error);
                }
            } else if (currentMetadata && currentMetadata.metadata && currentMetadata.metadata.vibes) {
                // For local vibe files, use the metadata
                const firstVibe = currentMetadata.metadata.vibes[0];
                if (firstVibe && firstVibe.thumbnail && firstVibe.thumbnail.startsWith('data:image/')) {
                    backgroundImage.src = firstVibe.thumbnail;
                    thumbnailFound = true;
                } else if (firstVibe && firstVibe.image && firstVibe.image.startsWith('data:image/')) {
                    backgroundImage.src = firstVibe.image;
                    thumbnailFound = true;
                } else if (firstVibe && firstVibe.image && (firstVibe.image.startsWith('/9j/') || firstVibe.image.startsWith('iVBOR'))) {
                    // Handle base64 data without data:image/ prefix
                    const mimeType = firstVibe.image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                    backgroundImage.src = `data:${mimeType};base64,${firstVibe.image}`;
                    thumbnailFound = true;
                }
            }

            // If no thumbnail found, use default background
            if (!thumbnailFound) {
                backgroundImage.src = '/static_images/background.jpg';
            }

            // Add error handling for background image
            backgroundImage.onerror = function() {
                this.src = '/static_images/background.jpg';
                console.warn('Failed to load background image for vibe file');
            };
        } else {
            // For regular files, create object URL
            const imageUrl = URL.createObjectURL(currentFile);
            backgroundImage.src = imageUrl;
            backgroundImage.onload = () => URL.revokeObjectURL(imageUrl);
        }
    }

    // Get all preview areas
    const blueprintPreview = document.getElementById('unifiedUploadBlueprintPreview');
    const blueprintInfo = document.getElementById('unifiedUploadBlueprintInfo');
    const commentContainer = document.getElementById('unifiedUploadCommentInputContainer');
    
    // First hide all preview areas
    if (blueprintPreview) {
        blueprintPreview.classList.add('hidden');
    }
    
    // Show footer actions when files are selected
    const footerActions = document.querySelector('.gallery-move-actions');
    if (footerActions) {
        footerActions.classList.remove('hidden');
    }
    
    // Show/hide Open in Editor button based on mode
    if (unifiedUploadOpenInEditorBtn) {
        unifiedUploadOpenInEditorBtn.classList.toggle('hidden', unifiedUploadCurrentMode !== 'blueprint');
    }
    
    // Show/hide reference comment based on mode
    if (commentContainer) {
        commentContainer.classList.toggle('hidden', unifiedUploadCurrentMode === 'blueprint');
    }
    
    // Update metadata display based on mode
    if (unifiedUploadCurrentMode === 'blueprint') {
        const currentMetadata = unifiedUploadFileMetadata[unifiedUploadCurrentIndex];
        
        if (blueprintPreview) {
            blueprintPreview.classList.remove('hidden');
        }
        
        if (currentMetadata && currentMetadata.valid) {
            // Show blueprint preview for valid files using the consolidated function
            showBlueprintPreview(currentMetadata.metadata);
        } else {
            // Show individual file warning in the blueprint preview area
            // Invalid blueprint, show warning
            if (blueprintInfo) {
                blueprintInfo.innerHTML = `<div class="form-group">
                    <p class="text-warning">This file cannot be imported as a blueprint.</p>
                    <p class="text-warning small">${currentMetadata ? currentMetadata.error : 'Invalid file'}</p>
                </div>`;
            }
        }
    } else if (unifiedUploadCurrentMode === 'vibe') {
        console.log(`🎵 Vibe mode preview: current mode = ${unifiedUploadCurrentMode}`);
        // Handle vibe preview
        const currentMetadata = unifiedUploadFileMetadata[unifiedUploadCurrentIndex];

        if (currentMetadata && currentMetadata.valid && currentMetadata.metadata && (currentMetadata.metadata.type === 'vibe_bundle' || currentMetadata.metadata.type === 'vibe_single')) {
            console.log(`🎵 Processing vibe preview: ${currentMetadata.metadata.type} with ${currentMetadata.metadata.vibes.length} vibes`);
            // Use the pre-parsed vibe data from metadata
            const vibes = currentMetadata.metadata.vibes;
            const isVibeBundle = currentMetadata.metadata.isBundle;
            
            // Hide mode selection for vibe bundles
            hideModeSelector();
            
            // Show vibe bundle preview
            showVibeBundlePreview(vibes);
            
            // Set background image to first vibe's thumbnail or image
            const firstVibe = vibes[0];
            if (firstVibe.thumbnail && firstVibe.thumbnail.startsWith('data:image/')) {
                backgroundImage.src = firstVibe.thumbnail;
            } else if (firstVibe.image && firstVibe.image.startsWith('data:image/')) {
                backgroundImage.src = firstVibe.image;
            } else if (firstVibe.image && (firstVibe.image.startsWith('/9j/') || firstVibe.image.startsWith('iVBOR'))) {
                // Handle base64 data without data:image/ prefix
                const mimeType = firstVibe.image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                backgroundImage.src = `data:${mimeType};base64,${firstVibe.image}`;
            } else {
                backgroundImage.src = '/static_images/background.jpg';
            }

            // Add error handling for background image
            backgroundImage.onerror = function() {
                this.src = '/static_images/background.jpg';
                console.warn(`Failed to load background image for vibe: ${firstVibe.name || firstVibe.id}`);
            };
            
            // Update UI for bundle import
            updateUIForVibeFileImport(vibes.length, isVibeBundle);
        } else if (unifiedUploadDownloadedFile && (unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single')) {
            // Handle downloaded vibe files
            console.log('🎵 Processing downloaded vibe file:', unifiedUploadDownloadedFile.type);
            try {
                const detectionResult = detectAndParseVibeFile(unifiedUploadDownloadedFile.jsonData);
                if (detectionResult.isValid && detectionResult.vibes.length > 0) {
                    showVibeBundlePreview(detectionResult.vibes);

                    // Set background image to first vibe's thumbnail or image
                    const firstVibe = detectionResult.vibes[0];
                    if (firstVibe.thumbnail && firstVibe.thumbnail.startsWith('data:image/')) {
                        backgroundImage.src = firstVibe.thumbnail;
                    } else if (firstVibe.image && firstVibe.image.startsWith('data:image/')) {
                        backgroundImage.src = firstVibe.image;
                    } else if (firstVibe.image && (firstVibe.image.startsWith('/9j/') || firstVibe.image.startsWith('iVBOR'))) {
                        // Handle base64 data without data:image/ prefix
                        const mimeType = firstVibe.image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                        backgroundImage.src = `data:${mimeType};base64,${firstVibe.image}`;
                    } else {
                        backgroundImage.src = '/static_images/background.jpg';
                    }

                    // Add error handling for background image
                    backgroundImage.onerror = function() {
                        this.src = '/static_images/background.jpg';
                        console.warn(`Failed to load background image for downloaded vibe: ${firstVibe.name || firstVibe.id}`);
                    };

                    // Update UI for bundle import
                    updateUIForVibeFileImport(detectionResult.vibes.length, detectionResult.type === 'bundle');
                } else {
                    console.warn('Invalid downloaded vibe file format');
                    backgroundImage.src = '/static_images/background.jpg';
                }
            } catch (error) {
                console.error('Error processing downloaded vibe file:', error);
                backgroundImage.src = '/static_images/background.jpg';
            }
        } else if (currentFile.type === 'application/json' || currentFile.name.toLowerCase().includes('.naiv4')) {
            // Fallback: parse the file directly
            await handleVibeBundleFile(currentFile, backgroundImage);
        }
    }
}

// Handle PNG file selection and check for NovelAI metadata
async function handlePNGFile(file, backgroundImage) {
    // Create a preview URL for the uploaded image
    const imageUrl = URL.createObjectURL(file);
    backgroundImage.src = imageUrl;
    
    // Clean up the object URL when the image loads
    backgroundImage.onload = () => {
        URL.revokeObjectURL(imageUrl);
    };
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

// Show blueprint mode in the mode slider
function showBlueprintMode() {
    const blueprintBtn = document.querySelector('.blueprint-mode-btn');
    if (blueprintBtn) {
        blueprintBtn.classList.add('show');
    } else {
        console.warn('Blueprint mode button not found');
    }
    
    // Also enable blueprint mode in the mode slider container
    const modeSliderContainer = document.querySelector('.mode-slider-container');
    if (modeSliderContainer) {
        modeSliderContainer.classList.add('blueprint-enabled');
    } else {
        console.warn('Mode slider container not found');
    }
}

// Show blueprint preview with metadata information
function showBlueprintPreview(metadata) {
    // Show overlay since we now have blueprint data to display
    const overlay = document.querySelector('#unifiedUploadModal .gallery-move-image-info-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
    
    const blueprintPreview = document.getElementById('unifiedUploadBlueprintPreview');
    const blueprintInfo = document.getElementById('unifiedUploadBlueprintInfo');
    
    if (blueprintPreview && blueprintInfo) {
        blueprintPreview.classList.remove('hidden');
        
        // Validate metadata structure
        if (!metadata || typeof metadata !== 'object') {
            console.error('Invalid metadata structure:', metadata);
            blueprintInfo.innerHTML = '<div class="form-group"><label>Error</label><div class="meta-value">Invalid metadata structure</div></div>';
            return;
        }
        
        // Build metadata display using the latest system
        let infoRows = [[],[],[],[],[]];

        // Model information - use prettified model name
        if (metadata.source) {
            const modelKey = determineModelFromMetadata(metadata);
            const modelDisplayName = getModelDisplayName(modelKey);
            infoRows[1].push(`<div class="form-group"><label for="modelName">Model</label><div class="meta-value">${modelDisplayName}</div></div>`);
        }
        
        // Resolution information - use priority order: embedded JSON > server dimensions > client fallback
        let resolutionText = null;
        if (metadata.resolution) {
            resolutionText = formatResolution(metadata.resolution, metadata.width, metadata.height);
        } else if (metadata.actual_resolution) {
            resolutionText = metadata.actual_resolution_display;
        } else if (metadata.width && metadata.height) {
            resolutionText = formatResolution(null, metadata.width, metadata.height);
        } else if (metadata.actual_width && metadata.actual_height) {
            resolutionText = `${metadata.actual_width} × ${metadata.actual_height}`;
        }                
        if (resolutionText) {                    
            let resolutionHtml = `<div class="form-group"><label for="modelName">Resolution</label><div class="meta-value space-between"><span>${resolutionText}</span>`
            if (metadata.scale_ratio)
                resolutionHtml += ` <span class="badge custom-dropdown-badge scale-ratio-badge" title="Image scaled up from ${metadata.scale_ratio.original_dimensions} to ${metadata.scale_ratio.current_dimensions}">${metadata.scale_ratio.display}</span>`;
            resolutionHtml += `</div></div>`;
            infoRows[1].push(resolutionHtml);
        }
        if (metadata.seed !== undefined) {
            infoRows[1].push(`<div class="form-group auto-width"><label class="justify-end" for="modelName">Seed</label><div class="meta-value justify-end">${metadata.seed}</div></div>`);
        }
        
        // Generation parameters
        if (metadata.steps) {
            infoRows[2].push(`<div class="form-group auto-width"><label for="modelName">Steps</label><div class="meta-value">${metadata.steps}</div></div>`);
        }
        if (metadata.scale) {
            infoRows[2].push(`<div class="form-group auto-width"><label for="modelName">Guidance</label><div class="meta-value space-between"><span>${metadata.scale.toFixed(1)}</span>${metadata.cfg_rescale && metadata.cfg_rescale > 0 ? '<i class="fas fa-sparkle"></i>' : ''}</div></div>`);
        }
        if (metadata.cfg_rescale !== undefined) {
            infoRows[2].push(`<div class="form-group auto-width"><label for="modelName">Rescale</label><div class="meta-value">${metadata.cfg_rescale ? (metadata.cfg_rescale * 100).toFixed(0) + '%' : 'None'}</div></div>`);
        }
        if (metadata.sampler) {
            const samplerObj = getSamplerMeta(metadata.sampler);
            const samplerText = samplerObj ? `<span>${samplerObj.display_short || samplerObj.display}</span>${samplerObj.badge ? `<span class="custom-dropdown-badge ${samplerObj.badge_class}">${samplerObj.badge}</span>` : ''}` : metadata.sampler;
            infoRows[2].push(`<div class="form-group"><label for="modelName">Sampler</label><div class="meta-value">${samplerText}</div></div>`);
        }
        if (metadata.noise_schedule) {
            const noiseObj = getNoiseMeta(metadata.noise_schedule);
            const noiseText = noiseObj ? noiseObj.display : metadata.noise_schedule;
            infoRows[2].push(`<div class="form-group"><label for="modelName">Noise Scheduler</label><div class="meta-value">${noiseText}</div></div>`);
        }
        if (metadata.forge_data) {
            infoRows[0].unshift(`<div class="form-group"><label for="modelName">Software</label><div class="meta-value"><i class="fa-light fa-sparkles"></i><span>${metadata.forge_data.software}</span></div></div>`);
            infoRows[3].push(`<div class="form-group"><label for="modelName">Preset Name</label><div class="meta-value">${metadata.forge_data.preset_name || 'Manual'}</div></div>`);
            let infoBadges = [];
            let icon = '<i class="nai-sakura"></i>';
            let text = 'Anime'
            if (metadata.forge_data.dataset_config !== undefined && metadata.forge_data.dataset_config?.include?.length > 0) {
                if (metadata.forge_data.dataset_config?.include?.includes('furry')) {
                    icon = '<i class="nai-paw"></i>';
                    text = 'Furry';
                } else if (metadata.forge_data.dataset_config?.include?.includes('background')) {
                    icon = '<i class="fa-solid fa-mountain-city"></i>';
                    text = 'Background';
                } else {
                    if (metadata.forge_data.dataset_config?.include?.includes('danbooru')) {
                        text = 'Danbooru';
                    }
                }
                
                if (metadata.forge_data.dataset_config?.include?.length > 1) {
                    text = `${metadata.forge_data.dataset_config?.include?.length} Dataset${metadata.forge_data.dataset_config?.include?.length > 1 ? 's' : ''}`;
                }
            }
            infoBadges.push(`<div class="badge forgedata-badge">${icon}<span>${text}</span></div>`);

            if (metadata.forge_data.input_prompt !== undefined)
                infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-pen-nib"></i><span>Prompt</span></div>`);
            if (metadata.forge_data.allCharacters !== undefined) {
                if (metadata.forge_data.input_uc !== undefined && 
                    metadata.forge_data.allCharacters.length > 0 && 
                    metadata.forge_data.allCharacters.some(character => character.uc && character.uc.trim().length > 0)) {
                    infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-ban"></i><span>Multi-UC</span></div>`);
                } else if (metadata.forge_data.append_uc !== undefined) {
                    infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-soap"></i><span>UC</span></div>`);
                }
                if (metadata.forge_data.append_uc !== undefined) 
                    infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-soap"></i><span>UC</span></div>`);
                infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light ${metadata.forge_data.allCharacters.length > 1 ? 'fa-user-group' : 'fa-child'}"></i><span>${metadata.forge_data.allCharacters.length > 1 ? metadata.forge_data.allCharacters.length + ' Characters' : 'Character'}</span></div>`);
            } else {
                if (metadata.forge_data.input_uc !== undefined)
                    infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-ban"></i><span>UC</span></div>`);
                if (metadata.forge_data.append_uc !== undefined)
                    infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-soap"></i><span>UC</span></div>`);                        
            }
            if (metadata.forge_data.append_quality !== undefined)
                infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-crown"></i><span>Quality</span></div>`);
            if (metadata.forge_data.image_source !== undefined)
                infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-scanner-image"></i><span>Reference Image</span></div>`);
            if (metadata.forge_data.image_bias !== undefined)
                infoBadges.push(`<div class="badge forgedata-badge"><i class="fa-light fa-crop"></i><span>NDRB</span></div>`);
            if (metadata.forge_data.mask_compressed !== undefined)
                infoBadges.push(`<div class="badge forgedata-badge"><i class="nai-inpaint"></i><span>InPaint</span></div>`);
            if (metadata.forge_data.vibe_transfer !== undefined && metadata.forge_data.vibe_transfer.length > 0)
                infoBadges.push(`<div class="badge forgedata-badge"><i class="nai-vibe-transfer"></i><span>${metadata.forge_data.vibe_transfer.length > 1 ? metadata.forge_data.vibe_transfer.length + ' Encodings' : 'Vibe Encoding'}</span></div>`);
            if (infoBadges.length > 0) {
                infoRows[4].push(`<div class="form-group"><label for="modelName">Available Data</label><div class="meta-value badge-list">${infoBadges.join('')}</div></div>`);
            }
            if (metadata.forge_data.date_generated) {
                const date = new Date(metadata.forge_data.date_generated);
                infoRows[0].push(`<div class="form-group auto-width"><label class="justify-end" for="modelName">Date</label><div class="meta-value justify-end">${date.toLocaleDateString()}</div></div>`);
            }
        } else {
            let softwareName = metadata.source;
            try {
                const items = softwareName.split(' ');
                const version = items.pop();
                let name = items.slice(0, -1).join(' ');
                if (name.includes('V4')) {
                    name = name.split(' V4')[0];
                }
                softwareName = name;
                if (version) {
                    softwareName += ` (${version})`;
                }
            } catch (e) {
                softwareName = 'NovelAI Diffusion';
            }
            infoRows[0].unshift(`<div class="form-group"><label for="modelName">Software</label><div class="meta-value"><i class="nai-pen-tip-light"></i><span>${softwareName}</span></div></div>`);
        }
        
        const htmlContent = infoRows.filter(row => row.length > 0).map(row => `<div class="form-row">${row.join('')}</div>`).join('');
        blueprintInfo.innerHTML = htmlContent;
    }
}

// Hide blueprint preview
function hideBlueprintPreview() {
    const blueprintPreview = document.getElementById('unifiedUploadBlueprintPreview');
    if (blueprintPreview) {
        blueprintPreview.classList.add('hidden');
    }
}

// Show vibe bundle preview
function showVibeBundlePreview(vibes) {
    console.log('showVibeBundlePreview called with vibes:', vibes);
    
    // Show overlay since we now have vibe data to display
    const overlay = document.querySelector('#unifiedUploadModal .gallery-move-image-info-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
    
    const vibeBundlePreview = document.getElementById('unifiedUploadVibeBundlePreview');
    const vibeBundleList = document.getElementById('unifiedUploadVibeBundleList');
    
    console.log('Vibe bundle preview elements:', vibeBundlePreview ? 'Found' : 'Not found', vibeBundleList ? 'Found' : 'Not found');
    
    if (!vibeBundlePreview || !vibeBundleList) {
        console.error('Vibe bundle preview elements not found');
        return;
    }
    
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
        } else if (vibe.thumbnail) {
            // Use the server-generated thumbnail with indexed filename
            img.src = `/cache/${vibe.thumbnail}.webp`;
        } else {
            img.src = '/static_images/background.jpg';
        }
        img.alt = vibe.name || 'Vibe';

        // Add error handling for failed image loads
        img.onerror = function() {
            this.src = '/static_images/background.jpg';
            console.warn(`Failed to load thumbnail for vibe: ${vibe.name || vibe.id}`);
        };
        
        // Create details section
        const details = document.createElement('div');
        details.className = 'vibe-bundle-item-details';
        
        const name = document.createElement('div');
        name.className = 'vibe-bundle-item-name';
        name.textContent = vibe.name || 'Unnamed Vibe';
        
        const info = document.createElement('div');
        info.className = 'vibe-bundle-item-info';
        
        // Add encoding badges using the same system as gallery - exactly like createVibeManagerGalleryItem
        console.log(`🎵 Processing vibe encodings for ${vibe.name}:`, vibe.encodings);
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
        buttonsContainer.classList.remove('hidden');
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
                input.classList.add('hidden');
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
                input.classList.add('hidden');
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
    
    vibeBundlePreview.classList.remove('hidden');
}

// Hide vibe bundle preview
function hideVibeBundlePreview() {
    const vibeBundlePreview = document.getElementById('unifiedUploadVibeBundlePreview');
    if (vibeBundlePreview) {
        vibeBundlePreview.classList.add('hidden');
    }
}

// Hide mode selector buttons
function hideModeSelector() {
    const modeSelector = document.getElementById('unifiedUploadModeSelector');
    if (modeSelector) {
        modeSelector.classList.add('hide');
    }
}

// Show mode selector buttons
function showModeSelector() {
    const modeSelector = document.getElementById('unifiedUploadModeSelector');
    if (modeSelector) {
        modeSelector.classList.remove('hide');
    }
}

// Update UI for vibe bundle import
function updateUIForVibeFileImport(vibeCount, isBundle) {
    // Hide Open in Editor button for vibe mode
    if (unifiedUploadOpenInEditorBtn) {
        unifiedUploadOpenInEditorBtn.classList.add('hidden');
    }

    // Note: Title and button text are now handled by updateUnifiedUploadMode()
    // to avoid conflicts and ensure consistency
}

// Handle invalid bundle
function handleInvalidBundle(backgroundImage) {
    backgroundImage.src = '/static_images/background.jpg';
    // Invalid bundle handling - could show toast notification instead
    console.warn('Invalid vibe bundle format');
}

// Reset upload modal to default state
function resetUploadModal() {
    const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
    if (backgroundImage) {
        backgroundImage.src = '/static_images/background.jpg';
    }
    
    const modalTitle = document.getElementById('unifiedUploadModalTitle');
    const confirmText = document.getElementById('unifiedUploadConfirmText');
    
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="nai-import"></i> Import File';
    }
    if (confirmText) {
        confirmText.textContent = 'Upload';
    }
    
    hideVibeBundlePreview();
    
    // Reset downloaded file state
    unifiedUploadDownloadedFile = null;
    
    // Hide downloaded file info section
    const downloadedInfo = document.getElementById('unifiedUploadDownloadedInfo');
    if (downloadedInfo) {
        downloadedInfo.classList.add('hidden');
    }
    
    // Reset confirm button state
    const confirmBtn = document.getElementById('unifiedUploadConfirmBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
    }
    
    // Hide Open in Editor button
    if (unifiedUploadOpenInEditorBtn) {
        unifiedUploadOpenInEditorBtn.classList.add('hidden');
    }
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
    
    // Cache browser refresh button
    const cacheBrowserRefreshBtn = document.getElementById('cacheBrowserRefreshBtn');
    if (cacheBrowserRefreshBtn) {
        cacheBrowserRefreshBtn.addEventListener('click', refreshCacheBrowser);
    }

    // Reference manager refresh button
    if (cacheManagerRefreshBtn) {
        cacheManagerRefreshBtn.addEventListener('click', async () => {
            // Show loading overlay for refresh
            if (cacheManagerLoading) cacheManagerLoading.classList.remove('hidden');
            
            try {
                await loadCacheManagerImages();
            } catch (error) {
                console.error('Error refreshing cache manager:', error);
                showError('Failed to refresh cache manager');
            } finally {
                // Hide loading overlay
                if (cacheManagerLoading) cacheManagerLoading.classList.add('hidden');
            }
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
    if (unifiedUploadCancelBtn) unifiedUploadCancelBtn.addEventListener('click', resetUnifiedUploadModal);
    if (unifiedUploadOpenInEditorBtn) unifiedUploadOpenInEditorBtn.addEventListener('click', handleUnifiedUploadOpenInEditor);
    if (unifiedUploadConfirmBtn) unifiedUploadConfirmBtn.addEventListener('click', handleUnifiedUploadConfirm);

    // Navigation controls
    const prevBtn = document.getElementById('unifiedUploadPrevBtn');
    const nextBtn = document.getElementById('unifiedUploadNextBtn');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', async () => {
            if (unifiedUploadCurrentIndex > 0) {
                unifiedUploadCurrentIndex--;
                await updateUnifiedUploadPreview();
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', async () => {
            if (unifiedUploadCurrentIndex < unifiedUploadFiles.length - 1) {
                unifiedUploadCurrentIndex++;
                await updateUnifiedUploadPreview();
            }
        });
    }
    
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

    // Clipboard button click handler for unified upload
    const unifiedUploadClipboardBtn = document.getElementById('unifiedUploadClipboardBtn');
    if (unifiedUploadClipboardBtn) {
        unifiedUploadClipboardBtn.addEventListener('click', handleUnifiedUploadClipboard);
    }

    // Select files button click handler for unified upload
    const unifiedUploadSelectBtn = document.getElementById('unifiedUploadSelectBtn');
    if (unifiedUploadSelectBtn) {
        unifiedUploadSelectBtn.addEventListener('click', () => {
            // Create a hidden file input element
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.multiple = true;
            fileInput.accept = 'image/*,.naiv4vibe,.naiv4vibebundle,.json';
            fileInput.classList.add('hidden');
            
            // Add change event listener
            fileInput.addEventListener('change', handleUnifiedUploadFileChange);
            
            // Append to body temporarily and trigger click
            document.body.appendChild(fileInput);
            fileInput.click();
            
            // Clean up after a short delay
            setTimeout(() => {
                document.body.removeChild(fileInput);
            }, 1000);
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
    const modals = ['cacheManagerModal'];
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

// Helper function to format resolution with aspect ratio matching
function formatResolution(resolution, width, height) {
    if (!resolution && !width && !height) return '';
    
    // If we have a resolution string, try to match it first
    if (resolution) {
        // Handle custom resolution format: custom_1024x768
        if (resolution.startsWith('custom_')) {
            const dimensions = resolution.replace('custom_', '');
            const [w, h] = dimensions.split('x').map(Number);
            if (w && h) {
                return `Custom ${w}×${h}`;
            }
        }
        
        // Try to find the resolution in our array first
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
    
    // If no resolution string but we have dimensions, match by aspect ratio
    if (width && height) {
        const aspect = width / height;
        const tolerance = 0.05; // 5% 
        const exactMatch = RESOLUTIONS.find(r => r.width === width && r.height === height);
        
        if (exactMatch) {
            return exactMatch.display;
        }
        
        const matchedResolution = RESOLUTIONS.find(r => 
            Math.abs(r.aspect - aspect) < tolerance
        );
        
        if (matchedResolution) {
            return matchedResolution.display;
        }
        
        // If no match found, return dimensions
        return `${width} × ${height}`;
    }
    
    return '';
}

// Global variable to store downloaded file info
let unifiedUploadDownloadedFile = null;
// Global variable to store pending URL for download
let unifiedUploadPendingUrl = null;

// Get file information from URL for confirmation dialog
async function getFileInfoFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const protocol = urlObj.protocol;
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || 'Unknown';
        
        // Check if WebSocket is connected
        if (!wsClient || !wsClient.isConnected()) {
            throw new Error('WebSocket not connected to server');
        }
        
        // First, try HEAD method to get basic info
        let headResponse;
        try {
            headResponse = await wsClient.fetchUrlInfo(url, {
                method: 'HEAD',
                timeout: 3000
            }, 'text');
        } catch (error) {
            console.error('❌ WebSocket HEAD request failed:', error);
            // Return error info without throwing
            return `
                <div class="form-group">
                    <label>URL</label>
                    <div class="meta-value">${url}</div>
                </div>
                <div class="form-group">
                    <label>Error</label>
                    <div class="meta-value">Failed to connect to server: ${error.message || 'Unknown error'}</div>
                </div>
            `;
        }
        
        if (headResponse.success) {
            // Extract file size from content-length header
            const contentLength = headResponse.headers['content-length'];

            // Check if we got a content type and size from HEAD request
            let contentType = headResponse.contentType;
            let fileSize = 'Unknown';
            let needsSecondRequest = false;
            
            // Check if we need a second request for missing info
            if (!contentType || contentType === 'application/octet-stream' || contentType === 'application/unknown') {
                needsSecondRequest = true;
            }
            
            // Check if size is missing or 0
            if (!contentLength || parseInt(contentLength) === 0) {
                needsSecondRequest = true;
            }
            
            // If we need a second request, get it
            if (needsSecondRequest) {
                try {
                    // Request first 1KB of the file for type and size detection
                    // The server will stop accepting data after 1KB and cancel the request
                    let typeDetectionResponse;
                    try {
                        typeDetectionResponse = await wsClient.fetchUrlInfo(url, {
                            method: 'GET',
                            timeout: 5000,
                            maxBytes: 1024 // Server will limit response to this many bytes
                        }, 'arraybuffer');
                    } catch (wsError) {
                        console.warn('⚠️ WebSocket GET request failed for type detection:', wsError);
                        // Continue without type detection
                        typeDetectionResponse = { success: false };
                    }
                    
                    if (typeDetectionResponse.success && typeDetectionResponse.data) {
                        // Convert base64 data back to Uint8Array for analysis
                        const binaryString = atob(typeDetectionResponse.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        
                        // Detect file type from magic bytes if we don't have a good one
                        if (!contentType || contentType === 'application/octet-stream' || contentType === 'application/unknown') {
                            contentType = detectFileTypeFromBytes(bytes);
                        }
                        
                        // Use the actual bytes received for size if HEAD didn't provide it
                        if (!contentLength || parseInt(contentLength) > 0) {
                            const sizeInBytes = bytes.length;
                            if (sizeInBytes > (1024 * 1024)) {
                                if (sizeInBytes < 1024 * 1024) {
                                    fileSize = `${(sizeInBytes / 1024).toFixed(1)} KB`;
                                } else if (sizeInBytes < 1024 * 1024 * 1024) {
                                    fileSize = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
                                } else {
                                    fileSize = `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
                                }
                            }
                        }
                        
                        if (typeDetectionResponse.headers['content-encoding'] === 'gzip') {
                            console.warn('⚠️ Response was gzipped - size may be compressed size, not actual file size');
                        }
                    }
                } catch (typeDetectionError) {
                    console.warn('⚠️ Failed to get file content for type/size detection:', typeDetectionError);
                }
            }
            
            // If we still don't have a size, use the contentLength from HEAD
            if (fileSize === 'Unknown' && contentLength) {
                const sizeInBytes = parseInt(contentLength);
                if (sizeInBytes < 1024) {
                    fileSize = `${sizeInBytes} B`;
                } else if (sizeInBytes < 1024 * 1024) {
                    fileSize = `${(sizeInBytes / 1024).toFixed(1)} KB`;
                } else if (sizeInBytes < 1024 * 1024 * 1024) {
                    fileSize = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
                } else {
                    fileSize = `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
                }
            }

            // Check if we need to show a warning
            let warningHTML = '';
            const isExpectedType = contentType && (
                contentType.startsWith('image/') || 
                contentType === 'application/json' ||
                contentType === 'application/octet-stream' // Generic but might be an image
            );
            
            // Check for various warning conditions
            if (!contentType || contentType === 'application/unknown' || !isExpectedType) {
                warningHTML = `
                    <div class="form-group warning-section">
                        <div class="warning-message">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>Warning:</strong> This file type (${formatContentType(contentType)}) may not be supported for import. 
                            Only image files (JPEG, PNG, GIF, WebP) and JSON files are guaranteed to work.
                        </div>
                    </div>
                `;
            } else if (contentType === 'application/octet-stream') {
                warningHTML = `
                    <div class="form-group warning-section">
                        <div class="warning-message info">
                            <i class="fas fa-info-circle"></i>
                            <strong>Note:</strong> This file type is generic. The system will attempt to detect the actual file type, 
                            but import may not work if it's not a supported image or JSON format.
                        </div>
                    </div>
                `;
            }
            
            // Add warning for very small files (might be broken/incomplete)
            if (contentLength && parseInt(contentLength) > 0 && parseInt(contentLength) < 1024) {
                const smallFileWarning = `
                    <div class="form-group warning-section">
                        <div class="warning-message">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>Warning:</strong> This file is very small (${fileSize}). 
                            It may be incomplete, corrupted, or not a valid file. Import may fail.
                        </div>
                    </div>
                `;
                warningHTML += smallFileWarning;
            }
            
            // Format the information display as HTML with form-groups
            return `
                <div class="form-group">
                    <label>URL</label>
                    <div class="meta-value">${url}</div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>File Name</label>
                        <div class="meta-value">${filename}</div>
                    </div>
                    <div class="form-group">
                        <label>Size</label>
                        <div class="meta-value">${fileSize}</div>
                    </div>
                    <div class="form-group">
                        <label>Type</label>
                        <div class="meta-value">${formatContentType(contentType)}</div>
                     </div>
                </div>
                ${warningHTML}
            `;
        } else {
            // Server-side fetch failed, but we still have basic info
            return `
                <div class="form-group">
                    <label>URL</label>
                    <div class="meta-value">${url}</div>
                </div>
                <div class="form-group">
                    <label>Error</label>
                    <div class="meta-value">${headResponse.error || 'Failed to fetch file info'}</div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('❌ Failed to fetch URL info:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        // Fallback if everything fails - try to parse URL manually
        try {
            return `
                <div class="form-group">
                    <label>URL</label>
                    <div class="meta-value">${url}</div>
                </div>
                <div class="form-group">
                    <label>Error</label>
                    <div class="meta-value">Failed to connect to server</div>
                </div>
            `;
        } catch (urlError) {
            // Ultimate fallback if URL parsing fails
            return `
                <div class="form-group">
                    <label>URL</label>
                    <div class="meta-value">${url}</div>
                </div>
            `;
        }
    }
}

// Detect file type from the first few bytes (magic bytes)
function detectFileTypeFromBytes(bytes) {
    if (!bytes || bytes.length < 4) {
        return 'application/unknown';
    }
    
    // Check for image formats
    // JPEG: starts with FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }
    
    // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
        bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
        return 'image/png';
    }
    
    // GIF: starts with 47 49 46 38 (GIF8)
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }
    
    // WebP: starts with 52 49 46 46 (RIFF) followed by WebP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'image/webp';
    }
    
    // Check for JSON: starts with { or [
    if (bytes[0] === 0x7B || bytes[0] === 0x5B) {
        // Additional check: look for more JSON-like content in the first 1KB
        const text = new TextDecoder('utf-8').decode(bytes);
        const trimmedText = text.trim();
        
        // Check if it looks like valid JSON structure
        if ((trimmedText.startsWith('{') && trimmedText.includes('}')) ||
            (trimmedText.startsWith('[') && trimmedText.includes(']'))) {
            return 'application/json';
        }
    }
    
    // If no specific type detected, return unknown
    return 'application/unknown';
}

// Handle clipboard file upload
async function handleClipboardFile(file) {
    try {
        // Add file to files array
        unifiedUploadFiles = [file];
        unifiedUploadCurrentIndex = 0;
        unifiedUploadFileMetadata = [];
        
        // Process all files first to check for blueprint metadata (same logic as handleUnifiedUploadFileChange)
        const metadataPromises = unifiedUploadFiles.map(async (file) => {
            if (file.type === 'image/png') {
                try {
                    const metadata = await extractPNGMetadata(file);
                    if (metadata && metadata.source && metadata.source.includes('NovelAI')) {
                        return { valid: true, metadata };
                    } else {
                        return { 
                            valid: false, 
                            error: 'No Valid NovelAI / StaticForge metadata found' 
                        };
                    }
                } catch (error) {
                    console.warn('Error extracting PNG metadata:', error.message, 'for file:', file.name);
                    return { 
                        valid: false, 
                        error: `Invalid PNG: ${error.message}` 
                    };
                }
            } else {
                return { 
                    valid: false, 
                    error: 'Not a PNG file' 
                };
            }
        });
        
        // Wait for all metadata checks to complete using Promise.allSettled to avoid failing on individual errors
        const metadataResults = await Promise.allSettled(metadataPromises);
        unifiedUploadFileMetadata = metadataResults.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                console.warn('Promise rejected for file:', unifiedUploadFiles[index].name, 'Error:', result.reason);
                return { 
                    valid: false, 
                    error: `Processing failed: ${result.reason.message || result.reason}` 
                };
            }
        });
        
        // Count valid blueprints
        const validBlueprintCount = unifiedUploadFileMetadata.filter(meta => meta.valid).length;
        const hasValidBlueprint = validBlueprintCount > 0;
        
        // ALWAYS enable blueprint mode option if at least one valid blueprint exists
        const modeSliderContainer = document.querySelector('.mode-slider-container');
        if (modeSliderContainer) {
            // Always add the blueprint-enabled class if we have any valid blueprints
            if (hasValidBlueprint) {
                modeSliderContainer.classList.add('blueprint-enabled');
            } else {
                modeSliderContainer.classList.remove('blueprint-enabled');
            }
        }
        
        // If at least one file has valid NovelAI metadata, switch to blueprint mode
        if (hasValidBlueprint) {
            // Switch to blueprint mode
            unifiedUploadCurrentMode = 'blueprint';
            updateUnifiedUploadMode();
            
            // Show warning if some files are invalid
            const warningContainer = document.getElementById('unifiedUploadWarnings');
            if (warningContainer) {
                if (validBlueprintCount < unifiedUploadFiles.length) {
                    const invalidCount = unifiedUploadFiles.length - validBlueprintCount;
                    warningContainer.classList.remove('hidden');
                    warningContainer.querySelector('.warning-message').textContent = 
                        `${invalidCount} of ${unifiedUploadFiles.length} files cannot be imported as blueprints.`;
                } else {
                    warningContainer.classList.add('hidden');
                }
            }
        } else {
            // Clear any existing warnings if no blueprints detected
            const warningContainer = document.getElementById('unifiedUploadWarnings');
            if (warningContainer) {
                warningContainer.classList.add('hidden');
            }
        }
        
        // Show mode selector if we have image files (not just vibe bundles)
        const hasImageFiles = unifiedUploadFiles.some(file => file.type.startsWith('image/'));
        if (hasImageFiles) {
            showModeSelector();
        }
        
        // Hide initial options
        hideInitialUploadOptions();
        
        // Update overlay with file information
        const fileInfo = createFileInfoHTML(unifiedUploadFiles[0], unifiedUploadFiles.length);
        updateUploadOverlayWithFileInfo(fileInfo);
        
        // Process first file immediately
        await updateUnifiedUploadPreview();
        
        // Update background image for clipboard files
        const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
        if (backgroundImage && file) {
            const imageUrl = URL.createObjectURL(file);
            backgroundImage.src = imageUrl;
            backgroundImage.onload = () => URL.revokeObjectURL(imageUrl);
        }
        
        // Enable confirm button
        if (unifiedUploadConfirmBtn) {
            unifiedUploadConfirmBtn.disabled = false;
        }
        
    } catch (error) {
        console.error('Error handling clipboard file:', error);
        showError('Failed to process clipboard file: ' + error.message);
    }
}

// Create HTML for file information display
function createFileInfoHTML(file, fileCount = 1) {
    if (fileCount > 1) {
        return `
            <p><strong>Files Selected:</strong> ${fileCount} file(s)</p>
            <p><strong>First File:</strong> ${file.name}</p>
            <p><strong>File Type:</strong> ${file.type ? formatContentType(file.type) : 'Unknown'}</p>
        `;
    } else {
        const fileSize = file.size ? formatFileSize(file.size) : 'Unknown';
        const fileType = file.type ? formatContentType(file.type) : 'Unknown';
        return `
            <p><strong>File Name:</strong> ${file.name}</p>
            <p><strong>File Size:</strong> ${fileSize}</p>
            <p><strong>File Type:</strong> ${fileType}</p>
        `;
    }
}

// Create HTML for URL information display
function createURLInfoHTML(url, fileInfo) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const protocol = urlObj.protocol;
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || 'Unknown';
        
        // Extract file size from content-length header if available
        let fileSize = 'Unknown';
        if (fileInfo && fileInfo.size) {
            const sizeInBytes = parseInt(fileInfo.size);
            fileSize = formatFileSize(sizeInBytes);
        } else if (fileInfo && fileInfo.headers && fileInfo.headers['content-length']) {
            const sizeInBytes = parseInt(fileInfo.headers['content-length']);
            fileSize = formatFileSize(sizeInBytes);
        } 
        
        // Extract content type
        let contentType = 'Unknown';
        if (fileInfo && fileInfo.contentType) {
            contentType = formatContentType(fileInfo.contentType);
        }
        
        // Format domain with lock icon for HTTPS
        const domainDisplay = protocol === 'https:' ? 
            `<i class="fas fa-lock" style="color: #3db435;"></i> ${domain}` : 
            domain;
        
        return `
            <p><strong>File Size:</strong> ${fileSize}</p>
            <p><strong>File Name:</strong> ${filename}</p>
            <p><strong>File Type:</strong> ${contentType}</p>
        `;
    } catch (error) {
        return `
            <p><strong>URL:</strong> ${url}</p>
            <p><strong>Error:</strong> Failed to parse URL</p>
        `;
    }
}

// Create HTML for URL preview display in modal
function createURLPreviewHTML(url, fileInfo) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const protocol = urlObj.protocol;
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || 'Unknown';
        
        // Extract file size and content type from fileInfo
        // fileInfo can come from getFileInfoFromUrl (which returns HTML) or from download response
        let fileSize = 'Unknown';
        let contentType = 'Unknown';
        
        if (fileInfo) {
            // Check if fileInfo is HTML string (from getFileInfoFromUrl)
            if (typeof fileInfo === 'string' && fileInfo.includes('<div class="meta-value">')) {
                // Parse the HTML to extract values
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = fileInfo;
                
                const labels = tempDiv.querySelectorAll('label');                
                labels.forEach(label => {
                    const labelText = label.textContent.trim();
                    const metaValue = label.nextElementSibling;
                    
                    if (metaValue && metaValue.classList.contains('meta-value')) {
                        if (labelText === 'Size') {
                            fileSize = metaValue.textContent.trim();
                        } else if (labelText === 'Type') {
                            contentType = metaValue.textContent.trim();
                        }
                    }
                });
            } else {
                // fileInfo is an object (from download response)
                if (fileInfo.size) {
                    const sizeInBytes = parseInt(fileInfo.size);
                    fileSize = formatFileSize(sizeInBytes);
                } else if (fileInfo.headers && fileInfo.headers['content-length']) {
                    const sizeInBytes = parseInt(fileInfo.headers['content-length']);
                    fileSize = formatFileSize(sizeInBytes);
                }
                
                if (fileInfo.contentType) {
                    contentType = formatContentType(fileInfo.contentType);
                } else if (fileInfo.headers && fileInfo.headers['content-type']) {
                    contentType = formatContentType(fileInfo.headers['content-type']);
                }
            }
        }
        
        return `
            <div class="form-row">
                <div class="form-group">
                    <label>URL</label>
                    <div class="meta-value url-display">${url}</div>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>File Name</label>
                    <div class="meta-value">${filename}</div>
                </div>
                <div class="form-group auto-width">
                    <label>Size</label>
                    <div class="meta-value">${fileSize}</div>
                </div>
                <div class="form-group auto-width">
                    <label>File Type</label>
                    <div class="meta-value">${contentType}</div>
                </div>
            </div>
        `;
    } catch (error) {
        return `
            <div class="form-group">
                <label>URL</label>
                <div class="meta-value">${url}</div>
            </div>
            <div class="form-group">
                <label>Error</label>
                <div class="meta-value">Failed to parse URL</div>
            </div>
        `;
    }
}

// Show URL preview in main content area
function showUrlPreview(urlPreviewHTML) {
    const urlPreview = document.getElementById('unifiedUploadUrlPreview');
    const urlPreviewContent = document.getElementById('unifiedUploadUrlPreviewContent');
    
    if (urlPreview && urlPreviewContent) {
        urlPreviewContent.innerHTML = urlPreviewHTML;
        urlPreview.classList.remove('hidden');
    }
}

// Hide URL preview
function hideUrlPreview() {
    const urlPreview = document.getElementById('unifiedUploadUrlPreview');
    if (urlPreview) {
        urlPreview.classList.add('hidden');
    }
}

// Handle pending URL download when confirm button is clicked
async function handlePendingUrlDownload() {
    if (!unifiedUploadPendingUrl) return;
    
    // Update cover message for URL download
    showGalleryMoveRightPanelCover('Loading File...');
    
    try {
        // Show loading state
        const confirmBtn = document.getElementById('unifiedUploadConfirmBtn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
            confirmBtn.disabled = true;
        }
        
        // Download the file via websocket
        let response;
        try {
            response = await wsClient.downloadUrlFile(unifiedUploadPendingUrl);
            
            // Check if the response indicates failure even without throwing an error
            if (!response || response.error) {
                throw new Error(response?.error || 'Download failed with no response');
            }
        } catch (error) {
            console.error('❌ WebSocket download error:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // Hide cover overlay on error
            hideGalleryMoveRightPanelCover();
            
            // Reset confirm button
            if (confirmBtn) {
                confirmBtn.innerHTML = '<i class="fas fa-download"></i> Load File';
                confirmBtn.disabled = false;
            }
            
            // Show error toast
            showGlassToast('error', null, (error.message || 'Failed to download file from URL'));
            
            // Reset to initial state on error
            showInitialUploadOptions();
            
            // Clear pending URL
            unifiedUploadPendingUrl = null;
            
            // Hide URL preview
            hideUrlPreview();
            
            // Hide subtitle
            const subtitle = document.getElementById('unifiedUploadModalSubtitle');
            if (subtitle) {
                subtitle.classList.add('hidden');
            }
            
            // Hide footer actions
            const footerActions = document.querySelector('.gallery-move-actions');
            if (footerActions) {
                footerActions.classList.add('hidden');
            }
            
            // Hide site domain display
            const siteDomainDisplay = document.getElementById('unifiedUploadSiteDomain');
            if (siteDomainDisplay) {
                siteDomainDisplay.classList.add('hidden');
            }
            
            return;
        }
        
        if (response.success) {
            // Store downloaded file info
            unifiedUploadDownloadedFile = {
                tempFilename: response.tempFilename,
                originalFilename: response.originalFilename,
                hash: response.hash,
                size: response.size,
                contentType: response.contentType,
                url: response.url,
                type: response.type,
                ...response
            };

            // Debug: Log the downloaded file info
            console.log('📁 Downloaded file info:', unifiedUploadDownloadedFile);
            
            // Clear pending URL
            unifiedUploadPendingUrl = null;
            
            // Hide URL preview
            hideUrlPreview();
            
            // Hide subtitle
            const subtitle = document.getElementById('unifiedUploadModalSubtitle');
            if (subtitle) {
                subtitle.classList.add('hidden');
            }
            
            // Keep site domain visible after download (don't hide it)
            
            // Update overlay with downloaded file information
            const urlInfo = createURLInfoHTML(unifiedUploadDownloadedFile.url, response);
            updateUploadOverlayWithFileInfo(urlInfo);

            console.log('🎯 Download processing complete. Final downloaded file:', unifiedUploadDownloadedFile);
            
            // Set background image for downloaded files
            if (unifiedUploadDownloadedFile.type === 'image') {
                const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
                if (backgroundImage) {
                    // Create a temporary URL for the downloaded file
                    const tempUrl = `/temp/${unifiedUploadDownloadedFile.tempFilename}`;
                    backgroundImage.src = tempUrl;
                }
            }
            
            // Show mode selector if it's an image file (not a vibe bundle)
            if (unifiedUploadDownloadedFile.type === 'image') {
                showModeSelector();
            }
            
            // Update confirm button state
            if (confirmBtn) {
                confirmBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
                confirmBtn.disabled = false;
            }
            
            // Clear any existing file selection to avoid conflicts
            unifiedUploadFiles = [];
            unifiedUploadCurrentIndex = 0;
            unifiedUploadFileMetadata = [];
            
            // Show comment container for downloaded files initially
            const commentContainer = document.getElementById('unifiedUploadCommentInputContainer');
            if (commentContainer) {
                commentContainer.classList.remove('hidden');
            }
            
            // Process metadata based on file type and update UI accordingly
            if (unifiedUploadDownloadedFile.type === 'image' && unifiedUploadDownloadedFile.isBlueprint) {
                showBlueprintMode();
                
                // Ensure metadata is properly structured before showing preview
                if (unifiedUploadDownloadedFile.metadata && typeof unifiedUploadDownloadedFile.metadata === 'object') {
                    showBlueprintPreview(unifiedUploadDownloadedFile.metadata);
                } else {
                    console.warn('Invalid metadata structure for blueprint:', unifiedUploadDownloadedFile.metadata);
                    // Fallback: try to fetch the downloaded file and extract metadata
                    try {
                        const response = await fetch(`/temp/${unifiedUploadDownloadedFile.tempFilename}`);
                        if (response.ok) {
                            const blob = await response.blob();
                            const file = new File([blob], unifiedUploadDownloadedFile.originalFilename || 'downloaded_image.png', { type: 'image/png' });
                            const metadata = await extractPNGMetadata(file);
                            if (metadata && metadata.source && metadata.source.includes('NovelAI')) {
                                showBlueprintPreview(metadata);
                            } else {
                                console.warn('Could not extract valid metadata from downloaded file');
                            }
                        }
                    } catch (error) {
                        console.error('Error extracting metadata from downloaded file:', error);
                    }
                }
                
                // Update mode to blueprint to match file upload behavior
                console.log('🔄 Setting mode to blueprint for non-vibe file');
                unifiedUploadCurrentMode = 'blueprint';
                
                // Update the upload mode to ensure button text and UI are correct
                updateUnifiedUploadMode();
            } else if ((unifiedUploadDownloadedFile.type === 'vibe_bundle' || unifiedUploadDownloadedFile.type === 'vibe_single') && unifiedUploadDownloadedFile.jsonData) {
                // Show vibe file preview (bundle or single) using raw JSON data
                console.log('🎵 Processing vibe file with raw JSON data');
                console.log('🎵 Vibe file type:', unifiedUploadDownloadedFile.type, 'has jsonData:', !!unifiedUploadDownloadedFile.jsonData);

                // Set mode to vibe for proper UI handling
                unifiedUploadCurrentMode = 'vibe';
                updateUnifiedUploadMode();

                // Hide mode selection for vibe files (like file uploads do)
                hideModeSelector();

                // Process the raw JSON data the same way as locally uploaded files
                try {
                    const detectionResult = detectAndParseVibeFile(unifiedUploadDownloadedFile.jsonData);
                    if (detectionResult.isValid) {
                        showVibeBundlePreview(detectionResult.vibes);
                    } else {
                        console.warn('Invalid vibe file format:', detectionResult.error);
                        handleInvalidBundle(backgroundImage);
                    }
                } catch (error) {
                    console.error('Error processing vibe JSON data:', error);
                    handleInvalidBundle(backgroundImage);
                }
                
                // Update UI for bundle import
                const detectionResult = detectAndParseVibeFile(unifiedUploadDownloadedFile.jsonData);
                if (detectionResult.isValid) {
                    updateUIForVibeFileImport(detectionResult.vibes.length, unifiedUploadDownloadedFile.isBundle);
                }

                // Update the preview to show the vibe background image
                await updateUnifiedUploadPreview();
            }
            
            // Hide cover overlay after successful download
            hideGalleryMoveRightPanelCover();
            
        } else {
            // Show error toast for server-side errors
            showGlassToast('error', null, (response.error || response.message || 'Download failed'));
            
            // Hide cover overlay on failure
            hideGalleryMoveRightPanelCover();
            
            // Reset confirm button
            if (confirmBtn) {
                confirmBtn.innerHTML = '<i class="fas fa-download"></i> Load File';
                confirmBtn.disabled = false;
            }
            
            // Reset to initial state on failure
            showInitialUploadOptions();
            
            // Clear pending URL
            unifiedUploadPendingUrl = null;
            
            // Hide URL preview
            hideUrlPreview();
            
            // Hide subtitle
            const subtitle = document.getElementById('unifiedUploadModalSubtitle');
            if (subtitle) {
                subtitle.classList.add('hidden');
            }
            
            // Hide footer actions
            const footerActions = document.querySelector('.gallery-move-actions');
            if (footerActions) {
                footerActions.classList.add('hidden');
            }
            
            // Hide site domain display on failure
            const siteDomainDisplay = document.getElementById('unifiedUploadSiteDomain');
            if (siteDomainDisplay) {
                siteDomainDisplay.classList.add('hidden');
            }
        }
        
    } catch (error) {
        // Show error toast
        showGlassToast('error', null, 'Download failed: ' + (error.message || 'Unknown error'));
        
        // Hide cover overlay on error
        hideGalleryMoveRightPanelCover();
        
        // Reset confirm button
        const confirmBtn = document.getElementById('unifiedUploadConfirmBtn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '<i class="fas fa-download"></i> Load File';
            confirmBtn.disabled = false;
        }
        
        // Reset to initial state on error
        showInitialUploadOptions();
        
        // Clear pending URL
        unifiedUploadPendingUrl = null;
        
        // Hide URL preview
        hideUrlPreview();
        
        // Hide subtitle
        const subtitle = document.getElementById('unifiedUploadModalSubtitle');
        if (subtitle) {
            subtitle.classList.add('hidden');
        }
        
        // Hide footer actions
        const footerActions = document.querySelector('.gallery-move-actions');
        if (footerActions) {
            footerActions.classList.add('hidden');
        }
        
        // Hide site domain display on error
        const siteDomainDisplay = document.getElementById('unifiedUploadSiteDomain');
        if (siteDomainDisplay) {
            siteDomainDisplay.classList.add('hidden');
        }
    }
}

// Handle clipboard paste for URL download or file
async function handleUnifiedUploadClipboard() {
    try {
        // Check if clipboard API is available
        if (!navigator.clipboard) {
            showError('Clipboard API not available in this browser. Please copy and paste the URL manually.');
            return;
        }

        // Try to read clipboard items (files first)
        try {
            const clipboardItems = await navigator.clipboard.read();
            
            // Check if there are files in the clipboard
            for (const item of clipboardItems) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        // Handle clipboard image file
                        const blob = await item.getType(type);
                        const file = new File([blob], `clipboard-image.${type.split('/')[1]}`, { type });
                        
                        // Set the file size explicitly since File constructor from blob doesn't set it
                        Object.defineProperty(file, 'size', {
                            value: blob.size,
                            writable: false
                        });
                        
                        // Process as a file upload
                        await handleClipboardFile(file);
                        return;
                    }
                }
            }
        } catch (clipboardError) {
            console.warn('Clipboard.read() failed, falling back to text:', clipboardError);
        }

        // Read clipboard text (for URLs)
        let clipboardText = await navigator.clipboard.readText();
        if (!clipboardText) {
            showError('No text found in clipboard.');
            return;
        }
        clipboardText = clipboardText.trim();

        // Check if it looks like a URL
        if (!clipboardText.startsWith('http') && !clipboardText.startsWith('https://')) {
            showError('Clipboard content does not appear to be a valid URL. Please copy a valid image URL.');
            return;
        }

        // Get file information to display in modal
        const fileInfo = await getFileInfoFromUrl(clipboardText);
        
        // Store the URL for later download
        unifiedUploadPendingUrl = clipboardText;
        
        // Hide initial options
        hideInitialUploadOptions();
        
        // Show subtitle with "Download URL"
        const subtitle = document.getElementById('unifiedUploadModalSubtitle');
        const subtitleText = document.getElementById('unifiedUploadModalSubtitleText');
        if (subtitle && subtitleText) {
            subtitleText.textContent = 'Download URL';
            subtitle.classList.remove('hidden');
        }
        
        // Show site domain in footer
        const siteDomainDisplay = document.getElementById('unifiedUploadSiteDomain');
        const siteDomainText = document.getElementById('unifiedUploadSiteDomainText');
        if (siteDomainDisplay && siteDomainText) {
            const urlObj = new URL(clipboardText);
            const domain = urlObj.hostname;
            const protocol = urlObj.protocol;
            const domainDisplay = protocol === 'https:' ? 
                `<i class="fas fa-lock"></i> ${domain}` : 
                `<i class="fas fa-fa-exclamation-triangle"></i> ${domain}`;
            siteDomainText.innerHTML = domainDisplay;
            siteDomainDisplay.classList.remove('hidden');
        }
        
        // Show URL preview in main content area
        const urlPreview = createURLPreviewHTML(clipboardText, fileInfo);
        showUrlPreview(urlPreview);
        
        // Show footer actions with download/cancel buttons
        const footerActions = document.querySelector('.gallery-move-actions');
        if (footerActions) {
            footerActions.classList.remove('hidden');
        }
        
        // Hide Open in Editor button for URL downloads
        if (unifiedUploadOpenInEditorBtn) {
            unifiedUploadOpenInEditorBtn.classList.add('hidden');
        }
        
        // Update confirm button to show download state
        if (unifiedUploadConfirmBtn) {
            unifiedUploadConfirmBtn.innerHTML = '<i class="fas fa-download"></i> Load File';
            unifiedUploadConfirmBtn.disabled = false;
        }
        
        // Keep comment container hidden during URL preview
        const commentContainer = document.getElementById('unifiedUploadCommentInputContainer');
        if (commentContainer) {
            commentContainer.classList.add('hidden');
        }
        
        // Set background to show URL preview
        const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
        if (backgroundImage) {
            backgroundImage.src = '/static_images/background.jpg';
        }
    } catch (error) {
        console.error('Clipboard download error:', error);
        showGlassToast('error', null, 'Failed to download file from clipboard: ' + (error.message || 'Unknown error'));
    } finally {

    }
}



// Show initial upload options
function showInitialUploadOptions() {
    const initialOptions = document.getElementById('unifiedUploadInitialOptions');
    
    if (initialOptions) {
        initialOptions.classList.remove('hidden');
    }
    
    // Hide URL preview when showing initial options
    hideUrlPreview();
    
    // Hide subtitle when showing initial options
    const subtitle = document.getElementById('unifiedUploadModalSubtitle');
    if (subtitle) {
        subtitle.classList.add('hidden');
    }
    
    // Hide site domain display when showing initial options
    const siteDomainDisplay = document.getElementById('unifiedUploadSiteDomain');
    if (siteDomainDisplay) {
        siteDomainDisplay.classList.add('hidden');
    }
}

// Hide initial upload options
function hideInitialUploadOptions() {
    const initialOptions = document.getElementById('unifiedUploadInitialOptions');
    
    if (initialOptions) {
        initialOptions.classList.add('hidden');
    }
}

// Reset upload overlay content
function resetUploadOverlay() {
    const overlayContent = document.getElementById('unifiedUploadOverlayContent');
    const fileInfo = document.getElementById('unifiedUploadFileInfo');
    const overlay = document.querySelector('#unifiedUploadModal .gallery-move-image-info-overlay');
    
    if (overlayContent) {
        overlayContent.classList.remove('hidden');
    }
    if (fileInfo) {
        fileInfo.classList.add('hidden');
        fileInfo.innerHTML = '';
    }
    if (overlay) {
        overlay.classList.add('hidden');
    }
    
    // Hide URL preview
    hideUrlPreview();
    
    // Hide subtitle
    const subtitle = document.getElementById('unifiedUploadModalSubtitle');
    if (subtitle) {
        subtitle.classList.add('hidden');
    }
    
    // Hide site domain display
    const siteDomainDisplay = document.getElementById('unifiedUploadSiteDomain');
    if (siteDomainDisplay) {
        siteDomainDisplay.classList.add('hidden');
    }
    
    // Clear pending URL
    unifiedUploadPendingUrl = null;
}

// Update overlay with file information
function updateUploadOverlayWithFileInfo(fileInfo) {
    const overlayContent = document.getElementById('unifiedUploadOverlayContent');
    const fileInfoDiv = document.getElementById('unifiedUploadFileInfo');
    const overlay = document.querySelector('#unifiedUploadModal .gallery-move-image-info-overlay');
    
    if (overlayContent) {
        overlayContent.classList.add('hidden');
    }
    if (fileInfoDiv) {
        fileInfoDiv.classList.remove('hidden');
        fileInfoDiv.innerHTML = fileInfo;
    }
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

// Reset unified upload modal to initial state
function resetUnifiedUploadModal() {
    // Reset form
    if (unifiedUploadIeInput) unifiedUploadIeInput.value = '0.35';
    if (unifiedUploadConfirmBtn) {
        unifiedUploadConfirmBtn.disabled = true;
        unifiedUploadConfirmBtn.innerHTML = '<span id="unifiedUploadConfirmText">Upload</span> <i class="fas fa-upload"></i>';
    }
    
    // Reset modal title to initial state
    const modalTitle = document.getElementById('unifiedUploadModalTitle');
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="nai-import"></i> Import File';
    }
    
    // Reset downloaded file state
    unifiedUploadDownloadedFile = null;
    
    // Reset pending URL state
    unifiedUploadPendingUrl = null;
    
    // Hide downloaded file info section
    const downloadedInfo = document.getElementById('unifiedUploadDownloadedInfo');
    if (downloadedInfo) {
        downloadedInfo.classList.add('hidden');
    }
    
    // Reset comment input
    const commentInput = document.getElementById('unifiedUploadCommentInput');
    if (commentInput) commentInput.value = '';
    
    // Reset mode to reference
    unifiedUploadCurrentMode = 'reference';
    
    // Reset UI elements
    hideModeSelector();
    hideVibeBundlePreview();
    hideBlueprintPreview();
    resetUploadModal();
    updateUnifiedUploadMode();
    
    // Reset files array
    unifiedUploadFiles = [];
    unifiedUploadCurrentIndex = 0;
    unifiedUploadFileMetadata = [];
    
    // Show initial upload options
    showInitialUploadOptions();
    
    // Hide comment container when resetting
    const commentContainer = document.getElementById('unifiedUploadCommentInputContainer');
    if (commentContainer) {
        commentContainer.classList.add('hidden');
    }
    
    // Hide footer actions when resetting
    const footerActions = document.querySelector('.gallery-move-actions');
    if (footerActions) {
        footerActions.classList.add('hidden');
    }
    
    // Hide Open in Editor button when resetting
    if (unifiedUploadOpenInEditorBtn) {
        unifiedUploadOpenInEditorBtn.classList.add('hidden');
    }
    
    // Reset overlay content
    resetUploadOverlay();
    
    // Reset background image
    const backgroundImage = document.getElementById('unifiedUploadBackgroundImage');
    if (backgroundImage) {
        backgroundImage.src = '/static_images/background.jpg';
    }
    
    // Reset navigation buttons
    const navContainer = document.getElementById('unifiedUploadNavigation');
    if (navContainer) {
        navContainer.classList.add('hidden');
    }
    
    // Reset any warning indicators
    const warningContainer = document.getElementById('unifiedUploadWarnings');
    if (warningContainer) {
        warningContainer.classList.add('hidden');
        warningContainer.innerHTML = '';
    }
    
    // Reset blueprint enabled state
    const modeSliderContainer = document.querySelector('.mode-slider-container');
    if (modeSliderContainer) {
        modeSliderContainer.classList.remove('blueprint-enabled');
    }
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return 'No Data';
    if (bytes === null || bytes === undefined) return 'Unknown';
    if (isNaN(bytes)) return 'Invalid Size';
    
    const k = 1024;
    const sizes = ['', 'K', 'M', 'G'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    const result = parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i] + 'B';
    return result;
}

// Helper function to format content type in a user-friendly way
function formatContentType(contentType) {
    if (!contentType || contentType === 'Unknown') {
        return 'Unknown';
    }
    
    // Common content type mappings for better readability
    const typeMappings = {
        // Images
        'image/jpeg': 'JPEG Image',
        'image/jpg': 'JPEG Image',
        'image/png': 'PNG Image',
        'image/gif': 'GIF Image',
        'image/webp': 'WebP Image',
        'application/json': 'Object File',
        'application/octet-stream': 'Binary File',
        'application/x-binary': 'Binary File',
        'application/unknown': 'Unknown Type'
    };
    
    // Check if we have a direct mapping
    if (typeMappings[contentType]) {
        return typeMappings[contentType];
    }
    
    // For unknown types, try to extract and format the main type and subtype
    // Handle MIME types with parameters like charset, boundary, etc.
    const cleanContentType = contentType.split(';')[0].trim(); // Remove parameters
    const parts = cleanContentType.split('/');
    
    if (parts.length === 2) {
        const mainType = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        const subType = parts[1].toUpperCase();
        
        // Check if we have a mapping for the clean type
        if (typeMappings[cleanContentType]) {
            return typeMappings[cleanContentType];
        }
        
        return `<i class="fas fa-question-circle"></i> ${mainType}/${subType}`;
    }
    
    // Fallback to original content type
    return contentType;
}

// Helper function to get current workspace ID
function getCurrentWorkspaceId() {
    // Try to get from cache manager if open
    if (window.cacheManagerCurrentWorkspace) {
        return window.cacheManagerCurrentWorkspace;
    }
    
    // Try to get from workspace selector if available
    const workspaceSelector = document.querySelector('.workspace-selector .custom-dropdown-btn span');
    if (workspaceSelector && workspaceSelector.textContent) {
        // This is a simplified approach - in a real implementation you'd want to map display names to IDs
        return 'default';
    }
    
    // Default fallback
    return 'default';
}

// Function to refresh cache browser with loading overlay
async function refreshCacheBrowser() {
    if (!cacheBrowserContainer || cacheBrowserContainer.classList.contains('hidden')) return;
    
    // Show loading overlay
    if (cacheBrowserLoadingContainer) {
        cacheBrowserLoadingContainer.classList.remove('hidden');
    }
    
    try {
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error refreshing cache browser:', error);
        showError('Failed to refresh cache browser');
    } finally {
        // Hide loading overlay
        if (cacheBrowserLoadingContainer) {
            cacheBrowserLoadingContainer.classList.add('hidden');
        }
    }
}

// Create director session with selected image
async function createDirectorSessionWithImage(cacheImage) {
    try {
        // Show confirmation dialog
        const result = await showConfirmationDialog(
            `Create a new director session with this image using Grok 4?`,
            [
                { text: 'Create Session', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );

        if (!result) {
            return; // User cancelled
        }

        // Only support actual cache files that exist on disk
        if (cacheImage.isStandalone) {
            showError('Cannot create director session with standalone vibes. Only actual cache files are supported.');
            return;
        }
        
        // For cache images, use cache: format (they are stored in cache upload directory)
        const imageFilename = `cache:${cacheImage.hash}`;

        // Show persistent toast notification
        const toastId = showGlassToast('info', 'Creating Director Session', 'Creating director session...', true, false, 'nai-sparkles');

        // Send WebSocket request to create director session
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'director_create_session',
                requestId: Date.now().toString(),
                model: 'grok-4',
                maxResolution: false,
                imageFilename: imageFilename
            });
            
            // Update toast to success (existing listener will handle the response)
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Director Session Created',
                message: 'Director session created successfully! Open the editor to access the new session.',
                customIcon: '<i class="xai-icon"></i>',
                showProgress: false
            });
        } else {
            // Update toast to error
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Connection Error',
                message: 'WebSocket not connected. Please refresh the page and try again.',
                customIcon: '<i class="xai-icon"></i>',
                showProgress: false
            });
        }
    } catch (error) {
        console.error('Error creating director session:', error);
        showError('Failed to create director session: ' + error.message);
    }
}

// Replace reference with last generated image
async function replaceReferenceWithLastGenerated(cacheImage) {
    try {
        // Check if there's a current manual preview image
        if (!window.currentManualPreviewImage) {
            showError('No generated image found. Please generate an image first.');
            return;
        }

        // Get the image filename to read from disk
        const filename = window.currentManualPreviewImage.upscaled || window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original;

        if (!filename) {
            showError('Could not determine image filename for replacement.');
            return;
        }

        // Get current workspace
        const currentWorkspaceId = getCurrentWorkspaceId();

        // Show loading state
        showGlassToast('info', 'Replacing reference...', '', false);

        // Call websocket to replace the reference using the filename
        // The server will read the image from the images directory
        const result = await window.wsClient.replaceReference(cacheImage.hash, null, currentWorkspaceId, filename);

        if (result.data && result.data.success) {
            // Show success message
            showGlassToast('success', 'Reference replaced successfully', '', true);

            // Refresh the cache browser to show the updated reference
            setTimeout(() => {
                refreshCacheBrowser();
            }, 500);
        } else {
            throw new Error(result.data?.message || 'Failed to replace reference');
        }

    } catch (error) {
        console.error('Error replacing reference:', error);
        showError('Failed to replace reference: ' + error.message);
    }
}

// Expose functions globally
window.addAsBaseImage = addAsBaseImage;
window.refreshCacheBrowser = refreshCacheBrowser;
window.createDirectorSessionWithImage = createDirectorSessionWithImage;

window.wsClient.registerInitStep(40, 'Initializing reference manager', async () => {
    await initializeCacheManager();
});

