// PhotoSwipe Lightbox Implementation
let lightbox = null;
let currentImageIndex = 0;

const PHOTO_SWIPE_WINDOW_MODE_KEY = 'photoSwipeWindowMode';

function getPhotoSwipeShell() {
    return document.getElementById('photoSwipeWindow');
}

function getPhotoSwipeMount() {
    return document.getElementById('photoSwipeMount');
}

/** Viewport size for PhotoSwipe when rooted in #photoSwipeMount (public/dist/photoswipe) */
function getPhotoSwipeMountViewportSize() {
    const mount = getPhotoSwipeMount();
    if (!mount) {
        return { x: document.documentElement.clientWidth, y: window.innerHeight };
    }
    return {
        x: Math.max(1, Math.round(mount.clientWidth)),
        y: Math.max(1, Math.round(mount.clientHeight))
    };
}

/** Thumb bounds from dist are viewport-absolute; opener math uses mount-sized viewport — translate into mount space */
function adjustThumbBoundsForPhotoSwipeMount(thumbBounds) {
    if (!thumbBounds || !document.body.classList.contains('desktop-mode')) {
        return thumbBounds;
    }
    const mount = getPhotoSwipeMount();
    if (!mount) {
        return thumbBounds;
    }
    const mr = mount.getBoundingClientRect();
    const inner = thumbBounds.innerRect;
    return {
        x: thumbBounds.x - mr.left,
        y: thumbBounds.y - mr.top,
        w: thumbBounds.w,
        innerRect: inner
            ? { w: inner.w, h: inner.h, x: inner.x, y: inner.y }
            : undefined
    };
}

/** public/dist/photoswipe — _convertEventPosToPoint uses pageX/Y minus offset; align with mount position */
function syncPhotoSwipeContainedScrollOffset(pswp) {
    if (!pswp || pswp.isDestroying || !document.body.classList.contains('desktop-mode')) {
        return;
    }
    const mount = getPhotoSwipeMount();
    if (!mount || !pswp.element || !mount.contains(pswp.element)) {
        return;
    }
    const r = mount.getBoundingClientRect();
    pswp.setScrollOffset(window.scrollX + r.left, window.scrollY + r.top);
}

let photoSwipeMountResizeObserver = null;

function disconnectPhotoSwipeMountResizeObserver() {
    if (!photoSwipeMountResizeObserver) {
        return;
    }
    photoSwipeMountResizeObserver.disconnect();
    photoSwipeMountResizeObserver = null;
}

function ensurePhotoSwipeMountResizeObserver() {
    const mount = getPhotoSwipeMount();
    if (!mount || photoSwipeMountResizeObserver) {
        return;
    }
    photoSwipeMountResizeObserver = new ResizeObserver(() => {
        const p = window.pswp;
        if (!p || !p.isOpen || p.isDestroying) {
            return;
        }
        requestAnimationFrame(() => {
            if (!p.isOpen || p.isDestroying) {
                return;
            }
            syncPhotoSwipeContainedScrollOffset(p);
            p.updateSize(true);
        });
    });
    photoSwipeMountResizeObserver.observe(mount);
}

function syncPhotoSwipeShellWindowedClassFromStorage() {
    const shell = getPhotoSwipeShell();
    if (!shell) return;
    const mode = localStorage.getItem(PHOTO_SWIPE_WINDOW_MODE_KEY);
    if (mode === 'maximized') {
        shell.classList.remove('windowed');
        clearPhotoSwipeShellInlineLayoutForFullMode(shell);
    } else {
        shell.classList.add('windowed');
    }
    updatePhotoSwipeMaximizeButtonIcon();
}

function updatePhotoSwipeMaximizeButtonIcon() {
    const shell = getPhotoSwipeShell();
    const maxBtn = document.getElementById('maximizePhotoSwipeBtn');
    if (!shell || !maxBtn) {
        return;
    }
    const icon = maxBtn.querySelector('i');
    if (!icon) {
        return;
    }
    if (shell.classList.contains('windowed')) {
        icon.className = 'fa-regular fa-window-maximize';
        maxBtn.title = 'Maximize';
    } else {
        icon.className = 'fa-regular fa-window-restore';
        maxBtn.title = 'Restore window';
    }
}

function notifyPhotoSwipeShellResized() {
    const shell = getPhotoSwipeShell();
    if (shell && !shell.classList.contains('hidden')) {
        shell.dispatchEvent(new CustomEvent('modalResized', {
            bubbles: true,
            detail: { modal: shell }
        }));
    }
    syncPhotoSwipeShellRestoreStripVisibility();
    const p = window.pswp;
    if (p && p.isOpen) {
        // Layout + getViewportSizeFn need a painted frame; force=true so PhotoSwipe recalculates zoom/fit after shell class changes
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (p.isDestroying) return;
                syncPhotoSwipeContainedScrollOffset(p);
                p.updateSize(true);
            });
        });
    }
}

function syncPhotoSwipeShellRestoreStripVisibility() {
    const shell = getPhotoSwipeShell();
    if (!shell) return;
    const hideStrip = !document.body.classList.contains('desktop-mode')
        || shell.classList.contains('hidden')
        || shell.classList.contains('windowed');
    document.querySelectorAll('#photoSwipeMount .pswp__shell-restore-strip').forEach((el) => {
        el.classList.toggle('hidden', hideStrip);
    });
}

function restorePhotoSwipeShellWindowed() {
    const shell = getPhotoSwipeShell();
    if (!shell || !document.body.classList.contains('desktop-mode')) return;
    if (!shell.classList.contains('windowed')) {
        shell.classList.add('windowed');
        localStorage.setItem(PHOTO_SWIPE_WINDOW_MODE_KEY, 'windowed');
        restoreWindowPosition(shell);
        ensureModalEdgesWithinWorkArea(shell);
    }
    notifyPhotoSwipeShellResized();
}

function clearPhotoSwipeShellInlineLayoutForFullMode(shell) {
    // public/scripts/comp/modalUtils.js — drag/resize uses inline size and offset; strip so full-screen CSS can take over
    shell.style.removeProperty('--modal-offset-x');
    shell.style.removeProperty('--modal-offset-y');
    shell.style.removeProperty('width');
    shell.style.removeProperty('height');
}

function togglePhotoSwipeShellWindowed() {
    const shell = getPhotoSwipeShell();
    if (!shell) return;
    if (shell.classList.contains('windowed')) {
        shell.setAttribute('data-modal-moved', 'true');
        debouncedSaveWindowPositions();
        localStorage.setItem(PHOTO_SWIPE_WINDOW_MODE_KEY, 'maximized');
        shell.classList.remove('windowed');
        shell.classList.remove('modal-maximized');
        clearPhotoSwipeShellInlineLayoutForFullMode(shell);
    } else {
        shell.classList.add('windowed');
        localStorage.setItem(PHOTO_SWIPE_WINDOW_MODE_KEY, 'windowed');
        restoreWindowPosition(shell);
        ensureModalEdgesWithinWorkArea(shell);
    }
    updatePhotoSwipeMaximizeButtonIcon();
    notifyPhotoSwipeShellResized();
}

function getActivePhotoSwipe() {
    if (window.pswp && window.pswp.isOpen && !window.pswp.isDestroying) {
        return window.pswp;
    }
    if (lightbox && lightbox.pswp && lightbox.pswp.isOpen && !lightbox.pswp.isDestroying) {
        return lightbox.pswp;
    }
    return null;
}

function getPhotoSwipePageSkipCount() {
    const viewportHeight = window.innerHeight;
    return Math.max(1, Math.floor(viewportHeight / 200));
}

function isPhotoSwipeWindowKeyboardContext() {
    const shell = getPhotoSwipeShell();
    if (!shell || shell.classList.contains('hidden')) return false;
    // isModalActive — public/scripts/comp/modalUtils.js
    if (typeof isModalActive === 'function') {
        return isModalActive(shell);
    }
    const stack = modalStack || [];
    return stack.length > 0 && stack[stack.length - 1] === shell;
}

function onPhotoSwipeWindowEscapeKeydown(e) {
    if (e.key !== 'Escape') return;
    if (!isPhotoSwipeWindowKeyboardContext()) return;
    const pswp = getActivePhotoSwipe();
    if (pswp) {
        e.preventDefault();
        e.stopPropagation();
        pswp.close();
        return true;
    }
    const shell = getPhotoSwipeShell();
    if (document.body.classList.contains('desktop-mode') && shell && shell.classList.contains('windowed')) {
        return;
    }
}

function onPhotoSwipePageNavKeydown(e) {
    if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
    if (!isPhotoSwipeWindowKeyboardContext()) return;
    const pswp = getActivePhotoSwipe();
    if (!pswp || !pswp.isOpen) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

    e.preventDefault();
    e.stopPropagation();
    const skipCount = getPhotoSwipePageSkipCount();
    const currentIndex = pswp.currIndex;
    const totalImages = pswp.numItems;
    if (e.key === 'PageDown') {
        const nextIndex = Math.min(currentIndex + skipCount, totalImages - 1);
        if (nextIndex !== currentIndex) {
            pswp.goTo(nextIndex);
        }
    } else {
        const prevIndex = Math.max(currentIndex - skipCount, 0);
        if (prevIndex !== currentIndex) {
            pswp.goTo(prevIndex);
        }
    }
    return true;
}

function wirePhotoSwipeKeyboardListeners() {
    if (document.body.dataset.photoSwipeKeyboardWired === 'true') return;
    document.body.dataset.photoSwipeKeyboardWired = 'true';
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'photoSwipeWindow.escape',
        handler: onPhotoSwipeWindowEscapeKeydown,
        type: 'whenFocused',
        modalId: 'photoSwipeWindow',
        priority: 80,
        critical: true,
        label: 'Close image',
        keys: 'Esc',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'PhotoSwipe',
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'photoSwipeWindow.pageNav',
        handler: onPhotoSwipePageNavKeydown,
        type: 'whenFocused',
        modalId: 'photoSwipeWindow',
        priority: 58,
        critical: false,
        showInOverlay: false
    });
    [
        { id: 'overlay.photoSwipeWindow.pageDown', label: 'Skip forward', keys: 'Page Down', icon: 'fas fa-chevron-down' },
        { id: 'overlay.photoSwipeWindow.pageUp', label: 'Skip back', keys: 'Page Up', icon: 'fas fa-chevron-up' },
        { id: 'overlay.photoSwipeWindow.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ].forEach((entry) => {
        registerKeyboardListener({
            id: entry.id,
            type: 'whenFocused',
            modalId: 'photoSwipeWindow',
            label: entry.label,
            keys: entry.keys,
            overlayIcon: entry.icon,
            overlayGroup: 'PhotoSwipe',
            overlayOnly: true,
            priority: -10
        });
    });
}

function wirePhotoSwipeShellControlsOnce() {
    const shell = getPhotoSwipeShell();
    if (!shell || shell.dataset.photoswipeShellWired === 'true') return;
    shell.dataset.photoswipeShellWired = 'true';

    shell.addEventListener('modalResized', () => {
        if (window.pswp && window.pswp.isOpen && !window.pswp.isDestroying) {
            syncPhotoSwipeContainedScrollOffset(window.pswp);
            window.pswp.updateSize(true);
        }
    });

    const closeBtn = shell.querySelector('.modal-window-controls .close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pswp = getActivePhotoSwipe();
            if (pswp) {
                pswp.close();
                return;
            }
            teardownPhotoSwipeDesktopShell();
        });
    }

    const maxBtn = document.getElementById('maximizePhotoSwipeBtn');
    if (maxBtn && maxBtn.dataset.modalMaximizeWired !== 'true') {
        maxBtn.dataset.modalMaximizeWired = 'true';
        maxBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePhotoSwipeShellWindowed();
        });
    }

    ensurePhotoSwipeMountResizeObserver();
}

function preparePhotoSwipeDesktopShellBeforeOpen() {
    const shell = getPhotoSwipeShell();
    if (!shell || !document.body.classList.contains('desktop-mode')) return;
    shell.classList.add('windowed');
    wirePhotoSwipeShellControlsOnce();
    openModal(shell);
    ensureModalEdgesWithinWorkArea(shell);
    updatePhotoSwipeMaximizeButtonIcon();
    requestAnimationFrame(() => syncPhotoSwipeShellRestoreStripVisibility());
}

function teardownPhotoSwipeDesktopShell() {
    disconnectPhotoSwipeMountResizeObserver();
    const shell = getPhotoSwipeShell();
    if (!shell || shell.classList.contains('hidden')) return;
    if (!document.body.classList.contains('desktop-mode')) return;
    // Save windowed layout before close so the next open can restore it
    if (shell.classList.contains('windowed')) {
        shell.setAttribute('data-modal-moved', 'true');
        debouncedSaveWindowPositions();
    }
    closeModal(shell);
}

function attachStandalonePhotoSwipeShellRestoreUi(pswp) {
    if (!document.body.classList.contains('desktop-mode')) return;
    pswp.on('uiRegister', () => {
        pswp.ui.registerElement({
            name: 'photo-swipe-shell-restore',
            order: 9,
            isButton: false,
            appendTo: 'wrapper',
            html: '<div class="pswp__custom-bottom-bar pswp__shell-restore-strip"><div class="pswp__custom-bottom-bar"></div></div>',
            onInit: (el) => {
                const inner = el.firstElementChild;
                if (!inner) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pswp__button--custom round-button pswp__button--restore-desktop-shell-btn';
                btn.setAttribute('aria-label', 'Restore window');
                btn.innerHTML = '<i class="fa-regular fa-window-restore"></i>';
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    restorePhotoSwipeShellWindowed();
                });
                inner.appendChild(btn);
                requestAnimationFrame(() => syncPhotoSwipeShellRestoreStripVisibility());
            }
        });
    });
}

// Helper function to get image data that works with both normal gallery and search results
function getImageFromLightboxIndex(imageIndex) {
    // When search results are displayed, we need to use the original image array
    // because allImages contains filtered results, but imageIndex refers to original position
    if (window.filteredImageIndices && window.originalAllImages && window.originalAllImages.length > 0) {
        // We're in a search/filtered state, use original array
        return window.originalAllImages[imageIndex] || null;
    } else {
        // Normal gallery state, use current allImages array
        return allImages[imageIndex] || null;
    }
}

// Helper function to get the full image array for lightbox data source
function getLightboxDataSource() {
    // When search results are displayed, we need to use the original image array
    // because allImages contains filtered results
    const sourceImages = (window.filteredImageIndices && window.originalAllImages && window.originalAllImages.length > 0)
        ? window.originalAllImages
        : allImages;

    return sourceImages.map(img => {
        let filenameToShow = img.original;
        if (img.upscaled) {
            filenameToShow = img.upscaled;
        }

        // Prefer list-row pixel dims, then actual_* (file), then metadata (may be source size for expands).
        // Missing dims used to fall through to 1024×1024 and make expanded images look square in PhotoSwipe.
        let width = Number(img.width) || 0;
        let height = Number(img.height) || 0;
        const meta = img.metadata || null;
        if ((!width || !height) && meta) {
            width = Number(meta.actual_width || meta.width) || 0;
            height = Number(meta.actual_height || meta.height) || 0;
        }
        if (!width || !height) {
            width = 0;
            height = 0;
        }

        return {
            // resolveGalleryFullImageUrl: public/scripts/comp/assetUrlResolver.js
            src: resolveGalleryFullImageUrl(img) || localGalleryImageUrl(filenameToShow),
            width: width || undefined,
            height: height || undefined,
            data: {
                filename: filenameToShow,
                base: img.base,
                upscaled: img.upscaled,
                original: img.original,
                metadata: meta
            }
        };
    });
}

// Initialize PhotoSwipe lightbox
async function initializePhotoSwipe() {
    try {
        const PhotoSwipeLightbox = await import('/dist/photoswipe/photoswipe-lightbox.esm.js');
        
        lightbox = new PhotoSwipeLightbox.default({
            dataSource: [],
            pswpModule: () => import('/dist/photoswipe/photoswipe.esm.js'),
            showHideAnimationType: 'zoom', //'fade',
            showAnimationDuration: 300,
            hideAnimationDuration: 300,
            allowPanToNext: true,
            allowMouseDrag: true,
            allowTouchDrag: true,
            opacity: 0.15,
            spacing: 0.1,
            loop: true,
            pinchToClose: true,
            closeOnScroll: false,
            closeOnVerticalDrag: true,
            wheelToZoom: true,
            escKey: true,
            arrowKeys: true,
            returnFocus: true,
            initialZoomLevel: 'fit',
            secondaryZoomLevel: 1,
            maxZoomLevel: 4,
            imageClickAction: 'zoom',
            tapAction: 'zoom',
            doubleTapAction: 'zoom',
            indexIndicatorSep: ' / ',
            preloaderDelay: 2000,
            errorMsg: '<div class="pswp__error-msg">Image not found</div>',
            closeTitle: 'Close (Esc)',
            prevTitle: 'Previous (arrow left)',
            nextTitle: 'Next (arrow right)',
            zoomTitle: 'Zoom in/out',
            counterTitle: 'Image counter',
            fullscreenTitle: 'Toggle fullscreen',
            shareTitle: 'Share',
            toggleThumbnailsTitle: 'Toggle thumbnails',
            downloadTitle: 'Download',
            openPromise: () => {
                if (!document.body.classList.contains('desktop-mode')) {
                    delete lightbox.options.appendToEl;
                    delete lightbox.options.getViewportSizeFn;
                    lightbox.options.trapFocus = true;
                    lightbox.options.returnFocus = true;
                    return Promise.resolve();
                }
                preparePhotoSwipeDesktopShellBeforeOpen();
                const mount = getPhotoSwipeMount();
                lightbox.options.appendToEl = mount;
                lightbox.options.getViewportSizeFn = () => getPhotoSwipeMountViewportSize();
                // Desktop window stack: allow focus/typing in other modals while Glancewell stays open
                lightbox.options.trapFocus = false;
                lightbox.options.returnFocus = false;
                return new Promise((resolve) => requestAnimationFrame(resolve));
            },
        });

        // Add thumbEl filter for zoom animation from thumbnails
        lightbox.addFilter('thumbEl', (thumbEl, data, index) => {
            // Only use manual preview image if:
            // 1. Manual modal is open (not hidden)
            // 2. AND either:
            //    - Manual modal is NOT windowed (maximized/fullscreen), OR
            //    - Manual modal IS windowed AND it's the top window in the z-stack
            const isManualModalOpen = !manualModal.classList.contains('hidden');
            const isWindowed = manualModal.classList.contains('windowed');
            const isTopWindow = isModalActive(manualModal);
            const shouldUseManualPreview = isManualModalOpen && (!isWindowed || (isWindowed && isTopWindow));
            
            if (shouldUseManualPreview) {
                const manualPreviewImg = document.getElementById('manualPreviewImage');
                if (manualPreviewImg && !manualPreviewImg.classList.contains('hidden')) {
                    console.log('manualPreviewImage found:', manualPreviewImg);
                    return manualPreviewImg;
                }
            }
            // index is the position in the PhotoSwipe data source
            // The data source uses originalAllImages when filtered, allImages when not
            // In both cases, index corresponds to the file index in the full allImages array
            // So we can use index directly as file-index to find gallery items
            let targetItem = document.querySelector(`[data-file-index="${index}"]`);
            
            // If not found by file-index, try finding by filename (fallback for edge cases)
            if (!targetItem && data?.data) {
                console.log('File Index not found, data:', data.data);
                const filename = data.data.filename || data.data.upscaled || data.data.original;
                if (filename) {
                    console.log('Filename found:', filename);
                    // Try exact filename match first
                    targetItem = document.querySelector(`[data-filename="${filename}"]`);
                    // If still not found, try partial match (in case of URL encoding issues)
                    if (!targetItem) {
                        console.log('Filename not found, trying partial match');
                        const allItems = document.querySelectorAll('[data-filename]');
                        for (const item of allItems) {
                            const itemFilename = item.dataset.filename;
                            if (itemFilename && (itemFilename.includes(filename) || filename.includes(itemFilename))) {
                                console.log('Partial match found:', itemFilename);
                                targetItem = item;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (targetItem) {
                const img = targetItem.querySelector('img.gallery-item-zoom-origin');
                if (img) {
                    return img;
                } else {
                    const img = targetItem.querySelector('img');
                    if (img) {
                        return img;
                    }
                }
            }
            return thumbEl;
        });

        // Add placeholderSrc filter for placeholder images
        lightbox.addFilter('placeholderSrc', (placeholderSrc, slide) => {
            // Only use manual preview image if:
            // 1. Manual modal is open (not hidden)
            // 2. AND either:
            //    - Manual modal is NOT windowed (maximized/fullscreen), OR
            //    - Manual modal IS windowed AND it's the top window in the z-stack
            const isManualModalOpen = !manualModal.classList.contains('hidden');
            const isWindowed = manualModal.classList.contains('windowed');
            const isTopWindow = isModalActive(manualModal);
            const shouldUseManualPreview = isManualModalOpen && (!isWindowed || (isWindowed && isTopWindow));
            
            if (shouldUseManualPreview) {
                const manualPreviewImg = document.getElementById('manualPreviewImage');
                if (manualPreviewImg && !manualPreviewImg.classList.contains('hidden')) {
                    return manualPreviewImg.src;
                }
            }
            // slide.index is the position in the PhotoSwipe data source
            // Use the same logic as thumbEl to find the correct item
            let targetItem = document.querySelector(`[data-file-index="${slide.index}"]`);
            
            // If not found by file-index, try finding by filename (fallback for edge cases)
            if (!targetItem && slide.data) {
                const filename = slide.data.filename || slide.data.upscaled || slide.data.original;
                if (filename) {
                    // Try exact filename match first
                    targetItem = document.querySelector(`[data-filename="${filename}"]`);
                    // If still not found, try partial match (in case of URL encoding issues)
                    if (!targetItem) {
                        const allItems = document.querySelectorAll('[data-filename]');
                        for (const item of allItems) {
                            const itemFilename = item.dataset.filename;
                            if (itemFilename && (itemFilename.includes(filename) || filename.includes(itemFilename))) {
                                targetItem = item;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (targetItem) {
                const img = targetItem.querySelector('img.gallery-item-zoom-origin');
                if (img) {
                    return img.src;
                } else {
                    const img = targetItem.querySelector('img');
                    if (img) {
                        return img.src;
                    }
                }
            }
            return placeholderSrc;
        });

        // Mount-contained PhotoSwipe: opener + placeholder zoom use viewport-sized coords; thumb bounds must be mount-relative
        lightbox.addFilter('thumbBounds', (thumbBounds) => {
            const mount = getPhotoSwipeMount();
            if (!thumbBounds || !mount || lightbox.options.appendToEl !== mount) {
                return thumbBounds;
            }
            return adjustThumbBoundsForPhotoSwipeMount(thumbBounds);
        });

        // Correct slide aspect when gallery list lacked width/height (common for expanded images).
        lightbox.on('loadComplete', (e) => {
            const slide = e.slide;
            const img = e.content?.element;
            if (!slide || !img || e.isError) return;
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            if (!(nw > 0 && nh > 0)) return;
            if (slide.width === nw && slide.height === nh) return;

            slide.width = nw;
            slide.height = nh;
            if (slide.data) {
                slide.data.width = nw;
                slide.data.height = nh;
            }

            const fileData = slide.data?.data;
            const filename = fileData?.filename || fileData?.upscaled || fileData?.original;
            if (filename && Array.isArray(allImages)) {
                const galleryItem = allImages.find((item) =>
                    item.original === filename || item.upscaled === filename || item.filename === filename
                );
                if (galleryItem && (galleryItem.width !== nw || galleryItem.height !== nh)) {
                    galleryItem.width = nw;
                    galleryItem.height = nh;
                }
            }

            if (slide.zoomLevels) {
                slide.zoomLevels.update(nw, nh, slide.panAreaSize);
            }
            slide.updateContentSize(true);
            if (slide.isActive && lightbox.pswp && !lightbox.pswp.isDestroying) {
                lightbox.pswp.updateSize(true);
            }
        });

        // Function to update button visibility based on current slide
        const updateButtonVisibility = (bottomBar, pswp) => {
            if (!bottomBar || !pswp) return;

            const currentItem = pswp.currSlide;
            const shell = getPhotoSwipeShell();
            const desktopFull = document.body.classList.contains('desktop-mode') && shell && !shell.classList.contains('windowed') && !shell.classList.contains('hidden');

            if (currentItem && currentItem.data) {
                if (currentItem.data.isStandalone) {
                    if (desktopFull) {
                        bottomBar.classList.remove('hidden');
                        bottomBar.querySelectorAll('.pswp__button--custom').forEach((btn) => {
                            if (btn.classList.contains('pswp__button--restore-desktop-shell-btn')) {
                                btn.classList.remove('hidden');
                            } else {
                                btn.classList.add('hidden');
                            }
                        });
                        return;
                    }
                    bottomBar.classList.add('hidden');
                    return;
                }
                bottomBar.classList.remove('hidden');

                // Update upscale button visibility based on image dimensions
                const upscaleButton = bottomBar.querySelector('.pswp__button--upscale-button');
                if (upscaleButton) {
                    upscaleButton.classList.remove('hidden');
                }
            }
        };

        // Add custom UI elements
        lightbox.on('uiRegister', function() {
            // Create custom bottom bar container
            lightbox.pswp.ui.registerElement({
                name: 'custom-bottom-bar',
                order: 9,
                isButton: false,
                appendTo: 'wrapper',
                html: '<div class="pswp__custom-bottom-bar"></div>',
                onInit: (el, pswp) => {
                    const bottomBar = el.querySelector('.pswp__custom-bottom-bar');
                    
                    // Initial visibility check
                    updateButtonVisibility(bottomBar, pswp);
                    
                    // Create all buttons
                    const buttons = [
                        {
                            className: 'restore-desktop-shell-btn',
                            icon: '<i class="fa-regular fa-window-restore"></i>',
                            label: 'Restore window',
                            onClick: () => {
                                restorePhotoSwipeShellWindowed();
                            }
                        },
                        {
                            className: 'download-button',
                            icon: '<i class="fa-light fa-download"></i>',
                            label: 'Download image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    downloadImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'copy-button',
                            icon: '<i class="fa-light fa-clipboard"></i>',
                            label: 'Copy to clipboard',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // copyImageToClipboard: public/scripts/comp/galleryView.js
                                    copyImageToClipboard(currentItem.data.data);
                                }
                            }
                        },
                        {
                            className: 'pin-button',
                            icon: '<i class="fa-light fa-star"></i>',
                            label: 'Pin image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    togglePinImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'reroll-button',
                            icon: '<i class="fa-light fa-dice-three"></i>',
                            label: 'Recast Spell',
                            onClick: (e) => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // Close PhotoSwipe first, then open expansion modal
                                    pswp.close();
                                    rerollImage(currentItem.data?.data, e);
                                }
                            }
                        },
                        {
                            className: 'reroll-edit-button',
                            icon: '<i class="fa-light fa-compass-drafting"></i>',
                            label: 'Reroll with edit',
                            onClick: (e) => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    pswp.close();
                                    const imageData = currentItem.data.data;
                                    openManualModalWithContent({
                                        type: 'image',
                                        image: imageData,
                                        metadata: imageData.metadata || null
                                    }, e);
                                }
                            }
                        },
                        {
                            className: 'chat-button',
                            icon: '<i class="fa-light fa-person-to-portal"></i>',
                            label: 'Create Persona',
                            onClick: async () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // Get the filename - prefer upscaled, fallback to original
                                    const imageData = currentItem.data.data;
                                    const filename = imageData.upscaled || imageData.original || imageData.filename;
                                    if (filename) {
                                        // Close PhotoSwipe first, then open chat modal
                                        pswp.close();
                                        if (window.featureLoader) {
                                            await window.featureLoader.loadFeature('chat');
                                        }
                                        let characterName = imageData.characterName || null;
                                        if (!characterName) {
                                            try {
                                                const metadata = await getImageMetadata(filename);
                                                characterName = metadata?.character_name || null;
                                            } catch (_) {
                                                characterName = null;
                                            }
                                        }
                                        if (window.chatSystem) {
                                            window.chatSystem.openChatModal(filename, characterName);
                                        }
                                    }
                                }
                            }
                        },
                        {
                            className: 'expand-button',
                            icon: '<i class="mdi mdi-1-25 mdi-relative-scale"></i>',
                            label: 'Expand canvas',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // Get the filename to expand - prefer upscaled version, fallback to original
                                    const filename = currentItem.data.data.upscaled || currentItem.data.data.original;
                                    if (filename) {
                                        // Close PhotoSwipe first, then open expansion modal
                                        pswp.close();
                                        openImageExpansionModal(filename);
                                    }
                                }
                            }
                        },
                        {
                            className: 'upscale-button',
                            icon: '<i class="nai-upscale"></i>',
                            label: 'Upscale image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // Close PhotoSwipe first, then open expansion modal
                                    pswp.close();
                                    upscaleImage(currentItem.data?.data);
                                }
                            }
                        },
                        {
                            className: 'scrap-button',
                            icon: '<i class="fa-light fa-bin-recycle"></i>',
                            label: 'Move to scraps',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // Close PhotoSwipe first, then open expansion modal
                                    pswp.close();
                                    if (currentGalleryView === 'scraps') {
                                        removeFromScraps(currentItem.data?.data);
                                    } else {
                                        moveToScraps(currentItem.data?.data);
                                    }
                                }
                            }
                        },
                        {
                            className: 'delete-button btn-danger',
                            icon: '<i class="fa-light fa-fire"></i>',
                            label: 'Destroy image',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    // Close PhotoSwipe first, then open expansion modal
                                    pswp.close();
                                    deleteImage(currentItem.data?.data);
                                }
                            }
                        }/* ,
                        {
                            className: 'metadata-button',
                            icon: '<i class="fas fa-info-circle"></i>',
                            label: 'Show metadata',
                            onClick: () => {
                                const currentItem = pswp.currSlide;
                                if (currentItem && currentItem.data?.data) {
                                    showMetadataDialog();
                                }
                            }
                        } */
                    ];

                    // Add all buttons to the bottom bar
                    buttons.forEach(buttonData => {
                        const button = document.createElement('button');
                        button.className = `pswp__button--custom round-button pswp__button--${buttonData.className}`;
                        if (buttonData.className === 'restore-desktop-shell-btn') {
                            button.classList.add('pswp__button--restore-desktop-shell-btn');
                        }
                        button.setAttribute('aria-label', buttonData.label);
                        button.innerHTML = buttonData.icon;
                        button.onclick = buttonData.onClick;
                        bottomBar.appendChild(button);
                    });
                }
            });
        });

        // Set up event listener for slide changes to update button visibility
        lightbox.on('change', function() {
            const bottomBar = document.querySelector('.pswp__custom-bottom-bar');
            if (bottomBar && lightbox.pswp) {
                updateButtonVisibility(bottomBar, lightbox.pswp);
            }
        });

        lightbox.on('close', () => {
            teardownPhotoSwipeDesktopShell();
        });

        lightbox.on('openingAnimationEnd', () => {
            if (document.body.classList.contains('desktop-mode') && window.pswp && window.pswp.isOpen) {
                requestAnimationFrame(() => {
                    if (!window.pswp || window.pswp.isDestroying) return;
                    syncPhotoSwipeContainedScrollOffset(window.pswp);
                    window.pswp.updateSize(true);
                });
            }
            syncPhotoSwipeShellRestoreStripVisibility();
        });

        lightbox.on('viewportSize', () => {
            if (lightbox.pswp) {
                syncPhotoSwipeContainedScrollOffset(lightbox.pswp);
            }
        });

        // Initialize the lightbox
        wirePhotoSwipeKeyboardListeners();
        lightbox.init();
    } catch (error) {
        console.error('Failed to initialize PhotoSwipe:', error);
    }
}


// Function to open standalone PhotoSwipe instances
async function openStandalonePhotoSwipe(dataSource) {
    try {
        const PhotoSwipe = await import('/dist/photoswipe/photoswipe.esm.js');

        const useDesktopShell = document.body.classList.contains('desktop-mode');
        const mount = getPhotoSwipeMount();

        const multi = Array.isArray(dataSource) && dataSource.length > 1;
        const opts = {
            dataSource: dataSource,
            showHideAnimationType: 'zoom',
            showAnimationDuration: 300,
            hideAnimationDuration: 300,
            allowPanToNext: multi,
            allowMouseDrag: true,
            allowTouchDrag: true,
            spacing: 0.1,
            loop: false,
            pinchToClose: true,
            closeOnScroll: false,
            closeOnVerticalDrag: true,
            wheelToZoom: true,
            escKey: true,
            arrowKeys: multi,
            returnFocus: true,
            initialZoomLevel: 'fit',
            secondaryZoomLevel: 1,
            maxZoomLevel: 4,
            imageClickAction: 'zoom',
            tapAction: 'zoom',
            doubleTapAction: 'zoom',
            preloaderDelay: 2000,
            errorMsg: '<div class="pswp__error-msg">Image not found</div>',
            closeTitle: 'Close (Esc)',
            zoomTitle: 'Zoom in/out'
        };

        if (useDesktopShell && mount) {
            preparePhotoSwipeDesktopShellBeforeOpen();
            opts.appendToEl = mount;
            opts.getViewportSizeFn = () => getPhotoSwipeMountViewportSize();
            opts.trapFocus = false;
            opts.returnFocus = false;
        }

        const pswp = new PhotoSwipe.default(opts);
        window.pswp = pswp;

        if (useDesktopShell) {
            pswp.addFilter('thumbBounds', (thumbBounds) => adjustThumbBoundsForPhotoSwipeMount(thumbBounds));
            pswp.on('viewportSize', () => syncPhotoSwipeContainedScrollOffset(pswp));
            ensurePhotoSwipeMountResizeObserver();
            attachStandalonePhotoSwipeShellRestoreUi(pswp);
        }

        pswp.on('close', () => {
            if (window.pswp === pswp) {
                delete window.pswp;
            }
            if (useDesktopShell) {
                teardownPhotoSwipeDesktopShell();
            }
            pswp.destroy();
        });

        pswp.init();

        if (useDesktopShell) {
            requestAnimationFrame(() => {
                if (pswp.isDestroying) return;
                syncPhotoSwipeContainedScrollOffset(pswp);
                pswp.updateSize(true);
                syncPhotoSwipeShellRestoreStripVisibility();
            });
        }

    } catch (error) {
        console.error('Failed to open standalone PhotoSwipe:', error);
    }
}

// Show lightbox with PhotoSwipe
async function showLightbox(input) {
    if (!lightbox) {
        await initializePhotoSwipe();
    }

    let imageIndex = 0;
    let targetImage = null;

    // Handle different input types
    if (typeof input === 'number') {
        // Direct index provided
        imageIndex = input;
        const sourceImages = (window.filteredImageIndices && window.originalAllImages && window.originalAllImages.length > 0)
            ? window.originalAllImages
            : allImages;

        if (imageIndex < 0 || imageIndex >= sourceImages.length) {
            console.error('Image index out of range:', imageIndex);
            return;
        }
        targetImage = getImageFromLightboxIndex(imageIndex);
    } else if (typeof input === 'object' && input !== null) {
        // Object with filename, url, or element provided
        const lookupFilename = !input.url && !input.element
            ? (input.filename || input.upscaled || input.original)
            : null;
        if (lookupFilename) {
            // Find by filename
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.filteredImageIndices) {
                // Search mode - use filtered results
                imageIndex = window.originalAllImages.findIndex(img => {
                    return img.upscaled === lookupFilename ||
                        img.original === lookupFilename ||
                        img.filename === lookupFilename;
                });
            } else {
                // Normal mode - use current allImages
                imageIndex = allImages.findIndex(img => {
                    return img.upscaled === lookupFilename ||
                        img.original === lookupFilename ||
                        img.filename === lookupFilename;
                });
            }
        } else if (input.url) {
            // Standalone image URL - get dimensions if not provided
            if (!input.width || !input.height) {
                // Create a temporary image to get natural dimensions
                const tempImg = new Image();
                tempImg.onload = function() {
                    const standaloneData = [{
                        src: input.url,
                        width: input.width || tempImg.naturalWidth || 1024,
                        height: input.height || tempImg.naturalHeight || 1024,
                        data: {
                            filename: input.url,
                            base: input.url,
                            upscaled: input.url,
                            original: input.url,
                            isStandalone: true
                        }
                    }];
                    
                    // Use PhotoSwipe core directly for standalone images
                    openStandalonePhotoSwipe(standaloneData);
                };
                tempImg.onerror = function() {
                    // Fallback with default dimensions if image fails to load
                    const standaloneData = [{
                        src: input.url,
                        width: input.width || 1024,
                        height: input.height || 1024,
                        data: {
                            filename: input.url,
                            base: input.url,
                            upscaled: input.url,
                            original: input.url,
                            isStandalone: true
                        }
                    }];
                    
                    openStandalonePhotoSwipe(standaloneData);
                };
                tempImg.src = input.url;
                return;
            } else {
                // Dimensions provided, create data source immediately
                const standaloneData = [{
                    src: input.url,
                    width: input.width,
                    height: input.height,
                    data: {
                        filename: input.url,
                        base: input.url,
                        upscaled: input.url,
                        original: input.url,
                        isStandalone: true
                    }
                }];
                
                // Use PhotoSwipe core directly for standalone images
                openStandalonePhotoSwipe(standaloneData);
                return;
            }
        } else if (input.element) {
            // Gallery item element - use filename as unique identifier (more reliable than indices)
            const filename = input.element.getAttribute('data-filename');
            
            if (filename) {
                // Find the image by filename - use the source array that lightbox will use
                // When filtered, lightbox uses originalAllImages, otherwise allImages
                const sourceImages = (window.filteredImageIndices && window.originalAllImages && window.originalAllImages.length > 0)
                    ? window.originalAllImages
                    : allImages;
                
                // Find the index by filename (most reliable method)
                // Match against all possible filename fields
                imageIndex = sourceImages.findIndex(img => {
                    if (!img) return false;
                    const imgFilename = img.filename || img.original || img.upscaled;
                    // Exact match
                    if (imgFilename === filename) return true;
                    // Also check if filename matches any of the image's filename variants
                    return (img.filename && img.filename === filename) ||
                           (img.original && img.original === filename) ||
                           (img.upscaled && img.upscaled === filename);
                });
                
                if (imageIndex !== -1 && imageIndex >= 0 && imageIndex < sourceImages.length) {
                    targetImage = getImageFromLightboxIndex(imageIndex);
                } else {
                    // Image not found by filename - try using findImageByFilename helper if available
                    const foundImage = findImageByFilename(filename);
                    if (foundImage) {
                        // Find the index of this image in sourceImages
                        imageIndex = sourceImages.findIndex(img => {
                            if (!img) return false;
                            const imgFilename = img.filename || img.original || img.upscaled;
                            const foundFilename = foundImage.filename || foundImage.original || foundImage.upscaled;
                            return imgFilename === foundFilename;
                        });
                        
                        if (imageIndex !== -1 && imageIndex >= 0 && imageIndex < sourceImages.length) {
                            targetImage = getImageFromLightboxIndex(imageIndex);
                        } else {
                            imageIndex = -1;
                        }
                    } else {
                        imageIndex = -1;
                    }
                }
            } else {
                // No filename - try standalone element
                const img = input.element.querySelector('img');
                if (img && img.src) {
                    const standaloneData = [{
                        src: img.src,
                        width: input.width || img.naturalWidth || 1024,
                        height: input.height || img.naturalHeight || 1024,
                        data: {
                            filename: img.src,
                            base: img.src,
                            upscaled: img.src,
                            original: img.src,
                            isStandalone: true
                        }
                    }];
                    
                    // Use PhotoSwipe core directly for standalone images
                    openStandalonePhotoSwipe(standaloneData);
                    return;
                } else {
                    imageIndex = -1;
                }
            }
        }

        if (imageIndex === -1) {
            console.error('Image not found in image array');
            return;
        }
        targetImage = getImageFromLightboxIndex(imageIndex);
    } else {
        console.error('Invalid input to showLightbox:', input);
        return;
    }

    // Prepare data source for PhotoSwipe with proper dimensions from metadata
    const dataSource = getLightboxDataSource();

    // Update PhotoSwipe data source
    lightbox.loadAndOpen(imageIndex, dataSource);
}

// Hide lightbox (PhotoSwipe handles this automatically)
function hideLightbox() {
    if (lightbox && lightbox.pswp) {
        lightbox.pswp.close();
    }
}

// Navigate between images (PhotoSwipe handles this automatically)
function navigateLightbox(direction) {
    if (lightbox && lightbox.pswp) {
        if (direction > 0) {
            lightbox.pswp.next();
        } else {
            lightbox.pswp.prev();
        }
    }
}

// Update button states and functionality
function updateLightboxControls(image) {
    // This is now handled by PhotoSwipe UI elements
    // The buttons are automatically updated based on the current image
}

// Initialize PhotoSwipe when the page loads
window.wsClient.registerInitStep(36, 'Initializing PhotoSwipe Lightbox', async () => {
    await initializePhotoSwipe();
});

// Make functions globally available for compatibility
window.showLightbox = showLightbox;
window.hideLightbox = hideLightbox;
window.navigateLightbox = navigateLightbox;
window.updateLightboxControls = updateLightboxControls;