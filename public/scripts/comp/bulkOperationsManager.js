/** Gallery bulk pin/move/delete ops (Phase 2 batch 13). */

/** "Pictures (/Workspaces/Main/Pictures)": a gallery folder as Vista's progress dialog names it. */
function galleryTransferPlace(wsId, folder) {
    if (!wsId) return null;
    const wsName = (typeof workspaces !== 'undefined' && workspaces[wsId]?.name) || wsId;
    return { name: folder, path: `/Workspaces/${wsName}/${folder}` };
}

/** The gallery folder a view's images live in. */
function galleryViewFolder(view) {
    return view === 'scraps' ? 'Scraps' : 'Pictures';
}

/**
 * Gallery images moved or deleted under Vista's progress dialog (fileOperationProgress.js, on the
 * desktop): worker(filenames) in batches so the bar moves and Cancel stops between them; a failure
 * asks Try Again / Skip / Cancel. Off the desktop it is one worker call with every filename and a
 * failure throws. Resolves { done, cancelled, shown, values } (values: each worker's result).
 */
async function galleryTransfer(op, filenames, from, to, worker) {
    // desktopSounds.coalesce: public/scripts/comp/desktopSounds.js — one Recycle at the end, not per batch
    return desktopSounds.coalesce(async () => {
        if (typeof fileOperationProgress === 'undefined') {
            const value = await worker(filenames);
            return { done: filenames.length, cancelled: false, shown: false, values: [value] };
        }
        return fileOperationProgress.batches({ op, from, to, items: filenames.map(name => ({ name })) }, filenames, worker);
    });
}
// ---- The download window (#1134): which format the pictures download as -----------------------------------------
/** galleryDownloadWindow.choose(images, owner) / .one(image, owner) / .many(images, from, owner) */
const galleryDownloadWindow = (() => {
    // A Vista dialog in MS Shell Dlg 8: the formats as radio buttons in a group, each with what it keeps and, for one
    // picture, its size; Download / Cancel. The last choice is kept (localStorage melatonDownloadFormat).
    const DOWNLOAD_FORMAT_KEY = 'melatonDownloadFormat';
    const DOWNLOAD_FORMATS = [
        { id: 811, hint: 821, value: 'png' },
        { id: 812, hint: 822, value: 'jxl' },
        { id: 815, hint: 825, value: 'webp' },
        { id: 813, hint: 823, value: 'slim' },
        { id: 814, hint: 824, value: 'jpeg' }
    ];
    // the radios one after another (the renderer groups radios that follow each other), their notes after them
    const DOWNLOAD_FORMAT_TPL = { t: 'Download', w: 262, h: 222, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
        [801, 'S', 7, 7, 248, 9, 0x50020000, 'Download this picture as:', 0],
        [-1, 'B', 7, 20, 248, 174, 0x50000007, 'Format', 0],
        [811, 'B', 15, 33, 232, 10, 0x50030009, '&PNG, as it was saved', 0],
        [812, 'B', 15, 61, 232, 10, 0x50010009, 'JPEG &XL, lossless and smaller', 0],
        [815, 'B', 15, 98, 232, 10, 0x50010009, '&WebP, lossless, for the web', 0],
        [813, 'B', 15, 135, 232, 10, 0x50010009, 'PNG &without the prompt and settings', 0],
        [814, 'B', 15, 163, 232, 10, 0x50010009, '&JPEG, smallest, for sharing', 0],
        [821, 'S', 27, 44, 220, 9, 0x50020000, 'Keeps the prompt and settings.', 0],
        [822, 'S', 27, 72, 220, 18, 0x50020000, 'Keeps the prompt and settings. Opens in apps that read JPEG XL.', 0],
        [825, 'S', 27, 109, 220, 18, 0x50020000, 'Keeps the prompt and settings. Opens in browsers and most editors.', 0],
        [823, 'S', 27, 146, 220, 9, 0x50020000, 'The picture only.', 0],
        [824, 'S', 27, 174, 220, 9, 0x50020000, 'Some detail is lost; no prompt or settings.', 0],
        [1, 'B', 151, 202, 50, 14, 0x50010001, '&Download', 0],
        [2, 'B', 205, 202, 50, 14, 0x50010000, 'Cancel', 0]
    ] };

    function downloadSizeText(bytes) {
        if (!(bytes > 0)) return '';
        return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    /**
     * Ask which format the pictures download as: resolves 'png' | 'jxl' | 'webp' | 'slim' | 'jpeg', or null (Cancel). Off the
     * desktop (no Vista dialogs) it resolves 'png' at once, as downloads always were.
     */
    async function choose(images, owner) {
        const list = (images || []).filter(Boolean);
        if (!list.length) return null;
        if (!window.isDesktop || !window.featureLoader) return 'png';
        try { await window.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { return 'png'; }
        const V = window.vistaDialogTemplate;
        if (!V || typeof V.openDialog !== 'function') return 'png';
        let last = 'png';
        try { last = localStorage.getItem(DOWNLOAD_FORMAT_KEY) || 'png'; } catch (_) { /* storage off */ }
        if (!DOWNLOAD_FORMATS.some((f) => f.value === last)) last = 'png';
        const nameOf = (image) => (typeof image === 'string' ? image : (image.upscaled || image.original || image.filename || ''));
        return new Promise((resolve) => {
            let settled = false;
            const done = (v) => { if (!settled) { settled = true; resolve(v); } };
            V.openDialog({
                id: 'galleryDownloadFormat',
                tpl: DOWNLOAD_FORMAT_TPL,
                owner,
                title: DOWNLOAD_FORMAT_TPL.t,
                bareCaption: true,
                init(ctx) {
                    ctx.text(801, list.length === 1 ? 'Download this picture as:' : `Download these ${list.length} pictures as:`);
                    DOWNLOAD_FORMATS.forEach((f) => ctx.set(f.id, f.value === last));
                    if (list.length !== 1) return;
                    // one picture: its sizes where the server knows them without work, else an estimate for JPEG XL
                    const name = nameOf(list[0]);
                    if (!name || typeof localGalleryImageUrl !== 'function') return;
                    fetch(`${localGalleryImageUrl(name)}?info=formats`, { cache: 'no-store' })
                        .then((r) => (r.ok ? r.json() : null))
                        .then((info) => {
                            if (!info || settled) return;
                            // a JXL-stored picture whose PNG was never rebuilt: an estimate from the JXL
                            const png = info.png ? downloadSizeText(info.png) : (info.jxl ? `about ${downloadSizeText(info.jxl / 0.56)}` : '');
                            const jxl = info.jxl ? downloadSizeText(info.jxl) : (info.png ? `about ${downloadSizeText(info.png * 0.56)}` : '');
                            if (png) ctx.text(821, `${png}. Keeps the prompt and settings.`);
                            if (jxl) ctx.text(822, `${jxl}. Keeps the prompt and settings. Opens in apps that read JPEG XL.`);
                            // WebP: a size only when the server reports one (#1156)
                            if (info.webp) ctx.text(825, `${downloadSizeText(info.webp)}. Keeps the prompt and settings. Opens in browsers and most editors.`);
                        })
                        .catch(() => { /* the texts stay without sizes */ });
                },
                ok(ctx) {
                    const pick = DOWNLOAD_FORMATS.find((f) => ctx.get(f.id)) || DOWNLOAD_FORMATS[0];
                    try { localStorage.setItem(DOWNLOAD_FORMAT_KEY, pick.value); } catch (_) { /* storage off */ }
                    done(pick.value);
                    return true;
                },
                cancel() { done(null); }
            });
        });
    }

    /** The download window for one picture, then the download (no progress dialog for one). */
    async function one(image, owner) {
        if (!image) return;
        const format = await choose([image], owner);
        // downloadImage: public/scripts/comp/galleryView.js
        if (format) downloadImage(image, format);
    }

    /**
     * The download window, then the pictures saved in the chosen format under Vista's progress dialog (the gallery,
     * Melaton Photo Gallery, Lumen). from: the folder the progress dialog names.
     */
    async function many(images, from, owner) {
        const list = (images || []).filter(Boolean);
        const format = await choose(list, owner);
        if (!format) return;
        await galleryDownloadImages(list, from || { name: 'DreamScape', path: '/Workspaces' }, format);
    }

    return { choose, one, many };
})();

/**
 * Gallery images saved to this computer: one browser download each under Vista's progress dialog
 * ("Downloading 5 items" from the gallery folder); off the desktop the toast says it.
 * downloadImage: public/scripts/comp/galleryView.js
 */
async function galleryDownloadImages(images, from, format = 'png') {
    const list = (images || []).filter(Boolean);
    if (typeof fileOperationProgress === 'undefined' || !fileOperationProgress.available()) {
        list.forEach((image) => downloadImage(image, format));
        if (list.length > 1) {
            showGlassToast('success', null, `Downloading ${list.length} image(s)...`, false, 3000, '<i class="fas fa-download"></i>');
        }
        return;
    }
    const nameOf = (image) => (typeof image === 'string' ? image : (image.upscaled || image.original || image.filename || 'image'));
    await fileOperationProgress.run({
        op: 'copy',
        verb: 'Downloading',
        from,
        items: list.map((image) => ({ name: nameOf(image) }))
    }, list, async (image) => {
        downloadImage(image, format);
        // the browser takes one download at a time from a page more readily when they are spaced
        await new Promise((resolve) => setTimeout(resolve, 150));
    });
}

/**
 * A gallery batch that moves no files (pinning, preset names): on the desktop Vista's progress
 * dialog (a progress toast, toastManager.js) that ends in the batch's result; elsewhere Studio's
 * loading overlay and the result toast as before.
 */
function galleryBatchBegin(title, text) {
    if (typeof fileOperationProgress !== 'undefined' && fileOperationProgress.available()) {
        return { toastId: showGlassToast('info', title, text, true, false), overlay: false };
    }
    showManualLoading(true, text);
    return { toastId: null, overlay: true };
}

/** The batch's result: the dialog's end (a failure stays up in it, under failTitle), or the toast it always was. */
function galleryBatchResult(batch, type, message, icon, failTitle) {
    if (batch && batch.toastId) {
        updateGlassToastComplete(batch.toastId, { type, title: type === 'error' ? failTitle : null, message, showProgress: false });
        batch.toastId = null;
        return;
    }
    if (type === 'error') showError(message);
    else showGlassToast(type, null, message, false, 5000, icon);
}

function galleryBatchEnd(batch) {
    if (!batch) return;
    if (batch.toastId) removeGlassToast(batch.toastId);
    batch.toastId = null;
    if (batch.overlay) showManualLoading(false);
}

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

    if (selectedImagesArray.length === 1) {
        galleryDownloadWindow.one(selectedImagesArray[0]);
        return;
    }
    galleryDownloadWindow.many(selectedImagesArray, galleryTransferPlace(activeWorkspace, galleryViewFolder(currentGalleryView)));
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

    let batch = null;
    try {
        batch = galleryBatchBegin('Unpinning Images', 'Unpinning images...');

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

            galleryBatchResult(batch, 'success', toastMessage, '<i class="fas fa-thumbtack"></i>');
        } else {
            galleryBatchResult(batch, 'success', `Unpinned ${validFilenames.length} image(s)`, '<i class="fas fa-thumbtack"></i>');
        }

        // Update pin buttons for the affected images
        for (const filename of validFilenames) {
            updateSpecificPinButton(filename);
        }

    } catch (error) {
        console.error('Bulk unpin error:', error);
        galleryBatchResult(batch, 'error', 'Failed to unpin images: ' + error.message, null, 'Unpinning Failed');
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        galleryBatchEnd(batch);

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

    let batch = null;
    try {
        batch = galleryBatchBegin('Pinning Images', 'Pinning images...');

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

            galleryBatchResult(batch, 'success', toastMessage, '<i class="fas fa-thumbtack"></i>');
        } else {
            galleryBatchResult(batch, 'success', `Pinned ${validFilenames.length} image(s)`, '<i class="fas fa-thumbtack"></i>');
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
        galleryBatchResult(batch, 'error', 'Failed to pin images: ' + error.message, null, 'Pinning Failed');
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        galleryBatchEnd(batch);

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

    let batch = null;
    try {
        batch = galleryBatchBegin('Updating Preset Names', 'Updating preset names...');

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

            galleryBatchResult(batch, 'success', toastMessage, '<i class="fas fa-edit"></i>');
        } else {
            const action = newPresetName ? `with preset "${newPresetName}"` : '(preset cleared)';
            galleryBatchResult(batch, 'success', `Updated ${validFilenames.length} image(s) ${action}`, '<i class="fas fa-edit"></i>');
        }

    } catch (error) {
        console.error('Bulk change preset error:', error);
        galleryBatchResult(batch, 'error', 'Failed to update preset names: ' + error.message, null, 'Updating Preset Names Failed');
        // Clear selection on error to prevent stuck state
        clearSelection();
    } finally {
        galleryBatchEnd(batch);
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

        const folder = galleryViewFolder(currentGalleryView);
        const { done, shown } = await galleryTransfer('move', validFilenames,
            galleryTransferPlace(activeWorkspace, folder), galleryTransferPlace(workspaceId, folder),
            (names) => window.wsClient.moveFilesToWorkspace(names, workspaceId, null, moveType));
        if (shown) return;

        const workspace = workspaces[workspaceId];
        let itemType;
        if (isScrapsView) {
            itemType = 'scraps';
        } else if (isPinnedView) {
            itemType = 'pinned images';
        } else {
            itemType = 'images';
        }

        showGlassToast('success', null, `Moved ${done} ${itemType} to ${workspace.name}`, false, 5000, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
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

        // holdGalleryImageLoads: public/scripts/comp/galleryView.js — the batches' broadcasts wait
        // for this; the selection leaves the grid in one step once every batch is done
        holdGalleryImageLoads(validFilenames);
        let deleted = false;
        try {
            const transfer = await galleryTransfer('delete', validFilenames,
                galleryTransferPlace(activeWorkspace, galleryViewFolder(currentGalleryView)), null,
                (names) => window.wsClient.deleteImagesBulk(names));
            // the batches' answers as one
            const answers = transfer.values.filter(Boolean);
            responseData = answers.length ? {
                successful: answers.reduce((n, r) => n + (r.successful || 0), 0),
                failed: answers.reduce((n, r) => n + (r.failed || 0), 0),
                message: answers.length === 1 ? answers[0].message : null,
                results: answers.flatMap(r => r.results || [])
            } : null;
            deleted = !!(responseData && responseData.successful > 0);

            if (!transfer.shown) {
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
            }

            const removedNames = new Set(
                (responseData?.results || []).map((row) => row && row.filename).filter(Boolean)
            );
            const imagesToRemove = validFilenames
                .filter((fn) => removedNames.has(fn))
                .map(fn => findImageByFilename(fn))
                .filter(Boolean);
            if (imagesToRemove.length > 0) {
                removeMultipleImagesFromGallery(imagesToRemove);
            } else if (deleted) {
                switchGalleryView(currentGalleryView, true);
            }
        } finally {
            releaseGalleryImageLoads(validFilenames);
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

        if (typeof fileOperationProgress === 'undefined' || !fileOperationProgress.available()) {
            showManualLoading(true, 'Sending images to Sequenzia...');
        }
        const transfer = await galleryTransfer('move', validFilenames,
            galleryTransferPlace(activeWorkspace, galleryViewFolder(currentGalleryView)), { name: 'Sequenzia', path: '' },
            (names) => window.wsClient.sendToSequenziaBulk(names));
        if (transfer.shown) return;
        responseData = transfer.values[0];

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

        if (typeof fileOperationProgress === 'undefined' || !fileOperationProgress.available()) {
            showManualLoading(true, 'Moving images to scraps...');
        }
        const transfer = await galleryTransfer('move', validFilenames,
            galleryTransferPlace(activeWorkspace, 'Pictures'), galleryTransferPlace(activeWorkspace, 'Scraps'),
            (names) => window.wsClient.addScrapBulk(activeWorkspace, names));
        if (transfer.shown) return;
        responseData = transfer.values[0];

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

async function handleBulkUnscrap(event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to unscrap.');
        return;
    }

    const confirmed = await showConfirmationDialog(
        `Are you sure you want to unscrap ${selectedCount} selected image(s)?`,
        [
            { text: 'Unscrap', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to unscrap');
        }

        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        if (typeof fileOperationProgress === 'undefined' || !fileOperationProgress.available()) {
            showManualLoading(true, 'Unscraping images...');
        }
        const transfer = await galleryTransfer('move', validFilenames,
            galleryTransferPlace(activeWorkspace, 'Scraps'), galleryTransferPlace(activeWorkspace, 'Pictures'),
            (names) => window.wsClient.removeScrapBulk(activeWorkspace, names));
        if (transfer.shown) return;
        const responseData = transfer.values[0];
        const removedCount = responseData && responseData.removedCount != null
            ? responseData.removedCount
            : validFilenames.length;

        showGlassToast('success', null, `Unscraped ${removedCount} image(s)`, false, 5000, '<i class="fas fa-rotate-left"></i>');
    } catch (error) {
        console.error('Bulk unscrap error:', error);
        showError('Failed to unscrap images: ' + error.message);
        clearSelection();
    } finally {
        showManualLoading(false);
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

async function handleBulkScrapToWorkspace(workspaceId, workspaceName, event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to scrap.');
        return;
    }

    const confirmed = await showConfirmationDialog(
        `Scrap ${selectedCount} selected image(s) into workspace "${workspaceName}"?`,
        [
            { text: 'Scrap', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to scrap');
        }

        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        if (typeof fileOperationProgress === 'undefined' || !fileOperationProgress.available()) {
            showManualLoading(true, `Scraping images into ${workspaceName}...`);
        }
        const transfer = await galleryTransfer('move', validFilenames,
            galleryTransferPlace(activeWorkspace, galleryViewFolder(currentGalleryView)), galleryTransferPlace(workspaceId, 'Scraps'),
            (names) => window.wsClient.addScrapBulk(workspaceId, names));
        if (transfer.shown) return;
        const responseData = transfer.values[0];
        const addedCount = responseData && responseData.addedCount != null
            ? responseData.addedCount
            : validFilenames.length;

        showGlassToast('success', null, `Scrapped ${addedCount} image(s) into ${workspaceName}`, false, 5000, '<i class="fas fa-bin-recycle"></i>');
    } catch (error) {
        console.error('Bulk scrap to workspace error:', error);
        showError('Failed to scrap images: ' + error.message);
        clearSelection();
    } finally {
        showManualLoading(false);
        clearSelection();
        switchGalleryView(currentGalleryView, true);
    }
}

async function handleBulkUnscrapToWorkspace(workspaceId, workspaceName, event = null) {
    const selectedCount = getSelectedCount();
    if (selectedCount === 0) {
        showGlassToast('error', 'No Selection', 'Please select images to unscrap.');
        return;
    }

    const confirmed = await showConfirmationDialog(
        `Unscrap ${selectedCount} selected image(s) and move them to workspace "${workspaceName}"?`,
        [
            { text: 'Unscrap', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    let unscraped = false;
    try {
        const validFilenames = getSelectedFilenames().filter(filename => filename && typeof filename === 'string');

        if (validFilenames.length === 0) {
            throw new Error('No valid filenames to unscrap');
        }

        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        if (typeof fileOperationProgress === 'undefined' || !fileOperationProgress.available()) {
            showManualLoading(true, `Unscraping images into ${workspaceName}...`);
        }
        const transfer = await galleryTransfer('move', validFilenames,
            galleryTransferPlace(activeWorkspace, 'Scraps'), galleryTransferPlace(workspaceId, 'Pictures'),
            async (names) => {
                await window.wsClient.removeScrapBulk(activeWorkspace, names);
                unscraped = true;
                const response = await window.wsClient.moveFilesToWorkspace(names, workspaceId, activeWorkspace, 'files');
                if (response && response.success === false) {
                    throw new Error(response.error || 'Failed to move images');
                }
            });
        if (transfer.shown) return;

        showGlassToast('success', null, `Unscraped ${validFilenames.length} image(s) into ${workspaceName}`, false, 5000, '<i class="fas fa-rotate-left"></i>');
    } catch (error) {
        console.error('Bulk unscrap to workspace error:', error);
        const leftover = unscraped ? ' Images were unscraped into the current workspace.' : '';
        showError('Failed to unscrap images into ' + workspaceName + ': ' + error.message + leftover);
        clearSelection();
    } finally {
        showManualLoading(false);
        clearSelection();
        // invalidateGalleryImagesSyncState — public/scripts/comp/galleryImagesLoad.js
        invalidateGalleryImagesSyncState();
        await switchGalleryView(currentGalleryView, true);
    }
}

