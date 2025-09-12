// Gallery View and Infinite Scroll Module
// Contains all functions and variables related to gallery display and infinite scrolling

// Global variables for gallery and infinite scroll
// Infinite scroll variables
let imagesPerPage = 12;
let isLoadingMore = false;
let hasMoreImages = true;
let hasMoreImagesBefore = false; // Track if there are images before current page
let visibleItems = new Set(); // Track visible items
let virtualScrollEnabled = true; // Enable virtual scrolling
let currentImage = null;

// Bidirectional infinite scroll tracking
let displayedStartIndex = 0; // First displayed image index in allImages array
let displayedEndIndex = 0;   // Last displayed image index in allImages array

// Improved infinite scroll configuration
let infiniteScrollConfig = {
    // Percentage-based triggers (more responsive to different screen sizes)
    bottomTriggerPercent: 0.15, // 15% from bottom
    topTriggerPercent: 0.15,    // 15% from top
    placeholderTriggerPercent: 0.25, // 25% for placeholder scheduling
    
    // Dynamic batch sizing based on viewport
    minBatchSize: 6,
    maxBatchSize: 24,
    
    // Performance optimization
    throttleDelay: 100, // ms between scroll checks
    debounceDelay: 300, // ms after scroll stops
    
    // Responsive adjustments - improved for mobile
    smallScreenThreshold: 768, // px
    smallScreenMultiplier: 0.8, // Increased from 0.5 to 0.8 for better mobile experience
};

// Selection state
let selectedImages = new Set();
let isSelectionMode = false;
let lastSelectedGalleryIndex = null; // Track last selected index for range selection
let infiniteScrollLoading = document.getElementById('infiniteScrollLoading');

const galleryToggleGroup = document.getElementById('galleryToggleGroup');

// Gallery view state
let currentGalleryView = 'images'; // 'images', 'scraps', 'pinned', 'upscaled'
// Make it globally accessible for WebSocket event handlers
window.currentGalleryView = currentGalleryView;

// Gallery sort order state
let gallerySortOrder = 'desc'; // 'desc' for newest first, 'asc' for oldest first
window.gallerySortOrder = gallerySortOrder;

// Gallery layout variables
let galleryColumns = parseInt(galleryToggleGroup?.dataset?.columns) || 5;
let realGalleryColumns = galleryColumns;
let galleryRows = 5;
let debounceGalleryTimeout = null;

// Placeholder management
let deferredPlaceholderTimeout = null;
let pendingPlaceholderAdditions = {
    above: false,
    below: false
};

// Scroll position preservation for upward scrolling
let scrollPositionPreservationEnabled = false;
let lastScrollTop = 0;
let lastVisibleItemIndex = -1;

// Global images array (shared with main app)
let allImages = [];

// Helper function to find the true index of an image in the original array
function findTrueImageIndex(image) {
    const filename = image.filename || image.original || image.upscaled;
    if (!filename) return -1;
    
    // If we have filtered results, use the original array
    if (window.originalAllImages && window.originalAllImages.length > 0) {
        return window.originalAllImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }
    
    // Otherwise, use the current allImages array
    return allImages.findIndex(img => {
        const imgFilename = img.filename || img.original || img.upscaled;
        return imgFilename === filename;
    });
}

// Preserve scroll position when adding placeholders above
function preserveScrollPosition() {
    if (!scrollPositionPreservationEnabled) return;
    
    // Find the first visible item to use as an anchor
    const visibleItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    let anchorItem = null;
    let anchorIndex = -1;
    
    for (const item of visibleItems) {
        const rect = item.getBoundingClientRect();
        if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
            anchorItem = item;
            anchorIndex = parseInt(item.dataset.index || '0');
            break;
        }
    }
    
    // If no visible item found, use the first item in viewport
    if (!anchorItem) {
        for (const item of visibleItems) {
            const rect = item.getBoundingClientRect();
            if (rect.bottom > 0 && rect.top < window.innerHeight) {
                anchorItem = item;
                anchorIndex = parseInt(item.dataset.index || '0');
                break;
            }
        }
    }
    
    if (anchorItem && anchorIndex !== -1) {
        lastVisibleItemIndex = anchorIndex;
        lastScrollTop = window.pageYOffset;
    }
    
    // For iOS, store additional scroll context
    if (isIOS) {
        // Store the current scroll velocity to predict momentum
        const now = Date.now();
        if (lastScrollTime > 0) {
            const timeDelta = now - lastScrollTime;
            const scrollDelta = window.pageYOffset - lastScrollTop;
            scrollVelocity = scrollDelta / timeDelta;
        }
    }
}

// Restore scroll position after adding placeholders above
function restoreScrollPosition() {
    if (!scrollPositionPreservationEnabled || lastVisibleItemIndex === -1) return;
    
    // Find the anchor item by its index
    const anchorItem = gallery.querySelector(`[data-index="${lastVisibleItemIndex}"]`);
    if (anchorItem) {
        const rect = anchorItem.getBoundingClientRect();
        const targetScrollTop = window.pageYOffset + rect.top - 100; // 100px offset from top
        
        // For iOS, use instant positioning to prevent momentum issues
        const scrollBehavior = isIOS ? 'instant' : 'auto';
        
        window.scrollTo({
            top: targetScrollTop,
            behavior: scrollBehavior
        });
    }
    
    // Reset preservation state
    scrollPositionPreservationEnabled = false;
    lastVisibleItemIndex = -1;
}

// Apply a provided image list to the gallery without fetching from server (used by search)
window.applyFilteredImages = function(images, originalIndices = null) {
    try {
        allImages = Array.isArray(images) ? images : [];
        
        // Store the mapping of filtered images to their original indices
        if (originalIndices && Array.isArray(originalIndices)) {
            window.filteredImageIndices = originalIndices;
        } else {
            // If no mapping provided, create a default mapping (filtered array indices)
            window.filteredImageIndices = allImages.map((_, index) => index);
        }
        
        resetInfiniteScroll();
        sortGalleryData();
        displayCurrentPageOptimized();
		updateGalleryPlaceholders();
    } catch (e) {
        console.error('Error applying filtered images:', e);
    }
};

// Switch between gallery views
async function switchGalleryView(view, force = false) {
    if (currentGalleryView === view && !force) return;
    
    // Check if we're in the middle of workspace switching to avoid duplicate calls
    if (window.isWorkspaceSwitching && !force) {
        console.log('🔄 Skipping gallery view switch during workspace transition');
        return;
    }
    
    // Don't switch gallery view if manual modal is open (unless forced)
    if (!manualModal.classList.contains('hidden')) return;
    
    currentGalleryView = view;
    // Update global variable for WebSocket event handlers
    window.currentGalleryView = currentGalleryView;
    
    // Update button states
    galleryToggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    galleryToggleGroup.querySelector(`[data-view="${view}"]`).classList.add('active');
    
    // Update slider position
    galleryToggleGroup.setAttribute('data-active', view);
    
    // Handle view-specific logic
    switch (view) {
        case 'scraps':
            document.body.classList.add('scraps-grayscale');
            await loadScraps();
            break;
        case 'images':
            document.body.classList.remove('scraps-grayscale');
            await loadGallery();
            break;
        case 'pinned':
            document.body.classList.remove('scraps-grayscale');
            await loadPinned();
            break;
        case 'upscaled':
            document.body.classList.remove('scraps-grayscale');
            await loadUpscaled();
            break;
    }
}

// Load scraps for current workspace
async function loadScraps() {
    try {
        // Use WebSocket to request scraps data
        if (window.wsClient && window.wsClient.isConnected()) {
            const scrapsImageData = await window.wsClient.requestGalleryView('scraps');
            // Update display
            allImages = scrapsImageData.gallery || scrapsImageData;
            
            // Apply current sort order to the loaded data
            sortGalleryData();
            
            displayCurrentPageOptimized();
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading scraps:', error);
        allImages = [];
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }
}

// Load pinned images for current workspace
async function loadPinned() {
    try {
        // Use WebSocket to request pinned data
        if (window.wsClient && window.wsClient.isConnected()) {
            const pinnedImageData = await window.wsClient.requestGalleryView('pinned');
            // Update display
            allImages = pinnedImageData.gallery || pinnedImageData;
            
            // Apply current sort order to the loaded data
            sortGalleryData();
            
            displayCurrentPageOptimized();
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading pinned images:', error);
        allImages = [];
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }
}

// Load upscaled images for current workspace
async function loadUpscaled() {
    try {
        // Use WebSocket to request upscaled data
        if (window.wsClient && window.wsClient.isConnected()) {
            const upscaledImageData = await window.wsClient.requestGalleryView('upscaled');
            // Update display
            allImages = upscaledImageData.gallery || upscaledImageData;
            
            // Apply current sort order to the loaded data
            sortGalleryData();
            
            displayCurrentPageOptimized();
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading upscaled images:', error);
        allImages = [];
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }
}

// Load gallery images with optimized rendering to prevent flickering
async function loadGallery(addLatest) {
    try {
        // Use WebSocket to request gallery data
        if (window.wsClient && window.wsClient.isConnected()) {
            const newImages = await window.wsClient.requestAllImages();
            const galleryData = newImages.gallery || newImages;

            // Check if images have actually changed to avoid unnecessary updates
            if (JSON.stringify(allImages) === JSON.stringify(galleryData)) {
                return;
            }

            allImages = galleryData;

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Only update gallery display if manual modal is not open
            if (manualModal.classList.contains('hidden')) {
                // Reset infinite scroll state and display initial batch
                if (!addLatest) {
                    resetInfiniteScroll();
                    displayCurrentPageOptimized();
                } else {
                    await addNewGalleryItemAfterGeneration(galleryData[0]);
                }
            }
        } else {
            throw new Error('WebSocket not connected');
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        // Don't throw error for gallery loading failure
        allImages = [];
        
        // Only update gallery display if manual modal is not open
        if (manualModal.classList.contains('hidden')) {
            displayCurrentPageOptimized();
        }
    }
}

// Add a new gallery item after generation with fade-in and slide-in animations
async function addNewGalleryItemAfterGeneration(newImage) {
    // Don't add new gallery items if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    // Add placeholder with fade-in
    const placeholder = document.createElement('div');
    placeholder.className = 'gallery-placeholder fade-in';
    placeholder.dataset.filename = newImage.filename || newImage.original || newImage.upscaled;
    placeholder.dataset.time = newImage.mtime;
    placeholder.dataset.index = 0;
    placeholder.dataset.fileIndex = '0';
    gallery.insertBefore(placeholder, gallery.children[0]);
    // Wait for fade-in animation to finish
    await new Promise(resolve => {
        placeholder.addEventListener('animationend', function handler() {
            placeholder.classList.remove('fade-in');
            placeholder.removeEventListener('animationend', handler);
            resolve();
        });
    });
    // Replace placeholder with real item, slide in
    const newItem = createGalleryItem(newImage, 0);
    newItem.classList.add('slide-in');
    gallery.replaceChild(newItem, placeholder);
    newItem.addEventListener('animationend', function handler() {
        newItem.classList.remove('slide-in');
        newItem.removeEventListener('animationend', handler);
    });
    reindexGallery();
}

// Calculate optimal number of rows based on viewport height
function calculateGalleryRows() {
    if (!gallery) return 5; // Fallback to 5 if gallery not found

    // Get gallery container dimensions
    const galleryRect = gallery.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Estimate gallery item height (including gap and margins)
    // Gallery items are square (aspect-ratio: 1) with gap and padding
    const itemSize = galleryRect.width / realGalleryColumns; // Width of each item
    const gap = 24; // var(--spacing-xl) from CSS
    const itemHeight = itemSize + gap; // Item height plus gap

    // Calculate available height for gallery
    // Account for header, controls, and margins (no pagination)
    const headerHeight = 80; // Approximate header height
    const controlsHeight = 60; // Approximate controls height
    const margins = 40; // Top and bottom margins

    const availableHeight = viewportHeight - headerHeight - controlsHeight - margins;

    // Calculate how many rows can fit
    const calculatedRows = Math.floor(availableHeight / itemHeight);

    // Ensure minimum of 3 rows and maximum of 8 rows for usability
    return Math.max(3, Math.min(8, calculatedRows));
}

function setGalleryColumns(cols) {
    // Update infinite scrolling calculations only
    updateGalleryGrid();
    
    if (debounceGalleryTimeout) clearTimeout(debounceGalleryTimeout);
    debounceGalleryTimeout = setTimeout(() => {
        updateGalleryColumnsFromLayout();
        displayCurrentPageOptimized();
        resetInfiniteScroll();
    }, 500);
}

function updateGalleryPlaceholders() {
    if (!gallery) return;
    
    // Don't update gallery if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;

    // Don't remove placeholders here - they are managed by the virtual scrolling system
    // This function is called during initial display and should not interfere with
    // the placeholder management during scrolling
    
    // Only remove placeholders if we're doing a complete gallery reset
    // (e.g., switching views, applying filters, etc.)
    if (isGalleryResetting) {
        Array.from(gallery.querySelectorAll('.gallery-placeholder')).forEach(el => el.remove());
        isGalleryResetting = false;
    }
}

function updateGalleryItemToolbars() {
    // Don't update gallery if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    const items = document.querySelectorAll('.gallery-item');
    let i = 0;
    function updateNext() {
        if (i >= items.length) return;
        const item = items[i];
        const overlay = item.querySelector('.gallery-item-overlay');
        if (!overlay) return;
        // Check if item is too small (e.g., width < 120px or height < 120px)
        const rect = item.getBoundingClientRect();
        let miniToolbar = overlay.querySelector('.mini-toolbar');
        if (rect.width < 208 || rect.height < 208) {
            item.classList.add('mini-toolbar-active');
            if (!miniToolbar) {
                miniToolbar = document.createElement('div');
                miniToolbar.className = 'mini-toolbar';
                miniToolbar.innerHTML = `
                    <button class="btn-small" title="Edit"><i class="nai-settings"></i></button>
                    <button class="btn-small" title="Download"><i class="fas fa-download"></i></button>
                    <button class="btn-small" title="Delete"><i class="nai-trash"></i></button>
                `;
                overlay.appendChild(miniToolbar);
            }
            miniToolbar.classList.remove('hidden');
        } else {
            item.classList.remove('mini-toolbar-active');
            if (miniToolbar) {
                miniToolbar.classList.add('hidden');
            }
        }
        i++;
        requestAnimationFrame(updateNext);
    }
    updateNext();
}

// Optimized display function for infinite scroll using document fragment
function displayCurrentPageOptimized() {
    if (!gallery) return;
    
    // Don't update gallery if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;

    // Update infinite scrolling calculations
    updateGalleryGrid();

    // Set flag for complete gallery reset
    isGalleryResetting = true;
    
    // Clear gallery
    gallery.innerHTML = '';

    // If no images, show empty state
    if (allImages.length === 0) {
        return;
    }
    
    displayedStartIndex = 0;
    const itemHeight = 256;
    const itemsPerCol = Math.floor(window.innerHeight / itemHeight);
    const buffer = Math.ceil(itemsPerCol * 0.15);
    const totalItems = Math.min((itemsPerCol + buffer) * realGalleryColumns, allImages.length);
    displayedEndIndex = totalItems;

    const fragment = document.createDocumentFragment();
    for (let i = displayedStartIndex; i < displayedEndIndex; i++) {
        const image = allImages[i];
        if (image) {
            const galleryItem = createGalleryItem(image, i);
            galleryItem.classList.add('fade-in');
            fragment.appendChild(galleryItem);
        }
    }
    gallery.appendChild(fragment);

    // Fade in items one by one
    const items = gallery.querySelectorAll('.gallery-item.fade-in');
    items.forEach((el, idx) => {
        setTimeout(() => {
            el.classList.add('fade-in');
            el.addEventListener('animationend', function handler() {
                el.classList.remove('fade-in');
                el.removeEventListener('animationend', handler);
            });
        }, idx * 60);
    });

    hasMoreImages = displayedEndIndex < allImages.length;
    hasMoreImagesBefore = displayedStartIndex > 0;
    
    // Initialize intersection observer for better performance
    initIntersectionObserver();
    
    // Observe all gallery items for intersection changes
    if (intersectionObserver) {
        items.forEach(item => {
            intersectionObserver.observe(item);
        });
    }
    
    updateVirtualScroll();
    updateGalleryItemToolbars();
    updateGalleryPlaceholders();
}

function resetInfiniteScroll() {
    // Clean up intersection observer for better performance
    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }
    
    // Clean up placeholder cleanup queue for iOS
    if (placeholderCleanupQueue.length > 0) {
        placeholderCleanupQueue.length = 0;
    }
    
    // Clear scroll timeouts
    if (scrollEndTimeout) {
        clearTimeout(scrollEndTimeout);
        scrollEndTimeout = null;
    }
    
    window.scrollTo({ top: 0, behavior: 'instant' });
    displayedStartIndex = 0;
    displayedEndIndex = 0;
    isLoadingMore = false;
    hasMoreImages = true;
    hasMoreImagesBefore = false;
    
    // Update batch size based on current viewport
    imagesPerPage = calculateDynamicBatchSize();
    
    if (infiniteScrollLoading) {
        infiniteScrollLoading.classList.add('hidden');
    }
}

// Create gallery item element
function createGalleryItem(image, index) {
    const item = document.createElement('div');
    item.className = 'gallery-item fade-in';
    const filename = image.filename || image.original || image.upscaled;
    item.dataset.filename = filename;
    item.dataset.time = image.mtime || 0;
    item.dataset.index = index;
    
    // Add data-file-index to track the true position in allImages array
    // This is useful for search results where the filtered array indices don't match original array indices
    let fileIndex = index;
    if (window.filteredImageIndices && window.filteredImageIndices[index] !== undefined) {
        fileIndex = window.filteredImageIndices[index];
    } else {
        // Fallback: try to find the image in the current allImages array
        const foundIndex = allImages.indexOf(image);
        fileIndex = foundIndex !== -1 ? foundIndex : index;
    }
    item.dataset.fileIndex = fileIndex.toString();
    
    // Use data-selected as single source of truth for selection state
    const isSelected = selectedImages.has(filename);
    item.dataset.selected = isSelected ? 'true' : 'false';
    if (isSelected) {
        item.classList.add('selected');
    } else {
        item.classList.remove('selected');
    }
    
    // Add selection checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gallery-item-checkbox';
    checkbox.dataset.filename = filename;
    checkbox.checked = isSelected;
    
    // ALT+click range selection on click event
    checkbox.addEventListener('click', (e) => {
        if (e.altKey) {
            e.preventDefault();
            // Get all gallery items (both real items and placeholders) in order
            const allItems = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
            const clickedIndex = allItems.findIndex(div => div.dataset.filename === filename);
            
            if (lastSelectedGalleryIndex !== null && clickedIndex !== -1) {
                const [start, end] = [lastSelectedGalleryIndex, clickedIndex].sort((a, b) => a - b);
                
                // Select all items in range
                for (let i = start; i <= end; i++) {
                    const div = allItems[i];
                    const itemFilename = div.dataset.filename;
                    
                    // Update data-selected attribute
                    div.dataset.selected = 'true';
                    div.classList.add('selected');
                    selectedImages.add(itemFilename);
                    
                    // Update checkbox if it's a real item
                    const cb = div.querySelector('.gallery-item-checkbox');
                    if (cb) cb.checked = true;
                }
                
                updateBulkActionsBar();
                lastSelectedGalleryIndex = clickedIndex;
            return;
            }
        }
    });
    
    // Normal selection on change event
    checkbox.addEventListener('change', (e) => {
        if (!e.altKey) {
            e.stopPropagation();
            handleImageSelection(image, e.target.checked, e);
        }
    });

    // Use preview image - encode the preview name to handle spaces and special characters
    const img = document.createElement('img');
    const previewUrl = getGalleryPreviewUrl(image.preview);
    img.src = `/previews/${encodeURIComponent(previewUrl)}`;
    img.alt = image.base;
    img.loading = 'lazy';
    
    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';

    // Create action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'gallery-actions';

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn-secondary round-button';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadImage(image);
    };

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary round-button';
    copyBtn.innerHTML = '<i class="fas fa-clipboard"></i>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
            // Determine the correct URL for the image
            let imageUrl;
            if (image.url) {
                // For newly generated images
                imageUrl = image.url;
            } else {
                // For gallery images - prefer highest quality version
                const filename = image.upscaled || image.original;
                imageUrl = `/images/${filename}`;
            }
            
            // Fetch the image as a blob
            const response = await fetch(imageUrl);
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
    };

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'btn-secondary round-button';
    
    // Set initial pin button state from WebSocket data if available
    if (image.isPinned !== undefined) {
        if (image.isPinned) {
            pinBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
            pinBtn.title = 'Unpin image';
        } else {
            pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
            pinBtn.title = 'Pin image';
        }
    } else {
        pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
        pinBtn.title = 'Pin/Unpin image';
        // Update pin button appearance based on pin status (fallback to API)
        updatePinButtonAppearance(pinBtn, filename);
    }
    
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        togglePinImage(image, pinBtn);
    };

    actionsDiv.appendChild(pinBtn);
    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(downloadBtn);

    overlay.appendChild(actionsDiv);

    item.appendChild(checkbox);
    item.appendChild(img);
    item.appendChild(overlay);

    // Add context menu to gallery item
    if (window.contextMenu) {
        // Create move workspace submenu options function
        function getMoveWorkspaceOptions(target) {
            const workspaceOptions = [];
            
            // Get available workspaces and return submenu items
            const workspacesData = workspaces || window.workspaces || {};
            const workspacesFiltered = Object.values(workspacesData).sort((a, b) => (a.sort || 0) - (b.sort || 0))
            
            // Get current workspace ID - try multiple sources
            let currentWorkspaceId = 'default';
            if (typeof activeWorkspace !== 'undefined') {
                currentWorkspaceId = activeWorkspace;
            } else if (window.activeWorkspace) {
                currentWorkspaceId = window.activeWorkspace;
            } else if (typeof getActiveWorkspace === 'function') {
                currentWorkspaceId = getActiveWorkspace();
            }

            // Generate workspace options
            workspacesFiltered
                .filter(workspace => workspace.id !== currentWorkspaceId)
                .forEach((workspace) => {
                    const workspaceId = workspace.id;
                    const workspaceName = workspace.name;
                    const workspaceColor = workspace.color || '#6366f1';

                    workspaceOptions.push({
                        content: `
                            <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                                <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                                <span class="context-menu-item-text">${workspaceName}</span>
                            </div>
                        `,
                        action: 'move-to-workspace',
                        workspaceId: workspaceId,
                        workspaceName: workspaceName,
                        disabled: false
                    });
                });
                
            return workspaceOptions;
        }
        
        // Create move workspace submenu handler function
        function handleMoveWorkspaceAction(subItem, target) {
            const action = subItem.action;
            if (action === 'move-to-workspace') {
                const workspaceId = subItem.workspaceId;
                const workspaceName = subItem.workspaceName;
                
                const galleryItem = target.closest('.gallery-item');
                if (!galleryItem) return;
                
                const fileIndex = parseInt(galleryItem.dataset.fileIndex, 10);
                const image = allImages[fileIndex];
                
                if (image && workspaceId && workspaceName) {
                    handleMoveToWorkspace(image, workspaceId, workspaceName);
                }
            }
        }
        
        const contextMenuConfig = {
            maxHeight: true,
            sections: [
                {
                    type: 'icons',
                    icons: [
                        {
                            icon: 'fa-regular fa-square-check',
                            tooltip: 'Select',
                            action: 'toggle-checkbox',
                            loadfn: (menuItem, target) => {
                                // Get gallery item and checkbox
                                const galleryItem = target.closest('.gallery-item');
                                if (galleryItem) {
                                    const checkbox = galleryItem.querySelector('.gallery-item-checkbox');
                                    if (checkbox) {
                                        const isChecked = checkbox.checked;
                                        menuItem.icon = isChecked ? 'fa-solid fa-square-check' : 'fa-regular fa-square-check';
                                        menuItem.tooltip = isChecked ? 'Deselect' : 'Select';
                                    }
                                }
                            }
                        },
                        {
                            icon: 'fa-regular fa-star', // Default icon, will be updated by loadfn
                            tooltip: 'Favorite', // Default text, will be updated by loadfn
                            action: 'toggle-favorite',
                            loadfn: (menuItem, target) => {
                                // Get image data from target element
                                const fileIndex = parseInt(target.dataset.fileIndex, 10);
                                const image = allImages && allImages[fileIndex];
                                
                                if (image) {
                                    // Update favorite icon and tooltip based on current pin status
                                    const isPinned = image.isPinned;
                                    menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                                    menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                                }
                            }
                        },
                        {
                            icon: 'fas fa-download',
                            tooltip: 'Download',
                            action: 'download'
                        },
                        {
                            icon: 'fas fa-clipboard',
                            tooltip: 'Copy',
                            action: 'copy'
                        },
                    ]
                },
                {
                    type: 'list',
                    title: 'Generation',
                    items: [
                        {
                            icon: 'nai-dice',
                            text: 'Reroll Generation',
                            action: 'reroll'
                        },
                        {
                            icon: 'mdi mdi-1-25 mdi-text-box-edit-outline',
                            text: 'Edit Generation',
                            action: 'modify'
                        },
                        {
                            icon: 'nai-upscale',
                            text: 'Upscale Image',
                            action: 'upscale',
                            disabled: !!image.upscaled,
                            loadfn: (menuItem, target) => {
                                // Get image data from target element
                                const fileIndex = parseInt(target.dataset.fileIndex, 10);
                                const image = allImages && allImages[fileIndex];
                                
                                if (image) {
                                    // Update upscale disabled state
                                    menuItem.disabled = !!image.upscaled;
                                }
                            }
                        }/* ,
                        {
                            icon: 'mdi mdi-1-5 mdi-chat',
                            text: 'Start Conversation',
                            action: 'start-chat'
                        } */
                    ]
                },
                {
                    type: 'list',
                    title: 'Data Management',
                    items: [
                        {
                            icon: 'fas fa-folder-arrow-up',
                            text: 'Move to...',
                            optionsfn: getMoveWorkspaceOptions,
                            handlerfn: handleMoveWorkspaceAction
                        },
                        {
                            icon: 'mdi mdi-1-5 mdi-archive',
                            text: 'Scrap',
                            action: 'scrap',
                            loadfn: (menuItem, target) => {
                                // Update scrap tooltip based on current view
                                const currentView = window.currentGalleryView || 'images';
                                if (currentView === 'scraps') {
                                    menuItem.tooltip = 'Restore';
                                    menuItem.icon = 'fas fa-undo';
                                } else {
                                    menuItem.tooltip = 'Scrap';
                                    menuItem.icon = 'mdi mdi-1-5 mdi-archive';
                                }
                            }
                        },
                        {
                            icon: 'nai-trash',
                            text: 'Delete',
                            action: 'delete'
                        }
                    ]
                },
                {
                    type: 'list',
                    title: 'Reference',
                    items: [
                        {
                            icon: 'nai-img2img',
                            text: 'Create New Reference',
                            action: 'create-reference'
                        },
                        {
                            icon: 'mdi mdi-data-matrix-scan',
                            text: 'Create New Encoding',
                            action: 'create-encoding'
                        }
                    ]
                }
            ]
        };
        
        window.contextMenu.attachToElement(item, contextMenuConfig);
    }
    
    // If we're in selection mode, switch to bulk context menu for this new item
    if (isSelectionMode && window.contextMenu && !item.dataset.bulkContextMenuActive) {
        // Store original context menu config
        const originalConfigId = item.dataset.contextMenu;
        if (originalConfigId && window.contextMenu.configs && window.contextMenu.configs[originalConfigId]) {
            item.dataset.originalContextMenuConfig = originalConfigId;
            item.dataset.originalContextMenuStored = 'true';
        }
        
        // Attach bulk context menu
        const bulkActionsConfig = {
            maxHeight: true,
            sections: [
                {
                    type: 'icons',
                    icons: [
                        {
                            icon: 'fa-solid fa-check-double',
                            tooltip: 'Select All',
                            action: 'bulk-select-all'
                        },
                        {
                            icon: 'nai-thin-cross',
                            tooltip: 'Clear Selection',
                            action: 'bulk-clear-selection',
                            disabled: false
                        }
                    ]
                },
                {
                    type: 'list',
                    title: 'Bulk Actions',
                    items: [
                        {
                            icon: 'fas fa-share',
                            text: 'Share to Sequenzia',
                            action: 'bulk-sequenzia',
                            disabled: false
                        },
                        {
                            icon: 'fas fa-folder',
                            text: 'Move to Workspace',
                            action: 'bulk-move-workspace',
                            disabled: false
                        },
                        {
                            icon: 'mdi mdi-1-5 mdi-archive',
                            text: 'Move to Scraps',
                            action: 'bulk-move-scraps',
                            disabled: false || currentGalleryView === 'scraps' || currentGalleryView === 'pinned'
                        },
                        {
                            icon: 'fa-solid fa-star',
                            text: 'Pin',
                            action: 'bulk-pin',
                            disabled: false || currentGalleryView !== 'images'
                        },
                        {
                            icon: 'fa-regular fa-star',
                            text: 'Unpin',
                            action: 'bulk-unpin',
                            disabled: false || currentGalleryView !== 'pinned'
                        },
                        {
                            icon: 'fas fa-pen-field',
                            text: 'Change Preset',
                            action: 'bulk-change-preset',
                            disabled: false
                        },
                        {
                            icon: 'nai-trash',
                            text: 'Delete',
                            action: 'bulk-delete',
                            disabled: false,
                            className: 'context-menu-item-danger'
                        }
                    ]
                }
            ]
        };
        window.contextMenu.attachToElement(item, bulkActionsConfig);
        item.dataset.bulkContextMenuActive = 'true';
    }
    
    item.addEventListener('click', (e) => {
        // Don't open lightbox if clicking on checkbox
        if (e.target.type === 'checkbox') {
            return;
        }

        // Use the data-file-index directly for better performance
        const fileIndex = parseInt(item.dataset.fileIndex, 10);
        if (!isNaN(fileIndex) && fileIndex >= 0 && fileIndex < allImages.length) {
            // Use index directly - much faster than searching by filename
            showLightbox(fileIndex);
        } else {
            // Fallback to filename search if index is invalid
            let filenameToShow = image.original;
            if (image.upscaled) {
                filenameToShow = image.upscaled;
            }

            const imageToShow = {
                filename: filenameToShow,
                base: image.base,
                upscaled: image.upscaled
            };
            showLightbox(imageToShow);
        }
    });

    return item;
}

// Reindex gallery items and placeholders
function reindexGallery() {
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length === 0) return;
    if (parseInt(items[items.length - 1]?.dataset?.index || '0') !== (items.length - 1)) {
        items.forEach((el, i) => {
            el.dataset.index = i.toString();
        });
    }
}

function scheduleDeferredPlaceholderAddition(direction) {
    // Don't schedule placeholder additions if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    pendingPlaceholderAdditions[direction] = true;
    
    if (deferredPlaceholderTimeout) {
        clearTimeout(deferredPlaceholderTimeout);
    }
    
    deferredPlaceholderTimeout = setTimeout(() => {
        if (pendingPlaceholderAdditions.above) {
            addPlaceholdersAbove();
            pendingPlaceholderAdditions.above = false;
        }
        if (pendingPlaceholderAdditions.below) {
            addPlaceholdersBelow();
            pendingPlaceholderAdditions.below = false;
        }
    }, 50); // 50ms delay to batch rapid scroll events
}

function addPlaceholdersAbove() {
    if (!gallery || isLoadingMore) return;
    
    // Don't add placeholders if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    // Check if there are actually images above the current position
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    let firstRealIndex = -1;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('gallery-placeholder')) {
            continue;
    } else {
            firstRealIndex = parseInt(items[i].dataset.index);
            break;
        }
    }
    
    // If firstRealIndex is 0 or -1, there are no images above to load
    if (firstRealIndex <= 0) return;
    
    // Only enable scroll position preservation if user is near the top of the gallery
    const scrollTop = window.pageYOffset;
    const isNearTop = scrollTop < 200; // Only preserve position if within 200px of top
    
    if (isNearTop && !scrollPositionPreservationEnabled) {
        scrollPositionPreservationEnabled = true;
        preserveScrollPosition();
    }
    
    const bufferRows = 8;
    const itemsPerRow = realGalleryColumns;
    const bufferSize = bufferRows * itemsPerRow;
    
    // Mobile-specific buffer size adjustment
    const isMobile = window.innerWidth <= infiniteScrollConfig.smallScreenThreshold;
    const adjustedBufferSize = isMobile ? Math.max(bufferSize, itemsPerRow * 4) : bufferSize; // Ensure at least 4 rows on mobile
    
    // Count placeholders above
    let placeholdersAbove = 0;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('gallery-placeholder')) {
            placeholdersAbove++;
        } else {
            break;
        }
    }
    
    // Add placeholders in row batches until buffer is filled
    while (placeholdersAbove < adjustedBufferSize && firstRealIndex > 0) {
        const needed = Math.min(adjustedBufferSize - placeholdersAbove, itemsPerRow);
        for (let i = 0; i < needed; i++) {
            const idx = firstRealIndex - i - 1;
            if (idx < 0) break;
            
            // Check if placeholder already exists
            const existingPlaceholder = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
            if (!existingPlaceholder) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.dataset.index = idx;
                placeholder.dataset.fileIndex = idx.toString();
                gallery.insertBefore(placeholder, gallery.firstChild);
                placeholdersAbove++;
            }
        }
        firstRealIndex = Math.max(0, firstRealIndex - needed);
    }
    
    // If we added placeholders and position preservation was enabled, restore it
    if (placeholdersAbove > 0 && scrollPositionPreservationEnabled) {
        // Use a small delay to ensure DOM updates are complete
        setTimeout(() => {
            restoreScrollPosition();
        }, 10);
    }
}

function addPlaceholdersBelow() {
    if (!gallery || isLoadingMore) return;
    
    // Don't add placeholders if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    // Check if there are actually images below the current position
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    let lastRealIndex = -1;
    
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].classList.contains('gallery-placeholder')) {
            continue;
        } else {
            lastRealIndex = parseInt(items[i].dataset.index);
            break;
        }
    }
    
    // If lastRealIndex is at or beyond the end of allImages, there are no more images below to load
    if (lastRealIndex >= allImages.length - 1) return;
    
    const bufferRows = 8;
    const itemsPerRow = realGalleryColumns;
    const bufferSize = bufferRows * itemsPerRow;
    
    // Mobile-specific buffer size adjustment
    const isMobile = window.innerWidth <= infiniteScrollConfig.smallScreenThreshold;
    const adjustedBufferSize = isMobile ? Math.max(bufferSize, itemsPerRow * 4) : bufferSize; // Ensure at least 4 rows on mobile
    
    // Count placeholders below
    let placeholdersBelow = 0;
    
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].classList.contains('gallery-placeholder')) {
            placeholdersBelow++;
        } else {
            break;
        }
    }
    
    // Add placeholders in row batches until buffer is filled
    while (placeholdersBelow < adjustedBufferSize && lastRealIndex < allImages.length - 1) {
        const needed = Math.min(adjustedBufferSize - placeholdersBelow, itemsPerRow);
        for (let i = 0; i < needed; i++) {
            const idx = lastRealIndex + i + 1;
            if (idx >= allImages.length) break;
            
            // Check if placeholder already exists
            const existingPlaceholder = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
            if (!existingPlaceholder) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.dataset.index = idx;
                placeholder.dataset.fileIndex = idx.toString();
                gallery.appendChild(placeholder);
                placeholdersBelow++;
            }
        }
        lastRealIndex = Math.min(allImages.length - 1, lastRealIndex + needed);
    }
}

// Improved infinite scroll handler with percentage-based triggers
function handleInfiniteScroll() {
    if (isLoadingMore) return;
    
    // Don't handle infinite scroll if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // Calculate responsive trigger distances
    const isSmallScreen = window.innerWidth <= infiniteScrollConfig.smallScreenThreshold;
    const multiplier = isSmallScreen ? infiniteScrollConfig.smallScreenMultiplier : 1;
    
    // Mobile-specific adjustments for better placeholder filling
    let topTriggerPercent = infiniteScrollConfig.topTriggerPercent;
    let placeholderTriggerPercent = infiniteScrollConfig.placeholderTriggerPercent;
    
    if (isSmallScreen) {
        // On mobile, be more aggressive with placeholder triggers
        topTriggerPercent = Math.max(topTriggerPercent, 0.2); // At least 20% from top
        placeholderTriggerPercent = Math.max(placeholderTriggerPercent, 0.3); // At least 30% for placeholders
    }
    
    // Use percentage-based triggers that adapt to page height
    const bottomTriggerDistance = Math.max(
        windowHeight * infiniteScrollConfig.bottomTriggerPercent * multiplier,
        windowHeight * 0.1 // Minimum 10% of viewport height
    );
    
    const topTriggerDistance = Math.max(
        windowHeight * topTriggerPercent * multiplier,
        windowHeight * 0.1 // Minimum 10% of viewport height
    );
    
    const placeholderTriggerDistance = Math.max(
        windowHeight * placeholderTriggerPercent * multiplier,
        windowHeight * 0.15 // Minimum 15% of viewport height
    );

    // Check if we're near the bottom and need to load more images
    const scrollBottom = scrollTop + windowHeight;
    const bottomThreshold = documentHeight - (windowHeight * infiniteScrollConfig.bottomTriggerPercent);
    
    if (scrollBottom >= bottomThreshold && !isLoadingMore) {
        // Check if there are actually more images to load before proceeding
        const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
        let lastRealIndex = -1;
        
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].classList.contains('gallery-placeholder')) {
                continue;
            } else {
                lastRealIndex = parseInt(items[i].dataset.index);
                break;
            }
        }
        
        // Only load more if there are actually more images available
        if (lastRealIndex < allImages.length - 1) {
            loadMoreImages();
        }
    }
    
    // Load more when user is near the top (percentage-based)
    if (scrollTop <= topTriggerDistance && hasMoreImagesBefore) {
        loadMoreImagesBefore();
    }
    
    // Schedule deferred placeholder additions for rapid scrolling
    // On mobile, be more aggressive with placeholder scheduling
    if (scrollTop <= placeholderTriggerDistance) {
        scheduleDeferredPlaceholderAddition('above');
        // On mobile, also trigger immediate placeholder addition for better responsiveness
        if (isSmallScreen && hasMoreImagesBefore) {
            addPlaceholdersAbove();
        }
    }
    if (scrollTop + windowHeight >= documentHeight - placeholderTriggerDistance) {
        scheduleDeferredPlaceholderAddition('below');
        // On mobile, also trigger immediate placeholder addition for better responsiveness
        if (isSmallScreen && hasMoreImages) {
            addPlaceholdersBelow();
        }
    }
    
    // Virtual scrolling: remove items that are too far from viewport
    if (virtualScrollEnabled) {
        updateVirtualScroll();
    }
}

// Load more images for infinite scroll (scroll down) with dynamic batch sizing
async function loadMoreImages() {
    if (isLoadingMore) return;
    
    try {
        isLoadingMore = true;
        if (infiniteScrollLoading) infiniteScrollLoading.classList.remove('hidden');
        
        // Check if there are actually more images to load
        const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
        let lastRealIndex = -1;
        
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].classList.contains('gallery-placeholder')) {
                continue;
            } else {
                lastRealIndex = parseInt(items[i].dataset.index);
                break;
            }
        }
        
        // If lastRealIndex is at or beyond the end of allImages, there are no more images to load
        if (lastRealIndex >= allImages.length - 1) {
            console.log('No more images to load');
            return;
        }
        
        // Determine the starting index for new images
        const startIndex = lastRealIndex + 1;
        const batchSize = calculateDynamicBatchSize();
        const endIndex = Math.min(startIndex + batchSize, allImages.length);
        
        // If startIndex is beyond the end, there's nothing to load
        if (startIndex >= allImages.length) {
            console.log('Start index beyond available images');
            return;
        }
        
        console.log(`Loading images from ${startIndex} to ${endIndex - 1}`);
        
        // Load the images
        for (let i = startIndex; i < endIndex; i++) {
            if (i < allImages.length) {
                const image = allImages[i];
                const item = createGalleryItem(image, i);
                gallery.appendChild(item);
                
                // Add animation class
                item.classList.add('fade-in');
                item.addEventListener('animationend', function handler() {
                    item.classList.remove('fade-in');
                    item.removeEventListener('animationend', handler);
                });
            }
        }
        
        // Update displayed range
        displayedEndIndex = endIndex;
        hasMoreImages = endIndex < allImages.length;
        
        // Update placeholders after adding real images
        updateGalleryPlaceholders();
        
    } catch (error) {
        console.error('Error loading more images:', error);
    } finally {
        isLoadingMore = false;
        if (infiniteScrollLoading) infiniteScrollLoading.classList.add('hidden');
    }
}

// Load more images before for infinite scroll (scroll up) with dynamic batch sizing
async function loadMoreImagesBefore() {
    if (isLoadingMore || !hasMoreImagesBefore) return;
    
    // Don't load more images if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.classList.remove('hidden');
    
    try {
        // Calculate dynamic batch size based on viewport
        const dynamicBatchSize = calculateDynamicBatchSize();
        
        // Calculate previous batch of images
        const endIndex = displayedStartIndex;
        const startIndex = Math.max(0, endIndex - dynamicBatchSize);
        const prevBatch = allImages.slice(startIndex, endIndex);
        
        if (prevBatch.length === 0) {
            hasMoreImagesBefore = false;
            return;
        }
        
        // Add placeholders for new items at the top with responsive height
        for (let i = endIndex - 1; i >= startIndex; i--) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.dataset.index = i;
            placeholder.dataset.fileIndex = i.toString();
            gallery.insertBefore(placeholder, gallery.firstChild);
        }
        
        // Update displayed range
        displayedStartIndex = startIndex;
        hasMoreImagesBefore = startIndex > 0;
        
        // Only restore scroll position if there are actually images above and user is near the top
        if (startIndex > 0) {
            const scrollTop = window.pageYOffset;
            const isNearTop = scrollTop < 200;
            
            if (isNearTop) {
                // Enable scroll position preservation and restore position
                if (!scrollPositionPreservationEnabled) {
                    scrollPositionPreservationEnabled = true;
                    preserveScrollPosition();
                }
                // Use a small delay to ensure DOM updates are complete
                setTimeout(() => {
                    restoreScrollPosition();
                }, 10);
            }
        }
        
    } catch (error) {
        console.error('Error loading more images before:', error);
    } finally {
        isLoadingMore = false;
        if (infiniteScrollLoading) infiniteScrollLoading.classList.add('hidden');
    }
}

// Helper functions for improved infinite scroll
function calculateDynamicBatchSize() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Base batch size on viewport size
    let baseSize = Math.ceil((windowWidth * windowHeight) / (300 * 300)); // Rough calculation
    
    // Adjust for small screens - ensure minimum batch size for mobile
    if (windowWidth <= infiniteScrollConfig.smallScreenThreshold) {
        // On mobile, ensure we have enough items to fill at least 2-3 rows
        const mobileMinBatch = Math.max(6, Math.ceil(realGalleryColumns * 2.5));
        baseSize = Math.max(baseSize, mobileMinBatch);
    }
    
    // Ensure batch size is within configured bounds
    return Math.max(
        infiniteScrollConfig.minBatchSize,
        Math.min(infiniteScrollConfig.maxBatchSize, baseSize)
    );
}

function calculatePlaceholderHeight() {
    // Calculate responsive placeholder height based on viewport
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Base height calculation
    let baseHeight = Math.min(windowWidth, windowHeight) * 0.3; // 30% of smaller viewport dimension
    
    // Adjust for different screen sizes
    if (windowWidth <= 480) {
        baseHeight = Math.min(baseHeight, 200); // Mobile: max 200px
    } else if (windowWidth <= 768) {
        baseHeight = Math.min(baseHeight, 250); // Tablet: max 250px
    } else {
        baseHeight = Math.min(baseHeight, 300); // Desktop: max 300px
    }
    
    // Ensure minimum height
    return Math.max(baseHeight, 150);
}

function calculateTrueItemsPerRow() {
    if (!gallery) return 5; // Fallback
    
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length < 2) return 5; // Need at least 2 items
    
    const firstItem = items[0];
    const firstRect = firstItem.getBoundingClientRect();
    const firstY = firstRect.top;
    
    // Find the next item that's at the same Y position (same row)
    let itemsInRow = 1;
    for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const rect = item.getBoundingClientRect();
        // Check if this item is at the same Y position (within 5px tolerance)
        if (Math.abs(rect.top - firstY) < 5) {
            itemsInRow++;
            } else {
            break; // Found the end of the first row
        }
    }
    
    return Math.max(1, itemsInRow);
}

// Calculate optimal number of columns based on container width and item width
function calculateOptimalColumns() {
    if (!gallery) return 5; // Fallback
    
    const containerWidth = gallery.offsetWidth;
    const minItemWidth = 320; // Minimum item width from CSS (updated to match CSS)
    const borderWidth = 4; // 2px border on each side
    
    // Calculate how many items can fit in the container
    const availableWidth = containerWidth;
    const itemWidthWithBorder = minItemWidth + borderWidth;
    const optimalColumns = Math.floor(availableWidth / itemWidthWithBorder);
    
    // Ensure we have at least 1 column and at most 10 columns
    return Math.max(1, Math.min(10, optimalColumns));
}

// Update gallery grid based on container width - only for infinite scrolling calculations
function updateGalleryGrid() {
    if (!gallery) return;
    
    const optimalColumns = calculateOptimalColumns();
    
    // Update the gallery columns variable for infinite scrolling
    galleryColumns = optimalColumns;
    realGalleryColumns = optimalColumns;
    
    // Update the gallery toggle group data attribute
    const galleryToggleGroup = document.getElementById('galleryToggleGroup');
    if (galleryToggleGroup) {
        galleryToggleGroup.dataset.columns = galleryColumns;
    }
    
    // Recalculate rows and update display for infinite scrolling
    galleryRows = calculateGalleryRows();
    imagesPerPage = realGalleryColumns * galleryRows;
    
    // Update placeholders
    updateGalleryPlaceholders();
}
// Update gallery columns based on true layout
function updateGalleryColumnsFromLayout() {
    // Don't update gallery if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    const trueColumns = calculateTrueItemsPerRow();
    if (trueColumns !== realGalleryColumns) {
        realGalleryColumns = trueColumns;
        galleryRows = calculateGalleryRows();
        imagesPerPage = realGalleryColumns * galleryRows;
    }
}

// Update visible items tracking for virtual scrolling
function updateVisibleItems() {
    if (!gallery) return;

    visibleItems.clear();
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop  + window.innerHeight;

    items.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top + window.pageYOffset;
        const itemBottom = rect.bottom + window.pageYOffset;

        // Check if item is visible in viewport
        if (itemBottom > viewportTop && itemTop < viewportBottom) {
            visibleItems.add(index);
        }
    });
}

// Virtual scroll: replace far-away items with placeholders
let virtualScrollThrottle = null;
let intersectionObserver = null;

// Gallery reset flag for iOS placeholder management
let isGalleryResetting = false;

// iOS-aware placeholder management
let isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
let placeholderCleanupQueue = [];
let lastScrollTime = 0;
let scrollVelocity = 0;
let isScrolling = false;
let scrollEndTimeout = null;

// iOS-aware placeholder cleanup to prevent layout shifts
function schedulePlaceholderCleanup(placeholdersToRemove) {
    if (placeholdersToRemove.length === 0) return;
    
    // Queue placeholders for removal
    placeholderCleanupQueue.push(...placeholdersToRemove);
    
    // If iOS, use a more sophisticated approach to prevent screen flashing
    if (isIOS) {
        // Wait for scroll momentum to stop
        const cleanupDelay = Math.max(100, Math.abs(scrollVelocity) * 10);
        
        // Use requestAnimationFrame to ensure smooth timing
        setTimeout(() => {
            requestAnimationFrame(() => {
                // Only proceed if scrolling has completely stopped
                if (!isScrolling && Math.abs(scrollVelocity) < 0.1) {
                    processPlaceholderCleanup();
                } else {
                    // If still scrolling, wait longer
                    setTimeout(() => processPlaceholderCleanup(), 200);
                }
            });
        }, cleanupDelay);
    } else {
        // For desktop, use a small delay to avoid interfering with active scrolling
        setTimeout(() => {
            if (!isScrolling) {
                processPlaceholderCleanup();
            }
        }, 50);
    }
}

function processPlaceholderCleanup() {
    if (placeholderCleanupQueue.length === 0) return;
    
    // Batch remove placeholders to minimize layout shifts
    const fragment = document.createDocumentFragment();
    let removedHeight = 0;
    
    // Add CSS properties to prevent screen flashing on iOS
    if (isIOS) {
        gallery.style.webkitBackfaceVisibility = 'hidden';
        gallery.style.transformStyle = 'preserve-3d';
        gallery.style.willChange = 'scroll-position';
        gallery.style.overscrollBehavior = 'contain'; // Prevent scroll chaining
    }
    
    placeholderCleanupQueue.forEach(placeholder => {
        if (placeholder && placeholder.parentNode) {
            // Store height before removal for scroll compensation
            removedHeight += placeholder.offsetHeight;
            fragment.appendChild(placeholder);
        }
    });
    
    // Remove all placeholders at once
    if (fragment.children.length > 0) {
        // Only apply scroll compensation on iOS to prevent desktop issues
        if (isIOS) {
            const currentScrollTop = window.pageYOffset;
            const compensation = Math.min(removedHeight, currentScrollTop);
            
            // Remove placeholders
            Array.from(fragment.children).forEach(placeholder => {
                if (placeholder.parentNode) {
                    placeholder.parentNode.removeChild(placeholder);
                }
            });
            
            // Compensate scroll position to prevent jumping (iOS only)
            // But be more conservative to prevent aggressive compensation
            if (compensation > 0 && compensation < currentScrollTop * 0.3) { // Only compensate if it's a small change
                window.scrollTo({
                    top: currentScrollTop - compensation,
                    behavior: 'instant' // Use instant to prevent iOS momentum issues
                });
            }
        } else {
            // On desktop, just remove placeholders without scroll compensation
            Array.from(fragment.children).forEach(placeholder => {
                if (placeholder.parentNode) {
                    placeholder.parentNode.removeChild(placeholder);
                }
            });
        }
    }
    
    // Clean up CSS properties to prevent screen flashing on iOS
    if (isIOS) {
        // Use requestAnimationFrame to ensure smooth cleanup
        requestAnimationFrame(() => {
            gallery.style.webkitBackfaceVisibility = '';
            gallery.style.transformStyle = '';
            gallery.style.willChange = '';
            gallery.style.overscrollBehavior = '';
        });
    }
    
    // Clear the queue
    placeholderCleanupQueue.length = 0;
}

// Track scroll velocity for iOS momentum detection
function updateScrollVelocity() {
    const now = Date.now();
    const currentScrollTop = window.pageYOffset;
    
    if (lastScrollTime > 0) {
        const timeDelta = now - lastScrollTime;
        const scrollDelta = currentScrollTop - lastScrollTop;
        scrollVelocity = scrollDelta / timeDelta;
    }
    
    lastScrollTime = now;
    lastScrollTop = currentScrollTop;
}

// Initialize intersection observer for better performance
function initIntersectionObserver() {
    if (intersectionObserver) return;
    
    intersectionObserver = new IntersectionObserver((entries) => {
        // Only trigger virtual scroll updates when items become visible/hidden
        let needsUpdate = false;
        entries.forEach(entry => {
            if (entry.isIntersecting !== entry.target.dataset.wasIntersecting) {
                needsUpdate = true;
                entry.target.dataset.wasIntersecting = entry.isIntersecting;
            }
        });
        
        if (needsUpdate) {
            // Adjust delay based on scroll velocity for better responsiveness during fast scrolling
            const currentVelocity = Math.abs(scrollVelocity);
            let delay = 0; // Default: no delay on desktop

            if (isIOS) {
                if (currentVelocity > 6) {
                    delay = 8; // Reduced delay during very fast scrolling on iOS
                } else if (currentVelocity > 3) {
                    delay = 12; // Slightly reduced delay during fast scrolling on iOS
                } else {
                    delay = 16; // Default delay for normal scrolling on iOS
                }
            } else if (currentVelocity > 6) {
                delay = 8; // Small delay during very fast scrolling on desktop to prevent excessive updates
            }

            if (delay > 0) {
                setTimeout(() => updateVirtualScroll(), delay);
            } else {
                updateVirtualScroll();
            }
        }
    }, {
        rootMargin: '100px', // Start observing 100px before items enter viewport
        threshold: 0.1
    });
}

function updateVirtualScroll() {
    if (!gallery) return;
    
    // Don't update virtual scroll if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    // Throttle virtual scroll updates for better performance with many items
    if (virtualScrollThrottle) return;
    virtualScrollThrottle = requestAnimationFrame(() => {
        virtualScrollThrottle = null;
        updateVirtualScrollInternal();
    });
}

function updateVirtualScrollInternal() {
    // Cache DOM queries for better performance with many items
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const total = items.length;

    // Early return if no items to process
    if (total === 0) return;

    // First, update visible items tracking
    updateVisibleItems();

    // Detect fast scrolling and adjust buffer size accordingly
    const isRapidScrolling = Math.abs(scrollVelocity) > 3; // Increased threshold for rapid scrolling
    const isVeryFastScrolling = Math.abs(scrollVelocity) > 6; // Threshold for very fast scrolling

    // Reduce buffer during fast scrolling to improve performance
    let bufferRows = 8; // Default number of rows to keep above and below viewport
    if (isVeryFastScrolling) {
        bufferRows = 3; // Very aggressive cleanup during very fast scrolling
    } else if (isRapidScrolling) {
        bufferRows = 5; // Moderate cleanup during fast scrolling
    }

    const itemsPerRow = realGalleryColumns;
    const visibleIndices = Array.from(visibleItems);

    if (visibleIndices.length === 0) return;

    const minVisible = Math.min(...visibleIndices);
    const maxVisible = Math.max(...visibleIndices);

    // Adjust buffer based on scroll velocity
    const bufferMultiplier = isRapidScrolling ? 0.5 : 1; // Reduce buffer during fast scrolling
    const minKeep = Math.max(0, minVisible - Math.floor(itemsPerRow * bufferMultiplier));
    const maxKeep = Math.min(total - 1, maxVisible + Math.floor(itemsPerRow * bufferMultiplier));
    const bufferSize = bufferRows * itemsPerRow;

    // Replace far-away items with placeholders, restore real items near viewport
    for (let i = 0; i < total; i++) {
        const el = items[i];
        if (i < minKeep || i > maxKeep) {
            // Convert real items to placeholders when they're far from viewport
            if (!el.classList.contains('gallery-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.dataset.filename = el.dataset.filename;
                placeholder.dataset.index = el.dataset.index || i;
                placeholder.dataset.fileIndex = el.dataset.fileIndex || el.dataset.index || i;
                placeholder.dataset.time = el.dataset.time || 0;
                placeholder.dataset.selected = el.dataset.selected;
                gallery.replaceChild(placeholder, el);
            }
        } else {
            // Only convert placeholders to real items when not scrolling rapidly
            // This prevents unnecessary loading during fast scrolling
            if (el.classList.contains('gallery-placeholder') && !isRapidScrolling) {
                const fileImageIndex = parseInt(el.dataset.fileIndex || el.dataset.index || i);
                const image = allImages[fileImageIndex];
                if (image) {
                    const realItem = createGalleryItem(image, fileImageIndex);
                    // The createGalleryItem function already handles selection state based on selectedImages Set
                    // No need to manually manage selectedImages here
                    gallery.replaceChild(realItem, el);
                }
            }
        }
    }

    // --- Dynamic placeholder management above and below buffer, in full row batches ---
    const allPlaceholders = Array.from(gallery.querySelectorAll('.gallery-placeholder'));
    // Find checked placeholders
    const checkedIndices = allPlaceholders
        .map((el, idx) => el.dataset.selected === 'true' ? idx : -1)
        .filter(idx => idx !== -1);
    const firstChecked = checkedIndices.length > 0 ? checkedIndices[0] : null;
    const lastChecked = checkedIndices.length > 0 ? checkedIndices[checkedIndices.length - 1] : null;

    // Build a set of all indices currently present in the DOM
    const presentIndices = new Set();
    Array.from(gallery.children).forEach(el => {
        if (el.dataset && el.dataset.index !== undefined) {
            presentIndices.add(parseInt(el.dataset.index));
        }
    });

    // Count placeholders above and below buffer
    let placeholdersAbove = 0, placeholdersBelow = 0;
    for (let i = 0; i < allPlaceholders.length; i++) {
        const idx = Array.prototype.indexOf.call(gallery.children, allPlaceholders[i]);
        if (idx < minKeep) placeholdersAbove++;
        if (idx > maxKeep) placeholdersBelow++;
    }
    // Smart placeholder cleanup for iOS compatibility
    // Instead of removing placeholders immediately, schedule them for cleanup
    const placeholdersToRemove = [];
    
    // Use different thresholds based on scroll velocity and platform
    let cleanupThreshold;
    if (isVeryFastScrolling) {
        cleanupThreshold = isIOS ? bufferSize * 0.5 : bufferSize * 1; // Very aggressive during very fast scrolling
    } else if (isRapidScrolling) {
        cleanupThreshold = isIOS ? bufferSize * 1 : bufferSize * 2; // Aggressive during fast scrolling
    } else {
        cleanupThreshold = isIOS ? bufferSize * 2 : bufferSize * 4; // Default conservative approach
    }

    // Check if user is actively scrolling down (which might indicate they want to go further)
    const isScrollingDown = scrollVelocity > 0;
    const isScrollingUp = scrollVelocity < 0;

    // Check if user is near the bottom and might want to scroll further down
    const isNearBottom = window.pageYOffset + window.innerHeight > document.documentElement.scrollHeight - 200;
    
    allPlaceholders.forEach(placeholder => {
        const idx = Array.prototype.indexOf.call(gallery.children, placeholder);
        
            // iOS: NEVER remove placeholders above the viewport to prevent screen flashing
    // Only remove placeholders below the viewport when safe
    // This follows iOS best practices to maintain scroll position and prevent screen flashing
    if (isIOS) {
        // On iOS, only remove placeholders that are far below the viewport
        // and only when scrolling up (not when scrolling down)
        // This prevents the "bounce" effect and maintains smooth scrolling
        if (idx > maxKeep + cleanupThreshold * 2 && isScrollingUp && !isScrollingDown) {
            if (placeholder.dataset.selected !== 'true') {
                placeholdersToRemove.push(placeholder);
            }
        }
    } else {
            // Desktop: More aggressive cleanup but still conservative
            let effectiveThreshold = isScrollingDown ? cleanupThreshold * 1.5 : cleanupThreshold;
            
            // Be even more conservative when near the bottom
            if (isNearBottom) {
                effectiveThreshold *= 2; // Double the threshold when near bottom
            }
            
            if (idx < minKeep - effectiveThreshold || idx > maxKeep + effectiveThreshold) {
                // Only remove placeholders that are very far from viewport
                if (placeholder.dataset.selected !== 'true') {
                    // Don't remove placeholders above when scrolling up, or below when scrolling down
                    if (!(isScrollingUp && idx < minKeep) && !(isScrollingDown && idx > maxKeep)) {
                        // Extra protection: don't remove placeholders below when near bottom
                        if (!(isNearBottom && idx > maxKeep)) {
                            placeholdersToRemove.push(placeholder);
                        }
                    }
                }
            }
        }
    });
    
    // Schedule cleanup to prevent layout shifts during iOS scrolling
    // Don't cleanup if user is actively scrolling to prevent interruptions
    // Use the same rapid scrolling detection as above for consistency
    const isCurrentlyRapidScrolling = Math.abs(scrollVelocity) > 3; // Use same threshold as above

    // During very fast scrolling, delay cleanup even more to prevent performance issues
    if (placeholdersToRemove.length > 0 && !isScrolling && !isCurrentlyRapidScrolling) {
        schedulePlaceholderCleanup(placeholdersToRemove);
    }
    // Add missing placeholders above (in full row batches, only for missing indices)
    while (placeholdersAbove < bufferSize) {
        // Check if there are actually images above the current position
        let firstChild = gallery.firstChild;
        let firstIndex = firstChild && firstChild.dataset && firstChild.dataset.index !== undefined ? parseInt(firstChild.dataset.index) : displayedStartIndex;
        
        // If firstIndex is 0 or less, there are no images above to load
        if (firstIndex <= 0) break;
        
        // Only enable scroll position preservation if user is near the top of the gallery
        const scrollTop = window.pageYOffset;
        const isNearTop = scrollTop < 200; // Only preserve position if within 200px of top
        
        if (isNearTop && !scrollPositionPreservationEnabled) {
            scrollPositionPreservationEnabled = true;
            preserveScrollPosition();
        }
        
        let needed = Math.min(bufferSize - placeholdersAbove, itemsPerRow);
        let actuallyAdded = 0;
        for (let i = 0; i < needed; i++) {
            const idx = firstIndex - i - 1;
            if (idx < 0) break;
            if (!presentIndices.has(idx)) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.dataset.index = idx;
                placeholder.dataset.fileIndex = idx.toString();
                gallery.insertBefore(placeholder, gallery.firstChild);
                presentIndices.add(idx);
                actuallyAdded++;
            }
        }
        placeholdersAbove += actuallyAdded;
        if (actuallyAdded === 0 || needed < itemsPerRow) break;
    }
    // Add missing placeholders below (in full row batches, only for missing indices)
    while (placeholdersBelow < bufferSize) {
        // Check if there are actually images below the current position
        let lastChild = gallery.lastChild;
        let lastIndex = lastChild && lastChild.dataset && lastChild.dataset.index !== undefined ? parseInt(lastChild.dataset.index) : displayedEndIndex;
        
        // If lastIndex is at or beyond the end of allImages, there are no more images below to load
        if (lastIndex >= allImages.length - 1) break;
        
        let needed = Math.min(bufferSize - placeholdersBelow, itemsPerRow);
        let actuallyAdded = 0;
        for (let i = 0; i < needed; i++) {
            const idx = lastIndex + i + 1;
            if (idx >= allImages.length) break;
            if (!presentIndices.has(idx)) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.dataset.index = idx;
                placeholder.dataset.fileIndex = idx.toString();
                gallery.appendChild(placeholder);
                presentIndices.add(idx);
                actuallyAdded++;
            }
        }
        placeholdersBelow += actuallyAdded;
        if (actuallyAdded === 0 || needed < itemsPerRow) break;
    }
    // After all changes, update displayedStartIndex and displayedEndIndex to match the DOM
    let newFirst = gallery.firstChild && gallery.firstChild.dataset && gallery.firstChild.dataset.index !== undefined ? parseInt(gallery.firstChild.dataset.index) : 0;
    let newLast = gallery.lastChild && gallery.lastChild.dataset && gallery.lastChild.dataset.index !== undefined ? parseInt(gallery.lastChild.dataset.index) : 0;
    displayedStartIndex = Math.max(0, newFirst);
    displayedEndIndex = Math.max(displayedStartIndex, newLast + 1);

    // --- Force resolve all placeholders in the visible/buffered range to real items ---
    // Recompute visible/buffered range after any placeholder changes
    const updatedItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const updatedTotal = updatedItems.length;
    // Recompute visible indices
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;
    let updatedVisible = new Set();
    updatedItems.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top + window.pageYOffset;
        const itemBottom = rect.bottom + window.pageYOffset;
        if (itemBottom > viewportTop && itemTop < viewportBottom) {
            updatedVisible.add(index);
        }
    });
    const updatedVisibleIndices = Array.from(updatedVisible);
    if (updatedVisibleIndices.length > 0) {
        const minVisible = Math.min(...updatedVisibleIndices);
        const maxVisible = Math.max(...updatedVisibleIndices);
        const minKeep = Math.max(0, minVisible - itemsPerRow); // 1 screen above
        const maxKeep = Math.min(updatedTotal - 1, maxVisible + itemsPerRow); // 1 screen below
        for (let i = minKeep; i <= maxKeep; i++) {
            const el = updatedItems[i];
            if (el && el.classList.contains('gallery-placeholder')) {
                const fileImageIndex = parseInt(el.dataset.fileIndex || el.dataset.index || i);
                const image = allImages[fileImageIndex];
                if (image) {
                    const realItem = createGalleryItem(image, fileImageIndex);
                    // The createGalleryItem function already handles selection state based on selectedImages Set
                    // No need to manually manage selectedImages here
                    gallery.replaceChild(realItem, el);
                }
            }
        }
    }

    // With sentinel-based approach, infinite scroll is handled by Intersection Observer
    // No need for scroll-based detection here
    
    // Restore scroll position if placeholders were added above
    if (scrollPositionPreservationEnabled) {
        restoreScrollPosition();
    }
}

// Remove image from gallery and add placeholder at the end
function removeImageFromGallery(image) {
    // Don't update gallery if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            console.error('No filename available for image removal');
            return;
        }

        // Find the gallery item to remove
        const galleryItems = document.querySelectorAll('.gallery-item');
        let itemToRemove = null;
        let itemIndex = -1;

        // Try to find by exact filename match first
        for (const item of galleryItems) {
            const img = item.querySelector('img');
            if (img) {
                const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                if (itemFilename === filename) {
                    itemToRemove = item;
                    itemIndex = parseInt(item.dataset.index);
                    break;
                }
            }
        }

        // If not found by exact match, try to find by base name (for variations/upscaled)
        if (!itemToRemove) {
            const baseName = filename.split('_')[0]; // Get the timestamp part
            for (const item of galleryItems) {
                const img = item.querySelector('img');
                if (img) {
                    const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                    const itemBaseName = itemFilename.split('_')[0];
                    if (itemBaseName === baseName) {
                        itemToRemove = item;
                        itemIndex = parseInt(item.dataset.index);
                        break;
                    }
                }
            }
        }

        if (!itemToRemove) {
            console.warn('Gallery item not found for removal:', filename);
            // Don't return, just log the warning and continue with the operation
            // The image will still be removed from allImages array and workspace
        }

        // Remove the item from the gallery if found
        if (itemToRemove) {
        itemToRemove.remove();
        }

        // Remove from allImages array
        const allImagesIndex = findTrueImageIndex(image);
        
        if (allImagesIndex !== -1) {
            allImages.splice(allImagesIndex, 1);
        }

        // Add placeholder at the index after the last item on the page
        // Re-query gallery items since we may have removed one
        const remainingGalleryItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
        const lastItemIndex = remainingGalleryItems.length > 0 ? 
            Math.min(Math.max(...Array.from(remainingGalleryItems).map(item => parseInt(item.dataset.index))), allImages.length) : -1;
        const placeholderIndex = lastItemIndex + 1;
        
        const placeholder = document.createElement('div');
        placeholder.className = 'gallery-placeholder';
        placeholder.dataset.index = placeholderIndex.toString();
        placeholder.dataset.fileIndex = placeholderIndex.toString();
        gallery.appendChild(placeholder);

        // Reindex all gallery items after the removed one (only if we found and removed an item)
        if (itemToRemove && itemIndex !== -1) {
            const remainingItems = gallery.querySelectorAll('.gallery-item');
            for (const item of remainingItems) {
                const currentIndex = parseInt(item.dataset.index);
                if (currentIndex > itemIndex) {
                    item.dataset.index = (currentIndex - 1).toString();
                    // Also update file-index if it exists
                    if (item.dataset.fileIndex) {
                        const currentFileIndex = parseInt(item.dataset.fileIndex);
                        item.dataset.fileIndex = (currentFileIndex - 1).toString();
                    }
                }
            }

            // Update placeholder indices
            const placeholders = gallery.querySelectorAll('.gallery-placeholder');
            for (const placeholder of placeholders) {
                const currentIndex = parseInt(placeholder.dataset.index);
                if (currentIndex > itemIndex) {
                    placeholder.dataset.index = (currentIndex - 1).toString();
                    // Also update file-index if it exists
                    if (placeholder.dataset.fileIndex) {
                        const currentFileIndex = parseInt(placeholder.dataset.fileIndex);
                        placeholder.dataset.fileIndex = (currentFileIndex - 1).toString();
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error removing image from gallery:', error);
    }
}

// Remove multiple images from gallery and add placeholders at the end
function removeMultipleImagesFromGallery(images) {
    // Don't update gallery if manual modal is open
    if (!manualModal.classList.contains('hidden')) return;
    
    try {
        if (!Array.isArray(images) || images.length === 0) {
            console.warn('No images provided for bulk removal');
            return;
        }

        const galleryItems = document.querySelectorAll('.gallery-item');
        const itemsToRemove = [];
        const indicesToRemove = [];

        // Find all items to remove
        for (const image of images) {
            const filename = image.filename || image.original || image.upscaled;
            if (!filename) continue;

            for (const item of galleryItems) {
                const img = item.querySelector('img');
                if (img) {
                    const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                    if (itemFilename === filename) {
                        itemsToRemove.push(item);
                        indicesToRemove.push(parseInt(item.dataset.index));
                        break;
                    }
                }
            }
        }

        // Sort indices in descending order to remove from end to beginning
        indicesToRemove.sort((a, b) => b - a);

        // Remove items from gallery
        itemsToRemove.forEach(item => item.remove());

        // Remove from allImages array
        for (const image of images) {
            const allImagesIndex = findTrueImageIndex(image);
            
            if (allImagesIndex !== -1) {
                allImages.splice(allImagesIndex, 1);
            }
        }

        // Add placeholders at the end
        for (let i = 0; i < images.length; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-placeholder';
            placeholder.dataset.index = allImages.length + i;
            placeholder.dataset.fileIndex = (allImages.length + i).toString();
            gallery.appendChild(placeholder);
        }

        // Reindex all remaining gallery items
        const remainingItems = gallery.querySelectorAll('.gallery-item');
        for (const item of remainingItems) {
            const currentIndex = parseInt(item.dataset.index);
            let newIndex = currentIndex;
            
            // Count how many items were removed before this one
            for (const removedIndex of indicesToRemove) {
                if (currentIndex > removedIndex) {
                    newIndex--;
                }
            }
            
            item.dataset.index = newIndex.toString();
            // Also update file-index if it exists
            if (item.dataset.fileIndex) {
                const currentFileIndex = parseInt(item.dataset.fileIndex);
                let newFileIndex = currentFileIndex;
                for (const removedIndex of indicesToRemove) {
                    if (currentFileIndex > removedIndex) {
                        newFileIndex--;
                    }
                }
                item.dataset.fileIndex = newFileIndex.toString();
            }
        }

        // Update placeholder indices
        const placeholders = gallery.querySelectorAll('.gallery-placeholder');
        for (const placeholder of placeholders) {
            const currentIndex = parseInt(placeholder.dataset.index);
            let newIndex = currentIndex;
            
            // Count how many items were removed before this one
            for (const removedIndex of indicesToRemove) {
                if (currentIndex > removedIndex) {
                    newIndex--;
                }
            }
            
            placeholder.dataset.index = newIndex.toString();
            // Also update file-index if it exists
            if (placeholder.dataset.fileIndex) {
                const currentFileIndex = parseInt(placeholder.dataset.fileIndex);
                let newFileIndex = currentFileIndex;
                for (const removedIndex of indicesToRemove) {
                    if (currentFileIndex > removedIndex) {
                        newFileIndex--;
                    }
                }
                placeholder.dataset.fileIndex = newFileIndex.toString();
            }
        }
    } catch (error) {
        console.error('Error removing multiple images from gallery:', error);
    }
}

// Selection handling functions
async function handleImageSelection(image, isSelected, event) {
    const filename = image.filename || image.original || image.upscaled;

    // Skip if no valid filename found
    if (!filename) {
        console.warn('No valid filename found for image:', image);
        return;
    }

    const item = event.target.closest('.gallery-item');

    // ALT+click range selection
    if (event && event.altKey) {
        // Get all gallery items (both real items and placeholders) in order
    const allItems = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
    const clickedIndex = allItems.findIndex(div => div.dataset.filename === filename);
    
    if (lastSelectedGalleryIndex !== null && clickedIndex !== -1) {
        const [start, end] = [lastSelectedGalleryIndex, clickedIndex].sort((a, b) => a - b);
        
        // Select all items in range
        for (let i = start; i <= end; i++) {
            const div = allItems[i];
            const itemFilename = div.dataset.filename;
            
                // Update data-selected attribute
            div.dataset.selected = 'true';
            div.classList.add('selected');
            selectedImages.add(itemFilename);
            
                // Update checkbox if it's a real item
            const cb = div.querySelector('.gallery-item-checkbox');
            if (cb) cb.checked = true;
        }
        
        updateBulkActionsBar();
        lastSelectedGalleryIndex = clickedIndex;
            return;
        }
    }

    // Update last selected index for range selection
    const allItems = Array.from(document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]'));
    const thisIndex = allItems.findIndex(div => div.dataset.filename === filename);
    if (thisIndex !== -1) {
        lastSelectedGalleryIndex = thisIndex;
    }

    // Update selection state using data-selected as single source of truth
    if (isSelected) {
        selectedImages.add(filename);
        item.dataset.selected = 'true';
        item.classList.add('selected');
    } else {
        selectedImages.delete(filename);
        item.dataset.selected = 'false';
        item.classList.remove('selected');
    }

    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    // Update selection mode state
    if (selectedImages.size > 0) {
        gallery.classList.add('selection-mode');
        isSelectionMode = true;
        
        // Switch to bulk actions context menu when in selection mode
        if (window.contextMenu && !gallery.dataset.bulkContextMenuActive) {
            switchToBulkContextMenu();
            gallery.dataset.bulkContextMenuActive = 'true';
        }
    } else {
        gallery.classList.remove('selection-mode');
        isSelectionMode = false;
        
        // Switch back to original context menus when not in selection mode
        if (window.contextMenu && gallery.dataset.bulkContextMenuActive) {
            switchToOriginalContextMenu();
            gallery.dataset.bulkContextMenuActive = '';
        }
    }
}

function clearSelection() {
    selectedImages.clear();
    lastSelectedGalleryIndex = null; // Reset range selection tracking

    // Uncheck all checkboxes
    const checkboxes = document.querySelectorAll('.gallery-item-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });

    // Remove selected class and data-selected attribute from all items (both real items and placeholders)
    const allItems = document.querySelectorAll('.gallery-item, .gallery-placeholder');
    allItems.forEach(item => {
        item.classList.remove('selected');
        item.dataset.selected = 'false';
    });

    updateBulkActionsBar();
}

window.wsClient.registerInitStep(30, 'Initializing Gallery System', async () => {
    // With sentinel-based approach, the main infinite scroll is handled by Intersection Observer
    // The scroll event now only handles virtual scrolling and placeholder management
    let lastScrollTime = 0;
    let scrollTimeout;
    
    function throttledInfiniteScroll() {
        const now = Date.now();
        if (now - lastScrollTime > infiniteScrollConfig.throttleDelay) {
            handleInfiniteScroll();
            lastScrollTime = now;
        }
    }

    window.addEventListener('scroll', () => {
        // Track scroll velocity for iOS momentum detection
        updateScrollVelocity();
        
        // Mark as scrolling and clear any existing timeout
        isScrolling = true;
        if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
        
        // Set a timeout to detect when scrolling stops
        const scrollEndDelay = isIOS ? 150 : 100; // Less delay on desktop
        scrollEndTimeout = setTimeout(() => {
            isScrolling = false;
            // Process any queued placeholder cleanup when scrolling stops
            if (placeholderCleanupQueue.length > 0) {
                processPlaceholderCleanup();
            }
        }, scrollEndDelay);
        
        throttledInfiniteScroll();

        // Adjust debounce delay based on scroll velocity for more responsive handling
        const currentVelocity = Math.abs(scrollVelocity);
        let adjustedDebounceDelay = infiniteScrollConfig.debounceDelay;
        if (currentVelocity > 6) {
            adjustedDebounceDelay = Math.max(50, adjustedDebounceDelay * 0.3); // Much faster response during very fast scrolling
        } else if (currentVelocity > 3) {
            adjustedDebounceDelay = Math.max(100, adjustedDebounceDelay * 0.6); // Faster response during fast scrolling
        }

        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            handleInfiniteScroll();
        }, adjustedDebounceDelay);
    });
});

// Gallery sort order functions
function toggleGallerySortOrder() {
    // Toggle between desc (newest first) and asc (oldest first)
    gallerySortOrder = gallerySortOrder === 'desc' ? 'asc' : 'desc';
    window.gallerySortOrder = gallerySortOrder;
    
    // Update the button state and icon
    const sortOrderBtn = document.getElementById('sortOrderToggleBtn');
    if (sortOrderBtn) {
        sortOrderBtn.dataset.state = gallerySortOrder;
        const icon = sortOrderBtn.querySelector('i');
        if (icon) {
            if (gallerySortOrder === 'desc') {
                icon.className = 'fa-light fa-sort-amount-down';
                sortOrderBtn.title = 'Sort Order: Newest First';
            } else {
                icon.className = 'fa-light fa-sort-amount-up';
                sortOrderBtn.title = 'Sort Order: Oldest First';
            }
        }
    }

    // Update the mobile button state and icon
    const mobileSortOrderBtn = document.getElementById('mobileSortOrderToggleBtn');
    if (mobileSortOrderBtn) {
        mobileSortOrderBtn.dataset.state = gallerySortOrder;
        const mobileIcon = mobileSortOrderBtn.querySelector('i');
        if (mobileIcon) {
            if (gallerySortOrder === 'desc') {
                mobileIcon.className = 'fa-light fa-sort-amount-down';
                mobileSortOrderBtn.title = 'Sort Order: Newest First';
            } else {
                mobileIcon.className = 'fa-light fa-sort-amount-up';
                mobileSortOrderBtn.title = 'Sort Order: Oldest First';
            }
        }
    }
    
    // Sort the current gallery data
    sortGalleryData();
    
    // Re-render the gallery with new sort order
    resetInfiniteScroll();
    displayCurrentPageOptimized();
}

function sortGalleryData() {
    if (!allImages || allImages.length === 0) return;
    
    // Sort by modification time (mtime)
    allImages.sort((a, b) => {
        const timeA = a.mtime || 0;
        const timeB = b.mtime || 0;
        
        if (gallerySortOrder === 'desc') {
            return timeB - timeA; // Newest first
        } else {
            return timeA - timeB; // Oldest first
        }
    });
}

// Display gallery starting from a specific index
function displayGalleryFromStartIndex(startIndex) {
    if (!gallery) return;
    
    // Set flag for complete gallery reset
    isGalleryResetting = true;
    
    // Clear gallery
    gallery.innerHTML = '';

    // If no images, show empty state
    if (allImages.length === 0) {
        return;
    }

    // Calculate how many items to display
    const itemHeight = calculatePlaceholderHeight();
    const itemsPerCol = Math.floor(window.innerHeight / itemHeight);
    const buffer = Math.ceil(itemsPerCol * 0.15);
    const totalItems = Math.min((itemsPerCol + buffer) * realGalleryColumns, allImages.length - startIndex);
    
    const endIndex = Math.min(startIndex + totalItems, allImages.length);

    // Desktop: Create real gallery items immediately
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
        const image = allImages[i];
        if (image) {
            const galleryItem = createGalleryItem(image, i);
            galleryItem.classList.add('fade-in');
            fragment.appendChild(galleryItem);
        }
    }
    gallery.appendChild(fragment);

    // Fade in items one by one
    const items = gallery.querySelectorAll('.gallery-item.fade-in');
    items.forEach((el, idx) => {
        setTimeout(() => {
            el.classList.add('fade-in');
            el.addEventListener('animationend', function handler() {
                el.classList.remove('fade-in');
                el.removeEventListener('animationend', handler);
            });
        }, idx * 60);
    });
    
    const anchorItem = gallery.querySelector(`[data-index="${startIndex}"]`);
    if (anchorItem) {
        const rect = anchorItem.getBoundingClientRect();
        const targetScrollTop = window.pageYOffset + rect.top - 100; // 100px offset from top
        
        // Smooth scroll to maintain visual continuity
        window.scrollTo({
            top: targetScrollTop,
            behavior: 'instant' // Use 'auto' for immediate positioning to avoid jarring
        });
    }
    
    updateGalleryItemToolbars();
    updateGalleryPlaceholders();
}

// Function to trigger gallery move modal with selected images
function triggerGalleryMoveWithSelection() {
    if (selectedImages.size === 0) {
        showError('No images selected for move');
        return;
    }
    
    // Set the selected images in the gallery toolbar module
    if (window.galleryMoveSelectedImages) {
        window.galleryMoveSelectedImages.clear();
        selectedImages.forEach(filename => {
            window.galleryMoveSelectedImages.add(filename);
        });
    }
    
    // Show the gallery move modal with null filename to indicate multi-select mode
    if (typeof showGalleryMoveModal === 'function') {
        showGalleryMoveModal(null);
    }
}

// Context menu action handlers for gallery items
function handleGalleryContextMenuAction(event) {
    const { action, target, item } = event.detail;
    const galleryItem = target.closest('.gallery-item');
    
    if (!galleryItem) return;
    
    const filename = galleryItem.dataset.filename;
    const fileIndex = parseInt(galleryItem.dataset.fileIndex, 10);
    const image = allImages[fileIndex];
    
    if (!image) return;
    
    switch (action) {
        case 'toggle-checkbox':
            // Toggle the checkbox for this gallery item
            const checkboxCheckbox = galleryItem.querySelector('.gallery-item-checkbox');
            if (checkboxCheckbox) {
                checkboxCheckbox.checked = !checkboxCheckbox.checked;
                checkboxCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;
            
        case 'toggle-favorite':
            // Toggle pin status directly
            togglePinImage(image, null);
            // Update the image's pin status for future context menu loads
            image.isPinned = !image.isPinned;
            break;
            
        case 'download':
            downloadImage(image);
            break;
            
        case 'copy':
            // Copy image to clipboard directly
            copyImageToClipboard(image);
            break;
            
        case 'move':
            // Select the image and show move modal
            selectedImages.clear();
            selectedImages.add(filename);
            galleryItem.dataset.selected = 'true';
            galleryItem.classList.add('selected');
            const checkbox = galleryItem.querySelector('.gallery-item-checkbox');
            if (checkbox) checkbox.checked = true;
            updateBulkActionsBar();
            showGalleryMoveModal(filename);
            break;
            
        case 'scrap':
            // Move image to scraps directly
            moveImageToScraps(image);
            break;
            
        case 'start-chat':
            // Open chat modal for this image
            if (window.chatSystem) {
                window.chatSystem.openChatModal(filename, image.characterName || null);
            }
            break;
            
        case 'delete':
            // Delete image directly
            deleteImage(image);
            break;
            
        case 'reroll':
            rerollImage(image, event);
            break;
            
        case 'modify':
            rerollImageWithEdit(image, event);
            break;
            
        case 'upscale':
            if (!image.upscaled) {
                upscaleImage(image, event);
            }
            break;
            
        case 'create-reference':
            // Create reference from image
            createReferenceFromImage(image);
            break;
            
        case 'create-encoding':
            // Create vibe encoding from image
            createVibeEncodingFromImage(image);
            break;
    }
}

// Helper functions for context menu actions
function copyImageToClipboard(image) {
    // Copy image to clipboard directly
    (async () => {
        try {
            // Determine the correct URL for the image
            let imageUrl;
            if (image.url) {
                // For newly generated images
                imageUrl = image.url;
            } else {
                // For gallery images - prefer highest quality version
                const filename = image.upscaled || image.original;
                imageUrl = `/images/${filename}`;
            }
            
            // Fetch the image as a blob
            const response = await fetch(imageUrl);
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
    })();
}

function moveImageToScraps(image, event = null) {
    const filename = image.filename || image.original || image.upscaled;

    // Call the move to scraps function directly
    if (typeof moveImageToScrapsDirect === 'function') {
        moveImageToScrapsDirect(filename, event);
    } else {
        // Fallback: use the existing scrap functionality
        console.warn('moveImageToScrapsDirect function not available, using fallback');
        // You can implement the direct scrap functionality here
    }
}

async function handleMoveToWorkspace(image, workspaceId, workspaceName) {
    const filename = image.filename || image.original || image.upscaled;
    
    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Move image to workspace "${workspaceName}"?`,
        [
            { text: 'Move', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]
    );
    
    if (confirmed) {
        try {
            // Show loading toast
            const toastId = showGlassToast('info', 'Moving Image', `Moving image to ${workspaceName}...`, true, false, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
            
            // Move the image using WebSocket
            if (window.wsClient && window.wsClient.isConnected()) {
                // Determine move type based on current gallery view
                const isScrapsView = currentGalleryView === 'scraps';
                const isPinnedView = currentGalleryView === 'pinned';
                let moveType = 'files';
                if (isScrapsView) {
                    moveType = 'scraps';
                } else if (isPinnedView) {
                    moveType = 'pinned';
                }
                
                const response = await window.wsClient.moveFilesToWorkspace([filename], workspaceId, activeWorkspace, moveType);
                
                if (response.success) {
                    // Update loading toast to success
                    updateGlassToastProgress(toastId, 100);
                    updateGlassToastComplete(toastId, {
                        type: 'success',
                        title: 'Image Moved',
                        message: `Image moved to ${workspaceName}`,
                        icon: '<i class="fas fa-folder-open"></i>',
                        showProgress: false,
                        timeout: 5000
                    });
                    
                    // Remove the image from current view
                    removeImageFromGallery(filename);
                } else {
                    throw new Error(response.error || 'Failed to move image');
                }
            } else {
                throw new Error('WebSocket not connected');
            }
        } catch (error) {
            console.error('Error moving image to workspace:', error);
            // Update loading toast to error
            updateGlassToastProgress(toastId, 100);
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Move Failed',
                message: `Failed to move image to ${workspaceName}: ${error.message}`,
                icon: '<i class="fas fa-exclamation-triangle"></i>',
                showProgress: false,
                timeout: 5000
            });
        }
    }
}

function deleteImage(image) {
    const filename = image.filename || image.original || image.upscaled;
    
    // Call the delete function directly
    if (typeof deleteImageDirect === 'function') {
        deleteImageDirect(filename);
    } else {
        // Fallback: use the existing delete functionality
        console.warn('deleteImageDirect function not available, using fallback');
        // You can implement the direct delete functionality here
    }
}

function createReferenceFromImage(image) {
    // Get the image URL
    const filename = image.upscaled || image.original;
    const imageUrl = `/images/${filename}`;
    
    // Show unified upload modal in reference mode
    if (typeof showUnifiedUploadModal === 'function') {
        // Set the image URL in the modal
        const urlInput = document.getElementById('unifiedUploadUrlInput');
        if (urlInput) {
            urlInput.value = imageUrl;
        }
        
        // Trigger the modal to open in reference mode
        showUnifiedUploadModal();
        
        // Set the mode to reference
        setTimeout(() => {
            const modeSelector = document.getElementById('unifiedUploadModeSelector');
            if (modeSelector) {
                const referenceBtn = modeSelector.querySelector('[data-mode="reference"]');
                if (referenceBtn) {
                    referenceBtn.click();
                }
            }
        }, 100);
    } else {
        console.warn('showUnifiedUploadModal function not available');
    }
}

function createVibeEncodingFromImage(image) {
    // Get the image URL
    const filename = image.upscaled || image.original;
    const imageUrl = `/images/${filename}`;
    
    // Show unified upload modal in vibe mode
    if (typeof showUnifiedUploadModal === 'function') {
        // Set the image URL in the modal
        const urlInput = document.getElementById('unifiedUploadUrlInput');
        if (urlInput) {
            urlInput.value = imageUrl;
        }
        
        // Trigger the modal to open in vibe mode
        showUnifiedUploadModal();
        
        // Set the mode to vibe
        setTimeout(() => {
            const modeSelector = document.getElementById('unifiedUploadModeSelector');
            if (modeSelector) {
                const vibeBtn = modeSelector.querySelector('[data-mode="vibe"]');
                if (vibeBtn) {
                    vibeBtn.click();
                }
            }
        }, 100);
    } else {
        console.warn('showUnifiedUploadModal function not available');
    }
}


// Switch to bulk actions context menu
function switchToBulkContextMenu() {
    if (!window.contextMenu) return;
    
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    const bulkActionsConfig = {
        maxHeight: true,
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fa-solid fa-check-double',
                        tooltip: 'Select All',
                        action: 'bulk-select-all'
                    },
                    {
                        icon: 'nai-thin-cross',
                        tooltip: 'Clear Selection',
                        action: 'bulk-clear-selection',
                        disabled: false
                    }
                ]
            },
            {
                type: 'list',
                title: 'Bulk Actions',
                items: [
                    {
                        icon: 'fas fa-share',
                        text: 'Share to Sequenzia',
                        action: 'bulk-sequenzia',
                        disabled: false
                    },
                    {
                        icon: 'fas fa-folder',
                        text: 'Move to Workspace',
                        action: 'bulk-move-workspace',
                        disabled: false
                    },
                    {
                        icon: 'mdi mdi-1-5 mdi-archive',
                        text: 'Move to Scraps',
                        action: 'bulk-move-scraps',
                        disabled: currentGalleryView === 'scraps' || currentGalleryView === 'pinned'
                    },
                    {
                        icon: 'fa-solid fa-star',
                        text: 'Pin',
                        action: 'bulk-pin',
                        disabled: currentGalleryView !== 'images'
                    },
                    {
                        icon: 'fa-regular fa-star',
                        text: 'Unpin',
                        action: 'bulk-unpin',
                        disabled: currentGalleryView !== 'pinned'
                    },
                    {
                        icon: 'fas fa-pen-field',
                        text: 'Change Preset',
                        action: 'bulk-change-preset',
                        disabled: false
                    },
                    {
                        icon: 'nai-trash',
                        text: 'Delete',
                        action: 'bulk-delete',
                        disabled: false,
                        className: 'context-menu-item-danger'
                    }
                ]
            }
        ]
    };
    
    // Attach bulk context menu to gallery and all gallery items
    window.contextMenu.attachToElement(gallery, bulkActionsConfig);
    
    const galleryItems = gallery.querySelectorAll('.gallery-item');
    galleryItems.forEach(item => {
        // Store original context menu config if not already stored
        if (!item.dataset.originalContextMenuStored) {
            const originalConfigId = item.dataset.contextMenu;
            if (originalConfigId && window.contextMenu.configs && window.contextMenu.configs[originalConfigId]) {
                item.dataset.originalContextMenuConfig = originalConfigId;
                item.dataset.originalContextMenuStored = 'true';
            }
        }
        
        // Attach bulk context menu to override individual menu
        window.contextMenu.attachToElement(item, bulkActionsConfig);
        item.dataset.bulkContextMenuActive = 'true';
    });
}

// Switch back to original context menus
function switchToOriginalContextMenu() {
    if (!window.contextMenu) return;
    
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    // Detach bulk context menu from gallery
    window.contextMenu.detachFromElement(gallery);
    
    // Restore original context menus for all gallery items
    const galleryItems = gallery.querySelectorAll('.gallery-item');
    galleryItems.forEach(item => {
        if (item.dataset.bulkContextMenuActive) {
            // Detach bulk context menu
            window.contextMenu.detachFromElement(item);
            item.dataset.bulkContextMenuActive = '';
            
            // Restore original context menu if it was stored
            if (item.dataset.originalContextMenuStored && item.dataset.originalContextMenuConfig) {
                const originalConfigId = item.dataset.originalContextMenuConfig;
                if (window.contextMenu.configs && window.contextMenu.configs[originalConfigId]) {
                    // Reattach the original context menu
                    window.contextMenu.attachToElement(item, window.contextMenu.configs[originalConfigId]);
                }
            }
        }
    });
}

// Setup bulk actions context menu for gallery (legacy function - now handled by switchToBulkContextMenu)
function setupBulkActionsContextMenu() {
    if (!window.contextMenu) return;
    
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    const bulkActionsConfig = {
        maxHeight: true,
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fa-solid fa-check-double',
                        tooltip: 'Select All',
                        action: 'bulk-select-all'
                    },
                    {
                        icon: 'nai-thin-cross',
                        tooltip: 'Clear Selection',
                        action: 'bulk-clear-selection',
                        disabled: false
                    }
                ]
            },
            {
                type: 'list',
                title: 'Bulk Actions',
                items: [
                    {
                        icon: 'fas fa-share',
                        text: 'Share to Sequenzia',
                        action: 'bulk-sequenzia',
                        disabled: false
                    },
                    {
                        icon: 'fas fa-folder',
                        text: 'Move to Workspace',
                        action: 'bulk-move-workspace',
                        disabled: false
                    },
                    {
                        icon: 'mdi mdi-1-5 mdi-archive',
                        text: 'Move to Scraps',
                        action: 'bulk-move-scraps',
                        disabled: currentGalleryView === 'scraps' || currentGalleryView === 'pinned'
                    },
                    {
                        icon: 'fa-solid fa-star',
                        text: 'Pin',
                        action: 'bulk-pin',
                        disabled: currentGalleryView !== 'images'
                    },
                    {
                        icon: 'fa-regular fa-star',
                        text: 'Unpin',
                        action: 'bulk-unpin',
                        disabled: currentGalleryView !== 'pinned'
                    },
                    {
                        icon: 'fas fa-pen-field',
                        text: 'Change Preset',
                        action: 'bulk-change-preset',
                        disabled: false
                    },
                    {
                        icon: 'nai-trash',
                        text: 'Delete',
                        action: 'bulk-delete',
                        disabled: false,
                        className: 'context-menu-item-danger'
                    }
                ]
            }
        ]
    };
    
    // Attach to gallery and all gallery items to override individual item context menus
    window.contextMenu.attachToElement(gallery, bulkActionsConfig);
    
    // Also attach to all existing gallery items to override their individual context menus
    const galleryItems = gallery.querySelectorAll('.gallery-item');
    galleryItems.forEach(item => {
        // Only attach if the item doesn't already have a bulk context menu
        if (!item.dataset.bulkContextMenuAttached) {
            window.contextMenu.attachToElement(item, bulkActionsConfig);
            item.dataset.bulkContextMenuAttached = 'true';
        }
    });
}

// Handle bulk actions context menu
function handleBulkActionsContextMenu(event) {
    const { action, target } = event.detail;
    
    // Only handle bulk actions
    if (!action.startsWith('bulk-')) return;
    
    switch (action) {
        case 'bulk-sequenzia':
            if (typeof handleBulkSequenzia === 'function') {
                handleBulkSequenzia();
            }
            break;
        case 'bulk-move-workspace':
            if (typeof handleBulkMoveToWorkspace === 'function') {
                handleBulkMoveToWorkspace();
            }
            break;
        case 'bulk-move-scraps':
            if (typeof handleBulkMoveToScraps === 'function') {
                handleBulkMoveToScraps();
            }
            break;
        case 'bulk-pin':
            if (typeof handleBulkPin === 'function') {
                handleBulkPin();
            }
            break;
        case 'bulk-unpin':
            if (typeof handleBulkUnpin === 'function') {
                handleBulkUnpin();
            }
            break;
        case 'bulk-change-preset':
            if (typeof handleBulkChangePreset === 'function') {
                handleBulkChangePreset();
            }
            break;
        case 'bulk-delete':
            if (typeof handleBulkDelete === 'function') {
                handleBulkDelete();
            }
            break;
        case 'bulk-select-all':
            const checkboxes = document.querySelectorAll('.gallery-item-checkbox');
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change'));
                }
            });
            break;
        case 'bulk-clear-selection':
            if (typeof clearSelection === 'function') {
                clearSelection();
            }
            break;
    }
}

// Add context menu event listener
document.addEventListener('contextMenuAction', handleGalleryContextMenuAction);
document.addEventListener('contextMenuAction', handleBulkActionsContextMenu);

// Make necessary functions and variables globally accessible for app.js
window.loadGallery = loadGallery;
window.resetInfiniteScroll = resetInfiniteScroll;
window.displayCurrentPageOptimized = displayCurrentPageOptimized;
window.displayGalleryFromStartIndex = displayGalleryFromStartIndex;
window.realGalleryColumns = realGalleryColumns;
window.updateGalleryGrid = updateGalleryGrid;
window.calculateOptimalColumns = calculateOptimalColumns;
window.setupBulkActionsContextMenu = setupBulkActionsContextMenu;
window.switchToBulkContextMenu = switchToBulkContextMenu;
window.switchToOriginalContextMenu = switchToOriginalContextMenu;