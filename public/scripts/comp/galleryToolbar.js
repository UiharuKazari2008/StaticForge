// Gallery Toolbar Popover System
// Provides a popover toolbar for gallery items with action buttons

let galleryToolbar = null;
let galleryToolbarActive = false;
let currentGalleryItem = null;

// Gallery move modal variables for multi-select
let galleryMoveSelectedImages = new Set();
let galleryMoveCrossFadeInterval = null;
let galleryMoveCrossFadeIndex = 0;

// Make galleryMoveSelectedImages globally accessible
window.galleryMoveSelectedImages = galleryMoveSelectedImages;

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
    galleryToolbar.classList.remove('hidden');
    galleryToolbarActive = true;
    currentGalleryItem = image;
}

// Hide gallery toolbar
function hideGalleryToolbar() {
    if (galleryToolbar) {
        galleryToolbar.classList.add('hidden');
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
        scrapButtonIcon = 'mdi mdi-1-5 mdi-archive-arrow-up';
        scrapButtonAction = () => removeFromScraps(image);
    } else {
        scrapButtonText = 'Move to scraps';
        scrapButtonIcon = 'mdi mdi-1-5 mdi-archive';
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
                    <i class="mdi mdi-1-5 mdi-data-matrix-scan"></i>
                </button>
                <button class="btn-secondary gallery-toolbar-move" title="Move to workspace" type="button">
                    <i class="mdi mdi-1-5 mdi-folder-move"></i>
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
    const moveBtn = galleryToolbar.querySelector('.gallery-toolbar-move');
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
    
    moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveImageToWorkspace(image);
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
    
    galleryToolbar.style.left = `min(${x}px, calc(100vw - 330px))`;
    galleryToolbar.style.top = `min(${y}px, calc(100vh - 100px))`;
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
        const toastId = showGlassToast('info', 'Adding Reference', 'Copying image to workspace references...', true, false, '<i class="fas fa-plus-circle"></i>');
        
        // Convert image to base64 for WebSocket upload
        const imageResponse = await fetch(`/images/${filename}`);
        const imageBlob = await imageResponse.blob();
        const base64 = await blobToBase64(imageBlob);
        
        // Upload via WebSocket
        const response = await wsClient.uploadReference(base64, activeWorkspace || 'default');
        
        if (response.success) {
            // Show success toast
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Reference Added',
                message: 'Image copied to workspace references and set as base image',
                showProgress: false
            });
            await loadCacheImages();
            
            // Ensure reference manager is refreshed after reference operation
            if (typeof refreshReferenceManagerAfterVibeOperation === 'function') {
                await refreshReferenceManagerAfterVibeOperation();
            }
        } else {
            throw new Error(response.message || 'Failed to copy image to references');
        }
        
    } catch (error) {
        console.error('Error adding image as reference:', error);
        showError('Failed to add image as reference: ' + error.message);
    }
}

// Helper function to convert blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data URL prefix
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

// Add image as vibe transfer
async function addImageAsVibeTransfer(image) {
    try {
        // Get the image data
        const filename = image.filename || image.original || image.upscaled;
        
        // Convert image to base64 for vibe encoding
        const imageResponse = await fetch(`/images/${filename}`);
        const imageBlob = await imageResponse.blob();
        const base64 = await blobToBase64(imageBlob);
        
        // Store the image data for the vibe encoding modal
        window.galleryToolbarVibeImage = base64;
        
        // Show the vibe encoding modal in gallery mode
        showVibeEncodingModal('gallery');
        
    } catch (error) {
        console.error('Error preparing image for vibe transfer:', error);
        showError('Failed to prepare image for vibe transfer: ' + error.message);
    }
}

// Move image to another workspace
async function moveImageToWorkspace(image) {
    try {
        // Get the image filename
        const filename = image.filename || image.original || image.upscaled;
        
        // Seed the modal selection with this single filename to ensure it moves even for upscaled-only items
        if (window.galleryMoveSelectedImages && filename) {
            window.galleryMoveSelectedImages.clear();
            window.galleryMoveSelectedImages.add(filename);
        }

        // Show workspace selection modal
        showGalleryMoveModal(filename);
        
    } catch (error) {
        console.error('Error setting up move for gallery image:', error);
        showError('Failed to set up move operation');
    }
}

// Show workspace selection modal for moving gallery images
function showGalleryMoveModal(filename) {
    // Check if we have selected images or a single target image
    const hasSelectedImages = galleryMoveSelectedImages.size > 0;
    const hasTargetImage = filename !== null;
    
    if (!hasSelectedImages && !hasTargetImage) {
        showError('No images selected for move');
        return;
    }
    
    // Create modal if it doesn't exist
    let modal = document.getElementById('galleryMoveModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'galleryMoveModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content gallery-move-modal-content">
                <div class="gallery-move-left-panel">
                    <img src="/images/background.jpg" alt="Image to move" class="gallery-move-background-image" id="galleryMoveBackgroundImage">
                    <div class="gallery-move-overlay">
                        <div class="gallery-move-image-info-overlay">
                            <p><strong>Images:</strong> <span id="galleryMoveCount">0</span> selected</p>
                            <p><strong>Current workspace:</strong> <span id="galleryMoveCurrentWorkspace"></span></p>
                        </div>
                    </div>
                </div>
                <div class="gallery-move-right-panel">
                    <div class="modal-header gallery-move-header">
                        <h3><i class="mdi mdi-1-5 mdi-folder-move"></i> Move to Workspace</h3>
                        <button class="blur btn-secondary btn-small modal-close" type="button">
                            <i class="nai-cross"></i>
                        </button>
                    </div>
                    <div class="gallery-move-content">
                        <div class="gallery-move-instructions">
                            <h4>Select Target Workspace</h4>
                            <p>Choose the workspace where you want to move the selected images:</p>
                        </div>
                        <div class="gallery-move-workspace-selector">
                            <div class="custom-dropdown" id="galleryMoveWorkspaceDropdown">
                                <button class="custom-dropdown-btn" id="galleryMoveWorkspaceDropdownBtn" type="button">
                                    <span id="galleryMoveWorkspaceSelected">Select workspace...</span>
                                </button>
                                <div class="custom-dropdown-menu hidden" id="galleryMoveWorkspaceDropdownMenu">
                                    <!-- Workspace options will be populated here -->
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="gallery-move-actions">
                        <button class="btn-secondary" id="galleryMoveCancelBtn" type="button">Cancel</button>
                        <button class="btn-primary" id="galleryMoveConfirmBtn" type="button" disabled><span>Move</span> <i class="mdi mdi-1-5 mdi-folder-move"></i></button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Add event listeners
        const closeBtn = modal.querySelector('.modal-close');
        const cancelBtn = modal.querySelector('#galleryMoveCancelBtn');
        const confirmBtn = modal.querySelector('#galleryMoveConfirmBtn');
        
        closeBtn.addEventListener('click', hideGalleryMoveModal);
        cancelBtn.addEventListener('click', hideGalleryMoveModal);
        confirmBtn.addEventListener('click', () => {
            const selectedWorkspace = modal.querySelector('#galleryMoveWorkspaceSelected').dataset.value;
            if (selectedWorkspace) {
                if (hasSelectedImages) {
                    executeGalleryMoveMultiple(selectedWorkspace);
                } else {
                    executeGalleryMove(filename, selectedWorkspace);
                }
            } else {
                showError('Please select a target workspace');
            }
        });
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideGalleryMoveModal();
            }
        });
    }
    
    // Update background image and info based on mode
    const backgroundImage = modal.querySelector('#galleryMoveBackgroundImage');
    const moveCount = modal.querySelector('#galleryMoveCount');
    const currentWorkspaceSpan = modal.querySelector('#galleryMoveCurrentWorkspace');
    
    if (hasSelectedImages) {
        // Multi-select mode
        const selectedImages = Array.from(galleryMoveSelectedImages).slice(0, 5); // Only first 5 for cross-fade
        const firstImage = selectedImages[0];
        
        if (backgroundImage && firstImage) {
            backgroundImage.src = `/images/${firstImage}`;
            backgroundImage.alt = `Images to move: ${selectedImages.length} selected`;
        }
        
        if (moveCount) {
            moveCount.textContent = selectedImages.length;
        }
        
        // Start cross-fade if multiple images
        if (selectedImages.length > 1) {
            startGalleryMoveCrossFade(selectedImages);
        }
    } else {
        // Single image mode
        if (backgroundImage) {
            backgroundImage.src = `/images/${filename}`;
            backgroundImage.alt = `Image to move: ${filename}`;
        }
        
        if (moveCount) {
            moveCount.textContent = '1';
        }
    }
    
    if (currentWorkspaceSpan) {
        const currentWorkspace = workspaces[activeWorkspace];
        currentWorkspaceSpan.textContent = currentWorkspace ? currentWorkspace.name : 'Default';
    }
    
    // Setup workspace dropdown
    setupGalleryMoveWorkspaceDropdown(modal);
    
    // Show modal
    openModal(modal);
}

// Start cross-fade animation for multi-select move modal
function startGalleryMoveCrossFade(selectedImages) {
    if (galleryMoveCrossFadeInterval) {
        clearInterval(galleryMoveCrossFadeInterval);
    }
    
    if (selectedImages.length <= 1) return;
    
    const backgroundImage = document.getElementById('galleryMoveBackgroundImage');
    if (!backgroundImage) return;
    
    galleryMoveCrossFadeIndex = 0;
    
    galleryMoveCrossFadeInterval = setInterval(() => {
        const currentImage = selectedImages[galleryMoveCrossFadeIndex];
        
        if (currentImage) {
            // Fade out current image
            backgroundImage.classList.add('fade-out');
            
            setTimeout(() => {
                // Update image source
                backgroundImage.src = `/images/${currentImage}`;
                backgroundImage.alt = `Images to move: ${selectedImages.length} selected`;
                
                // Fade in new image
                backgroundImage.classList.remove('fade-out');
                backgroundImage.classList.add('fade-in');
                
                setTimeout(() => {
                    backgroundImage.classList.remove('fade-in');
                }, 500);
            }, 250);
        }
        
        // Move to next image
        galleryMoveCrossFadeIndex = (galleryMoveCrossFadeIndex + 1) % selectedImages.length;
    }, 3000); // Change image every 3 seconds
}

// Stop cross-fade animation
function stopGalleryMoveCrossFade() {
    if (galleryMoveCrossFadeInterval) {
        clearInterval(galleryMoveCrossFadeInterval);
        galleryMoveCrossFadeInterval = null;
    }
}

// Setup workspace dropdown for gallery move modal
function setupGalleryMoveWorkspaceDropdown(modal) {
    const dropdownContainer = modal.querySelector('#galleryMoveWorkspaceDropdown');
    const dropdownBtn = modal.querySelector('#galleryMoveWorkspaceDropdownBtn');
    const dropdownMenu = modal.querySelector('#galleryMoveWorkspaceDropdownMenu');
    const selectedSpan = modal.querySelector('#galleryMoveWorkspaceSelected');
    const confirmBtn = modal.querySelector('#galleryMoveConfirmBtn');
    
    // Check if dropdown is already set up
    if (dropdownContainer.dataset.setup === 'true') {
        return; // Already set up, don't add duplicate event listeners
    }
    
    // Setup dropdown functionality using the main dropdown system
    setupDropdown(
        dropdownContainer, 
        dropdownBtn, 
        dropdownMenu, 
        renderGalleryMoveWorkspaceDropdown, 
        () => selectedSpan.dataset.value || null,
        {
            onSelectOption: (value) => {
                const workspace = workspaces[value];
                if (workspace) {
                    selectedSpan.textContent = workspace.name;
                    selectedSpan.dataset.value = workspace.id;
                    confirmBtn.disabled = false;
                }
            }
        }
    );
    
    // Mark as set up
    dropdownContainer.dataset.setup = 'true';
}

// Render function for gallery move workspace dropdown
function renderGalleryMoveWorkspaceDropdown() {
    const modal = document.getElementById('galleryMoveModal');
    if (!modal) return;
    
    const dropdownMenu = modal.querySelector('#galleryMoveWorkspaceDropdownMenu');
    if (!dropdownMenu) return;
    
    dropdownMenu.innerHTML = '';
    
    Object.values(workspaces).forEach(workspace => {
        if (workspace.id !== activeWorkspace) {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option';
            option.tabIndex = 0;
            option.dataset.value = workspace.id;
            
            const workspaceColor = workspace.color || '#102040';
            
            option.innerHTML = `
                <div class="workspace-option-content">
                    <div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                    <div class="workspace-name">${workspace.name}</div>
                </div>
            `;
            
            option.addEventListener('click', () => {
                const selectedSpan = modal.querySelector('#galleryMoveWorkspaceSelected');
                const confirmBtn = modal.querySelector('#galleryMoveConfirmBtn');
                
                selectedSpan.innerHTML = `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                    <div class="workspace-name">${workspace.name}</div></div>`;
                selectedSpan.dataset.value = workspace.id;
                confirmBtn.disabled = false;
                
                const dropdownBtn = modal.querySelector('#galleryMoveWorkspaceDropdownBtn');
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

// Hide gallery move modal
function hideGalleryMoveModal() {
    const modal = document.getElementById('galleryMoveModal');
    if (modal) {
        closeModal(modal);
    }
    
    // Stop cross-fade animation
    stopGalleryMoveCrossFade();
    
    // Clear selection when modal is closed/cancelled to prevent stuck state
    if (galleryMoveSelectedImages.size > 0) {
        clearSelection();
    }
}

// Execute the actual move operation
async function executeGalleryMove(filename, targetWorkspaceId) {
    try {
        // Show loading toast
        const toastId = showGlassToast('info', 'Moving Image', 'Moving image to selected workspace...', true, false, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
        
        // Move the image using WebSocket
        // Determine move type based on current gallery view
        const isScrapsView = currentGalleryView === 'scraps';
        const isPinnedView = currentGalleryView === 'pinned';
        let moveType = 'files';
        if (isScrapsView) {
            moveType = 'scraps';
        } else if (isPinnedView) {
            moveType = 'pinned';
        }
        const response = await wsClient.moveFilesToWorkspace([filename], targetWorkspaceId, activeWorkspace || 'default', moveType);
        
        if (response.success) {
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Image Moved',
                message: 'Image moved successfully to the selected workspace',
                showProgress: false
            });
            hideGalleryMoveModal();
            
            // Refresh gallery to reflect the change
            if (typeof requestGallery === 'function') {
                requestGallery();
            }
        } else {
            throw new Error(response.message || 'Failed to move image');
        }
        
    } catch (error) {
        console.error('Error moving gallery image:', error);
        showError('Failed to move image: ' + error.message);
        // For single image moves, we don't need to clear selection
    }
}

// Execute multi-select move operation
async function executeGalleryMoveMultiple(targetWorkspaceId) {
    try {
        const selectedImages = Array.from(galleryMoveSelectedImages);
        
        if (selectedImages.length === 0) {
            showError('No images selected for move');
            return;
        }
        
        // Show loading toast
        const toastId = showGlassToast('info', 'Moving Images', `Moving ${selectedImages.length} images to selected workspace...`, true, false, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
        
        // Move the images using WebSocket
        // Determine move type based on current gallery view
        const isScrapsView = currentGalleryView === 'scraps';
        const isPinnedView = currentGalleryView === 'pinned';
        let moveType = 'files';
        if (isScrapsView) {
            moveType = 'scraps';
        } else if (isPinnedView) {
            moveType = 'pinned';
        }
        const response = await wsClient.moveFilesToWorkspace(selectedImages, targetWorkspaceId, activeWorkspace || 'default', moveType);
        
        if (response.success) {
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Images Moved',
                message: `${selectedImages.length} images moved successfully to the selected workspace`,
                showProgress: false
            });
            hideGalleryMoveModal();
            
            // Clear selection in both the modal and the main gallery view
            galleryMoveSelectedImages.clear();
            clearSelection();
            
            // Refresh gallery to reflect the change
            if (typeof requestGallery === 'function') {
                requestGallery();
            }
        } else {
            throw new Error(response.message || 'Failed to move images');
        }
        
    } catch (error) {
        console.error('Error moving gallery images:', error);
        showError('Failed to move images: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    }
}