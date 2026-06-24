/** Read-only mode + cache rebuild (Phase 2 batch 13). */
function disableReadOnlyFeatures() {
    // Disable destructive buttons
    const destructiveButtons = [
        'manualPreviewDeleteBtn',
        'bulkSelectAllBtn'
    ];

    destructiveButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.title = 'Not available in read-only mode';
            btn.style.opacity = '0.5';
        }
    });

    // Disable workspace management buttons if they exist
    const workspaceButtons = document.querySelectorAll('[data-action="workspace-delete"], [data-action="workspace-rename"], [data-action="workspace-create"]');
    workspaceButtons.forEach(btn => {
        btn.disabled = true;
        btn.title = 'Not available in read-only mode';
        btn.style.opacity = '0.5';
    });

    // Disable upload functionality
    const uploadInputs = document.querySelectorAll('input[type="file"]');
    uploadInputs.forEach(input => {
        input.disabled = true;
        input.title = 'Not available in read-only mode';
    });

    // Disable Genso management
    const textReplacementBtns = document.querySelectorAll('[data-action="save-text-replacements"], [data-action="delete-text-replacement"]');
    textReplacementBtns.forEach(btn => {
        btn.disabled = true;
        btn.title = 'Not available in read-only mode';
        btn.style.opacity = '0.5';
    });

    console.log('🔒 Read-only mode: Destructive features disabled');
}

async function clearAllCachesAndReload() {
    try {
        // Clear all caches
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        // Clear service worker registration
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => registration.unregister()));
        }

        await window.serviceWorkerManager.checkStaticFileUpdates();

    } catch (error) {
        console.error('Error clearing caches:', error);
        showGlassToast('error', 'Cache Clear Failed', 'Failed to clear caches: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Handle metadata cache rebuild
async function handleRefreshMetadataCache() {
    try {
        // Show confirmation dialog
        const confirmed = await showConfirmationDialog(
            'This will rebuild the metadata cache for all images. This may take a while depending on the number of images. Continue?',
            [
                { text: 'Rebuild Cache', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );

        if (!confirmed) return;

        const requestId = Date.now().toString();
        wsClient.send({
            type: 'rebuild_metadata_cache',
            requestId: requestId
        });

        // Set up response handler
        let lastPercentage = 0;
        let progressToastId = null;
        let cleaned = false;
        let timeoutId = null;
        let disconnectCleanup = null;

        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            wsClient.off('message', handleResponse);
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (disconnectCleanup) {
                wsClient.off('disconnected', disconnectCleanup);
                disconnectCleanup = null;
            }
        };

        const handleResponse = (message) => {
            if (message.requestId === requestId) {
                if (message.type === 'rebuild_metadata_cache_progress') {
                    // Show progress updates
                    const percentage = message.data.percentage || 0;

                    // Update toast if percentage changed
                    if (Math.floor(percentage) !== Math.floor(lastPercentage)) {
                        if (progressToastId) {
                            // Update existing toast with new progress and message
                            updateGlassToastComplete(progressToastId, {
                                type: 'info',
                                title: 'Metadata Cache',
                                message: `Rebuilding: ${message.data.current}/${message.data.total} files processed`
                            });

                            // Update progress bar
                            updateGlassToastProgress(progressToastId, percentage);
                        } else {
                            // Create initial toast with progress bar
                            progressToastId = showGlassToast(
                                'info',
                                'Metadata Cache',
                                'Starting rebuild...',
                                true, // showProgress
                                false, // no timeout
                                '<i class="fa-light fa-rotate fa-spin"></i>'
                            );
                        }
                        lastPercentage = percentage;
                    }
                } else if (message.type === 'rebuild_metadata_cache_response') {
                    cleanup();

                    // Close progress toast
                    if (progressToastId) {
                        removeGlassToast(progressToastId);
                    }

                    if (message.data.success) {
                        showGlassToast(
                            'success',
                            'Metadata Cache Rebuilt',
                            `${message.data.updatedCount} files updated successfully`,
                            false,
                            5000,
                            '<i class="fas fa-check-circle"></i>'
                        );
                    } else {
                        showGlassToast(
                            'error',
                            'Rebuild Failed',
                            message.data.error || 'Failed to rebuild metadata cache',
                            false,
                            5000,
                            '<i class="fas fa-exclamation-circle"></i>'
                        );
                    }
                }
            }
        };

        disconnectCleanup = () => {
            cleanup();
            if (progressToastId) {
                removeGlassToast(progressToastId);
            }
        };

        wsClient.on('message', handleResponse);
        wsClient.on('disconnected', disconnectCleanup);

        // Safety net if the server never responds (e.g. dropped request)
        timeoutId = setTimeout(() => {
            if (cleaned) return;
            cleanup();
            if (progressToastId) {
                removeGlassToast(progressToastId);
            }
            showGlassToast(
                'error',
                'Rebuild Timed Out',
                'Metadata cache rebuild did not complete. Try again.',
                false,
                5000,
                '<i class="fas fa-exclamation-circle"></i>'
            );
        }, 3600000);

    } catch (error) {
        console.error('Error rebuilding metadata cache:', error);
        showGlassToast(
            'error',
            'Rebuild Error',
            'Failed to rebuild metadata cache: ' + error.message,
            false,
            5000,
            '<i class="fas fa-exclamation-circle"></i>'
        );
    }
}

