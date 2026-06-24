/** Manual modal base-image upload/delete (Phase 2 batch 13). */
async function handleManualImageUpload(file) {
    if (!file.type.startsWith('image/')) {
        showError('Please select an image file');
        return;
    }

    // Check if there's an existing mask
    const hasExistingMask = window.currentMaskData !== null && window.currentMaskData !== undefined;

    if (hasExistingMask) {
        // Store the pending upload and show alert modal
        window.pendingImageUpload = { file };
        showBaseImageChangeAlertModal();
        return;
    }

    // No mask exists, proceed with upload
    await handleManualImageUploadInternal(file);
}

// Internal function to handle the actual image upload
async function handleManualImageUploadInternal(file) {
    try {
        showManualLoading(true, 'Uploading base image...');

        const formData = new FormData();
        formData.append('image', file);

        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/references`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success || !result.hash) {
            throw new Error(result.error || 'Upload failed to return hash.');
        }

        const { hash, width, height } = result;

        const biasToUse = 2;

        window.uploadedImageData = {
            image_source: `cache:${hash}`,
            width: width,
            height: height,
            bias: biasToUse,
            isBiasMode: true,
            isClientSide: 1
        };

        // Crop and update preview
        await cropImageToResolution();
        updateImageBiasOrientation();

        if (imageBiasHidden != null) imageBiasHidden.value = biasToUse.toString();
        await renderImageBiasDropdown(biasToUse.toString());

        // Show transformation section content
        if (transformationRow) {
            transformationRow.classList.add('display-image');
        }

        document.getElementById('manualImg2ImgGroup').classList.remove('hidden');
        updateUploadDeleteButtonVisibility();
        updateInpaintButtonState();
        showGlassToast('success', null, 'Reference Image Added');

    } catch (error) {
        console.error('Manual upload error:', error);
        showError(`Upload failed: ${error.message}`);
    } finally {
        showManualLoading(false);
    }
}

// Handle deleting uploaded base image
function handleDeleteBaseImage() {
    // Clean up any existing blob URLs
    cleanupBlobUrls();
    // releaseUploadedImageDataHeavyFields: public/scripts/comp/imageBias.js
    releaseUploadedImageDataHeavyFields();

    // Clear the uploaded image data
    window.uploadedImageData = null;

    // Clear the variation image
    // releaseVariationImageSrc: public/scripts/comp/manualModalManager.js
    releaseVariationImageSrc();

    // Hide transformation section content
    if (transformationRow) {
        transformationRow.classList.remove('display-image');
    }
    document.getElementById('manualImg2ImgGroup').classList.add('hidden');

    // Hide image bias dropdown
    hideImageBiasDropdown();

    // Update image bias orientation after clearing image data
    updateImageBiasOrientation();

    // Clear variation context
    if (window.currentEditMetadata) {
        delete window.currentEditMetadata.sourceFilename;
        delete window.currentEditMetadata.isVariationEdit;
    }
    deleteMask();

    // Update button visibility
    updateUploadDeleteButtonVisibility();

    // Update mask preview
    updateInpaintButtonState();

    updateMaskPreview();
}

// Update upload/delete button visibility based on whether an image is uploaded
function updateUploadDeleteButtonVisibility() {
    if (deleteImageBaseBtn) {
        if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            // Image is uploaded (not a placeholder), show delete button
            deleteImageBaseBtn.classList.remove('hidden');
        } else {
            // No image uploaded or it's a placeholder, hide delete button
            deleteImageBaseBtn.classList.add('hidden');
        }
    }

    if (previewBaseImageBtn) {
        if (window.uploadedImageData && !window.uploadedImageData.isPlaceholder) {
            // Image is uploaded (not a placeholder), show preview button
            previewBaseImageBtn.classList.remove('hidden');
        } else {
            // No image uploaded or it's a placeholder, hide preview button
            previewBaseImageBtn.classList.add('hidden');
        }
    }
}

