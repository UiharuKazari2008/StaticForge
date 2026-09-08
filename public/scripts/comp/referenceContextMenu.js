// Reference Manager Context Menu Configuration
function createReferenceManagerContextMenuConfig() {
    return {
        maxHeight: true,
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fas fa-comment',
                        text: 'View Comments',
                        action: 'reference-manager-comment',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getCacheManagerImageFromElement(target);
                            if (!cacheImage) {
                                menuItem.disabled = true;
                                return;
                            }

                            const vibesWithComments = cacheImage.vibes?.filter(vibe => vibe.comment && vibe.comment.trim() !== '') || [];
                            const hasComments = vibesWithComments.length > 0;

                            if (!hasComments) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    }
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-external-link-alt',
                        text: 'Open in Window',
                        action: 'reference-manager-open-in-window',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getCacheManagerImageFromElement(target);
                            menuItem.disabled = !cacheImage;
                        }
                    },
                    {
                        icon: "nai-vibe-transfer",
                        text: "New Encoding",
                        action: 'reference-manager-vibe-encode',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getCacheManagerImageFromElement(target);
                            if (!cacheImage) {
                                menuItem.disabled = true;
                                return;
                            }

                            if (cacheImage.locked) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    },
                    {
                        icon: 'xai-icon',
                        text: 'New Session',
                        action: 'reference-manager-director',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getCacheManagerImageFromElement(target);
                            if (!cacheImage || cacheImage.isStandalone) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    },
                    {
                        icon: 'fas fa-image',
                        text: 'Set as Wallpaper',
                        action: 'reference-manager-set-wallpaper',
                        hidden: () => !document.body.classList.contains('desktop-mode')
                    },
                    {
                        icon: 'fas fa-arrow-down-left',
                        text: 'Add to Desktop...',
                        submenu: [
                            {
                                text: 'Base Image',
                                icon: 'nai-img2img',
                                action: 'reference-manager-create-shortcut-base'
                            },
                            {
                                text: 'Vibe',
                                icon: 'nai-vibe-transfer',
                                action: 'reference-manager-create-shortcut-vibe'
                            },
                            {
                                text: 'Precise Reference',
                                icon: 'nai-precise-reference',
                                action: 'reference-manager-create-shortcut-character'
                            }
                        ],
                        hidden: () => !document.body.classList.contains('desktop-mode')
                    },
                    {
                        icon: 'fas fa-plus',
                        text: 'Add to Studio as...',
                        hidden: () => {
                            const manualModal = document.getElementById('manualModal');
                            const isManualModalActive = manualModal && !manualModal.classList.contains('hidden');
                            return !window.isDesktop || !isManualModalActive;
                        },
                        submenu: [
                            {
                                text: 'Base Image',
                                icon: 'nai-img2img',
                                action: 'reference-manager-add-as-base',
                                loadfn: (menuItem, target) => {
                                    const cacheImage = getCacheManagerImageFromElement(target);
                                    menuItem.disabled = (!cacheImage) ? true : (cacheImage.isStandalone || false);
                                }
                            },
                            {
                                text: 'Vibe',
                                icon: 'nai-vibe-transfer',
                                action: 'reference-manager-add-as-vibe',
                                loadfn: (menuItem, target) => {
                                    const cacheImage = getCacheManagerImageFromElement(target);
                                    if (!cacheImage || window.currentMaskData) {
                                        menuItem.disabled = true;
                                        return;
                                    }

                                    // Check if there are available encodings for the current model
                                    const currentModel = getCurrentSelectedModel();
                                    let hasCompatibleEncodings = false;
                                    if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                                        hasCompatibleEncodings = cacheImage.vibes.some(vibe =>
                                            vibe.encodings && vibe.encodings.some(encoding =>
                                                encoding.model.toLowerCase() === currentModel.toLowerCase()
                                            )
                                        );
                                    }

                                    // Disable if no compatible encodings or no vibes at all
                                    menuItem.disabled = !hasCompatibleEncodings;
                                }
                            },
                            {
                                text: 'Precise Reference',
                                icon: 'nai-precise-reference',
                                action: 'reference-manager-add-as-character',
                                loadfn: (menuItem, target) => {
                                    const cacheImage = getCacheManagerImageFromElement(target);
                                    menuItem.disabled = (!cacheImage || !cacheImage.hash);
                                }
                            }
                        ]
                    }
                ]
            },
            {
                type: 'list',
                title: 'Management',
                items: [
                    {
                        icon: 'fas fa-planet-ringed',
                        text: 'Move to...',
                        optionsfn: getReferenceMoveWorkspaceOptions,
                        handlerfn: handleReferenceMoveWorkspaceAction,
                        openOnHover: false
                    },
                    {
                        icon: 'fas fa-fire',
                        text: 'Destroy',
                        optionsfn: getDeleteOptions,
                        handlerfn: handleDeleteAction,
                        className: 'context-menu-item-danger'
                    },
                    {
                        icon: 'fas fa-cog',
                        text: 'Manage Metadata',
                        action: 'reference-manager-manage'
                    }
                ]
            }
        ]
    };
}

// Create context menu configuration for reference browser gallery items
function createReferenceBrowserContextMenuConfig() {
    return {
        maxHeight: true,
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'nai-img2img',
                        tooltip: 'Add as Base Image',
                        action: 'reference-browser-add-base',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            if (!cacheImage || cacheImage.isStandalone) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    },
                    {
                        icon: 'nai-vibe-transfer',
                        tooltip: 'Add as Vibe',
                        action: 'reference-browser-add-vibe',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            if (!cacheImage) {
                                menuItem.disabled = true;
                                return;
                            }

                            // Check if there are available encodings for the current model
                            const currentModel = getCurrentSelectedModel();
                            let hasCompatibleEncodings = false;

                            if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                                hasCompatibleEncodings = cacheImage.vibes.some(vibe =>
                                    vibe.encodings && vibe.encodings.some(encoding =>
                                        encoding.model.toLowerCase() === currentModel.toLowerCase()
                                    )
                                );
                            }

                            if (hasCompatibleEncodings) {
                                menuItem.disabled = false;
                            } else if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = true;
                            }
                        }
                    },
                    {
                        icon: 'nai-precise-reference',
                        tooltip: 'Add as Precise Reference',
                        action: 'reference-browser-add-character',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            menuItem.disabled = !cacheImage;
                        }
                    },
                ]
            },
            {
                type: 'list',
                hidden: () => !document.body.classList.contains('desktop-mode'),
                items: [
                    {
                        icon: 'fas fa-external-link-alt',
                        text: 'Open in Window',
                        action: 'reference-browser-open-in-window',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            menuItem.disabled = !cacheImage;
                        }
                    },
                    {
                        icon: 'fas fa-arrow-down-left',
                        text: 'Add to Desktop...',
                        submenu: [
                            {
                                text: 'Base Image',
                                icon: 'nai-img2img',
                                action: 'reference-browser-create-shortcut-base'
                            },
                            {
                                text: 'Vibe',
                                icon: 'nai-vibe-transfer',
                                action: 'reference-browser-create-shortcut-vibe'
                            },
                            {
                                text: 'Precise Reference',
                                icon: 'nai-precise-reference',
                                action: 'reference-browser-create-shortcut-character'
                            }
                        ]
                    }
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: "mdi mdi-data-matrix-scan",
                        text: "New Encoding",
                        action: 'reference-browser-vibe-encode',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            if (!cacheImage) {
                                menuItem.disabled = true;
                                return;
                            }

                            if (cacheImage.locked) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    },
                    {
                        icon: 'xai-icon',
                        text: 'New Session',
                        action: 'reference-browser-director',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            if (!cacheImage || cacheImage.isStandalone) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    },
                    {
                        icon: 'fas fa-sync-alt',
                        text: 'Update Preview',
                        action: 'reference-browser-update-preview',
                        loadfn: (menuItem, target) => {
                            const cacheImage = getReferenceBrowserImageFromElement(target);
                            if (!cacheImage || cacheImage.isStandalone) {
                                menuItem.disabled = true;
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    }
                ]
            },
            {
                type: 'list',
                title: 'Quick Access',
                items: [
                    {
                        icon: 'fas fa-planet-ringed',
                        text: 'All Locations',
                        action: 'reference-browser-all-workspaces'
                    },
                    {
                        icon: 'nai-import',
                        text: 'Import Reference',
                        action: 'reference-browser-import'
                    },
                    {
                        icon: 'fas fa-cog',
                        text: 'Open Manager',
                        action: 'reference-browser-open-manager'
                    },
                    {
                        icon: 'nai-cross',
                        text: 'Cancel',
                        action: 'reference-browser-cancel'
                    }
                ]
            }
        ]
    };
}

// Helper function to get reference browser image from element
function getReferenceBrowserImageFromElement(element) {
    // The context menu is attached directly to the gallery item, so element should be the gallery item
    if (!element.classList.contains('cache-gallery-item')) {
        console.warn('Element is not a reference browser gallery item:', element);
        return null;
    }

    const hash = element.dataset.hash;
    if (!hash) {
        console.warn('Gallery item missing hash:', element);
        return null;
    }

    // Find the cache image data from the global cacheImages array
    if (!cacheImages || !Array.isArray(cacheImages)) {
        return null;
    }

    const cacheImage = cacheImages.find(img => img.hash === hash);
    if (!cacheImage) {
        console.warn('Could not find cache image with hash:', hash);
    }

    return cacheImage || null;
}

// Helper function to get cache manager image from element
function getCacheManagerImageFromElement(element) {
    const galleryItem = element && element.closest ? element.closest('.cache-manager-gallery-item') : null;
    if (!galleryItem) {
        console.warn('Element is not a gallery item:', element);
        return null;
    }

    const hash = galleryItem.dataset.hash;
    if (!hash) {
        console.warn('Gallery item missing hash:', element);
        return null;
    }

    // Find the cache image data from the global cacheManagerImages array
    const cacheImage = cacheManagerImages.find(img => img.hash === hash);
    if (!cacheImage) {
        console.warn('Could not find cache image with hash:', hash);
    }

    return cacheImage || null;
}

function getReferenceMoveWorkspaceOptions(target) {
    const cacheImage = getCacheManagerImageFromElement(target);
    if (!cacheImage) return [];

    const options = [];
    Object.values(workspaces).forEach(workspace => {
        if (workspace.id === cacheManagerCurrentWorkspace) {
            return;
        }

        const workspaceColor = workspace.color || '#102040';
        options.push({
            content: `
                <div class="workspace-option-content">
                    <div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                    <div class="workspace-name">${workspace.name}</div>
                </div>
            `,
            value: workspace.id,
            className: 'custom-dropdown-option'
        });
    });

    return options;
}

async function handleReferenceMoveWorkspaceAction(option, target, event) {
    const cacheImage = getCacheManagerImageFromElement(target);
    if (!cacheImage) {
        console.error('Could not find cache image for move operation');
        return;
    }

    const workspace = Object.values(workspaces).find(ws => ws.id === option.value);
    const workspaceName = workspace ? workspace.name : option.value;
    let message = `Move this reference to ${workspaceName}?`;
    if (cacheImage.hasVibes && !cacheImage.isStandalone) {
        message = `This item contains both a base image and vibe encodings. Both will be moved to ${workspaceName}. Continue?`;
    }

    const confirmed = await showConfirmationDialog(
        message,
        [
            { text: 'Move', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) return;

    const moved = await executeReferenceMove(cacheImage, option.value);
    if (moved) {
        await refreshReferenceBrowserIfOpen();
        await refreshReferenceManagerAfterVibeOperation();
    }
}

async function executeReferenceMove(cacheImage, targetWorkspace) {
    if (!cacheImage || !targetWorkspace) {
        console.error('Could not find cache image or target workspace for move operation');
        return false;
    }

    try {
        let response;

        if (cacheImage.isStandalone) {
            if (cacheImage.vibes && cacheImage.vibes.length > 0) {
                response = await wsClient.moveVibeImage(cacheImage.vibes[0].id, targetWorkspace, cacheManagerCurrentWorkspace);
            } else {
                throw new Error('Standalone image has no vibe data');
            }
        } else {
            response = await wsClient.moveReferences([cacheImage.hash], targetWorkspace, cacheManagerCurrentWorkspace);

            if (response.success && cacheImage.hasVibes) {
                const vibeMovePromises = [];
                for (const vibe of cacheImage.vibes) {
                    if (vibe.type === 'cache') {
                        vibeMovePromises.push(
                            wsClient.moveVibeImage(vibe.id, targetWorkspace, cacheManagerCurrentWorkspace)
                        );
                    }
                }

                if (vibeMovePromises.length > 0) {
                    try {
                        await Promise.all(vibeMovePromises);
                    } catch (vibeError) {
                        console.warn('Some vibe images failed to move:', vibeError);
                    }
                }
            }
        }

        if (!response.success) {
            throw new Error(`Failed to move image: ${response.message}`);
        }

        cacheManagerImages = cacheManagerImages.filter(img => img.hash !== cacheImage.hash);
        await loadCacheManagerImages();

        const targetWorkspaceObj = Object.values(workspaces).find(ws => ws.id === targetWorkspace);
        const workspaceName = targetWorkspaceObj ? targetWorkspaceObj.name : targetWorkspace;

        showGlassToast('success', 'Image Moved', `Image moved to ${workspaceName} workspace`);
        return true;
    } catch (error) {
        console.error('Error moving cache image:', error);
        showError('Failed to move image');
        return false;
    }
}

// Get delete options for the context menu
function getDeleteOptions(target) {
    const cacheImage = getCacheManagerImageFromElement(target);
    if (!cacheImage) return [];

    const options = [];

    // Build delete options based on image type and vibe count
    if (cacheImage.hasVibes && !cacheImage.isStandalone) {
        // Item has both base image and vibes
        options.push({
            text: 'Base Image',
            value: 'base',
            icon: 'nai-img2img',
            className: 'context-menu-item'
        });

        // Add general vibe deletion option
        options.push({
            text: 'Encodings',
            value: 'vibes',
            icon: 'nai-vibe-transfer',
            className: 'context-menu-item'
        });

        // Add delete all option
        options.push({
            text: 'Entire Reference',
            value: 'both',
            icon: 'fas fa-fire',
            className: 'context-menu-item-danger'
        });
    } else if (cacheImage.isStandalone) {
        // Standalone vibe - only offer vibe deletion
        options.push({
            text: 'Imported Encoding',
            value: 'vibes',
            icon: 'nai-vibe-transfer',
            className: 'context-menu-item-danger'
        });
    } else {
        // Base image only
        options.push({
            text: 'Base Image',
            value: 'base',
            icon: 'nai-img2img',
            className: 'context-menu-item-danger'
        });
    }

    return options;
}

// Handle delete action from context menu
async function handleDeleteAction(option, target, event) {
    const cacheImage = getCacheManagerImageFromElement(target);
    if (!cacheImage) {
        console.error('Could not find cache image for delete operation');
        return;
    }

    const deleteType = option.value;

    try {
        // Handle individual vibe deletion
        if (deleteType.startsWith('vibe_')) {
            const vibeId = deleteType.replace('vibe_', '');
            const vibe = cacheImage.vibes.find(v => v.id === vibeId);

            if (!vibe) {
                console.error('Vibe not found:', vibeId);
                return;
            }

            const vibeName = vibe.name || `Vibe ${cacheImage.vibes.indexOf(vibe) + 1}`;
            const confirmed = await showConfirmationDialog(
                `Are you sure you want to delete the vibe encoding "${vibeName}"? The base image will remain.`,
                [
                    { text: 'Delete', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                event
            );

            if (!confirmed) return;

            // Delete specific vibe
            const response = await wsClient.deleteVibeImage(vibeId, cacheManagerCurrentWorkspace);
            if (!response.success) {
                throw new Error(`Failed to delete vibe: ${response.message}`);
            }

            // Update the cache image locally
            cacheImage.vibes = cacheImage.vibes.filter(v => v.id !== vibeId);
            if (cacheImage.vibes.length === 0) {
                cacheImage.hasVibes = false;
            }

            // Refresh display
            if (!cacheBrowserContainer.classList.contains('hidden')) {
                await loadCacheManagerImages();
            } else {
                await loadCacheImages();
            }
            await refreshReferenceBrowserIfOpen();

            showGlassToast('success', 'Vibe Deleted', `Vibe encoding "${vibeName}" deleted successfully`);
        } else {
            // Handle regular delete types (base, vibes, both)
            let confirmMessage = '';
            switch (deleteType) {
                case 'base':
                    confirmMessage = 'Are you sure you want to delete the base image? Vibe encodings will remain.';
                    break;
                case 'vibes':
                    confirmMessage = cacheImage.isStandalone ?
                        'Are you sure you want to delete this vibe encoding?' :
                        'Are you sure you want to delete the vibe encoding(s)? Base image will remain.';
                    break;
                case 'both':
                    confirmMessage = 'Are you sure you want to delete both the base image and all vibe encodings?';
                    break;
            }

            const confirmed = await showConfirmationDialog(confirmMessage, [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ], event);

            if (!confirmed) return;

            // Perform the delete operation
            await deleteReferenceImage(cacheImage, cacheManagerCurrentWorkspace, async () => {
                // Remove from local array
                cacheManagerImages = cacheManagerImages.filter(img => img.hash !== cacheImage.hash);
                // Refresh display
                if (!cacheBrowserContainer.classList.contains('hidden')) {
                    await loadCacheManagerImages();
                } else {
                    await loadCacheImages();
                }
                await refreshReferenceBrowserIfOpen();
            }, deleteType);
        }

        // Show success message for regular delete types
        let successMessage = '';
        switch (deleteType) {
            case 'base':
                successMessage = 'Base image deleted successfully';
                break;
            case 'vibes':
                successMessage = cacheImage.isStandalone ?
                    'Vibe encoding deleted successfully' :
                    'Vibe encoding(s) deleted successfully';
                break;
            case 'both':
                successMessage = 'Image and all vibe encodings deleted successfully';
                break;
        }

        showGlassToast('success', 'Item Deleted', successMessage);

    } catch (error) {
        console.error('Error deleting cache image:', error);
        showError('Failed to delete item');
    }
}

let referenceManagerContextMenuWired = false;
let referenceBrowserContextMenuWired = false;
let referenceManagerModalScopeWired = false;

function wireReferenceManagerModalListenerScope() {
    if (referenceManagerModalScopeWired) return;
    referenceManagerModalScopeWired = true;

    if (cacheManagerModal) {
        // attachModalListeners — modalListenerScope.js; closeAllDropdownsInRoot — dropdown.js
        attachModalListeners(cacheManagerModal, (signal) => {
            document.addEventListener('contextMenuAction', handleReferenceManagerContextMenuAction, { signal });
            document.addEventListener('contextMenuAction', handleReferenceBrowserContextMenuAction, { signal });
            signal.addEventListener('abort', () => {
                closeAllDropdownsInRoot(cacheManagerModal);
            }, { once: true });
        });
    }

    const manualModal = document.getElementById('manualModal');
    if (manualModal) {
        attachModalListeners(manualModal, (signal) => {
            document.addEventListener('paste', handleClipboardPaste, { signal });
            signal.addEventListener('abort', () => {
                if (vibeReferencesContainer) {
                    vibeReferencesContainer.querySelectorAll('.vibe-reference-item').forEach((item) => {
                        teardownVibeReferenceItem(item);
                    });
                }
            }, { once: true });
        });
    }
}

// Initialize context menu for reference manager items
function initializeReferenceManagerContextMenu() {
    if (referenceManagerContextMenuWired) {
        return;
    }
    if (!contextMenu) {
        console.warn('Context menu system not available');
        return;
    }
    referenceManagerContextMenuWired = true;

    // Create and store the context menu configuration
    const contextMenuConfig = createReferenceManagerContextMenuConfig();
    window.referenceManagerContextMenuConfig = contextMenuConfig;
}

// Initialize context menu for reference browser items
function initializeReferenceBrowserContextMenu() {
    if (referenceBrowserContextMenuWired) {
        return;
    }
    if (!contextMenu) {
        console.warn('Context menu system not available');
        return;
    }
    referenceBrowserContextMenuWired = true;

    // Create and store the context menu configuration
    const contextMenuConfig = createReferenceBrowserContextMenuConfig();
    window.referenceBrowserContextMenuConfig = contextMenuConfig;

    // Attach context menus to any existing gallery items (in case browser was refreshed while open)
    attachContextMenuToBrowserItems();
}

// Attach context menu only to cache manager gallery items within the visible modal
function attachContextMenuToManagerItems() {
    if (!contextMenu || !window.referenceManagerContextMenuConfig || !cacheManagerModal) return;

    // Only attach if modal is visible
    if (cacheManagerModal.classList.contains('hidden')) return;

    // Find cache manager gallery items within the modal that don't already have context menu attached
    const modalGallery = cacheManagerModal.querySelector('#cacheManagerGallery');
    if (!modalGallery) return;

    const galleryItems = modalGallery.querySelectorAll('.cache-manager-gallery-item:not([data-context-menu-attached])');

    galleryItems.forEach(item => {
        if (item.dataset.contextMenu === 'reference-manager-item') {
            contextMenu.attachToElement(item, window.referenceManagerContextMenuConfig);
            item.setAttribute('data-context-menu-attached', 'true');
        } else {
            console.warn('Gallery item missing correct data-context-menu attribute');
        }
    });
}

// Detach context menu from all cache manager gallery items
function detachContextMenuFromManagerItems() {
    if (!contextMenu) return;

    // Find all cache manager gallery items that have context menu attached
    const attachedItems = document.querySelectorAll('.cache-manager-gallery-item[data-context-menu-attached]');

    attachedItems.forEach(item => {
        contextMenu.detachFromElement(item);
        item.removeAttribute('data-context-menu-attached');
    });
}

// Attach context menu to reference browser gallery items
function attachContextMenuToBrowserItems() {
    if (!contextMenu || !window.referenceBrowserContextMenuConfig || !cacheBrowserContainer) return;

    // Find cache gallery items within the browser that don't already have context menu attached
    const galleryItems = cacheBrowserContainer.querySelectorAll('.cache-gallery-item:not([data-context-menu-attached])');

    galleryItems.forEach(item => {
        contextMenu.attachToElement(item, window.referenceBrowserContextMenuConfig);
        item.setAttribute('data-context-menu-attached', 'true');
    });
}

// Detach context menu from all reference browser gallery items
function detachContextMenuFromBrowserItems() {
    if (!contextMenu) return;

    // Find all reference browser gallery items that have context menu attached
    const attachedItems = document.querySelectorAll('.cache-gallery-item[data-context-menu-attached]');

    attachedItems.forEach(item => {
        contextMenu.detachFromElement(item);
        item.removeAttribute('data-context-menu-attached');
    });
}

// Handle context menu actions for reference manager items
function handleReferenceManagerContextMenuAction(event) {
    const { action, target } = event.detail;

    // Only handle actions that are specific to reference manager gallery items
    const referenceManagerActions = [
        'reference-manager-comment',
        'reference-manager-vibe-encode',
        'reference-manager-director',
        'reference-manager-open-in-window',
        'reference-manager-manage',
        'reference-manager-set-wallpaper',
        'reference-manager-create-shortcut-base',
        'reference-manager-create-shortcut-vibe',
        'reference-manager-create-shortcut-character',
        'reference-manager-add-as-base',
        'reference-manager-add-as-vibe',
        'reference-manager-add-as-character'
    ];

    if (!referenceManagerActions.includes(action)) {
        return; // Silently ignore non-reference-manager actions
    }

    // Only process actions that originate from within the cache manager modal
    if (!target.closest('#cacheManagerModal')) {
        return; // Silently ignore actions from outside the modal
    }

    // Get the cache image from the gallery item
    const cacheImage = getCacheManagerImageFromElement(target);

    if (!cacheImage) {
        console.error('Could not find cache image data for context menu action');
        return;
    }

    // Handle the action using the same functions as the existing manager buttons
    switch (action) {
        case 'reference-manager-comment':
            const vibesWithComments = cacheImage.vibes.filter(vibe => vibe.comment && vibe.comment.trim() !== '');
            showVibesCommentsDialog(vibesWithComments);
            break;
        case 'reference-manager-vibe-encode':
            if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                // Use 'ie' mode to add additional IEs to existing vibe
                showVibeEncodingModal('ie', cacheImage.vibes[0]);
            } else {
                // Use 'reference' mode to create new vibe from cache image
                showVibeEncodingModal('reference', cacheImage);
            }
            break;
        case 'reference-manager-director':
            createDirectorSessionWithImage(cacheImage);
            break;
        case 'reference-manager-open-in-window': {
            const viewer = openReferenceImageInViewer(cacheImage);
            if (viewer && viewer.element) {
                viewer.element.dataset.cacheImageData = JSON.stringify(cacheImage);
            }
            break;
        }
        case 'reference-manager-manage':
            showManageReferenceModal(cacheImage);
            break;
        case 'reference-manager-set-wallpaper':
            // Open desktop settings modal with this image
            openDesktopSettingsModal(`cache:${cacheImage.hash}`);
            break;
        case 'reference-manager-create-shortcut-base':
            createDesktopShortcutFromReference(cacheImage, 'base');
            break;
        case 'reference-manager-create-shortcut-vibe':
            createDesktopShortcutFromReference(cacheImage, 'vibe');
            break;
        case 'reference-manager-create-shortcut-character':
            createDesktopShortcutFromReference(cacheImage, 'character');
            break;
        case 'reference-manager-add-as-base':
            addAsBaseImage(cacheImage);
            break;
        case 'reference-manager-add-as-vibe':
            addAsVibeReference(cacheImage);
            break;
        case 'reference-manager-add-as-character':
            addAsCharacterReference(cacheImage);
            break;
    }
}

// Handle context menu actions for reference browser items
function handleReferenceBrowserContextMenuAction(event) {
    const { action, target } = event.detail;

    // Only handle actions that are specific to reference browser gallery items
    const referenceBrowserActions = [
        'reference-browser-add-base',
        'reference-browser-add-vibe',
        'reference-browser-add-character',
        'reference-browser-vibe-encode',
        'reference-browser-director',
        'reference-browser-update-preview',
        'reference-browser-all-workspaces',
        'reference-browser-open-manager',
        'reference-browser-import',
        'reference-browser-cancel',
        'reference-browser-open-in-window',
        'reference-browser-create-shortcut-base',
        'reference-browser-create-shortcut-vibe',
        'reference-browser-create-shortcut-character'
    ];

    if (!referenceBrowserActions.includes(action)) {
        return; // Silently ignore non-reference-browser actions
    }

    // Only process actions that originate from within the cache browser container
    if (!target.closest('#cacheBrowserContainer')) {
        return; // Silently ignore actions from outside the browser
    }

    // Get the cache image from the gallery item
    const cacheImage = getReferenceBrowserImageFromElement(target);

    if (!cacheImage) {
        console.error('Could not find cache image data for context menu action');
        return;
    }

    // Handle the action using the same functions as the existing browser buttons
    switch (action) {
        case 'reference-browser-add-base':
            addAsBaseImage(cacheImage);
            break;
        case 'reference-browser-add-vibe':
            addAsVibeReference(cacheImage);
            break;
        case 'reference-browser-add-character':
            addAsCharacterReference(cacheImage);
            break;
        case 'reference-browser-vibe-encode':
            if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                // Use 'ie' mode to add additional IEs to existing vibe
                showVibeEncodingModal('ie', cacheImage.vibes[0]);
            } else {
                // Use 'reference' mode to create new vibe from cache image
                showVibeEncodingModal('reference', cacheImage);
            }
            break;
        case 'reference-browser-director':
            createDirectorSessionWithImage(cacheImage);
            break;
        case 'reference-browser-update-preview':
            replaceReferenceWithLastGenerated(cacheImage);
            break;
        case 'reference-browser-all-workspaces':
            toggleShowAllReferences();
            break;
        case 'reference-browser-open-manager':
            showCacheManagerModal();
            break;
        case 'reference-browser-import':
            unifiedUploadModalManager.show();
            break;
        case 'reference-browser-cancel':
            hideCacheBrowser();
            break;
        case 'reference-browser-create-shortcut-base':
            createDesktopShortcutFromReference(cacheImage, 'base');
            break;
        case 'reference-browser-create-shortcut-vibe':
            createDesktopShortcutFromReference(cacheImage, 'vibe');
            break;
        case 'reference-browser-create-shortcut-character':
            createDesktopShortcutFromReference(cacheImage, 'character');
            break;

        case 'reference-browser-open-in-window':
            // Open image in a new image viewer window with full cache image data
            const viewer = openReferenceImageInViewer(cacheImage);
            if (viewer && viewer.element) {
                // Store the full cache image data in the modal's dataset for future features
                viewer.element.dataset.cacheImageData = JSON.stringify(cacheImage);
            }
            break;
    }
}


async function deleteCacheManagerImage(cacheImage, workspace) {
    await deleteReferenceImage(cacheImage, workspace || cacheManagerCurrentWorkspace, async () => {
        // Remove from local array
        cacheManagerImages = cacheManagerImages.filter(img => img.hash !== cacheImage.hash);
        // Refresh display
        if (!cacheBrowserContainer.classList.contains('hidden')) {
            await loadCacheManagerImages();
        } else {
            await loadCacheImages();
        }
        displayCacheManagerImages();
        await refreshReferenceBrowserIfOpen();
    }, null); // No deleteTypeOverride - use default dialog
}
