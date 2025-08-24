
const imageBiasDropdown = document.getElementById('imageBiasDropdown');
const imageBiasDropdownBtn = document.getElementById('imageBiasDropdownBtn');
const imageBiasDropdownMenu = document.getElementById('imageBiasDropdownMenu');
const imageBiasSelected = document.getElementById('imageBiasSelected');
const imageBiasHidden = document.getElementById('imageBias');
const imageBiasGroup = document.getElementById('imageBiasGroup');

let uploadedImageData = null;
let originalImageData = null;

// Image Bias Adjustment Modal Functions
let imageBiasAdjustmentData = {
    originalImage: null,
    targetDimensions: null,
    currentBias: { x: 0, y: 0, scale: 1.0, rotate: 0 },
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    originalTransform: { x: 0, y: 0 },
    previewMode: 'css' // Default to CSS view
};

// Render image bias dropdown
async function renderImageBiasDropdown(selectedVal) {
    if (!window.uploadedImageData || window.uploadedImageData.isPlaceholder) {
        if (imageBiasGroup) {
            imageBiasGroup.style.display = 'none';
        }
        return;
    }

    if (!imageBiasDropdownBtn.hasAttribute('data-setup')) {
        // Add event listeners
        imageBiasDropdownBtn.addEventListener('click', (e) => {
            
            if (imageBiasDropdownMenu.style.display === 'none') {
                imageBiasDropdownMenu.style.display = '';
            } else {
                closeImageBiasDropdown();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!imageBiasDropdownBtn.contains(e.target) && !imageBiasDropdownMenu.contains(e.target)) {
                closeImageBiasDropdown();
            }
        });

        // Mark as set up
        imageBiasDropdownBtn.setAttribute('data-setup', 'true');
    }

    // Check if we have dynamic bias (object) instead of legacy bias (number)
    const hasDynamicBias = window.uploadedImageData && window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object';
    
    // Get orientation data using the centralized function
    const { isPortrait: isPortraitImage } = getImageBiasOrientation();

    // Check if image bias should be visible
    const shouldShow = shouldShowImageBias();

    if (shouldShow) {
        imageBiasGroup.style.display = 'flex';
        
        // If we have dynamic bias, update the display
        if (hasDynamicBias) {
            await updateImageBiasDisplay('custom');
        }
    } else {
        // Aspect ratios are the same or very close - hide the dropdown but keep the bias section visible
        imageBiasGroup.style.display = '';
        
        // Hide the dropdown menu since aspect ratios are similar
        if (imageBiasDropdownMenu) {
            imageBiasDropdownMenu.style.display = 'none';
        }
        
        // If we have dynamic bias, update the display to show custom bias
        if (hasDynamicBias) {
            await updateImageBiasDisplay('custom');
        } else {
            // For regular bias, show center bias by default
            await updateImageBiasDisplay('2');
        }
        
        return;
    }
    imageBiasDropdownMenu.innerHTML = '';

    // Create bias options based on image orientation (exclude Custom from dropdown)
    const biasOptions = [
        { value: '0', display: isPortraitImage ? 'Top' : 'Left' },
        { value: '1', display: isPortraitImage ? 'Mid-Top' : 'Mid-Left' },
        { value: '2', display: 'Center' },
        { value: '3', display: isPortraitImage ? 'Mid-Bottom' : 'Mid-Right' },
        { value: '4', display: isPortraitImage ? 'Bottom' : 'Right' }
    ];

    biasOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        optionElement.dataset.value = option.value;

        // Create grid based on orientation
        let gridHTML = '';
        if (isPortraitImage) {
            // Portrait: 3 columns, 5 rows (vertical layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        } else {
            // Landscape: 5 columns, 3 rows (horizontal layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        }

        optionElement.innerHTML = `
            <div class="mask-bias-option-content">
                <div class="mask-bias-grid" data-bias="${option.value}" data-orientation="${isPortraitImage ? 'portrait' : 'landscape'}">
                    ${gridHTML}
                </div>
                <span class="mask-bias-label">${option.display}</span>
            </div>
        `;

        optionElement.addEventListener('click', (e) => {
            
            selectImageBias(option.value);
        });

        imageBiasDropdownMenu.appendChild(optionElement);
    });

    // Update button display
    if (imageBiasDropdownBtn) {
        const buttonGrid = imageBiasDropdownBtn.querySelector('.mask-bias-grid');
        if (buttonGrid) {
            // Get current orientation data using centralized function
            const { isPortrait: currentIsPortraitImage } = getImageBiasOrientation();
            
            if (hasDynamicBias) {
                // Show custom bias with diagonal grid
                buttonGrid.setAttribute('data-bias', 'custom');
                buttonGrid.setAttribute('data-orientation', currentIsPortraitImage ? 'portrait' : 'landscape');
                buttonGrid.classList.add('custom-bias');
            } else {
                // Show normal bias
                buttonGrid.setAttribute('data-bias', selectedVal);
                buttonGrid.setAttribute('data-orientation', currentIsPortraitImage ? 'portrait' : 'landscape');
                buttonGrid.classList.remove('custom-bias');
            }
        }
    }

    // Call updateImageBiasDisplay with appropriate value
    if (hasDynamicBias) {
        await updateImageBiasDisplay('custom');
    } else {
        await updateImageBiasDisplay(selectedVal);
    }
}

// Select image bias
function selectImageBias(value) {
    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;

    if (hasExistingMask) {
        // Store the pending bias change and show alert modal
        window.pendingImageBiasChange = {
            value,
            callback: () => {
                // This will be called after the mask is handled
            }
        };
        showImageBiasMaskAlertModal();
        return;
    }

    // No mask exists, proceed with bias change
    applyImageBiasChange(value);
}

// Update image bias display
function updateImageBiasDisplay(value) {
    const buttonGrid = imageBiasDropdownBtn.querySelector('.mask-bias-grid');
    if (!buttonGrid) return;

    // Get orientation data using centralized function
    const { isPortrait: isPortraitImage } = getImageBiasOrientation();
    
    const hasDynamicBias = window.uploadedImageData && window.uploadedImageData.image_bias;

    if (hasDynamicBias) {
        // Show "Custom" for dynamic bias
        if (imageBiasSelected) {
            imageBiasSelected.textContent = 'Custom';
        }
        buttonGrid.setAttribute('data-bias', 'custom');
        buttonGrid.classList.add('custom-bias');
    } else {
        // Show normal bias options
        const biasOptions = [
            { value: '0', display: isPortraitImage ? 'Top' : 'Left' },
            { value: '1', display: isPortraitImage ? 'Mid-Top' : 'Mid-Left' },
            { value: '2', display: 'Center' },
            { value: '3', display: isPortraitImage ? 'Mid-Bottom' : 'Mid-Right' },
            { value: '4', display: isPortraitImage ? 'Bottom' : 'Right' }
        ];

        // Fix: Use string comparison to handle '0' value correctly
        if (value !== undefined && value !== null) {
            const selectedOption = biasOptions.find(opt => opt.value === value.toString());
            if (imageBiasSelected && selectedOption) {
                imageBiasSelected.textContent = selectedOption.display;
            }
            buttonGrid.setAttribute('data-bias', value);
        } else {
            // Default to center bias if no value provided
            buttonGrid.setAttribute('data-bias', '2');
            if (imageBiasSelected) {
                imageBiasSelected.textContent = 'Center';
            }
        }
        buttonGrid.classList.remove('custom-bias');
    }

    handleImageBiasChange();

    closeImageBiasDropdown();
}

// Close image bias dropdown
function closeImageBiasDropdown() {
    imageBiasDropdownMenu.style.display = 'none';
}

// Hide image bias dropdown
function hideImageBiasDropdown() {
    imageBiasGroup.style.display = 'none';
}

// Handle image bias changes
async function handleImageBiasChange() {
    if (!window.uploadedImageData || !window.uploadedImageData.isBiasMode) return;

    const newBias = parseInt(imageBiasHidden.value);
    // Don't fall back - if it's NaN, don't update
    if (isNaN(newBias)) return;

    // Update stored data
    window.uploadedImageData.bias = newBias;

    // Update the image position
    await cropImageToResolution();
}

// Internal function to crop image to resolution (existing function, keeping for compatibility)
function cropImageToResolutionInternal(dataUrl, bias) {
    const biasFractions = [0, 0.25, 0.5, 0.75, 1];
    return new Promise((resolve) => {
        if (!dataUrl) {
            console.warn('No dataUrl provided to cropImageToResolutionInternal');
            resolve(dataUrl);
            return;
        }

        const img = new Image();
        img.onload = function() {
            // Validate image dimensions
            if (img.width === 0 || img.height === 0) {
                console.warn('Image has invalid dimensions:', img.width, 'x', img.height);
                resolve(dataUrl);
                return;
            }
            const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
            const resolutionDims = getDimensionsFromResolution(currentResolution);

            if (!resolutionDims) {
                resolve(dataUrl);
                return;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = resolutionDims.width;
            canvas.height = resolutionDims.height;

            // Calculate crop dimensions
            const imageAR = img.width / img.height;
            const targetAR = resolutionDims.width / resolutionDims.height;

            let cropWidth, cropHeight, cropX, cropY;

            if (imageAR > targetAR) {
                // Image is wider than target, crop width
                cropHeight = img.height;
                cropWidth = img.height * targetAR;
                const biasFrac = biasFractions[bias] !== undefined ? biasFractions[bias] : 0.5;
                cropX = (img.width - cropWidth) * biasFrac;
                cropY = 0;
            } else {
                // Image is taller than target, crop height
                cropWidth = img.width;
                cropHeight = img.width / targetAR;
                cropX = 0;
                const biasFrac = biasFractions[bias] !== undefined ? biasFractions[bias] : 0.5;
                cropY = (img.height - cropHeight) * biasFrac;
            }

            // Draw cropped image
            ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, resolutionDims.width, resolutionDims.height);

            // Convert to blob instead of data URL to avoid memory issues
            canvas.toBlob((blob) => {
                // Create blob URL and store it in window for cleanup
                const blobUrl = URL.createObjectURL(blob);

                // Store the blob URL for cleanup
                if (!window.croppedImageBlobUrls) {
                    window.croppedImageBlobUrls = [];
                }
                window.croppedImageBlobUrls.push(blobUrl);

                resolve(blobUrl);
            }, 'image/png');
        };
        img.src = dataUrl;
    });
}

// Clean up blob URLs to prevent memory leaks
function cleanupBlobUrls() {
    if (window.croppedImageBlobUrls) {
        window.croppedImageBlobUrls.forEach(blobUrl => {
            URL.revokeObjectURL(blobUrl);
        });
        window.croppedImageBlobUrls = [];
    }
}

// Get image and target resolution data and determine orientation
function getImageBiasOrientation() {
    const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
    let targetAR = 1;
    
    if (currentResolution === 'custom' && manualWidth && manualHeight) {
        const width = parseInt(manualWidth.value);
        const height = parseInt(manualHeight.value);
        targetAR = width / height;
    } else {
        const resolutionDims = getDimensionsFromResolution(currentResolution);
        if (resolutionDims) {
            targetAR = resolutionDims.width / resolutionDims.height;
        }
    }
    
    let imageAR = 1;
    if (window.uploadedImageData && window.uploadedImageData.width && window.uploadedImageData.height) {
        imageAR = window.uploadedImageData.width / window.uploadedImageData.height;
    } else {
        // Image dimensions not yet loaded - this can happen during resolution changes
        // Use a safe default that won't cause errors
        imageAR = 1.0; // Default to square
    }
    
    // Determine orientation based on actual image vs target aspect ratios
    const isPortrait = imageAR < targetAR;
    const orientation = isPortrait ? 'portrait' : 'landscape';
    
    return { isPortrait, imageAR, targetAR, orientation };
}

// Check if image bias should be visible based on current image and resolution
function shouldShowImageBias() {
    if (!window.uploadedImageData || window.uploadedImageData.isPlaceholder) {
        return false;
    }
    
    const { imageAR, targetAR } = getImageBiasOrientation();
    
    // Show image bias group if aspect ratios are different enough OR if both are square (bias still useful for cropping)
    const aspectRatioDifference = Math.abs(imageAR - targetAR);
    const isImageSquare = Math.abs(imageAR - 1.0) < 0.05;
    const isTargetSquare = Math.abs(targetAR - 1.0) < 0.05;
    
    return aspectRatioDifference > 0.05 || (isImageSquare && isTargetSquare);
}

// Refresh image bias state after resolution changes
async function refreshImageBiasState() {
    if (!window.uploadedImageData) return;
    
    // Check if we have dynamic bias
    const hasDynamicBias = window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object';
    
    if (hasDynamicBias) {
        // Always show custom bias button, regardless of aspect ratio
        if (imageBiasGroup) {
            imageBiasGroup.style.display = 'flex';
        }
        
        // Update the display to show custom bias
        await updateImageBiasDisplay('custom');
        
        // Hide the dropdown menu if aspect ratios are the same
        if (!shouldShowImageBias() && imageBiasDropdownMenu) {
            imageBiasDropdownMenu.style.display = 'none';
        }
        
        // If we have custom bias, we need to ensure the image is cropped to apply the bias
        // This is especially important after resolution changes
        if (typeof cropImageToResolution === 'function' && isCroppingNeeded()) {
            console.log('Custom bias detected and cropping needed, ensuring image is cropped to apply bias adjustments');
            await cropImageToResolution();
        }
    } else {
        // Re-render the dropdown to check visibility (no specific value needed)
        await renderImageBiasDropdown();
    }
}

// Debounced version of cropImageToResolution to prevent excessive calls during rapid changes
let cropImageTimeout = null;
function debouncedCropImageToResolution() {
    if (cropImageTimeout) {
        clearTimeout(cropImageTimeout);
    }
    cropImageTimeout = setTimeout(() => {
        cropImageToResolution();
    }, 100); // 100ms delay
}

// Check if cropping is needed based on current state
function isCroppingNeeded() {
    if (!window.uploadedImageData) return false;
    
    // Check if we have custom bias that needs to be applied
    const hasCustomBias = window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object';
    if (hasCustomBias) {
        return true; // Always crop when custom bias is present
    }
    
    // Check if dimensions match target resolution
    if (window.uploadedImageData.width && window.uploadedImageData.height) {
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        let targetWidth, targetHeight;
        
        if (currentResolution === 'custom' && manualWidth && manualHeight) {
            targetWidth = parseInt(manualWidth.value);
            targetHeight = parseInt(manualHeight.value);
        } else {
            const resolutionDims = getDimensionsFromResolution(currentResolution);
            if (resolutionDims) {
                targetWidth = resolutionDims.width;
                targetHeight = resolutionDims.height;
            }
        }
        
        // If dimensions don't match, cropping is needed
        if (targetWidth && targetHeight && 
            (window.uploadedImageData.width !== targetWidth || 
             window.uploadedImageData.height !== targetHeight)) {
            return true;
        }
    }
    
    return false; // No cropping needed
}

// Update image bias orientation based on current image and resolution
function updateImageBiasOrientation() {
    if (!imageBiasDropdownBtn || !window.uploadedImageData) return;
    
    const buttonGrid = imageBiasDropdownBtn.querySelector('.mask-bias-grid');
    if (!buttonGrid) return;
    
    // Only update orientation if we have valid image dimensions
    if (!window.uploadedImageData.width || !window.uploadedImageData.height) {
        // Image dimensions not yet loaded, skip orientation update
        return;
    }
    
    const { orientation } = getImageBiasOrientation();
    
    // Update the button grid orientation
    buttonGrid.setAttribute('data-orientation', orientation);
    
    // Also update any preset dropdown if it's open
    const presetMenu = document.getElementById('imageBiasPresetMenu');
    if (presetMenu && presetMenu.style.display === 'block') {
        renderImageBiasPresetDropdown();
    }
    
    // Also update the main image bias dropdown if it's open
    if (imageBiasDropdownMenu && imageBiasDropdownMenu.style.display !== 'none') {
        // Re-render to ensure proper state
        renderImageBiasDropdown();
    }
}

// Show image bias adjustment modal
async function showImageBiasAdjustmentModal() {
    if (!window.uploadedImageData) {
        showError('No base image available for adjustment');
        return;
    }

    const modal = document.getElementById('imageBiasAdjustmentModal');
    if (!modal) return;

    // Get target dimensions
    const resolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
    const targetDims = getDimensionsFromResolution(resolution);
    if (!targetDims) {
        showError('Invalid resolution for bias adjustment');
        return;
    }

    // Get original image data
    let imageDataUrl = window.uploadedImageData.originalDataUrl;
    if (!imageDataUrl) {
        // Fetch the image based on the image source
        const imageSource = window.uploadedImageData.image_source;
        if (imageSource.startsWith('data:')) {
            imageDataUrl = imageSource;
        } else {
            let imageUrl = null;
            if (imageSource.startsWith('file:')) {
                imageUrl = `/images/${imageSource.replace('file:', '')}`;
            } else if (imageSource.startsWith('cache:')) {
                imageUrl = `/cache/preview/${imageSource.replace('cache:', '')}.webp`;
            }
            if (imageUrl) {
                const response = await fetch(imageUrl);
                const blob = await response.blob();
                imageDataUrl = URL.createObjectURL(blob);
            }
        }
    }

    if (!imageDataUrl) {
        showError('Could not load image for adjustment');
        return;
    }

    // Load original image to get dimensions
    const originalImage = new Image();
    originalImage.onload = function() {
        imageBiasAdjustmentData.originalImage = originalImage;
        imageBiasAdjustmentData.targetDimensions = targetDims;

        // Initialize bias values from current bias setting
        // Check if we have existing bias data from the uploaded image data
        if (window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object') {
            // Use existing bias values from uploaded image data
            imageBiasAdjustmentData.currentBias = { ...window.uploadedImageData.image_bias };
        } else if (imageBiasAdjustmentData.currentBias && typeof imageBiasAdjustmentData.currentBias === 'object' &&
                   (imageBiasAdjustmentData.currentBias.x !== 0 || imageBiasAdjustmentData.currentBias.y !== 0 ||
                    imageBiasAdjustmentData.currentBias.scale !== 1.0 || imageBiasAdjustmentData.currentBias.rotate !== 0)) {
            // Use existing bias values from previous adjustment (only if they're not default values)
            // currentBias is already set from the uploaded image data
        } else {
            // Fall back to legacy bias system or default values
            const currentBias = window.uploadedImageData.bias || 2;
            const biasFractions = [0, 0.25, 0.5, 0.75, 1];
            const biasFrac = biasFractions[currentBias] || 0.5;

            // Calculate initial position based on current bias
            // For the new system, we'll start with centered position and let user adjust
            imageBiasAdjustmentData.currentBias = {
                x: 0,
                y: 0,
                scale: 1.0,
                rotate: 0
            };
        }

        // Show modal first
        openModal(modal);

        // Update UI after modal is visible (so we can get proper container dimensions)
        setTimeout(() => {
            updateBiasAdjustmentUI();
            updateBiasAdjustmentImage();
            imageBiasAdjustmentData.previewMode = 'css';
            
            const toggleBtn = document.getElementById('previewToggleBtn');
            if (toggleBtn) {
                toggleBtn.setAttribute('data-state', 'on');
            }
        }, 100);
    };
    originalImage.src = imageDataUrl;
}

// Update bias adjustment UI controls
function updateBiasAdjustmentUI() {
    const { x, y, scale, rotate } = imageBiasAdjustmentData.currentBias;

    const biasX = document.getElementById('biasX');
    const biasY = document.getElementById('biasY');
    const biasScale = document.getElementById('biasScale');
    const biasRotate = document.getElementById('biasRotate');

    if (biasX) biasX.value = x;
    if (biasY) biasY.value = y;
    if (biasScale) biasScale.value = scale;
    if (biasRotate) biasRotate.value = rotate;
}

// Update bias adjustment image display
function updateBiasAdjustmentImage() {
    const image = document.getElementById('biasAdjustmentImage');
    const wrapper = document.getElementById('biasAdjustmentImageWrapper');
    const targetOverlay = document.getElementById('targetAreaOverlay');
    
    if (!image || !wrapper || !targetOverlay) {
        console.warn('Required DOM elements not found for bias adjustment image');
        return;
    }
    
    const targetBorder = targetOverlay.querySelector('.target-area-border');
    if (!targetBorder) {
        console.warn('Target area border not found');
        return;
    }

    if (!imageBiasAdjustmentData.originalImage || !imageBiasAdjustmentData.targetDimensions) {
        console.warn('Missing image data for bias adjustment');
        return;
    }

    const { originalImage, targetDimensions, currentBias } = imageBiasAdjustmentData;

    // Set image source
    image.src = originalImage.src;

    // Calculate display dimensions - use the actual container size with padding accounted for
    const container = document.getElementById('imagePreviewContainer');
    if (!container) {
        console.warn('Image preview container not found');
        return;
    }
    
    const containerRect = container.getBoundingClientRect();
    const padding = 32; // 2em = 32px (assuming 1em = 16px)
    const containerWidth = containerRect.width - (padding * 2);
    const containerHeight = containerRect.height - (padding * 2);

    // Calculate target area size in display units
    const targetAR = targetDimensions.width / targetDimensions.height;
    let targetDisplayWidth, targetDisplayHeight;

    if (targetAR > containerWidth / containerHeight) {
        targetDisplayWidth = containerWidth;
        targetDisplayHeight = containerWidth / targetAR;
    } else {
        targetDisplayHeight = containerHeight;
        targetDisplayWidth = containerHeight * targetAR;
    }

    // Set target area border size
    targetBorder.style.width = `${targetDisplayWidth}px`;
    targetBorder.style.height = `${targetDisplayHeight}px`;

    // Calculate scale factor to make image fill target area at scale 1.0
    const imageAR = originalImage.width / originalImage.height;
    let imageDisplayWidth, imageDisplayHeight;

    if (imageAR > targetAR) {
        // Image is wider than target, scale to match target height
        imageDisplayHeight = targetDisplayHeight;
        imageDisplayWidth = targetDisplayHeight * imageAR;
    } else {
        // Image is taller than target, scale to match target width
        imageDisplayWidth = targetDisplayWidth;
        imageDisplayHeight = targetDisplayWidth / imageAR;
    }

    // Set image size to fill target area
    image.style.width = `${imageDisplayWidth}px`;
    image.style.height = `${imageDisplayHeight}px`;

    // Calculate scale factor between target dimensions and display dimensions
    const scaleX = targetDisplayWidth / targetDimensions.width;
    const scaleY = targetDisplayHeight / targetDimensions.height;

    // Scale the bias position values to match the display dimensions
    const scaledX = currentBias.x * scaleX;
    const scaledY = currentBias.y * scaleY;

    // Position the wrapper at the target area's top-left corner
    // The target area overlay is centered in the container, so we need to calculate its position
    // The container has 2em padding, so the target area is centered within the padded area
    const targetAreaX = (containerWidth - targetDisplayWidth) / 2;
    const targetAreaY = (containerHeight - targetDisplayHeight) / 2;

    // Apply position to wrapper - start at target area top-left (0,0), then apply bias offset
    // This matches the client preview behavior where bias 0,0 means top-left corner
    wrapper.style.transform = `translate(${targetAreaX + scaledX}px, ${targetAreaY + scaledY}px)`;

    // Apply rotation and scale to image (from top-left corner)
    const { scale, rotate } = currentBias;
    image.style.transform = `rotate(${rotate}deg) scale(${scale})`;
}

// Handle bias control changes
function handleBiasControlChange() {
    const biasX = document.getElementById('biasX');
    const biasY = document.getElementById('biasY');
    const biasScale = document.getElementById('biasScale');
    const biasRotate = document.getElementById('biasRotate');

    if (!biasX || !biasY || !biasScale || !biasRotate) {
        console.warn('Bias control inputs not found');
        return;
    }

    const x = parseInt(biasX.value) || 0;
    const y = parseInt(biasY.value) || 0;
    const scale = parseFloat(biasScale.value) || 1.0;
    const rotate = parseInt(biasRotate.value) || 0;

    imageBiasAdjustmentData.currentBias = { x, y, scale, rotate };
    updateBiasAdjustmentImage();

    // Update client preview if it's active
    if (imageBiasAdjustmentData.previewMode === 'client') {
        updateClientPreview();
    }
}

// Image Bias Preset Functions
function getImageBiasPresetOptions() {
    // Get orientation data using centralized function
    const { isPortrait } = getImageBiasOrientation();

    if (!isPortrait) {
        return [
            { value: '0', display: 'Top' },
            { value: '1', display: 'Mid-Top' },
            { value: '2', display: 'Center' },
            { value: '3', display: 'Mid-Bottom' },
            { value: '4', display: 'Bottom' }
        ];
    } else {
        // Portrait - use vertical position names
        return [
            { value: '0', display: 'Left' },
            { value: '1', display: 'Mid-Left' },
            { value: '2', display: 'Center' },
            { value: '3', display: 'Mid-Right' },
            { value: '4', display: 'Right' }
        ];
    }
}

function renderImageBiasPresetDropdown(selectedVal) {
    const menu = document.getElementById('imageBiasPresetMenu');
    if (!menu) return;

    menu.innerHTML = '';

    const presetOptions = getImageBiasPresetOptions();

    presetOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        optionElement.dataset.value = option.value;

        // Get orientation data using centralized function
        const { isPortrait: isPortraitMode } = getImageBiasOrientation();

        // Create grid based on orientation
        let gridHTML = '';
        if (isPortraitMode) {
            // Portrait: 3 columns, 5 rows (vertical layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        } else {
            // Landscape: 5 columns, 3 rows (horizontal layout)
            for (let i = 0; i < 15; i++) {
                gridHTML += '<div class="grid-cell"></div>';
            }
        }

        optionElement.innerHTML = `
            <div class="mask-bias-option-content">
                <div class="mask-bias-grid" data-bias="${option.value}" data-orientation="${isPortraitMode ? 'portrait' : 'landscape'}">
                    ${gridHTML}
                </div>
                <span class="mask-bias-label">${option.display}</span>
            </div>
        `;

        optionElement.addEventListener('click', (e) => {
            
            applyImageBiasPreset(option.value);
            closeImageBiasPresetDropdown();
        });

        menu.appendChild(optionElement);
    });
}

function selectImageBiasPreset(value) {
    const btn = document.getElementById('imageBiasPresetBtn');
    if (!btn) {
        console.warn('Image bias preset button not found');
        return;
    }
    
    const grid = btn.querySelector('.mask-bias-grid');
    const label = btn.querySelector('.mask-bias-label');
    
    if (!grid || !label) {
        console.warn('Required elements not found in preset button');
        return;
    }

    const presetOptions = getImageBiasPresetOptions();
    const selectedOption = presetOptions.find(option => option.value === value);

    if (selectedOption) {
        label.textContent = selectedOption.display;
    } else {
        label.textContent = 'Center';
    }

    // Update the button's grid preview
    grid.setAttribute('data-bias', value);

    // Get orientation data using centralized function
    const { isPortrait: isPortraitMode } = getImageBiasOrientation();

    grid.setAttribute('data-orientation', isPortraitMode ? 'portrait' : 'landscape');

    // Calculate and apply the preset position
    applyImageBiasPreset(value);
}

function applyImageBiasPreset(presetValue) {
    if (!imageBiasAdjustmentData.targetDimensions || !imageBiasAdjustmentData.originalImage) {
        console.warn('Missing target dimensions or original image for bias preset');
        return;
    }

    const { width: targetWidth, height: targetHeight } = imageBiasAdjustmentData.targetDimensions;
    const { width: imageWidth, height: imageHeight } = imageBiasAdjustmentData.originalImage;

    // Calculate how the image fills the target area
    const imageAR = imageWidth / imageHeight;
    const targetAR = targetWidth / targetHeight;

    let imageFillWidth, imageFillHeight;

    if (imageAR > targetAR) {
        // Image is wider than target, scale to match target height
        imageFillHeight = targetHeight;
        imageFillWidth = targetHeight * imageAR;
    } else {
        // Image is taller than target, scale to match target width
        imageFillWidth = targetWidth;
        imageFillHeight = targetWidth / imageAR;
    }

    // Calculate position based on preset
    let x = 0, y = 0;

    switch (presetValue) {
        case '0': // Top/Left
            x = 0;
            y = 0;
            break;
        case '1': // Mid-Top/Mid-Left
            x = (targetWidth - imageFillWidth) / 2;
            y = 0;
            break;
        case '2': // Center
            x = (targetWidth - imageFillWidth) / 2;
            y = (targetHeight - imageFillHeight) / 2;
            break;
        case '3': // Mid-Bottom/Mid-Right
            x = (targetWidth - imageFillWidth) / 2;
            y = targetHeight - imageFillHeight;
            break;
        case '4': // Bottom/Right
            x = targetWidth - imageFillWidth;
            y = targetHeight - imageFillHeight;
            break;
    }

    // Update the bias values
    imageBiasAdjustmentData.currentBias.x = Math.round(x);
    imageBiasAdjustmentData.currentBias.y = Math.round(y);

    // Update the UI
    const biasX = document.getElementById('biasX');
    const biasY = document.getElementById('biasY');
    
    if (biasX) biasX.value = Math.round(x);
    if (biasY) biasY.value = Math.round(y);

    updateBiasAdjustmentImage();

    // Update client preview if it's active
    if (imageBiasAdjustmentData.previewMode === 'client') {
        updateClientPreview();
    }
}

function openImageBiasPresetDropdown() {
    const menu = document.getElementById('imageBiasPresetMenu');
    const btn = document.getElementById('imageBiasPresetBtn');
    if (menu && btn) {
        menu.style.display = 'block';
        btn.classList.add('active');
    } else {
        console.warn('Required elements not found for opening preset dropdown');
    }
}

function closeImageBiasPresetDropdown() {
    const menu = document.getElementById('imageBiasPresetMenu');
    const btn = document.getElementById('imageBiasPresetBtn');
    if (menu && btn) {
        menu.style.display = 'none';
        btn.classList.remove('active');
    } else {
        console.warn('Required elements not found for closing preset dropdown');
    }
}

// Reset bias controls
function resetBiasControls() {
    imageBiasAdjustmentData.currentBias = { x: 0, y: 0, scale: 1.0, rotate: 0 };
    updateBiasAdjustmentUI();
    updateBiasAdjustmentImage();
}

// Handle image dragging
function handleBiasImageMouseDown(e) {
    if (e.target.id !== 'biasAdjustmentImage') return;

    imageBiasAdjustmentData.isDragging = true;
    imageBiasAdjustmentData.dragStart = { x: e.clientX, y: e.clientY };
    imageBiasAdjustmentData.originalTransform = { ...imageBiasAdjustmentData.currentBias };
}

function handleBiasImageMouseMove(e) {
    if (!imageBiasAdjustmentData.isDragging) return;

    const deltaX = e.clientX - imageBiasAdjustmentData.dragStart.x;
    const deltaY = e.clientY - imageBiasAdjustmentData.dragStart.y;

    imageBiasAdjustmentData.currentBias.x = imageBiasAdjustmentData.originalTransform.x + deltaX;
    imageBiasAdjustmentData.currentBias.y = imageBiasAdjustmentData.originalTransform.y + deltaY;

    updateBiasAdjustmentUI();
    updateBiasAdjustmentImage();
}

function handleBiasImageMouseUp() {
    imageBiasAdjustmentData.isDragging = false;
}

// Toggle between CSS view and client preview
function togglePreviewMode() {
    const toggleBtn = document.getElementById('previewToggleBtn');
    const cssWrapper = document.getElementById('biasAdjustmentImageWrapper');
    const clientImage = document.getElementById('clientPreviewImage');

    if (!toggleBtn || !cssWrapper || !clientImage) {
        console.warn('Required elements not found for preview toggle');
        return;
    }

    const currentState = toggleBtn.getAttribute('data-state');
    const newState = currentState === 'on' ? 'off' : 'on';

    // Fix: Set preview mode based on the new state, not the current state
    imageBiasAdjustmentData.previewMode = newState === 'on' ? 'client' : 'css';

    if (newState === 'off') {
        // Show client preview
        toggleBtn.setAttribute('data-state', 'off');
        cssWrapper.style.display = 'none';
        clientImage.style.display = 'block';
        updateClientPreview();
    } else {
        // Show CSS interactive view
        toggleBtn.setAttribute('data-state', 'on');
        cssWrapper.style.display = 'block';
        clientImage.style.display = 'none';
        updateBiasAdjustmentImage();
    }
}

// Update client preview image
async function updateClientPreview() {
    if (!imageBiasAdjustmentData.originalImage || !imageBiasAdjustmentData.targetDimensions) return;

    try {
        const clientPreview = await generateClientBiasPreview();
        const clientImage = document.getElementById('clientPreviewImage');
        if (clientImage) {
            clientImage.src = clientPreview;
        } else {
            console.warn('Client preview image element not found');
        }
    } catch (error) {
        console.error('Failed to update client preview:', error);
    }
}

// Test bias adjustment
async function testBiasAdjustment() {
    if (!imageBiasAdjustmentData.originalImage || !imageBiasAdjustmentData.targetDimensions) {
        showError('No image data available for testing');
        return;
    }

    const testBtn = document.getElementById('biasTestBtn');
    const resultsDiv = document.getElementById('biasTestResults');

    if (!testBtn || !resultsDiv) {
        console.warn('Required elements not found for bias testing');
        return;
    }

    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="spinner"></i> Testing...';

    try {
        // Generate client-side preview
        const clientPreview = await generateClientBiasPreview();
        const clientTestImage = document.getElementById('clientTestImage');
        if (clientTestImage) {
            clientTestImage.src = clientPreview;
        }

        // Generate server-side preview
        const serverPreview = await generateServerBiasPreview();
        const serverTestImage = document.getElementById('serverTestImage');
        if (serverTestImage) {
            serverTestImage.src = serverPreview;
        }

        resultsDiv.style.display = 'flex';

    } catch (error) {
        console.error('Bias test error:', error);
        showError('Failed to test bias adjustment: ' + error.message);
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = '<i class="nai-sparkles"></i> Test Adjustment';
    }
}

// Generate client-side bias preview
async function generateClientBiasPreview() {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const { originalImage, targetDimensions, currentBias } = imageBiasAdjustmentData;

        canvas.width = targetDimensions.width;
        canvas.height = targetDimensions.height;

        // Calculate how to fill the canvas while maintaining aspect ratio
        const imageAR = originalImage.width / originalImage.height;
        const targetAR = targetDimensions.width / targetDimensions.height;

        let drawWidth, drawHeight, drawX, drawY;

        if (imageAR > targetAR) {
            // Image is wider than target, scale to match target height
            drawHeight = targetDimensions.height;
            drawWidth = targetDimensions.height * imageAR;
            // Position at top-left corner, not centered
            drawX = 0;
            drawY = 0;
        } else {
            // Image is taller than target, scale to match target width
            drawWidth = targetDimensions.width;
            drawHeight = targetDimensions.width / imageAR;
            // Position at top-left corner, not centered
            drawX = 0;
            drawY = 0;
        }

        // Apply bias transformations - all referenced to top-left corner
        ctx.save();

        // Apply position offset (absolute pixels, not affected by scale)
        // Client preview should not have padding - it represents the actual target resolution
        ctx.translate(currentBias.x, currentBias.y);

        // Apply rotation and scale from top-left corner
        ctx.rotate((currentBias.rotate * Math.PI) / 180);
        ctx.scale(currentBias.scale, currentBias.scale);

        // Draw the image to fill the canvas (like object-fit: cover)
        ctx.drawImage(originalImage, drawX, drawY, drawWidth, drawHeight);

        ctx.restore();

        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            resolve(url);
        }, 'image/png');
    });
}

// Generate server-side bias preview
async function generateServerBiasPreview() {
    const { targetDimensions, currentBias } = imageBiasAdjustmentData;

    // Get the image source path from uploaded image data
    if (!window.uploadedImageData || !window.uploadedImageData.image_source) {
        throw new Error('No image source available for server test');
    }

    const imageSource = window.uploadedImageData.image_source;

    // Send to server for processing
    const response = await fetchWithAuth('/test-bias-adjustment', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            image_source: imageSource,
            target_width: targetDimensions.width,
            target_height: targetDimensions.height,
            bias: currentBias
        })
    });

    if (!response.ok) {
        throw new Error(`Server test failed: ${response.statusText}`);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

// Save bias adjustment
async function saveBiasAdjustment() {
    if (!imageBiasAdjustmentData.currentBias) {
        showError('No bias adjustment to save');
        return;
    }

    // Show confirmation dialog with previews
    await showBiasAdjustmentConfirmDialog();
}

// Show bias adjustment confirmation dialog
async function showBiasAdjustmentConfirmDialog() {
    const dialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (!dialog) {
        console.error('Bias adjustment confirmation dialog not found');
        return;
    }

    // Generate previews
    await generateConfirmationPreviews();

    // Show dialog
    openModal(dialog);
}

// Generate previews for confirmation dialog
async function generateConfirmationPreviews() {
    try {
        // Generate client preview
        const clientPreview = await generateClientBiasPreview();
        const confirmClientPreview = document.getElementById('confirmClientPreview');
        if (confirmClientPreview && clientPreview) {
            confirmClientPreview.src = clientPreview;
        }

        // Generate server preview
        const serverPreview = await generateServerBiasPreview();
        const confirmServerPreview = document.getElementById('confirmServerPreview');
        if (confirmServerPreview && serverPreview) {
            confirmServerPreview.src = serverPreview;
        }
    } catch (error) {
        console.error('Failed to generate confirmation previews:', error);
        showError('Failed to generate previews');
    }
}

// Accept bias adjustment and save
function acceptBiasAdjustment() {
    if (!imageBiasAdjustmentData.currentBias) {
        showError('No bias adjustment to save');
        return;
    }

    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;

    if (hasExistingMask) {
        // Store the pending bias adjustment and show alert modal
        window.pendingBiasAdjustment = {
            bias: imageBiasAdjustmentData.currentBias,
            callback: () => {
                // This will be called after the mask is handled
            }
        };
        hideBiasAdjustmentConfirmDialog();
        hideImageBiasAdjustmentModal();
        showImageBiasMaskAlertModal();
        return;
    }

    // No mask exists, proceed with bias adjustment
    applyBiasAdjustment();
}

// Apply bias adjustment (helper function)
function applyBiasAdjustment() {
    // Store the bias adjustment data
    if (!window.uploadedImageData) {
        window.uploadedImageData = {};
    }

    // Store the previous bias before applying the new one
    window.uploadedImageData.previousBias = window.uploadedImageData.image_bias || window.uploadedImageData.bias || 2;

    window.uploadedImageData.image_bias = imageBiasAdjustmentData.currentBias;

    // Update the hidden input for form submission
    const imageBiasHidden = document.getElementById('imageBias');
    if (imageBiasHidden) {
        imageBiasHidden.value = JSON.stringify(imageBiasAdjustmentData.currentBias);
    }

    // Close both dialogs
    hideBiasAdjustmentConfirmDialog();
    hideImageBiasAdjustmentModal();

    // Update the main preview
    cropImageToResolution();
    
    // Update image bias orientation after applying bias adjustment
    updateImageBiasOrientation();

    renderImageBiasDropdown();
}

// Hide bias adjustment confirmation dialog
function hideBiasAdjustmentConfirmDialog() {
    const dialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (dialog) {
        closeModal(dialog);
    }
}

// Show base image change alert modal
function showBaseImageChangeAlertModal() {
    const modal = document.getElementById('baseImageChangeAlertModal');
    if (modal) {
        openModal(modal);
    }
}

// Hide base image change alert modal
function hideBaseImageChangeAlertModal() {
    const modal = document.getElementById('baseImageChangeAlertModal');
    if (modal) {
        closeModal(modal);
    }
}

// Show image bias mask alert modal
function showImageBiasMaskAlertModal() {
    const modal = document.getElementById('imageBiasMaskAlertModal');
    if (modal) {
        openModal(modal);
    }
}

// Hide image bias mask alert modal
function hideImageBiasMaskAlertModal() {
    const modal = document.getElementById('imageBiasMaskAlertModal');
    if (modal) {
        closeModal(modal);
    }
}

// Confirm base image change and delete mask
async function confirmBaseImageChange() {
    // Delete the existing mask
    await deleteMask();

    // Hide the modal
    hideBaseImageChangeAlertModal();

    // Continue with the pending image upload
    if (window.pendingImageUpload) {
        const { file } = window.pendingImageUpload;
        window.pendingImageUpload = null;
        await handleManualImageUploadInternal(file);
    }

    // Continue with the pending cache image selection
    if (window.pendingCacheImageSelection) {
        const { cacheImage } = window.pendingCacheImageSelection;
        window.pendingCacheImageSelection = null;
        await selectCacheImageInternal(cacheImage);
    }
}

// Apply image bias change (helper function)
async function applyImageBiasChange(value, callback) {
    // Clear dynamic bias data when selecting a preset
    if (window.uploadedImageData && window.uploadedImageData.image_bias && typeof window.uploadedImageData.image_bias === 'object') {
        delete window.uploadedImageData.image_bias;
    }

    // Fix: Ensure value is properly set, even if it's 0
    if (imageBiasHidden != null) {
        imageBiasHidden.value = value.toString();
    }

    // Update the uploaded image data with the new bias value
    if (window.uploadedImageData) {
        window.uploadedImageData.bias = parseInt(value);
    }

    updateImageBiasDisplay(value);
    
    // Update image bias orientation after changing bias
    updateImageBiasOrientation();

    // Reload the preview image with the new bias
    await cropImageToResolution();

    // Call the original callback if provided
    if (callback) {
        callback();
    }
}

// Hide image bias adjustment modal
function hideImageBiasAdjustmentModal() {
    const modal = document.getElementById('imageBiasAdjustmentModal');
    if (modal) {
        closeModal(modal);
    }

    // Clean up test results
    const resultsDiv = document.getElementById('biasTestResults');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }

    // Reset dragging state
    imageBiasAdjustmentData.isDragging = false;
    imageBiasAdjustmentData.previewMode = 'css';
    
    // Reset toggle button state to default (CSS view)
    const toggleBtn = document.getElementById('previewToggleBtn');
    if (toggleBtn) {
        toggleBtn.setAttribute('data-state', 'on');
    }
}

// Enhanced cropImageToResolution function to handle dynamic bias adjustments
async function cropImageToResolution() {
    if (!(window.uploadedImageData && (window.uploadedImageData.image_source || window.uploadedImageData.originalDataUrl))) {
        console.warn('No uploaded image data available for cropping');
        return;
    }
    
    // Check if we actually need to crop using the helper function
    if (!isCroppingNeeded()) {
        console.log('No cropping needed - dimensions match and no custom bias');
        return;
    }

    try {
        // Clean up any existing blob URLs before creating new ones
        cleanupBlobUrls();

        // Get the image data URL
        let imageDataUrl = window.uploadedImageData.originalDataUrl;

        if (!imageDataUrl) {
            const imageSource = window.uploadedImageData.image_source;
            if (imageSource.startsWith('data:')) {
                imageDataUrl = imageSource;
            } else {
                let imageUrl = null;
                if (imageSource.startsWith('file:')) {
                    imageUrl = `/images/${imageSource.replace('file:', '')}`;
                } else if (imageSource.startsWith('cache:')) {
                    imageUrl = `/cache/preview/${imageSource.replace('cache:', '')}.webp`;
                }
                if (imageUrl) {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    imageDataUrl = URL.createObjectURL(blob);
                }
            }
            window.uploadedImageData.originalDataUrl = imageDataUrl;
        }

        if (!imageDataUrl) {
            console.warn('Could not get image data URL for cropping');
            return;
        }

        // Check if we have dynamic bias adjustment data
        const dynamicBias = window.uploadedImageData.image_bias;
        let croppedBlobUrl;

        if (dynamicBias && typeof dynamicBias === 'object') {
            // Use dynamic bias adjustment
            croppedBlobUrl = await cropImageWithDynamicBias(imageDataUrl, dynamicBias);
        } else {
            // Use legacy bias system
            const bias = (window.uploadedImageData.bias !== undefined && window.uploadedImageData.bias !== null) ? window.uploadedImageData.bias : 2;
            croppedBlobUrl = await cropImageToResolutionInternal(imageDataUrl, bias);
        }

        // Update the preview image
        variationImage.src = croppedBlobUrl;
        variationImage.style.display = 'block';
        // Give the image more time to load before updating mask preview
        setTimeout(updateMaskPreview, 500);

        window.uploadedImageData.croppedBlobUrl = croppedBlobUrl;
        
        // Update the image bias orientation to ensure it's correct
        updateImageBiasOrientation();
    } catch (error) {
        console.error('Failed to crop image to resolution:', error);
        showError('Failed to crop image to resolution');
    }
}

// New function to crop image with dynamic bias adjustments
function cropImageWithDynamicBias(dataUrl, bias) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
            const resolutionDims = getDimensionsFromResolution(currentResolution);

            if (!resolutionDims) {
                resolve(dataUrl);
                return;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = resolutionDims.width;
            canvas.height = resolutionDims.height;

            // Calculate how to fill the canvas while maintaining aspect ratio
            const imageAR = img.width / img.height;
            const targetAR = resolutionDims.width / resolutionDims.height;

            let drawWidth, drawHeight, drawX, drawY;

            if (imageAR > targetAR) {
                // Image is wider than target, scale to match target height
                drawHeight = resolutionDims.height;
                drawWidth = resolutionDims.height * imageAR;
                // Position at top-left corner, not centered
                drawX = 0;
                drawY = 0;
            } else {
                // Image is taller than target, scale to match target width
                drawWidth = resolutionDims.width;
                drawHeight = resolutionDims.width / imageAR;
                // Position at top-left corner, not centered
                drawX = 0;
                drawY = 0;
            }

            // Apply bias transformations - all referenced to top-left
            ctx.save();

            // Apply position offset (absolute pixels, not affected by scale)
            // This function is for actual cropping, not preview - no padding needed
            ctx.translate(bias.x, bias.y);

            // Apply rotation around top-left corner (0,0)
            ctx.rotate((bias.rotate * Math.PI) / 180);

            // Apply scale from top-left corner
            ctx.scale(bias.scale, bias.scale);

            // Draw the image to fill the canvas (like object-fit: cover)
            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

            ctx.restore();

            // Convert to blob
            canvas.toBlob((blob) => {
                const blobUrl = URL.createObjectURL(blob);

                if (!window.croppedImageBlobUrls) {
                    window.croppedImageBlobUrls = [];
                }
                window.croppedImageBlobUrls.push(blobUrl);

                resolve(blobUrl);
            }, 'image/png');
        };
        img.src = dataUrl;
    });
}

// Setup image bias adjustment event listeners
function setupImageBiasAdjustmentListeners() {
    // Modal controls
    const closeBtn = document.getElementById('closeImageBiasAdjustmentBtn');
    const cancelBtn = document.getElementById('cancelBiasAdjustmentBtn');
    const saveBtn = document.getElementById('saveBiasAdjustmentBtn');
    const resetBtn = document.getElementById('biasResetBtn');
    const testBtn = document.getElementById('biasTestBtn');

    if (closeBtn) closeBtn.addEventListener('click', hideImageBiasAdjustmentModal);
    if (cancelBtn) cancelBtn.addEventListener('click', hideImageBiasAdjustmentModal);
    if (saveBtn) saveBtn.addEventListener('click', saveBiasAdjustment);
    if (resetBtn) resetBtn.addEventListener('click', resetBiasControls);
    if (testBtn) testBtn.addEventListener('click', testBiasAdjustment);



    // Bias control inputs
    const biasInputs = ['biasX', 'biasY', 'biasScale', 'biasRotate'];
    biasInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', handleBiasControlChange);
            input.addEventListener('wheel', (e) => {
                
                const delta = e.deltaY > 0 ? -1 : 1;
                const step = parseFloat(input.step) || 1;
                input.value = parseFloat(input.value || 0) + (delta * step);
                handleBiasControlChange();
            });
        }
    });

    // Image dragging
    const imageContainer = document.getElementById('imagePreviewContainer');
    if (imageContainer) {
        imageContainer.addEventListener('mousedown', handleBiasImageMouseDown);
        imageContainer.addEventListener('mousemove', handleBiasImageMouseMove);
        imageContainer.addEventListener('mouseup', handleBiasImageMouseUp);
    }

    // Preview toggle button
    const previewToggleBtn = document.getElementById('previewToggleBtn');

    if (previewToggleBtn) {
        previewToggleBtn.addEventListener('click', togglePreviewMode);
    }

    // Image bias preset dropdown
    const presetBtn = document.getElementById('imageBiasPresetBtn');
    if (presetBtn) {
        presetBtn.addEventListener('click', e => {
            
            e.stopPropagation();

            const menu = document.getElementById('imageBiasPresetMenu');
            if (menu.style.display === 'block') {
                closeImageBiasPresetDropdown();
            } else {
                renderImageBiasPresetDropdown(); // Default to center
                openImageBiasPresetDropdown();
            }
        });
    }

    // Close image bias preset dropdown when clicking outside
    document.addEventListener('click', e => {
        const dropdown = document.getElementById('imageBiasPresetDropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            closeImageBiasPresetDropdown();
        }
    });

    // Close modal when clicking outside
    const modal = document.getElementById('imageBiasAdjustmentModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideImageBiasAdjustmentModal();
            }
        });
    }

    // Close base image change alert modal when clicking outside
    const baseImageChangeModal = document.getElementById('baseImageChangeAlertModal');
    if (baseImageChangeModal) {
        baseImageChangeModal.addEventListener('click', (e) => {
            if (e.target === baseImageChangeModal) {
                hideBaseImageChangeAlertModal();
                // Clear any pending changes
                window.pendingImageUpload = null;
                window.pendingCacheImageSelection = null;
            }
        });
    }

    // Close image bias mask alert modal when clicking outside
    const imageBiasMaskModal = document.getElementById('imageBiasMaskAlertModal');
    if (imageBiasMaskModal) {
        imageBiasMaskModal.addEventListener('click', (e) => {
            if (e.target === imageBiasMaskModal) {
                hideImageBiasMaskAlertModal();
                // Clear any pending changes
                window.pendingImageBiasChange = null;
                window.pendingBiasAdjustment = null;
            }
        });
    }

    // Confirmation dialog controls
    const closeConfirmBtn = document.getElementById('closeBiasConfirmBtn');
    const cancelConfirmBtn = document.getElementById('cancelBiasConfirmBtn');

    // Base image change alert modal controls
    const closeBaseImageChangeAlertBtn = document.getElementById('closeBaseImageChangeAlertBtn');
    const confirmBaseImageChangeBtn = document.getElementById('confirmBaseImageChangeBtn');
    const cancelBaseImageChangeBtn = document.getElementById('cancelBaseImageChangeBtn');

    if (closeBaseImageChangeAlertBtn) closeBaseImageChangeAlertBtn.addEventListener('click', (e) => {
        
        hideBaseImageChangeAlertModal();
        // Clear any pending changes
        window.pendingImageUpload = null;
        window.pendingCacheImageSelection = null;
    });
    if (confirmBaseImageChangeBtn) confirmBaseImageChangeBtn.addEventListener('click', (e) => {
        
        confirmBaseImageChange();
    });
    if (cancelBaseImageChangeBtn) cancelBaseImageChangeBtn.addEventListener('click', (e) => {
        
        hideBaseImageChangeAlertModal();
        // Clear any pending changes
        window.pendingImageUpload = null;
        window.pendingCacheImageSelection = null;
    });

    // Image bias mask alert modal controls
    const closeImageBiasMaskAlertBtn = document.getElementById('closeImageBiasMaskAlertBtn');
    const cancelImageBiasBtn = document.getElementById('cancelImageBiasBtn');
    const removeMaskBtn = document.getElementById('removeMaskBtn');
    const createMaskBtn = document.getElementById('createMaskBtn');

    if (closeImageBiasMaskAlertBtn) closeImageBiasMaskAlertBtn.addEventListener('click', (e) => {
        
        hideImageBiasMaskAlertModal();
        // Clear any pending changes
        window.pendingImageBiasChange = null;
        window.pendingBiasAdjustment = null;
    });
    if (cancelImageBiasBtn) cancelImageBiasBtn.addEventListener('click', (e) => {
        
        hideImageBiasMaskAlertModal();
        // Clear any pending changes
        window.pendingImageBiasChange = null;
        window.pendingBiasAdjustment = null;
    });
    if (removeMaskBtn) removeMaskBtn.addEventListener('click', (e) => {
        
        deleteMask();
        hideImageBiasMaskAlertModal();
        // Continue with the pending image bias change
        if (window.pendingImageBiasChange) {
            const { value, callback } = window.pendingImageBiasChange;
            window.pendingImageBiasChange = null;
            applyImageBiasChange(value, callback);
        }
        // Continue with the pending bias adjustment
        if (window.pendingBiasAdjustment) {
            const { bias, callback } = window.pendingBiasAdjustment;
            window.pendingBiasAdjustment = null;
            imageBiasAdjustmentData.currentBias = bias;
            applyBiasAdjustment();
        }
    });
    if (createMaskBtn) {
        createMaskBtn.addEventListener('click', async (e) => {
        hideImageBiasMaskAlertModal();
        let hadPendingChanges = false;

        // Continue with the pending image bias change first
        if (window.pendingImageBiasChange) {
            const { value, callback } = window.pendingImageBiasChange;
            window.pendingImageBiasChange = null;
            await applyImageBiasChange(value, callback);
            hadPendingChanges = true;
        }

        // Continue with the pending bias adjustment first
        if (window.pendingBiasAdjustment) {
            const { bias, callback } = window.pendingBiasAdjustment;
            window.pendingBiasAdjustment = null;
            imageBiasAdjustmentData.currentBias = bias;
            await applyBiasAdjustment();
            hadPendingChanges = true;
        }

        if (hadPendingChanges) {
            // Then create mask from transparent pixels
            await createMaskFromTransparentPixels();
        } else {
            // No pending changes, just open the mask editor
            openMaskEditor();
        }
    });
    }
    const acceptConfirmBtn = document.getElementById('acceptBiasConfirmBtn');

    if (closeConfirmBtn) closeConfirmBtn.addEventListener('click', (e) => {
        
        hideBiasAdjustmentConfirmDialog();
    });
    if (cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', (e) => {
        
        hideBiasAdjustmentConfirmDialog();
    });
    if (acceptConfirmBtn) acceptConfirmBtn.addEventListener('click', (e) => {
        
        acceptBiasAdjustment();
    });

    // Close confirmation dialog when clicking outside
    const confirmDialog = document.getElementById('biasAdjustmentConfirmDialog');
    if (confirmDialog) {
        confirmDialog.addEventListener('click', (e) => {
            if (e.target === confirmDialog) {
                hideBiasAdjustmentConfirmDialog();
            }
        });
    }
}

// Add button to open bias adjustment modal
function addBiasAdjustmentButton() {
    // Check if button already exists
    if (document.getElementById('imageBiasAdjustBtn')) return;

    if (!imageBiasDropdown) {
        console.warn('Image bias dropdown not found, cannot add adjustment button');
        return;
    }

    const adjustBtn = document.createElement('button');
    adjustBtn.id = 'imageBiasAdjustBtn';
    adjustBtn.type = 'button';
    adjustBtn.className = 'btn-secondary';
    adjustBtn.innerHTML = '<i class="nai-settings"></i>';
    adjustBtn.title = 'Advanced Bias Adjustment';

    adjustBtn.addEventListener('click', showImageBiasAdjustmentModal);

    imageBiasDropdown.parentNode.insertBefore(adjustBtn, imageBiasDropdown.nextSibling);
}

// Initialize image bias adjustment functionality
function initializeImageBiasAdjustment() {
    setupImageBiasAdjustmentListeners();

    // Connect existing bias adjustment button
    const adjustBtn = document.getElementById('imageBiasAdjustBtn');
    if (adjustBtn) {
        adjustBtn.addEventListener('click', showImageBiasAdjustmentModal);
    }

    // Add bias adjustment button when image bias group is shown (fallback)
    if (imageBiasGroup) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (imageBiasGroup && imageBiasGroup.style.display !== 'none') {
                        addBiasAdjustmentButton();
                    }
                }
            });
        });

        observer.observe(imageBiasGroup, { attributes: true });
    } else {
        console.warn('Image bias group not found, cannot set up observer');
    }
}

window.wsClient.registerInitStep(94, 'Initializing Image Bias System', async () => {
    await initializeImageBiasAdjustment();
});