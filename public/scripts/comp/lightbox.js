// PhotoSwipe Lightbox Implementation
let lightbox = null;
let currentImageIndex = 0;

// Initialize PhotoSwipe lightbox
async function initializePhotoSwipe() {
    try {
        const PhotoSwipeLightbox = await import('/dist/photoswipe/photoswipe-lightbox.esm.js');
        
        lightbox = new PhotoSwipeLightbox.default({
            dataSource: [],
            pswpModule: () => import('/dist/photoswipe/photoswipe.esm.js'),
            showHideAnimationType: 'zoom', //'fade',
            showAnimationDuration: 300,
            hideAnimationDuration: 300,
            allowPanToNext: true,
            allowMouseDrag: true,
            allowTouchDrag: true,
            opacity: 0.15,
            spacing: 0.1,
            loop: true,
            pinchToClose: true,
            closeOnScroll: false,
            closeOnVerticalDrag: true,
            wheelToZoom: true,
            escKey: true,
            arrowKeys: true,
            returnFocus: true,
            initalZoomLevel: 'fit',
            secondaryZoomLevel: 1,
            maxZoomLevel: 4,
            imageClickAction: 'zoom',
            tapAction: 'zoom',
            doubleTapAction: 'zoom',
            indexIndicatorSep: ' / ',
            preloaderDelay: 2000,
            errorMsg: '<div class="pswp__error-msg">Image not found</div>',
            closeTitle: 'Close (Esc)',
            prevTitle: 'Previous (arrow left)',
            nextTitle: 'Next (arrow right)',
            zoomTitle: 'Zoom in/out',
            counterTitle: 'Image counter',
            fullscreenTitle: 'Toggle fullscreen',
            shareTitle: 'Share',
            toggleThumbnailsTitle: 'Toggle thumbnails',
            downloadTitle: 'Download'
        });

        // Function to update button visibility based on current slide
        const updateButtonVisibility = (bottomBar, pswp) => {
            if (!bottomBar || !pswp) return;
            
            const currentItem = pswp.currSlide;
            if (currentItem && currentItem.data) {
                // Hide bottom bar for standalone images
                if (currentItem.data.isStandalone) {
                    bottomBar.classList.add('hidden');
                    return;
                } else {
                    bottomBar.classList.remove('hidden');
                }
            }
        };

        // Add custom UI elements
        lightbox.on('uiRegister', function() {
            // Create custom bottom bar container
            lightbox.pswp.ui.registerElement({
                name: 'custom-bottom-bar',
                order: 9,
                isButton: false,
                appendTo: 'wrapper',
                html: '<div class="pswp__custom-bottom-bar"></div>',
                onInit: (el, pswp) => {
                    const bottomBar = el.querySelector('.pswp__custom-bottom-bar');
                    
                    // Initial visibility check
                    updateButtonVisibility(bottomBar, pswp);
                    
                    // Create all buttons
                    const buttons = [
                        {
                            className: 'download-button',
                            icon: '<i class="fas fa-download"></i>',
                            label: 'Download image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    downloadImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'copy-button',
                            icon: '<i class="fas fa-clipboard"></i>',
                            label: 'Copy to clipboard',
                            onClick: async () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    try {
                                        const imageData = currentItem.data.data;
                                        
                                        // Determine the correct URL for the image
                                        let imageUrl;
                                        if (imageData.url) {
                                            // For newly generated images
                                            imageUrl = imageData.url;
                                        } else {
                                            // For gallery images - prefer highest quality version
                                            const filename = imageData.upscaled || imageData.original;
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
                                }
                            }
                        },
                        {
                            className: 'pin-button',
                            icon: '<i class="fa-regular fa-star"></i>',
                            label: 'Pin image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    togglePinImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'reroll-button',
                            icon: '<i class="nai-dice"></i>',
                            label: 'Reroll image',
                            onClick: (e) => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    rerollImage(currentItem.data?.data, e);
                                }
                            }
                        },
                        {
                            className: 'reroll-edit-button',
                            icon: '<i class="mdi mdi-1-25 mdi-text-box-edit-outline"></i>',
                            label: 'Reroll with edit',
                            onClick: (e) => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    rerollImageWithEdit(currentItem.data?.data, e);
                                }
                            }
                        },
                        {
                            className: 'upscale-button',
                            icon: '<i class="nai-upscale"></i>',
                            label: 'Upscale image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    upscaleImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'scrap-button',
                            icon: '<i class="mdi mdi-1-5 mdi-archive"></i>',
                            label: 'Move to scraps',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    if (currentGalleryView === 'scraps') {
                                        removeFromScraps(currentItem.data?.data);
                                    } else {
                                        moveToScraps(currentItem.data?.data);
                                    }
                                }
                            }
                        },
                        {
                            className: 'delete-button',
                            icon: '<i class="nai-trash"></i>',
                            label: 'Delete image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    deleteImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'metadata-button',
                            icon: '<i class="fas fa-info-circle"></i>',
                            label: 'Show metadata',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    showMetadataDialog();
                                }
                            }
                        }
                    ];

                    // Add all buttons to the bottom bar
                    buttons.forEach(buttonData => {
                        const button = document.createElement('button');
                        button.classList = `pswp__button--custom round-button pswp__button--${buttonData.className}`;
                        button.setAttribute('aria-label', buttonData.label);
                        button.innerHTML = buttonData.icon;
                        button.onclick = buttonData.onClick;
                        bottomBar.appendChild(button);
                    });
                }
            });
        });

        // Set up event listener for slide changes to update button visibility
        lightbox.on('change', function() {
            const bottomBar = document.querySelector('.pswp__custom-bottom-bar');
            if (bottomBar && lightbox.pswp) {
                updateButtonVisibility(bottomBar, lightbox.pswp);
            }
        });

        // Initialize the lightbox
        lightbox.init();
        
        console.log('PhotoSwipe lightbox initialized successfully');
    } catch (error) {
        console.error('Failed to initialize PhotoSwipe:', error);
    }
}


// Function to open standalone PhotoSwipe instances
async function openStandalonePhotoSwipe(dataSource) {
    try {
        const PhotoSwipe = await import('/dist/photoswipe/photoswipe.esm.js');
        
        // Create PhotoSwipe instance with custom options
        const pswp = new PhotoSwipe.default({
            dataSource: dataSource,
            showHideAnimationType: 'zoom',
            showAnimationDuration: 300,
            hideAnimationDuration: 300,
            allowPanToNext: false, // No navigation for single images
            allowMouseDrag: true,
            allowTouchDrag: true,
            spacing: 0.1,
            loop: false,
            pinchToClose: true,
            closeOnScroll: false,
            closeOnVerticalDrag: true,
            wheelToZoom: true,
            escKey: true,
            arrowKeys: false, // No arrow keys for single images
            returnFocus: true,
            initalZoomLevel: 'fit',
            secondaryZoomLevel: 1,
            maxZoomLevel: 4,
            imageClickAction: 'zoom',
            tapAction: 'zoom',
            doubleTapAction: 'zoom',
            preloaderDelay: 2000,
            errorMsg: '<div class="pswp__error-msg">Image not found</div>',
            closeTitle: 'Close (Esc)',
            zoomTitle: 'Zoom in/out'
        });

        // Initialize and open
        pswp.init();
        
        // Listen for close event to clean up
        pswp.on('close', () => {
            pswp.destroy();
        });
        
    } catch (error) {
        console.error('Failed to open standalone PhotoSwipe:', error);
    }
}

// Show lightbox with PhotoSwipe
async function showLightbox(input) {
    if (!lightbox) {
        await initializePhotoSwipe();
    }

    let imageIndex = 0;
    let targetImage = null;

    // Handle different input types
    if (typeof input === 'number') {
        // Direct index provided
        imageIndex = input;
        if (imageIndex < 0 || imageIndex >= allImages.length) {
            console.error('Image index out of range:', imageIndex);
            return;
        }
        targetImage = allImages[imageIndex];
    } else if (typeof input === 'object' && input !== null) {
        // Object with filename, url, or element provided
        if (input.filename) {
            // Find by filename
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                // Search mode - use filtered results
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === input.filename || 
                        img.original === input.filename ||
                        img.filename === input.filename;
                });
            } else {
                // Normal mode - use current allImages
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === input.filename || 
                        img.original === input.filename ||
                        img.filename === input.filename;
                });
            }
        } else if (input.url) {
            // Standalone image URL - get dimensions if not provided
            if (!input.width || !input.height) {
                // Create a temporary image to get natural dimensions
                const tempImg = new Image();
                tempImg.onload = function() {
                    const standaloneData = [{
                        src: input.url,
                        width: input.width || tempImg.naturalWidth || 1024,
                        height: input.height || tempImg.naturalHeight || 1024,
                        data: {
                            filename: input.url,
                            base: input.url,
                            upscaled: input.url,
                            original: input.url,
                            isStandalone: true
                        }
                    }];
                    
                    // Use PhotoSwipe core directly for standalone images
                    openStandalonePhotoSwipe(standaloneData);
                };
                tempImg.onerror = function() {
                    // Fallback with default dimensions if image fails to load
                    const standaloneData = [{
                        src: input.url,
                        width: input.width || 1024,
                        height: input.height || 1024,
                        data: {
                            filename: input.url,
                            base: input.url,
                            upscaled: input.url,
                            original: input.url,
                            isStandalone: true
                        }
                    }];
                    
                    openStandalonePhotoSwipe(standaloneData);
                };
                tempImg.src = input.url;
                return;
            } else {
                // Dimensions provided, create data source immediately
                const standaloneData = [{
                    src: input.url,
                    width: input.width,
                    height: input.height,
                    data: {
                        filename: input.url,
                        base: input.url,
                        upscaled: input.url,
                        original: input.url,
                        isStandalone: true
                    }
                }];
                
                // Use PhotoSwipe core directly for standalone images
                openStandalonePhotoSwipe(standaloneData);
                return;
            }
        } else if (input.element) {
            // Check if element has data-file-index (gallery item)
            const fileIndex = input.element.getAttribute('data-file-index');
            if (fileIndex !== null) {
                imageIndex = parseInt(fileIndex, 10);
                if (imageIndex >= 0 && imageIndex < allImages.length) {
                    targetImage = allImages[imageIndex];
                } else {
                    imageIndex = -1;
                }
            } else {
                // Standalone element - try to extract image data
                const img = input.element.querySelector('img');
                if (img && img.src) {
                    const standaloneData = [{
                        src: img.src,
                        width: input.width || img.naturalWidth || 1024,
                        height: input.height || img.naturalHeight || 1024,
                        data: {
                            filename: img.src,
                            base: img.src,
                            upscaled: img.src,
                            original: img.src,
                            isStandalone: true
                        }
                    }];
                    
                    // Use PhotoSwipe core directly for standalone images
                    openStandalonePhotoSwipe(standaloneData);
                    return;
                } else {
                    imageIndex = -1;
                }
            }
        }

        if (imageIndex === -1) {
            console.error('Image not found in allImages array');
            return;
        }
        targetImage = allImages[imageIndex];
    } else {
        console.error('Invalid input to showLightbox:', input);
        return;
    }

    // Prepare data source for PhotoSwipe with proper dimensions from metadata
    const dataSource = allImages.map(img => {
        let filenameToShow = img.original;
        if (img.upscaled) {
            filenameToShow = img.upscaled;
        }

        // Get metadata for this image to get dimensions
        let width = 1024; // Default fallback
        let height = 1024; // Default fallback
        
        // Try to get dimensions from the image object if available
        if (img.metadata && img.metadata.width && img.metadata.height) {
            width = img.metadata.width;
            height = img.metadata.height;
        } else if (img.width && img.height) {
            width = img.width;
            height = img.height;
        }

        return {
            src: `/images/${filenameToShow}`,
            width: width,
            height: height,
            data: {
                filename: filenameToShow,
                base: img.base,
                upscaled: img.upscaled,
                original: img.original,
                metadata: img.metadata
            }
        };
    });

    // Update PhotoSwipe data source
    lightbox.loadAndOpen(imageIndex, dataSource);
}

// Hide lightbox (PhotoSwipe handles this automatically)
function hideLightbox() {
    if (lightbox && lightbox.pswp) {
        lightbox.pswp.close();
    }
}

// Navigate between images (PhotoSwipe handles this automatically)
function navigateLightbox(direction) {
    if (lightbox && lightbox.pswp) {
        if (direction > 0) {
            lightbox.pswp.next();
        } else {
            lightbox.pswp.prev();
        }
    }
}

// Update button states and functionality
function updateLightboxControls(image) {
    // This is now handled by PhotoSwipe UI elements
    // The buttons are automatically updated based on the current image
}

// Initialize PhotoSwipe when the page loads
window.wsClient.registerInitStep(36, 'Initializing PhotoSwipe Lightbox', async () => {
    await initializePhotoSwipe();
});

// Make functions globally available for compatibility
window.showLightbox = showLightbox;
window.hideLightbox = hideLightbox;
window.navigateLightbox = navigateLightbox;
window.updateLightboxControls = updateLightboxControls;