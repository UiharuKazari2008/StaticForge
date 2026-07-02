/**
 * Manual preview hub: blurred background, update/navigation, dialogs, workspace overlay, lightbox.
 * showManualPreview / hideManualPreview / registerManualPreviewEventListeners: manualModalManager.js
 * Wired via registerInitStep 471.
 */

// Manual preview image src lifecycle
function releaseManualPreviewElementImageSrc(img) {
    if (!img) return;
    img.onload = null;
    img.onerror = null;
    const src = img.currentSrc || img.src || '';
    if (src.startsWith('blob:')) {
        if (img.dataset.revokedBlobUrl !== src) {
            try {
                URL.revokeObjectURL(src);
            } catch (error) {
                // Blob may already be revoked elsewhere; idempotent release.
            }
            img.dataset.revokedBlobUrl = src;
        }
    }
    img.removeAttribute('src');
}

/** Revoke blob URLs only — keep data:/http preview visible until the next src finishes loading. */
function prepareManualPreviewSrcSwap(img) {
    if (!img) return;
    const src = img.currentSrc || img.src || '';
    if (src.startsWith('blob:')) {
        releaseManualPreviewElementImageSrc(img);
    }
}

function releaseManualPreviewOriginalImageSrc() {
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    if (!originalImage) return;
    releaseManualPreviewElementImageSrc(originalImage);
    originalImage.onclick = null;
}

let pendingManualPreviewBlobUrl = null;

function trackManualPreviewBlobUrl(url) {
    if (!url || !url.startsWith('blob:')) return;
    if (pendingManualPreviewBlobUrl && pendingManualPreviewBlobUrl !== url) {
        try {
            URL.revokeObjectURL(pendingManualPreviewBlobUrl);
        } catch (error) {
            // Blob may already be revoked elsewhere; idempotent release.
        }
    }
    pendingManualPreviewBlobUrl = url;
}

function releasePendingManualPreviewBlobUrl() {
    if (!pendingManualPreviewBlobUrl) return;
    try {
        URL.revokeObjectURL(pendingManualPreviewBlobUrl);
    } catch (error) {
        // Blob may already be revoked elsewhere; idempotent release.
    }
    pendingManualPreviewBlobUrl = null;
}

// Function to load temp image preview (from blueprint uploads)
function releaseManualPreviewImageSrc() {
    const previewImage = document.getElementById('manualPreviewImage');
    if (!previewImage) return;

    releaseManualPreviewElementImageSrc(previewImage);

    delete previewImage.dataset.blobUrl;
    delete previewImage.dataset.manualPreviewUrl;
    releasePendingManualPreviewBlobUrl();
}

/** Lightweight browse reference — full metadata lives on currentManualPreviewImage.metadata / IDB. */
function slimLastGenerationRef(metadata, imageObj) {
    if (!metadata && !imageObj) {
        return null;
    }
    const filename = imageObj?.filename
        || metadata?.filename
        || imageObj?.upscaled
        || imageObj?.original
        || metadata?.upscaled
        || metadata?.original;
    if (!filename) {
        return null;
    }
    return {
        filename,
        base: imageObj?.base || metadata?.base,
        original: imageObj?.original || metadata?.original,
        upscaled: imageObj?.upscaled || metadata?.upscaled,
        preview: imageObj?.preview || metadata?.preview,
        width: imageObj?.width || metadata?.width,
        height: imageObj?.height || metadata?.height
    };
}

async function loadTempImagePreview(previewUrl, imageData) {
    try {
        // Get the preview image element
        const previewImage = document.getElementById('manualPreviewImage');
        if (!previewImage) {
            console.warn('Preview image element not found');
            return;
        }

        releaseManualPreviewImageSrc();

        // Get the preview container
        const previewContainer = document.getElementById('manualPreviewContainer');
        if (!previewContainer) {
            console.warn('Preview container element not found');
            return;
        }

        // Hide the placeholder and show the image
        const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
        if (previewPlaceholder) {
            previewPlaceholder.classList.add('hidden');
        }

        // Set the image source and make it visible
        previewImage.src = previewUrl;
        if (previewUrl.startsWith('blob:')) {
            previewImage.dataset.blobUrl = previewUrl;
            if (pendingManualPreviewBlobUrl === previewUrl) {
                pendingManualPreviewBlobUrl = null;
            }
        }
        previewImage.classList.remove('hidden');

        // Add error handling for image loading
        previewImage.onerror = () => {
            console.error(`Failed to load image from: ${previewUrl}`);
            previewImage.classList.add('hidden');

            // Show placeholder instead
            if (previewPlaceholder) {
                previewPlaceholder.classList.remove('hidden');
                previewPlaceholder.innerHTML = `
                    <div class="manual-preview-placeholder">
                        <i class="mdi mdi-1-5 mdi-image-broken"></i>
                        <p>Failed to load image preview</p>
                    </div>
                `;
            }
        };

        // Show the preview section
        const previewSection = document.getElementById('manualPreviewSection');
        if (previewSection) {
            previewSection.classList.add('active');
            manualModal.classList.add('show-preview');
        }

        // Use the consolidated preview visibility system
        showManualPreview();

        // Ensure the image container has the proper classes for zoom functionality
        const imageContainer = previewContainer.querySelector('.manual-preview-image-container');
        if (imageContainer) {
            imageContainer.classList.add('initial');
            // Remove any existing zoom state
            imageContainer.classList.remove('zoomed');
        }

        // Initialize lightbox functionality for the temp image preview
        setTimeout(() => {
            initializeManualPreviewLightbox();
        }, 1000);

    } catch (error) {
        console.error('Error loading temp image preview:', error);
    }
}

// Background blur debounce (generation path uses updateBlurredBackground)
// Global background update state tracking
const backgroundUpdateState = {
    isAnimating: false,
    pendingRequest: null,
    lastRequest: null,
    animationPromise: null,
    callCount: 0,
    lastCallTime: 0
};

// Global debounced background update function
const updateBlurredBackground = createAnimationAwareDebounce(async (imageUrl) => {
    await updateManualPreviewBlurredBackground(imageUrl);
}, APP_CONSTANTS.TIMEOUT_FOCUS);

// Utility functions for background update management
function canUpdateBackground() {
    return !backgroundUpdateState.isAnimating;
}

function getPendingBackgroundRequest() {
    return backgroundUpdateState.pendingRequest;
}

function forceBackgroundUpdate(imageUrl) {
    // Cancel any pending animation and force immediate update
    if (backgroundUpdateState.animationPromise) {
        // We can't cancel the promise, but we can mark it as no longer needed
        backgroundUpdateState.pendingRequest = null;
    }

    // Clear any pending requests and force immediate execution
    backgroundUpdateState.pendingRequest = null;
    backgroundUpdateState.isAnimating = false;

    // Call the function directly for immediate update
    return updateManualPreviewBlurredBackground(imageUrl);
}

function cancelPendingBackgroundUpdates() {
    // Clear any pending background update requests
    backgroundUpdateState.pendingRequest = null;
    // Note: We can't cancel the current animation, but we can prevent new ones from queuing
}

function isBackgroundUpdateInProgress() {
    return backgroundUpdateState.isAnimating || !!backgroundUpdateState.pendingRequest;
}

function waitForBackgroundUpdateComplete() {
    if (backgroundUpdateState.animationPromise) {
        return backgroundUpdateState.animationPromise;
    }
    return Promise.resolve();
}

function getBackgroundUpdateStats() {
    return {
        totalCalls: backgroundUpdateState.callCount,
        lastCallTime: backgroundUpdateState.lastCallTime,
        isAnimating: backgroundUpdateState.isAnimating,
        hasPending: !!backgroundUpdateState.pendingRequest,
        lastRequest: backgroundUpdateState.lastRequest,
        pendingRequest: backgroundUpdateState.pendingRequest
    };
}

function resetBackgroundUpdateStats() {
    backgroundUpdateState.callCount = 0;
    backgroundUpdateState.lastCallTime = 0;
}

// Function to update blurred background for manual preview
async function updateManualPreviewBlurredBackground(imageUrl) {
    try {
        // Extract filename from imageUrl
        const filename = imageUrl.split('/').pop();
        const baseName = filename
            .replace(/\.(png|jpg|jpeg)$/i, '')
            .replace(/_upscaled$/, '');

        // Get the blurred preview URL - encode the baseName to handle spaces and special characters
        const blurPreviewUrl = `/previews/${encodeURIComponent(baseName)}@blur.webp`;

        // Check if the blurred preview exists
        try {
            const response = await fetch(blurPreviewUrl, {
                method: 'HEAD',
                cache: 'no-store'
            });
            if (!response.ok) {
                // Blurred preview doesn't exist, hide backgrounds
                const bg1 = document.getElementById('manualPreviewBlurBackground1');
                const bg2 = document.getElementById('manualPreviewBlurBackground2');
                if (bg1) bg1.style.opacity = '0';
                if (bg2) bg2.style.opacity = '0';
                return;
            }
        } catch (error) {
            // Blurred preview doesn't exist, hide backgrounds
            const bg1 = document.getElementById('manualPreviewBlurBackground1');
            const bg2 = document.getElementById('manualPreviewBlurBackground2');
            if (bg1) bg1.style.opacity = '0';
            if (bg2) bg2.style.opacity = '0';
            return;
        }

        // Get the two background containers
        const bg1 = document.getElementById('manualPreviewBlurBackground1');
        const bg2 = document.getElementById('manualPreviewBlurBackground2');

        if (!bg1 || !bg2) return;

        // Preload the image before applying it to prevent flashing
        const preloadImage = new Image();
        preloadImage.crossOrigin = 'anonymous';

        // Wait for the image to load completely
        await new Promise((resolve, reject) => {
            preloadImage.onload = resolve;
            preloadImage.onerror = reject;
            preloadImage.src = blurPreviewUrl;
        });
        preloadImage.onload = null;
        preloadImage.onerror = null;
        preloadImage.removeAttribute('src');

        // Determine which background is currently active
        // Check if either background has opacity > 0 (is visible)
        const bg1Opacity = parseFloat(bg1.style.opacity) || 0;
        const bg2Opacity = parseFloat(bg2.style.opacity) || 0;
        const activeBg = bg1Opacity > 0 ? bg1 : bg2;
        const inactiveBg = bg1Opacity > 0 ? bg2 : bg1;

        const bgUrl = `url("${blurPreviewUrl}")`;
        inactiveBg.setAttribute('style', `background-image: ${bgUrl}; opacity: 0;`);

        // Force a reflow to ensure the background image is applied before transition
        inactiveBg.offsetHeight;

        // Start the CSS transition by changing opacity values
        // The CSS transition: opacity 0.5s ease-in-out will handle the animation
        activeBg.style.opacity = '0';
        inactiveBg.style.opacity = '0.45';



        // Return a promise that resolves when the CSS transition completes
        return new Promise((resolve) => {
            // Wait for the CSS transition duration (500ms) plus a small buffer
            setTimeout(() => {
                // Clean up the old background image
                if (parseFloat(activeBg.style.opacity) === 0) {
                    activeBg.style.backgroundImage = 'none';

                }
                // refreshManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
                refreshManualPreviewImageLoupe();
                resolve();
            }, 550); // 500ms transition + 50ms buffer
        });

    } catch (error) {
        console.warn('Failed to update blurred background:', error);
        // On error, hide backgrounds to prevent showing broken images
        const bg1 = document.getElementById('manualPreviewBlurBackground1');
        const bg2 = document.getElementById('manualPreviewBlurBackground2');
        if (bg1) bg1.style.opacity = '0';
        if (bg2) bg2.style.opacity = '0';
        throw error; // Re-throw to maintain promise rejection
    }
}

// Render dialogs on image preview
function renderManualPreviewDialogs(dialogs, isGenerating = false) {
    const dialogContainer = document.getElementById('manualPreviewDialogs');
    if (!dialogContainer) return;

    // Clear existing dialogs
    dialogContainer.innerHTML = '';

    // If no dialogs, hide container and return
    if (!dialogs || dialogs.length === 0) {
        console.log('💬 No dialogs to render, hiding container');
        dialogContainer.classList.add('hidden');
        return;
    }

    console.log(`💬 Rendering ${dialogs.length} dialogs (${isGenerating ? 'generating' : 'navigating'} animation)`);

    // Show container
    dialogContainer.classList.remove('hidden');

    // Create dialog bubbles
    dialogs.forEach((dialog, index) => {
        const bubble = document.createElement('div');
        bubble.className = `dialog-bubble dialog-${dialog.type} align-${dialog.alignment}`;
        bubble.style.setProperty('--dialog-top', `${dialog.top}%`);
        bubble.style.setProperty('--dialog-left', `${dialog.left}%`);
        bubble.textContent = dialog.text;

        console.log(`💬 Dialog ${index + 1}: "${dialog.text}" at (${dialog.top}%, ${dialog.left}%) - ${dialog.type}`);

        // Add animation class based on context
        if (isGenerating) {
            bubble.classList.add('generating');
            // Stagger animation delays for generation
            bubble.style.animationDelay = `${index * 0.3}s`;
        } else {
            bubble.classList.add('navigating');
            // Faster stagger for navigation
            bubble.style.animationDelay = `${index * 0.1}s`;
        }

        dialogContainer.appendChild(bubble);
    });

    console.log(`💬 Successfully rendered ${dialogs.length} dialog bubbles`);
}

// Clear dialogs from preview
function clearManualPreviewDialogs() {
    const dialogContainer = document.getElementById('manualPreviewDialogs');
    if (dialogContainer) {
        dialogContainer.innerHTML = '';
        dialogContainer.classList.add('hidden');
    }
}

// Collect dialogs from metadata (main + pipeline stages)
function collectDialogsFromMetadata(metadata) {
    if (!metadata) return [];

    const allDialogs = [];
    const seenTimestamps = new Set();

    // Collect from main compiled_prompt (timestamp optional — dedupe key falls back so dialogs still count)
    const mainDialogs = metadata?.dynamic_generation?.compiled_prompt?.dialogs
        || window.dynamicGenerationData?.compiled_prompt?.dialogs;
    const mainTimestamp = metadata?.dynamic_generation?.compiled_prompt?.timestamp;
    if (mainDialogs && mainDialogs.length > 0) {
        const key = mainTimestamp ?? '__main__';
        if (!seenTimestamps.has(key)) {
            allDialogs.push(...mainDialogs);
            seenTimestamps.add(key);
        }
    }

    // Collect from pipeline stage seeds
    const stageSeeds = metadata?.forge_data?.stage_seeds;
    if (stageSeeds && Array.isArray(stageSeeds)) {
        stageSeeds.forEach((stageSeed, i) => {
            const stageDialogs = stageSeed?.dynamic_generation?.dialogs;
            const stageTimestamp = stageSeed?.dynamic_generation?.timestamp;

            if (stageDialogs && stageDialogs.length > 0) {
                const key = stageTimestamp ?? `stage:${i}`;
                if (!seenTimestamps.has(key)) {
                    allDialogs.push(...stageDialogs);
                    seenTimestamps.add(key);
                }
            }
        });
    }

    return allDialogs;
}

// Process dialog positions: force strict left/right columns with vertical stacking
function processDialogPositions(dialogs) {
    if (!dialogs || dialogs.length === 0) return [];

    // Simple column-based layout - no clustering allowed
    // Left column: 18%, Right column: 82%
    const leftColumn = 18;
    const rightColumn = 82;

    // Vertical spacing - account for bubble height (~8% per bubble with padding)
    const bubbleHeight = 8; // Approximate height percentage including padding
    const minVerticalGap = 2; // Minimum gap between bubbles
    const totalSlotHeight = bubbleHeight + minVerticalGap;

    // Split dialogs into two columns
    const leftDialogs = [];
    const rightDialogs = [];

    dialogs.forEach((dialog, index) => {
        if (index % 2 === 0) {
            leftDialogs.push(dialog);
        } else {
            rightDialogs.push(dialog);
        }
    });

    // Process left column
    const processedLeft = leftDialogs.map((dialog, index) => {
        // Stack vertically with proper spacing
        const verticalPosition = 10 + (index * totalSlotHeight);

        return {
            ...dialog,
            top: Math.min(90 - bubbleHeight, verticalPosition), // Don't exceed 90%
            left: leftColumn,
            alignment: 'left'
        };
    });

    // Process right column
    const processedRight = rightDialogs.map((dialog, index) => {
        // Stack vertically with proper spacing
        const verticalPosition = 10 + (index * totalSlotHeight);

        return {
            ...dialog,
            top: Math.min(90 - bubbleHeight, verticalPosition), // Don't exceed 90%
            left: rightColumn,
            alignment: 'right'
        };
    });

    // Interleave back together to maintain original order
    const result = [];
    const maxLength = Math.max(processedLeft.length, processedRight.length);
    for (let i = 0; i < maxLength; i++) {
        if (i < processedLeft.length) result.push(processedLeft[i]);
        if (i < processedRight.length) result.push(processedRight[i]);
    }

    return result;
}

// Function to update manual modal preview
async function updateManualPreview(index = 0, response = null, metadata = null) {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');


    try {
        if (previewImage && previewPlaceholder) {
            window.showManualPreviewNavigationLoading(true);
            // Get the image at the specified index
            let imageData = null;
            let imageUrl = null;

            if (response && response.headers) {
                // Server-saved image: always load via same-origin URL (service worker caches /images/)
                const generatedFilename = response.headers.get('X-Generated-Filename');
                if (generatedFilename) {
                    imageUrl = `/images/${generatedFilename}`;
                    imageData = {
                        original: generatedFilename,
                        base: generatedFilename,
                        upscaled: null
                    };
                }
            } else {
                // For existing images, request from server by index
                try {
                    const viewType = currentGalleryView || 'images';
                    imageData = await window.wsClient.requestImageByIndex(index, viewType);
                    if (imageData) {
                        const previewFilename = imageData.upscaled || imageData.original || imageData.filename;
                        imageUrl = previewFilename ? `/images/${previewFilename}` : null;
                    }
                } catch (error) {
                    console.warn('Failed to get image by index:', error);
                    return;
                }
            }

            if (!imageData || !imageUrl) {
                console.warn('No image data available for index:', index);
                return;
            }

            // Single load on preview element (avoids duplicate decode; SW handles /images/ cache)
            let imageWidth, imageHeight;
            previewImage.dataset.manualPreviewUrl = imageUrl;
            let timedOut = false;
            let trackedBlobUrl = null;
            const isGenerationFinalize = !!(response && response.headers);
            const contentLengthHeader = response?.headers?.get?.('Content-Length') || response?.headers?.get?.('content-length');
            const knownContentLength = parseInt(contentLengthHeader || '0', 10);
            const prefetchedBlobUrl = response?.prefetchedBlobUrl || null;
            const useTrackedFetch = !prefetchedBlobUrl && (
                isGenerationFinalize
                || (!!response && Number.isFinite(knownContentLength) && knownContentLength > 0)
            );

            if (isGenerationFinalize && previewImage.src) {
                previewImage.classList.remove('hidden');
                previewPlaceholder.classList.add('hidden');
            }

            const reportDownloadProgress = (progress) => {
                if (progress.total > 0) {
                    const pct = Math.min(100, Math.round(progress.ratio * 100));
                    const eta = progress.etaSeconds != null ? formatImageTransferEta(progress.etaSeconds) : '';
                    const sizeHint = progress.loaded > 0
                        ? ` · ${formatImageTransferBytes(progress.loaded)} / ${formatImageTransferBytes(progress.total)}`
                        : '';
                    const label = eta
                        ? `Downloading ${pct}% · ${eta}${sizeHint}`
                        : `Downloading ${pct}%${sizeHint}`;
                    showManualPreviewNavigationLoading(true, label, pct);
                } else if (progress.loaded > 0) {
                    const label = `Downloading ${formatImageTransferBytes(progress.loaded)}…`;
                    showManualPreviewNavigationLoading(true, label, 'indeterminate');
                } else {
                    showManualPreviewNavigationLoading(true, 'Downloading…', isGenerationFinalize ? 0 : null);
                }
            };

            const finalizeFetchInit = isGenerationFinalize
                ? { headers: { 'X-Preview-Finalize': '1' } }
                : {};

            if (useTrackedFetch) {
                try {
                    if (isGenerationFinalize) {
                        showManualPreviewNavigationLoading(true, 'Downloading…', knownContentLength > 0 ? 0 : 'indeterminate');
                    }
                    const fetchResult = await fetchTrackedImageBlob(imageUrl, knownContentLength, (progress) => {
                        if (isGenerationFinalize || progress.total > 0 || progress.loaded > 0) {
                            reportDownloadProgress(progress);
                        }
                    }, finalizeFetchInit);
                    if (fetchResult.objectUrl) {
                        trackedBlobUrl = fetchResult.objectUrl;
                        trackManualPreviewBlobUrl(trackedBlobUrl);
                        if (isGenerationFinalize && fetchResult.total > 0) {
                            showManualPreviewNavigationLoading(true, 'Processing image…', 100);
                        }
                    }
                } catch (fetchError) {
                    console.warn('Tracked generation result fetch failed, falling back to direct image load:', fetchError);
                    if (isGenerationFinalize) {
                        showManualPreviewNavigationLoading(true, 'Loading image…');
                    }
                }
            } else if (prefetchedBlobUrl) {
                trackedBlobUrl = prefetchedBlobUrl;
                trackManualPreviewBlobUrl(trackedBlobUrl);
            }

            const loadSrc = trackedBlobUrl || imageUrl;

            await new Promise((resolve, reject) => {
                let timeoutId;
                let settled = false;
                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    previewImage.onload = null;
                    previewImage.onerror = null;
                    if (generationAnimationActive && !manualForm?.classList.contains('generating')) {
                        stopPreviewAnimation();
                    }
                };
                const finish = () => {
                    if (settled) return;
                    // Ignore stale loads if a newer preview request repointed the element.
                    if (previewImage.dataset.manualPreviewUrl !== imageUrl) return;
                    settled = true;
                    imageWidth = previewImage.naturalWidth;
                    imageHeight = previewImage.naturalHeight;
                    previewImage.classList.remove('hidden');
                    previewPlaceholder.classList.add('hidden');
                    cleanup();
                    if (timedOut && imageWidth && imageHeight) {
                        sizeManualPreviewContainer(imageWidth, imageHeight);
                    }
                    resolve();
                };
                if (!isGenerationFinalize) {
                    timeoutId = setTimeout(() => {
                        if (settled) return;
                        timedOut = true;
                        resolve();
                    }, 10000);
                }
                prepareManualPreviewSrcSwap(previewImage);
                previewImage.onload = finish;
                previewImage.onerror = () => {
                    if (settled) return;
                    if (previewImage.dataset.manualPreviewUrl !== imageUrl) return;
                    settled = true;
                    cleanup();
                    reject(new Error('Failed to load image into DOM'));
                };
                previewImage.src = loadSrc;
                if (previewImage.decode) {
                    previewImage.decode().then(finish).catch(() => {
                        if (previewImage.complete && previewImage.naturalWidth > 0) {
                            finish();
                        }
                    });
                }
            });

            // If a newer preview request started while we waited, don't clobber UI state.
            if (previewImage.dataset.manualPreviewUrl !== imageUrl) return;
            if (!timedOut || isGenerationFinalize) {
                previewImage.classList.remove('hidden');
                previewPlaceholder.classList.add('hidden');
            } else {
                const hasVisiblePreview = Boolean(previewImage.src) && !previewImage.classList.contains('hidden');
                if (!hasVisiblePreview) {
                    previewImage.classList.add('hidden');
                    previewPlaceholder.classList.remove('hidden');
                }
            }

            // Preview URL for download/copy (same-origin /images/)
            previewImage.dataset.blobUrl = imageUrl;

            // Keep compare source layer ready for instant toggles
            const compareSourceImage = document.getElementById('manualPreviewCompareSourceImage');
            if (compareSourceImage && compareSourceImageData?.url) {
                prepareManualPreviewSrcSwap(compareSourceImage);
                compareSourceImage.src = compareSourceImageData.url;
                compareSourceImage.classList.remove('hidden');
            }

            // Apply dynamic container sizing based on image aspect ratio
            if (imageWidth && imageHeight) {
                sizeManualPreviewContainer(imageWidth, imageHeight);
            }

            // Update blurred background with debouncing
            // Always use the debounced version to prevent duplicate calls
            updateBlurredBackground(imageUrl);

            // Check if we have initialEdit data for side-by-side preview
            if (window.initialEdit && window.initialEdit.image) {
                // Show original image for comparison
                if (originalImage) {
                    const originalImageUrl = `/images/${window.initialEdit.image.original || window.initialEdit.image.filename}`;
                    releaseManualPreviewOriginalImageSrc();
                    originalImage.src = originalImageUrl;
                    originalImage.classList.remove('hidden');

                    // Add click handler to load original image into main preview
                    originalImage.onclick = function () {
                        swapManualPreviewImages();
                    };

                    // Enable dual mode
                    imageContainers.forEach(container => {
                        container.classList.add('dual-mode');
                    });
                }
            } else if (index !== 0) {
                // If we're navigating to a different image (not index 0), try to show last generation on the right
                // First, try to get the last generation from window.lastGeneration
                let lastGenImage = null;
                if (window.lastGeneration && window.lastGeneration.filename) {
                    lastGenImage = window.lastGeneration;
                } else if (allImages && allImages.length > 0) {
                    // If no lastGeneration, use the first image (index 0) as the "last generation"
                    lastGenImage = allImages[0];
                }

                if (lastGenImage && originalImage) {
                    const lastGenFilename = lastGenImage.original || lastGenImage.filename || lastGenImage.upscaled;
                    if (lastGenFilename) {
                        releaseManualPreviewOriginalImageSrc();
                        originalImage.src = `/images/${lastGenFilename}`;
                        originalImage.classList.remove('hidden');
                        originalImage.onclick = function () {
                            // When clicked, restore the original image
                            restoreOriginalImage();
                        };

                        // Enable dual mode
                        imageContainers.forEach(container => {
                            container.classList.add('dual-mode');
                        });
                    }
                }
            } else if (index === 0) {
                // For index 0, show the last generation on the right side if available
                let lastGenImage = null;
                if (window.lastGeneration && window.lastGeneration.filename) {
                    lastGenImage = window.lastGeneration;
                } else if (allImages && allImages.length > 0) {
                    // Use the first image as the "last generation"
                    lastGenImage = allImages[0];
                }

                if (lastGenImage && originalImage) {
                    const lastGenFilename = lastGenImage.original || lastGenImage.filename || lastGenImage.upscaled;
                    if (lastGenFilename) {
                        releaseManualPreviewOriginalImageSrc();
                        originalImage.src = `/images/${lastGenFilename}`;
                        originalImage.classList.remove('hidden');
                        originalImage.onclick = function () {
                            swapManualPreviewImages();
                        };

                        // Enable dual mode
                        imageContainers.forEach(container => {
                            container.classList.add('dual-mode');
                        });
                    } else {
                    }
                } else {
                }
            } else {
                // Single image mode
                if (originalImage) {
                    releaseManualPreviewOriginalImageSrc();
                    originalImage.classList.add('hidden');
                }
                imageContainers.forEach(container => {
                    container.classList.remove('dual-mode', 'original-hidden');
                });
            }

            // Set the current image and index
            window.currentManualPreviewImage = imageData;
            // Director new session functionality is always available
            window.currentManualPreviewIndex = index;

            // Keep Android persistent notification image in sync with the last preview
            updateAndroidNotificationImageFromCurrentPreview();

            // Use passed metadata if available, otherwise use metadata from imageData
            if (metadata) {
                imageData.metadata = metadata;
            } else if (imageData.metadata) {
                // Metadata already included from server
            } else if (imageData.original) {
                // Load metadata if not available
                try {
                    const loadedMetadata = await getImageMetadata(imageData.original);
                    imageData.metadata = loadedMetadata;
                } catch (error) {
                    console.warn('Failed to load metadata for image:', error);
                }
            }

            // Preview chrome uses .manual-preview-controls; CSS forces opacity 0 while #manualForm.generating — clear before toggles/dialogs run (finally runs later).
            if (response && manualForm?.classList.contains('generating')) {
                manualForm.classList.remove('generating');
            }

            // Show control buttons
            if (downloadBtn) downloadBtn.classList.remove('hidden');
            if (manualPreviewCopyBtn) manualPreviewCopyBtn.classList.remove('hidden');

            // Show upscale button only if upscaling is available for this resolution
            if (upscaleBtn) {
                upscaleBtn.classList.remove('hidden');
            }

            if (rerollBtn) rerollBtn.classList.remove('hidden');
            if (variationBtn) variationBtn.classList.remove('hidden');
            if (manualPreviewLoadBtn) manualPreviewLoadBtn.classList.remove('hidden');

            // Show and update pin button
            if (manualPreviewPinBtn) {
                manualPreviewPinBtn.classList.remove('hidden');
                if (window.currentManualPreviewImage) {
                    const filename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
                    if (filename) {
                        updatePinButtonAppearance(manualPreviewPinBtn, filename);
                    }
                }
            }

            const scrapBtn = document.getElementById('manualPreviewScrapBtn');
            if (scrapBtn) {
                scrapBtn.classList.remove('hidden');
                // Update scrap button based on current view
                if (currentGalleryView === 'scraps') {
                    scrapBtn.innerHTML = '<i class="nai-dot-reset"></i>';
                    scrapBtn.title = 'Remove from scraps';
                } else {
                    scrapBtn.innerHTML = '<i class="fas fa-bin-recycle"></i>';
                    scrapBtn.title = 'Move to scraps';
                }
            }
            if (deleteBtn) deleteBtn.classList.remove('hidden');

            // Show toggle dialogs button if image has dialogs
            if (manualPreviewToggleDialogsBtn) {
                const hasDialogs = collectDialogsFromMetadata(window.currentManualPreviewImage?.metadata).length > 0;
                if (hasDialogs) {
                    manualPreviewToggleDialogsBtn.classList.remove('hidden');
                    windowManualPreviewToggleDialogsBtn?.classList.remove('hidden');
                } else {
                    manualPreviewToggleDialogsBtn.classList.add('hidden');
                    windowManualPreviewToggleDialogsBtn?.classList.add('hidden');
                }
            }

            // Render character dialogs if available (single collector — collectDialogsFromMetadata)
            const stageSeedsForLog = window.currentManualPreviewImage?.metadata?.forge_data?.stage_seeds;
            let allDialogs = collectDialogsFromMetadata(window.currentManualPreviewImage?.metadata);
            allDialogs = processDialogPositions(allDialogs);

            console.log('💬 Checking for dialogs in updateManualPreview:', {
                hasImage: !!window.currentManualPreviewImage,
                hasMetadata: !!window.currentManualPreviewImage?.metadata,
                hasDynamicGen: !!window.currentManualPreviewImage?.metadata?.dynamic_generation,
                hasCompiledPrompt: !!window.currentManualPreviewImage?.metadata?.dynamic_generation?.compiled_prompt,
                hasStageSeeds: !!stageSeedsForLog,
                stageSeedsCount: stageSeedsForLog?.length || 0,
                totalDialogs: allDialogs.length,
                isResponse: !!response
            });

            if (allDialogs.length > 0) {
                // Check if dialogs should be visible (from toggle button state)
                const dialogsVisible = localStorage.getItem('dialogsVisible') !== 'off';

                if (dialogsVisible) {
                    // Check if this is a fresh generation (response parameter indicates new generation)
                    const isGenerating = !!response;
                    console.log(`💬 Found ${allDialogs.length} dialogs, rendering with isGenerating:`, isGenerating);
                    renderManualPreviewDialogs(allDialogs, isGenerating);
                } else {
                    console.log('💬 Dialogs hidden by toggle button');
                    clearManualPreviewDialogs();
                }
            } else {
                // Clear any existing dialogs
                console.log('💬 No dialogs found, clearing');
                clearManualPreviewDialogs();
            }

            // Initialize lightbox functionality
            setTimeout(() => {
                initializeManualPreviewLightbox();
            }, 100);

            if (response && imageWidth && imageHeight) {
                handleBracketGenCompareSourceAfterPreviewUpdate(metadata, response);
                maybeReplaceCompareSourceAfterResultDimensions(imageWidth, imageHeight);
                registerCompareBaselineFromCurrentPreview();
            }
            if (imageWidth && imageHeight) {
                maybeUpdateComparePresentationInhibitedFromPreviewDims(imageWidth, imageHeight);
            }
            updateCompareDisplayState();
            updateCompareControlsState();

            manualPreviewImage.title = ''; // Clear streaming title
            manualPreviewImage.style.width = '';
            manualPreviewImage.style.height = '';

            // Update seed display and add to history
            if (window.currentManualPreviewImage && window.currentManualPreviewImage.metadata && window.currentManualPreviewImage.metadata.seed !== undefined) {
                const seed = window.currentManualPreviewImage.metadata.seed;
                window.lastGeneratedSeed = seed;
                sproutSeedBtn.classList.add('available');
                updateSproutSeedButtonFromPreviewSeed();
                // Add seed to history if addSeedToHistory function exists
                addSeedToHistory(seed);
            } else {
                window.lastGeneratedSeed = null;
                sproutSeedBtn.classList.remove('available');
                updateSproutSeedButtonFromPreviewSeed();
            }
            if (window.currentManualPreviewImage) {
                window.lastGeneration = slimLastGenerationRef(
                    window.currentManualPreviewImage.metadata,
                    window.currentManualPreviewImage
                );
                // Director new session functionality is always available
            }

            refreshTextReplacementLockModalIfOpen();

            // Update navigation buttons
            updateManualPreviewNavigation();

            // refreshManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
            refreshManualPreviewImageLoupe();

            // Update Rentan overlay from current image metadata only (no stale session cache)
            const context = resolvePreviewRentanContext();
            updateRentanContextOverlay(context);

            // Update carousel with compiled prompt context if available
            if (context) {
                compiledContextData = context;
                carouselMode = 'compiled';
                updateDynamicCarousel(context, 'compiled');
            }
        }
    } finally {
        // Hide loading overlay if it was shown
        window.showManualPreviewNavigationLoading(false);
    }
}

// Function to update manual preview directly with image object (for search mode navigation)
async function updateManualPreviewDirectly(imageObj, metadata = null) {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');


    try {
        // Show loading overlay for direct preview updates
        window.showManualPreviewNavigationLoading(true);
        if (previewImage && previewPlaceholder) {
            // Construct image URL from the image object
            const imageUrl = `/images/${imageObj.upscaled || imageObj.original || imageObj.filename}`;

            let imageWidth, imageHeight;
            previewImage.dataset.manualPreviewUrl = imageUrl;
            let timedOut = false;
            await new Promise((resolve, reject) => {
                let timeoutId;
                let settled = false;
                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    previewImage.onload = null;
                    previewImage.onerror = null;
                    if (generationAnimationActive && !manualForm?.classList.contains('generating')) {
                        stopPreviewAnimation();
                    }
                };
                const finish = () => {
                    if (settled) return;
                    // Ignore stale loads if a newer preview request repointed the element.
                    if (previewImage.dataset.manualPreviewUrl !== imageUrl) return;
                    settled = true;
                    imageWidth = previewImage.naturalWidth;
                    imageHeight = previewImage.naturalHeight;
                    // If we already timed out, swap from placeholder to the loaded image now.
                    previewImage.classList.remove('hidden');
                    previewPlaceholder.classList.add('hidden');
                    cleanup();
                    // If the editor continued after timeout, apply sizing once the image finally loads.
                    if (timedOut && imageWidth && imageHeight) {
                        sizeManualPreviewContainer(imageWidth, imageHeight);
                    }
                    resolve();
                };
                timeoutId = setTimeout(() => {
                    if (settled) return;
                    // Don't reject here: allow the rest of the editor to keep loading.
                    // Keep the load/error handlers active so the image can still load later.
                    timedOut = true;
                    resolve();
                }, 10000);
                prepareManualPreviewSrcSwap(previewImage);
                previewImage.onload = finish;
                previewImage.onerror = () => {
                    if (settled) return;
                    // Ignore stale errors if a newer preview request repointed the element.
                    if (previewImage.dataset.manualPreviewUrl !== imageUrl) return;
                    settled = true;
                    cleanup();
                    reject(new Error('Failed to load image into DOM'));
                };
                previewImage.src = imageUrl;
                if (previewImage.decode) {
                    previewImage.decode().then(finish).catch(() => {
                        if (previewImage.complete && previewImage.naturalWidth > 0) {
                            finish();
                        }
                    });
                }
            });

            // If a newer preview request started while we waited, don't clobber UI state.
            if (previewImage.dataset.manualPreviewUrl !== imageUrl) return;
            if (!timedOut) {
                previewImage.classList.remove('hidden');
                previewPlaceholder.classList.add('hidden');
            } else {
                // Keep the placeholder visible until the image finishes loading in the background.
                previewImage.classList.add('hidden');
                previewPlaceholder.classList.remove('hidden');
            }

            previewImage.dataset.blobUrl = imageUrl;

            // Keep compare source layer ready for instant toggles
            const compareSourceImage = document.getElementById('manualPreviewCompareSourceImage');
            if (compareSourceImage && compareSourceImageData?.url) {
                prepareManualPreviewSrcSwap(compareSourceImage);
                compareSourceImage.src = compareSourceImageData.url;
                compareSourceImage.classList.remove('hidden');
            }

            // Apply dynamic container sizing based on image aspect ratio
            if (imageWidth && imageHeight) {
                sizeManualPreviewContainer(imageWidth, imageHeight);
            }

            // Update blurred background
            updateBlurredBackground(imageUrl);

            // Set the current image
            window.swapGeneratedPreviewState = null;
            window.currentManualPreviewImage = imageObj;
            if (metadata) {
                window.currentManualPreviewImage.metadata = metadata;
            }
            // Metadata must be provided - no fallbacks
            if (!metadata) {
                const filename = imageObj.filename || imageObj.upscaled || imageObj.original;
                showGlassToast('error', 'Metadata Error', `Cannot update preview: metadata is required for image ${filename || 'unknown'}`, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
            }
            window.lastGeneration = slimLastGenerationRef(metadata, imageObj);
            updateAndroidNotificationImageFromCurrentPreview();
            // Director new session functionality is always available

            // Try to find the index of this image in the gallery
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                // Search mode - use filtered results
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === imageObj.upscaled ||
                        img.original === imageObj.original ||
                        img.filename === imageObj.filename;
                });
            } else if (allImages && allImages.length > 0) {
                // Normal mode - use current allImages
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === imageObj.upscaled ||
                        img.original === imageObj.original ||
                        img.filename === imageObj.filename;
                });
            }

            // Update the current index (use found index or keep as -1 if not found)
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;

            // Use passed metadata if available
            if (metadata) {
                imageObj.metadata = metadata;
            }

            // Show control buttons
            if (downloadBtn) downloadBtn.classList.remove('hidden');
            if (manualPreviewCopyBtn) manualPreviewCopyBtn.classList.remove('hidden');

            // Show upscale button only if upscaling is available for this resolution
            if (upscaleBtn) {
                upscaleBtn.classList.remove('hidden');
            }

            if (rerollBtn) rerollBtn.classList.remove('hidden');
            if (variationBtn) variationBtn.classList.remove('hidden');
            if (manualPreviewLoadBtn) manualPreviewLoadBtn.classList.remove('hidden');

            // Show and update pin button
            if (manualPreviewPinBtn) {
                manualPreviewPinBtn.classList.remove('hidden');
                if (window.currentManualPreviewImage) {
                    const filename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
                    if (filename) {
                        updatePinButtonAppearance(manualPreviewPinBtn, filename);
                    }
                }
            }

            const scrapBtn = document.getElementById('manualPreviewScrapBtn');
            if (scrapBtn) {
                scrapBtn.classList.remove('hidden');
                // Update scrap button based on current view
                if (currentGalleryView === 'scraps') {
                    scrapBtn.innerHTML = '<i class="nai-dot-reset"></i>';
                    scrapBtn.title = 'Remove from scraps';
                } else {
                    scrapBtn.innerHTML = '<i class="fas fa-bin-recycle"></i>';
                    scrapBtn.title = 'Move to scraps';
                }
            }
            if (deleteBtn) deleteBtn.classList.remove('hidden');

            // Render character dialogs if available (for direct preview updates)
            let allDialogsDirect = collectDialogsFromMetadata(window.currentManualPreviewImage?.metadata);
            allDialogsDirect = processDialogPositions(allDialogsDirect);

            if (allDialogsDirect.length > 0) {
                // Check if dialogs should be visible (from toggle button state)
                const dialogsVisibleDirect = localStorage.getItem('dialogsVisible') !== 'off';

                if (dialogsVisibleDirect) {
                    // Use navigating animation for direct updates (not fresh generation)
                    renderManualPreviewDialogs(allDialogsDirect, false);
                } else {
                    clearManualPreviewDialogs();
                }
            } else {
                // Clear any existing dialogs
                clearManualPreviewDialogs();
            }

            // Initialize lightbox functionality
            setTimeout(() => {
                initializeManualPreviewLightbox();
            }, 100);

            updateCompareDisplayState();
            updateCompareControlsState();
            if (typeof imageWidth === 'number' && typeof imageHeight === 'number') {
                maybeUpdateComparePresentationInhibitedFromPreviewDims(imageWidth, imageHeight);
            }

            // Update seed display
            if (window.currentManualPreviewImage && window.currentManualPreviewImage.metadata && window.currentManualPreviewImage.metadata.seed !== undefined) {
                window.lastGeneratedSeed = window.currentManualPreviewImage.metadata.seed;
                sproutSeedBtn.classList.add('available');
                updateSproutSeedButtonFromPreviewSeed();
            } else {
                window.lastGeneratedSeed = null;
                sproutSeedBtn.classList.remove('available');
                updateSproutSeedButtonFromPreviewSeed();
            }

            // Update navigation buttons
            updateManualPreviewNavigation();

            // refreshManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
            refreshManualPreviewImageLoupe();

            // Update Rentan overlay from current image metadata only (no stale session cache)
            const context = resolvePreviewRentanContext();
            updateRentanContextOverlay(context);

            // Update carousel with compiled prompt context if available
            if (context) {
                compiledContextData = context;
                carouselMode = 'compiled';
                updateDynamicCarousel(context, 'compiled');
            }
        }
    } finally {
        // Hide loading overlay if it was shown
        window.showManualPreviewNavigationLoading(false);
    }
}

// Function to handle image swapping in manual preview
function swapManualPreviewImages() {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');

    if (!previewImage || !originalImage || !imageContainers || !window.lastGeneration || !window.initialEdit) return;

    // Check if we're currently showing the original image
    if (Array.from(imageContainers).some(container => container.classList.contains('swapped'))) {
        // Switch back to generated image
        if (window.lastGeneration && window.lastGeneration.filename) {
            const generatedImageUrl = `/images/${window.lastGeneration.filename}`;
            releaseManualPreviewImageSrc();
            previewImage.dataset.manualPreviewUrl = generatedImageUrl;
            previewImage.src = generatedImageUrl;

            // Update blurred background
            updateBlurredBackground(generatedImageUrl);

            const swapState = window.swapGeneratedPreviewState;
            if (swapState && swapState.image) {
                window.currentManualPreviewImage = swapState.image;
                if (swapState.seed != null && swapState.seed !== undefined) {
                    window.lastGeneratedSeed = swapState.seed;
                }
            } else {
                const filename = window.lastGeneration.filename;
                let restoredImage = null;
                const gallerySource = (window.originalAllImages && window.originalAllImages.length > 0)
                    ? window.originalAllImages
                    : allImages;
                if (gallerySource && gallerySource.length > 0) {
                    restoredImage = gallerySource.find(img =>
                        img.filename === filename || img.original === filename || img.upscaled === filename
                    ) || null;
                }
                window.currentManualPreviewImage = restoredImage || {
                    ...window.lastGeneration,
                    filename
                };
            }
            updateSproutSeedButtonFromPreviewSeed();
            // Director new session functionality is always available
            // Try to find the index of the generated image
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === window.lastGeneration.filename ||
                        img.original === window.lastGeneration.filename;
                });
            } else if (allImages && allImages.length > 0) {
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === window.lastGeneration.filename ||
                        img.original === window.lastGeneration.filename;
                });
            }
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;
        }
        imageContainers.forEach(container => {
            container.classList.remove('swapped');
        });
    } else {
        // Switch to original image
        if (window.initialEdit && window.initialEdit.image) {
            const originalImageUrl = `/images/${window.initialEdit.image.upscaled || window.initialEdit.image.original}`;
            releaseManualPreviewImageSrc();
            previewImage.dataset.manualPreviewUrl = originalImageUrl;
            previewImage.src = originalImageUrl;
            updateSproutSeedButtonFromPreviewSeed();

            // Update blurred background
            updateBlurredBackground(originalImageUrl);

            window.swapGeneratedPreviewState = {
                image: window.currentManualPreviewImage,
                seed: window.lastGeneratedSeed
            };
            // Update global variables to reflect the original image
            window.currentManualPreviewImage = window.initialEdit.image;
            // Director new session functionality is always available
            // Try to find the index of the original image
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === window.initialEdit.image.upscaled ||
                        img.original === window.initialEdit.image.original;
                });
            } else if (allImages && allImages.length > 0) {
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === window.initialEdit.image.upscaled ||
                        img.original === window.initialEdit.image.original;
                });
            }
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;
        }
        imageContainers.forEach(container => {
            container.classList.add('swapped');
        });
    }
}

// Function to reset manual modal preview
function resetManualPreview() {
    const previewImage = document.getElementById('manualPreviewImage');
    const originalImage = document.getElementById('manualPreviewOriginalImage');
    const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
    const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');
    const downloadBtn = document.getElementById('manualPreviewDownloadBtn');
    const upscaleBtn = document.getElementById('manualPreviewUpscaleBtn');
    const rerollBtn = document.getElementById('manualPreviewRerollBtn');
    const variationBtn = document.getElementById('manualPreviewVariationBtn');
    const deleteBtn = document.getElementById('manualPreviewDeleteBtn');

    if (previewImage && previewPlaceholder) {
        releaseManualPreviewImageSrc();
        releaseVariationImageSrc();

        // Hide the image and show placeholder
        previewImage.classList.add('hidden');
        previewPlaceholder.classList.remove('hidden');

        // Hide original image and reset dual mode
        if (originalImage) {
            releaseManualPreviewOriginalImageSrc();
            originalImage.classList.add('hidden');
        }
        if (imageContainers) {
            imageContainers.forEach(container => {
                container.classList.remove('dual-mode', 'original-hidden', 'swapped');
            });
        }

        // Hide control buttons
        if (downloadBtn) downloadBtn.classList.add('hidden');
        if (manualPreviewCopyBtn) manualPreviewCopyBtn.classList.add('hidden');
        if (upscaleBtn) upscaleBtn.classList.add('hidden');
        if (rerollBtn) rerollBtn.classList.add('hidden');
        if (variationBtn) variationBtn.classList.add('hidden');
        if (manualPreviewLoadBtn) manualPreviewLoadBtn.classList.add('hidden');
        if (manualPreviewPinBtn) manualPreviewPinBtn.classList.add('hidden');
        const scrapBtn = document.getElementById('manualPreviewScrapBtn');
        if (scrapBtn) scrapBtn.classList.add('hidden');
        if (deleteBtn) deleteBtn.classList.add('hidden');
        hideManualPreview();

        // Clear stored seed and current image
        window.lastGeneratedSeed = null;
        window.lastGeneration = null;
        window.lastGeneratedImageName = null;
        sproutSeedBtn.classList.remove('available');
        updateSproutSeedButtonFromPreviewSeed();
        window.currentManualPreviewImage = null;
        window.currentManualPreviewIndex = null;
        window.swapGeneratedPreviewState = null;
        // Director new session functionality is always available

        // Clear generated image name display
        updateGeneratedImageNameDisplay(null);

        // Reset blurred backgrounds
        const bg1 = document.getElementById('manualPreviewBlurBackground1');
        const bg2 = document.getElementById('manualPreviewBlurBackground2');
        if (bg1) {
            bg1.style.backgroundImage = 'none';
            bg1.style.opacity = '0';
        }
        if (bg2) {
            bg2.style.backgroundImage = 'none';
            bg2.style.opacity = '0';
        }

        // Disable navigation buttons
        updateManualPreviewNavigation();

        // refreshManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
        refreshManualPreviewImageLoupe();

        clearManualRentanContextOverlay();

        // Force preview animation back to default state
        if (generationAnimationActive) {
            stopPreviewAnimation();
        }
        // Ensure animation container is reset to default state
        if (previewContainer) {
            previewContainer.classList.remove('preview-animation-active', 'preview-fade-out', 'preview-foreground-lines-active');
        }
        if (previewStars) {
            previewStars.classList.add('hidden');
            previewStars.style.opacity = '0';
        }
        if (previewBackgroundLines) {
            previewBackgroundLines.classList.add('hidden');
            previewBackgroundLines.classList.remove('fadeOut');
        }
        if (previewForegroundLines) {
            previewForegroundLines.classList.add('hidden');
            previewForegroundLines.classList.remove('fadeOut');
        }
        clearCompareSourceImage();
    }
}

function resolveManualPreviewGalleryIndex() {
    if (!window.currentManualPreviewImage || !allImages || allImages.length === 0) {
        return -1;
    }

    const currentFilename = window.currentManualPreviewImage.original
        || window.currentManualPreviewImage.filename
        || window.currentManualPreviewImage.upscaled;
    const storedIndex = window.currentManualPreviewIndex;

    if (typeof storedIndex === 'number' && storedIndex >= 0 && storedIndex < allImages.length) {
        const storedImg = allImages[storedIndex];
        const storedFilename = storedImg?.filename || storedImg?.original || storedImg?.upscaled;
        if (storedFilename === currentFilename) {
            return storedIndex;
        }
        const meta = window.currentManualPreviewImage.metadata || window.lastGeneration;
        const expansionSource = meta?.forge_data?.expansion_source;
        if (expansionSource && storedFilename === expansionSource) {
            return storedIndex;
        }
    }

    const galleryIndex = findTrueImageIndexInGallery(currentFilename);
    if (galleryIndex !== -1) {
        return galleryIndex;
    }

    const lastGenFilename = window.lastGeneration?.filename || window.lastGeneration?.original;
    if (lastGenFilename && lastGenFilename === currentFilename) {
        return 0;
    }

    return -1;
}

// Function to update manual preview navigation buttons
function updateManualPreviewNavigation() {
    const prevBtn = document.getElementById('manualPreviewPrevBtn');
    const nextBtn = document.getElementById('manualPreviewNextBtn');

    if (!prevBtn || !nextBtn) return;

    // Disable both buttons if no current image or no gallery
    if (!window.currentManualPreviewImage || !allImages || allImages.length === 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    const currentIndex = resolveManualPreviewGalleryIndex();

    if (currentIndex === -1) {
        // Current image not found in gallery, disable both buttons
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    if (window.currentManualPreviewIndex !== currentIndex) {
        window.currentManualPreviewIndex = currentIndex;
    }

    // Enable/disable buttons based on position
    prevBtn.disabled = currentIndex === 0; // Disable if first image
    nextBtn.disabled = currentIndex === allImages.length - 1; // Disable if last image
}
// Function to navigate manual preview
async function navigateManualPreview(event) {
    const direction = event.currentTarget.id === 'manualPreviewPrevBtn' ? -1 : 1;
    if (!window.currentManualPreviewImage) return;
    // Use WebSocket to get image by index
    if (!window.wsClient || !window.wsClient.isConnected()) {
        throw new Error('WebSocket not connected');
    }

    try {
        // Show navigation loading overlay
        showManualPreviewNavigationLoading(true);

        // Get current view type based on current gallery view
        const viewType = currentGalleryView || 'images';

        // Determine navigation approach based on search mode
        let newImage, newIndex;

        if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
            // We're in search mode - navigate through filtered results (same logic as lightbox)
            const currentFilename = window.currentManualPreviewImage.original || window.currentManualPreviewImage.filename;

            // Use the filtered allImages array for navigation (this contains the filtered results)
            const navigationArray = allImages;
            const currentImageIndex = navigationArray.findIndex(img => {
                const imgFilename = img.filename || img.original || img.upscaled;
                return imgFilename === currentFilename;
            });

            if (currentImageIndex === -1) {
                console.warn('Current image not found in filtered results');
                showManualPreviewNavigationLoading(false);
                return;
            }

            // Calculate new index within the filtered results
            let newIndex = currentImageIndex + direction;

            // Handle wrapping within filtered results
            if (newIndex < 0) {
                newIndex = navigationArray.length - 1;
            } else if (newIndex >= navigationArray.length) {
                newIndex = 0;
            }

            // Get the new image from the filtered results
            const newImageObj = navigationArray[newIndex];
            if (!newImageObj) {
                console.warn('No image found at filtered index:', newIndex);
                showManualPreviewNavigationLoading(false);
                return;
            }

            // Construct the image object for the preview (same as lightbox)
            let filenameToShow = newImageObj.original;
            if (newImageObj.upscaled) {
                filenameToShow = newImageObj.upscaled;
            }

            const imageToShow = {
                filename: filenameToShow,
                base: newImageObj.base,
                upscaled: newImageObj.upscaled,
                metadata: newImageObj.metadata
            };

            // Update the preview with the new image directly (like lightbox does)
            await updateManualPreviewDirectly(imageToShow, newImageObj.metadata);

        } else {
            // Normal mode - use WebSocket API with global indices
            const currentIndex = resolveManualPreviewGalleryIndex();
            if (currentIndex === -1) {
                console.warn('Current image not found in gallery');
                showManualPreviewNavigationLoading(false);
                return;
            }
            newIndex = currentIndex + direction;

            // Check for negative index
            if (newIndex < 0) {
                console.warn('Cannot navigate before first image');
                showManualPreviewNavigationLoading(false);
                return;
            }

            // Request the image at the new index from the server
            newImage = await window.wsClient.requestImageByIndex(newIndex, viewType);

            if (!newImage) {
                console.warn('No image found at index:', newIndex);
                showManualPreviewNavigationLoading(false);
                return;
            }

            // Update the current index
            window.currentManualPreviewIndex = newIndex;
            window.currentManualPreviewImage = newImage;
            // Director new session functionality is always available

            // Update the preview with the new image and metadata
            await updateManualPreview(newIndex, null, newImage.metadata);
        }

        // Check if we're navigating to index 0 (last generation) or a different image
        // Note: In search mode, index 0 refers to the first filtered result, not necessarily the global first image
        if (newIndex === 0 && !window.originalAllImages) {
            // For global index 0 in normal mode, switch preview to the right side (last generation is always on the right)
            // Clear any stored navigation original image since we're back to the main image
            window.navigationOriginalImage = null;

            // Remove swapped state to show the main image on the right
            document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(container => {
                container.classList.remove('swapped');
            });
        } else {
            // For other indices or in search mode, move placeholder to left side and show last generation on right
            // First, store the current image as the "original" for comparison
            if (window.currentManualPreviewImage) {
                window.navigationOriginalImage = {
                    image: window.currentManualPreviewImage,
                    seed: window.currentManualPreviewImage.metadata?.seed
                };
            }

            // Mark as swapped to show the new image on the left
            document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(container => {
                container.classList.add('swapped');
            });
        }

    } catch (error) {
        console.error('Failed to navigate manual preview:', error);
        showError('Failed to navigate to next image: ' + error.message);
    } finally {
        // Hide navigation loading overlay
        showManualPreviewNavigationLoading(false);
    }
}

// Function to restore the original image when navigating back
async function restoreOriginalImage() {
    if (window.navigationOriginalImage) {
        const previewImage = document.getElementById('manualPreviewImage');
        const originalImage = document.getElementById('manualPreviewOriginalImage');
        const imageContainers = document.querySelectorAll('.manual-preview-image-container, #manualPanelSection');

        if (previewImage && originalImage) {
            // Restore the original image to the main preview
            const imageUrl = `/images/${window.navigationOriginalImage.image.original || window.navigationOriginalImage.image.filename}`;
            releaseManualPreviewImageSrc();
            previewImage.dataset.manualPreviewUrl = imageUrl;
            previewImage.src = imageUrl;

            // Update blurred background
            updateBlurredBackground(imageUrl);

            // Update the seed display to show the original image's seed
            if (window.navigationOriginalImage.seed) {
                window.lastGeneratedSeed = window.navigationOriginalImage.seed;
                sproutSeedBtn.classList.add('available');
            } else {
                window.lastGeneratedSeed = null;
                sproutSeedBtn.classList.remove('available');
            }
            updateSproutSeedButtonFromPreviewSeed();

            window.currentManualPreviewImage = window.navigationOriginalImage.image;
            if (window.navigationOriginalImage.image.filename) {
                let metadata = window.navigationOriginalImage.image.metadata || null;
                try {
                    const fetched = await getImageMetadata(window.navigationOriginalImage.image.filename);
                    if (fetched) {
                        metadata = fetched;
                    }
                } catch (error) {
                    console.warn('Failed to load metadata for restored image:', error);
                }
                window.currentManualPreviewImage.metadata = metadata || {};
                window.lastGeneration = slimLastGenerationRef(
                    window.currentManualPreviewImage.metadata,
                    window.currentManualPreviewImage
                );
            } else {
                window.currentManualPreviewImage.metadata = window.navigationOriginalImage.image.metadata || {};
            }

            // Remove swapped state to show original image on the right
            imageContainers.forEach(container => {
                container.classList.remove('swapped');
            });

            // Director new session functionality is always available
            // Try to find the index of the restored image
            let imageIndex = -1;
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === window.navigationOriginalImage.image.upscaled ||
                        img.original === window.navigationOriginalImage.image.original ||
                        img.filename === window.navigationOriginalImage.image.filename;
                });
            } else if (allImages && allImages.length > 0) {
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === window.navigationOriginalImage.image.upscaled ||
                        img.original === window.navigationOriginalImage.image.original ||
                        img.filename === window.navigationOriginalImage.image.filename;
                });
            }
            window.currentManualPreviewIndex = imageIndex !== -1 ? imageIndex : null;

            // Clear the stored navigation original image
            window.navigationOriginalImage = null;
        }
    }
}

function initializeManualPreviewLightbox() {
    const imageContainer = document.querySelector('.manual-preview-image-container');
    const image = document.getElementById('manualPreviewImage');

    if (!imageContainer || !image) return;

    // Only register event listeners if there's actually an image to preview
    if (window.currentManualPreviewImage && !image.classList.contains('hidden')) {
        registerManualPreviewEventListeners();
    } else {
        // Deregister event listeners if there's no image to prevent errors
        deregisterManualPreviewEventListeners();
    }
}

// Prevent multiple lightbox openings
let isOpeningLightbox = false;

function handleManualPreviewClick(e) {
    e.preventDefault();

    // If this click follows a compare drag gesture, suppress lightbox open.
    if (suppressNextPreviewClick || compareDragMoved) {
        return;
    }

    // Prevent multiple rapid calls
    if (isOpeningLightbox) {
        return;
    }

    // Check if we have a current manual preview image
    if (!window.currentManualPreviewImage) {
        console.warn('No current manual preview image to open in lightbox');
        return;
    }

    // Check if the image is actually visible
    const image = document.getElementById('manualPreviewImage');
    if (!image || image.classList.contains('hidden')) {
        console.warn('Preview image is not visible');
        return;
    }

    // Use the current manual preview index that was set by the update functions
    let imageIndex = window.currentManualPreviewIndex;

    // If we have a valid index, use it directly (trust the update functions)
    if (imageIndex !== null && imageIndex !== undefined && imageIndex >= 0) {
        // Open lightbox with the index set by the update functions
        if (window.showLightbox) {
            isOpeningLightbox = true;
            try {
                window.showLightbox(imageIndex);
            } finally {
                // Reset flag after a delay to allow lightbox to open
                setTimeout(() => {
                    isOpeningLightbox = false;
                }, 1000);
            }
        } else {
            console.warn('showLightbox function not available');
        }
    } else {
        // If no valid index, try to find the image by filename in the gallery
        let foundIndex = -1;

        if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
            // Search mode - use filtered results
            foundIndex = window.originalAllImages.findIndex(img => {
                return img.upscaled === window.currentManualPreviewImage.upscaled ||
                    img.original === window.currentManualPreviewImage.original ||
                    img.filename === window.currentManualPreviewImage.filename;
            });
        } else if (allImages && allImages.length > 0) {
            // Normal mode - use current allImages
            foundIndex = allImages.findIndex(img => {
                return img.upscaled === window.currentManualPreviewImage.upscaled ||
                    img.original === window.currentManualPreviewImage.original ||
                    img.filename === window.currentManualPreviewImage.filename;
            });
        }

        if (foundIndex !== -1) {
            // Found the image in the gallery, open lightbox at that index
            if (window.showLightbox) {
                isOpeningLightbox = true;
                try {
                    window.showLightbox(foundIndex);
                } finally {
                    // Reset flag after a delay to allow lightbox to open
                    setTimeout(() => {
                        isOpeningLightbox = false;
                    }, 1000);
                }
            } else {
                console.warn('showLightbox function not available');
            }
        } else {
            // Image not found in gallery, open as standalone image
            if (window.showLightbox) {
                const imageUrl = window.currentManualPreviewImage.upscaled ||
                    window.currentManualPreviewImage.original ||
                    window.currentManualPreviewImage.filename;
                isOpeningLightbox = true;
                try {
                    window.showLightbox({ url: `/images/${imageUrl}` });
                } finally {
                    // Reset flag after a delay to allow lightbox to open
                    setTimeout(() => {
                        isOpeningLightbox = false;
                    }, 1000);
                }
            } else {
                console.warn('showLightbox function not available');
            }
        }
    }
}

// Throttle scroll events to prevent rapid-fire calls
let lastOpenLightboxScrollTime = 0;
const SCROLL_THROTTLE_MS = 500; // 500ms throttle

function handleManualPreviewScroll(e) {
    // Only trigger on scroll up (negative deltaY)
    if (e.deltaY < 0) {
        e.preventDefault();

        // Throttle scroll events to prevent rapid calls
        const now = Date.now();
        if (now - lastOpenLightboxScrollTime < SCROLL_THROTTLE_MS) {
            return; // Skip if called too recently
        }
        lastOpenLightboxScrollTime = now;

        // Use a small delay to ensure scroll event has settled
        setTimeout(() => {
            handleManualPreviewClick(e);
        }, 100);
    }
}

// Workspace Image Overlay Functions
function showWorkspaceImageOverlay() {
    const overlay = document.getElementById('manualPreviewWorkspaceOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('visible');
        }, 1);
        loadWorkspaceImagesForOverlay();
    }
}

function hideWorkspaceImageOverlay() {
    const overlay = document.getElementById('manualPreviewWorkspaceOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 850);
    }
}

async function loadWorkspaceImagesForOverlay() {
    const grid = document.getElementById('workspaceImageGrid');
    const empty = document.getElementById('workspaceImageEmpty');

    if (!grid || !empty) return;

    // Show loading
    grid.innerHTML = '';
    empty.classList.add('hidden');

    try {
        // Use the existing allImages array from the gallery instead of making a new request
        const galleryData = allImages || [];

        if (galleryData && galleryData.length > 0) {
            // Hide loading and empty states
            empty.classList.add('hidden');

            // Create image items
            galleryData.forEach((image, index) => {
                const imageItem = document.createElement('div');
                imageItem.className = 'workspace-image-item';
                imageItem.dataset.imageIndex = index;

                const img = document.createElement('img');
                // Use preview image for thumbnails
                if (image.preview) {
                    img.src = `/previews/${encodeURIComponent(window.deviceUtils.getGalleryPreviewUrl(image.preview))}`;
                } else {
                    // Fallback to full image if no preview available
                    img.src = `/images/${image.upscaled || image.original || image.filename}`;
                }
                img.alt = image.prompt || 'Generated image';
                img.loading = 'lazy';

                // Add click handler to load by index
                imageItem.addEventListener('click', () => {
                    loadImageIntoManualPreview(index);
                    hideWorkspaceImageOverlay();
                });

                imageItem.appendChild(img);
                grid.appendChild(imageItem);
            });
        } else {
            // Show empty state
            empty.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error loading workspace images:', error);
        empty.classList.remove('hidden');
        showGlassToast('error', 'Load Failed', 'Failed to load workspace images', false, undefined, '<i class="fas fa-image-slash"></i>');
    }
}

async function loadImageIntoManualPreview(imageIndex) {
    try {
        // Add initializing class to modal
        const manualModal = document.getElementById('manualModal');
        if (manualModal) {
            manualModal.classList.add('initializing');
        }

        // Use the existing updateManualPreview function with index (loading overlay handled internally)
        await updateManualPreview(imageIndex);
    } catch (error) {
        console.error('Error loading image into preview:', error);
        showGlassToast('error', 'Load Failed', 'Failed to load image into preview', false, undefined, '<i class="fas fa-image-slash"></i>');
    } finally {
        // Remove initializing class
        const manualModal = document.getElementById('manualModal');
        if (manualModal) {
            manualModal.classList.remove('initializing');
        }
    }
}

function initManualPreviewManager() {
    // Preview toolbar, prev/next nav, workspace overlay clicks: manualModalManager.js (step 470)
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(471, 'Manual preview manager', async () => {
        initManualPreviewManager();
    });
}
