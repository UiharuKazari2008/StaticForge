// Gallery Toolbar Popover System
// Provides a popover toolbar for gallery items with action buttons

let galleryToolbar = null;
let galleryToolbarActive = false;
let currentGalleryItem = null;

// Create and show gallery toolbar popover
function showGalleryToolbar(image, event = null) {
    // Hide any existing toolbar
    hideGalleryToolbar();
    
    // Create toolbar if it doesn't exist
    if (!galleryToolbar) {
        galleryToolbar = document.createElement('div');
        galleryToolbar.id = 'galleryToolbar';
        galleryToolbar.className = 'gallery-toolbar';
        document.body.appendChild(galleryToolbar);
        
        // Add click outside listener
        document.addEventListener('click', handleGalleryToolbarClickOutside);
    }
    
    // Update toolbar content
    updateGalleryToolbarContent(image);
    
    // Position toolbar near the event or gallery item
    positionGalleryToolbar(event);
    
    // Show toolbar
    galleryToolbar.style.display = 'block';
    galleryToolbarActive = true;
    currentGalleryItem = image;
}

// Hide gallery toolbar
function hideGalleryToolbar() {
    if (galleryToolbar) {
        galleryToolbar.style.display = 'none';
        galleryToolbarActive = false;
        currentGalleryItem = null;
    }
}

// Update toolbar content based on image and current view
function updateGalleryToolbarContent(image) {
    const filename = image.filename || image.original || image.upscaled;
    
    // Determine scrap button text and action based on current view
    let scrapButtonText, scrapButtonIcon, scrapButtonAction;
    if (currentGalleryView === 'scraps') {
        scrapButtonText = 'Remove from scraps';
        scrapButtonIcon = 'nai-undo';
        scrapButtonAction = () => removeFromScraps(image);
    } else {
        scrapButtonText = 'Move to scraps';
        scrapButtonIcon = 'nai-image-tool-sketch';
        scrapButtonAction = () => moveToScraps(image);
    }
    
    galleryToolbar.innerHTML = `
        <div class="gallery-toolbar-content">
            <div class="gallery-toolbar-buttons">
                <button class="btn-secondary gallery-toolbar-close" title="Close" type="button">
                    <i class="nai-cross"></i>
                </button>
                <button class="btn-secondary gallery-toolbar-reference" title="Add as Reference" type="button">
                    <i class="fas fa-folder-image"></i>
                </button>
                <button class="btn-secondary gallery-toolbar-vibe" title="Encode as Vibe Transfer" type="button">
                    <i class="nai-vibe-transfer"></i>
                </button>
                <button class="btn-secondary gallery-toolbar-scrap" title="${scrapButtonText}" type="button">
                    <i class="${scrapButtonIcon}"></i>
                </button>
                <button class="btn-danger gallery-toolbar-delete" title="Delete image" type="button">
                    <i class="nai-trash"></i>
                </button>
            </div>
        </div>
    `;
    
    // Add event listeners
    const closeBtn = galleryToolbar.querySelector('.gallery-toolbar-close');
    const referenceBtn = galleryToolbar.querySelector('.gallery-toolbar-reference');
    const vibeBtn = galleryToolbar.querySelector('.gallery-toolbar-vibe');
    const scrapBtn = galleryToolbar.querySelector('.gallery-toolbar-scrap');
    const deleteBtn = galleryToolbar.querySelector('.gallery-toolbar-delete');
    
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideGalleryToolbar();
    });
    
    referenceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addImageAsReference(image);
        hideGalleryToolbar();
    });
    
    vibeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addImageAsVibeTransfer(image);
        hideGalleryToolbar();
    });
    
    scrapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        scrapButtonAction();
        hideGalleryToolbar();
    });
    
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteImage(image, e);
        hideGalleryToolbar();
    });
}

// Position toolbar near mouse or gallery item
function positionGalleryToolbar(event) {
    if (!galleryToolbar) return;
    
    const rect = galleryToolbar.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let x, y;
    
    if (event) {
        // Position near mouse
        x = event.clientX - rect.width / 2;
        y = event.clientY - rect.height - 10;
    } else {
        // Center on screen
        x = (windowWidth - rect.width) / 2;
        y = (windowHeight - rect.height) / 2;
    }
    
    // Ensure toolbar doesn't go off screen
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    if (x + rect.width > windowWidth - 10) x = windowWidth - rect.width - 10;
    if (y + rect.height > windowHeight - 10) y = windowHeight - rect.height - 10;
    
    galleryToolbar.style.left = x + 'px';
    galleryToolbar.style.top = y + 'px';
}

// Handle click outside toolbar
function handleGalleryToolbarClickOutside(e) {
    if (galleryToolbarActive && galleryToolbar && !galleryToolbar.contains(e.target)) {
        hideGalleryToolbar();
    }
}

// Add image as reference (base image)
async function addImageAsReference(image) {
    try {
        // Get the image data
        const filename = image.filename || image.original || image.upscaled;
        
        // Show loading toast
        const toastId = showGlassToast('info', 'Adding Reference', 'Copying image to workspace references...', true);
        
        // Copy image to workspace cache
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace || 'default'}/references/copy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: filename
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            
            // Set as base image for manual generation
            window.uploadedImageData = {
                image_source: `file:${result.hash}`,
                isPlaceholder: false
            };
            
            // Update UI to show base image is set
            updateUploadDeleteButtonVisibility();
            
            // Show success toast
            updateGlassToast(toastId, 'success', 'Reference Added', 'Image copied to workspace references and set as base image');
            
            // Refresh cache images if cache manager is open
            if (document.getElementById('cacheManagerModal') && document.getElementById('cacheManagerModal').style.display === 'block') {
                await loadCacheManagerImages();
            }
            
            // Close manual modal if open and reopen to show the reference
            if (document.getElementById('manualModal').style.display === 'block') {
                hideManualModal();
                setTimeout(() => {
                    showManualModal();
                }, 100);
            }
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to copy image to references');
        }
        
    } catch (error) {
        console.error('Error adding image as reference:', error);
        showError('Failed to add image as reference: ' + error.message);
    }
}

// Add image as vibe transfer
async function addImageAsVibeTransfer(image) {
    try {
        // Get the image data
        const filename = image.filename || image.original || image.upscaled;
        
        // Show loading toast
        const toastId = showGlassToast('info', 'Creating Vibe Encoding', 'Processing image for vibe transfer...', true);
        
        // Send to vibe encode endpoint
        const response = await fetchWithAuth('/vibe/encode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: `file:${filename}`,
                informationExtraction: 0.5, // Default IE value
                model: 'nai-diffusion-3', // Default model
                workspace: activeWorkspace || 'default'
            })
        });
        
        if (response.ok) {
            // Update balance and show credit deduction toast
            const cost = 2; // Estimated vibe encoding cost
            await updateBalanceAndShowCreditDeduction('vibe encoding', cost);
            
            // Show success toast
            updateGlassToast(toastId, 'success', 'Vibe Transfer Added', 'Image encoded for vibe transfer successfully');
            
            // Add to vibe transfer container if manual modal is open
            if (document.getElementById('manualModal').style.display === 'block') {
                // Refresh vibe references
                await loadVibeReferences();
            }
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to encode vibe image');
        }
        
    } catch (error) {
        console.error('Error adding image as vibe transfer:', error);
        showError('Failed to add image as vibe transfer: ' + error.message);
    }
}