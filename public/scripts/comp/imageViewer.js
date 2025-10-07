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
        viewerElement.classList.remove('hidden');

        // Update IDs to be unique
        this.updateElementIds(viewerElement, viewerId);

        // Insert into DOM
        document.body.appendChild(viewerElement);

        // Create viewer instance
        const viewer = new ImageViewer(viewerId, viewerElement, imageSrc, title, metadata, this);
        this.viewers.set(viewerId, viewer);

        return viewer;
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
        this.minZoom = 0.1;
        this.maxZoom = 5.0;
        this.zoomStep = 0.25;
        this.isMinimized = false;

        this.init();
        this.loadImage();
        this.setupEventListeners();
    }

    init() {
        // Set title
        const titleElement = this.element.querySelector(`#imageViewerTitle_${this.id}`);
        if (titleElement) {
            titleElement.textContent = this.title;
        }

        // Open modal
        openModal(this.element);
    }

    loadImage() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        if (imgElement) {
            imgElement.src = this.imageSrc;
            imgElement.onload = () => {
                this.updateZoomDisplay();
                this.fitToScreen();
            };
        }
    }

    setupEventListeners() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);

        // Toolbar buttons
        this.setupToolbarButtons();

        // Image interaction
        if (imgElement) {
            imgElement.addEventListener('dblclick', () => this.openInLightbox());
            imgElement.addEventListener('wheel', (e) => this.handleZoom(e));
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
        const downloadBtn = this.element.querySelector(`#downloadBtn_${this.id}`);

        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
        if (fitToScreenBtn) fitToScreenBtn.addEventListener('click', () => this.fitToScreen());
        if (actualSizeBtn) actualSizeBtn.addEventListener('click', () => this.actualSize());
        if (openInLightboxBtn) openInLightboxBtn.addEventListener('click', () => this.openInLightbox());
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.download());
    }

    zoomIn() {
        this.setZoom(this.zoomLevel + this.zoomStep);
    }

    zoomOut() {
        this.setZoom(this.zoomLevel - this.zoomStep);
    }

    setZoom(level) {
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
        this.updateImageTransform();
        this.updateZoomDisplay();
    }

    fitToScreen() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        const container = this.element.querySelector('.image-container');

        if (imgElement && container) {
            const containerRect = container.getBoundingClientRect();
            const imgRect = imgElement.getBoundingClientRect();

            const scaleX = containerRect.width / imgRect.width;
            const scaleY = containerRect.height / imgRect.height;
            const scale = Math.min(scaleX, scaleY);

            this.setZoom(scale);
        }
    }

    actualSize() {
        this.setZoom(1.0);
    }

    updateImageTransform() {
        const imgElement = this.element.querySelector(`#imageViewerImage_${this.id}`);
        if (imgElement) {
            imgElement.style.transform = `scale(${this.zoomLevel})`;
        }
    }

    updateZoomDisplay() {
        const zoomElement = this.element.querySelector(`#zoomLevel_${this.id}`);
        if (zoomElement) {
            zoomElement.textContent = Math.round(this.zoomLevel * 100) + '%';
        }
    }

    handleZoom(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -this.zoomStep : this.zoomStep;
        this.setZoom(this.zoomLevel + delta);
    }

    openInLightbox() {
        // Use existing lightbox functionality
        if (typeof showLightbox === 'function') {
            showLightbox(this.imageSrc, this.metadata);
        }
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
        closeModal(this.element);
        // Remove from DOM after animation
        setTimeout(() => {
            this.manager.removeViewer(this.id);
        }, 300);
    }

    destroy() {
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
window.openImageInViewer = function(imageSrc, title = 'Image Viewer', metadata = {}) {
    return imageViewerManager.createViewer(imageSrc, title, metadata);
};

// Helper for opening gallery images
window.openGalleryImageInViewer = function(imageData) {
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
window.openReferenceImageInViewer = function(cacheImage) {
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
