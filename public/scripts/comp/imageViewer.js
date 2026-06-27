// Image Viewer Modal Manager
// Supports multiple instances for viewing images in separate windows

class ImageViewerManager {
    constructor() {
        this.viewers = new Map(); // Map of viewer IDs to viewer instances
        this.nextId = 1;
        this.template = null;
    }

    init() {
        this.template = document.getElementById('imageViewerModalTemplate');
        if (!this.template) {
            console.error('Image viewer template not found');
            return;
        }
    }

    // Create a new image viewer instance
    createViewer(imageSrc, title = 'Image', metadata = {}) {
        const viewerId = `imageViewer_${this.nextId++}`;
        const viewerElement = this.template.cloneNode(true);
        viewerElement.id = viewerId;

        // Update IDs to be unique
        this.updateElementIds(viewerElement, viewerId);

        // Set stable identifier for position restoration (based on image source/filename)
        // For transient windows, we need a stable ID that persists across window recreations
        let windowIdentifier = null;
        if (metadata && metadata.filename) {
            // Use filename as identifier for gallery images
            windowIdentifier = `imageViewer:${metadata.filename}`;
        } else if (metadata && metadata.hash) {
            // Use hash for reference images
            windowIdentifier = `imageViewer:${metadata.hash}`;
        } else if (imageSrc) {
            // Fallback: use image source (extract filename if it's a path)
            const srcMatch = imageSrc.match(/\/([^\/]+)$/);
            if (srcMatch) {
                windowIdentifier = `imageViewer:${srcMatch[1]}`;
            } else {
                // Use full source as identifier (for data URLs, etc.)
                windowIdentifier = `imageViewer:${imageSrc.substring(0, 100)}`; // Limit length
            }
        }

        if (windowIdentifier) {
            viewerElement.dataset.windowIdentifier = windowIdentifier;
            // Mark this transient window for position restoration
            transientWindowsWithPositions.add(windowIdentifier);
        }

        // Tile new windows only when there is no saved position to restore
        const hasSavedPosition = windowIdentifier
            && typeof globalWindowPositions !== 'undefined'
            && globalWindowPositions[windowIdentifier]?.topLeft;
        if (!hasSavedPosition) {
            const tileOffset = this.calculateTileOffset();
            viewerElement.style.setProperty('--modal-offset-x', `${Math.round(tileOffset.x)}px`);
            viewerElement.style.setProperty('--modal-offset-y', `${Math.round(tileOffset.y)}px`);
        }

        // Insert into DOM
        document.body.appendChild(viewerElement);

        // Create viewer instance (openModal will be called in init, which adds resize handles)
        const viewer = new ImageViewer(viewerId, viewerElement, imageSrc, title, metadata, this);
        this.viewers.set(viewerId, viewer);

        return viewer;
    }

    // Calculate tiling offset for new windows (like a normal OS)
    calculateTileOffset() {
        const existingViewers = Array.from(this.viewers.values());
        const tileOffsetX = 40; // Horizontal offset between windows
        const tileOffsetY = 40; // Vertical offset between windows

        // Use default modal size for calculations (modal size is adjusted later, but we need bounds now)
        // Get from template or use reasonable defaults
        const defaultModalWidth = parseInt(this.template?.dataset?.windowMaxWidth) || 800;
        const defaultModalHeight = parseInt(this.template?.dataset?.windowMaxHeight) || 600;

        // Use actual size from first existing viewer if available (more accurate)
        let modalWidth = defaultModalWidth;
        let modalHeight = defaultModalHeight;
        if (existingViewers.length > 0) {
            const firstViewer = existingViewers[0];
            const computedStyle = getComputedStyle(firstViewer.element);
            const width = parseFloat(computedStyle.width) || defaultModalWidth;
            const height = parseFloat(computedStyle.height) || defaultModalHeight;
            modalWidth = width;
            modalHeight = height;
        }

        // Calculate viewport center
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        // Calculate maximum allowed offsets to keep window on screen
        // Modal is centered, so offset is relative to center
        // Left edge: centerX - modalWidth/2 + offsetX >= 0
        // Right edge: centerX + modalWidth/2 + offsetX <= window.innerWidth
        const minOffsetX = modalWidth / 2 - centerX;
        const maxOffsetX = window.innerWidth - centerX - modalWidth / 2;

        // Top edge: centerY - modalHeight/2 + offsetY >= 0
        // Bottom edge: centerY + modalHeight/2 + offsetY <= window.innerHeight
        const minOffsetY = modalHeight / 2 - centerY;
        const maxOffsetY = window.innerHeight - centerY - modalHeight / 2;

        if (existingViewers.length === 0) {
            // First window - centered (within bounds, rounded to whole numbers)
            return {
                x: Math.round(Math.max(minOffsetX, Math.min(0, maxOffsetX))),
                y: Math.round(Math.max(minOffsetY, Math.min(0, maxOffsetY)))
            };
        }

        // Calculate position based on number of existing windows
        // Cascade diagonally: each new window is offset by tileOffsetX and tileOffsetY
        const index = existingViewers.length;

        // Try diagonal cascade first
        let x = index * tileOffsetX;
        let y = index * tileOffsetY;

        // Clamp to bounds
        x = Math.max(minOffsetX, Math.min(x, maxOffsetX));
        y = Math.max(minOffsetY, Math.min(y, maxOffsetY));

        // If we've hit the horizontal limit, wrap to a new row
        if (x >= maxOffsetX - tileOffsetX) {
            const row = Math.floor(index / Math.floor((maxOffsetX - minOffsetX) / tileOffsetX));
            const col = index % Math.floor((maxOffsetX - minOffsetX) / tileOffsetX);
            x = minOffsetX + col * tileOffsetX;
            y = minOffsetY + row * tileOffsetY;

            // Clamp again after wrapping
            x = Math.max(minOffsetX, Math.min(x, maxOffsetX));
            y = Math.max(minOffsetY, Math.min(y, maxOffsetY));
        }

        // Final safety check - ensure we're within bounds (rounded to whole numbers)
        return {
            x: Math.round(Math.max(minOffsetX, Math.min(x, maxOffsetX))),
            y: Math.round(Math.max(minOffsetY, Math.min(y, maxOffsetY)))
        };
    }

    // Update element IDs to be unique for this viewer instance
    updateElementIds(element, viewerId) {
        const elementsWithIds = element.querySelectorAll('[id]');
        elementsWithIds.forEach(el => {
            const originalId = el.id;
            el.id = `${originalId}_${viewerId}`;
        });
    }

    // Remove a viewer instance
    removeViewer(viewerId) {
        const viewer = this.viewers.get(viewerId);
        if (viewer) {
            viewer.destroy();
            this.viewers.delete(viewerId);
        }
    }

    // Get viewer by ID
    getViewer(viewerId) {
        return this.viewers.get(viewerId);
    }
}

class ImageViewer {
    constructor(id, element, imageSrc, title, metadata, manager) {
        this.id = id;
        this.element = element;
        this.imageSrc = imageSrc;
        this.title = title;
        this.metadata = metadata;
        this.manager = manager;

        this.zoomLevel = 1.0;
        this.minZoom = null;
        this.maxZoom = 5.0;
        this.zoomStep = 0.25;
        this.isMinimized = false;
        this.isMaximized = false;
        this._preMaximizeLayout = null;
        this._zoomSnapEscapeAccum = { value: 0 };

        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartPanX = 0;
        this.dragStartPanY = 0;

        this.wireBoundHandlers();
        this.init();
        this.loadImage();
        this.setupEventListeners();
        this.setupContextMenu();
        this.setupResizeHandler();
        this.element.addEventListener('modalMaximized', () => {
            setTimeout(() => this.fitToScreen(), 50);
        });
        this.element.addEventListener('modalRestored', () => {
            setTimeout(() => this.fitToScreen(), 50);
        });
    }

    wireBoundHandlers() {
        this.boundDragMove = (e) => this.handleDragMove(e);
        this.boundDragEnd = (e) => this.handleDragEnd(e);
        this.boundTouchStart = (e) => this.handleTouchStart(e);
        this.boundTouchMove = (e) => this.handleTouchMove(e);
        this.boundTouchEnd = (e) => this.handleTouchEnd(e);
        this.boundBlurHandler = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.updateCursor();
            }
        };
        this.boundContextMenuHandler = (e) => this.handleContextMenuAction(e);
    }

    wireModalListenerScope() {
        if (this.element._imageViewerModalScopeWired) return;
        this.element._imageViewerModalScopeWired = true;
        // attachModalListeners: public/scripts/comp/modalListenerScope.js
        attachModalListeners(this.element, (signal) => {
            document.addEventListener('mousemove', this.boundDragMove, { signal });
            document.addEventListener('mouseup', this.boundDragEnd, { signal });
            document.addEventListener('touchmove', this.boundTouchMove, { passive: false, signal });
            document.addEventListener('touchend', this.boundTouchEnd, { signal });
            window.addEventListener('blur', this.boundBlurHandler, { signal });
            document.addEventListener('contextMenuAction', this.boundContextMenuHandler, { signal });
        });

        registerKeyboardListener({
            id: `imageViewer.overlayClose.${this.id}`,
            type: 'whenFocused',
            modalId: this.id,
            label: 'Close',
            keys: 'Alt+Q',
            overlayIcon: 'fas fa-times',
            overlayGroup: 'Lumen',
            overlayOnly: true,
            priority: -10
        });
    }

    init() {
        // Set title with "Lumen [name]" format
        const titleElement = this.element.querySelector(`#imageViewerTitle_${this.id}`);
        if (titleElement) {
            titleElement.textContent = `Lumen [${this.title}]`;
        }

        this.wireModalListenerScope();
        openModal(this.element);
        // Backup scope open — openModal skips Lumen position restore, not onModalOpened (modalListenerScope.js)
        onModalOpened(this.element);

        // Restore after visible — openModal skips Lumen position restore (public/scripts/comp/modalUtils.js)
        const windowKey = this.element.dataset.windowIdentifier;
        const hasSavedLayout = window.isDesktop && windowKey
            && typeof globalWindowPositions !== 'undefined'
            && globalWindowPositions[windowKey]?.topLeft;

        if (hasSavedLayout) {
            this.element.setAttribute('data-window-position-restored', 'true');
            const applySavedLayout = () => {
                restoreWindowPosition(this.element);
                ensureModalEdgesWithinWorkArea(this.element);
            };

            if (this.element.classList.contains('opening')) {
                const onOpened = (e) => {
                    if (e.target !== this.element || e.animationName !== 'modalSlideIn') {
                        return;
                    }
                    this.element.removeEventListener('animationend', onOpened);
                    requestAnimationFrame(applySavedLayout);
                };
                this.element.addEventListener('animationend', onOpened);
            } else {
                requestAnimationFrame(() => requestAnimationFrame(applySavedLayout));
            }
        }
    }

    loadImage() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        const blurBackground = this.element.querySelector('.image-viewer-blur-background');

        if (imgElement) {
            imgElement.src = this.imageSrc;
            imgElement.onload = () => {
                this.adjustModalSizeForImage(imgElement);
                this.updateZoomDisplay();
                this.fitToScreen();
                this.updateCursor();
            };
        }

        // Set blur preview as background if available
        if (blurBackground && this.metadata) {
            const blurUrl = this.getBlurPreviewUrl();
            if (blurUrl) {
                blurBackground.style.backgroundImage = `url("${blurUrl}")`;
            }
        }
    }

    adjustModalSizeForImage(imgElement) {
        const width = imgElement.naturalWidth || this.metadata?.width || 512;
        const height = imgElement.naturalHeight || this.metadata?.height || 512;

        // Calculate aspect ratio
        const aspectRatio = width / height;

        // Get constraints from modal data attributes
        const maxWidth = parseInt(this.element.dataset.windowMaxWidth) || 1600;
        const maxHeight = parseInt(this.element.dataset.windowMaxHeight) || 1200;
        const minWidth = parseInt(this.element.dataset.windowMinWidth) || 400;
        const minHeight = parseInt(this.element.dataset.windowMinHeight) || 300;

        let modalWidth, modalHeight;

        // Base height — generous default so the window is usable without manual resize
        const baseHeight = 780;
        const sizePadding = 1.12;

        if (aspectRatio >= 1.5) {
            // Wide landscape - wider modal
            modalWidth = Math.min(baseHeight * aspectRatio * sizePadding, maxWidth);
            modalHeight = Math.min(baseHeight * sizePadding, maxHeight);
        } else if (aspectRatio >= 0.8) {
            // Square-ish - balanced modal
            modalWidth = Math.min(880 * sizePadding, maxWidth);
            modalHeight = Math.min(baseHeight * sizePadding, maxHeight);
        } else if (aspectRatio >= 0.5) {
            // Portrait - narrower modal
            modalWidth = Math.max(baseHeight * aspectRatio * sizePadding, minWidth);
            modalHeight = Math.min(baseHeight * sizePadding, maxHeight);
        } else {
            // Very tall portrait - minimum width
            modalWidth = minWidth;
            modalHeight = Math.min((minWidth / aspectRatio) * sizePadding, maxHeight);
        }

        // Apply constraints
        modalWidth = Math.max(minWidth, Math.min(modalWidth, maxWidth));
        modalHeight = Math.max(minHeight, Math.min(modalHeight, maxHeight));

        // Saved layout already has size — only auto-size brand-new windows
        if (this.element.getAttribute('data-window-position-restored') === 'true') {
            this.element.removeAttribute('data-window-position-restored');
            return;
        }

        // setModalSizePreservingCenter: public/scripts/comp/modalUtils.js
        setModalSizePreservingCenter(this.element, modalWidth, modalHeight);
    }

    // Get blur preview URL from metadata
    getBlurPreviewUrl() {
        // For gallery images with filenames
        if (this.metadata.filename || this.metadata.base || this.metadata.original) {
            const filename = this.metadata.filename || this.metadata.base || this.metadata.original;
            const baseName = this.getBaseName(filename);
            return `/previews/${encodeURIComponent(baseName)}@blur.webp`;
        }

        // For cache/reference images with preview info
        if (this.metadata.preview) {
            const blurPreview = this.metadata.preview.replace('.webp', '@blur.webp');
            return `/previews/${encodeURIComponent(blurPreview)}`;
        }

        return null;
    }

    // Get base name without _upscaled suffix and extension
    getBaseName(filename) {
        return filename
            .replace(/_upscaled(?=\.)/, '')  // Remove _upscaled suffix
            .replace(/\.(jpg|jpeg|png|webp)$/i, '');  // Remove extension
    }

    setupEventListeners() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        const container = this.element.querySelector('.image-container');

        // Toolbar buttons
        this.setupToolbarButtons();

        // Image interaction
        if (imgElement) {
            imgElement.addEventListener('dblclick', () => this.openInLightbox());
            imgElement.addEventListener('wheel', (e) => this.handleZoom(e));
            imgElement.addEventListener('mousedown', (e) => this.handleDragStart(e));
        }

        if (container) {
            container.addEventListener('mousedown', (e) => {
                if (e.target === container) {
                    this.handleDragStart(e);
                }
            });
        }

        if (imgElement) {
            imgElement.addEventListener('touchstart', this.boundTouchStart, { passive: false });
        }

        if (container) {
            container.addEventListener('touchstart', (e) => {
                if (e.target === container) {
                    this.boundTouchStart(e);
                }
            }, { passive: false });
        }

        // Close button
        const closeBtn = this.element.querySelector(`.close-btn`);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Minimize button
        const minimizeBtn = this.element.querySelector(`.minimize-btn`);
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => this.toggleMinimize());
        }
    }

    setupToolbarButtons() {
        const zoomInBtn = this.element.querySelector(`#zoomInBtn_${this.id}`);
        const zoomOutBtn = this.element.querySelector(`#zoomOutBtn_${this.id}`);
        const fitToScreenBtn = this.element.querySelector(`#fitToScreenBtn_${this.id}`);
        const actualSizeBtn = this.element.querySelector(`#actualSizeBtn_${this.id}`);
        const openInLightboxBtn = this.element.querySelector(`#openInLightboxBtn_${this.id}`);

        // Zoom controls
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
        if (fitToScreenBtn) fitToScreenBtn.addEventListener('click', () => this.fitToScreen());
        if (actualSizeBtn) actualSizeBtn.addEventListener('click', () => this.actualSize());
        if (openInLightboxBtn) openInLightboxBtn.addEventListener('click', () => this.openInLightbox());
        // Work-area maximize: .modal-work-area-maximize → openModal wireModalMaximizeButton
    }

    setupContextMenu() {
        const container = this.element.querySelector('.image-container');
        if (!container || !contextMenu) return;

        const hasMetadata = this.hasValidMetadata();

        // Build context menu config dynamically
        const contextMenuConfig = {
            maxHeight: true,
            sections: []
        };

        // Icon actions section (always available)
        const isNax = this.isNaxImage();
        const iconActions = [
            {
                icon: isNax ? 'nai-clipboard' : 'fas fa-clipboard',
                tooltip: isNax ? 'Copy tag' : 'Copy',
                action: isNax ? 'image-viewer-copy-tag' : 'image-viewer-copy'
            },
            {
                icon: 'fas fa-download',
                tooltip: 'Download',
                action: 'image-viewer-download'
            }
        ];

        if (hasMetadata) {
            iconActions.unshift({
                icon: 'fa-regular fa-star',
                tooltip: 'Favorite',
                action: 'image-viewer-toggle-pin',
                loadfn: (menuItem) => {
                    const filename = this.getImageFilename();
                    if (filename) {
                        const isPinned = checkIfImageIsPinned(filename);
                        menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                        menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                    }
                }
            });
            iconActions.splice(2, 0, {
                icon: 'fas fa-dice-three',
                tooltip: 'Recast Spell',
                action: 'image-viewer-reroll'
            });
        }

        contextMenuConfig.sections.push({
            type: 'icons',
            position: 'outer',
            icons: iconActions
        });

        // Atelier / NAX tag previews (public/scripts/comp/naxtApplet.js)
        if (isNax) {
            contextMenuConfig.sections[0].icons.push(
                {
                    icon: 'fa-regular fa-star',
                    tooltip: 'Favorite',
                    action: 'image-viewer-nax-fav',
                    loadfn: (menuItem) => {
                        const fav = !!(this.metadata && this.metadata.naxFavorite);
                        menuItem.icon = fav ? 'fas fa-star' : 'fa-regular fa-star';
                        menuItem.tooltip = fav ? 'Unfavorite' : 'Favorite';
                    }
                },
                {
                    icon: 'fas fa-vial',
                    tooltip: 'Try',
                    action: 'image-viewer-nax-try',
                    loadfn: (menuItem) => {
                        const on = !!(this.metadata && this.metadata.naxTryMark);
                        menuItem.icon = on ? 'fas fa-vial-circle-check' : 'fas fa-vial';
                        menuItem.tooltip = on ? 'Remove try mark' : 'Mark to try';
                    }
                },
                {
                    icon: 'fas fa-shopping-bag',
                    tooltip: 'Add to bag',
                    action: 'image-viewer-add-to-bag'
                }
            );
            contextMenuConfig.sections.push({
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-plus',
                        text: 'Add to Prompt',
                        action: 'image-viewer-add-to-prompt',
                        disabled: () => {
                            const manualModal = document.getElementById('manualModal');
                            return manualModal && manualModal.classList.contains('hidden');
                        }
                    },
                    {
                        icon: 'fas fa-arrows-rotate',
                        text: 'Replace in Prompt',
                        action: 'image-viewer-replace-prompt',
                        disabled: () => {
                            const manualModal = document.getElementById('manualModal');
                            return manualModal && manualModal.classList.contains('hidden');
                        }
                    },

                    {
                        icon: 'fas fa-layer-group',
                        text: 'PhaseWalker',
                        openOnHover: true,
                        optionsfn: () => {
                            // buildPhasewalkerContextSubmenuItems: public/scripts/comp/runCommandIndex.js
                            if (typeof buildPhasewalkerContextSubmenuItems === 'function') {
                                return buildPhasewalkerContextSubmenuItems(this.title);
                            }
                            return [{ text: 'Unavailable', disabled: true }];
                        },
                        handlerfn: (subItem) => {
                            // handlePhasewalkerContextSubmenuAction: public/scripts/comp/runCommandIndex.js
                            if (handlePhasewalkerContextSubmenuAction) {
                                handlePhasewalkerContextSubmenuAction(subItem);
                            }
                        }
                    }
                ]
            });
        }

        // Metadata-dependent actions
        if (hasMetadata) {
            const items = [];

            // Always available if has metadata
            items.push(
                {
                    icon: 'fas fa-compass-drafting',
                    text: 'Open in Studio',
                    action: 'image-viewer-creator'
                },
                {
                    icon: 'mdi mdi-1-25 mdi-relative-scale',
                    text: 'Expand Canvas',
                    action: 'image-viewer-expand'
                },
                {
                    icon: 'nai-upscale',
                    text: 'Upscale',
                    action: 'image-viewer-upscale',
                    disabled: !!this.metadata.upscaled
                },
                { separator: true },
                {
                    icon: 'fas fa-person-to-portal',
                    text: 'New Persona',
                    action: 'image-viewer-start-chat'
                },
                {
                    icon: 'fas fa-image',
                    text: 'Set as Wallpaper',
                    action: 'image-viewer-set-wallpaper',
                    hidden: () => !document.body.classList.contains('desktop-mode')
                },
                {
                    icon: 'fas fa-film-canister',
                    text: 'Jump to Image',
                    action: 'image-viewer-jump-workspace'
                },
                {
                    icon: 'nai-img2img',
                    text: 'New Reference',
                    action: 'image-viewer-create-reference'
                },
                {
                    icon: 'fas fa-arrow-down-left',
                    text: 'Add to Desktop',
                    action: 'image-viewer-desktop-shortcut',
                    hidden: () => !document.body.classList.contains('desktop-mode')
                }
            );

            contextMenuConfig.sections.push({
                type: 'list',
                items: items
            });

            // Management section
            contextMenuConfig.sections.push({
                type: 'list',
                title: 'Management',
                items: [
                    {
                        content: (target) => this.buildMoveToMenuContent(target),
                        optionsfn: getMoveWorkspaceOptions,
                        handlerfn: handleMoveWorkspaceAction,
                        openOnHover: false,
                        loadfn: (menuItem) => {
                            // getMoveWorkspaceOptions: public/scripts/comp/galleryView.js
                            const options = getMoveWorkspaceOptions(null);
                            menuItem.disabled = !options.length;
                        }
                    },
                    {
                        icon: 'fas fa-bin-recycle',
                        text: 'Scrap',
                        action: 'image-viewer-scrap'
                    },
                    {
                        icon: 'fas fa-fire',
                        text: 'Incinerate',
                        action: 'image-viewer-incinerate'
                    }
                ]
            });
        }

        // Attach context menu
        contextMenu.attachToElement(container, contextMenuConfig);

        // contextMenuAction scoped via wireModalListenerScope — modalListenerScope.js
    }

    handleContextMenuAction(event) {
        const { action, target } = event.detail;

        // Check if this action is for our image viewer
        if (!action || !action.startsWith('image-viewer-')) return;

        // Verify the target is within our modal
        if (!this.element.contains(target)) return;

        switch (action) {
            case 'image-viewer-copy':
                this.copyToClipboard();
                break;
            case 'image-viewer-download':
                this.download();
                break;
            case 'image-viewer-toggle-pin':
                this.togglePin();
                break;
            case 'image-viewer-reroll':
                this.reroll();
                break;
            case 'image-viewer-creator':
                this.openInCreator();
                break;
            case 'image-viewer-expand':
                this.expand();
                break;
            case 'image-viewer-upscale':
                this.upscale();
                break;
            case 'image-viewer-jump-workspace':
                void this.jumpToInWorkspace();
                break;
            case 'image-viewer-scrap':
                this.scrap();
                break;
            case 'image-viewer-incinerate':
                this.incinerate();
                break;
            case 'image-viewer-start-chat':
                this.startChat();
                break;
            case 'image-viewer-set-wallpaper':
                this.setAsWallpaper();
                break;
            case 'image-viewer-desktop-shortcut':
                this.addDesktopShortcut();
                break;
            case 'image-viewer-create-reference':
                this.createReference();
                break;
            case 'image-viewer-copy-tag':
                if (this.isNaxImage() && window.naxtApplet) {
                    window.naxtApplet.copyTag(this.title);
                }
                break;
            case 'image-viewer-add-to-prompt':
                if (this.isNaxImage() && window.naxtApplet) {
                    window.naxtApplet.addToPrompt(this.title, this.metadata.naxGallerySlug, 'add');
                }
                break;
            case 'image-viewer-replace-prompt':
                if (this.isNaxImage() && window.naxtApplet) {
                    window.naxtApplet.addToPrompt(this.title, this.metadata.naxGallerySlug, 'replace');
                }
                break;
            case 'image-viewer-add-to-bag':
                if (this.isNaxImage() && window.naxtApplet) {
                    void window.naxtApplet.addToBag(
                        this.title,
                        this.metadata.naxGallerySlug,
                        this.metadata.naxFilename
                    );
                }
                break;
            case 'image-viewer-nax-fav':
                if (this.isNaxImage() && window.naxtApplet) {
                    const nextFav = !this.metadata.naxFavorite;
                    void window.naxtApplet.setFavoriteForTag(
                        this.metadata.naxGallerySlug,
                        this.title,
                        nextFav
                    ).then(() => {
                        this.metadata.naxFavorite = nextFav;
                    });
                }
                break;
            case 'image-viewer-nax-try':
                if (this.isNaxImage() && window.naxtApplet) {
                    const nextTry = !this.metadata.naxTryMark;
                    void window.naxtApplet.setTryMarkForTag(
                        this.metadata.naxGallerySlug,
                        this.title,
                        nextTry
                    ).then(() => {
                        this.metadata.naxTryMark = nextTry;
                    });
                }
                break;
        }
    }

    isNaxImage() {
        return !!(this.metadata && this.metadata.naxGallerySlug && this.metadata.naxFilename);
    }

    getImageFilename() {
        if (!this.metadata) return null;
        return this.metadata.filename || this.metadata.original || this.metadata.upscaled || null;
    }

    getImageWorkspaceId() {
        if (this.metadata?.workspace) {
            return this.metadata.workspace;
        }
        const filename = this.getImageFilename();
        if (filename && findImageByFilename(filename)) {
            return (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
        }
        return this.metadata?.generatedWorkspace || null;
    }

    buildMoveToMenuContent() {
        const workspaceId = this.getImageWorkspaceId()
            || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null)
            || window.activeWorkspace
            || 'default';
        const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
        const workspaceColor = workspacesData[workspaceId]?.color || '#6366f1';
        return `
            <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                <span class="context-menu-item-text">Move to...</span>
            </div>
        `;
    }

    hasValidMetadata() {
        if (!this.metadata) return false;
        // NAX tag wiki / arbitrary URL previews: not workspace gallery images (no Reroll, Scrap, pin, etc.)
        if (this.metadata.genericExternalImage) return false;
        return !!(this.metadata.filename || this.metadata.base || this.metadata.original);
    }

    zoomIn() {
        this.setZoom(this.zoomLevel + this.zoomStep, { applyDisplaySnap: true, wheelDelta: -1 });
    }

    zoomOut() {
        this.setZoom(this.zoomLevel - this.zoomStep, { applyDisplaySnap: true, wheelDelta: 1 });
    }

    _getCssScale() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        const container = this.element.querySelector('.image-container');
        if (!imgElement || !container || !imgElement.naturalWidth || !imgElement.naturalHeight) {
            return null;
        }
        const containerRect = container.getBoundingClientRect();
        const scaleX = containerRect.width / imgElement.naturalWidth;
        const scaleY = containerRect.height / imgElement.naturalHeight;
        return Math.min(scaleX, scaleY, 1.0) || null;
    }

    _getActualSizeZoom() {
        const cssScale = this._getCssScale();
        if (!cssScale) return null;
        return 1.0 / cssScale;
    }

    _applyActualSizeDisplaySnap(nextLevel) {
        const cssScale = this._getCssScale();
        const actualSizeZoom = this._getActualSizeZoom();
        if (!cssScale || !actualSizeZoom) {
            return nextLevel;
        }

        const currentDisplay = this.zoomLevel * cssScale;
        const nextDisplay = nextLevel * cssScale;
        const snapTolerance = 0.05;

        const crossingUp = currentDisplay < 1.0 && nextDisplay >= 1.0 - snapTolerance;
        const crossingDown = currentDisplay > 1.0 && nextDisplay <= 1.0 + snapTolerance;
        const nearActual = Math.abs(nextDisplay - 1.0) < snapTolerance;

        if (crossingUp || crossingDown || nearActual) {
            return actualSizeZoom;
        }

        return nextLevel;
    }

    _getZoomSnapPresets() {
        const presets = [1.0];
        const actualSizeZoom = this._getActualSizeZoom();
        if (actualSizeZoom != null && Math.abs(actualSizeZoom - 1.0) > 0.02) {
            presets.push(actualSizeZoom);
        }
        return presets.sort((a, b) => a - b);
    }

    _snapZoomLevel(level, wheelDelta) {
        const presets = this._getZoomSnapPresets();
        const tolerance = 0.05;
        const absDelta = Math.abs(wheelDelta);
        const atPreset = presets.find((p) => Math.abs(level - p) < tolerance * 0.35);

        if (atPreset != null) {
            this._zoomSnapEscapeAccum.value += absDelta;
            if (this._zoomSnapEscapeAccum.value < 80) {
                return atPreset;
            }
            this._zoomSnapEscapeAccum.value = 0;
            return level;
        }

        const nearPreset = presets.find((p) => Math.abs(level - p) < tolerance);
        if (nearPreset != null && absDelta < 50) {
            this._zoomSnapEscapeAccum.value = 0;
            return nearPreset;
        }

        this._zoomSnapEscapeAccum.value = 0;
        return level;
    }

    setZoom(level, options = {}) {
        const minZoom = this.minZoom || 0.1;
        let nextLevel = Math.max(minZoom, Math.min(this.maxZoom, level));
        if (options.applyDisplaySnap || options.wheelDelta != null) {
            nextLevel = this._applyActualSizeDisplaySnap(nextLevel);
        }
        if (options.wheelDelta != null) {
            nextLevel = this._snapZoomLevel(nextLevel, options.wheelDelta);
        }
        this.zoomLevel = nextLevel;
        this.panX = 0;
        this.panY = 0;
        this.updateImageTransform();
        this.updateZoomDisplay();
        this.updateCursor();
    }

    fitToScreen() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        const container = this.element.querySelector('.image-container');

        if (imgElement && container) {
            // Fit to screen is zoom 1.0 - CSS max-width/max-height does the fitting
            this.minZoom = 1.0;
            this.zoomLevel = 1.0;
            this.panX = 0;
            this.panY = 0;

            this.updateImageTransform();
            this.updateZoomDisplay();
            this.updateCursor();
        }
    }

    actualSize() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        const container = this.element.querySelector('.image-container');

        if (imgElement && container) {
            const containerRect = container.getBoundingClientRect();
            const imgNaturalWidth = imgElement.naturalWidth || imgElement.width;
            const imgNaturalHeight = imgElement.naturalHeight || imgElement.height;

            // Calculate how much CSS is scaling the image down
            const scaleX = containerRect.width / imgNaturalWidth;
            const scaleY = containerRect.height / imgNaturalHeight;
            const cssScale = Math.min(scaleX, scaleY, 1.0);

            // To get actual 1:1 pixels, we need to zoom by the inverse of CSS scale
            const actualSizeZoom = 1.0 / cssScale;

            this.zoomLevel = Math.min(actualSizeZoom, this.maxZoom);
            this.panX = 0;
            this.panY = 0;

            this.updateImageTransform();
            this.updateZoomDisplay();
            this.updateCursor();
        }
    }

    updateImageTransform() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        if (imgElement) {
            imgElement.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
        }
    }

    updateCursor() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        if (imgElement) {
            if (this.isDragging) {
                imgElement.style.cursor = 'grabbing';
            } else if (this.zoomLevel > 1.0) {
                imgElement.style.cursor = 'grab';
            } else {
                imgElement.style.cursor = 'zoom-in';
            }
        }
    }

    updateZoomDisplay() {
        const zoomElement = this.element.querySelector(`#zoomLevel_${this.id}`);
        if (zoomElement) {
            // Calculate actual zoom percentage relative to 1:1 size
            const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
            const container = this.element.querySelector('.image-container');

            if (imgElement && container && imgElement.naturalWidth && imgElement.naturalHeight) {
                const containerRect = container.getBoundingClientRect();
                const imgNaturalWidth = imgElement.naturalWidth;
                const imgNaturalHeight = imgElement.naturalHeight;

                // Calculate how much CSS is scaling the image
                const scaleX = containerRect.width / imgNaturalWidth;
                const scaleY = containerRect.height / imgNaturalHeight;
                const cssScale = Math.min(scaleX, scaleY, 1.0);

                // Actual zoom relative to 1:1 = transform scale * CSS scale
                const actualZoom = this.zoomLevel * cssScale;
                zoomElement.textContent = Math.round(actualZoom * 100) + '%';
            } else {
                // Fallback if dimensions not available
                zoomElement.textContent = Math.round(this.zoomLevel * 100) + '%';
            }
        }
    }

    handleZoom(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -this.zoomStep : this.zoomStep;
        this.setZoom(this.zoomLevel + delta, { applyDisplaySnap: true, wheelDelta: e.deltaY });
    }

    handleDragStart(e) {
        // Only allow dragging when zoomed in
        if (this.zoomLevel <= 1.0) return;

        // Don't interfere with text selection or other interactions
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

        e.preventDefault();

        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartPanX = this.panX;
        this.dragStartPanY = this.panY;

        this.updateCursor();
    }

    handleDragMove(e) {
        if (!this.isDragging) return;

        e.preventDefault();

        const deltaX = e.clientX - this.dragStartX;
        const deltaY = e.clientY - this.dragStartY;

        this.panX = this.dragStartPanX + deltaX;
        this.panY = this.dragStartPanY + deltaY;

        this.updateImageTransform();
    }

    handleDragEnd(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.updateCursor();
    }

    handleTouchStart(e) {
        // Only allow dragging when zoomed in
        if (this.zoomLevel <= 1.0) return;

        // Don't interfere with text selection or other interactions
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

        // Use the first touch point
        const touch = e.touches[0];

        this.isDragging = true;
        this.dragStartX = touch.clientX;
        this.dragStartY = touch.clientY;
        this.dragStartPanX = this.panX;
        this.dragStartPanY = this.panY;

        e.preventDefault(); // Prevent default touch actions (scrolling)
        this.updateCursor();
    }

    handleTouchMove(e) {
        if (!this.isDragging) return;

        e.preventDefault(); // Prevent default touch actions (scrolling)

        const touch = e.touches[0];
        const deltaX = touch.clientX - this.dragStartX;
        const deltaY = touch.clientY - this.dragStartY;

        this.panX = this.dragStartPanX + deltaX;
        this.panY = this.dragStartPanY + deltaY;

        this.updateImageTransform();
    }

    handleTouchEnd(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.updateCursor();
    }

    setupResizeHandler() {
        this.boundResizeHandler = () => {
            // When modal is resized, recalculate fit-to-screen if currently at fit
            if (this.zoomLevel === 1.0) {
                // Wait for reflow after resize
                requestAnimationFrame(() => {
                    this.fitToScreen();
                });
            }
        };

        this.element.addEventListener('modalResized', this.boundResizeHandler);
    }

    openInLightbox() {
        // Use existing lightbox functionality
        if (typeof showLightbox === 'function') {
            const filename = this.getImageFilename();
            // If we have metadata with a filename, use that to find the image in the gallery
            if (filename) {
                showLightbox({ filename });
            } else {
                // Standalone image - use URL mode
                const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
                const width = imgElement ? (imgElement.naturalWidth || 1024) : 1024;
                const height = imgElement ? (imgElement.naturalHeight || 1024) : 1024;

                showLightbox({
                    url: this.imageSrc,
                    width: width,
                    height: height
                });
            }
        }
    }

    maximize() {
        if (!this.element) return;
        toggleModalMaximize(this.element);
    }

    download() {
        // Create download link
        const link = document.createElement('a');
        link.href = this.imageSrc;
        link.download = this.title || 'image.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    copyToClipboard() {
        if (typeof copyImageToClipboard === 'function') {
            copyImageToClipboard(this.metadata);
        }
    }

    togglePin() {
        if (typeof togglePinImage === 'function') {
            togglePinImage(this.metadata);
        }
    }

    reroll() {
        if (typeof rerollImage === 'function') {
            rerollImage(this.metadata);
        }
    }

    openInCreator() {
        openManualModalWithContent({
            type: 'image',
            image: this.metadata
        });
    }

    expand() {
        const filename = this.metadata.upscaled || this.metadata.original || this.metadata.filename;
        if (filename && typeof openImageExpansionModal === 'function') {
            openImageExpansionModal(filename);
        }
    }

    upscale() {
        if (typeof upscaleImage === 'function') {
            upscaleImage(this.metadata);
        }
    }

    async jumpToInWorkspace() {
        const filename = this.getImageFilename();
        if (!filename) {
            showGlassToast('warning', 'Not Available', 'No gallery image to jump to', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        const currentWorkspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
        const imageWorkspaceId = this.getImageWorkspaceId() || currentWorkspaceId;

        const findImageIndex = () => {
            if (typeof allImages === 'undefined' || !Array.isArray(allImages) || !allImages.length) {
                return -1;
            }
            return allImages.findIndex(img =>
                img && (img.filename === filename || img.original === filename || img.upscaled === filename)
            );
        };

        let imageIndex = findImageIndex();

        if (imageIndex === -1 && imageWorkspaceId !== currentWorkspaceId) {
            const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
            const workspaceName = workspacesData[imageWorkspaceId]?.name || imageWorkspaceId;
            const confirmed = await showConfirmationDialog(
                `This image is in the "${workspaceName}" workspace. Switch to that workspace and jump to the image?`,
                [
                    { text: 'Switch & Jump', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            if (!confirmed) return;

            if (typeof setActiveWorkspace === 'function') {
                await setActiveWorkspace(imageWorkspaceId);
            }
            if (typeof loadGallery === 'function') {
                await loadGallery(true);
            }
            imageIndex = findImageIndex();
        }

        if (imageIndex === -1 && typeof loadGallery === 'function') {
            await loadGallery(true);
            imageIndex = findImageIndex();
        }

        if (imageIndex === -1) {
            showGlassToast('warning', 'Not Found', 'Image not found in workspace', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        let targetIndex = imageIndex;
        if (typeof window.filteredImageIndices !== 'undefined' && Array.isArray(window.filteredImageIndices)) {
            const filteredIndex = window.filteredImageIndices.indexOf(imageIndex);
            if (filteredIndex !== -1) {
                targetIndex = filteredIndex;
            } else {
                showGlassToast('warning', 'Not Visible', 'Image is filtered out of current view', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }
        }

        const galleryWindow = document.getElementById('galleryWindow');
        if (galleryWindow) {
            // isGalleryWindowHidden, showGalleryWindow, bringModalToFront: public/scripts/comp/modalUtils.js
            if (isGalleryWindowHidden()) {
                openModal(galleryWindow);
                if (typeof window.isGalleryHidden !== 'undefined') {
                    window.isGalleryHidden = false;
                }
            } else {
                bringModalToFront(galleryWindow);
            }
        }

        if (typeof displayGalleryFromStartIndex === 'function') {
            await displayGalleryFromStartIndex(targetIndex, true);
        }
    }

    startChat() {
        const filename = this.getImageFilename();
        if (!filename || !window.chatSystem) return;
        const characterName = this.metadata?.characterName || this.metadata?.metadata?.character_name || null;
        window.chatSystem.openChatModal(filename, characterName);
    }

    setAsWallpaper() {
        const filename = this.getImageFilename();
        if (!filename) return;
        openDesktopSettingsModal(`file:${filename}`);
    }

    addDesktopShortcut() {
        const image = this.metadata;
        if (!image || !this.getImageFilename()) return;
        createDesktopShortcutFromImage(image);
    }

    createReference() {
        const image = this.metadata;
        if (!image || !this.getImageFilename()) return;
        // createVibeEncodingFromImage: public/scripts/comp/galleryView.js
        createVibeEncodingFromImage(image);
    }

    scrap() {
        if (typeof moveToScraps === 'function') {
            moveToScraps(this.metadata);
        }
    }

    incinerate() {
        if (typeof deleteImage === 'function') {
            deleteImage(this.metadata);
        }
    }

    toggleMinimize() {
        const body = this.element.querySelector('.image-viewer-body');
        if (body) {
            this.isMinimized = !this.isMinimized;
            if (this.isMinimized) {
                body.classList.add('minimized');
            } else {
                body.classList.remove('minimized');
            }
        }
    }

    close() {
        closeModal(this.element).then(() => {
            // Remove from DOM after animation
            this.manager.removeViewer(this.id);
        });
    }

    destroy() {
        // Backup scope close — closeModal already calls onModalClosed (modalListenerScope.js)
        onModalClosed(this.element);

        // Remove element listeners if possible (though standard destroy removes element)
        const imgElement = this.element ? this.element.querySelector(`#imageViewerImage_${this.id}`) : null;
        if (imgElement) {
            imgElement.onload = null;
            imgElement.onerror = null;
            const src = imgElement.currentSrc || imgElement.src || '';
            if (src.startsWith('blob:')) {
                URL.revokeObjectURL(src);
            }
            imgElement.removeAttribute('src');
        }
        if (imgElement && this.boundTouchStart) {
            imgElement.removeEventListener('touchstart', this.boundTouchStart);
        }

        if (this._keyboardRegistryId) {
            // deregisterKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
            deregisterKeyboardListener(this._keyboardRegistryId);
            this._keyboardRegistryId = null;
        }

        if (this.boundResizeHandler && this.element) {
            this.element.removeEventListener('modalResized', this.boundResizeHandler);
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

// Global instance
const imageViewerManager = new ImageViewerManager();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => imageViewerManager.init());
} else {
    imageViewerManager.init();
}

// Helper functions for opening images from different sources
window.openImageInViewer = function (imageSrc, title = 'Image', metadata = {}) {
    return imageViewerManager.createViewer(imageSrc, title, metadata);
};

// Helper for opening gallery images
window.openGalleryImageInViewer = function (imageData) {
    if (!imageData) return null;

    // Determine the correct URL for gallery images
    let imageSrc;
    if (imageData.url) {
        // For newly generated images
        imageSrc = imageData.url;
    } else {
        // For gallery images - prefer highest quality version
        const filename = imageData.upscaled || imageData.original;
        imageSrc = `/images/${filename}`;
    }

    const title = imageData.filename || imageData.base || 'Gallery Image';
    return imageViewerManager.createViewer(imageSrc, title, imageData);
};

// Helper for opening reference images (in-app image viewer window; public/scripts/comp/referenceManager.js)
window.openReferenceImageInViewer = function (cacheImage) {
    if (!cacheImage) return null;

    // Use the same logic as the reference browser preview function
    let imageSrc;
    if (cacheImage.isStandalone) {
        if (cacheImage.type === 'base64' && cacheImage.source) {
            imageSrc = `data:image/png;base64,${cacheImage.source}`;
        } else if (cacheImage.type === 'vibe' && cacheImage.source) {
            imageSrc = `data:image/png;base64,${cacheImage.source}`;
        } else if (cacheImage.hasPreview) {
            imageSrc = `/cache/preview/${cacheImage.hasPreview}`;
        }
    } else {
        if (cacheImage.hash) {
            imageSrc = `/cache/upload/${cacheImage.hash}`;
        } else if (cacheImage.hasPreview) {
            imageSrc = `/cache/preview/${cacheImage.hash}.webp`;
        }
    }

    if (!imageSrc) {
        imageSrc = '/static_images/background.jpg';
    }

    const title = cacheImage.filename || cacheImage.hash || 'Reference Image';
    return imageViewerManager.createViewer(imageSrc, title, cacheImage);
};

// Export for use in other modules
window.imageViewerManager = imageViewerManager;
