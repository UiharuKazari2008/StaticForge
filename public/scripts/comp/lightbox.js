
const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');
const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');
const lightboxScrapBtn = document.getElementById('lightboxScrapBtn');
const lightboxPinBtn = document.getElementById('lightboxPinBtn');
const lightboxUpscaleBtn = document.getElementById('lightboxUpscaleBtn');
const lightboxRerollBtn = document.getElementById('lightboxRerollBtn');
const lightboxRerollEditBtn = document.getElementById('lightboxRerollEditBtn');

// Show lightbox
async function showLightbox(image) {
    // Set current lightbox image for navigation
    currentLightboxImage = image;

    if (image.url) {
        lightboxImage.src = image.url;
    } else {
        lightboxImage.src = `/images/${image.filename}`;
    }

    openModal(lightboxModal);

    // Store current image for download
    lightboxImage.dataset.filename = image.filename;
    lightboxImage.dataset.url = image.url;
    lightboxImage.dataset.base = image.base;
    lightboxImage.dataset.upscaled = image.upscaled ? 'true' : '';

    // Reset metadata table first
    resetMetadataTable();

    // Load and display metadata
    const metadata = await loadAndDisplayMetadata(image.filename);

    // Store current image and metadata for dialog
    currentImage = { ...image, metadata };

    // Update lightbox controls with metadata
    updateLightboxControls({ ...image, metadata });

    // Initialize zoom and pan functionality
    initializeLightboxZoom();
}

// Hide lightbox
function hideLightbox() {
    closeModal(lightboxModal);

    // Clear any existing metadata
    const metadataTable = document.querySelector('.lightbox-metadata-section .metadata-table tbody');
    if (metadataTable) {
        metadataTable.innerHTML = '';
    }

    // Hide expanded sections
    const expandedSections = document.querySelectorAll('.metadata-expanded');
    expandedSections.forEach(section => {
        section.style.display = 'none';
    });

    // Hide prompt panel
    const promptPanel = document.getElementById('promptPanel');
    if (promptPanel) {
        promptPanel.classList.remove('show');
        promptPanel.classList.add('hidden');
    }

    // Reset close button position
    if (lightboxCloseBtn) {
        lightboxCloseBtn.classList.remove('prompt-panel-open');
    }

    // Hide dialog if open
    hideMetadataDialog();

    // Reset zoom and pan
    resetLightboxZoom();
}

// Navigate between images in lightbox
function navigateLightbox(direction) {
    // Find current image index by matching the filename
    const currentImageIndex = allImages.findIndex(img => {
        const currentFilename = currentLightboxImage?.filename;
        return img.original === currentFilename || img.upscaled === currentFilename;
    });

    if (currentImageIndex === -1) return;

    // Calculate new index
    let newIndex = currentImageIndex + direction;

    // Handle wrapping
    if (newIndex < 0) {
        newIndex = allImages.length - 1;
    } else if (newIndex >= allImages.length) {
        newIndex = 0;
    }

    // Get the new image from allImages
    const newImageObj = allImages[newIndex];
    if (newImageObj) {
        // Construct the image object the same way as in createGalleryItem
        let filenameToShow = newImageObj.original;
        if (newImageObj.upscaled) {
            filenameToShow = newImageObj.upscaled;
        }

        const imageToShow = {
            filename: filenameToShow,
            base: newImageObj.base,
            upscaled: newImageObj.upscaled
        };

        showLightbox(imageToShow);
    }
}

// Lightbox zoom and pan functionality
let currentLightboxImage = null;
let lightboxZoom = 1;
let lightboxPanX = 0;
let lightboxPanY = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let lastTouchDistance = 0;

function initializeLightboxZoom() {
    const imageContainer = document.querySelector('.lightbox-image-container');
    const image = document.getElementById('lightboxImage');

    if (!imageContainer || !image) return;

    // Reset zoom and pan
    resetLightboxZoom();

    // Mouse wheel zoom
    imageContainer.addEventListener('wheel', handleWheelZoom, { passive: false });

    // Mouse drag pan
    imageContainer.addEventListener('mousedown', handleMouseDown);
    imageContainer.addEventListener('mousemove', handleMouseMove);
    imageContainer.addEventListener('mouseup', handleMouseUp);
    imageContainer.addEventListener('mouseleave', handleMouseUp);

    // Touch zoom and pan
    imageContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    imageContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    imageContainer.addEventListener('touchend', handleTouchEnd);

    // Double click to reset zoom
    imageContainer.addEventListener('dblclick', resetLightboxZoom);
}

function resetLightboxZoom() {
    lightboxZoom = 1;
    lightboxPanX = 0;
    lightboxPanY = 0;
    updateImageTransform();

    const imageContainer = document.querySelector('.lightbox-image-container');
    if (imageContainer) {
        imageContainer.classList.remove('zoomed');
    }
}

function updateImageTransform() {
    const image = document.getElementById('lightboxImage');
    if (image) {
        image.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxZoom})`;
    }
}

function handleWheelZoom(e) {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(1, Math.min(5, lightboxZoom * delta));

    // If zooming out to original size, reset pan to center
    if (newZoom <= 1 && lightboxZoom > 1) {
        lightboxPanX = 0;
        lightboxPanY = 0;
    } else {
        // Zoom towards mouse position only when zooming in or when already zoomed
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomChange = newZoom / lightboxZoom;
        lightboxPanX = mouseX - (mouseX - lightboxPanX) * zoomChange;
        lightboxPanY = mouseY - (mouseY - lightboxPanY) * zoomChange;
    }

    lightboxZoom = newZoom;
    updateImageTransform();

    const imageContainer = document.querySelector('.lightbox-image-container');
    if (imageContainer) {
        imageContainer.classList.toggle('zoomed', lightboxZoom > 1);
    }
}

function handleMouseDown(e) {
        e.preventDefault();
    if (lightboxZoom > 1) {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
}

function handleMouseMove(e) {
    e.preventDefault();
    if (isDragging && lightboxZoom > 1) {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;

        lightboxPanX += deltaX;
        lightboxPanY += deltaY;

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        updateImageTransform();
    }
}

function handleMouseUp() {
    isDragging = false;
}

function handleTouchStart(e) {
    if (e.touches.length === 1) {
        // Single touch - start pan
        isDragging = true;
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        // Two touches - start pinch zoom
        lastTouchDistance = getTouchDistance(e.touches);
    }
}

function handleTouchMove(e) {
    if (e.touches.length === 1 && isDragging && lightboxZoom > 1) {
        // Single touch pan
        const deltaX = e.touches[0].clientX - lastMouseX;
        const deltaY = e.touches[0].clientY - lastMouseY;

        lightboxPanX += deltaX;
        lightboxPanY += deltaY;

        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;

        updateImageTransform();
        e.preventDefault();
    } else if (e.touches.length === 2) {
        // Two touch pinch zoom
        const currentDistance = getTouchDistance(e.touches);
        const delta = currentDistance / lastTouchDistance;

        const newZoom = Math.max(1, Math.min(5, lightboxZoom * delta));

        // If zooming out to original size, reset pan to center
        if (newZoom <= 1 && lightboxZoom > 1) {
            lightboxPanX = 0;
            lightboxPanY = 0;
        } else {
            // Zoom towards center of touches only when zooming in or when already zoomed
            const rect = e.currentTarget.getBoundingClientRect();
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            const zoomChange = newZoom / lightboxZoom;
            lightboxPanX = centerX - (centerX - lightboxPanX) * zoomChange;
            lightboxPanY = centerY - (centerY - lightboxPanY) * zoomChange;
        }

        lightboxZoom = newZoom;
        lastTouchDistance = currentDistance;

        updateImageTransform();

        const imageContainer = document.querySelector('.lightbox-image-container');
        if (imageContainer) {
            imageContainer.classList.toggle('zoomed', lightboxZoom > 1);
        }

        e.preventDefault();
    }
}

function handleTouchEnd(e) {
    if (e.touches.length === 0) {
        isDragging = false;
        lastTouchDistance = 0;
    }
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function updateLightboxControls(image) {
    const deleteBtn = document.getElementById('lightboxDeleteBtn');
    const toggleBaseBtn = document.getElementById('toggleBaseImageBtn');
    
    if (image.isMask) {
        lightboxDownloadBtn.style.display = 'inline-block';
        lightboxRerollBtn.style.display = 'none';
        lightboxRerollEditBtn.style.display = 'none';
        lightboxUpscaleBtn.style.display = 'none';
        deleteBtn.style.display = 'none';

        // Set up download for mask
        lightboxDownloadBtn.onclick = (e) => {
            e.preventDefault();
            downloadImage(image);
        };
        return;
    }

    // Always show download button for regular images
    lightboxDownloadBtn.style.display = '';
    lightboxRerollBtn.style.display = '';
    lightboxRerollEditBtn.style.display = '';
    lightboxDeleteBtn.style.display = '';
    if (image.upscaled) {
        lightboxUpscaleBtn.style.display = 'none';
    } else {
        lightboxUpscaleBtn.style.display = 'inline-block';
    }
    lightboxScrapBtn.style.display = 'inline-block';
    if (currentGalleryView === 'scraps') {
        lightboxScrapBtn.innerHTML = '<i class="nai-undo"></i>';
        lightboxScrapBtn.title = 'Remove from scraps';
    } else {
        lightboxScrapBtn.innerHTML = '<i class="nai-image-tool-sketch"></i>';
        lightboxScrapBtn.title = 'Move to scraps';
    }
    
    // Show pin button for all views
    lightboxPinBtn.style.display = 'inline-block';
    lightboxPinBtn.innerHTML = '<i class="nai-heart-disabled"></i>';
    lightboxPinBtn.title = 'Pin/Unpin image';
    
    // Update pin button appearance based on pin status
    updateLightboxPinButtonAppearance(image.filename);
    if (image.metadata && image.metadata.base_image === true && image.metadata.original_filename) {
        toggleBaseBtn.style.display = 'inline-block';
        toggleBaseBtn.setAttribute('data-state', 'variation');
        toggleBaseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> <span>Show Base</span>';
    } else {
        toggleBaseBtn.style.display = 'none';
    }
    
    const imageObj = {
        filename: image.filename,
        base: image.base,
        original: image.original || image.filename,
        upscaled: image.upscaled,
        metadata: image.metadata
    };
    lightboxDownloadBtn.onclick = (e) => {
        e.preventDefault();
        downloadImage(imageObj);
    };
    lightboxRerollBtn.onclick = () => rerollImage(imageObj);
    lightboxRerollEditBtn.onclick = () => rerollImageWithEdit(imageObj);
    lightboxUpscaleBtn.onclick = (e) => upscaleImage(imageObj, e);
    lightboxScrapBtn.onclick = () => {
            if (currentGalleryView === 'scraps') {
        removeFromScraps(imageObj);
    } else {
        moveToScraps(imageObj);
    }
    };
    lightboxPinBtn.onclick = () => togglePinImage(imageObj);
    deleteBtn.onclick = (e) => deleteImage(imageObj, e);
    if (toggleBaseBtn.style.display !== 'none') {
        toggleBaseBtn.onclick = () => toggleBaseImage(imageObj);
    }
}

// Update lightbox pin button appearance based on pin status
async function updateLightboxPinButtonAppearance(filename) {
    try {
        const isPinned = await checkIfImageIsPinned(filename);
        if (isPinned) {
            lightboxPinBtn.innerHTML = '<i class="nai-heart-enabled"></i>';
            lightboxPinBtn.title = 'Unpin image';
        } else {
            lightboxPinBtn.innerHTML = '<i class="nai-heart-disabled"></i>';
            lightboxPinBtn.title = 'Pin image';
        }
    } catch (error) {
        console.error('Error updating lightbox pin button appearance:', error);
    }
}

// Make function globally available
window.updateLightboxPinButtonAppearance = updateLightboxPinButtonAppearance;

async function toggleBaseImage(imageObj) {
    const toggleBaseBtn = document.getElementById('toggleBaseImageBtn');
    const lightboxImage = document.getElementById('lightboxImage');
    const currentState = toggleBaseBtn.getAttribute('data-state');

    if (currentState === 'variation') {
        // Switch to base image
        try {
            const baseImageUrl = `/images/${imageObj.metadata.original_filename}`;
            lightboxImage.src = baseImageUrl;
            toggleBaseBtn.setAttribute('data-state', 'base');
            toggleBaseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> <span>Show Variation</span>';
        } catch (error) {
            console.error('Error loading base image:', error);
            showError('Failed to load base image');
        }
    } else {
        // Switch back to variation image
        const variationImageUrl = `/images/${imageObj.filename}`;
        lightboxImage.src = variationImageUrl;
        toggleBaseBtn.setAttribute('data-state', 'variation');
        toggleBaseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> <span>Show Base</span>';
    }
}


// Setup prompt panel
function setupPromptPanel(metadata) {
    const promptBtn = document.getElementById('promptBtn');
    const promptPanel = document.getElementById('promptPanel');
    const allPromptsContent = document.getElementById('allPromptsContent');

    // Clear previous content
    if (allPromptsContent) allPromptsContent.innerHTML = '';

    // Setup prompt button
    if (promptBtn && promptPanel) {
        promptBtn.style.display = 'inline-block';

        promptBtn.onclick = () => {
            // Check if panel is currently shown
            const isPanelShown = promptPanel.classList.contains('show');

            if (isPanelShown) {
                // Hide panel
                promptPanel.classList.remove('show');
                setTimeout(() => {
                    promptPanel.classList.add('hidden');
                }, 300);

                // Move close button back to original position
                if (lightboxCloseBtn) {
                    lightboxCloseBtn.classList.remove('prompt-panel-open');
                }
            } else {
                // Populate panel content
                if (allPromptsContent) {
                    allPromptsContent.innerHTML = '';

                    // Add base prompt if exists
                    if (metadata.prompt) {
                        const basePromptItem = createCharacterPromptItem('Base Prompt', metadata.prompt, metadata.uc);
                        allPromptsContent.appendChild(basePromptItem);
                    }

                    // Add character prompts if exist
                    if (metadata.characterPrompts && metadata.characterPrompts.length > 0) {
                        metadata.characterPrompts.forEach((charPrompt, index) => {
                            const charName = charPrompt.chara_name || `Character ${index + 1}`;
                            const charPromptItem = createCharacterPromptItem(charName, charPrompt.prompt || 'No prompt available', charPrompt.uc, charPrompt);
                            allPromptsContent.appendChild(charPromptItem);
                        });
                    }

                    // Show message if no prompts at all
                    if (!metadata.prompt && (!metadata.characterPrompts || metadata.characterPrompts.length === 0)) {
                        const noPromptsMsg = document.createElement('div');
                        noPromptsMsg.className = 'character-prompt-item-panel';
                        noPromptsMsg.innerHTML = '<div class="character-prompt-text">No prompts available</div>';
                        allPromptsContent.appendChild(noPromptsMsg);
                    }
                }

                // Show panel
                promptPanel.classList.remove('hidden');
                setTimeout(() => {
                    promptPanel.classList.add('show');
                }, 10);

                // Move close button to accommodate panel
                if (lightboxCloseBtn) {
                    lightboxCloseBtn.classList.add('prompt-panel-open');
                }
            }
        };
    } else if (promptBtn) {
        promptBtn.style.display = 'none';
    }
}

// Helper function to create prompt items with copy functionality
function createPromptItem(title, content) {
    const promptItem = document.createElement('div');
    promptItem.className = 'character-prompt-item-panel';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'prompt-header';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'character-name';
    titleDiv.textContent = title;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'prompt-copy-btn';
    copyBtn.innerHTML = '<i class="nai-clipboard"></i>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = () => copyToClipboard(content, title);

    headerDiv.appendChild(titleDiv);
    headerDiv.appendChild(copyBtn);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'character-prompt-text';
    contentDiv.textContent = content;

    promptItem.appendChild(headerDiv);
    promptItem.appendChild(contentDiv);

    return promptItem;
}

// Helper function to create character prompt items with UC
function createCharacterPromptItem(title, content, uc, charPrompt = null) {
    const promptItem = document.createElement('div');
    promptItem.className = 'character-prompt-item-panel';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'prompt-header';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'character-name';
    titleDiv.textContent = title;

    // Add badges for character prompts
    if (charPrompt) {
        const badgesDiv = document.createElement('div');
        badgesDiv.className = 'prompt-badges';

        // Add coordinate badge if coordinates exist
        if (charPrompt.center && charPrompt.center.x !== undefined && charPrompt.center.y !== undefined) {
            const coordBadge = document.createElement('span');
            coordBadge.className = 'prompt-badge coordinate-badge';
            coordBadge.textContent = getCellLabelFromCoords(charPrompt.center.x, charPrompt.center.y);
            badgesDiv.appendChild(coordBadge);
        }

        // Add disabled badge if character is disabled
        if (charPrompt.enabled === false) {
            const disabledBadge = document.createElement('span');
            disabledBadge.className = 'prompt-badge disabled-badge';
            disabledBadge.textContent = 'Not Included';
            badgesDiv.appendChild(disabledBadge);
        }

        titleDiv.appendChild(badgesDiv);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'prompt-copy-btn';
    copyBtn.innerHTML = '<i class="nai-clipboard"></i>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = () => copyToClipboard(content, title);

    headerDiv.appendChild(titleDiv);
    headerDiv.appendChild(copyBtn);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'character-prompt-text';
    contentDiv.textContent = content;

    promptItem.appendChild(headerDiv);
    promptItem.appendChild(contentDiv);

    // Add UC if it exists
    if (uc) {
        const divider = document.createElement('div');
        divider.className = 'prompt-divider';
        promptItem.appendChild(divider);

        const ucHeaderDiv = document.createElement('div');
        ucHeaderDiv.className = 'prompt-header';

        const ucTitleDiv = document.createElement('div');
        ucTitleDiv.className = 'character-name';
        ucTitleDiv.textContent = 'Undesired Content';

        const ucCopyBtn = document.createElement('button');
        ucCopyBtn.className = 'prompt-copy-btn';
        ucCopyBtn.innerHTML = '<i class="nai-clipboard"></i>';
        ucCopyBtn.title = 'Copy to clipboard';
        ucCopyBtn.onclick = () => copyToClipboard(uc, `${title} - Undesired Content`);

        ucHeaderDiv.appendChild(ucTitleDiv);
        ucHeaderDiv.appendChild(ucCopyBtn);

        const ucContentDiv = document.createElement('div');
        ucContentDiv.className = 'character-prompt-text';
        ucContentDiv.textContent = uc;

        promptItem.appendChild(ucHeaderDiv);
        promptItem.appendChild(ucContentDiv);
    }

    return promptItem;
}

// Function to copy text to clipboard and show toast
async function copyToClipboard(text, title) {
    try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            showGlassToast('success', null, `Copied ${title} to clipboard`, false, 3000, '<i class="fas fa-clipboard"></i>');
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (successful) {
                showGlassToast('success', null, `Copied ${title} to clipboard`, false, 3000, '<i class="fas fa-clipboard"></i>');
            } else {
                throw new Error('execCommand copy failed');
            }
        }
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showGlassToast('error', null, 'Failed to copy to clipboard', false);
    }
}

// Helper: Format resolution name for display
function formatResolution(resolution) {
    if (!resolution) return '';

    // Handle custom resolution format: custom_1024x768
    if (resolution.startsWith('custom_')) {
        const dimensions = resolution.replace('custom_', '');
        const [width, height] = dimensions.split('x').map(Number);
        if (width && height) {
            return `Custom ${width}×${height}`;
        }
    }

    // Try to find the resolution in our global array first
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

// Load and display metadata
async function loadAndDisplayMetadata(filename) {
    try {
        const metadata = await getImageMetadata(filename);

        if (metadata && Object.keys(metadata).length > 0) {
            // Populate metadata table
            populateMetadataTable(metadata);

            // Set up expandable sections
            setupPromptPanel(metadata);

            return metadata;
        }
        return null;
    } catch (error) {
        console.error('Error loading metadata:', error);
        return null;
    }
}

// Populate metadata table
function populateMetadataTable(metadata) {
    // Type and Name
    const typeElement = document.getElementById('metadataType');
    const nameElement = document.getElementById('metadataName');

    if (typeElement && nameElement) {
        if (metadata.request_type) {
            typeElement.textContent = formatRequestType(metadata.request_type);

            // Show/hide name field based on preset_name availability
            const nameCell = nameElement.closest('.metadata-cell');
            if (metadata.preset_name) {
                nameElement.textContent = metadata.preset_name;
                if (nameCell) nameCell.style.display = 'flex';
            } else {
                if (nameCell) nameCell.style.display = 'none';
            }
        } else {
            typeElement.textContent = '-';
            const nameCell = nameElement.closest('.metadata-cell');
            if (nameCell) nameCell.style.display = 'none';
        }
    }

    // Model
    const modelElement = document.getElementById('metadataModel');
    if (modelElement) {
        modelElement.textContent = metadata.model_display_name || metadata.model || '-';
    }

    // Resolution
    const resolutionElement = document.getElementById('metadataResolution');
    if (resolutionElement) {
        if (metadata.resolution) {
            let resolutionText = formatResolution(metadata.resolution);
            if (metadata.upscaled) {
                resolutionElement.innerHTML = `${resolutionText} <span class="badge upscaled-badge">Upscaled</span>`;
            } else {
                resolutionElement.textContent = resolutionText;
            }
        } else if (metadata.width && metadata.height) {
            let dimensionText = `${metadata.width} × ${metadata.height}`;
            if (metadata.upscaled) {
                resolutionElement.innerHTML = `${dimensionText} <span class="badge upscaled-badge">Upscaled</span>`;
            } else {
                resolutionElement.textContent = dimensionText;
            }
        } else {
            resolutionElement.textContent = '-';
        }
    }

    // Steps
    const stepsElement = document.getElementById('metadataSteps');
    if (stepsElement) {
        const stepsText = metadata.steps || '-';
        if (metadata.skip_cfg_above_sigma !== null && metadata.skip_cfg_above_sigma !== undefined) {
            stepsElement.innerHTML = `${stepsText} <i class="fas fa-splotch variety-icon" title="Variety+ enabled"></i>`;
        } else {
            stepsElement.textContent = stepsText;
        }
    }

    // Seeds - Handle display logic
    const seed1Element = document.getElementById('metadataSeed1');
    const seed2Element = document.getElementById('metadataSeed2');

    if (seed1Element && seed2Element) {
        // Find the label elements more safely
        const seed1Cell = seed1Element.closest('.metadata-cell');
        const seed2Cell = seed2Element.closest('.metadata-cell');
        const seed1Label = seed1Cell ? seed1Cell.querySelector('.metadata-label') : null;
        const seed2Label = seed2Cell ? seed2Cell.querySelector('.metadata-label') : null;

        if (seed1Label && seed2Label) {
            // Single seed - hide seed 2 and rename seed 1
            seed1Label.textContent = 'Seed';
            seed1Element.textContent = metadata.layer1Seed || metadata.seed || '-';
            seed1Cell.style.display = 'flex';
            seed2Cell.style.display = 'none';
            
        }
    }

    // Guidance
    const guidanceElement = document.getElementById('metadataGuidance');
    if (guidanceElement) {
        guidanceElement.textContent = metadata.scale || '-';
    }

    // Rescale
    const rescaleElement = document.getElementById('metadataRescale');
    if (rescaleElement) {
        rescaleElement.textContent = metadata.cfg_rescale || '-';
    }

    // Sampler
    const samplerElement = document.getElementById('metadataSampler');
    if (samplerElement) {
        const samplerObj = getSamplerMeta(metadata.sampler);
        samplerElement.textContent = samplerObj ? samplerObj.display : (metadata.sampler || '-');
    }

    // Noise Schedule
    const noiseScheduleElement = document.getElementById('metadataNoiseSchedule');
    if (noiseScheduleElement) {
        const noiseObj = getNoiseMeta(metadata.noise_schedule);
        noiseScheduleElement.textContent = noiseObj ? noiseObj.display : (metadata.noise_schedule || '-');
    }
}

// Helper: Format request type for display
function formatRequestType(requestType) {
    const typeMappings = {
        'custom': 'Manual Generation',
        'preset': 'Image Preset'
    };

    return typeMappings[requestType] || requestType;
}

document.addEventListener('DOMContentLoaded', () => {
    // Lightbox events
    if (lightboxCloseBtn) {
        lightboxCloseBtn.addEventListener('click', hideLightbox);
    }
});