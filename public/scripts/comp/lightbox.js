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

// ---- Glancewell windowed is Vista's Windows Photo Gallery viewer (app.html #photoSwipeWindow,
// vista-photo-gallery.css, like Lumen): the command band and the control pill drive the open
// PhotoSwipe; the Info pane shows the picture's generation parameters (imageViewer.js
// renderPhotoGalleryInfoPane). Play Slide Show goes full screen and advances every 4 seconds. ----

const GLANCEWELL_SLIDE_SHOW_MS = 4000;
let glancewellRotation = 0;
let glancewellSlideShowTimer = null;
let glancewellInfoOpen = false;

/** The current slide's picture: { filename, metadata, src } (both open paths' slide shapes). */
function glancewellCurrentPicture() {
    const p = getActivePhotoSwipe();
    const slide = p && p.currSlide ? p.currSlide.data || {} : {};
    const inner = slide.data || slide;
    const filename = inner.filename || inner.original || inner.upscaled || '';
    // findImageByFilename: public/scripts/comp/galleryView.js
    const record = filename && typeof findImageByFilename === 'function' ? findImageByFilename(filename) : null;
    return {
        filename,
        metadata: record || { filename, original: inner.original, upscaled: inner.upscaled, ...(inner.metadata || {}) },
        src: slide.src || ''
    };
}

/** Lumen's own actions with this picture as their image (ImageViewer: public/scripts/comp/imageViewer.js). */
function glancewellViewerCall(method, ...args) {
    const pic = glancewellCurrentPicture();
    if (typeof ImageViewer === 'undefined' || !ImageViewer.prototype[method]) return undefined;
    const ctx = {
        metadata: pic.metadata,
        imageSrc: pic.src,
        title: pic.filename,
        getImageFilename: () => pic.filename,
        getImageWorkspaceId: () => (pic.metadata && pic.metadata.workspaceId) || null
    };
    return ImageViewer.prototype[method].apply(ctx, args);
}

function syncGlancewellChrome() {
    const shell = getPhotoSwipeShell();
    const p = getActivePhotoSwipe();
    if (!shell || !p) return;
    const pic = glancewellCurrentPicture();
    const title = document.getElementById('photoSwipeWindowTitle');
    if (title) {
        const name = String(pic.filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
        title.textContent = name ? `${name} - Glancewell` : 'Glancewell';
    }
    const count = typeof p.getNumItems === 'function' ? p.getNumItems() : 0;
    const prev = shell.querySelector('[data-gw="previous"]');
    const next = shell.querySelector('[data-gw="next"]');
    if (prev) prev.disabled = p.currIndex <= 0;
    if (next) next.disabled = p.currIndex >= count - 1;
    const del = shell.querySelector('[data-gw="delete"]');
    if (del) del.disabled = !pic.filename;
    const fit = shell.querySelector('[data-gw="fit"]');
    if (fit && p.currSlide) {
        const actual = p.currSlide.currZoomLevel > (p.currSlide.zoomLevels.fit || 1) + 0.001;
        fit.classList.toggle('is-actual', actual);
        fit.title = actual ? 'Fit to Window' : 'Actual Size';
    }
    glancewellRotation = 0;
    applyGlancewellRotation();
    if (glancewellInfoOpen) renderGlancewellInfo();
}

function applyGlancewellRotation() {
    const p = getActivePhotoSwipe();
    const img = p && p.currSlide && p.currSlide.content && p.currSlide.content.element;
    if (img) img.style.rotate = glancewellRotation ? `${glancewellRotation}deg` : '';
}

function renderGlancewellInfo() {
    const shell = getPhotoSwipeShell();
    const pane = shell && shell.querySelector('.wpg-info');
    if (!pane || typeof renderPhotoGalleryInfoPane !== 'function') return;
    const pic = glancewellCurrentPicture();
    const p = getActivePhotoSwipe();
    const img = p && p.currSlide && p.currSlide.content ? p.currSlide.content.element : null;
    renderPhotoGalleryInfoPane(pane, { metadata: pic.metadata, src: pic.src, title: pic.filename, img });
}

function setGlancewellInfoOpen(open) {
    const shell = getPhotoSwipeShell();
    if (!shell) return;
    glancewellInfoOpen = open;
    const pane = shell.querySelector('.wpg-info');
    if (pane) pane.classList.toggle('hidden', !open);
    const btn = shell.querySelector('[data-gw="info"]');
    if (btn) btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) renderGlancewellInfo();
}

function stopGlancewellSlideShow() {
    if (glancewellSlideShowTimer) clearInterval(glancewellSlideShowTimer);
    glancewellSlideShowTimer = null;
}

function playGlancewellSlideShow() {
    const shell = getPhotoSwipeShell();
    if (shell && shell.classList.contains('windowed')) togglePhotoSwipeShellWindowed();
    stopGlancewellSlideShow();
    glancewellSlideShowTimer = setInterval(() => {
        const p = getActivePhotoSwipe();
        const sh = getPhotoSwipeShell();
        // the slide show ends when the window is restored or closed
        if (!p || !sh || sh.classList.contains('windowed') || sh.classList.contains('hidden')) {
            stopGlancewellSlideShow();
            return;
        }
        if (p.currIndex >= p.getNumItems() - 1) p.goTo(0);
        else p.next();
    }, GLANCEWELL_SLIDE_SHOW_MS);
}

function wireGlancewellChromeOnce() {
    const shell = getPhotoSwipeShell();
    if (!shell || shell.dataset.gwWired === 'true') return;
    shell.dataset.gwWired = 'true';
    const on = (key, fn) => {
        const btn = shell.querySelector(`[data-gw="${key}"]`);
        if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); fn(btn); });
    };
    const withSwipe = (fn) => () => { const p = getActivePhotoSwipe(); if (p) fn(p); };
    on('gallery', () => glancewellViewerCall('jumpToInWorkspace'));
    on('fix', () => glancewellViewerCall('openInCreator'));
    on('lumen', () => {
        const pic = glancewellCurrentPicture();
        if (pic.filename && typeof openGalleryImageInViewer === 'function') openGalleryImageInViewer(pic.metadata);
    });
    on('info', () => setGlancewellInfoOpen(!glancewellInfoOpen));
    on('info-close', () => setGlancewellInfoOpen(false));
    on('help', () => { if (typeof openGrimoireApplet === 'function') openGrimoireApplet(); });
    on('previous', withSwipe((p) => p.prev()));
    on('next', withSwipe((p) => p.next()));
    on('slideshow', () => playGlancewellSlideShow());
    on('fit', withSwipe((p) => {
        const s = p.currSlide;
        if (!s) return;
        const fit = s.zoomLevels.fit || s.zoomLevels.initial;
        s.zoomTo(s.currZoomLevel > fit + 0.001 ? fit : 1);
        requestAnimationFrame(syncGlancewellChrome);
    }));
    on('rotate-left', () => { glancewellRotation = (glancewellRotation + 270) % 360; applyGlancewellRotation(); });
    on('rotate-right', () => { glancewellRotation = (glancewellRotation + 90) % 360; applyGlancewellRotation(); });
    // Delete moves the picture to Scraps (moveToScraps: public/scripts/comp/galleryView.js)
    on('delete', withSwipe((p) => {
        const pic = glancewellCurrentPicture();
        if (!pic.filename || typeof moveToScraps !== 'function') return;
        moveToScraps(pic.metadata);
        if (p.currIndex < p.getNumItems() - 1) p.next();
    }));
    if (typeof contextMenu !== 'undefined' && contextMenu) {
        const file = shell.querySelector('[data-gw="file"]');
        if (file) {
            contextMenu.attachClickMenuToElement(file, {
                sections: [{
                    type: 'list',
                    items: [
                        { text: 'Copy', action: 'gw-copy' },
                        { text: 'Save a Copy...', action: 'gw-download' },
                        { separator: true },
                        { text: 'Set as Desktop Background', action: 'gw-wallpaper' },
                        { text: 'Properties', action: 'gw-properties' },
                        { separator: true },
                        { text: 'Delete Permanently', action: 'gw-incinerate' }
                    ]
                }],
                onAction: (action) => {
                    if (action === 'gw-copy') glancewellViewerCall('copyToClipboard');
                    else if (action === 'gw-download') glancewellViewerCall('download');
                    else if (action === 'gw-wallpaper') glancewellViewerCall('setAsWallpaper');
                    else if (action === 'gw-incinerate') glancewellViewerCall('incinerate');
                    else if (action === 'gw-properties') {
                        const pic = glancewellCurrentPicture();
                        // openImagePromptInspector: public/scripts/comp/imagePromptInspector.js
                        void featureLoader.loadFeature('image_prompt_inspector').then(() => openImagePromptInspector(pic.metadata));
                    }
                }
            });
        }
        const zoom = shell.querySelector('[data-gw="zoom"]');
        if (zoom) {
            contextMenu.attachClickMenuToElement(zoom, {
                sections: [{
                    type: 'list',
                    items: [
                        { text: 'Zoom In', action: 'gw-zoom-in' },
                        { text: 'Zoom Out', action: 'gw-zoom-out' },
                        { separator: true },
                        { text: 'Actual Size', action: 'gw-actual' },
                        { text: 'Fit to Window', action: 'gw-fit' }
                    ]
                }],
                onAction: (action) => {
                    const p = getActivePhotoSwipe();
                    const s = p && p.currSlide;
                    if (!s) return;
                    const fit = s.zoomLevels.fit || s.zoomLevels.initial;
                    if (action === 'gw-zoom-in') s.zoomTo(Math.min(s.zoomLevels.max || 4, s.currZoomLevel * 1.25));
                    else if (action === 'gw-zoom-out') s.zoomTo(Math.max(fit, s.currZoomLevel / 1.25));
                    else if (action === 'gw-actual') s.zoomTo(1);
                    else if (action === 'gw-fit') s.zoomTo(fit);
                    requestAnimationFrame(syncGlancewellChrome);
                }
            });
        }
    }
}

/** Hook one PhotoSwipe instance into the chrome (both open paths). */
function attachGlancewellChrome(pswp) {
    if (!pswp || !document.body.classList.contains('desktop-mode')) return;
    wireGlancewellChromeOnce();
    pswp.on('change', () => syncGlancewellChrome());
    pswp.on('afterInit', () => syncGlancewellChrome());
    pswp.on('zoomPanUpdate', () => {
        const shell = getPhotoSwipeShell();
        const fit = shell && shell.querySelector('[data-gw="fit"]');
        const s = pswp.currSlide;
        if (fit && s) fit.classList.toggle('is-actual', s.currZoomLevel > (s.zoomLevels.fit || 1) + 0.001);
    });
    pswp.on('close', () => {
        stopGlancewellSlideShow();
        setGlancewellInfoOpen(false);
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

        // One filename → cell map for thumb/placeholder fallbacks (avoid querySelectorAll per slide)
        const galleryFilenameMap = new Map();
        if (typeof gallery !== 'undefined' && gallery && gallery.children) {
            for (let gi = 0; gi < gallery.children.length; gi++) {
                const cell = gallery.children[gi];
                const fn = cell.dataset && cell.dataset.filename;
                if (fn) galleryFilenameMap.set(fn, cell);
            }
        }
        const findGalleryCellByFilename = (filename) => {
            if (!filename) return null;
            let targetItem = galleryFilenameMap.get(filename);
            if (targetItem) return targetItem;
            // getGalleryItemByFilename: public/scripts/comp/galleryView.js
            targetItem = getGalleryItemByFilename(filename, true);
            if (targetItem) {
                galleryFilenameMap.set(targetItem.dataset.filename || filename, targetItem);
            }
            return targetItem;
        };

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
                    targetItem = findGalleryCellByFilename(filename);
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
                    targetItem = findGalleryCellByFilename(filename);
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
                                        if (window.chatSystem) {
                                            window.chatSystem.openChatModal(filename, imageData.characterName || null);
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
        // the gallery's own lightbox opens in the same window: hook its PhotoSwipe into the chrome
        lightbox.on('beforeOpen', () => {
            if (lightbox.pswp) attachGlancewellChrome(lightbox.pswp);
        });

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
async function openStandalonePhotoSwipe(dataSource, index, options) {
    try {
        const PhotoSwipe = await import('/dist/photoswipe/photoswipe.esm.js');

        const useDesktopShell = document.body.classList.contains('desktop-mode');
        const mount = getPhotoSwipeMount();

        const multi = Array.isArray(dataSource) && dataSource.length > 1;
        const start = Number.isInteger(index) ? Math.max(0, Math.min(index, dataSource.length - 1)) : 0;
        const opts = {
            dataSource: dataSource,
            index: start,
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
        if (options && options.directorPrints) pswp._directorPrints = true;

        if (useDesktopShell) {
            pswp.addFilter('thumbBounds', (thumbBounds) => adjustThumbBoundsForPhotoSwipeMount(thumbBounds));
            pswp.on('viewportSize', () => syncPhotoSwipeContainedScrollOffset(pswp));
            ensurePhotoSwipeMountResizeObserver();
            attachStandalonePhotoSwipeShellRestoreUi(pswp);
            attachGlancewellChrome(pswp);
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