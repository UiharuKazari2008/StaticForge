/**
 * Compare View Manager (Phase 2 — app.js refactor)
 *
 * Manual preview compare overlay, slide, loupe, baseline sync, and pointer/keyboard helpers.
 *
 * Dependencies (remain in app.js for now): contextMenu, showGlassToast, RESOLUTIONS, manual preview DOM.
 */

let previewRatio = 1;
let compareSourceImageData = null;
let bracketGenPhaseCompareSourceData = null;
let compareOverlayEnabled = false;
let compareSlideEnabled = false;
let compareLoupeRevealEnabled = false;
let compareViewQuickStored = { overlay: false, slide: false, reveal: false };
let compareViewQuickSuspended = false;
let comparePresentationInhibited = false;
let compareInhibitedByExpandCanvas = false;
let compareSplitPosition = 50;
let compareTempShowSourceActive = false;
let compareTempHideSourceActive = false;
let compareAltHeld = false;
let compareShiftLeftHeld = false;
let compareShiftRightHeld = false;
let compareLastShiftSide = null;
let compareDragActive = false;
let compareDragPointerId = null;
let compareDragStartX = 0;
let compareDragStartY = 0;
let compareDragStartAtMs = 0;
let compareDragMoved = false;
let suppressNextPreviewClick = false;
let compareRegisteredBaselineData = null;
let comparePreGenerationBaselineData = null;
let compareAltF10ComboIndex = 0;
let compareDefaultsArmed = false;
let compareDefaultsPendingModes = null;
const COMPARE_DEFAULT_SETTINGS = {
    overlayOpacity: 50,
    blendMode: 'normal',
    sourceColor: 'none',
    generationColor: 'none',
    priority: 'source'
};
let compareRuntimeSettings = { ...COMPARE_DEFAULT_SETTINGS };
const COMPARE_COLOR_FILTERS = {
    none: '',
    monotone: 'grayscale(1) contrast(1.05)',
    yellow: 'grayscale(1) sepia(1) saturate(5) hue-rotate(350deg) brightness(1.05)',
    green: 'grayscale(1) sepia(1) saturate(5) hue-rotate(70deg) brightness(1.05)',
    red: 'grayscale(1) sepia(1) saturate(6) hue-rotate(305deg) brightness(1.05)',
    blue: 'grayscale(1) sepia(1) saturate(5) hue-rotate(160deg) brightness(1.05)'
};
const COMPARE_BLEND_MENU = [
    { id: 'normal', label: 'Normal' },
    { separator: true },
    { id: 'multiply', label: 'Multiply' },
    { id: 'overlay', label: 'Overlay' },
    { id: 'screen', label: 'Screen' },
    { separator: true },
    { id: 'darken', label: 'Darken' },
    { id: 'lighten', label: 'Lighten' },
    { separator: true },
    { id: 'difference', label: 'Difference' },
    { id: 'exclusion', label: 'Exclusion' }
];
const COMPARE_BLEND_MODES = COMPARE_BLEND_MENU.filter((e) => e.id).map((e) => e.id);

/** Compare color submenu grid: single ordered list (id → swatch or none icon). */
const COMPARE_COLOR_MENU = [
    { id: 'none', icon: 'far fa-circle', tooltip: 'None' },
    { id: 'monotone', swatchColor: '#9e9e9e', tooltip: 'Monotone' },
    { id: 'green', swatchColor: '#43a047', tooltip: 'Green' },
    { id: 'blue', swatchColor: '#1e88e5', tooltip: 'Blue' },
    { id: 'yellow', swatchColor: '#fdd835', tooltip: 'Yellow' },
    { id: 'red', swatchColor: '#e53935', tooltip: 'Red' }
];

function getCompareColorSubmenu() {
    const mapCells = (action, key) => COMPARE_COLOR_MENU.map((spec) => ({
        action,
        value: spec.id,
        icon: spec.icon,
        swatchColor: spec.swatchColor,
        tooltip: spec.tooltip,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: function (item) {
            item.checked = compareRuntimeSettings[key] === spec.id;
        }
    }));
    return [
        { type: 'grid', title: 'Source', items: mapCells('setCompareSourceColor', 'sourceColor') },
        { type: 'grid', title: 'Result', items: mapCells('setCompareGenerationColor', 'generationColor') }
    ];
}

function getManualCompareElements() {
    const previewContent = document.querySelector('.manual-preview-content');
    const previewImage = document.getElementById('manualPreviewImage');
    const sourceImage = document.getElementById('manualPreviewCompareSourceImage');
    const useAsSourceBtn = document.getElementById('manualPreviewUseAsSourceBtn');
    const replaceSourceBtn = document.getElementById('manualPreviewReplaceSourceBtn');
    return { previewContent, previewImage, sourceImage, useAsSourceBtn, replaceSourceBtn };
}

function getCurrentPreviewDimensions() {
    const previewImage = document.getElementById('manualPreviewImage');
    if (!previewImage) {
        return null;
    }

    const width = previewImage.naturalWidth || 0;
    const height = previewImage.naturalHeight || 0;
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { width, height };
}

function cloneCompareData(data) {
    if (!data || !data.url) return null;
    return {
        url: data.url,
        width: data.width || 0,
        height: data.height || 0,
        chainSourceFile: data.chainSourceFile || null
    };
}

function setCompareSourceData(data) {
    const { sourceImage } = getManualCompareElements();
    if (!data || !data.url || !sourceImage) {
        return false;
    }

    compareSourceImageData = cloneCompareData(data);
    releaseManualPreviewElementImageSrc(sourceImage);
    sourceImage.src = compareSourceImageData.url;
    sourceImage.classList.remove('hidden');
    applyCompareDefaultSettings();
    updateCompareDisplayState();
    updateCompareControlsState();
    syncCompareLoupeRevealToLoupe();
    // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
    notifyKeyboardOverlayContextChanged();
    return true;
}

function buildCompareDataFromPreview() {
    const { previewImage } = getManualCompareElements();
    if (!previewImage || previewImage.classList.contains('hidden') || !previewImage.src) {
        return null;
    }
    const dims = getCurrentPreviewDimensions();
    const img = window.currentManualPreviewImage;
    const chainSourceFile = img
        ? (img.original || img.upscaled || img.filename || img.base || null)
        : (window.lastGeneration?.filename || window.lastGeneratedImageName || null);

    // Prefer stable persistent gallery image URL over ephemeral blob: URL
    let url = null;
    if (chainSourceFile) {
        url = localGalleryImageUrl(chainSourceFile);
    } else if (previewImage.dataset.manualPreviewUrl && !previewImage.dataset.manualPreviewUrl.startsWith('blob:')) {
        url = previewImage.dataset.manualPreviewUrl;
    } else {
        url = previewImage.src;
    }

    return {
        url,
        width: dims?.width || 0,
        height: dims?.height || 0,
        chainSourceFile
    };
}

function buildCompareDataFromImageObject(imageObj) {
    if (!imageObj) return null;
    const filename = imageObj.upscaled || imageObj.original || imageObj.filename;
    if (!filename) return null;
    return {
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        url: localGalleryImageUrl(filename),
        width: imageObj.width || 0,
        height: imageObj.height || 0,
        chainSourceFile: filename
    };
}

function registerCompareBaselineData(data) {
    const normalized = cloneCompareData(data);
    if (!normalized) return false;
    compareRegisteredBaselineData = normalized;
    return true;
}

function registerCompareBaselineFromCurrentPreview() {
    const data = buildCompareDataFromPreview();
    return registerCompareBaselineData(data);
}

function registerCompareBaselineFromImageObject(imageObj) {
    const data = buildCompareDataFromImageObject(imageObj);
    return registerCompareBaselineData(data);
}

function isGalleryCompareSourceAvailable() {
    // isStudioModalOpen: public/scripts/comp/modalUtils.js
    if (!isStudioModalOpen()) return false;
    const btn = document.getElementById('manualPreviewUseAsSourceBtn');
    const state = btn ? (btn.getAttribute('data-state') || 'off') : 'off';
    return state !== 'off';
}

function setCompareSourceFromGalleryImage(image) {
    const data = buildCompareDataFromImageObject(image);
    if (!data) {
        showGlassToast('error', 'Source Not Set', 'No image available', false, undefined, '<i class="fas fa-image-slash"></i>');
        return false;
    }
    if (compareSourceImageData && data.chainSourceFile && data.chainSourceFile === compareSourceImageData.chainSourceFile) {
        showGlassToast('info', null, 'Already the comparison source', false, 1600, '<i class="fas fa-eye-dropper"></i>');
        return true;
    }
    const overlay = compareOverlayEnabled;
    const slide = compareSlideEnabled;
    const reveal = compareLoupeRevealEnabled;
    const suspended = compareViewQuickSuspended;
    const split = compareSplitPosition;
    const ok = setCompareSourceData(data);
    if (!ok) return false;
    compareOverlayEnabled = overlay;
    compareSlideEnabled = slide;
    compareLoupeRevealEnabled = reveal;
    compareViewQuickSuspended = suspended;
    compareDefaultsArmed = false;
    compareDefaultsPendingModes = null;
    setCompareSplitPosition(split);
    const dims = getCurrentPreviewDimensions();
    if (dims && data.width && data.height) {
        maybeUpdateComparePresentationInhibitedFromPreviewDims(dims.width, dims.height);
    } else {
        comparePresentationInhibited = false;
    }
    syncCompareLoupeRevealToLoupe({ setVpZoom: reveal });
    showGlassToast('success', null, 'Comparison source updated', false, 1800, '<i class="fas fa-eye-dropper"></i>');
    return true;
}

function captureCompareBaselineBeforeGeneration() {
    comparePreGenerationBaselineData = cloneCompareData(compareRegisteredBaselineData);
    return Boolean(comparePreGenerationBaselineData);
}

function setCompareSplitPosition(percent) {
    const parsed = Math.max(0, Math.min(100, parseInt(percent, 10) || 50));
    compareSplitPosition = parsed;
    const { previewContent } = getManualCompareElements();
    if (previewContent) {
        previewContent.style.setProperty('--compare-split', `${parsed}%`);
    }
}

function isCompareViewCompositingBlocked() {
    return compareViewQuickSuspended || comparePresentationInhibited || compareInhibitedByExpandCanvas;
}

function getEffectiveCompareOverlay() {
    return Boolean(compareSourceImageData && compareSourceImageData.url && compareOverlayEnabled && !isCompareViewCompositingBlocked());
}

function getEffectiveCompareSlide() {
    return Boolean(compareSourceImageData && compareSourceImageData.url && compareSlideEnabled && !isCompareViewCompositingBlocked());
}

function isCompareLoupeRevealReady() {
    return Boolean(compareSourceImageData && compareSourceImageData.url && !isCompareViewCompositingBlocked());
}

function isCompareSourceAvailableForOverlay() {
    return Boolean(compareSourceImageData && compareSourceImageData.url);
}

function isCompareLoupeRevealActive() {
    return isCompareLoupeRevealReady() && compareLoupeRevealEnabled;
}

function syncCompareLoupeRevealToLoupe(options = {}) {
    // refreshManualPreviewImageLoupe, exitManualPreviewLoupeRevealMode, setManualPreviewLoupeViewportMatchZoom: public/scripts/comp/manualModalManager.js
    updateCompareDisplayState();
    updateCompareControlsState();

    const revealActive = isCompareLoupeRevealActive();
    if (!revealActive) {
        exitManualPreviewLoupeRevealMode();
    }

    refreshManualPreviewImageLoupe();

    if (options.setVpZoom && revealActive) {
        setManualPreviewLoupeViewportMatchZoom({ skipSnap: true });
    }
}

function setCompareLoupeRevealEnabled(enabled, options = {}) {
    const next = Boolean(enabled);
    if (!next) {
        compareLoupeRevealEnabled = false;
        persistCompareViewQuickStoredIfActive();
        syncCompareLoupeRevealToLoupe(options);
        return;
    }
    if (!isCompareLoupeRevealReady()) {
        return;
    }
    compareLoupeRevealEnabled = true;
    compareSlideEnabled = false;
    compareViewQuickSuspended = false;
    persistCompareViewQuickStoredIfActive();
    syncCompareLoupeRevealToLoupe({ setVpZoom: options.setVpZoom !== false });
}

function enableCompareLoupeRevealFromLoupe() {
    setCompareLoupeRevealEnabled(true, { setVpZoom: true });
}

function persistCompareViewQuickStoredIfActive() {
    if (compareOverlayEnabled || compareSlideEnabled || compareLoupeRevealEnabled) {
        compareViewQuickStored = {
            overlay: compareOverlayEnabled,
            slide: compareSlideEnabled,
            reveal: compareLoupeRevealEnabled
        };
    }
}

function updateCompareDisplayState() {
    const { previewContent, sourceImage, previewImage } = getManualCompareElements();
    if (!previewContent) {
        return;
    }

    if (!COMPARE_BLEND_MODES.includes(compareRuntimeSettings.blendMode)) {
        compareRuntimeSettings.blendMode = 'normal';
    }

    const hasSource = Boolean(compareSourceImageData && compareSourceImageData.url);
    const effOverlay = getEffectiveCompareOverlay();
    const effSlide = getEffectiveCompareSlide();
    const isInspectOverride = hasSource && (compareTempShowSourceActive || compareTempHideSourceActive);
    const showBothLabels = hasSource && effSlide && compareDragActive && compareDragMoved;
    const showSourceLabel = hasSource && compareTempShowSourceActive && !showBothLabels;
    const showResultLabel = hasSource && compareTempHideSourceActive && !showBothLabels;
    previewContent.classList.toggle('compare-has-source', hasSource);
    previewContent.classList.toggle('compare-overlay-on', hasSource && effOverlay);
    previewContent.classList.toggle('compare-slide-on', hasSource && effSlide);
    previewContent.classList.toggle('compare-loupe-reveal-on', isCompareLoupeRevealActive());
    previewContent.classList.toggle('compare-temp-show-source', hasSource && compareTempShowSourceActive);
    previewContent.classList.toggle('compare-temp-hide-source', hasSource && compareTempHideSourceActive);
    previewContent.classList.toggle('compare-show-both-labels', showBothLabels);
    previewContent.classList.toggle('compare-show-source-label', showSourceLabel);
    previewContent.classList.toggle('compare-show-result-label', showResultLabel);
    previewContent.classList.toggle('compare-drag-split-active', showBothLabels);
    setCompareSplitPosition(compareSplitPosition);
    previewContent.style.setProperty('--compare-overlay-opacity', `${(compareRuntimeSettings.overlayOpacity || 50) / 100}`);
    if (sourceImage) {
        sourceImage.style.mixBlendMode = 'normal';
        sourceImage.style.filter = isInspectOverride ? '' : (COMPARE_COLOR_FILTERS[compareRuntimeSettings.sourceColor] || '');
        sourceImage.style.opacity = '';
        sourceImage.style.zIndex = '';
        // 'none' overrides .manual-preview-compare-source { clip-path: inset(0 100% 0 0) }; '' would let that rule win and hide the source.
        sourceImage.style.clipPath = 'none';
    }
    if (previewImage) {
        previewImage.style.mixBlendMode = 'normal';
        previewImage.style.filter = isInspectOverride ? '' : (COMPARE_COLOR_FILTERS[compareRuntimeSettings.generationColor] || '');
        previewImage.style.opacity = '';
        previewImage.style.zIndex = '';
        previewImage.style.clipPath = 'none';
    }

    if (isInspectOverride && sourceImage && previewImage) {
        // ALT+Shift inspect mode: force explicit side output instead of relying on compare classes.
        if (compareTempShowSourceActive) {
            // Left Shift + Alt => Source only.
            sourceImage.style.zIndex = '4';
            previewImage.style.zIndex = '2';
            sourceImage.style.opacity = '1';
            previewImage.style.opacity = '0';
            sourceImage.style.clipPath = 'none';
            previewImage.style.clipPath = 'none';
        } else if (compareTempHideSourceActive) {
            // Right Shift + Alt => Result only.
            sourceImage.style.zIndex = '2';
            previewImage.style.zIndex = '4';
            sourceImage.style.opacity = '0';
            previewImage.style.opacity = '1';
            sourceImage.style.clipPath = 'inset(0 100% 0 0)';
            previewImage.style.clipPath = 'none';
        }
    } else if (hasSource && sourceImage && previewImage) {
        const overlayOpacity = `${(compareRuntimeSettings.overlayOpacity || 50) / 100}`;
        const blendMode = compareRuntimeSettings.blendMode || 'normal';
        const splitClip = `inset(0 calc(100% - var(--compare-split, 50%)) 0 0)`;
        const priGen = compareRuntimeSettings.priority === 'generation';

        if (effOverlay && effSlide) {
            if (priGen) {
                sourceImage.style.zIndex = '1';
                previewImage.style.zIndex = '4';
                sourceImage.style.opacity = '1';
                previewImage.style.opacity = overlayOpacity;
                previewImage.style.mixBlendMode = blendMode;
                previewImage.style.clipPath = splitClip;
            } else {
                sourceImage.style.zIndex = '4';
                previewImage.style.zIndex = '2';
                sourceImage.style.opacity = overlayOpacity;
                previewImage.style.opacity = '1';
                sourceImage.style.mixBlendMode = blendMode;
                sourceImage.style.clipPath = splitClip;
            }
        } else if (effOverlay && !effSlide) {
            if (priGen) {
                sourceImage.style.zIndex = '1';
                previewImage.style.zIndex = '4';
                sourceImage.style.opacity = '1';
                previewImage.style.opacity = overlayOpacity;
                previewImage.style.mixBlendMode = blendMode;
            } else {
                sourceImage.style.zIndex = '4';
                previewImage.style.zIndex = '2';
                sourceImage.style.opacity = overlayOpacity;
                previewImage.style.opacity = '1';
                sourceImage.style.mixBlendMode = blendMode;
            }
        } else if (!effOverlay && effSlide) {
            sourceImage.style.zIndex = '4';
            previewImage.style.zIndex = '2';
            sourceImage.style.opacity = '1';
            previewImage.style.opacity = '1';
            sourceImage.style.clipPath = splitClip;
        }
    }
}

function isPreviewSameAsCompareSource() {
    if (!compareSourceImageData || !compareSourceImageData.url) {
        return false;
    }
    const { previewImage } = getManualCompareElements();
    if (!previewImage || !previewImage.src) {
        return true;
    }
    if (previewImage.src === compareSourceImageData.url) {
        return true;
    }
    const cur = window.currentManualPreviewImage;
    if (cur && compareSourceImageData.chainSourceFile) {
        const f = cur.original || cur.upscaled || cur.filename;
        if (f && f === compareSourceImageData.chainSourceFile) {
            return true;
        }
    }
    return false;
}

function maybeFireCompareDefaultsArmed() {
    if (!compareDefaultsArmed || !compareDefaultsPendingModes) {
        return false;
    }
    if (!compareSourceImageData || !compareSourceImageData.url) {
        compareDefaultsArmed = false;
        compareDefaultsPendingModes = null;
        return false;
    }
    if (isPreviewSameAsCompareSource()) {
        return false;
    }
    compareOverlayEnabled = Boolean(compareDefaultsPendingModes.overlay);
    compareSlideEnabled = Boolean(compareDefaultsPendingModes.slide);
    compareLoupeRevealEnabled = Boolean(compareDefaultsPendingModes.reveal);
    compareDefaultsArmed = false;
    compareDefaultsPendingModes = null;
    compareViewQuickSuspended = false;
    persistCompareViewQuickStoredIfActive();
    updateCompareDisplayState();
    // Avoid syncCompareLoupeRevealToLoupe here — it re-enters updateCompareControlsState.
    // refreshManualPreviewImageLoupe / setManualPreviewLoupeViewportMatchZoom: public/scripts/comp/manualModalManager.js
    if (compareLoupeRevealEnabled) {
        refreshManualPreviewImageLoupe();
        setManualPreviewLoupeViewportMatchZoom({ skipSnap: true });
    } else {
        // exitManualPreviewLoupeRevealMode: public/scripts/comp/manualModalManager.js
        exitManualPreviewLoupeRevealMode();
        refreshManualPreviewImageLoupe();
    }
    return true;
}

function updateCompareControlsState() {
    const { useAsSourceBtn, replaceSourceBtn } = getManualCompareElements();
    const hasSource = Boolean(compareSourceImageData && compareSourceImageData.url);

    maybeFireCompareDefaultsArmed();

    if (useAsSourceBtn) {
        if (!hasSource) {
            useAsSourceBtn.setAttribute('data-state', 'off');
            useAsSourceBtn.removeAttribute('data-compare-ui');
            useAsSourceBtn.title = 'Enable Comparison';
        } else if (isPreviewSameAsCompareSource()) {
            useAsSourceBtn.setAttribute('data-state', 'armed');
            useAsSourceBtn.setAttribute('data-compare-ui', 'armed');
            useAsSourceBtn.title = 'Disable Comparison';
        } else if (compareViewQuickSuspended) {
            useAsSourceBtn.setAttribute('data-state', 'suspended');
            useAsSourceBtn.setAttribute('data-compare-ui', 'suspended');
            useAsSourceBtn.title = 'Toggle Comparison View';
        } else {
            useAsSourceBtn.setAttribute('data-state', 'on');
            useAsSourceBtn.setAttribute('data-compare-ui', 'active');
            useAsSourceBtn.title = 'Toggle Comparison View';
        }
    }

    if (replaceSourceBtn) {
        replaceSourceBtn.classList.toggle('hidden', !hasSource);
    }
}

function clearCompareSourceImage() {
    compareSourceImageData = null;
    compareAltF10ComboIndex = 0;
    compareOverlayEnabled = false;
    compareSlideEnabled = false;
    compareLoupeRevealEnabled = false;
    compareViewQuickStored = { overlay: false, slide: false, reveal: false };
    compareViewQuickSuspended = false;
    comparePresentationInhibited = false;
    compareInhibitedByExpandCanvas = false;
    compareTempShowSourceActive = false;
    compareTempHideSourceActive = false;
    compareDefaultsArmed = false;
    compareDefaultsPendingModes = null;
    const { sourceImage } = getManualCompareElements();
    if (sourceImage) {
        releaseManualPreviewElementImageSrc(sourceImage);
        sourceImage.classList.add('hidden');
    }
    updateCompareDisplayState();
    updateCompareControlsState();
    syncCompareLoupeRevealToLoupe();
    // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
    notifyKeyboardOverlayContextChanged();
}

function readCompareDefaultSettingsRaw() {
    try {
        const stored = localStorage.getItem('compareDefaultSettings');
        if (!stored) return null;
        return JSON.parse(stored);
    } catch (e) {
        console.warn('Failed to load compare default settings from localStorage:', e);
        return null;
    }
}

function hasCompareSavedDefaults() {
    const raw = readCompareDefaultSettingsRaw();
    return Boolean(raw && raw.saved);
}

function getCompareAutoEnableState() {
    const raw = readCompareDefaultSettingsRaw();
    return Boolean(raw && raw.autoEnableState);
}

function setCompareAutoEnableState(enabled) {
    const raw = readCompareDefaultSettingsRaw() || {};
    raw.autoEnableState = Boolean(enabled);
    saveCompareDefaultSettings(raw);
}

function buildCompareDefaultSettingsSnapshot() {
    const enableState = (compareOverlayEnabled || compareSlideEnabled || compareLoupeRevealEnabled) && !compareViewQuickSuspended;
    return {
        saved: true,
        overlayRuntime: { ...COMPARE_DEFAULT_SETTINGS, ...compareRuntimeSettings },
        defaultOverlayEnabled: Boolean(compareOverlayEnabled),
        defaultSlideEnabled: Boolean(compareSlideEnabled),
        defaultLoupeRevealEnabled: Boolean(compareLoupeRevealEnabled),
        splitPosition: compareSplitPosition,
        enableState: Boolean(enableState),
        autoEnableState: getCompareAutoEnableState()
    };
}

function applyCompareDefaultSettings() {
    const loaded = loadCompareDefaultSettings();
    compareDefaultsArmed = false;
    compareDefaultsPendingModes = null;
    if (!loaded || !loaded.saved) {
        return;
    }

    if (loaded.overlayRuntime) {
        compareRuntimeSettings = { ...COMPARE_DEFAULT_SETTINGS, ...loaded.overlayRuntime };
    }
    if (Number.isFinite(loaded.splitPosition)) {
        setCompareSplitPosition(loaded.splitPosition);
    }

    const desiredOverlay = Boolean(loaded.defaultOverlayEnabled);
    const desiredSlide = Boolean(loaded.defaultSlideEnabled);
    const desiredReveal = Boolean(loaded.defaultLoupeRevealEnabled);
    const wantEnable = Boolean(loaded.enableState);
    const autoEnable = Boolean(loaded.autoEnableState);

    if (autoEnable && wantEnable) {
        const pending = {
            overlay: desiredOverlay,
            slide: desiredSlide,
            reveal: desiredReveal
        };
        if (isPreviewSameAsCompareSource()) {
            compareOverlayEnabled = false;
            compareSlideEnabled = false;
            compareLoupeRevealEnabled = false;
            compareDefaultsArmed = true;
            compareDefaultsPendingModes = pending;
        } else {
            compareOverlayEnabled = pending.overlay;
            compareSlideEnabled = pending.slide;
            compareLoupeRevealEnabled = pending.reveal;
            compareViewQuickSuspended = false;
        }
    } else {
        // Visual settings applied above; do not auto-enable comparison display
        compareOverlayEnabled = false;
        compareSlideEnabled = false;
        compareLoupeRevealEnabled = false;
    }
    persistCompareViewQuickStoredIfActive();
}

// Kept for any external callers that still use the stub name
function applyCompareDefaultSettingsStub() {
    applyCompareDefaultSettings();
}

function loadCompareDefaultSettings() {
    const parsed = readCompareDefaultSettingsRaw();
    if (!parsed) {
        return null;
    }
    return {
        saved: Boolean(parsed.saved),
        overlayRuntime: parsed.overlayRuntime
            ? { ...COMPARE_DEFAULT_SETTINGS, ...parsed.overlayRuntime }
            : { ...COMPARE_DEFAULT_SETTINGS },
        defaultOverlayEnabled: !!parsed.defaultOverlayEnabled,
        defaultSlideEnabled: !!parsed.defaultSlideEnabled,
        defaultLoupeRevealEnabled: !!parsed.defaultLoupeRevealEnabled,
        splitPosition: Number.isFinite(Number(parsed.splitPosition)) ? Number(parsed.splitPosition) : 50,
        enableState: !!parsed.enableState,
        autoEnableState: !!parsed.autoEnableState
    };
}

function saveCompareDefaultSettings(settings) {
    try {
        if (settings) {
            localStorage.setItem('compareDefaultSettings', JSON.stringify(settings));
        }
    } catch (e) {
        console.warn('Failed to save compare default settings to localStorage:', e);
    }
}

function clearCompareDefaultSettings() {
    try {
        localStorage.removeItem('compareDefaultSettings');
    } catch (e) {
        console.warn('Failed to clear compare default settings from localStorage:', e);
    }
    compareDefaultsArmed = false;
    compareDefaultsPendingModes = null;
}

function compareReplaceSourceFromPreview() {
    setCompareSourceFromCurrentPreview();
    compareOverlayEnabled = false;
    compareSlideEnabled = false;
    compareLoupeRevealEnabled = false;
    compareViewQuickSuspended = false;
    compareAltF10ComboIndex = 0;
    updateCompareDisplayState();
    updateCompareControlsState();
    syncCompareLoupeRevealToLoupe();
}

function compareSourcePrimaryClick(showToast = false) {
    if (!compareSourceImageData || !compareSourceImageData.url) {
        let ok = setCompareSourceFromCurrentPreview();
        if (!ok) {
            ok = setCompareSourceData(comparePreGenerationBaselineData);
        }
        if (ok && showToast) {
            showGlassToast('success', null, 'Comparison source set', false, 1800, '<i class="fas fa-eye-dropper"></i>');
        } else if (!ok && showToast) {
            showGlassToast('error', 'Source Not Set', 'No preview image available', false, undefined, '<i class="fas fa-image-slash"></i>');
        }
        updateCompareDisplayState();
        updateCompareControlsState();
        return;
    }
    if (isPreviewSameAsCompareSource()) {
        clearCompareSourceImage();
        if (showToast) {
            showGlassToast('info', null, 'Comparison cleared', false, 1800, '<i class="fas fa-eye-dropper"></i>');
        }
        return;
    }
    
    if (compareViewQuickSuspended) {
        compareOverlayEnabled = compareViewQuickStored.overlay;
        compareSlideEnabled = compareViewQuickStored.slide;
        compareLoupeRevealEnabled = Boolean(compareViewQuickStored.reveal);
        compareViewQuickSuspended = false;
    } else {
        persistCompareViewQuickStoredIfActive();
        compareViewQuickSuspended = true;
    }

    compareTempHideSourceActive = false;
    compareTempShowSourceActive = false;
    updateCompareDisplayState();
    updateCompareControlsState();
    
    if (showToast) {
        showGlassToast('info', null, compareViewQuickSuspended ? 'Compare view paused' : 'Compare view resumed', false, 1600, '<i class="fas fa-columns-3"></i>');
    }
}

function compareSourceAltF8Hotkey() {
    if (!compareSourceImageData || !compareSourceImageData.url) {
        let ok = setCompareSourceFromCurrentPreview();
        if (!ok) {
            ok = setCompareSourceData(comparePreGenerationBaselineData);
        }
        updateCompareDisplayState();
        updateCompareControlsState();
        return ok ? 'set' : 'none';
    }
    if (isPreviewSameAsCompareSource()) {
        clearCompareSourceImage();
        updateCompareDisplayState();
        updateCompareControlsState();
        return 'cleared';
    }
    setCompareSourceFromCurrentPreview();
    updateCompareDisplayState();
    updateCompareControlsState();
    return 'replaced';
}

function compareAltF10CycleHotkey(showToast) {
    if (!compareSourceImageData || !compareSourceImageData.url) {
        if (showToast) {
            showGlassToast('error', 'Compare', 'Set a comparison source first', false, 1800, '<i class="fas fa-columns-3"></i>');
        }
        return 'No source';
    }
    compareAltF10ComboIndex = (compareAltF10ComboIndex + 1) % 5;
    compareLoupeRevealEnabled = false;
    if (compareAltF10ComboIndex === 1) {
        compareOverlayEnabled = true;
        compareSlideEnabled = false;
    } else if (compareAltF10ComboIndex === 2) {
        compareOverlayEnabled = false;
        compareSlideEnabled = true;
    } else if (compareAltF10ComboIndex === 3) {
        compareOverlayEnabled = true;
        compareSlideEnabled = true;
    } else if (compareAltF10ComboIndex === 4) {
        compareOverlayEnabled = false;
        compareSlideEnabled = false;
        compareLoupeRevealEnabled = true;
    } else {
        compareOverlayEnabled = false;
        compareSlideEnabled = false;
    }
    if (compareAltF10ComboIndex !== 0) {
        persistCompareViewQuickStoredIfActive();
    }
    compareViewQuickSuspended = false;
    compareTempHideSourceActive = false;
    compareTempShowSourceActive = false;
    updateCompareDisplayState();
    updateCompareControlsState();
    syncCompareLoupeRevealToLoupe({ setVpZoom: compareLoupeRevealEnabled });
    let label = 'Peek only';
    if (compareLoupeRevealEnabled) {
        label = 'Loupe reveal';
    } else if (compareOverlayEnabled && compareSlideEnabled) {
        label = 'Overlay + slide';
    } else if (compareOverlayEnabled) {
        label = 'Overlay';
    } else if (compareSlideEnabled) {
        label = 'A-B slide';
    }
    if (showToast) {
        showGlassToast('info', null, `Compare: ${label}`, false, 1800, '<i class="fas fa-columns-3"></i>');
    }
    return label;
}

function setComparePresentationInhibited(on) {
    comparePresentationInhibited = Boolean(on);
    updateCompareDisplayState();
    updateCompareControlsState();
}

function setCompareInhibitedByExpandCanvas(on) {
    compareInhibitedByExpandCanvas = Boolean(on);
    updateCompareDisplayState();
    updateCompareControlsState();
}

function maybeUpdateComparePresentationInhibitedFromPreviewDims(width, height) {
    if (!compareSourceImageData || !compareSourceImageData.url) {
        comparePresentationInhibited = false;
        return;
    }
    if (!width || !height) {
        return;
    }
    comparePresentationInhibited = width !== compareSourceImageData.width || height !== compareSourceImageData.height;
}

function resetCompareRuntimeSettings() {
    compareRuntimeSettings = { ...COMPARE_DEFAULT_SETTINGS };
    compareOverlayEnabled = false;
    compareSlideEnabled = false;
    compareLoupeRevealEnabled = false;
    compareViewQuickStored = { overlay: false, slide: false, reveal: false };
    compareViewQuickSuspended = false;
    comparePresentationInhibited = false;
    compareInhibitedByExpandCanvas = false;
    syncCompareLoupeRevealToLoupe();
}

function compareMenuHasSource() {
    return Boolean(compareSourceImageData && compareSourceImageData.url);
}

function compareMenuCurrentPreviewInfo() {
    const current = window.currentManualPreviewImage;
    const img = document.getElementById('manualPreviewImage');
    const filename = current?.upscaled || current?.filename || current?.original || current?.base || '';
    // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
    const galleryUrl = filename ? localGalleryImageUrl(filename) : '';
    const liveUrl = img && !img.classList.contains('hidden')
        ? (img.dataset.blobUrl || img.dataset.manualPreviewUrl || img.currentSrc || img.src)
        : '';
    const url = galleryUrl || liveUrl;
    if (!url || url === 'about:blank') return null;
    return {
        url,
        width: current?.width || img?.naturalWidth || 0,
        height: current?.height || img?.naturalHeight || 0,
        filename: filename || 'preview',
        original: filename || undefined
    };
}

function compareMenuPreviewInfo() {
    if (compareMenuHasSource()) {
        const chainFile = compareSourceImageData.chainSourceFile;
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        const displayUrl = (chainFile ? localGalleryImageUrl(chainFile) : null) || compareSourceImageData.url;
        return {
            url: displayUrl,
            width: compareSourceImageData.width || 0,
            height: compareSourceImageData.height || 0,
            filename: chainFile || 'compare-source',
            original: chainFile || undefined
        };
    }
    return compareMenuCurrentPreviewInfo();
}

function buildCompareMenuPreview() {
    const info = compareMenuPreviewInfo();
    const container = document.createElement('div');
    container.className = 'compare-menu-preview-container';
    container.style.cssText = 'padding: 4px 8px 0 8px; display: flex; justify-content: center; align-items: center; min-height: 120px; flex-shrink: 0;';
    if (!info || !info.url) {
        container.style.minHeight = 'auto';
        container.textContent = 'No image';
        container.style.padding = '8px';
        container.style.color = 'var(--text-muted)';
        return container;
    }
    const img = document.createElement('img');
    img.src = info.url;
    img.alt = compareMenuHasSource() ? 'Compare source' : 'Current image';
    img.style.cssText = 'max-width: 100%; max-height: 175px; border-radius: 4px; object-fit: contain; cursor: pointer;';
    img.loading = 'lazy';
    img.addEventListener('click', function (e) {
        e.stopPropagation();
        if (contextMenu) contextMenu.hideMenu();
        // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
        openGalleryImageInViewer({
            url: info.url,
            width: info.width || img.naturalWidth || 0,
            height: info.height || img.naturalHeight || 0,
            filename: info.filename,
            original: info.original,
            upscaled: info.original
        });
    });
    img.onerror = function () {
        container.style.minHeight = 'auto';
        container.textContent = 'Preview not available';
        container.style.padding = '8px';
        container.style.color = 'var(--text-muted)';
    };
    container.appendChild(img);
    return container;
}

function getCompareContextMenuConfig() {
    const overlayOpacityOptions = [15, 25, 50, 75, 85].map(value => ({
        text: `${value}%`,
        action: 'setCompareOpacity',
        value: value,
        keepMenuOpen: true,
        loadfn: function (item) {
            item.checked = compareRuntimeSettings.overlayOpacity === value;
        }
    }));

    const blendOptions = COMPARE_BLEND_MENU.map((entry) => {
        if (entry.separator) {
            return { separator: true };
        }
        const mode = entry.id;
        return {
            text: entry.label,
            action: 'setCompareBlend',
            value: mode,
            keepMenuOpen: true,
            loadfn: function (item) {
                item.checked = compareRuntimeSettings.blendMode === mode;
            }
        };
    });

    const priorityOptions = [
        { text: 'Result', value: 'source' },
        { text: 'Source', value: 'generation' }
    ].map(opt => ({
        text: opt.text,
        action: 'setComparePriority',
        value: opt.value,
        keepMenuOpen: true,
        loadfn: function (item) {
            item.checked = compareRuntimeSettings.priority === opt.value;
        }
    }));

    return {
        maxHeight: true,
        sections: [
            {
                type: 'custom',
                title: 'Comparison',
                content: function () {
                    return buildCompareMenuPreview();
                }
            },
            {
                type: 'list',
                hidden: () => compareMenuHasSource(),
                items: [
                    {
                        icon: 'fas fa-eye-dropper',
                        text: 'Enable',
                        action: 'compareEnable',
                        disabled: () => !compareMenuCurrentPreviewInfo()
                    }
                ]
            },
            {
                type: 'list',
                hidden: () => !compareSourceImageData || !compareSourceImageData.url,
                items: [
                    {
                        icon: 'fas fa-magnifying-glass',
                        text: 'Loupe reveal',
                        action: 'compareToggleLoupeReveal',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: () => compareSlideEnabled,
                        loadfn: (item) => { item.checked = compareLoupeRevealEnabled; }
                    },
                    {
                        icon: 'fas fa-columns',
                        text: 'Slide',
                        action: 'compareToggleSlide',
                        keepMenuOpen: true,
                        showIndicator: true,
                        disabled: () => compareLoupeRevealEnabled,
                        loadfn: (item) => { item.checked = compareSlideEnabled; }
                    },
                    { icon: 'fas fa-layer-group', text: 'Overlay', action: 'compareToggleOverlay', keepMenuOpen: false, showIndicator: true, loadfn: (item) => { item.checked = compareOverlayEnabled; } }
                ]
            },
            {
                type: 'list',
                hidden: () => !compareSourceImageData || !compareSourceImageData.url,
                items: [
                    { icon: 'fas fa-arrow-down-wide-short', text: 'Priority', submenu: priorityOptions, disabled: () => !compareOverlayEnabled },
                    { icon: 'fas fa-eye', text: 'Visibility', submenu: overlayOpacityOptions, disabled: () => !compareOverlayEnabled },
                    { icon: 'fas fa-fill-drip', text: 'Blending', submenu: blendOptions, disabled: () => !compareOverlayEnabled },
                    { icon: 'fas fa-palette', text: 'Color', submenu: getCompareColorSubmenu(), disabled: () => !compareOverlayEnabled }
                ]
            },
            {
                type: 'list',
                title: 'Defaults',
                hidden: () => !compareSourceImageData || !compareSourceImageData.url,
                items: [
                    { icon: 'fas fa-floppy-disk', text: 'Save Default Settings', action: 'compareSaveDefaultSettings', keepMenuOpen: false },
                    {
                        icon: 'fas fa-trash',
                        text: 'Clear Default Settings',
                        action: 'compareClearDefaultSettings',
                        keepMenuOpen: false,
                        className: 'text-danger',
                        disabled: () => !hasCompareSavedDefaults()
                    },
                    {
                        icon: 'fas fa-bolt',
                        text: 'Auto Enable State',
                        action: 'compareToggleAutoEnableState',
                        keepMenuOpen: true,
                        showIndicator: true,
                        loadfn: (item) => { item.checked = getCompareAutoEnableState(); }
                    }
                ]
            },
            {
                type: 'list',
                title: 'Actions',
                hidden: () => !compareSourceImageData || !compareSourceImageData.url,
                items: [
                    { icon: 'fas fa-rotate-left', text: 'Reset Controls', action: 'compareResetControls', keepMenuOpen: false },
                    { icon: 'fas fa-arrows-rotate', text: 'Replace Source', action: 'compareReplaceSource', keepMenuOpen: false, className: 'text-warning' },
                    { icon: 'fas fa-times', text: 'Stop Comparison', action: 'compareClearSource', keepMenuOpen: false, className: 'text-danger' }
                ]
            }
        ],
        onAction: handleCompareContextMenuAction,
        closeTreeOnOuterClick: true
    };
}

function handleCompareContextMenuAction(action, target, item) {
    if (!action) return;
    if (action === 'compareEnable') {
        compareSourcePrimaryClick(true);
        return;
    }
    if (action === 'compareToggleLoupeReveal') {
        setCompareLoupeRevealEnabled(!compareLoupeRevealEnabled, { setVpZoom: true });
        compareAltF10ComboIndex = compareLoupeRevealEnabled ? 4 : 0;
        return;
    }
    if (action === 'compareToggleSlide') {
        if (compareLoupeRevealEnabled) {
            return;
        }
        compareSlideEnabled = !compareSlideEnabled;
        if (compareSlideEnabled) {
            compareLoupeRevealEnabled = false;
            syncCompareLoupeRevealToLoupe();
        }
        persistCompareViewQuickStoredIfActive();
        compareViewQuickSuspended = false;
        compareAltF10ComboIndex = compareSlideEnabled
            ? (compareOverlayEnabled ? 3 : 2)
            : (compareOverlayEnabled ? 1 : 0);
        updateCompareDisplayState();
        updateCompareControlsState();
        return;
    }
    if (action === 'compareToggleOverlay') {
        compareOverlayEnabled = !compareOverlayEnabled;
        persistCompareViewQuickStoredIfActive();
        compareViewQuickSuspended = false;
        compareAltF10ComboIndex = compareOverlayEnabled
            ? (compareSlideEnabled ? 3 : 1)
            : (compareSlideEnabled ? 2 : (compareLoupeRevealEnabled ? 4 : 0));
        updateCompareDisplayState();
        updateCompareControlsState();
        return;
    }
    if (action === 'compareResetControls') {
        resetCompareRuntimeSettings();
        setCompareSplitPosition(50);
        updateCompareControlsState();
        return;
    }
    if (action === 'compareReplaceSource') {
        compareReplaceSourceFromPreview();
        return;
    }
    if (action === 'compareSaveDefaultSettings') {
        saveCompareDefaultSettings(buildCompareDefaultSettingsSnapshot());
        // showGlassToast: public/scripts/comp/toastManager.js
        showGlassToast('success', null, 'Comparison defaults saved', false, 1800, '<i class="fas fa-floppy-disk"></i>');
        return;
    }
    if (action === 'compareClearDefaultSettings') {
        clearCompareDefaultSettings();
        // showGlassToast: public/scripts/comp/toastManager.js
        showGlassToast('info', null, 'Comparison defaults cleared', false, 1800, '<i class="fas fa-trash"></i>');
        return;
    }
    if (action === 'compareToggleAutoEnableState') {
        setCompareAutoEnableState(!getCompareAutoEnableState());
        return;
    }
    if (action === 'compareClearSource') {
        clearCompareSourceImage();
        return;
    }
    if (action === 'setCompareOpacity') {
        compareRuntimeSettings.overlayOpacity = Number(item?.value) || 50;
        updateCompareDisplayState();
        return;
    }
    if (action === 'setCompareBlend') {
        compareRuntimeSettings.blendMode = item?.value || 'normal';
        updateCompareDisplayState();
        return;
    }
    if (action === 'setCompareSourceColor') {
        compareRuntimeSettings.sourceColor = item?.value || 'none';
        updateCompareDisplayState();
        return;
    }
    if (action === 'setCompareGenerationColor') {
        compareRuntimeSettings.generationColor = item?.value || 'none';
        updateCompareDisplayState();
        return;
    }
    if (action === 'setComparePriority') {
        compareRuntimeSettings.priority = item?.value === 'generation' ? 'generation' : 'source';
        updateCompareDisplayState();
        return;
    }
}

function setCompareSourceFromCurrentPreview() {
    const previewData = buildCompareDataFromPreview();
    if (!previewData) {
        showGlassToast('error', 'Source Not Set', 'No preview image available', false, undefined, '<i class="fas fa-image-slash"></i>');
        return false;
    }

    return setCompareSourceData(previewData);
}

function updateCompareShiftOverrides() {
    const previousShow = compareTempShowSourceActive;
    const previousHide = compareTempHideSourceActive;

    let activeShiftSide = compareLastShiftSide;
    if (activeShiftSide === 'left' && !compareShiftLeftHeld) {
        activeShiftSide = compareShiftRightHeld ? 'right' : null;
    } else if (activeShiftSide === 'right' && !compareShiftRightHeld) {
        activeShiftSide = compareShiftLeftHeld ? 'left' : null;
    } else if (!activeShiftSide) {
        activeShiftSide = compareShiftLeftHeld ? 'left' : (compareShiftRightHeld ? 'right' : null);
    }
    compareLastShiftSide = activeShiftSide;

    // Left Shift + Alt = full source (A); Right Shift + Alt = source hidden, result only (B).
    compareTempShowSourceActive = compareAltHeld && activeShiftSide === 'left';
    compareTempHideSourceActive = compareAltHeld && activeShiftSide === 'right';

    if (compareTempShowSourceActive || compareTempHideSourceActive) {
        const shortcutsOverlay = document.getElementById('shortcutsOverlay');
        if (shortcutsOverlay) {
            shortcutsOverlay.classList.remove('visible');
        }
    }

    if (previousShow !== compareTempShowSourceActive || previousHide !== compareTempHideSourceActive) {
        updateCompareDisplayState();
    }
}

function startComparePointerDrag(e) {
    if (!compareSourceImageData || !getEffectiveCompareSlide()) {
        return;
    }

    const { previewImage } = getManualCompareElements();
    if (!previewImage || previewImage.classList.contains('hidden')) {
        return;
    }

    compareDragPointerId = e.pointerId;
    compareDragActive = true;
    compareDragMoved = false;
    compareDragStartX = e.clientX;
    compareDragStartY = e.clientY;
    compareDragStartAtMs = Date.now();
    updateCompareDisplayState();
}

function updateComparePointerDrag(e) {
    if (!compareDragActive || e.pointerId !== compareDragPointerId || !getEffectiveCompareSlide()) {
        return;
    }

    const deltaX = Math.abs(e.clientX - compareDragStartX);
    const deltaY = Math.abs(e.clientY - compareDragStartY);
    const elapsedMs = Date.now() - compareDragStartAtMs;
    const movedEnough = deltaX >= 4 || deltaY >= 4;
    const heldLongEnough = elapsedMs >= 120;

    if (movedEnough && heldLongEnough) {
        compareDragMoved = true;
        updateCompareSplitFromPointer(e.clientX);
        e.preventDefault();
    }
}

function endComparePointerDrag(e) {
    if (e.pointerId !== compareDragPointerId) {
        return;
    }

    if (compareDragMoved) {
        suppressNextPreviewClick = true;
        setTimeout(() => {
            suppressNextPreviewClick = false;
        }, 0);
    }

    compareDragActive = false;
    compareDragPointerId = null;
    compareDragMoved = false;
    updateCompareDisplayState();
}

function updateCompareSplitFromPointer(clientX) {
    const previewImage = document.getElementById('manualPreviewImage');
    if (!previewImage) {
        return;
    }
    const rect = previewImage.getBoundingClientRect();
    if (rect.width <= 0) {
        return;
    }
    const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const percent = Math.round((relativeX / rect.width) * 100);
    setCompareSplitPosition(percent);
    updateCompareDisplayState();
}

function maybeReplaceCompareSourceAfterResultDimensions(width, height) {
    if (shouldPreserveBracketGenPhaseCompareSource()) {
        return;
    }
    if (!compareSourceImageData || !compareSourceImageData.url || !width || !height) {
        return;
    }
    if (compareSourceImageData.width === width && compareSourceImageData.height === height) {
        return;
    }
    if (setCompareSourceFromCurrentPreview()) {
        showGlassToast('info', null, 'Compare source updated to match result size', false, 2600, '<i class="fas fa-ruler-combined"></i>');
    }
}

function normalizePipelineStageIndex(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
}

// stage_seeds[0] = pipeline stage 1; base (00) is not in the array — match image seed to find stage
function resolvePipelineStageIndexFromMetadata(meta) {
    if (!meta) return null;

    const stageSeeds = meta.forge_data?.stage_seeds || meta.stage_seeds;
    const imageSeed = normalizePipelineStageIndex(meta.seed);

    if (Array.isArray(stageSeeds) && stageSeeds.length > 0 && imageSeed !== null) {
        for (let i = stageSeeds.length - 1; i >= 0; i--) {
            const entry = stageSeeds[i];
            const entrySeed = normalizePipelineStageIndex(entry?.seed);
            if (entrySeed === null || entrySeed !== imageSeed) continue;
            const entryStage = normalizePipelineStageIndex(entry?.stage_index);
            return entryStage !== null ? entryStage : i + 1;
        }
    }

    const explicit = normalizePipelineStageIndex(meta.forge_data?.stage_index ?? meta.stage_index);
    if (explicit !== null) {
        return explicit;
    }

    const pipeline = meta.forge_data?.pipeline || meta.pipeline;
    if (!Array.isArray(pipeline) || pipeline.length === 0) {
        return 0;
    }

    return null;
}

function getPreviewPipelineStageIndex(metadata) {
    return resolvePipelineStageIndexFromMetadata(metadata || window.currentManualPreviewImage?.metadata);
}

function getBracketGenCompareSourcePipelineStageIndex() {
    if (typeof bracketGenerationApplet === 'undefined' || typeof hasManagedBracketArtifacts !== 'function') {
        return null;
    }
    if (!hasManagedBracketArtifacts()) return null;
    const stepIdx = bracketGenerationApplet.state.compareSourceStepIndex;
    if (stepIdx === null || stepIdx === undefined) return null;
    return bracketGenerationApplet.getPipelineStageIndexForStep(stepIdx);
}

function hasBracketGenCompareSourceConfigured() {
    return getBracketGenCompareSourcePipelineStageIndex() !== null;
}

function shouldPreserveBracketGenPhaseCompareSource() {
    return hasBracketGenCompareSourceConfigured() && Boolean(bracketGenPhaseCompareSourceData?.url);
}

function captureBracketGenPhaseCompareSource() {
    const data = buildCompareDataFromPreview();
    if (!data) return false;
    bracketGenPhaseCompareSourceData = cloneCompareData(data);
    return true;
}

function clearBracketGenPhaseCompareSource() {
    bracketGenPhaseCompareSourceData = null;
}

function applyBracketGenPhaseCompareSource(options = {}) {
    if (!bracketGenPhaseCompareSourceData?.url) return false;
    const ok = setCompareSourceData(bracketGenPhaseCompareSourceData);
    if (ok && options.showToast) {
        showGlassToast('success', null, 'Comparison source set from phase', false, 1800, '<i class="fas fa-eye-dropper"></i>');
    }
    return ok;
}

function tryCaptureBracketGenPhaseCompareSourceFromPreview(metadata) {
    const targetStage = getBracketGenCompareSourcePipelineStageIndex();
    if (targetStage === null) return false;
    const previewStage = getPreviewPipelineStageIndex(metadata);
    if (previewStage !== targetStage) return false;
    if (!getSavedPipelinePreviewFilename()) return false;
    return captureBracketGenPhaseCompareSource();
}

function handleBracketGenCompareSourceAfterPreviewUpdate(metadata, response) {
    if (!hasBracketGenCompareSourceConfigured()) return;

    const targetStage = getBracketGenCompareSourcePipelineStageIndex();
    const previewStage = getPreviewPipelineStageIndex(metadata);

    if (response && previewStage === targetStage) {
        captureBracketGenPhaseCompareSource();
    }

    if (bracketGenPhaseCompareSourceData) {
        applyBracketGenPhaseCompareSource();
    } else if (response && previewStage === targetStage) {
        applyBracketGenPhaseCompareSource();
    }
}

function applyBracketGenCompareSourceBeforeGeneration(requestBody) {
    if (!hasBracketGenCompareSourceConfigured()) return;

    const targetStage = getBracketGenCompareSourcePipelineStageIndex();
    const targetStageIndex = requestBody?.target_stage_index;

    if (targetStageIndex !== undefined && targetStageIndex !== null && targetStageIndex === targetStage) {
        clearBracketGenPhaseCompareSource();
        return;
    }

    if (bracketGenPhaseCompareSourceData) {
        applyBracketGenPhaseCompareSource();
        return;
    }

    tryCaptureBracketGenPhaseCompareSourceFromPreview();
    if (bracketGenPhaseCompareSourceData) {
        applyBracketGenPhaseCompareSource();
        return;
    }

    const previewStage = getPreviewPipelineStageIndex();
    const generatingLaterStage = targetStageIndex !== undefined && targetStageIndex !== null
        && targetStageIndex > targetStage;

    if (previewStage === targetStage || generatingLaterStage) {
        if (tryCaptureBracketGenPhaseCompareSourceFromPreview()) {
            applyBracketGenPhaseCompareSource();
        }
    }
}

function syncCompareSourceBeforeGeneration(requestBody) {
    applyBracketGenCompareSourceBeforeGeneration(requestBody);

    if (shouldPreserveBracketGenPhaseCompareSource()) {
        applyBracketGenPhaseCompareSource();
        comparePresentationInhibited = false;
        updateCompareDisplayState();
        updateCompareControlsState();
        return;
    }

    const lockedSeedBtn = document.getElementById('sproutSeedBtn');
    if (lockedSeedBtn && lockedSeedBtn.getAttribute('data-state') === 'on' && !compareSourceImageData) {
        setCompareSourceFromCurrentPreview();
    }
    if (!compareSourceImageData) {
        return;
    }
    let tw = requestBody.width;
    let th = requestBody.height;
    if (!tw || !th) {
        const resVal = requestBody.resolution;
        if (typeof RESOLUTIONS !== 'undefined' && resVal) {
            const entry = RESOLUTIONS.find(r => r.value === resVal);
            if (entry) {
                tw = entry.width;
                th = entry.height;
            }
        }
    }
    if (!tw || !th) {
        return;
    }
    if (compareSourceImageData.width === tw && compareSourceImageData.height === th) {
        comparePresentationInhibited = false;
        updateCompareDisplayState();
        updateCompareControlsState();
        return;
    }
    setCompareSourceFromCurrentPreview();
    comparePresentationInhibited = false;
    updateCompareDisplayState();
    updateCompareControlsState();
}

function compareViewPointerMoveHandler(e) {
    updateComparePointerDrag(e);
}

function compareViewPointerUpHandler(e) {
    endComparePointerDrag(e);
}

function compareViewKeydownHandler(e) {
    if (e.key === 'Alt') {
        compareAltHeld = true;
    } else if (e.code === 'ShiftLeft') {
        compareShiftLeftHeld = true;
        compareLastShiftSide = 'left';
    } else if (e.code === 'ShiftRight') {
        compareShiftRightHeld = true;
        compareLastShiftSide = 'right';
    } else if (e.key === 'Shift') {
        compareShiftLeftHeld = true;
        compareShiftRightHeld = true;
    }
    updateCompareShiftOverrides();
}

function compareViewKeyupHandler(e) {
    if (e.key === 'Alt') {
        compareAltHeld = false;
    } else if (e.code === 'ShiftLeft') {
        compareShiftLeftHeld = false;
    } else if (e.code === 'ShiftRight') {
        compareShiftRightHeld = false;
    } else if (e.key === 'Shift') {
        compareShiftLeftHeld = false;
        compareShiftRightHeld = false;
    }
    updateCompareShiftOverrides();
}

function compareViewWindowBlurHandler() {
    compareAltHeld = false;
    compareShiftLeftHeld = false;
    compareShiftRightHeld = false;
    compareLastShiftSide = null;
    compareTempShowSourceActive = false;
    compareTempHideSourceActive = false;
    compareDragActive = false;
    compareDragPointerId = null;
    if (compareSourceImageData) {
        updateCompareDisplayState();
    }
}

let compareViewModalScopeWired = false;
let compareViewKeyboardWired = false;

function wireCompareViewKeyboardListeners() {
    if (compareViewKeyboardWired) return;
    compareViewKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'compareView.keydown',
        handler: compareViewKeydownHandler,
        type: 'whenOpen',
        modalId: 'manualModal',
        eventType: 'keydown',
        priority: 65,
        critical: false,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'compareView.keyup',
        handler: compareViewKeyupHandler,
        type: 'whenOpen',
        modalId: 'manualModal',
        eventType: 'keyup',
        priority: 65,
        critical: false,
        showInOverlay: false
    });
}

function wireCompareViewListeners() {
    wireCompareViewKeyboardListeners();
    const manualModal = document.getElementById('manualModal');
    const manualPreviewUseAsSourceBtn = document.getElementById('manualPreviewUseAsSourceBtn');
    const manualPreviewReplaceSourceBtn = document.getElementById('manualPreviewReplaceSourceBtn');
    const manualPreviewImage = document.getElementById('manualPreviewImage');

    if (manualPreviewUseAsSourceBtn) {
        manualPreviewUseAsSourceBtn.addEventListener('click', (e) => {
            e.preventDefault();
            compareSourcePrimaryClick(true);
        });
        if (contextMenu) {
            contextMenu.attachToElement(manualPreviewUseAsSourceBtn, getCompareContextMenuConfig());
        }
    }

    if (manualPreviewReplaceSourceBtn && manualPreviewReplaceSourceBtn.dataset.wired !== 'true') {
        manualPreviewReplaceSourceBtn.dataset.wired = 'true';
        manualPreviewReplaceSourceBtn.addEventListener('click', (e) => {
            e.preventDefault();
            compareReplaceSourceFromPreview();
        });
    }

    if (manualPreviewImage) {
        manualPreviewImage.addEventListener('pointerdown', startComparePointerDrag);
        manualPreviewImage.addEventListener('pointermove', updateComparePointerDrag);
        manualPreviewImage.addEventListener('pointerup', endComparePointerDrag);
        manualPreviewImage.addEventListener('pointercancel', endComparePointerDrag);
        manualPreviewImage.addEventListener('pointerleave', endComparePointerDrag);
    }

    if (manualModal && !compareViewModalScopeWired) {
        compareViewModalScopeWired = true;
        // attachModalListeners: public/scripts/comp/modalListenerScope.js
        attachModalListeners(manualModal, (signal) => {
            document.addEventListener('pointermove', compareViewPointerMoveHandler, { signal });
            document.addEventListener('pointerup', compareViewPointerUpHandler, { signal });
            window.addEventListener('blur', compareViewWindowBlurHandler, { signal });
        });
    }

    updateCompareControlsState();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireCompareViewListeners());
} else {
    wireCompareViewListeners();
}
