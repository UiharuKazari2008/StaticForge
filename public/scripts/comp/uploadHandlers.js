/** Gallery + clipboard upload handlers (Phase 2 batch 13). */
async function handleImageUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Filter for image files
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const nonImageFiles = files.filter(file => !file.type.startsWith('image/'));

    if (nonImageFiles.length > 0) {
        showGlassToast('warning', 'Invalid Files', `${nonImageFiles.length} non-image files were skipped`, false, undefined, '<i class="fas fa-file-circle-question"></i>');
    }

    if (imageFiles.length === 0) {
        showGlassToast('error', 'No Images', 'Please select image files only', false, undefined, '<i class="fas fa-file-circle-xmark"></i>');
        return;
    }

    await uploadImages(imageFiles);

    // Clear the input so the same files can be selected again
    event.target.value = '';
}

// Handle clipboard paste
async function handleClipboardBlueprintText(text) {
    try {
        const data = JSON.parse(text);
        const isNovelAI = data && (
            (data.source && data.source.includes('NovelAI')) ||
            data.v4_prompt ||
            data.signed_hash ||
            data.request_type === 'PromptGenerateRequest' ||
            data.request_type === 'Img2ImgRequest'
        );

        if (!isNovelAI) {
            console.log('Clipboard text is not a NovelAI blueprint');
            return;
        }

        const toastId = showGlassToast('info', 'Loading Blueprint', 'Loading blueprint from clipboard...', true, false, '<i class="nai-import"></i>');

        try {
            if (!data.source) {
                data.source = 'NovelAI';
            }

            const transformedMetadata = window.transformMetadataForEditor(data);
            await openManualModalWithContent({
                type: 'metadata',
                data: transformedMetadata
            });

            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Blueprint Loaded',
                message: 'Successfully loaded blueprint from clipboard',
                customIcon: '<i class="nai-check"></i>',
                showProgress: false
            });
        } catch (error) {
            console.error('Error loading blueprint:', error);
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Blueprint Load Failed',
                message: 'Failed to load blueprint: ' + error.message,
                customIcon: '<i class="nai-cross"></i>',
                showProgress: false
            });
        }
    } catch (e) {
        console.log('Clipboard text is not valid JSON');
    }
}

async function handleClipboardPaste(event) {
    // Check if user is typing in an input field - don't intercept paste in that case
    const activeElement = document.activeElement;
    const isTypingInField = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );

    // If user is typing, let the default paste behavior happen
    if (isTypingInField) {
        return;
    }

    const clipboardItems = event.clipboardData?.items;
    if ((!clipboardItems || clipboardItems.length === 0) && isAndroidClipboardBridgeActive()) {
        event.preventDefault();
        try {
            const result = await readClipboard();
            if (result.empty) return;

            const imageFile = getPrimaryImageFileFromClipboardResult(result);
            if (imageFile) {
                await uploadImages([imageFile]);
                return;
            }

            const text = getPrimaryTextFromClipboardResult(result);
            if (text) {
                await handleClipboardBlueprintText(text);
            }
        } catch (error) {
            console.warn('📱 Android clipboard paste failed:', error);
        }
        return;
    }

    if (!clipboardItems) return;

    // First check for text/JSON data (blueprint)
    for (let item of clipboardItems) {
        if (item.type === 'text/plain') {
            event.preventDefault();
            item.getAsString(async (text) => {
                await handleClipboardBlueprintText(text);
            });
            return;
        }
    }

    // If no text data found, check for images
    for (let item of clipboardItems) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
                await uploadImages([file]);
            }
            break;
        }
    }
}

document.addEventListener('workspaceUpdated', () => {
    updateWorkspaceTrayIcon();
    updateAndroidNotificationBody();
    clearAndroidNotificationImage();
});

// Upload multiple images to server
async function uploadImages(files) {
    if (files.length === 0) return;

    const toastId = showGlassToast('info', 'Uploading Images', `Starting upload of ${files.length} images...`, true);

    try {
        const uploadPromises = files.map(async (file, index) => {
            const base64 = await fileToBase64(file);
            const batchInfo = {
                currentIndex: index,
                totalCount: files.length
            };
            return window.wsClient.uploadWorkspaceImage(base64, activeWorkspace, file.name, batchInfo);
        });

        const results = await Promise.all(uploadPromises);

        const successCount = results.filter(r => r.success).length;
        const errorCount = results.length - successCount;

        if (errorCount > 0) {
            updateGlassToastComplete(toastId, {
                type: 'warning',
                title: 'Upload Complete',
                message: `Successfully uploaded ${successCount} images, ${errorCount} failed`,
                customIcon: '<i class="fas fa-thumbtack"></i>',
                showProgress: false
            });
        } else {
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Upload Complete',
                message: `Successfully uploaded ${successCount} images`,
                customIcon: '<i class="fas fa-thumbtack"></i>',
                showProgress: false
            });
        }

        // Refresh gallery to show the new images - gallery updates are broadcast automatically by WebSocket
        setTimeout(async () => {
            await loadGallery();
        }, 1000);

    } catch (error) {
        console.error('Upload error:', error);
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Upload Failed',
            message: error.message,
            customIcon: '<i class="fas fa-thumbtack"></i>',
            showProgress: false
        });
    }
}

