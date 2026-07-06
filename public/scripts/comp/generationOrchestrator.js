/** Preset generation + manual save orchestration (Phase 2 batch 13). */
// Simple button state tracking
let isGenerating = false;
let isQueueStopped = false;
let isQueueProcessing = false;

// Global progress toast ID to prevent multiple progress toasts
let progressToastId = null;

async function saveManualPreset(presetName, config) {
    try {
        // Use WebSocket for preset saving
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.savePreset(presetName, config);

        // Handle the response properly
        if (result && result.data && result.data.message) {
            showGlassToast('success', null, result.data.message, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        } else if (result && result.message) {
            showGlassToast('success', null, result.message, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        } else {
            showGlassToast('success', null, `Preset "${presetName}" saved successfully`, false, undefined, '<i class="fas fa-book-sparkles"></i>');
        }

        // Refresh the preset list
        await loadOptions();
    } catch (error) {
        console.error('Error saving preset:', error);
        showError('Failed to save preset: ' + error.message);
    }
}

// Handle manual save button
async function handleManualSave() {
    const presetName = manualPresetName.value.trim();
    if (!presetName) {
        showError('Please enter a preset name to save');
        return;
    }

    const isImg2Img = window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.isVariationEdit);
    const values = collectManualFormValues();

    // Helper: Validate required fields
    function validateFields(requiredFields, msg) {
        for (const field of requiredFields) {
            if (field === 'resolutionValue') {
                // Special handling for resolution: check for either resolutionValue or custom dimensions
                if (!values[field] && (!values.width || !values.height)) {
                    showError(msg);
                    return false;
                }
            } else if (!values[field]) {
                showError(msg);
                return false;
            }
        }
        return true;
    }

    // Validate required fields for both paths
    if (!validateFields(['model', 'prompt', 'resolutionValue'], 'Please fill in all required fields (Model, Prompt, Resolution)')) return;

    // Prepare base requestBody (shared between both paths)
    const requestBody = {
        prompt: values.prompt,
        steps: values.steps,
        guidance: values.guidance,
        rescale: values.rescale,
        allow_paid: forcePaidRequest,
        workspace: activeWorkspace
    };

    // Process resolution to determine if it's custom or predefined
    const resolutionData = processResolutionValue(values.resolutionValue);
    if (resolutionData.isCustom) {
        requestBody.width = resolutionData.width;
        requestBody.height = resolutionData.height;
    } else {
        requestBody.resolution = resolutionData.resolution;
    }

    // Add img2img specific parameters if applicable
    if (isImg2Img) {
        requestBody.strength = parseFloat(manualStrengthValue.value) || 0.8;
        requestBody.noise = parseFloat(manualNoiseValue.value) || 0.1;

        // Handle uploaded image data
        if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            requestBody.image = window.uploadedImageData.image_source;
        } else if (window.currentEditMetadata && window.currentEditMetadata.sourceFilename) {
            requestBody.image = `file:${window.currentEditMetadata.sourceFilename}`;
        }
        requestBody.image_bias = window.uploadedImageData.image_bias || window.uploadedImageData.bias;

        if (!requestBody.image) {
            showError('No source image found for variation');
            return;
        }

        // Add mask data if it exists
        if (window.currentMaskCompressed) {
            requestBody.mask_compressed = window.currentMaskCompressed.replace('data:image/png;base64,', '');
        } else if (window.currentMaskData) {
            // Add compressed mask for server processing
            const compressedMask = saveMaskCompressed();
            if (compressedMask) {
                requestBody.mask_compressed = compressedMask.replace('data:image/png;base64,', '');
            }
        }
    }

    // Add shared fields and preset name
    addSharedFieldsToRequestBody(requestBody, values);
    if (values.presetName) requestBody.preset = values.presetName;

    const generationParams = {
        model: values.model.toLowerCase(),
        ...requestBody
    };

    // Remove skip_pipeline_stages from preset - this is a runtime flag only
    delete generationParams.skip_pipeline_stages;

    // Check if a seed value is set and ask user if they want to save it
    if (generationParams.seed && generationParams.seed !== '') {
        const seedChoice = await showConfirmationDialog(
            `A seed value "${generationParams.seed}" is currently set. Do you want to save this preset with a static seed or make it automatic?`,
            [
                { text: 'Static Seed', value: 'static', className: 'btn-secondary', icon: 'fas fa-lock' },
                { text: 'Automatic', value: 'automatic', className: 'btn-primary' },
                { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
            ]
        );

        if (seedChoice === 'cancel' || seedChoice === null) {
            return; // User cancelled
        }

        if (seedChoice === 'automatic') {
            // Remove seed for automatic generation
            delete generationParams.seed;
        }
        // If 'static', keep the seed as is
    }

    await saveManualPreset(presetName, generationParams);
}

// Update generate button state

// IMAGE GENERATION SYSTEM - Move to imageGenerationManager.js
// This system handles image generation, result processing, and related operations
// Includes functions: generateImage, handleImageResult, downloadImage, deleteImage,
// deleteManualPreviewImage, createConfetti, showManualLoading, showManualPreviewNavigationLoading,
// showError, showErrorSubHeader, hideErrorSubHeader, handleAuthError, etc.

// Generate image
async function generateImage(event = null) {
    closeSubMenu();

    // Check if queue is blocked
    if (isQueueStopped || isQueueProcessing) {
        showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait for the queue to clear.', false, 5000);
        return;
    }

    // assertClientImageGenerationAllowed: public/scripts/comp/novelAiAccountStatus.js
    try {
        assertClientImageGenerationAllowed();
    } catch (_error) {
        return;
    }

    // Set generating state
    isGenerating = true;
    updateManualGenerateBtnState();

    const selectedValue = presetSelect.value;
    if (!selectedValue) {
        showError('Please select a preset');
        return;
    }

    if (!selectedValue.startsWith('preset:')) {
        showError('Invalid selection');
        return;
    }

    // Check if this preset requires paid credits and show confirmation dialog
    const presetName = selectedValue.replace('preset:', '');

    // For now, we'll check if the preset requires paid credits by looking at the preset data
    // This is a simplified approach - in a real implementation, you'd want to check the actual preset configuration
    const requiresPaid = false; // This would be determined by the preset configuration

    const cost = parseInt(document.getElementById('manualPriceList').textContent); // Default cost for preset generation
    if (requiresPaid && !forcePaidRequest) {
        const confirmed = await showCreditCostDialog(cost, event);

        if (!confirmed) {
            return;
        }
    }

    // Check if we're in a modal context
    const isInModal = !document.getElementById('manualModal').classList.contains('hidden');

    let toastId;
    let progressInterval;

    if (!isInModal) {
        // Use glass toast with progress when not in modal (global pattern)
        if (!progressToastId) {
            progressToastId = showGlassToast('info', 'Generating Image', 'Generating image...', true, false, '<i class="nai-sparkles"></i>');
        }

        // Start progress animation (1% per second)
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += 1;
            updateGlassToastProgress(progressToastId, progress);
        }, 1000);
    } else {
        // Use existing modal loading overlay when in modal
        showManualLoading(true, 'Generating image...');
    }

    try {
        // Generate image using WebSocket
        const result = await window.wsClient.generatePreset(presetName, window.currentWorkspace || null);

        // Extract data from the standard response format
        const filename = result.filename;

        // Update the existing toast to show completion
        updateGlassToastComplete(progressToastId, {
            type: 'success',
            title: 'Image Generated',
            message: 'Image generated successfully and added to gallery',
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });

        createConfetti();

        if (!isGalleryWindowHidden()) {
            // Refresh gallery to show the new image
            await loadGallery(true);

            // Find the generated image in the gallery
            const found = allImages.find(img => img.original === filename || img.upscaled === filename);
            if (found) {
                // Construct proper image object with filename property
                const imageToShow = {
                    filename: filename,
                    base: found.base,
                    original: found.original,
                    upscaled: found.upscaled
                };
                showLightbox(imageToShow);
            }
        }

    } catch (error) {
        console.error('Generation error:', error);
        // Update the existing toast to show error
        updateGlassToastComplete(progressToastId, {
            type: 'error',
            title: 'Generation Failed',
            message: error.message,
            customIcon: '<i class="nai-cross"></i>',
            showProgress: false
        });
    } finally {
        // Reset generating state
        isGenerating = false;
        updateManualGenerateBtnState();

        // Clear progress and loading states
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        if (isInModal) {
            showManualLoading(false);
        }
    }
}

async function deleteManualPreviewImage() {
    if (!window.currentManualPreviewImage) {
        showError('No image to delete');
        return;
    }

    try {
        // Show navigation loading overlay
        showManualPreviewNavigationLoading(true);

        // Determine which filename to use for deletion
        let filenameToDelete = null;

        // For regular images, prioritize original, then upscaled
        if (window.currentManualPreviewImage.original) {
            filenameToDelete = window.currentManualPreviewImage.original;
        } else if (window.currentManualPreviewImage.upscaled) {
            filenameToDelete = window.currentManualPreviewImage.upscaled;
        }

        if (!filenameToDelete) {
            throw new Error('No filename available for deletion');
        }

        // Use WebSocket bulk delete request
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.deleteImagesBulk([filenameToDelete]);

        if (result.successful > 0) {
            // Resume the preview at the boundary-correct next available image
            // resumeManualPreviewAfterRemoval: public/scripts/comp/manualPreviewManager.js
            await resumeManualPreviewAfterRemoval(window.currentManualPreviewIndex ?? 0);
            showGlassToast('success', null, 'Image deleted');
        } else {
            throw new Error('Delete failed');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showError('Failed to delete image: ' + error.message);
    } finally {
        // Hide navigation loading overlay
        showManualPreviewNavigationLoading(false);
    }

    // Refresh gallery after processing is complete
    loadGallery(true);
}

