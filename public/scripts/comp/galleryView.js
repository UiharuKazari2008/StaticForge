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
let currentManualPreviewImage = null;

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
}

// Restore scroll position after adding placeholders above
function restoreScrollPosition() {
    if (!scrollPositionPreservationEnabled || lastVisibleItemIndex === -1) return;
    
    // Find the anchor item by its index
    const anchorItem = gallery.querySelector(`[data-index="${lastVisibleItemIndex}"]`);
    if (anchorItem) {
        const rect = anchorItem.getBoundingClientRect();
        const targetScrollTop = window.pageYOffset + rect.top - 100; // 100px offset from top
        
        // Smooth scroll to maintain visual continuity
        window.scrollTo({
            top: targetScrollTop,
            behavior: 'auto' // Use 'auto' for immediate positioning to avoid jarring
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
function switchGalleryView(view, force = false) {
    if (currentGalleryView === view && !force) return;
    
    // Check if we're in the middle of workspace switching to avoid duplicate calls
    if (window.isWorkspaceSwitching && !force) {
        console.log('🔄 Skipping gallery view switch during workspace transition');
        return;
    }
    
    // Don't switch gallery view if manual modal is open (unless forced)
    if (manualModal.style.display !== 'none') return;
    
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
            loadScraps();
            break;
        case 'images':
            document.body.classList.remove('scraps-grayscale');
            loadGallery();
            break;
        case 'pinned':
            document.body.classList.remove('scraps-grayscale');
            loadPinned();
            break;
        case 'upscaled':
            document.body.classList.remove('scraps-grayscale');
            loadUpscaled();
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
            if (manualModal.style.display === 'none') {
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
        if (manualModal.style.display === 'none') {
            displayCurrentPageOptimized();
        }
    }
}

// Add a new gallery item after generation with fade-in and slide-in animations
async function addNewGalleryItemAfterGeneration(newImage) {
    // Don't add new gallery items if manual modal is open
    if (manualModal.style.display !== 'none') return;
    
    // Add placeholder with fade-in
    const placeholder = document.createElement('div');
    placeholder.className = 'gallery-placeholder fade-in';
    placeholder.style.height = calculatePlaceholderHeight() + 'px';
    placeholder.style.width = '100%';
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
    galleryColumns = Math.max(3, Math.min(10, parseInt(cols) || 5));
    gallery.style.gridTemplateColumns = `repeat(${galleryColumns}, 1fr)`;
    
    // Update the gallery toggle group data attribute
    const galleryToggleGroup = document.getElementById('galleryToggleGroup');
    if (galleryToggleGroup) {
        galleryToggleGroup.dataset.columns = galleryColumns;
    }

    // Recalculate rows based on new column count
    galleryRows = calculateGalleryRows();
    
    if (debounceGalleryTimeout) clearTimeout(debounceGalleryTimeout);
    debounceGalleryTimeout = setTimeout(() => {
        updateGalleryColumnsFromLayout();
        displayCurrentPageOptimized();
        resetInfiniteScroll();
    }, 500);
    updateGalleryPlaceholders();
}

function updateGalleryPlaceholders() {
    if (!gallery) return;
    
    // Don't update gallery if manual modal is open
    if (manualModal.style.display !== 'none') return;
    
    // Remove old placeholders
    Array.from(gallery.querySelectorAll('.gallery-placeholder')).forEach(el => el.remove());

    // For infinite scroll, we don't need to add placeholders for the current page
    // Placeholders will be added when loading more images
}

function updateGalleryItemToolbars() {
    // Don't update gallery if manual modal is open
    if (manualModal.style.display !== 'none') return;
    
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
            miniToolbar.style.display = 'flex';
        } else {
            item.classList.remove('mini-toolbar-active');
            if (miniToolbar) {
                miniToolbar.style.display = 'none';
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
    if (manualModal.style.display !== 'none') return;

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
    updateVirtualScroll();
    updateGalleryItemToolbars();
    updateGalleryPlaceholders();
}

function resetInfiniteScroll() {
    window.scrollTo({ top: 0, behavior: 'instant' });
    displayedStartIndex = 0;
    displayedEndIndex = 0;
    isLoadingMore = false;
    hasMoreImages = true;
    hasMoreImagesBefore = false;
    
    // Update batch size based on current viewport
    imagesPerPage = calculateDynamicBatchSize();
    
    if (infiniteScrollLoading) {
        infiniteScrollLoading.style.display = 'none';
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
    img.src = `/previews/${encodeURIComponent(image.preview)}`;
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

    // Regular filename format: timestamp_preset_seed.png
    const parts = image.base.split('_');
    if (parts.length >= 3) {
        presetName = parts.slice(1, -1).join('_') || 'generated';
        seed = parts[parts.length - 1] || '';
    }

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
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn-secondary round-button';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadImage(image);
    };

    // Direct reroll button (left side)
    const rerollBtn = document.createElement('button');
    rerollBtn.type = 'button';
    rerollBtn.className = 'btn-secondary round-button';
    rerollBtn.innerHTML = '<i class="nai-dice"></i>';
    rerollBtn.title = 'Reroll with same settings';
    rerollBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImage(image);
    };

    // Reroll with edit button (right side with cog)
    const rerollEditBtn = document.createElement('button');
    rerollEditBtn.type = 'button';
    rerollEditBtn.className = 'btn-secondary round-button';
    rerollEditBtn.innerHTML = '<i class="mdi mdi-1-25 mdi-text-box-edit-outline"></i>';
    rerollEditBtn.title = 'Reroll with Edit';
    rerollEditBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImageWithEdit(image);
    };

    // Upscale button (only for non-upscaled images)
    const upscaleBtn = document.createElement('button');
    upscaleBtn.type = 'button';
    upscaleBtn.className = 'btn-secondary round-button';
    upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
    upscaleBtn.title = 'Upscale';
    upscaleBtn.onclick = (e) => {
        e.stopPropagation();
        upscaleImage(image, e);
    };

    // Only show upscale button for non-upscaled images
    if (!image.upscaled) {
        upscaleBtn.style.display = 'inline-block';
    } else {
        upscaleBtn.style.display = 'none';
    }

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

    // Toolbar trigger button (combines scrap and delete)
    const toolbarBtn = document.createElement('button');
    toolbarBtn.type = 'button';
    toolbarBtn.className = 'btn-secondary round-button';
    toolbarBtn.innerHTML = '<i class="nai-dotdotdot"></i>';
    toolbarBtn.title = 'More actions';
    toolbarBtn.onclick = (e) => {
        e.stopPropagation();
        showGalleryToolbar(image, e);
    };

    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(upscaleBtn);
    actionsDiv.appendChild(rerollBtn);
    actionsDiv.appendChild(rerollEditBtn);
    actionsDiv.appendChild(pinBtn);
    actionsDiv.appendChild(toolbarBtn);

    overlay.appendChild(actionsDiv);

    item.appendChild(checkbox);
    item.appendChild(img);
    item.appendChild(overlay);

    
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
    if (manualModal.style.display !== 'none') return;
    
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
    if (manualModal.style.display !== 'none') return;
    
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
                placeholder.style.height = calculatePlaceholderHeight() + 'px';
                placeholder.style.width = '100%';
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
    if (manualModal.style.display !== 'none') return;
    
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
                placeholder.style.height = calculatePlaceholderHeight() + 'px';
                placeholder.style.width = '100%';
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
    if (manualModal.style.display !== 'none') return;

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
        if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'block';
        
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
        if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'none';
    }
}

// Load more images before for infinite scroll (scroll up) with dynamic batch sizing
async function loadMoreImagesBefore() {
    if (isLoadingMore || !hasMoreImagesBefore) return;
    
    // Don't load more images if manual modal is open
    if (manualModal.style.display !== 'none') return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'flex';
    
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
            placeholder.style.height = calculatePlaceholderHeight() + 'px';
            placeholder.style.width = '100%';
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
        if (infiniteScrollLoading) infiniteScrollLoading.style.display = 'none';
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
// Update gallery columns based on true layout
function updateGalleryColumnsFromLayout() {
    // Don't update gallery if manual modal is open
    if (manualModal.style.display !== 'none') return;
    
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
function updateVirtualScroll() {
    if (!gallery) return;
    
    // Don't update virtual scroll if manual modal is open
    if (manualModal.style.display !== 'none') return;

    // First, update visible items tracking
    updateVisibleItems();

    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const total = items.length;
    const bufferRows = 8; // Number of rows to keep above and below viewport
    const itemsPerRow = realGalleryColumns;
    const visibleIndices = Array.from(visibleItems);

    if (visibleIndices.length === 0) return;

    const minVisible = Math.min(...visibleIndices);
    const maxVisible = Math.max(...visibleIndices);
    const minKeep = Math.max(0, minVisible - itemsPerRow); // 1 screen above
    const maxKeep = Math.min(total - 1, maxVisible + itemsPerRow); // 1 screen below
    const bufferSize = bufferRows * itemsPerRow;

    // Replace far-away items with placeholders, restore real items near viewport
    for (let i = 0; i < total; i++) {
        const el = items[i];
        if (i < minKeep || i > maxKeep) {
            if (!el.classList.contains('gallery-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'gallery-placeholder';
                placeholder.style.height = el.offsetHeight + 'px';
                placeholder.style.width = el.offsetWidth + 'px';
                placeholder.dataset.filename = el.dataset.filename;
                placeholder.dataset.index = el.dataset.index || i;
                placeholder.dataset.fileIndex = el.dataset.fileIndex || el.dataset.index || i;
                placeholder.dataset.time = el.dataset.time || 0;
                placeholder.dataset.selected = el.dataset.selected;
                gallery.replaceChild(placeholder, el);
            }
        } else {
            if (el.classList.contains('gallery-placeholder')) {
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
    // Remove excess placeholders above (in full row batches, not checked or after first checked)
    let toRemoveAbove = placeholdersAbove - bufferSize;
    if (toRemoveAbove >= itemsPerRow) {
        toRemoveAbove = Math.floor(toRemoveAbove / itemsPerRow) * itemsPerRow;
        let removed = 0;
        for (let i = 0; i < allPlaceholders.length && removed < toRemoveAbove; i++) {
            const el = allPlaceholders[i];
            const idx = Array.prototype.indexOf.call(gallery.children, el);
            if (idx < minKeep) {
                if (el.dataset.selected === 'true' || (firstChecked !== null && i >= firstChecked)) break;
                presentIndices.delete(parseInt(el.dataset.index));
                el.remove();
                removed++;
            }
        }
    }
    // Remove excess placeholders below (in full row batches, not checked or before last checked)
    let toRemoveBelow = placeholdersBelow - bufferSize;
    if (toRemoveBelow >= itemsPerRow) {
        toRemoveBelow = Math.floor(toRemoveBelow / itemsPerRow) * itemsPerRow;
        let removed = 0;
        for (let i = allPlaceholders.length - 1; i >= 0 && removed < toRemoveBelow; i--) {
            const el = allPlaceholders[i];
            const idx = Array.prototype.indexOf.call(gallery.children, el);
            if (idx > maxKeep) {
                if (el.dataset.selected === 'true' || (lastChecked !== null && i <= lastChecked)) break;
                presentIndices.delete(parseInt(el.dataset.index));
                el.remove();
                removed++;
            }
        }
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
                placeholder.style.height = '256px';
                placeholder.style.width = '100%';
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
                placeholder.style.height = '256px';
                placeholder.style.width = '100%';
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
    if (manualModal.style.display !== 'none') return;
    
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
        placeholder.style.height = '256px';
        placeholder.style.width = '100%';
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
    if (manualModal.style.display !== 'none') return;
    
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
            placeholder.style.height = calculatePlaceholderHeight() + 'px';
            placeholder.style.width = '100%';
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
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCount = document.getElementById('selectedCount');
    const bulkMoveToScrapsBtn = document.getElementById('bulkMoveToScrapsBtn');
    const bulkPinBtn = document.getElementById('bulkPinBtn');
    const bulkUnpinBtn = document.getElementById('bulkUnpinBtn');

    if (selectedImages.size > 0) {
        bulkActionsBar.style.display = 'flex';
        selectedCount.textContent = selectedImages.size;
        gallery.classList.add('selection-mode');
        isSelectionMode = true;

        // Show/hide buttons based on current view
        if (bulkMoveToScrapsBtn) {
            if (currentGalleryView === 'scraps') {
                // Hide scrap button when viewing scraps (can't move scraps to scraps)
                bulkMoveToScrapsBtn.style.display = 'none';
            } else if (currentGalleryView === 'pinned') {
                // Hide scrap button when viewing pinned (can't move pinned to scraps)
                bulkMoveToScrapsBtn.style.display = 'none';
            } else {
                // Show scrap button when viewing regular images
                bulkMoveToScrapsBtn.style.display = 'inline-block';
            }
        }

        // Show/hide pin button based on current view
        if (bulkPinBtn) {
            if (currentGalleryView === 'images') {
                // Show pin button when viewing regular images
                bulkPinBtn.style.display = 'inline-block';
            } else {
                // Hide pin button for other views
                bulkPinBtn.style.display = 'none';
            }
        }

        // Show/hide unpin button based on current view
        if (bulkUnpinBtn) {
            if (currentGalleryView === 'pinned') {
                // Show unpin button when viewing pinned items
                bulkUnpinBtn.style.display = 'inline-block';
            } else {
                // Hide unpin button for other views
                bulkUnpinBtn.style.display = 'none';
            }
        }
    } else {
        bulkActionsBar.style.display = 'none';
        gallery.classList.remove('selection-mode');
        isSelectionMode = false;
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
        throttledInfiniteScroll();
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            handleInfiniteScroll();
        }, infiniteScrollConfig.debounceDelay);
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

// Make necessary functions and variables globally accessible for app.js
window.loadGallery = loadGallery;
window.resetInfiniteScroll = resetInfiniteScroll;
window.displayCurrentPageOptimized = displayCurrentPageOptimized;
window.displayGalleryFromStartIndex = displayGalleryFromStartIndex;
window.realGalleryColumns = realGalleryColumns;