// Image Preview Modal functionality
let imagePreviewZoom = 1;
let imagePreviewPanX = 0;
let imagePreviewPanY = 0;
let isImagePreviewDragging = false;
let lastImagePreviewMouseX = 0;
let lastImagePreviewMouseY = 0;
let lastImagePreviewDistance = null;

// DOM elements
const imagePreviewModal = document.getElementById('imagePreviewModal');
const imagePreviewImage = document.getElementById('imagePreviewImage');
const imagePreviewImageContainer = document.querySelector('.image-preview-image-container');
const imagePreviewCloseBtn = document.getElementById('imagePreviewCloseBtn');

// Initialize image preview functionality
function initializeImagePreview() {
    if (!imagePreviewModal || !imagePreviewImage || !imagePreviewImageContainer || !imagePreviewCloseBtn) {
        console.error('Image preview elements not found');
        return;
    }

    // Close button event
    imagePreviewCloseBtn.addEventListener('click', hideImagePreview);

    // Initialize zoom and pan functionality
    initializeImagePreviewZoom();

    // Close on background click
    imagePreviewModal.addEventListener('click', (e) => {
        if (e.target === imagePreviewModal) {
            hideImagePreview();
        }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imagePreviewModal.style.display === 'block') {
            hideImagePreview();
        }
    });
}

// Initialize zoom and pan functionality
function initializeImagePreviewZoom() {
    if (!imagePreviewImageContainer || !imagePreviewImage) return;

    // Mouse wheel zoom
    imagePreviewImageContainer.addEventListener('wheel', handleImagePreviewWheel);

    // Mouse drag pan
    imagePreviewImageContainer.addEventListener('mousedown', handleImagePreviewMouseDown);
    document.addEventListener('mousemove', handleImagePreviewMouseMove);
    document.addEventListener('mouseup', handleImagePreviewMouseUp);

    // Touch events for mobile
    imagePreviewImageContainer.addEventListener('touchstart', handleImagePreviewTouchStart);
    document.addEventListener('touchmove', handleImagePreviewTouchMove);
    document.addEventListener('touchend', handleImagePreviewTouchEnd);

    // Double click to reset zoom
    imagePreviewImageContainer.addEventListener('dblclick', resetImagePreviewZoom);
}

// Handle mouse wheel zoom
let imagePreviewWheelZoomTimeout = null;
function handleImagePreviewWheel(e) {
    e.preventDefault();
    
    if (imagePreviewWheelZoomTimeout)
        return;
    imagePreviewWheelZoomTimeout = setTimeout(() => {
        imagePreviewWheelZoomTimeout = null;
    }, 100);
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    
    const newZoom = Math.max(1, Math.min(5, imagePreviewZoom * delta));
    
    // Reset zoom if going back to 1x
    if (newZoom <= 1 && imagePreviewZoom > 1) {
        resetImagePreviewZoom();
        return;
    }
    
    // Get the container bounds
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Calculate mouse position relative to the container
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Get the image element to calculate its dimensions
    const image = document.getElementById('imagePreviewImage');
    if (!image) return;
    
    // Calculate the image's visual dimensions and position within the container
    const imageRect = image.getBoundingClientRect();
    const containerRect = e.currentTarget.getBoundingClientRect();
    
    // Calculate the image's center offset from the container center
    const imageCenterX = containerRect.width / 2;
    const imageCenterY = containerRect.height / 2;
    
    // Calculate the mouse position relative to the image center
    const mouseRelToImageCenterX = mouseX - imageCenterX;
    const mouseRelToImageCenterY = mouseY - imageCenterY;
    
    // Calculate the zoom change factor
    const zoomChange = newZoom / imagePreviewZoom;
    
    // Calculate new pan position to zoom into the mouse cursor
    // Account for transform-origin: center
    imagePreviewPanX = imagePreviewPanX - (mouseRelToImageCenterX * (zoomChange - 1));
    imagePreviewPanY = imagePreviewPanY - (mouseRelToImageCenterY * (zoomChange - 1));
    
    imagePreviewZoom = newZoom;
    updateImagePreviewTransform();
    imagePreviewImageContainer.classList.toggle('zoomed', imagePreviewZoom > 1);
}

// Handle mouse down for dragging
function handleImagePreviewMouseDown(e) {
    if (imagePreviewZoom > 1) {
        isImagePreviewDragging = true;
        lastImagePreviewMouseX = e.clientX;
        lastImagePreviewMouseY = e.clientY;
        imagePreviewImageContainer.style.cursor = 'grabbing';
    }
}

// Handle mouse move for dragging
function handleImagePreviewMouseMove(e) {
    if (isImagePreviewDragging && imagePreviewZoom > 1) {
        const deltaX = e.clientX - lastImagePreviewMouseX;
        const deltaY = e.clientY - lastImagePreviewMouseY;
        
        imagePreviewPanX += deltaX;
        imagePreviewPanY += deltaY;
        
        lastImagePreviewMouseX = e.clientX;
        lastImagePreviewMouseY = e.clientY;
        
        updateImagePreviewTransform();
    }
}

// Handle mouse up for dragging
function handleImagePreviewMouseUp() {
    isImagePreviewDragging = false;
    imagePreviewImageContainer.style.cursor = imagePreviewZoom > 1 ? 'grab' : 'default';
}

// Handle touch start
function handleImagePreviewTouchStart(e) {
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        lastImagePreviewMouseX = touch.clientX;
        lastImagePreviewMouseY = touch.clientY;
        
        if (imagePreviewZoom > 1) {
            isImagePreviewDragging = true;
        }
    }
}

// Handle touch move
function handleImagePreviewTouchMove(e) {
    e.preventDefault();
    
    if (e.touches.length === 1 && isImagePreviewDragging && imagePreviewZoom > 1) {
        const touch = e.touches[0];
        const deltaX = touch.clientX - lastImagePreviewMouseX;
        const deltaY = touch.clientY - lastImagePreviewMouseY;
        
        imagePreviewPanX += deltaX;
        imagePreviewPanY += deltaY;
        
        lastImagePreviewMouseX = touch.clientX;
        lastImagePreviewMouseY = touch.clientY;
        
        updateImagePreviewTransform();
    } else if (e.touches.length === 2) {
        // Pinch zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;
        
        const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
        const delta = currentDistance / (lastImagePreviewDistance || currentDistance);
        
        const newZoom = Math.max(1, Math.min(5, imagePreviewZoom * delta));
        
        if (newZoom <= 1 && imagePreviewZoom > 1) {
            resetImagePreviewZoom();
            return;
        }
        
        const zoomChange = newZoom / imagePreviewZoom;
        imagePreviewPanX = centerX - (centerX - imagePreviewPanX) * zoomChange;
        imagePreviewPanY = centerY - (centerY - imagePreviewPanY) * zoomChange;
        
        imagePreviewZoom = newZoom;
        lastImagePreviewDistance = currentDistance;
        updateImagePreviewTransform();
        imagePreviewImageContainer.classList.toggle('zoomed', imagePreviewZoom > 1);
    }
}

// Handle touch end
function handleImagePreviewTouchEnd() {
    isImagePreviewDragging = false;
    lastImagePreviewDistance = null;
}

// Reset zoom and pan
function resetImagePreviewZoom() {
    imagePreviewZoom = 1;
    imagePreviewPanX = 0;
    imagePreviewPanY = 0;
    updateImagePreviewTransform();
    imagePreviewImageContainer.classList.remove('zoomed');
}

// Update image transform
function updateImagePreviewTransform() {
    if (imagePreviewImage) {
        imagePreviewImage.style.transform = `translate(${imagePreviewPanX}px, ${imagePreviewPanY}px) scale(${imagePreviewZoom})`;
    }
}

// Show image preview modal
function showImagePreview(imageSrc, imageAlt = 'Preview Image') {
    if (!imagePreviewModal || !imagePreviewImage) {
        console.error('Image preview elements not found');
        return;
    }
    
    // Reset zoom and pan
    resetImagePreviewZoom();
    
    // Set image source and alt
    imagePreviewImage.src = imageSrc;
    imagePreviewImage.alt = imageAlt;
    
    // Add error handling for image loading
    imagePreviewImage.onerror = function() {
        console.error('Failed to load image:', imageSrc);
        if (typeof showError === 'function') {
            showError('Failed to load image');
        } else {
            console.error('showError function not available');
        }
    };
    
    // Show modal
    imagePreviewModal.style.display = 'block';
    document.body.classList.add('modal-open');
}

// Hide image preview modal
function hideImagePreview() {
    if (!imagePreviewModal) return;
    
    imagePreviewModal.style.display = 'none';
    document.body.classList.remove('modal-open');
    
    // Reset zoom and pan
    resetImagePreviewZoom();
}

// Initialize when DOM is loaded
window.wsClient.registerInitStep(88, 'Initializing Lightbox (Preview)', async () => {
    initializeImagePreview();
});

// Export functions for use in other modules
window.showImagePreview = showImagePreview;
window.hideImagePreview = hideImagePreview;
