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
    if (typeof fetchLocalUpscaleModels === 'function') {
        await fetchLocalUpscaleModels();
    }
    const confirmed = await showCreditCostDialog(upscaleInfo.cost, event, upscaleInfo.outputResolution, true, width, height, isFreeUpscaling);

    if (!confirmed) {
        return;
    }

    // Extract upscaler and scale from confirmation result
    const upscaler = confirmed.upscaler || 'novelai';
    const scale = confirmed.scale || 4;
    const localModel = confirmed.model || null;

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
            backend: upscaler === 'local' ? 'local' : upscaler,
            scale: scale,
            model: localModel,
            localUpscaleModel: localModel,
            localUpscaleScale: scale
        };

        // Upscale image via WebSocket
        try {
            let result;
            try {
                result = await window.wsClient.upscaleImage(upscaleParams);
            } catch (error) {
                if (upscaler === 'local' && typeof isLocalWorkerOfflineError === 'function' && isLocalWorkerOfflineError(error) && upscaleInfo.available) {
                    const useNai = await confirmNaiUpscaleFallback(error);
                    if (!useNai) throw error;
                    result = await window.wsClient.upscaleImage({
                        filename: filename,
                        workspace: activeWorkspace || null,
                        upscaler: 'novelai',
                        backend: 'nai',
                        scale: 4
                    });
                } else {
                    throw error;
                }
            }

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

                // Stamp the Studio preview only when this upscale is that preview.
                // A gallery upscale of a different file must leave the last Studio image alone.
                const preview = window.currentManualPreviewImage;
                const sourceName = image.original || image.filename || image.upscaled;
                const previewNames = preview
                    ? [preview.original, preview.filename, preview.upscaled]
                    : [];
                if (preview && sourceName && previewNames.indexOf(sourceName) !== -1) {
                    preview.upscaled = filename;
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

// Create Animation entry point (gallery, image viewer, Studio preview menu, Enhance):
// opens the eMotion LIVE desktop app with the image preloaded instead of a popup.
// openEmotion: public/scripts/comp/desktop-apps/emotion.js
function animateImage(image, event = null) {
    const filename = image && (image.original || image.filename || image.upscaled);
    if (!filename) {
        showError('No valid filename found in image object');
        return;
    }
    openEmotion({ filename, source: image });
}


// ---- Animated results (eMotion GIF/WebM/MP4) -----------------------------------------------
// These have no NovelAI metadata (modules/imageAnimation.js saves the GIF as the gallery file
// with a DB-only receipt: generation_type 'animated', formats, source_filename), so NAI-only
// menu actions (Studio, Enhance, Upscale, Properties, Create Animation, Recast...) are hidden
// for them and replaced by Open in eMotion / Open in Media Player.
const ANIMATED_RESULT_EXT_RE = /\.(gif|webm|mp4)$/i;

function animatedResultFilename(image) {
    if (!image) return '';
    if (typeof image === 'string') return image;
    return String(image.original || image.filename || image.upscaled || '');
}

function animatedResultReceipt(image) {
    const md = image && typeof image === 'object' ? (image.metadata || image) : null;
    if (!md || typeof md !== 'object') return null;
    const receipt = md.receipt || md.forge_receipt || md;
    if (receipt && (receipt.generation_type === 'animated' || receipt.type === 'animate')) return receipt;
    return null;
}

function isAnimatedResultImage(image) {
    return ANIMATED_RESULT_EXT_RE.test(animatedResultFilename(image)) || !!animatedResultReceipt(image);
}

// Sibling files saved next to the GIF: <source>_animate_<job8>.{gif,webm,mp4,webp}.
function animatedResultFormats(image) {
    const receipt = animatedResultReceipt(image);
    if (receipt && receipt.formats) return receipt.formats;
    const name = animatedResultFilename(image);
    const base = name.replace(/\.[^.]+$/, '');
    if (!/_animate_[0-9a-f]{8}$/i.test(base)) {
        const ext = (name.match(ANIMATED_RESULT_EXT_RE) || [])[1];
        return ext ? { [ext.toLowerCase()]: name } : {};
    }
    // Older results have no webm; openAnimatedResultInVideoPlayer falls back to mp4.
    return { gif: base + '.gif', webm: base + '.webm', mp4: base + '.mp4' };
}

function animatedResultSource(image) {
    const receipt = animatedResultReceipt(image);
    if (receipt && receipt.source_filename) return receipt.source_filename;
    const base = animatedResultFilename(image).replace(/\.[^.]+$/, '');
    const m = base.match(/^(.*)_animate_[0-9a-f]{8}$/i);
    return m ? m[1] + '.png' : null;
}

function openAnimatedResultInEmotion(image) {
    const source = animatedResultSource(image);
    // openEmotion: public/scripts/comp/desktop-apps/emotion.js
    openEmotion(source ? { filename: source } : {});
}

async function openAnimatedResultInVideoPlayer(image) {
    const formats = animatedResultFormats(image);
    const candidates = [formats.webm, formats.mp4].filter(Boolean);
    for (const name of candidates) {
        const url = localGalleryImageUrl(name);
        try {
            const head = await fetch(url, { method: 'HEAD', credentials: 'same-origin' });
            if (!head.ok) continue;
        } catch (_err) {
            continue;
        }
        // openDesktopVideoPlayerUrl (= openDesktopMediaPlayerUrl): public/scripts/comp/desktop-apps/mediaPlayer.js
        openDesktopVideoPlayerUrl(url, name);
        return;
    }
    showError('No video copy found for this animation');
}

// Context-menu items shared by gallery / viewer / Studio preview for animated results.
function buildAnimatedResultMenuItems(getImage, actionPrefix = '') {
    return [
        {
            icon: 'fas fa-film',
            text: 'Open in eMotion',
            action: actionPrefix + 'open-in-emotion',
            hidden: () => !isAnimatedResultImage(getImage())
        },
        {
            icon: 'fas fa-play',
            text: 'Open in Media Player',
            action: actionPrefix + 'open-in-video-player',
            hidden: () => !isAnimatedResultImage(getImage())
        }
    ];
}

// Actions that need NovelAI metadata or a PNG; hidden for animated results.
const NAI_ONLY_MENU_ACTIONS = new Set([
    'reroll', 'copy', 'modify', 'use-as-compare-source', 'expand-canvas', 'enhance', 'upscale',
    'animate', 'create-animation', 'view-image-data', 'start-chat', 'ask-wren', 'publish-to-explorer',
    'set-wallpaper', 'create-reference', 'creator', 'inspect-prompts', 'expand', 'copy-lookback',
    'transparent-background'
]);

// Mutates a contextMenu config: hides NAI-only items (and the "Original" submenu) when
// getImage() is an animated result, and inserts Open in eMotion / Open in Media Player
// right after the "open in window" style entry (or at the top of the first list).
function applyAnimatedResultMenuFilter(config, getImage, actionPrefix = '') {
    if (!config || !Array.isArray(config.sections)) return config;
    const isAnim = () => isAnimatedResultImage(getImage());
    const strip = (action) => String(action || '').replace(actionPrefix, '');
    const wrapHidden = (item) => {
        const prev = item.hidden;
        item.hidden = () => isAnim() || (typeof prev === 'function' ? prev() : !!prev);
    };
    let inserted = false;
    for (const section of config.sections) {
        const list = section.items || section.icons;
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (!item) continue;
            const action = strip(item.action);
            if (NAI_ONLY_MENU_ACTIONS.has(action) || (item.submenu && item.text === 'Original') || item.text === 'Transparent Background' || item.text === 'PhaseWalker') {
                wrapHidden(item);
            }
        }
        if (!inserted && section.items) {
            const idx = section.items.findIndex((it) => it && /open-in-window|lightbox/.test(strip(it.action)));
            section.items.splice(idx >= 0 ? idx + 1 : 0, 0, ...buildAnimatedResultMenuItems(getImage, actionPrefix));
            inserted = true;
        }
    }
    return config;
}

// Returns true when the action was an animated-result action and was handled.
function handleAnimatedResultMenuAction(action, image, actionPrefix = '') {
    const a = String(action || '').replace(actionPrefix, '');
    if (a === 'open-in-emotion') { openAnimatedResultInEmotion(image); return true; }
    if (a === 'open-in-video-player') { void openAnimatedResultInVideoPlayer(image); return true; }
    return false;
}
