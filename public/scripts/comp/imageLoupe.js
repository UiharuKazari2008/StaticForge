/**
 * Reusable inspection loupe for image preview hosts.
 * Phase-1 consumer: manual editor (.manual-preview-image-container).
 */

const IMAGE_LOUPE_SIZE_PRESETS = {
    small: 125,
    medium: 220,
    large: 320
};

const IMAGE_LOUPE_IDLE_VIEWPORT_PX = IMAGE_LOUPE_SIZE_PRESETS.small;
const IMAGE_LOUPE_RING_RATIO = 0.13;
const IMAGE_LOUPE_RING_MIN_PX = 10;
const IMAGE_LOUPE_ELEVATION_RATIO_AT = {
    [IMAGE_LOUPE_SIZE_PRESETS.small]: 0.35,
    [IMAGE_LOUPE_SIZE_PRESETS.medium]: 0.1,
    [IMAGE_LOUPE_SIZE_PRESETS.large]: 0.075
};

const IMAGE_LOUPE_ZOOM_MIN = 0.5;
const IMAGE_LOUPE_ZOOM_MAX = 4;
const IMAGE_LOUPE_ZOOM_STEP = 0.1;
const IMAGE_LOUPE_SIZE_MIN = 125;
const IMAGE_LOUPE_SIZE_MAX = 400;
const IMAGE_LOUPE_SIZE_STEP = 8;

const IMAGE_LOUPE_SNAP_ZOOM_PRESETS = [1, 2];
const IMAGE_LOUPE_VP_ZOOM_TOLERANCE = 0.04;
const IMAGE_LOUPE_SNAP_SIZE_PRESETS = [
    IMAGE_LOUPE_SIZE_PRESETS.small,
    IMAGE_LOUPE_SIZE_PRESETS.medium,
    IMAGE_LOUPE_SIZE_PRESETS.large
];
const IMAGE_LOUPE_SNAP_ZOOM_TOLERANCE = 0.12;
const IMAGE_LOUPE_SNAP_SIZE_TOLERANCE = 10;
const IMAGE_LOUPE_SNAP_SLOW_SCROLL_MAX = 48;
const IMAGE_LOUPE_SNAP_ESCAPE_ACCUM = 120;

const IMAGE_LOUPE_CORNER_ZONE_RATIO = 0.18;
const IMAGE_LOUPE_OVERFLOW_PX = 28;
const IMAGE_LOUPE_SCROLL_HUD_MS = 900;
const IMAGE_LOUPE_HOLD_SIZE_FACTOR = 1.02;
const IMAGE_LOUPE_HOLD_ZOOM_FACTOR = 0.96;

const IMAGE_LOUPE_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const IMAGE_LOUPE_CORNER_ANCHOR = {
    'top-left': { x: 0, y: 0, peekX: 8, peekY: 8 },
    'top-right': { x: 100, y: 0, peekX: 92, peekY: 8 },
    'bottom-right': { x: 100, y: 100, peekX: 92, peekY: 92 },
    'bottom-left': { x: 0, y: 100, peekX: 8, peekY: 92 }
};

function getObjectFitContainRect(imageEl, relativeToEl) {
    if (!imageEl || !relativeToEl) {
        return null;
    }

    const nw = imageEl.naturalWidth;
    const nh = imageEl.naturalHeight;
    if (!nw || !nh) {
        return null;
    }

    const rootRect = relativeToEl.getBoundingClientRect();
    const imgRect = imageEl.getBoundingClientRect();
    const visualScale = Math.min(imgRect.width / nw, imgRect.height / nh);
    const contentWidth = nw * visualScale;
    const contentHeight = nh * visualScale;
    const paddingX = (imgRect.width - contentWidth) / 2;
    const paddingY = (imgRect.height - contentHeight) / 2;

    return {
        contentLeft: imgRect.left - rootRect.left + paddingX,
        contentTop: imgRect.top - rootRect.top + paddingY,
        contentWidth,
        contentHeight,
        naturalWidth: nw,
        naturalHeight: nh
    };
}

function resolveBackgroundSizePx(style, boxW, boxH) {
    const raw = (style.backgroundSize || '').trim();
    if (!raw || raw === 'auto') {
        return null;
    }

    const parts = raw.split(/\s+/);
    const first = parts[0];
    if (first === 'cover' || first === 'contain') {
        return null;
    }

    let w = parseFloat(first);
    let h = parts.length > 1 ? parseFloat(parts[1]) : NaN;
    if (!Number.isFinite(w)) {
        return null;
    }
    if (!Number.isFinite(h)) {
        h = w;
    }
    return { w, h };
}

function resolveBackgroundPositionPx(posXRaw, posYRaw, boxW, boxH, bgW, bgH) {
    const posX = String(posXRaw || '0');
    const posY = String(posYRaw || '0');
    let x;
    let y;

    if (posX.includes('%')) {
        x = (boxW - bgW) * (parseFloat(posX) / 100);
    } else {
        x = parseFloat(posX) || 0;
    }

    if (posY.includes('%')) {
        y = (boxH - bgH) * (parseFloat(posY) / 100);
    } else {
        y = parseFloat(posY) || 0;
    }

    return { x, y };
}

function interpolateElevationRatio(viewportPx) {
    const small = IMAGE_LOUPE_SIZE_PRESETS.small;
    const medium = IMAGE_LOUPE_SIZE_PRESETS.medium;
    const large = IMAGE_LOUPE_SIZE_PRESETS.large;
    const rSmall = IMAGE_LOUPE_ELEVATION_RATIO_AT[small];
    const rMedium = IMAGE_LOUPE_ELEVATION_RATIO_AT[medium];
    const rLarge = IMAGE_LOUPE_ELEVATION_RATIO_AT[large];

    if (viewportPx <= small) {
        return rSmall;
    }
    if (viewportPx >= large) {
        return rLarge;
    }
    if (viewportPx <= medium) {
        const t = (viewportPx - small) / (medium - small);
        return rSmall + t * (rMedium - rSmall);
    }
    const t = (viewportPx - medium) / (large - medium);
    return rMedium + t * (rLarge - rMedium);
}

function loadImageLoupePrefs(storageKey) {
    const defaults = {
        zoom: 1,
        viewportPx: IMAGE_LOUPE_SIZE_PRESETS.medium,
        parkedCorner: 'bottom-left'
    };
    if (!storageKey) {
        return { ...defaults };
    }
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
            return { ...defaults };
        }
        const parsed = JSON.parse(raw);
        const zoom = typeof parsed.zoom === 'number'
            ? Math.max(IMAGE_LOUPE_ZOOM_MIN, Math.min(IMAGE_LOUPE_ZOOM_MAX, parsed.zoom))
            : (parsed.zoom === 2 ? 2 : 1);
        let viewportPx = typeof parsed.viewportPx === 'number' ? parsed.viewportPx : null;
        if (viewportPx == null && IMAGE_LOUPE_SIZE_PRESETS[parsed.sizePreset]) {
            viewportPx = IMAGE_LOUPE_SIZE_PRESETS[parsed.sizePreset];
        }
        if (viewportPx == null) {
            viewportPx = IMAGE_LOUPE_SIZE_PRESETS.medium;
        }
        viewportPx = Math.max(IMAGE_LOUPE_SIZE_MIN, Math.min(IMAGE_LOUPE_SIZE_MAX, viewportPx));
        const parkedCorner = IMAGE_LOUPE_CORNERS.includes(parsed.parkedCorner)
            ? parsed.parkedCorner
            : 'bottom-left';
        return { zoom, viewportPx, parkedCorner };
    } catch (e) {
        return { ...defaults };
    }
}

function saveImageLoupePrefs(storageKey, zoom, viewportPx, parkedCorner) {
    if (!storageKey) {
        return;
    }
    try {
        localStorage.setItem(storageKey, JSON.stringify({ zoom, viewportPx, parkedCorner }));
    } catch (e) {
        /* ignore quota */
    }
}

function formatLoupeZoomLabel(zoom, options = {}) {
    if (options.isViewportMatch) {
        return 'VP';
    }
    const z = Math.round(zoom * 100) / 100;
    return `×${z.toFixed(1)}`;
}

function formatLoupeSizeLabel(px) {
    return `${Math.round(px)}px`;
}

function applyScrollSnap(value, presets, tolerance, wheelDelta, escapeAccumRef) {
    const absDelta = Math.abs(wheelDelta);
    const atPreset = presets.find((p) => Math.abs(value - p) < tolerance * 0.35);

    if (atPreset != null) {
        escapeAccumRef.value += absDelta;
        if (escapeAccumRef.value < IMAGE_LOUPE_SNAP_ESCAPE_ACCUM) {
            return atPreset;
        }
        escapeAccumRef.value = 0;
        return value;
    }

    const nearPreset = presets.find((p) => Math.abs(value - p) < tolerance);
    if (nearPreset != null && absDelta < IMAGE_LOUPE_SNAP_SLOW_SCROLL_MAX) {
        escapeAccumRef.value = 0;
        return nearPreset;
    }

    escapeAccumRef.value = 0;
    return value;
}

class ImageLoupe {
    constructor(options) {
        this.hostEl = options.hostEl;
        this.hoverScopeEl = options.hoverScopeEl || options.hostEl;
        this.getImageEl = options.getImageEl;
        this.imageHitAreaEl = options.imageHitAreaEl || options.hostEl;
        this.storageKey = options.storageKey || null;
        this.enabledFn = options.enabled || (() => true);
        this.getBlurBackdropEl = options.getBlurBackdropEl || null;
        this.getSampleImageEl = options.getSampleImageEl || null;
        this.isCompareRevealMode = options.isCompareRevealMode || null;
        this.isCompareRevealReady = options.isCompareRevealReady || null;
        this.onRequestRevealMode = options.onRequestRevealMode || null;
        this.onLoupeInactive = options.onLoupeInactive || null;

        const prefs = loadImageLoupePrefs(this.storageKey);
        this.zoom = typeof options.zoom === 'number' ? options.zoom : prefs.zoom;
        this.activeViewportPx = typeof options.viewportPx === 'number' ? options.viewportPx : prefs.viewportPx;
        this.parkedCorner = IMAGE_LOUPE_CORNERS.includes(options.parkedCorner)
            ? options.parkedCorner
            : prefs.parkedCorner;

        this.zoom = Math.max(IMAGE_LOUPE_ZOOM_MIN, Math.min(IMAGE_LOUPE_ZOOM_MAX, this.zoom));
        this.activeViewportPx = Math.max(
            IMAGE_LOUPE_SIZE_MIN,
            Math.min(IMAGE_LOUPE_SIZE_MAX, this.activeViewportPx)
        );

        this.state = 'idle';
        this.isDragging = false;
        this.isHeld = false;
        this.isElevated = false;
        this.cornerZone = null;
        this.isParkReady = false;
        this._rafPending = false;
        this._centerX = 0;
        this._centerY = 0;
        this._destroyed = false;
        this._scrollHudTimer = null;
        this._snapEscapeAccum = { value: 0 };

        this._observedBlurBackdrop = null;
        this._observedPreviewImg = null;
        this._observedPreviewInner = null;
        this._idleBackdropRaf = false;
        this._idleBackdropRafComplete = null;
        this._vpMatchActive = false;
        this._vpHoverSyncRaf = null;
        this._revealPresentationActive = false;

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerEnter = this._onPointerEnter.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
        this._onImageLoad = this._onImageLoad.bind(this);
        this._onContextMenuAction = this._onContextMenuAction.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onHostResize = this._onHostResize.bind(this);
        this._onHoverScopeLayoutChange = this._onHoverScopeLayoutChange.bind(this);

        this._buildDom();
        this._wireHost();
        this._attachContextMenu();
        this.park();
        this.refresh();
    }

    _buildDom() {
        this.hostEl.classList.add('image-loupe-host');
        if (this.hoverScopeEl && this.hoverScopeEl !== this.hostEl) {
            this.hoverScopeEl.classList.add('image-loupe-hover-scope');
        } else {
            this.hostEl.classList.add('image-loupe-hover-scope');
        }

        this.el = document.createElement('div');
        this.el.className = 'image-loupe';
        this.el.setAttribute('role', 'img');
        this.el.setAttribute('aria-label', 'Inspection loupe');
        this.el.dataset.state = 'idle';
        this.el.innerHTML = `
            <div class="image-loupe-body">
                <div class="image-loupe-elevation" aria-hidden="true"></div>
                <div class="image-loupe-ring" aria-hidden="true">
                    <div class="image-loupe-ring-surface"></div>
                </div>
                <div class="image-loupe-viewport" aria-hidden="true">
                    <div class="image-loupe-viewport-backdrop" aria-hidden="true"></div>
                    <div class="image-loupe-viewport-shade" aria-hidden="true"></div>
                    <div class="image-loupe-viewport-sample" aria-hidden="true"></div>
                    <div class="image-loupe-scroll-hud hidden" aria-live="polite" aria-hidden="true"></div>
                </div>
            </div>
        `;

        this.viewportEl = this.el.querySelector('.image-loupe-viewport');
        this.backdropEl = this.el.querySelector('.image-loupe-viewport-backdrop');
        this.sampleEl = this.el.querySelector('.image-loupe-viewport-sample');
        this.scrollHudEl = this.el.querySelector('.image-loupe-scroll-hud');

        this.hostEl.appendChild(this.el);

        this.el.addEventListener('pointerdown', this._onPointerDown);
        this.el.addEventListener('pointerenter', this._onPointerEnter);
        this.el.addEventListener('pointerleave', this._onPointerLeave);
    }

    _wireHost() {
        this._resizeObserver = new ResizeObserver(this._onHostResize);
        this._resizeObserver.observe(this.hostEl);
        if (this.hoverScopeEl && this.hoverScopeEl !== this.hostEl) {
            this._resizeObserver.observe(this.hoverScopeEl);
        }
        this._tryObserveBlurBackdrop();

        if (this.hoverScopeEl) {
            this.hoverScopeEl.addEventListener('mouseenter', this._onHoverScopeLayoutChange);
            this.hoverScopeEl.addEventListener('mouseleave', this._onHoverScopeLayoutChange);
        }

        document.addEventListener('pointermove', this._onPointerMove);
        document.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('pointercancel', this._onPointerUp);
        this.hostEl.addEventListener('wheel', this._onWheel, { passive: false });
    }

    _tryObserveBlurBackdrop() {
        const blurSource = this._resolveBlurBackdropEl();
        if (!blurSource || blurSource === this._observedBlurBackdrop) {
            return;
        }
        if (this._observedBlurBackdrop) {
            this._resizeObserver.unobserve(this._observedBlurBackdrop);
        }
        this._observedBlurBackdrop = blurSource;
        this._resizeObserver.observe(blurSource);
    }

    _unobservePreviewLayoutTargets() {
        if (this._observedPreviewImg) {
            this._resizeObserver.unobserve(this._observedPreviewImg);
            this._observedPreviewImg = null;
        }
        if (this._observedPreviewInner) {
            this._resizeObserver.unobserve(this._observedPreviewInner);
            this._observedPreviewInner = null;
        }
    }

    _observePreviewLayoutTargets() {
        const previewImg = this.getImageEl ? this.getImageEl() : null;
        if (previewImg && previewImg !== this._observedPreviewImg) {
            if (this._observedPreviewImg) {
                this._resizeObserver.unobserve(this._observedPreviewImg);
            }
            this._observedPreviewImg = previewImg;
            this._resizeObserver.observe(previewImg);
        }

        const inner = document.getElementById('manualPreviewImageContainerInner');
        if (inner && inner !== this._observedPreviewInner) {
            if (this._observedPreviewInner) {
                this._resizeObserver.unobserve(this._observedPreviewInner);
            }
            this._observedPreviewInner = inner;
            this._resizeObserver.observe(inner);
        }
    }

    _setVpMatchActive(active) {
        const next = Boolean(active);
        if (this._vpMatchActive === next) {
            this._updateVpLayoutTracking();
            return;
        }
        this._vpMatchActive = next;
        this._updateVpLayoutTracking();
    }

    _updateVpLayoutTracking() {
        if (this._vpMatchActive) {
            this._observePreviewLayoutTargets();
        } else {
            this._unobservePreviewLayoutTargets();
            if (this._vpHoverSyncRaf) {
                cancelAnimationFrame(this._vpHoverSyncRaf);
                this._vpHoverSyncRaf = null;
            }
        }
    }

    _scheduleVpHoverSync() {
        if (!this._vpMatchActive) {
            return;
        }
        this._syncVpMatchZoom();
        this._updateViewport();
        this._scheduleRefresh();
        if (this._vpHoverSyncRaf) {
            return;
        }
        const started = performance.now();
        const tick = (now) => {
            if (this._destroyed || !this._vpMatchActive) {
                this._vpHoverSyncRaf = null;
                return;
            }
            this._syncVpMatchZoom();
            this._updateViewport();
            if (now - started < 800) {
                this._vpHoverSyncRaf = requestAnimationFrame(tick);
            } else {
                this._vpHoverSyncRaf = null;
            }
        };
        this._vpHoverSyncRaf = requestAnimationFrame(tick);
    }

    _onHoverScopeLayoutChange() {
        if (!this._vpMatchActive) {
            return;
        }
        this._scheduleVpHoverSync();
    }

    _syncVpMatchZoom() {
        if (!this._vpMatchActive) {
            return;
        }
        const vpZoom = this._getViewportMatchZoom();
        if (vpZoom == null) {
            return;
        }
        this.zoom = vpZoom;
    }

    _onHostResize(entries) {
        if (entries && entries.length) {
            const fromPreviewLayout = entries.some(
                (entry) => entry.target === this._observedPreviewImg || entry.target === this._observedPreviewInner
            );
            if (fromPreviewLayout && !this._vpMatchActive) {
                return;
            }
            if (fromPreviewLayout && this._vpMatchActive) {
                this._syncVpMatchZoom();
            }
        }

        const snapIdle = this.state === 'idle';
        if (snapIdle) {
            this.el.classList.add('is-resize-snapping');
        }
        if (this.state === 'idle') {
            this._applyIdleAnchorPosition();
        } else {
            this._clampCurrentPosition();
        }
        this._scheduleRefresh();
        if (snapIdle) {
            this._scheduleIdleBackdropSync(() => {
                this.el.classList.remove('is-resize-snapping');
            });
        }
    }

    _scheduleIdleBackdropSync(onComplete) {
        if (this._idleBackdropRaf) {
            this._idleBackdropRafComplete = onComplete || null;
            return;
        }
        this._idleBackdropRaf = true;
        this._idleBackdropRafComplete = onComplete || null;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._idleBackdropRaf = false;
                if (!this._destroyed && this.state === 'idle') {
                    this._updateBlurBackdrop();
                }
                const done = this._idleBackdropRafComplete;
                this._idleBackdropRafComplete = null;
                if (done) {
                    done();
                }
            });
        });
    }

    _getElevationRatio(viewportPx) {
        return interpolateElevationRatio(viewportPx);
    }

    _applyViewportDimensions(viewportPx) {
        const px = Math.round(viewportPx);
        const elevRatio = this._getElevationRatio(px);
        this.el.style.setProperty('--image-loupe-viewport-size', `${px}px`);
        this.el.style.setProperty('--image-loupe-elevation-ratio', String(elevRatio));
    }

    getIdleViewportPx() {
        return IMAGE_LOUPE_IDLE_VIEWPORT_PX;
    }

    getViewportSizePx() {
        if (this.state === 'idle') {
            return this.getIdleViewportPx();
        }
        return this.activeViewportPx;
    }

    _getImage() {
        try {
            if (this.isCompareRevealMode && this.isCompareRevealMode()) {
                if (this.getSampleImageEl) {
                    const sample = this.getSampleImageEl();
                    if (sample) {
                        return sample;
                    }
                }
            }
            return this.getImageEl ? this.getImageEl() : null;
        } catch (e) {
            return null;
        }
    }

    _getViewportMatchZoom() {
        const previewImg = this.getImageEl ? this.getImageEl() : null;
        if (!previewImg || !previewImg.naturalWidth) {
            return null;
        }
        const rect = getObjectFitContainRect(previewImg, this.hostEl);
        if (!rect || !rect.naturalWidth) {
            return null;
        }
        return rect.contentWidth / rect.naturalWidth;
    }

    _isRevealModeActive() {
        return Boolean(this.isCompareRevealMode && this.isCompareRevealMode());
    }

    _isCompareRevealReady() {
        return Boolean(this.isCompareRevealReady && this.isCompareRevealReady());
    }

    _isAtViewportZoom(vpZoom) {
        if (vpZoom == null) {
            return false;
        }
        return this.zoom <= vpZoom + IMAGE_LOUPE_VP_ZOOM_TOLERANCE;
    }

    _resolveSampleZoom() {
        const vpZoom = this._getViewportMatchZoom();
        let z = this.zoom;
        if (vpZoom == null) {
            return z;
        }
        if (this._vpMatchActive) {
            return vpZoom;
        }
        return z;
    }

    _getZoomSnapPresets() {
        const presets = [...IMAGE_LOUPE_SNAP_ZOOM_PRESETS];
        if (this._isCompareRevealReady()) {
            const vp = this._getViewportMatchZoom();
            if (vp != null && vp < 1 - IMAGE_LOUPE_VP_ZOOM_TOLERANCE) {
                presets.unshift(vp);
            }
        }
        return presets;
    }

    _getZoomMin() {
        if (this._isCompareRevealReady()) {
            const vp = this._getViewportMatchZoom();
            if (vp != null) {
                return Math.min(IMAGE_LOUPE_ZOOM_MIN, vp);
            }
        }
        return IMAGE_LOUPE_ZOOM_MIN;
    }

    _getLoupePresentation() {
        const baseVp = this.getViewportSizePx();
        const baseZoom = this._resolveSampleZoom();
        const preserveVpMatch = this._vpMatchActive && this._isRevealModeActive();
        if (this.isHeld && this.state === 'active' && !preserveVpMatch) {
            return {
                viewportPx: Math.round(baseVp * IMAGE_LOUPE_HOLD_SIZE_FACTOR),
                zoom: baseZoom * IMAGE_LOUPE_HOLD_ZOOM_FACTOR
            };
        }
        return { viewportPx: baseVp, zoom: baseZoom };
    }

    _getRenderedViewportPx() {
        if (!this.viewportEl) {
            return this._getLoupePresentation().viewportPx;
        }
        const w = this.viewportEl.offsetWidth;
        return w > 0 ? w : this._getLoupePresentation().viewportPx;
    }

    _getChromeThicknessPx(viewportPx) {
        const viewport = viewportPx != null ? viewportPx : this._getLoupePresentation().viewportPx;
        const elevRatio = this._getElevationRatio(viewport);
        return {
            ring: Math.max(IMAGE_LOUPE_RING_MIN_PX, Math.round(viewport * IMAGE_LOUPE_RING_RATIO)),
            elevation: Math.max(4, Math.round(viewport * elevRatio))
        };
    }

    getTotalSizePx(viewportPx) {
        const vp = viewportPx != null ? viewportPx : this._getLoupePresentation().viewportPx;
        if (this.el && this.el.isConnected && viewportPx == null) {
            const w = this.el.offsetWidth;
            if (w > 0) {
                return w;
            }
        }
        const { ring, elevation } = this._getChromeThicknessPx(vp);
        return vp + (ring + elevation) * 2;
    }

    _applyIdleAnchorPosition(options = {}) {
        const anchor = IMAGE_LOUPE_CORNER_ANCHOR[this.parkedCorner] || IMAGE_LOUPE_CORNER_ANCHOR['bottom-left'];
        this.el.dataset.corner = this.parkedCorner;
        this.el.style.setProperty('--image-loupe-idle-anchor-x', `${anchor.x}%`);
        this.el.style.setProperty('--image-loupe-idle-anchor-y', `${anchor.y}%`);
        this.el.style.setProperty('--image-loupe-idle-peek-x', `${anchor.peekX}%`);
        this.el.style.setProperty('--image-loupe-idle-peek-y', `${anchor.peekY}%`);

        const hostW = this.hostEl.clientWidth;
        const hostH = this.hostEl.clientHeight;
        this._centerX = (anchor.x / 100) * hostW;
        this._centerY = (anchor.y / 100) * hostH;

        if (this.state !== 'idle') {
            return;
        }

        const hadPxAnchor = /px/i.test(this.el.style.left || '');
        if (options.animateFromPx && hadPxAnchor) {
            requestAnimationFrame(() => {
                if (this._destroyed || this.state !== 'idle') {
                    return;
                }
                this.el.style.removeProperty('left');
                this.el.style.removeProperty('top');
            });
            return;
        }

        this.el.style.removeProperty('left');
        this.el.style.removeProperty('top');
    }

    _clearIdleAnchorPosition() {
        delete this.el.dataset.corner;
        this.el.style.removeProperty('--image-loupe-idle-anchor-x');
        this.el.style.removeProperty('--image-loupe-idle-anchor-y');
        this.el.style.removeProperty('--image-loupe-idle-peek-x');
        this.el.style.removeProperty('--image-loupe-idle-peek-y');
    }

    _attachContextMenu() {
        // contextMenu: public/scripts/comp/contextMenu.js
        if (!contextMenu) {
            return;
        }

        const self = this;
        this._contextMenuConfig = {
            sections: [
                {
                    type: 'icons',
                    title: 'Zoom',
                    icons: [
                        {
                            icon: 'fas fa-search',
                            tooltip: '1× (1:1 pixels)',
                            action: 'imageLoupeZoom1',
                            keepMenuOpen: true,
                            showIndicator: true,
                            loadfn: (icon) => {
                                icon.checked = Math.abs(self.zoom - 1) < 0.06;
                            }
                        },
                        {
                            icon: 'fas fa-search-plus',
                            tooltip: '2×',
                            action: 'imageLoupeZoom2',
                            keepMenuOpen: true,
                            showIndicator: true,
                            loadfn: (icon) => {
                                icon.checked = Math.abs(self.zoom - 2) < 0.06;
                            }
                        },
                        {
                            icon: 'fas fa-display',
                            tooltip: 'VP — match preview',
                            action: 'imageLoupeZoomVp',
                            keepMenuOpen: true,
                            showIndicator: true,
                            hidden: () => !self._isCompareRevealReady(),
                            loadfn: (icon) => {
                                icon.checked = self._vpMatchActive;
                            }
                        }
                    ]
                },
                {
                    type: 'icons',
                    title: 'Loupe size',
                    icons: [
                        {
                            icon: 'fas fa-compress',
                            tooltip: 'Small (125px)',
                            action: 'imageLoupeSizeSmall',
                            keepMenuOpen: true,
                            showIndicator: true,
                            loadfn: (icon) => {
                                icon.checked = Math.abs(self.activeViewportPx - IMAGE_LOUPE_SIZE_PRESETS.small) < 4;
                            }
                        },
                        {
                            icon: 'fas fa-circle',
                            tooltip: 'Medium (220px)',
                            action: 'imageLoupeSizeMedium',
                            keepMenuOpen: true,
                            showIndicator: true,
                            loadfn: (icon) => {
                                icon.checked = Math.abs(self.activeViewportPx - IMAGE_LOUPE_SIZE_PRESETS.medium) < 4;
                            }
                        },
                        {
                            icon: 'fas fa-expand',
                            tooltip: 'Large (320px)',
                            action: 'imageLoupeSizeLarge',
                            keepMenuOpen: true,
                            showIndicator: true,
                            loadfn: (icon) => {
                                icon.checked = Math.abs(self.activeViewportPx - IMAGE_LOUPE_SIZE_PRESETS.large) < 4;
                            }
                        }
                    ]
                },
                {
                    type: 'icons',
                    icons: [
                        {
                            icon: 'fas fa-times',
                            tooltip: 'Close loupe',
                            action: 'imageLoupeClose',
                            className: 'text-danger'
                        }
                    ]
                }
            ],
            onAction: this._onContextMenuAction,
            closeTreeOnOuterClick: true
        };

        contextMenu.attachToElement(this.el, this._contextMenuConfig);
    }

    _refreshContextMenuIndicators() {
        if (!contextMenu || !this._contextMenuConfig || !this.el) {
            return;
        }
        const target = this.el;
        const menuRoot = contextMenu.menu;

        this._contextMenuConfig.sections.forEach((section) => {
            if (section.type === 'icons' && section.icons) {
                section.icons.forEach((icon) => {
                    if (icon.loadfn) {
                        icon.loadfn(icon, target);
                    }
                    if (menuRoot && icon.action) {
                        const btn = menuRoot.querySelector(`[data-action="${icon.action}"]`);
                        if (btn) {
                            contextMenu.refreshIconDisplay(btn, icon, target);
                        }
                    }
                });
                return;
            }
            if (section.type !== 'list' || !section.items) {
                return;
            }
            section.items.forEach((item) => {
                if (item.loadfn) {
                    item.loadfn(item, target);
                }
                if (item._element) {
                    contextMenu.refreshListItemDisplay(item._element, item, target);
                }
            });
        });
        contextMenu.updateIndicatorDots(this._contextMenuConfig);
    }

    _onContextMenuAction(action) {
        if (this._destroyed) {
            return;
        }
        this._snapEscapeAccum.value = 0;
        switch (action) {
            case 'imageLoupeZoom1':
                this.setZoom(1, { skipSnap: true });
                break;
            case 'imageLoupeZoom2':
                this.setZoom(2, { skipSnap: true });
                break;
            case 'imageLoupeZoomVp':
                this.setViewportMatchZoom({ skipSnap: true });
                break;
            case 'imageLoupeSizeSmall':
                this.setViewportPx(IMAGE_LOUPE_SIZE_PRESETS.small, { skipSnap: true });
                break;
            case 'imageLoupeSizeMedium':
                this.setViewportPx(IMAGE_LOUPE_SIZE_PRESETS.medium, { skipSnap: true });
                break;
            case 'imageLoupeSizeLarge':
                this.setViewportPx(IMAGE_LOUPE_SIZE_PRESETS.large, { skipSnap: true });
                break;
            case 'imageLoupeClose':
                this.park();
                break;
            default:
                break;
        }
        this._refreshContextMenuIndicators();
    }

    _persistPrefs() {
        let zoomToSave = this.zoom;
        const vpZoom = this._getViewportMatchZoom();
        if (vpZoom != null && zoomToSave <= vpZoom + IMAGE_LOUPE_VP_ZOOM_TOLERANCE) {
            zoomToSave = 1;
        }
        saveImageLoupePrefs(this.storageKey, zoomToSave, this.activeViewportPx, this.parkedCorner);
    }

    _resetZoomFromVpMode() {
        this._setVpMatchActive(false);
        this.zoom = 1;
    }

    _applyRevealModeExit() {
        if (this._destroyed) {
            return;
        }

        this._revealPresentationActive = false;
        this.isDragging = false;
        this.el.classList.remove('is-dragging');
        this._setHeld(false);
        this._resetZoomFromVpMode();

        if (this.state === 'active') {
            this._applyViewportDimensions(this.activeViewportPx);
            this._clampCurrentPosition();
        } else if (this.state === 'idle') {
            this._applyViewportDimensions(this.getIdleViewportPx());
            this._applyIdleAnchorPosition();
        }

        this._persistPrefs();
        this._updateViewport();
        this._refreshContextMenuIndicators();
    }

    exitRevealPresentation() {
        this._applyRevealModeExit();
    }

    setZoom(zoom, options = {}) {
        const vpZoom = this._getViewportMatchZoom();
        const zoomMin = this._getZoomMin();
        let next = Math.max(zoomMin, Math.min(IMAGE_LOUPE_ZOOM_MAX, zoom));

        if (!options.skipSnap && options.wheelDelta != null) {
            next = applyScrollSnap(
                next,
                this._getZoomSnapPresets(),
                IMAGE_LOUPE_SNAP_ZOOM_TOLERANCE,
                options.wheelDelta,
                this._snapEscapeAccum
            );
        }

        if (
            !options.skipRevealHandoff &&
            this._isCompareRevealReady() &&
            !this._isRevealModeActive() &&
            vpZoom != null &&
            next <= vpZoom + IMAGE_LOUPE_SNAP_ZOOM_TOLERANCE
        ) {
            if (this.onRequestRevealMode) {
                this.onRequestRevealMode();
            }
            next = vpZoom;
        }

        if (this._isRevealModeActive() && vpZoom != null && next <= vpZoom + IMAGE_LOUPE_VP_ZOOM_TOLERANCE) {
            next = vpZoom;
        }

        this.zoom = next;
        if (vpZoom != null && next <= vpZoom + IMAGE_LOUPE_VP_ZOOM_TOLERANCE) {
            this._setVpMatchActive(true);
        } else if (vpZoom != null && next > vpZoom + IMAGE_LOUPE_VP_ZOOM_TOLERANCE * 2) {
            this._setVpMatchActive(false);
        }
        this._persistPrefs();
        if (this.state === 'active') {
            this._clampCurrentPosition();
        }
        this._updateViewport();
    }

    setViewportMatchZoom(options = {}) {
        const vpZoom = this._getViewportMatchZoom();
        if (vpZoom == null) {
            return;
        }
        this._setVpMatchActive(true);
        this.setZoom(vpZoom, { skipSnap: true, skipRevealHandoff: true, ...options });
    }

    setViewportPx(px, options = {}) {
        let next = Math.max(IMAGE_LOUPE_SIZE_MIN, Math.min(IMAGE_LOUPE_SIZE_MAX, px));
        if (!options.skipSnap && options.wheelDelta != null) {
            next = applyScrollSnap(
                next,
                IMAGE_LOUPE_SNAP_SIZE_PRESETS,
                IMAGE_LOUPE_SNAP_SIZE_TOLERANCE,
                options.wheelDelta,
                this._snapEscapeAccum
            );
        }
        this.activeViewportPx = next;
        this._persistPrefs();
        if (this.state === 'idle') {
            this.park();
        } else {
            this._applyViewportDimensions(this.activeViewportPx);
            this._clampCurrentPosition();
            this._updateViewport();
        }
    }

    _isEnabled() {
        if (this._destroyed) {
            return false;
        }
        try {
            return Boolean(this.enabledFn());
        } catch (e) {
            return false;
        }
    }

    _getSampleGeometry() {
        const previewImg = this.getImageEl ? this.getImageEl() : null;
        const sampleImg = this._getImage();
        if (!sampleImg) {
            return null;
        }
        if (this._isRevealModeActive() && previewImg && previewImg.naturalWidth) {
            const rect = getObjectFitContainRect(previewImg, this.hostEl);
            if (rect) {
                return { img: sampleImg, rect };
            }
        }
        const rect = getObjectFitContainRect(sampleImg, this.hostEl);
        if (!rect) {
            return null;
        }
        return { img: sampleImg, rect };
    }

    _getPositionLimits() {
        const geometry = this._getSampleGeometry();
        if (!geometry) {
            return null;
        }
        const { rect } = geometry;

        const { viewportPx: vp, zoom: z } = this._getLoupePresentation();
        const halfW = (vp / z / 2) * (rect.contentWidth / rect.naturalWidth);
        const halfH = (vp / z / 2) * (rect.contentHeight / rect.naturalHeight);
        const overflow = IMAGE_LOUPE_OVERFLOW_PX;

        return {
            minX: rect.contentLeft + halfW - overflow,
            maxX: rect.contentLeft + rect.contentWidth - halfW + overflow,
            minY: rect.contentTop + halfH - overflow,
            maxY: rect.contentTop + rect.contentHeight - halfH + overflow
        };
    }

    _setPositionCenter(cx, cy, options = {}) {
        const total = this.getTotalSizePx();
        const hostW = this.hostEl.clientWidth;
        const hostH = this.hostEl.clientHeight;
        const half = total / 2;
        const useImageLimits = options.useImageLimits !== false && this.state === 'active';

        let minCx = half - IMAGE_LOUPE_OVERFLOW_PX;
        let maxCx = hostW - half + IMAGE_LOUPE_OVERFLOW_PX;
        let minCy = half - IMAGE_LOUPE_OVERFLOW_PX;
        let maxCy = hostH - half + IMAGE_LOUPE_OVERFLOW_PX;

        if (useImageLimits) {
            const limits = this._getPositionLimits();
            if (limits) {
                minCx = limits.minX;
                maxCx = limits.maxX;
                minCy = limits.minY;
                maxCy = limits.maxY;
            }
        }

        if (minCx > maxCx) {
            const mid = (minCx + maxCx) / 2;
            minCx = maxCx = mid;
        }
        if (minCy > maxCy) {
            const mid = (minCy + maxCy) / 2;
            minCy = maxCy = mid;
        }

        this._centerX = Math.max(minCx, Math.min(cx, maxCx));
        this._centerY = Math.max(minCy, Math.min(cy, maxCy));

        /* left/top = center point; .image-loupe uses translate(-50%, -50%) */
        this.el.style.left = `${this._centerX}px`;
        this.el.style.top = `${this._centerY}px`;
    }

    _setParkReady(ready) {
        this.isParkReady = ready;
        this.el.classList.toggle('is-park-ready', ready);
        this.hostEl.classList.toggle('is-park-ready-zone', ready && Boolean(this.cornerZone));
    }

    park(corner) {
        if (corner && IMAGE_LOUPE_CORNERS.includes(corner)) {
            this.parkedCorner = corner;
        }

        this._resetZoomFromVpMode();
        if (this.onLoupeInactive) {
            this.onLoupeInactive();
        }

        this.state = 'idle';
        this.el.dataset.state = 'idle';
        this.hostEl.classList.remove('is-active');
        this._setParkReady(false);
        this._setElevated(false);
        this._setHeld(false);
        this.isDragging = false;
        this.el.classList.remove('is-dragging');
        this._snapEscapeAccum.value = 0;
        this.hostEl.removeAttribute('data-corner-zone');

        this._applyViewportDimensions(this.getIdleViewportPx());
        this._applyIdleAnchorPosition({ animateFromPx: true });
        this._persistPrefs();
        this._updateViewport();
    }

    _activateForDrag(localX, localY) {
        this._clearIdleAnchorPosition();
        this.state = 'active';
        this.el.dataset.state = 'active';
        this.hostEl.classList.add('is-active');
        this._applyViewportDimensions(this.activeViewportPx);
        this._setPositionCenter(localX, localY, { useImageLimits: true });
        this._updateViewport();
    }

    setActive() {
        this._clearIdleAnchorPosition();
        this.state = 'active';
        this.el.dataset.state = 'active';
        this.hostEl.classList.add('is-active');
        this._applyViewportDimensions(this.activeViewportPx);
        this._clampCurrentPosition();
        this._updateViewport();
    }

    _clampCurrentPosition() {
        this._setPositionCenter(this._centerX, this._centerY);
    }

    _setElevated(elevated) {
        this.isElevated = elevated;
        this.el.classList.toggle('is-elevated', elevated);
    }

    _setHeld(held) {
        this.isHeld = held;
        this.el.classList.toggle('is-held', held);
        if (this.state === 'active') {
            this._applyViewportDimensions(this._getLoupePresentation().viewportPx);
            this._clampCurrentPosition();
            this._updateViewport();
        }
    }

    _pointInImageContent(clientX, clientY) {
        const img = this._getImage();
        if (!img) {
            return false;
        }
        const rect = getObjectFitContainRect(img, this.hostEl);
        if (!rect) {
            return false;
        }
        const hostRect = this.hostEl.getBoundingClientRect();
        const x = clientX - hostRect.left;
        const y = clientY - hostRect.top;
        return (
            x >= rect.contentLeft &&
            x <= rect.contentLeft + rect.contentWidth &&
            y >= rect.contentTop &&
            y <= rect.contentTop + rect.contentHeight
        );
    }

    _getCornerZone(clientX, clientY) {
        const hostRect = this.hostEl.getBoundingClientRect();
        const x = clientX - hostRect.left;
        const y = clientY - hostRect.top;
        const w = hostRect.width;
        const h = hostRect.height;
        const insetX = w * IMAGE_LOUPE_CORNER_ZONE_RATIO;
        const insetY = h * IMAGE_LOUPE_CORNER_ZONE_RATIO;

        const inLeft = x <= insetX;
        const inRight = x >= w - insetX;
        const inTop = y <= insetY;
        const inBottom = y >= h - insetY;

        if (inTop && inLeft) return 'top-left';
        if (inTop && inRight) return 'top-right';
        if (inBottom && inLeft) return 'bottom-left';
        if (inBottom && inRight) return 'bottom-right';
        return null;
    }

    _updateCornerParkFeedback(clientX, clientY) {
        if (!this.isDragging || this.state !== 'active') {
            this.cornerZone = null;
            this.hostEl.removeAttribute('data-corner-zone');
            this._setParkReady(false);
            return;
        }

        const zone = this._getCornerZone(clientX, clientY);
        if (zone) {
            this.cornerZone = zone;
            this.hostEl.setAttribute('data-corner-zone', zone);
            this._setParkReady(true);
        } else {
            this.cornerZone = null;
            this.hostEl.removeAttribute('data-corner-zone');
            this._setParkReady(false);
        }
    }

    _onPointerDown(e) {
        if (!this._isEnabled() || e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        this.isDragging = true;
        this._dragPointerId = e.pointerId;
        this.el.classList.add('is-dragging');
        this.el.setPointerCapture(e.pointerId);
        this._setElevated(true);

        const hostRect = this.hostEl.getBoundingClientRect();
        const localX = e.clientX - hostRect.left;
        const localY = e.clientY - hostRect.top;

        if (this.state === 'idle') {
            this._activateForDrag(localX, localY);
        } else {
            this._setPositionCenter(localX, localY, { useImageLimits: true });
            this._updateViewport();
        }

        this._setHeld(true);

        this._setParkReady(false);
        this.cornerZone = null;
        this.hostEl.removeAttribute('data-corner-zone');
    }

    _onPointerMove(e) {
        if (!this.isDragging || e.pointerId !== this._dragPointerId) {
            return;
        }

        const hostRect = this.hostEl.getBoundingClientRect();
        this._setPositionCenter(
            e.clientX - hostRect.left,
            e.clientY - hostRect.top,
            { useImageLimits: true }
        );
        this._updateCornerParkFeedback(e.clientX, e.clientY);
        this._scheduleRefresh();
    }

    _onPointerUp(e) {
        if (!this.isDragging || e.pointerId !== this._dragPointerId) {
            return;
        }

        this.isDragging = false;
        this._dragPointerId = null;
        this.el.classList.remove('is-dragging');
        this._setHeld(false);
        if (this.el.hasPointerCapture(e.pointerId)) {
            this.el.releasePointerCapture(e.pointerId);
        }

        const corner = this._getCornerZone(e.clientX, e.clientY);
        const wasParkReady = this.isParkReady && corner;

        this._setParkReady(false);
        this.cornerZone = null;
        this.hostEl.removeAttribute('data-corner-zone');

        if (this.state === 'active' && wasParkReady && corner) {
            this.park(corner);
            if (!this.el.matches(':hover')) {
                this._setElevated(false);
            }
            return;
        }

        if (this.state === 'idle' && corner) {
            this.park(corner);
        }

        if (!this.el.matches(':hover')) {
            this._setElevated(false);
        }
    }

    _onPointerEnter() {
        if (this.state === 'active') {
            this._setElevated(true);
        }
    }

    _onPointerLeave() {
        if (!this.isDragging) {
            this._setElevated(false);
        }
    }

    _onImageLoad() {
        this._scheduleRefresh();
    }

    _loupeInteractionActive() {
        if (this.state === 'active') {
            return true;
        }
        if (this.el.matches(':hover')) {
            return true;
        }
        if (this.hoverScopeEl && this.hoverScopeEl.matches(':hover')) {
            return true;
        }
        return false;
    }

    _onWheel(e) {
        if (!this._isEnabled() || this.state !== 'active') {
            return;
        }

        if (!this.el.contains(e.target)) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -1 : 1;
        if (e.shiftKey) {
            this.setViewportPx(
                this.activeViewportPx + delta * IMAGE_LOUPE_SIZE_STEP,
                { wheelDelta: e.deltaY }
            );
            this._showScrollHud(formatLoupeSizeLabel(this.activeViewportPx));
        } else {
            this.setZoom(this.zoom + delta * IMAGE_LOUPE_ZOOM_STEP, { wheelDelta: e.deltaY });
            this._showScrollHud(formatLoupeZoomLabel(this.zoom, { isViewportMatch: this._vpMatchActive }));
        }

        this._refreshContextMenuIndicators();
    }

    _showScrollHud(text) {
        if (!this.scrollHudEl) {
            return;
        }
        this.scrollHudEl.textContent = text;
        this.scrollHudEl.classList.remove('hidden');
        this.scrollHudEl.classList.add('is-visible');
        this.scrollHudEl.setAttribute('aria-hidden', 'false');

        if (this._scrollHudTimer) {
            clearTimeout(this._scrollHudTimer);
        }
        this._scrollHudTimer = setTimeout(() => {
            if (this._destroyed || !this.scrollHudEl) {
                return;
            }
            this.scrollHudEl.classList.remove('is-visible');
            this.scrollHudEl.setAttribute('aria-hidden', 'true');
            this._scrollHudTimer = setTimeout(() => {
                if (!this.scrollHudEl.classList.contains('is-visible')) {
                    this.scrollHudEl.classList.add('hidden');
                }
            }, 200);
        }, IMAGE_LOUPE_SCROLL_HUD_MS);
    }

    _scheduleRefresh() {
        if (this._rafPending) {
            return;
        }
        this._rafPending = true;
        requestAnimationFrame(() => {
            this._rafPending = false;
            this.refresh();
        });
    }

    refresh() {
        if (this._destroyed) {
            return;
        }

        const enabled = this._isEnabled();
        this.el.classList.toggle('hidden', !enabled);

        if (!enabled) {
            return;
        }

        const revealActive = this._isRevealModeActive();
        if (this._revealPresentationActive && !revealActive) {
            this._applyRevealModeExit();
        } else if (!revealActive) {
            this._setVpMatchActive(false);
        }
        this._revealPresentationActive = revealActive;

        if (this.state === 'idle') {
            this._applyIdleAnchorPosition();
        }

        const img = this._getImage();
        if (img && !img._imageLoupeLoadWired) {
            img._imageLoupeLoadWired = true;
            img.addEventListener('load', this._onImageLoad);
        }
        const previewImg = this.getImageEl ? this.getImageEl() : null;
        if (previewImg && previewImg !== img && !previewImg._imageLoupeLoadWired) {
            previewImg._imageLoupeLoadWired = true;
            previewImg.addEventListener('load', this._onImageLoad);
        }

        this._updateViewport();
        this._tryObserveBlurBackdrop();
        if (this.state === 'idle') {
            this._scheduleIdleBackdropSync();
        }
    }

    _resolveBlurBackdropEl() {
        if (!this.getBlurBackdropEl) {
            return null;
        }
        try {
            return this.getBlurBackdropEl() || null;
        } catch (e) {
            return null;
        }
    }

    _updateBlurBackdrop() {
        if (!this.backdropEl || !this.viewportEl) {
            return;
        }

        const blurSource = this._resolveBlurBackdropEl();
        if (!blurSource) {
            this.backdropEl.style.backgroundImage = '';
            this.backdropEl.style.backgroundSize = '';
            this.backdropEl.style.backgroundPosition = '';
            return;
        }

        const blurStyle = getComputedStyle(blurSource);
        const bgImage = blurStyle.backgroundImage;
        if (!bgImage || bgImage === 'none') {
            this.backdropEl.style.backgroundImage = '';
            return;
        }

        const loupeRect = this.viewportEl.getBoundingClientRect();
        const blurRect = blurSource.getBoundingClientRect();
        const offsetX = loupeRect.left - blurRect.left;
        const offsetY = loupeRect.top - blurRect.top;

        const bgSize = resolveBackgroundSizePx(blurStyle, blurRect.width, blurRect.height);
        let resolvedSize = bgSize;
        if (!resolvedSize) {
            const img = this._getImage();
            if (img && img.naturalWidth && img.naturalHeight) {
                const scale = Math.max(
                    blurRect.width / img.naturalWidth,
                    blurRect.height / img.naturalHeight
                );
                resolvedSize = {
                    w: img.naturalWidth * scale,
                    h: img.naturalHeight * scale
                };
            }
        }
        if (!resolvedSize) {
            this.backdropEl.style.backgroundImage = '';
            this.backdropEl.style.backgroundSize = '';
            this.backdropEl.style.backgroundPosition = '';
            return;
        }

        const bgPos = resolveBackgroundPositionPx(
            blurStyle.backgroundPositionX,
            blurStyle.backgroundPositionY,
            blurRect.width,
            blurRect.height,
            resolvedSize.w,
            resolvedSize.h
        );

        this.backdropEl.style.backgroundImage = bgImage;
        this.backdropEl.style.backgroundRepeat = blurStyle.backgroundRepeat || 'no-repeat';
        this.backdropEl.style.backgroundSize = `${resolvedSize.w}px ${resolvedSize.h}px`;
        this.backdropEl.style.backgroundPosition = `${bgPos.x - offsetX}px ${bgPos.y - offsetY}px`;
    }

    _updateViewport() {
        if (!this.sampleEl) {
            return;
        }

        if (this._vpMatchActive) {
            this._syncVpMatchZoom();
        }

        this._updateBlurBackdrop();

        if (this.state === 'idle') {
            this.sampleEl.style.backgroundImage = '';
            this.sampleEl.style.backgroundSize = '';
            this.sampleEl.style.backgroundPosition = '';
            return;
        }

        const geometry = this._getSampleGeometry();
        if (!geometry) {
            this.sampleEl.style.backgroundImage = '';
            return;
        }

        const { img, rect } = geometry;
        if (!img.src || img.classList.contains('hidden') || !img.naturalWidth) {
            this.sampleEl.style.backgroundImage = '';
            return;
        }

        const src = img.currentSrc || img.src;
        const { zoom } = this._getLoupePresentation();
        const viewportPx = this._getRenderedViewportPx();

        const nx = (this._centerX - rect.contentLeft) / rect.contentWidth;
        const ny = (this._centerY - rect.contentTop) / rect.contentHeight;
        let u = Math.max(0, Math.min(1, nx)) * img.naturalWidth;
        let v = Math.max(0, Math.min(1, ny)) * img.naturalHeight;

        const bgW = rect.naturalWidth * zoom;
        const bgH = rect.naturalHeight * zoom;
        const posX = -(u * zoom - viewportPx / 2);
        const posY = -(v * zoom - viewportPx / 2);

        const vpZoom = this._getViewportMatchZoom();
        const isVp = vpZoom != null && Math.abs(zoom - vpZoom) < IMAGE_LOUPE_VP_ZOOM_TOLERANCE * 2;
        this.sampleEl.classList.toggle('is-pixelated', zoom > 1.001 && !isVp);
        this.sampleEl.style.backgroundImage = `url(${JSON.stringify(src)})`;
        this.sampleEl.style.backgroundSize = `${bgW}px ${bgH}px`;
        this.sampleEl.style.backgroundPosition = `${posX}px ${posY}px`;
        this.sampleEl.style.backgroundRepeat = 'no-repeat';
    }

    destroy() {
        if (this._destroyed) {
            return;
        }
        this._destroyed = true;

        document.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerUp);
        this.hostEl.removeEventListener('wheel', this._onWheel);

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }

        if (this._scrollHudTimer) {
            clearTimeout(this._scrollHudTimer);
        }

        const img = this._getImage();
        if (img && img._imageLoupeLoadWired) {
            img.removeEventListener('load', this._onImageLoad);
            delete img._imageLoupeLoadWired;
        }

        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }

        this.hostEl.classList.remove('image-loupe-host', 'is-active', 'image-loupe-hover-scope', 'is-park-ready-zone');
        this.hostEl.removeAttribute('data-corner-zone');
        if (this.hoverScopeEl && this.hoverScopeEl !== this.hostEl) {
            this.hoverScopeEl.classList.remove('image-loupe-hover-scope');
        }
    }
}

function attachImageLoupe(options) {
    const loupe = new ImageLoupe(options);
    return {
        loupe,
        destroy: () => loupe.destroy(),
        refresh: () => loupe.refresh(),
        setActive: () => loupe.setActive(),
        park: (corner) => loupe.park(corner),
        setViewportMatchZoom: (options) => loupe.setViewportMatchZoom(options),
        exitRevealPresentation: () => loupe.exitRevealPresentation()
    };
}
