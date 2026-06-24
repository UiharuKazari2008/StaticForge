/**
 * App WebSocket Handlers (Phase 2 — app.js refactor)
 *
 * wsClient.on event handlers for gallery, queue, workspace, receipts, etc.
 * Extracted from public/scripts/app.js batch 11.
 */

// Register main app initialization steps with WebSocket client
if (window.wsClient) {
    wsClient.on('disconnected', (event) => {
        console.log('🔌 WebSocket disconnected:', event);
    });

    // Handle server pings
    wsClient.on('ping', (data) => {
        if (data.data) {
            handleServerPing(data.data);
        }
    });

    // Helper function to check if message is update-related
    function isUpdateRelatedMessage(message) {
        if (!message) return false;
        const lowerMessage = message.toLowerCase();
        return lowerMessage.includes('update') ||
            lowerMessage.includes('available') ||
            lowerMessage.includes('download') ||
            lowerMessage.includes('install') ||
            lowerMessage.includes('upgrade');
    }

    // Handle system messages
    wsClient.on('system_message', (data) => {
        console.log('📢 System message received:', data);
        if (data.data && data.data.message) {
            const message = data.data.message;
            // Show system message as toast
            showGlassToast(data.data.level || 'info', null, message);
        }
    });

    // Handle notifications
    wsClient.on('notification', (data) => {
        console.log('🔔 Notification received:', data);
        if (data.data && data.data.message) {
            const message = data.data.message;
            showGlassToast(data.data.type || 'info', null, message);
        }
    });

    // Handle receipt notifications
    wsClient.on('receipt', (data) => {
        if (data.data && data.data.message) {
            const message = data.data.message;
            showGlassToast(data.data.type || 'info', null, message, false);
        }
    });

    // Local flag to skip next gallery refresh when we've already applied changes locally
    if (typeof window.skipNextGalleryRefresh === 'undefined') {
        window.skipNextGalleryRefresh = 0;
    }

    // Handle gallery updates
    wsClient.on('galleryUpdated', async (data) => {
        if (isGalleryWindowHidden()) {
            if (data.gallery) {
                // setActiveGalleryList: public/scripts/comp/galleryView.js
                setActiveGalleryList(data.gallery);
                syncServiceWorkerImageCacheRules();
            }
            return;
        };

        // Skip a refresh if we already applied the change locally (e.g., local delete/move)
        if (window.skipNextGalleryRefresh && window.skipNextGalleryRefresh > 0) {
            window.skipNextGalleryRefresh--;
            return;
        }
        // Update gallery data and refresh the view if it matches the updated view type
        if (data.viewType && data.gallery) {
            const oldImages = allImages;
            const newImages = data.gallery;
            const currentView = currentGalleryView || 'images';

            if (data.viewType !== currentView) {
                console.warn('Gallery updated event received but view type does not match');
                return;
            }

            // Detect changes and apply minimal updates
            const changes = detectGalleryChanges(oldImages, newImages);

            if (changes.type === 'full_reload') {
                // Complete reload needed
                setActiveGalleryList(newImages);
                syncServiceWorkerImageCacheRules();
                if (window.sortGalleryData) {
                    window.sortGalleryData();
                }
                triggerBuildGalleryNavigationCache();
                clearSelection();
                resetInfiniteScroll();
                displayCurrentPageOptimized();
                console.log('Gallery: Full reload performed');
            } else if (changes.type === 'append_top') {
                // New items added to top - append them
                setActiveGalleryList(newImages);
                syncServiceWorkerImageCacheRules();
                if (window.sortGalleryData) {
                    window.sortGalleryData();
                }
                triggerBuildGalleryNavigationCache();
                appendNewGalleryItems(changes.newItems);
                console.log(`Gallery: Appended ${changes.newItems.length} new items to top`);
            } else if (changes.type === 'shift_indexes') {
                // Gallery shifted - adjust indexes and add placeholders
                setActiveGalleryList(newImages);
                syncServiceWorkerImageCacheRules();
                if (window.sortGalleryData) {
                    window.sortGalleryData();
                }
                triggerBuildGalleryNavigationCache();
                shiftGalleryIndexes(changes.shiftAmount);
                console.log(`Gallery: Shifted indexes by ${changes.shiftAmount}`);
            } else {
                // No significant changes
                console.log('Gallery: No changes detected');
            }
        } else {
            console.warn('Gallery updated event received but data is missing or invalid:', data);
        }
    });

    // Gallery change detection and optimization functions
    function detectGalleryChanges(oldImages, newImages) {
        if (!oldImages || !newImages) {
            return { type: 'full_reload' };
        }

        // Check if lengths are very different (major change)
        if (Math.abs(oldImages.length - newImages.length) > 10) {
            return { type: 'full_reload' };
        }

        // Check if the first item changed (gallery shifted)
        if (oldImages.length > 0 && newImages.length > 0) {
            const oldFirst = oldImages[0];
            const newFirst = newImages[0];

            // If the first item is different, check if it's a shift
            if (oldFirst.original !== newFirst.original) {
                // Look for the old first item in the new array
                const oldFirstIndex = newImages.findIndex(img => img.original === oldFirst.original);
                if (oldFirstIndex > 0) {
                    // Found old first item at a new position - it's a shift
                    return {
                        type: 'shift_indexes',
                        shiftAmount: oldFirstIndex
                    };
                }
            }
        }

        // Check if new items were added to the top
        if (newImages.length > oldImages.length) {
            const addedCount = newImages.length - oldImages.length;
            const addedItems = newImages.slice(0, addedCount);

            // Verify these are actually new items (not just reordered)
            const existingOriginals = new Set(oldImages.map(img => img.original));
            const allAddedAreNew = addedItems.every(img => !existingOriginals.has(img.original));

            if (allAddedAreNew) {
                return {
                    type: 'append_top',
                    newItems: addedItems
                };
            }
        }

        // Check for other changes (deletions, reordering, etc.)
        if (oldImages.length !== newImages.length) {
            return { type: 'full_reload' };
        }

        // Check if items are in different order or different items
        for (let i = 0; i < oldImages.length; i++) {
            if (oldImages[i].original !== newImages[i].original) {
                return { type: 'full_reload' };
            }
        }

        // No changes detected
        return { type: 'no_change' };
    }

    function appendNewGalleryItems(newItems) {
        if (!newItems || newItems.length === 0) return;

        // Don't add new gallery items if manual modal is open and maximized
        if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

        // Don't add new gallery items if gallery is hidden in desktop mode
        if (isGalleryWindowHidden()) return;

        // Add each new item to the top of the gallery
        for (let i = newItems.length - 1; i >= 0; i--) {
            const newItem = createGalleryItem(newItems[i], i, true);
            newItem.classList.add('gallery-placeholder', 'fade-in');
            gallery.insertBefore(newItem, gallery.children[0]);

            // Wait for fade-in animation to finish
            newItem.addEventListener('animationend', function handler() {
                newItem.classList.remove('fade-in');
                newItem.classList.remove('gallery-placeholder');
                if (!newItem.querySelector('img')) {
                    addImgToGalleryItemAsync(newItem, newItems[i]);
                }
                newItem.classList.add('slide-in');
                newItem.addEventListener('animationend', function slideHandler() {
                    newItem.classList.remove('slide-in');
                    newItem.removeEventListener('animationend', slideHandler);
                });
                newItem.removeEventListener('animationend', handler);
            });
        }

        // Reindex the gallery after adding new items
        reindexGallery();
    }

    function shiftGalleryIndexes(shiftAmount) {
        if (!shiftAmount || shiftAmount <= 0) return;

        // Add placeholder items at the top for the shifted positions
        for (let i = 0; i < shiftAmount; i++) {
            const placeholderItem = document.createElement('div');
            placeholderItem.className = 'gallery-item gallery-placeholder';
            placeholderItem.dataset.index = i.toString();
            placeholderItem.dataset.filename = 'placeholder';
            gallery.insertBefore(placeholderItem, gallery.children[0]);
        }

        // Reindex the entire gallery to update all positions
        reindexGallery();

        // Reset infinite scroll since the gallery structure changed
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }

    // Handle receipt notifications
    wsClient.on('receipt_notification', (data) => {
        if (data.receipt && data.receipt?.cost > 0) {
            const receipt = data.receipt;
            let message = '';
            let type = 'info';
            let header = '';

            switch (receipt.type) {
                case 'generation':
                    header = 'Generation Receipt';
                    message = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'success';
                    break;
                case 'upscaling':
                    header = 'Upscaling Receipt';
                    message = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'success';
                    break;
                case 'vibe_encoding':
                    header = 'Vibe Encoding Receipt';
                    message = ` <i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'info';
                    break;
                case 'deposit':
                    header = 'Deposit Receipt';
                    message = `<i class="nai-anla"></i> +${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'success';
                    break;
                default:
                    header = 'Operation Receipt';
                    message = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                    type = 'info';
            }

            if (message) {
                let icon = '<i class="fas fa-file-invoice-dollar"></i>';
                if (receipt.type === 'generation') {
                    icon = '<i class="fas fa-sparkles"></i>';
                } else if (receipt.type === 'upscaling') {
                    icon = '<i class="fas fa-expand"></i>';
                } else if (receipt.type === 'deposit') {
                    icon = '<i class="fas fa-plus-circle"></i>';
                }

                showGlassToast(type, header, message, false, window.isDesktop ? false : 10000, icon);
            }
        }
    });

    // Handle workspace restoration when reconnecting
    wsClient.on('workspace_restored', (data) => {
        // Only process workspace events after app data is loaded
        if (!isAppDataReady()) {
            return;
        }

        if (data.workspace && data.message) {
            // Update the UI to show the restored workspace
            if (window.updateWorkspaceUI) {
                window.updateWorkspaceUI(data.workspace);
            }
        }
    });

    // Handle workspace data updates
    wsClient.on('workspace_data', (data) => {
        // Only process workspace events after app data is loaded
        if (!isAppDataReady()) {
            return;
        }

        if (data.data) {
            // Keep client workspace in sync with server after reconnect restore
            if (typeof activeWorkspace !== 'undefined' && data.data.id && activeWorkspace !== data.data.id) {
                activeWorkspace = data.data.id;
            }
            // Update the current workspace display
            if (window.currentWorkspace !== data.data.id) {
                window.currentWorkspace = data.data.id;

                // Update workspace selector if it exists
                const workspaceSelector = document.getElementById('workspace-selector');
                if (workspaceSelector) {
                    workspaceSelector.value = data.data.id;
                }

                // Update workspace name display
                const workspaceNameElement = document.getElementById('workspace-name');
                if (workspaceNameElement) {
                    workspaceNameElement.textContent = data.data.name || data.data.id;
                }
            }
        }
    });

    window.wsClient.on('presetUpdated', (message) => {
        handlePresetUpdate(message.data);
    });

    window.wsClient.on('queue_update', (data) => {
        // Update global queue status
        if (window.optionsData) {
            window.optionsData.queue_status = data.value;
        }

        // Update queue state variables
        if (data.value === 2) {
            isQueueStopped = true;
            isQueueProcessing = false;
        } else if (data.value === 1) {
            isQueueStopped = false;
            isQueueProcessing = true;
        } else {
            isQueueStopped = false;
            isQueueProcessing = false;
        }

        // Update generation button state
        updateManualGenerateBtnState();

        // Show notification if queue is blocked
        if (data.value === 2) {
            showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait.', false, 5000);
        } else if (data.value === 0 && (isQueueStopped || isQueueProcessing)) {
            // Queue was unblocked
            showGlassToast('success', 'Queue Unblocked', 'Generation is now available.', false, 3000);
        }
    });

    // Listen for queue status requests from other modules
    document.addEventListener('requestQueueStatus', (event) => {
        const queueStatus = {
            isBlocked: isQueueStopped || isQueueProcessing,
            isQueueStopped,
            isQueueProcessing,
            value: isQueueStopped ? 2 : (isQueueProcessing ? 1 : 0)
        };

        // Dispatch response event
        const responseEvent = new CustomEvent('queueStatusResponse', {
            detail: queueStatus
        });
        document.dispatchEvent(responseEvent);
    });
}
