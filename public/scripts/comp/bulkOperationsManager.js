/** Gallery bulk pin/move/delete ops (Phase 2 batch 13). */
async function handleBulkCopy() {
    const selectedImagesArray = getSelectedImages();
    if (selectedImagesArray.length === 0) {
        showError('No images selected');
        return;
    }

    if (selectedImagesArray.length === 1) {
        // copyImageToClipboard: public/scripts/comp/galleryView.js
        copyImageToClipboard(selectedImagesArray[0]);
        return;
    }

    // showGlassToast / updateGlassToastProgress / removeGlassToast: public/scripts/comp/toastManager.js
    const toastId = showGlassToast(
        'info',
        'Copying images...',
        `0 / ${selectedImagesArray.length}`,
        true,
        false,
        '<i class="fas fa-clipboard"></i>'
    );

    try {
        const fetched = [];
        let failed = 0;
        let anyNaiSigInvalid = false;

        for (let i = 0; i < selectedImagesArray.length; i++) {
            try {
                // fetchGalleryImageBlobForClipboard: public/scripts/comp/galleryView.js
                const item = await fetchGalleryImageBlobForClipboard(selectedImagesArray[i]);
                fetched.push(item);
                if (item.naiSigInvalid) anyNaiSigInvalid = true;
            } catch (error) {
                failed++;
                console.error('Failed to fetch image for clipboard:', error);
            }
            updateGlassToastProgress(toastId, Math.round(((i + 1) / selectedImagesArray.length) * 100));
            updateGlassToastMessage(toastId, `${i + 1} / ${selectedImagesArray.length}`);
        }

        if (!fetched.length) {
            throw new Error('Failed to load images for clipboard');
        }

        // copyBlobsToClipboard: public/scripts/utils/dreamscapeClipboard.js
        const result = await copyBlobsToClipboard(fetched);
        removeGlassToast(toastId);

        let toastMessage = `Copied ${result.copied} image(s)`;
        if (failed > 0) {
            toastMessage += ` (${failed} failed)`;
        }

        if (anyNaiSigInvalid) {
            showGlassToast(
                'warning',
                'Images copied to clipboard!',
                `${toastMessage}<br>NAI Signing Key Invalid`,
                false,
                4000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        } else {
            showGlassToast('success', 'Images copied to clipboard!', toastMessage, false, 3000, '<i class="fas fa-clipboard-check"></i>');
        }
    } catch (error) {
        console.error('Bulk copy error:', error);
        removeGlassToast(toastId);
        showError('Failed to copy images: ' + error.message);
    }
}

function handleBulkDownload() {
    const selectedImagesArray = getSelectedImages();
    if (selectedImagesArray.length === 0) {
        showError('No images selected');
        return;
    }

    // downloadImage: public/scripts/comp/galleryView.js
    selectedImagesArray.forEach((image) => downloadImage(image));

    if (selectedImagesArray.length === 1) return;
    showGlassToast(
        'success',
        null,
        `Downloading ${selectedImagesArray.length} image(s)...`,
        false,
        3000,
        '<i class="fas fa-download"></i>'
    );
}

async function handleBulkUnpin(event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showError('No images selected');
        return;
    }

    // Only allow unpinning when viewing pinned items
    if (currentGalleryView !== 'pinned') {
        showError('Can only unpin items when viewing pinned items');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to unpin ${selectedCount} selected image(s)?`,
        [
            { text: 'Unpin', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Unpinning images...');

        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to unpin');
        }

        let responseData = null;

        // Unpin all files at once using WebSocket
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        responseData = await window.wsClient.removePinnedBulk(activeWorkspace, validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { removedCount, failed } = responseData;
            let toastMessage = `Unpinned ${removedCount} image(s)`;

            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }

            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-thumbtack"></i>');
        } else {
            showGlassToast('success', null, `Unpinned ${validFilenames.length} image(s)`, false, 5000, '<i class="fas fa-thumbtack"></i>');
        }

        // Update pin buttons for the affected images
        for (const filename of validFilenames) {
            updateSpecificPinButton(filename);
        }

    } catch (error) {
        console.error('Bulk unpin error:', error);
        showError('Failed to unpin images: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and refresh gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

async function handleBulkPin(event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showError('No images selected');
        return;
    }

    // Only allow pinning when viewing regular images
    if (currentGalleryView !== 'images') {
        showError('Can only pin items when viewing regular images');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to pin ${selectedCount} selected image(s)?`,
        [
            { text: 'Pin', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Pinning images...');

        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to pin');
        }

        let responseData = null;

        // Pin all files at once using WebSocket
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        responseData = await window.wsClient.addPinnedBulk(activeWorkspace, validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { addedCount, failed } = responseData;
            let toastMessage = `Pinned ${addedCount} image(s)`;

            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }

            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-thumbtack"></i>');
        } else {
            showGlassToast('success', null, `Pinned ${validFilenames.length} image(s)`, false, 5000, '<i class="fas fa-thumbtack"></i>');
        }

        // Update local gallery data and pin buttons for the affected images
        for (const filename of validFilenames) {
            const imageIndex = findTrueImageIndexInGallery(filename);
            if (imageIndex !== -1) {
                allImages[imageIndex].isPinned = true; // Pinned
            }
            updateSpecificPinButton(filename);
        }

    } catch (error) {
        console.error('Bulk pin error:', error);
        showError('Failed to pin images: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and update pin buttons for the affected images
        clearSelection();
    }
}

async function handleBulkChangePreset() {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showError('No images selected');
        return;
    }

    // Show the modal
    const modal = document.getElementById('bulkChangePresetModal');
    const selectedCountSpan = document.getElementById('bulkChangePresetSelectedCount');
    const presetNameInput = document.getElementById('bulkChangePresetNameInput');

    if (!modal || !selectedCountSpan || !presetNameInput) {
        showError('Modal elements not found');
        return;
    }

    // Update selected count
    selectedCountSpan.textContent = selectedCount;

    // Clear input
    presetNameInput.value = '';

    // Show modal
    openModal(modal);

    // Focus on input
    presetNameInput.focus();
}

async function handleBulkChangePresetConfirm() {
    const modal = document.getElementById('bulkChangePresetModal');
    const presetNameInput = document.getElementById('bulkChangePresetNameInput');

    if (!modal || !presetNameInput) {
        showError('Modal elements not found');
        return;
    }

    const newPresetName = presetNameInput.value.trim();

    try {
        showManualLoading(true, 'Updating preset names...');

        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to update');
        }

        let responseData = null;

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        responseData = await window.wsClient.updateImagePresetBulk(validFilenames, newPresetName || null);

        // Use server response data for accurate toast message
        if (responseData) {
            const { updatedCount, failed, message } = responseData;
            let toastMessage = message || `Updated ${updatedCount} image(s)`;

            if (newPresetName) {
                toastMessage += ` with preset "${newPresetName}"`;
            } else {
                toastMessage += ' (preset cleared)';
            }

            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }

            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-edit"></i>');
        } else {
            const action = newPresetName ? `with preset "${newPresetName}"` : '(preset cleared)';
            showGlassToast('success', null, `Updated ${validFilenames.length} image(s) ${action}`, false, 5000, '<i class="fas fa-edit"></i>');
        }

    } catch (error) {
        console.error('Bulk change preset error:', error);
        showError('Failed to update preset names: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);
        closeModal(modal);

        // Clear selection and refresh gallery based on current view
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

async function handleBulkMoveToWorkspace() {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showError('No images selected');
        return;
    }

    try {
        // Use the new gallery move modal with cross-fade functionality
        triggerGalleryMoveWithSelection();
    } catch (error) {
        showError('Failed to open move modal: ' + error.message);
        clearSelection();
    }
}

async function moveBulkImagesToWorkspace(workspaceId) {
    try {
        const isScrapsView = currentGalleryView === 'scraps';
        const isPinnedView = currentGalleryView === 'pinned';

        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to move');
        }

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        // Determine the type based on current gallery view
        let moveType = 'files'; // default
        if (isScrapsView) {
            moveType = 'scraps';
        } else if (isPinnedView) {
            moveType = 'pinned';
        }

        await window.wsClient.moveFilesToWorkspace(validFilenames, workspaceId, null, moveType);

        const workspace = workspaces[workspaceId];
        let itemType;
        if (isScrapsView) {
            itemType = 'scraps';
        } else if (isPinnedView) {
            itemType = 'pinned images';
        } else {
            itemType = 'images';
        }

        showGlassToast('success', null, `Moved ${validFilenames.length} ${itemType} to ${workspace.name}`, false, 5000, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
    } catch (error) {
        console.error('Error moving items to workspace:', error);
        showError('Failed to move items: ' + error.message);
        clearSelection();
    } finally {
        showManualLoading(false);
        // Clear selection and reload gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

async function handleBulkDelete(event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to delete.');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete ${selectedCount} selected image(s)? This will permanently delete both the original and upscaled versions.`,
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to delete');
        }

        let responseData = null;

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        responseData = await window.wsClient.deleteImagesBulk(validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { successful, failed, message } = responseData;
            let toastMessage = message || `Successfully removed ${successful} image(s)`;

            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }

            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-trash"></i>');
        } else {
            showGlassToast('success', null, `Successfully removed ${validFilenames.length} image(s)`, false, 5000, '<i class="fas fa-trash"></i>');
        }

        // Apply local removal without a full reload
        const imagesToRemove = validFilenames
            .map(fn => findImageByFilename(fn))
            .filter(Boolean);
        if (imagesToRemove.length > 0) {
            removeMultipleImagesFromGallery(imagesToRemove);
            // Skip the next gallery reload event since we've already updated locally
            window.skipNextGalleryRefresh = (window.skipNextGalleryRefresh || 0) + 1;
        } else {
            // Fallback to reload if we couldn't map filenames
            switchGalleryView(currentGalleryView, true);
        }
    } catch (error) {
        console.error('Bulk delete error:', error);
        showError('Bulk delete failed: ' + error.message);
        clearSelection();
    } finally {
        showManualLoading(false);
        // Clear selection
        clearSelection();
    }
}

async function handleBulkSequenzia(event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showError('No images selected');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to send ${selectedCount} selected image(s) to Sequenzia? This will move the images and delete them from the gallery.`,
        [
            { text: 'Send to Sequenzia', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Sending images to Sequenzia...');

        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to send to Sequenzia');
        }

        let responseData = null;

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        responseData = await window.wsClient.sendToSequenziaBulk(validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { successful, failed, message } = responseData;
            let toastMessage = message || `Successfully sent ${successful} image(s) to Sequenzia`;

            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }

            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-share"></i>');
        } else {
            showGlassToast('success', null, `Successfully sent ${validFilenames.length} image(s) to Sequenzia`, false, 5000, '<i class="fas fa-share"></i>');
        }
    } catch (error) {
        console.error('Send to Sequenzia error:', error);
        showError('Send to Sequenzia failed: ' + error.message);
        clearSelection();
    } finally {
        showManualLoading(false);

        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

async function handleBulkMoveToScraps(event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to move to scraps.');
        return;
    }

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to move ${selectedCount} selected image(s) to scraps?`,
        [
            { text: 'Move', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        showManualLoading(true, 'Moving images to scraps...');

        // Filter out any null/undefined values from selected images
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to move to scraps');
        }

        let responseData = null;

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        responseData = await window.wsClient.addScrapBulk(activeWorkspace, validFilenames);

        // Use server response data for accurate toast message
        if (responseData) {
            const { addedCount, failed } = responseData;
            let toastMessage = `Successfully moved ${addedCount} image(s) to scraps`;

            if (failed > 0) {
                toastMessage += ` (${failed} failed)`;
            }

            showGlassToast('success', null, toastMessage, false, 5000, '<i class="fas fa-fire"></i>');
        } else {
            showGlassToast('success', null, `Successfully moved ${validFilenames.length} image(s) to scraps`, false, 5000, '<i class="fas fa-fire"></i>');
        }
    } catch (error) {
        console.error('Bulk move to scraps error:', error);
        showError('Failed to move images to scraps: ' + error.message);
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        showManualLoading(false);

        // Clear selection and remove images from gallery
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

