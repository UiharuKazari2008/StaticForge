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
    createViewer(imageSrc, title = 'Image Viewer', metadata = {}) {
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

        // Calculate tiling offset for this window
        const tileOffset = this.calculateTileOffset();
        viewerElement.style.setProperty('--modal-offset-x', `${Math.round(tileOffset.x)}px`);
        viewerElement.style.setProperty('--modal-offset-y', `${Math.round(tileOffset.y)}px`);

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

        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartPanX = 0;
        this.dragStartPanY = 0;

        this.init();
        this.loadImage();
        this.setupEventListeners();
        this.setupWindowBlurHandler();
        this.setupContextMenu();
        this.setupResizeHandler();
    }

    init() {
        // Set title with "Preview [name]" format
        const titleElement = this.element.querySelector(`#imageViewerTitle_${this.id}`);
        if (titleElement) {
            titleElement.textContent = `Preview [${this.title}]`;
        }

        // Open modal
        openModal(this.element);
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

        // Base height - reasonable viewing size
        const baseHeight = 600;

        if (aspectRatio >= 1.5) {
            // Wide landscape - wider modal
            modalWidth = Math.min(baseHeight * aspectRatio, maxWidth);
            modalHeight = baseHeight;
        } else if (aspectRatio >= 0.8) {
            // Square-ish - balanced modal
            modalWidth = 700;
            modalHeight = 600;
        } else if (aspectRatio >= 0.5) {
            // Portrait - narrower modal
            modalWidth = Math.max(baseHeight * aspectRatio, minWidth);
            modalHeight = baseHeight;
        } else {
            // Very tall portrait - minimum width
            modalWidth = minWidth;
            modalHeight = Math.min(minWidth / aspectRatio, maxHeight);
        }

        // Apply constraints
        modalWidth = Math.max(minWidth, Math.min(modalWidth, maxWidth));
        modalHeight = Math.max(minHeight, Math.min(modalHeight, maxHeight));

        // Set modal size
        this.element.style.width = `${Math.round(modalWidth)}px`;
        this.element.style.height = `${Math.round(modalHeight)}px`;
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

        this.boundDragMove = (e) => this.handleDragMove(e);
        this.boundDragEnd = (e) => this.handleDragEnd(e);

        document.addEventListener('mousemove', this.boundDragMove);
        document.addEventListener('mouseup', this.boundDragEnd);

        // Touch events
        this.boundTouchStart = (e) => this.handleTouchStart(e);
        this.boundTouchMove = (e) => this.handleTouchMove(e);
        this.boundTouchEnd = (e) => this.handleTouchEnd(e);

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

        document.addEventListener('touchmove', this.boundTouchMove, { passive: false });
        document.addEventListener('touchend', this.boundTouchEnd);

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
        const maximizeBtn = this.element.querySelector(`#maximizeBtn_${this.id}`);

        // Zoom controls
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
        if (fitToScreenBtn) fitToScreenBtn.addEventListener('click', () => this.fitToScreen());
        if (actualSizeBtn) actualSizeBtn.addEventListener('click', () => this.actualSize());
        if (openInLightboxBtn) openInLightboxBtn.addEventListener('click', () => this.openInLightbox());
        if (maximizeBtn) maximizeBtn.addEventListener('click', () => this.maximize());
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
        contextMenuConfig.sections.push({
            type: 'icons',
            position: 'outer',
            icons: [
                {
                    icon: 'fas fa-clipboard',
                    tooltip: 'Copy',
                    action: 'image-viewer-copy'
                },
                {
                    icon: 'fas fa-download',
                    tooltip: 'Download',
                    action: 'image-viewer-download'
                }
            ]
        });

        // Add pin icon if metadata available
        if (hasMetadata) {
            contextMenuConfig.sections[0].icons.unshift({
                icon: 'fa-regular fa-star',
                tooltip: 'Favorite',
                action: 'image-viewer-toggle-pin',
                loadfn: (menuItem, target) => {
                    const filename = this.metadata.filename || this.metadata.original || this.metadata.upscaled;
                    if (filename && typeof checkIfImageIsPinned === 'function') {
                        const isPinned = checkIfImageIsPinned(filename);
                        menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                        menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                    }
                }
            });
        }

        // Metadata-dependent actions
        if (hasMetadata) {
            const items = [];

            // Always available if has metadata
            items.push(
                {
                    icon: 'fas fa-dice-three',
                    text: 'Reroll',
                    action: 'image-viewer-reroll'
                },
                {
                    icon: 'fas fa-compass-drafting',
                    text: 'Creator',
                    action: 'image-viewer-creator'
                },
                {
                    icon: 'mdi mdi-1-25 mdi-relative-scale',
                    text: 'Expand',
                    action: 'image-viewer-expand'
                }
            );

            // Upscale - check if already upscaled
            items.push({
                icon: 'nai-upscale',
                text: 'Upscale',
                action: 'image-viewer-upscale',
                disabled: !!this.metadata.upscaled
            });

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
                        icon: 'fas fa-folder-arrow-up',
                        text: 'Move to...',
                        action: 'image-viewer-move',
                        optionsfn: getMoveWorkspaceOptions,
                        handlerfn: handleMoveWorkspaceAction,
                        openOnHover: false
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

        // Handle context menu actions on document level
        this.boundContextMenuHandler = (e) => this.handleContextMenuAction(e);
        document.addEventListener('contextMenuAction', this.boundContextMenuHandler);
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
            case 'image-viewer-move':
                this.moveTo();
                break;
            case 'image-viewer-scrap':
                this.scrap();
                break;
            case 'image-viewer-incinerate':
                this.incinerate();
                break;
        }
    }

    hasValidMetadata() {
        return this.metadata && (this.metadata.filename || this.metadata.base || this.metadata.original);
    }

    zoomIn() {
        this.setZoom(this.zoomLevel + this.zoomStep);
    }

    zoomOut() {
        this.setZoom(this.zoomLevel - this.zoomStep);
    }

    setZoom(level) {
        const minZoom = this.minZoom || 0.1;
        this.zoomLevel = Math.max(minZoom, Math.min(this.maxZoom, level));
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
        this.setZoom(this.zoomLevel + delta);
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

    setupWindowBlurHandler() {
        this.boundBlurHandler = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.updateCursor();
            }
        };

        window.addEventListener('blur', this.boundBlurHandler);
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
            // If we have metadata with a filename, use that to find the image in the gallery
            if (this.metadata && (this.metadata.filename || this.metadata.original || this.metadata.upscaled)) {
                showLightbox(this.metadata);
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
        // Maximize the modal window
        if (!this.element) return;

        this.element.style.width = '90vw';
        this.element.style.height = '90vh';
        this.element.style.setProperty('--modal-offset-x', '0px');
        this.element.style.setProperty('--modal-offset-y', '0px');

        // Fit image to screen after maximizing
        setTimeout(() => this.fitToScreen(), 50);
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

    moveTo() {
        const filename = this.metadata.filename || this.metadata.original || this.metadata.upscaled;
        if (filename && typeof showGalleryMoveModal === 'function') {
            showGalleryMoveModal(filename);
        }
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
        if (this.boundDragMove) {
            document.removeEventListener('mousemove', this.boundDragMove);
        }
        if (this.boundDragEnd) {
            document.removeEventListener('mouseup', this.boundDragEnd);
        }
        if (this.boundTouchMove) {
            document.removeEventListener('touchmove', this.boundTouchMove);
        }
        if (this.boundTouchEnd) {
            document.removeEventListener('touchend', this.boundTouchEnd);
        }

        // Remove element listeners if possible (though standard destroy removes element)
        const imgElement = this.element ? this.element.querySelector(`#imageViewerImage_${this.id}`) : null;
        if (imgElement && this.boundTouchStart) {
            imgElement.removeEventListener('touchstart', this.boundTouchStart);
        }

        if (this.boundBlurHandler) {
            window.removeEventListener('blur', this.boundBlurHandler);
        }
        if (this.boundResizeHandler && this.element) {
            this.element.removeEventListener('modalResized', this.boundResizeHandler);
        }
        if (this.boundContextMenuHandler) {
            document.removeEventListener('contextMenuAction', this.boundContextMenuHandler);
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
window.openImageInViewer = function (imageSrc, title = 'Image Viewer', metadata = {}) {
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

// Helper for opening reference images
window.openReferenceImageInViewer = function (cacheImage) {
    if (!cacheImage) return null;

    // Use the same logic as the reference browser preview function
    let imageSrc;
    if (cacheImage.isStandalone) {
        // For standalone vibes, use the vibe's preview or fallback
        if (cacheImage.type === 'base64' && cacheImage.source) {
            imageSrc = `data:image/png;base64,${cacheImage.source}`;
        } else if (cacheImage.type === 'vibe' && cacheImage.source) {
            imageSrc = `data:image/png;base64,${cacheImage.source}`;
        } else if (cacheImage.hasPreview) {
            imageSrc = `/cache/preview/${cacheImage.hasPreview}`;
        }
    } else {
        // For cache images - prefer original upload, then preview, then fallback
        if (cacheImage.hash) {
            imageSrc = `/cache/upload/${cacheImage.hash}`;
        } else if (cacheImage.hasPreview) {
            imageSrc = `/cache/preview/${cacheImage.hash}.webp`;
        }
    }

    // Fallback if no source found
    if (!imageSrc) {
        imageSrc = '/static_images/background.jpg';
    }

    const title = cacheImage.filename || cacheImage.hash || 'Reference Image';
    return imageViewerManager.createViewer(imageSrc, title, cacheImage);
};

// Export for use in other modules
window.imageViewerManager = imageViewerManager;
