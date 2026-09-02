/** Gallery reroll / upscale / manual-modal guard (Phase 2 batch 13). */
async function rerollImage(image, event = null) {
    try {
        // Determine which filename to use for metadata
        // For gallery items, determine the filename based on available properties
        let filenameForMetadata = image.filename;

        if (!filenameForMetadata) {
            // If no filename property, determine from gallery image object
            if (image.upscaled) {
                filenameForMetadata = image.upscaled;
            } else if (image.original) {
                filenameForMetadata = image.original;
            }
        }

        if (!filenameForMetadata) {
            throw new Error('No filename available for metadata lookup');
        }


        // Get current workspace
        const workspace = activeWorkspace || null;

        // Check if this is an upscaled image and show confirmation dialog if needed
        let isUpscaled = false;
        if (image.upscaled || filenameForMetadata.includes('_upscaled')) {
            isUpscaled = true;
        }

        // Check if this is a large or wallpaper image that will cost credits
        let isLargeOrWallpaper = false;
        if (filenameForMetadata.includes('large_') || filenameForMetadata.includes('wallpaper_')) {
            isLargeOrWallpaper = true;
        }

        // If upscaled and user hasn't already allowed paid requests, show confirmation
        if (isUpscaled && !forcePaidRequest) {
            const cost = 7; // Upscaling cost (same as upscaleImage function)
            const confirmed = await showCreditCostDialog(cost, event);
            if (!confirmed) {
                return;
            }
        }

        // If large/wallpaper image and user hasn't already allowed paid requests, show confirmation
        if (isLargeOrWallpaper && !forcePaidRequest) {
            const confirmed = await showConfirmationDialog(
                'This image was generated with a large or wallpaper resolution, which costs credits to regenerate. Do you want to continue?',
                [
                    { text: 'Yes, use credits', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                event
            );
            if (!confirmed) {
                return;
            }
            // Set the paid flag for this request
            forcePaidRequest = true;
        }

        // Reroll stays out of Studio — own toast with preview (public/scripts/comp/galleryView.js)
        ensureRerollProgressToast();
        stopStudioPreviewForReroll();

        // Use WebSocket reroll functionality (preferred method)
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                const result = await window.wsClient.rerollImage(
                    filenameForMetadata,
                    workspace,
                    null,
                    forcePaidRequest || false
                );

                // Handle successful reroll (placeholder resolve runs on progress complete in websocket.js)
                if (result && result.filename) {
                    if (result.seed) {
                        window.lastGeneratedSeed = parseInt(result.seed);
                        const sproutSeedBtn = document.getElementById('sproutSeedBtn');
                        if (sproutSeedBtn) sproutSeedBtn.classList.add('available');
                        updateSproutSeedButtonFromPreviewSeed();
                    }

                    const rerolledFilename = result.filename;
                    stopStudioPreviewForReroll();

                    if (result.image && progressToastId && typeof updateGlassToastImagePreview === 'function') {
                        updateGlassToastImagePreview(progressToastId, result.image);
                    }
                    if (progressToastId) {
                        updateGlassToastProgress(progressToastId, 100);
                        updateGlassToastComplete(progressToastId, {
                            type: 'success',
                            title: 'Reroll Complete',
                            message: 'Image generated successfully!',
                            customIcon: '<i class="nai-check"></i>',
                            showProgress: false
                        });
                        progressToastId = null;
                    }

                    if (lastGalleryRerollResolvedFilename === rerolledFilename) {
                        lastGalleryRerollResolvedFilename = null;
                    }
                    const alreadyInList = typeof activeGalleryHasExactFile === 'function'
                        && activeGalleryHasExactFile(rerolledFilename);
                    const alreadyInDom = typeof findGalleryDomItemByIdentity === 'function'
                        && findGalleryDomItemByIdentity({
                            filename: rerolledFilename,
                            original: rerolledFilename,
                            upscaled: rerolledFilename
                        });
                    if (!galleryRerollOwnsGalleryDom() && (!alreadyInList || (!isGalleryWindowHidden() && !alreadyInDom))) {
                        await loadGallery(true);
                    }

                    // Clean up modal state
                    document.querySelectorAll('.manual-preview-image-container, #manualPanelSection').forEach(element => {
                        element.classList.remove('swapped');
                    });

                    return;
                }
            } catch (wsError) {
                if (isGalleryRerollSessionActive()) {
                    // failGalleryRerollSession: public/scripts/comp/galleryView.js
                    failGalleryRerollSession(activeGalleryRerollSession.requestId);
                }
                // Propagate to the outer handler so the toast/loading state is cleaned up (no HTTP fallback exists)
                throw wsError;
            }
        }
    } catch (error) {
        console.error('Direct reroll error:', error);
        if (isGalleryRerollSessionActive()) {
            // failGalleryRerollSession: public/scripts/comp/galleryView.js
            failGalleryRerollSession(activeGalleryRerollSession.requestId);
        }
        stopStudioPreviewForReroll();
        if (progressToastId) {
            updateGlassToastComplete(progressToastId, {
                type: 'error',
                title: 'Reroll Failed',
                message: 'Image reroll failed: ' + error.message,
                customIcon: '<i class="nai-cross"></i>',
                showProgress: false
            });
            progressToastId = null;
        } else {
            showError('Image reroll failed: ' + error.message);
        }
    } finally {
        stopStudioPreviewForReroll();
    }
}

// Check if manual modal is open and show confirmation dialog before loading new data
async function checkManualModalBeforeLoad(event = null) {
    const manualModal = document.getElementById('manualModal');

    // Check if modal is open (multiple ways to detect)
    let isManualModalOpen = false;
    let hasFormContent = false;

    if (manualModal) {
        isManualModalOpen = !manualModal.classList.contains('hidden');

        // Also check if modal is in the modal stack (alternative way to detect if open)
        const isInModalStack = typeof modalStack !== 'undefined' && modalStack.indexOf(manualModal) !== -1;
        isManualModalOpen = isManualModalOpen || isInModalStack;

        // Check if form has content (prompt field, current edit metadata, or uploaded image)
        const manualPrompt = document.getElementById('manualPrompt');
        hasFormContent = (manualPrompt && manualPrompt.value.trim()) ||
            window.currentEditMetadata ||
            window.uploadedImageData ||
            (window.currentEditImage !== null && window.currentEditImage !== undefined);
    }

    // Show confirmation dialog if manual modal is open in desktop mode and has content
    if (isManualModalOpen && window.isDesktop && hasFormContent) {
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to overwrite the current request? Any unsaved changes will be lost if not used in a generated image.',
            [
                { text: 'Save', value: 'save', className: 'btn-secondary', icon: 'fas fa-floppy-disk' },
                { text: 'Continue', value: 'load', className: 'btn-primary' },
                { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
            ],
            event
        );

        // If user cancelled, return false
        if (!confirmed || confirmed === 'cancel') {
            return false;
        }

        // If user chose to save, save the request first
        if (confirmed === 'save') {
            await saveRequestAsDesktopShortcut();
            // Continue with loading after saving
        }

        // User confirmed (either 'load' or 'save'), return true
        return true;
    }

    // Modal not open or not desktop mode, proceed without confirmation
    return true;
}

// Upscale an image
async function upscaleImage(image, event = null) {
    // Calculate upscale cost and output resolution based on image dimensions
    const width = image.width || 1024;
    const height = image.height || 1024;
    const upscaleInfo = calculateUpscaleInfo(width, height);

    // Show upscale options dialog (always show for upscaling)
    // Even if NovelAI is not available, ESRGAN options will be shown
    const isFreeUpscaling = upscaleInfo.available && upscaleInfo.cost === 0;
    const confirmed = await showCreditCostDialog(upscaleInfo.cost, event, upscaleInfo.outputResolution, true, width, height, isFreeUpscaling);

    if (!confirmed) {
        return;
    }

    // Extract upscaler and scale from confirmation result
    const upscaler = confirmed.upscaler || 'novelai';
    const scale = confirmed.scale || 4;

    // Check if we're in a modal context
    const isInModal = !document.getElementById('manualModal').classList.contains('hidden');

    let toastId;
    let progressInterval;

    if (!isInModal) {
        // Use glass toast with progress when not in modal (global pattern)
        if (!progressToastId) {
            progressToastId = showGlassToast('info', 'Upscaling Image', 'Upscaling image...', true, false, '<i class="nai-upscale"></i>');
        }

        // Start progress animation (1% per second)
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += 1;
            updateGlassToastProgress(progressToastId, progress);
        }, 1000);
    } else {
        // Use preview animation when in modal for upscaling
        showManualLoading(true, 'Upscaling image...');
    }

    try {
        // Prepare upscaling parameters
        const filename = image.original || image.filename || image.upscaled;
        if (!filename) {
            throw new Error('No valid filename found in image object');
        }

        const upscaleParams = {
            filename: filename,
            workspace: activeWorkspace || null,
            upscaler: upscaler,
            scale: scale
        };

        // Upscale image via WebSocket
        try {
            const result = await window.wsClient.upscaleImage(upscaleParams);

            if (result) {
                const { filename, metadata } = result;

                // Show success message
                if (!isInModal) {
                    clearInterval(progressInterval);
                    updateGlassToastProgress(progressToastId, 100);
                    updateGlassToastComplete(progressToastId, {
                        type: 'success',
                        title: 'Upscale Complete',
                        message: 'Image upscaled successfully!',
                        customIcon: '<i class="nai-check"></i>',
                        showProgress: false
                    });

                    // Clear the global progress toast ID after completion
                    progressToastId = null;
                } else {
                    showGlassToast('success', 'Upscale Complete', 'Image upscaled successfully!');
                }

                // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
                const imageUrl = localGalleryImageUrl(filename);
                const mockResponse = {
                    headers: {
                        get: (headerName) => {
                            if (headerName === 'X-Generated-Filename') {
                                return filename;
                            }
                            if (headerName === 'Content-Length' && result.contentLength) {
                                return String(result.contentLength);
                            }
                            return null;
                        }
                    }
                };

                // Update the current manual preview image object to include the upscaled version
                if (window.currentManualPreviewImage) {
                    window.currentManualPreviewImage.upscaled = filename;
                }

                await handleImageResult(imageUrl, undefined, undefined, mockResponse, metadata);
            } else {
                throw new Error('Invalid response from WebSocket');
            }

        } catch (error) {
            console.error('Upscaling error:', error);
            if (!isInModal) {
                if (progressInterval) clearInterval(progressInterval);
                updateGlassToastComplete(progressToastId, {
                    type: 'error',
                    title: 'Upscale Failed',
                    message: 'Image upscaling failed. Please try again.',
                    customIcon: '<i class="nai-cross"></i>',
                    showProgress: false
                });

                // Clear the global progress toast ID after error
                progressToastId = null;
            } else {
                showError('Image upscaling failed. Please try again.');
            }
        }

    } catch (error) {
        console.error('Upscaling error:', error);
        if (!isInModal) {
            if (progressInterval) clearInterval(progressInterval);
            updateGlassToastComplete(progressToastId, {
                type: 'error',
                title: 'Upscale Failed',
                message: 'Image upscaling failed. Please try again.',
                customIcon: '<i class="nai-cross"></i>',
                showProgress: false
            });
        } else {
            showError('Image upscaling failed. Please try again.');
        }
    } finally {
        if (isInModal) {
            showManualLoading(false);
        } else if (progressInterval) {
            clearInterval(progressInterval);
        }
    }
}

