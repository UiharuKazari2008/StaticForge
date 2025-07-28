const cacheBrowserContainer = document.getElementById('cacheBrowserContainer');
const cacheBrowserLoadingContainer = document.getElementById('cacheBrowserLoadingContainer');
const cacheGalleryContainer = document.getElementById('cacheGalleryContainer');
const referencesTab = document.getElementById('references-tab');
const vibeReferencesGalleryContainer = document.getElementById('vibeReferencesGalleryContainer');
const vibeReferencesTab = document.getElementById('vibe-references-tab');
const cacheManagerModal = document.getElementById('cacheManagerModal');
const cacheManagerUploadModal = document.getElementById('cacheManagerUploadModal');
const cacheManagerMoveModal = document.getElementById('cacheManagerMoveModal');
const cacheManagerDeleteModal = document.getElementById('cacheManagerDeleteModal');
const vibeManagerModal = document.getElementById('vibeManagerModal');
const vibeManagerUploadModal = document.getElementById('vibeManagerUploadModal');
const vibeManagerIeModal = document.getElementById('vibeManagerIeModal');
const vibeManagerModelDropdown = document.getElementById('vibeManagerModelDropdown');
const vibeManagerIeModelDropdown = document.getElementById('vibeManagerIeModelDropdown');
const vibeManagerFromReferenceModelDropdown = document.getElementById('vibeManagerFromReferenceModelDropdown');
const cacheManagerBtn = document.getElementById('cacheManagerBtn');
const closeCacheManagerBtn = document.getElementById('closeCacheManagerBtn');
const closeCacheManagerMoveModalBtn = document.getElementById('closeCacheManagerMoveModalBtn');
const cacheManagerRefreshBtn = document.getElementById('cacheManagerRefreshBtn');
const cacheManagerUploadDropdownBtn = document.getElementById('cacheManagerUploadDropdownBtn');
const cacheManagerUploadDropdownMenu = document.getElementById('cacheManagerUploadDropdownMenu');
const closeVibeManagerUploadModalBtn = document.getElementById('closeVibeManagerUploadModalBtn');
const closeCacheManagerUploadBtn = document.getElementById('closeCacheManagerUploadBtn');
const cacheManagerUploadCancelBtn = document.getElementById('cacheManagerUploadCancelBtn');
const cacheManagerUploadConfirmBtn = document.getElementById('cacheManagerUploadConfirmBtn');
const cacheManagerFileInput = document.getElementById('cacheManagerFileInput');
const vibeManagerUploadCancelBtn = document.getElementById('vibeManagerUploadCancelBtn');
const vibeManagerUploadConfirmBtn = document.getElementById('vibeManagerUploadConfirmBtn');
const vibeManagerFileInput = document.getElementById('vibeManagerFileInput');
const vibeManagerIeInput = document.getElementById('vibeManagerIeInput');
const vibeManagerModelDropdownBtn = document.getElementById('vibeManagerModelDropdownBtn');
const vibeManagerModelDropdownMenu = document.getElementById('vibeManagerModelDropdownMenu');
const vibeManagerIeModelDropdownBtn = document.getElementById('vibeManagerIeModelDropdownBtn');
const vibeManagerIeModelDropdownMenu = document.getElementById('vibeManagerIeModelDropdownMenu');
const vibeManagerFromReferenceModelDropdownBtn = document.getElementById('vibeManagerFromReferenceModelDropdownBtn');
const vibeManagerFromReferenceModelDropdownMenu = document.getElementById('vibeManagerFromReferenceModelDropdownMenu');
const closeVibeManagerIeModalBtn = document.getElementById('closeVibeManagerIeModalBtn');
const closeVibeManagerMoveModalBtn = document.getElementById('closeVibeManagerMoveModalBtn');
const closeVibeManagerDeleteModalBtn = document.getElementById('closeVibeManagerDeleteModalBtn');
const closeVibeManagerFromReferenceModalBtn = document.getElementById('closeVibeManagerFromReferenceModalBtn');
const vibeManagerIeInput2 = document.getElementById('vibeManagerIeInput2');
const vibeManagerFromReferenceIeInput = document.getElementById('vibeManagerFromReferenceIeInput');
const vibeManagerFromReferenceCancelBtn = document.getElementById('vibeManagerFromReferenceCancelBtn');
const vibeManagerFromReferenceConfirmBtn = document.getElementById('vibeManagerFromReferenceConfirmBtn');
const vibeManagerDeleteCancelBtn = document.getElementById('vibeManagerDeleteCancelBtn');
const vibeManagerDeleteConfirmBtn = document.getElementById('vibeManagerDeleteConfirmBtn');
const cacheManagerMoveCancelBtn = document.getElementById('cacheManagerMoveCancelBtn');
const cacheManagerMoveConfirmBtn = document.getElementById('cacheManagerMoveConfirmBtn');
const vibeManagerMoveCancelBtn = document.getElementById('vibeManagerMoveCancelBtn');
const vibeManagerMoveConfirmBtn = document.getElementById('vibeManagerMoveConfirmBtn');
const vibeManagerMoveModalBtn = document.getElementById('vibeManagerMoveModalBtn');

// Additional elements that were being accessed inside functions
const manualStrengthGroup = document.getElementById('manualStrengthGroup');
const manualNoiseGroup = document.getElementById('manualNoiseGroup');
const cacheManagerWorkspaceDropdown = document.getElementById('cacheManagerWorkspaceDropdown');
const cacheManagerWorkspaceDropdownBtn = document.getElementById('cacheManagerWorkspaceDropdownBtn');
const cacheManagerWorkspaceDropdownMenu = document.getElementById('cacheManagerWorkspaceDropdownMenu');
const cacheManagerWorkspaceSelected = document.getElementById('cacheManagerWorkspaceSelected');
const cacheManagerLoading = document.getElementById('cacheManagerLoading');
const cacheManagerGallery = document.getElementById('cacheManagerGallery');
const cacheManagerMoveBtn = document.getElementById('cacheManagerMoveBtn');
const cacheManagerUploadProgress = document.getElementById('cacheManagerUploadProgress');
const cacheManagerProgressFill = document.getElementById('cacheManagerProgressFill');
const cacheManagerProgressText = document.getElementById('cacheManagerProgressText');
const cacheManagerMoveCount = document.getElementById('cacheManagerMoveCount');
const cacheManagerMoveTargetSelect = document.getElementById('cacheManagerMoveTargetSelect');
const vibeManagerModelSelected = document.getElementById('vibeManagerModelSelected');
const vibeManagerIeModelSelected = document.getElementById('vibeManagerIeModelSelected');
const vibeManagerFromReferenceModal = document.getElementById('vibeManagerFromReferenceModal');
const vibeManagerFromReferencePreview = document.getElementById('vibeManagerFromReferencePreview');
const vibeManagerFromReferenceModelSelected = document.getElementById('vibeManagerFromReferenceModelSelected');
const vibeManagerDeleteModal = document.getElementById('vibeManagerDeleteModal');
const vibeManagerMoveModal = document.getElementById('vibeManagerMoveModal');
const vibeManagerGallery = document.getElementById('vibeManagerGallery');
const vibeManagerLoading = document.getElementById('vibeManagerLoading');
const vibeManagerMoveCount = document.getElementById('vibeManagerMoveCount');
const vibeManagerMoveTargetSelect = document.getElementById('vibeManagerMoveTargetSelect');
const vibeManagerIeCancelBtn = document.getElementById('vibeManagerIeCancelBtn');
const vibeManagerIeConfirmBtn = document.getElementById('vibeManagerIeConfirmBtn');

// Reference Browser Functions
let cacheImages = [];
let cacheCurrentPage = 1;
let cacheImagesPerPage = 20;

// Vibe References Functions
let vibeReferences = [];
let vibeReferencesGallery = null;

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
        await loadVibeReferences();
        displayCacheImagesContainer();
        displayVibeReferencesContainer();
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
        const response = await fetchWithAuth('/references', {
            method: 'OPTIONS'
        });
        if (response.ok) {
            cacheImages = await response.json();
            console.log('Loaded cache images:', cacheImages.length, 'items');
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

function displayVibeReferencesContainer() {
    if (!vibeReferencesGalleryContainer) return;

    vibeReferencesGalleryContainer.innerHTML = '';

    const thisVibeReferences = vibeReferences.filter(vibeRef => vibeRef.workspaceId === 'default' || vibeRef.workspaceId === activeWorkspace);

    if (thisVibeReferences.length === 0) {
        vibeReferencesGalleryContainer.innerHTML = `
        <div class="no-images">
            <i class="fas fa-binary-slash"></i>
            <span>No vibe encodings found</span>
        </div>
    `;
        return;
    }

    // Separate default workspace items from current workspace items
    const currentWorkspaceItems = [];
    const defaultWorkspaceItems = [];

    thisVibeReferences.forEach(vibeRef => {
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
    if (thisVibeReferences.length <= 3) {
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
    const vibeReferencesGallery = vibeReferencesTab ? vibeReferencesTab.querySelector('#vibeReferencesGallery') : null;
    const thisVibeReferences = vibeReferences.filter(vibeRef => vibeRef.workspaceId === 'default' || vibeRef.workspaceId === activeWorkspace);

    if (!vibeReferencesGallery) return;

    vibeReferencesGallery.innerHTML = '';

    if (thisVibeReferences.length === 0) {
        vibeReferencesGallery.innerHTML = `
        <div class="no-images">
            <i class="fas fa-binary-slash"></i>
            <span>No vibe encodings found</span>
        </div>
    `;
        return;
    }

    // Separate default workspace items from current workspace items
    const currentWorkspaceItems = [];
    const defaultWorkspaceItems = [];

    thisVibeReferences.forEach(vibeRef => {
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
    if (thisVibeReferences.length <= 3) {
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
    deleteBtn.className = 'btn-secondary blur';
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

async function addVibeReferenceToContainer(vibeId, selectedIe, strength) {imageBiasHidden
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

function refreshVibeReferences() {
    // Refresh vibe references in the gallery (both modal and container versions)
    if (vibeReferences && vibeReferences.length > 0) {
        displayVibeReferences();
        displayVibeReferencesContainer();
    }
}

// Cache Browser Tab Functions
function switchCacheBrowserTab(tabName, tabTitle) {
    // Update tab buttons (both modal and container versions)
    const tabButtons = document.querySelectorAll('.cache-browser-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
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

    document.getElementById('cacheBrowserTabTitle').textContent = tabTitle;
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
    const confirmed = await showConfirmationDialog(
        'Are you sure you want to delete this cache image?',
        'Delete',
        'Cancel'
    );

    if (!confirmed) return;

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

            showGlassToast('success', null, 'Reference deleted');
        } else {
            throw new Error(`Failed to delete cache image: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error deleting cache image:', error);
        showError('Failed to delete cache image');
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

    // Load vibe encodings for current workspace
    loadVibeManagerImages();

    if (cacheManagerModal) {
        openModal(cacheManagerModal);
    }
}

function hideCacheManagerModal() {
    if (cacheManagerModal) {
        closeModal(cacheManagerModal);
    }

    // Reset state
    cacheManagerSelectedImages.clear();
    cacheManagerIsSelectionMode = false;
}

function setupCacheManagerTabs() {
    const tabButtons = document.querySelectorAll('.cache-manager-tabs .gallery-toggle-btn');

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
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
            
            switchCacheManagerTab(targetTab, tabTitle);
        });
    });
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
                loadVibeManagerImages();

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
    if (!cacheManagerGallery) return;

    if (cacheManagerSelectedImages.size > 0) {
        cacheManagerIsSelectionMode = true;
        cacheManagerGallery.classList.add('selection-mode');
        if (cacheManagerMoveBtn) cacheManagerMoveBtn.style.display = 'inline-block';
    } else {
        cacheManagerIsSelectionMode = false;
        cacheManagerGallery.classList.remove('selection-mode');
        if (cacheManagerMoveBtn) cacheManagerMoveBtn.style.display = 'none';
    }
}

function updateCacheManagerGallerySelection() {
    if (!cacheManagerGallery) return;

    const items = cacheManagerGallery.querySelectorAll('.cache-manager-gallery-item');
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
    const confirmed = await showConfirmationDialog(
        'Are you sure you want to delete this cache image?',
        'Delete',
        'Cancel'
    );

    if (!confirmed) return;

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

            showGlassToast('success', null, 'Reference deleted');
        } else {
            throw new Error(`Failed to delete cache image: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error deleting cache manager image:', error);
        showError('Failed to delete cache image');
    }
}

function showCacheManagerUploadModal() {
    if (cacheManagerUploadModal) {
        openModal(cacheManagerUploadModal);
    }

    // Reset form
    if (cacheManagerFileInput) cacheManagerFileInput.value = '';
    if (cacheManagerUploadConfirmBtn) cacheManagerUploadConfirmBtn.disabled = true;
    if (cacheManagerUploadProgress) cacheManagerUploadProgress.style.display = 'none';
}

function hideCacheManagerUploadModal() {
    if (cacheManagerUploadModal) {
        closeModal(cacheManagerUploadModal);
    }
}

async function uploadCacheManagerImages() {
    if (!cacheManagerFileInput || !cacheManagerFileInput.files.length) return;

    const files = Array.from(cacheManagerFileInput.files);
    cacheManagerUploadConfirmBtn.disabled = true;
    cacheManagerUploadProgress.style.display = 'flex';

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
            if (cacheManagerProgressFill) cacheManagerProgressFill.style.width = `${percent}%`;
            if (cacheManagerProgressText) cacheManagerProgressText.textContent = `${percent}% (${i + 1}/${files.length})`;
        }

        if (uploadedCount > 0) {
            showGlassToast('success', null, `${uploadedCount} image(s) uploaded`);
            hideCacheManagerUploadModal();
            loadCacheManagerImages(); // Refresh the gallery
        } else {
            showError('No images were uploaded successfully');
        }
    } catch (error) {
        console.error('Error uploading cache images:', error);
        showError('Failed to upload images');
    } finally {
        cacheManagerUploadConfirmBtn.disabled = false;
        cacheManagerUploadProgress.style.display = 'none';
    }
}

function showCacheManagerMoveModal() {
    if (cacheManagerSelectedImages.size === 0) {
        showError('Please select images to move');
        return;
    }

    if (!cacheManagerMoveModal || !cacheManagerMoveCount || !cacheManagerMoveTargetSelect) return;

    cacheManagerMoveCount.textContent = cacheManagerSelectedImages.size;

    // Populate target workspace options
    cacheManagerMoveTargetSelect.innerHTML = '';
    workspaces.forEach(workspace => {
        if (workspace.id !== cacheManagerCurrentWorkspace) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            cacheManagerMoveTargetSelect.appendChild(option);
        }
    });

    openModal(cacheManagerMoveModal);
}

function hideCacheManagerMoveModal() {
    if (cacheManagerMoveModal) {
        closeModal(cacheManagerMoveModal);
    }
}

async function moveCacheManagerImages() {
    if (!cacheManagerMoveTargetSelect || !cacheManagerMoveTargetSelect.value) {
        showError('Please select a target workspace');
        return;
    }

    const targetWorkspace = cacheManagerMoveTargetSelect.value;
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
            showGlassToast('success', null, `${selectedHashes.length} image(s) moved`);

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
    if (vibeManagerUploadModal) {
        openModal(vibeManagerUploadModal);
    }

    // Reset form
    if (vibeManagerFileInput) vibeManagerFileInput.value = '';
    if (vibeManagerUploadConfirmBtn) vibeManagerUploadConfirmBtn.disabled = true;
    if (vibeManagerIeInput) vibeManagerIeInput.value = '0.5';

    // Populate model dropdown
    populateVibeManagerModelDropdown();
}

function hideVibeManagerUploadModal() {
    if (vibeManagerUploadModal) {
        closeModal(vibeManagerUploadModal);
    }
}

function showVibeManagerIeModal(vibeImage) {
    if (vibeManagerIeModal) openModal(vibeManagerIeModal);

    // Store the vibe image for later use
    vibeManagerIeModal.dataset.vibeImageId = vibeImage.id;

    // Reset form
    if (vibeManagerIeInput2) vibeManagerIeInput2.value = '0.5';

    // Populate model dropdown
    populateVibeManagerIeModelDropdown();
}

function populateVibeManagerModelDropdown() {
    if (!vibeManagerModelDropdownMenu || !vibeManagerModelSelected) return;

    vibeManagerModelDropdownMenu.innerHTML = '';

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
            option.className = 'custom-dropdown-option' + (vibeManagerSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;

            option.addEventListener('click', () => {
                vibeManagerSelectedModel = key;
                vibeManagerModelSelected.textContent = displayName;
                closeDropdown(vibeManagerModelDropdownMenu, vibeManagerModelDropdownBtn);
            });

            vibeManagerModelDropdownMenu.appendChild(option);
        });
    }

    // Update selected display
    if (window.optionsData?.models[vibeManagerSelectedModel]) {
        vibeManagerModelSelected.textContent = window.optionsData?.models[vibeManagerSelectedModel];
    }
}

function populateVibeManagerIeModelDropdown() {
    if (!vibeManagerIeModelDropdownMenu || !vibeManagerIeModelSelected) return;

    vibeManagerIeModelDropdownMenu.innerHTML = '';

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
            option.className = 'custom-dropdown-option' + (vibeManagerIeSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;

            option.addEventListener('click', () => {
                vibeManagerIeSelectedModel = key;
                vibeManagerIeModelSelected.textContent = displayName;
                closeDropdown(vibeManagerIeModelDropdownMenu, vibeManagerIeModelDropdownBtn);
            });

            vibeManagerIeModelDropdownMenu.appendChild(option);
        });
    }

    // Update selected display
    if (window.optionsData?.models[vibeManagerIeSelectedModel]) {
        vibeManagerIeModelSelected.textContent = window.optionsData?.models[vibeManagerIeSelectedModel];
    }
}

function showVibeManagerFromReferenceModal(cacheImage) {
    if (vibeManagerFromReferenceModal) openModal(vibeManagerFromReferenceModal);

    // Store the reference image
    vibeManagerFromReferenceImage = cacheImage;

    // Show preview
    if (vibeManagerFromReferencePreview) {
        const img = document.createElement('img');
        if (cacheImage.hasPreview) {
            img.src = `/cache/preview/${cacheImage.hash}.webp`;
        } else {
            img.src = `/cache/${cacheImage.hash}`;
        }
        img.alt = `Reference image ${cacheImage.hash}`;
        vibeManagerFromReferencePreview.innerHTML = '';
        vibeManagerFromReferencePreview.appendChild(img);
    }

    // Reset form
    if (vibeManagerFromReferenceIeInput) vibeManagerFromReferenceIeInput.value = '0.5';

    // Populate model dropdown
    populateVibeManagerFromReferenceModelDropdown();
}

function hideVibeManagerFromReferenceModal() {
    if (vibeManagerFromReferenceModal) closeModal(vibeManagerFromReferenceModal);
    vibeManagerFromReferenceImage = null;
}

function populateVibeManagerFromReferenceModelDropdown() {
    if (!vibeManagerFromReferenceModelDropdownMenu || !vibeManagerFromReferenceModelSelected) return;

    vibeManagerFromReferenceModelDropdownMenu.innerHTML = '';

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
            option.className = 'custom-dropdown-option' + (vibeManagerFromReferenceSelectedModel === key ? ' selected' : '');
            option.dataset.value = key;
            option.textContent = displayName;

            option.addEventListener('click', () => {
                vibeManagerFromReferenceSelectedModel = key;
                vibeManagerFromReferenceModelSelected.textContent = displayName;
                closeDropdown(vibeManagerFromReferenceModelDropdownMenu, vibeManagerFromReferenceModelDropdownBtn);
            });

            vibeManagerFromReferenceModelDropdownMenu.appendChild(option);
        });
    }

    // Update selected display
    if (window.optionsData?.models[vibeManagerFromReferenceSelectedModel]) {
        vibeManagerFromReferenceModelSelected.textContent = window.optionsData?.models[vibeManagerFromReferenceSelectedModel];
    }
}

async function createVibeManagerFromReference() {
    if (!vibeManagerFromReferenceImage) {
        showError('No reference image selected');
        return;
    }

    const informationExtraction = vibeManagerFromReferenceIeInput ? parseFloat(vibeManagerFromReferenceIeInput.value) : 0.5;

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
            hideVibeManagerFromReferenceModal();
            loadVibeManagerImages(); // Refresh the vibe gallery
            
            // Update balance and show credit deduction toast
            const cost = 2; // Estimated vibe encoding cost
            await updateBalanceAndShowCreditDeduction('vibe encoding', cost);
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
    if (vibeManagerIeModal) closeModal(vibeManagerIeModal);
}

async function loadVibeManagerImages() {
    if (vibeManagerLoading) vibeManagerLoading.style.display = 'flex';
    if (vibeManagerGallery) vibeManagerGallery.innerHTML = '';

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
        if (vibeManagerLoading) vibeManagerLoading.style.display = 'none';
    }
}

function displayVibeManagerImages() {
    if (!vibeManagerGallery) return;

    vibeManagerGallery.innerHTML = '';

    if (vibeManagerImages.length === 0) {
        vibeManagerGallery.innerHTML = innerHTML = `
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
            const modelDisplayName = window.optionsData?.models[modelKey] ? window.optionsData?.models[modelKey] : modelKey;

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
    if (!vibeManagerGallery) return;

    if (vibeManagerSelectedImages.size > 0) {
        vibeManagerIsSelectionMode = true;
        vibeManagerGallery.classList.add('selection-mode');
        if (vibeManagerMoveBtn) vibeManagerMoveBtn.style.display = 'inline-block';
    } else {
        vibeManagerIsSelectionMode = false;
        vibeManagerGallery.classList.remove('selection-mode');
        if (vibeManagerMoveBtn) vibeManagerMoveBtn.style.display = 'none';
    }
}

function updateVibeManagerGallerySelection() {
    if (!vibeManagerGallery) return;

    const items = vibeManagerGallery.querySelectorAll('.vibe-manager-gallery-item');
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
    if (vibeManagerSelectedImages.size > 0) {
        vibeManagerMoveBtn.innerHTML = `<i class="fas fa-arrow-right"></i> Move Selected (${vibeManagerSelectedImages.size})`;
    } else {
        vibeManagerMoveBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Move Selected';
    }
}

function showVibeManagerDeleteModal() {
    if (vibeManagerSelectedImages.size === 0) {
        showError('No vibe images selected');
        return;
    }

    if (vibeManagerDeleteModal) {
        openModal(vibeManagerDeleteModal);
    }
}

function hideVibeManagerDeleteModal() {
    if (vibeManagerDeleteModal) {
        closeModal(vibeManagerDeleteModal);
    }
}

async function deleteSelectedVibeImages() {
    const checkboxes = document.querySelectorAll('#vibeManagerDeleteItemsList .vibe-delete-items input[type="checkbox"]:checked');

    if (checkboxes.length === 0) {
        showError('No items selected for deletion');
        return;
    }

    const confirmMessage = `Are you sure you want to delete ${checkboxes.length} selected item(s)?`;

    const confirmed = await showConfirmationDialog(
        confirmMessage,
        'Delete',
        'Cancel'
    );

    if (!confirmed) {
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
            updateGlassToast(toastId, 'success', 'Delete Complete', 'Items deleted');

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

    vibeManagerMoveCount.textContent = vibeManagerSelectedImages.size;

    // Populate workspace options
    vibeManagerMoveTargetSelect.innerHTML = '';
    workspaces.forEach(workspace => {
        if (workspace.id !== cacheManagerCurrentWorkspace) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            vibeManagerMoveTargetSelect.appendChild(option);
        }
    });

    openModal(vibeManagerMoveModal);
}

function hideVibeManagerMoveModal() {
    if (vibeManagerMoveModal) {
        closeModal(vibeManagerMoveModal);
    }
}

async function moveSelectedVibeImages() {
    const targetWorkspace = vibeManagerMoveTargetSelect.value;

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
            updateGlassToast(toastId, 'success', 'Move Complete', 'Vibe images moved');

            // Remove moved images from local array
            vibeManagerImages = vibeManagerImages.filter(img => !vibeManagerSelectedImages.has(img.id));

            // Clear selection and exit selection mode
            vibeManagerSelectedImages.clear();
            vibeManagerIsSelectionMode = false;

            // Refresh display
            loadVibeManagerImages();
            updateVibeManagerSelectionMode();
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
    if (!vibeManagerFileInput || !vibeManagerFileInput.files.length) return;

    const file = vibeManagerFileInput.files[0];
    const model = vibeManagerSelectedModel;
    const informationExtraction = vibeManagerIeInput ? parseFloat(vibeManagerIeInput.value) : 0.5;

    vibeManagerUploadConfirmBtn.disabled = true;

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
            
            // Update balance and show credit deduction toast
            const cost = 2; // Estimated vibe encoding cost
            await updateBalanceAndShowCreditDeduction('vibe encoding', cost);
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to encode vibe image');
        }
    } catch (error) {
        console.error('Error uploading vibe image:', error);
        updateGlassToast(toastId, 'error', 'Upload Failed', 'Failed to upload vibe image: ' + error.message);
    } finally {
        vibeManagerUploadConfirmBtn.disabled = false;
    }
}

async function requestVibeManagerIe() {
    const vibeImageId = vibeManagerIeModal.dataset.vibeImageId;
    if (!vibeImageId) {
        showError('No vibe image selected');
        return;
    }

    const model = vibeManagerIeSelectedModel;
    const informationExtraction = vibeManagerIeInput2 ? parseFloat(vibeManagerIeInput2.value) : 0.5;

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
            updateGlassToast(toastId, 'success', 'IE Complete', 'New Information Extraction successful');
            hideVibeManagerIeModal();
            loadVibeManagerImages(); // Refresh the gallery
            
            // Update balance and show credit deduction toast
            const cost = 1; // Estimated information extraction cost
            await updateBalanceAndShowCreditDeduction('information extraction', cost);
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
            const activeTab = document.querySelector('.cache-manager-tabs .tab-btn.active');
            if (activeTab && activeTab.dataset.tab === 'vibe') {
                loadVibeManagerImages();
            } else {
                loadCacheManagerImages();
            }
        });
    }

    // Reference manager upload dropdown
    if (cacheManagerUploadDropdownBtn && cacheManagerUploadDropdownMenu) {
        cacheManagerUploadDropdownBtn.addEventListener('click', () => {
            toggleDropdown(cacheManagerUploadDropdownMenu, cacheManagerUploadDropdownBtn);
        });

        // Handle upload type selection
        const uploadOptions = cacheManagerUploadDropdownMenu.querySelectorAll('.custom-dropdown-option');
        uploadOptions.forEach(option => {
            option.addEventListener('click', () => {
                const uploadType = option.dataset.uploadType;
                if (uploadType === 'reference') {
                    showCacheManagerUploadModal();
                } else if (uploadType === 'vibe') {
                    showVibeManagerUploadModal();
                }
                closeDropdown(cacheManagerUploadDropdownMenu, cacheManagerUploadDropdownBtn);
            });
        });
    }

    // Reference manager move button
    if (cacheManagerMoveBtn) {
        cacheManagerMoveBtn.addEventListener('click', showCacheManagerMoveModal);
    }

    // Tab switching functionality
    const tabButtons = document.querySelectorAll('.cache-manager-tabs .gallery-toggle-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            const tabTitle = btn.getAttribute('data-title');
            switchCacheManagerTab(tabName, tabTitle);
        });
    });

    // Upload modal controls

    if (closeCacheManagerUploadBtn) closeCacheManagerUploadBtn.addEventListener('click', hideCacheManagerUploadModal);
    if (cacheManagerUploadCancelBtn) cacheManagerUploadCancelBtn.addEventListener('click', hideCacheManagerUploadModal);
    if (cacheManagerUploadConfirmBtn) cacheManagerUploadConfirmBtn.addEventListener('click', uploadCacheManagerImages);

    if (cacheManagerFileInput) {
        cacheManagerFileInput.addEventListener('change', () => {
            if (cacheManagerUploadConfirmBtn) {
                cacheManagerUploadConfirmBtn.disabled = !cacheManagerFileInput.files.length;
            }
        });
    }

    // Vibe upload modal controls

    if (closeVibeManagerUploadModalBtn) closeVibeManagerUploadModalBtn.addEventListener('click', hideVibeManagerUploadModal);
    if (vibeManagerUploadCancelBtn) vibeManagerUploadCancelBtn.addEventListener('click', hideVibeManagerUploadModal);
    if (vibeManagerUploadConfirmBtn) vibeManagerUploadConfirmBtn.addEventListener('click', uploadVibeManagerImage);

    if (vibeManagerFileInput) {
        vibeManagerFileInput.addEventListener('change', () => {
            if (vibeManagerUploadConfirmBtn) {
                vibeManagerUploadConfirmBtn.disabled = !vibeManagerFileInput.files.length;
            }
        });
    }

    // Add scroll wheel functionality for IE inputs
    if (vibeManagerIeInput) {
        vibeManagerIeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.5;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }

    // Vibe model dropdowns

    if (vibeManagerModelDropdownBtn && vibeManagerModelDropdownMenu) {
        vibeManagerModelDropdownBtn.addEventListener('click', () => {
            toggleDropdown(vibeManagerModelDropdownMenu, vibeManagerModelDropdownBtn);
        });
    }

    if (vibeManagerIeModelDropdownBtn && vibeManagerIeModelDropdownMenu) {
        vibeManagerIeModelDropdownBtn.addEventListener('click', () => {
            toggleDropdown(vibeManagerIeModelDropdownMenu, vibeManagerIeModelDropdownBtn);
        });
    }

    // Vibe from reference model dropdown

    if (vibeManagerFromReferenceModelDropdownBtn && vibeManagerFromReferenceModelDropdownMenu) {
        vibeManagerFromReferenceModelDropdownBtn.addEventListener('click', () => {
            toggleDropdown(vibeManagerFromReferenceModelDropdownMenu, vibeManagerFromReferenceModelDropdownBtn);
        });
    }

    // Vibe IE modal controls

    if (closeVibeManagerIeModalBtn) closeVibeManagerIeModalBtn.addEventListener('click', hideVibeManagerIeModal);
    if (vibeManagerIeCancelBtn) vibeManagerIeCancelBtn.addEventListener('click', hideVibeManagerIeModal);
    if (vibeManagerIeConfirmBtn) vibeManagerIeConfirmBtn.addEventListener('click', requestVibeManagerIe);

    // Add scroll wheel functionality for IE inputs
    if (vibeManagerIeInput2) {
        vibeManagerIeInput2.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.5;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }

    // Vibe from reference modal controls

    if (closeVibeManagerFromReferenceModalBtn) closeVibeManagerFromReferenceModalBtn.addEventListener('click', hideVibeManagerFromReferenceModal);
    if (vibeManagerFromReferenceCancelBtn) vibeManagerFromReferenceCancelBtn.addEventListener('click', hideVibeManagerFromReferenceModal);
    if (vibeManagerFromReferenceConfirmBtn) vibeManagerFromReferenceConfirmBtn.addEventListener('click', createVibeManagerFromReference);

    // Add scroll wheel functionality for IE inputs
    if (vibeManagerFromReferenceIeInput) {
        vibeManagerFromReferenceIeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const currentValue = parseFloat(this.value) || 0.5;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
        });
    }

    // Move modal controls

    if (closeCacheManagerMoveBtn) closeCacheManagerMoveBtn.addEventListener('click', hideCacheManagerMoveModal);
    if (cacheManagerMoveCancelBtn) cacheManagerMoveCancelBtn.addEventListener('click', hideCacheManagerMoveModal);
    if (cacheManagerMoveConfirmBtn) cacheManagerMoveConfirmBtn.addEventListener('click', moveCacheManagerImages);

    // Vibe Manager bulk action controls

    if (vibeManagerMoveModalBtn) vibeManagerMoveModalBtn.addEventListener('click', showVibeManagerMoveModal);

    // Vibe Manager delete modal controls

    if (closeVibeManagerDeleteModalBtn) closeVibeManagerDeleteModalBtn.addEventListener('click', hideVibeManagerDeleteModal);
    if (vibeManagerDeleteCancelBtn) vibeManagerDeleteCancelBtn.addEventListener('click', hideVibeManagerDeleteModal);
    if (vibeManagerDeleteConfirmBtn) vibeManagerDeleteConfirmBtn.addEventListener('click', deleteSelectedVibeImages);

    // Vibe Manager move modal controls

    if (closeVibeManagerMoveModalBtn) closeVibeManagerMoveModalBtn.addEventListener('click', hideVibeManagerMoveModal);
    if (vibeManagerMoveCancelBtn) vibeManagerMoveCancelBtn.addEventListener('click', hideVibeManagerMoveModal);
    if (vibeManagerMoveConfirmBtn) vibeManagerMoveConfirmBtn.addEventListener('click', moveSelectedVibeImages);

    // Close modals when clicking outside
    const modals = ['cacheManagerModal', 'cacheManagerUploadModal', 'cacheManagerMoveModal', 'vibeManagerUploadModal', 'vibeManagerIeModal', 'vibeManagerFromReferenceModal', 'vibeManagerDeleteModal', 'vibeManagerMoveModal'];
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

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (vibeManagerModelDropdown && !vibeManagerModelDropdown.contains(e.target)) {
            closeDropdown(vibeManagerModelDropdownMenu, vibeManagerModelDropdownBtn);
        }

        if (vibeManagerIeModelDropdown && !vibeManagerIeModelDropdown.contains(e.target)) {
            closeDropdown(vibeManagerIeModelDropdownMenu, vibeManagerIeModelDropdownBtn);
        }

        if (vibeManagerFromReferenceModelDropdown && !vibeManagerFromReferenceModelDropdown.contains(e.target)) {
            closeDropdown(vibeManagerFromReferenceModelDropdownMenu, vibeManagerFromReferenceModelDropdownBtn);
        }
    });
}

// Tab switching function for cache manager (Reference Model)
function switchCacheManagerTab(tabName, tabTitle) {
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

    document.getElementById('cacheManagerTabTitle').textContent = tabTitle;
}
