/**
 * Studio Image Generation prefs + Quickstart Gallery empty state.
 * Server twin: modules/imageGenerationSettings.js
 * Persist: persistUserGlobalSettingsPatch — public/scripts/comp/modalUtils.js
 */

const DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT = {
    streamImageGeneration: true,
    showStreamedImagesUnprocessed: true,
    simpleOutputViewer: false,
    lockOutputViewerCamera: false,
    reducedMotion: false,
    transparencyBackground: 'checker-dark',
    transparencyCustomColor: '#808080',
    hideQuickstartGallery: false,
    persistHistory: true,
    imageFormat: 'png',
    automaticDownload: false,
    alphaMode: 'straight'
};

const IMAGE_GENERATION_TRANSPARENCY_BACKGROUNDS = new Set([
    'checker-dark',
    'checker-light',
    'white',
    'black',
    'gray',
    'red',
    'green',
    'blue',
    'custom'
]);

let imageGenerationSettingsState = { ...DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT };
let imageGenerationSettingsWired = false;
let quickstartGalleryLoadPromise = null;
let quickstartGalleryItems = null;
let studioPreviewRestoreInFlight = false;

function normalizeImageGenerationBooleanClient(value, fallback) {
    if (typeof value === 'boolean') return value;
    return fallback;
}

function normalizeImageGenerationTransparencyBackgroundClient(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_]+/g, '-');
    if (IMAGE_GENERATION_TRANSPARENCY_BACKGROUNDS.has(value)) return value;
    if (value === 'checker' || value === 'checkerboard') return 'checker-dark';
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.transparencyBackground;
}

function normalizeImageGenerationCustomColorClient(raw) {
    const value = String(raw || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
        return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
    }
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.transparencyCustomColor;
}

function normalizeImageGenerationFormatClient(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'webp' || value === 'webplossless') return 'webp';
    if (value === 'png') return 'png';
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.imageFormat;
}

function normalizeImageGenerationAlphaModeClient(raw) {
    const value = String(raw || '').toLowerCase();
    if (value === 'premultiplied' || value === 'straight') return value;
    return DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT.alphaMode;
}

function normalizeImageGenerationSettingsClient(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_IMAGE_GENERATION_SETTINGS_CLIENT;
    return {
        streamImageGeneration: normalizeImageGenerationBooleanClient(src.streamImageGeneration, defaults.streamImageGeneration),
        showStreamedImagesUnprocessed: normalizeImageGenerationBooleanClient(
            src.showStreamedImagesUnprocessed,
            defaults.showStreamedImagesUnprocessed
        ),
        simpleOutputViewer: normalizeImageGenerationBooleanClient(src.simpleOutputViewer, defaults.simpleOutputViewer),
        lockOutputViewerCamera: normalizeImageGenerationBooleanClient(src.lockOutputViewerCamera, defaults.lockOutputViewerCamera),
        reducedMotion: normalizeImageGenerationBooleanClient(src.reducedMotion, defaults.reducedMotion),
        transparencyBackground: normalizeImageGenerationTransparencyBackgroundClient(src.transparencyBackground),
        transparencyCustomColor: normalizeImageGenerationCustomColorClient(src.transparencyCustomColor),
        hideQuickstartGallery: normalizeImageGenerationBooleanClient(src.hideQuickstartGallery, defaults.hideQuickstartGallery),
        persistHistory: normalizeImageGenerationBooleanClient(src.persistHistory, defaults.persistHistory),
        imageFormat: normalizeImageGenerationFormatClient(src.imageFormat),
        automaticDownload: normalizeImageGenerationBooleanClient(src.automaticDownload, defaults.automaticDownload),
        alphaMode: normalizeImageGenerationAlphaModeClient(src.alphaMode)
    };
}

function getImageGenerationSettings() {
    return imageGenerationSettingsState;
}

function isManualPreviewImageLoaded() {
    const img = document.getElementById('manualPreviewImage');
    if (!img || img.classList.contains('hidden')) return false;
    const src = img.currentSrc || img.src || '';
    return src !== '' && src !== window.location.href;
}

function shouldShowManualQuickstartGallery() {
    if (imageGenerationSettingsState.hideQuickstartGallery) return false;
    if (isManualPreviewImageLoaded()) return false;
    const form = document.getElementById('manualForm');
    if (form && form.classList.contains('generating')) return false;
    if (form && form.classList.contains('streaming')) return false;
    return true;
}

function applyImageGenerationPreviewChrome() {
    const root = document.documentElement;
    const settings = imageGenerationSettingsState;
    root.classList.toggle('studio-simple-output', settings.simpleOutputViewer === true);
    root.classList.toggle('studio-lock-viewer-camera', settings.lockOutputViewerCamera === true);
    root.classList.toggle('studio-reduced-preview', settings.reducedMotion === true);
    root.dataset.studioTransparencyBg = settings.transparencyBackground;
    root.dataset.studioAlphaMode = settings.alphaMode;
    if (settings.transparencyBackground === 'custom') {
        root.style.setProperty('--studio-transparency-custom', settings.transparencyCustomColor);
    } else {
        root.style.removeProperty('--studio-transparency-custom');
    }
    if (settings.lockOutputViewerCamera) {
        // destroyManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
        destroyManualPreviewImageLoupe();
    } else {
        // refreshManualPreviewImageLoupe: public/scripts/comp/manualModalManager.js
        refreshManualPreviewImageLoupe();
    }
}

function syncDesktopSettingsToggle(id, on) {
    const btn = document.getElementById(id);
    if (btn) btn.dataset.state = on ? 'on' : 'off';
}

function syncDesktopSettingsPairToggle(id, active, attr) {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    toggle.setAttribute('data-active', active);
    toggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset[attr] === active);
    });
}

function syncImageGenerationSettingsUI() {
    const s = imageGenerationSettingsState;
    syncDesktopSettingsToggle('desktopSettingsStreamImageGenerationBtn', s.streamImageGeneration);
    syncDesktopSettingsToggle('desktopSettingsShowStreamedUnprocessedBtn', s.showStreamedImagesUnprocessed);
    syncDesktopSettingsToggle('desktopSettingsSimpleOutputViewerBtn', s.simpleOutputViewer);
    syncDesktopSettingsToggle('desktopSettingsLockOutputViewerCameraBtn', s.lockOutputViewerCamera);
    syncDesktopSettingsToggle('desktopSettingsReducedPreviewBtn', s.reducedMotion);
    syncDesktopSettingsToggle('desktopSettingsHideQuickstartGalleryBtn', s.hideQuickstartGallery);
    syncDesktopSettingsToggle('desktopSettingsPersistHistoryBtn', s.persistHistory);
    syncDesktopSettingsToggle('desktopSettingsAutomaticDownloadBtn', s.automaticDownload);
    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (hideGalleryBtn) {
        hideGalleryBtn.dataset.state = s.hideQuickstartGallery ? 'on' : 'off';
    }
    syncDesktopSettingsPairToggle('desktopSettingsImageFormatToggle', s.imageFormat, 'format');
    syncDesktopSettingsPairToggle('desktopSettingsAlphaModeToggle', s.alphaMode, 'alpha');
    const swatches = document.getElementById('desktopSettingsTransparencySwatches');
    if (swatches) {
        swatches.querySelectorAll('[data-bg]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.bg === s.transparencyBackground);
        });
    }
    const custom = document.getElementById('desktopSettingsTransparencyCustomColor');
    if (custom) custom.value = s.transparencyCustomColor;
    const customWrap = custom && custom.closest('.studio-transparency-custom');
    if (customWrap) {
        customWrap.classList.toggle('active', s.transparencyBackground === 'custom');
    }
}

function applyImageGenerationSettingsToClient(settings) {
    imageGenerationSettingsState = normalizeImageGenerationSettingsClient(settings);
    applyImageGenerationPreviewChrome();
    syncImageGenerationSettingsUI();
    refreshManualQuickstartGallery();
}

async function persistImageGenerationSettingsPatch(patch) {
    applyImageGenerationSettingsToClient({ ...imageGenerationSettingsState, ...patch });
    // persistUserGlobalSettingsPatch: public/scripts/comp/modalUtils.js
    await persistUserGlobalSettingsPatch({ imageGeneration: { ...imageGenerationSettingsState } });
}

function listQuickstartPresetsFromCache() {
    const rows = [];
    if (quickstartGalleryItems && quickstartGalleryItems.length) {
        return quickstartGalleryItems;
    }
    if (presetData && typeof presetData === 'object') {
        Object.keys(presetData).forEach((key) => {
            const preset = presetData[key] || {};
            rows.push({
                name: preset.name || key,
                key,
                uuid: preset.uuid || '',
                prompt: preset.prompt || ''
            });
        });
    }
    return rows;
}

async function loadQuickstartPresets() {
    if (quickstartGalleryItems) return quickstartGalleryItems;
    if (quickstartGalleryLoadPromise) return quickstartGalleryLoadPromise;
    quickstartGalleryLoadPromise = (async () => {
        const cached = listQuickstartPresetsFromCache();
        if (cached.length) {
            quickstartGalleryItems = cached;
            return cached;
        }
        if (!wsClient || !wsClient.isConnected()) {
            return [];
        }
        const result = await wsClient.getPresets(1, 12, '');
        const presets = result && result.presets ? result.presets : {};
        const rows = Object.keys(presets).map((key) => {
            const preset = presets[key] || {};
            return {
                name: preset.name || key,
                key,
                uuid: preset.uuid || '',
                prompt: preset.prompt || ''
            };
        });
        quickstartGalleryItems = rows;
        return rows;
    })().finally(() => {
        quickstartGalleryLoadPromise = null;
    });
    return quickstartGalleryLoadPromise;
}

function renderManualQuickstartCards(rows) {
    const grid = document.getElementById('manualQuickstartGrid');
    if (!grid) return;
    grid.innerHTML = '';
    rows.forEach((row) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'manual-quickstart-card';
        card.dataset.presetName = row.key || row.name;
        if (row.uuid) card.dataset.presetUuid = row.uuid;

        const name = document.createElement('span');
        name.className = 'manual-quickstart-card-name';
        name.textContent = row.name || row.key;

        const prompt = document.createElement('span');
        prompt.className = 'manual-quickstart-card-prompt';
        prompt.textContent = row.prompt || 'No prompt saved';

        card.appendChild(name);
        card.appendChild(prompt);
        card.addEventListener('click', () => {
            // openManualModalWithContent: public/scripts/comp/manualModalManager.js
            const content = { type: 'preset' };
            if (row.uuid) content.uuid = row.uuid;
            else content.name = row.key || row.name;
            openManualModalWithContent(content);
        });
        grid.appendChild(card);
    });
}

async function refreshManualQuickstartGallery() {
    const placeholder = document.getElementById('manualPreviewPlaceholder');
    const gallery = document.getElementById('manualQuickstartGallery');
    const fallback = document.getElementById('manualQuickstartFallback');
    if (!placeholder || !gallery || !fallback) return;

    const showGallery = shouldShowManualQuickstartGallery();
    placeholder.classList.toggle('has-quickstart', showGallery);

    if (!showGallery) {
        gallery.classList.add('hidden');
        fallback.classList.remove('hidden');
        return;
    }

    let rows = [];
    try {
        rows = await loadQuickstartPresets();
    } catch (error) {
        console.warn('Quickstart gallery presets failed', error);
        rows = [];
    }

    if (!shouldShowManualQuickstartGallery()) {
        gallery.classList.add('hidden');
        fallback.classList.remove('hidden');
        placeholder.classList.remove('has-quickstart');
        return;
    }

    if (!rows.length) {
        gallery.classList.add('hidden');
        fallback.classList.remove('hidden');
        placeholder.classList.remove('has-quickstart');
        return;
    }

    renderManualQuickstartCards(rows);
    gallery.classList.remove('hidden');
    fallback.classList.add('hidden');
    placeholder.classList.add('has-quickstart');
}

function invalidateManualQuickstartGallery() {
    quickstartGalleryItems = null;
}

const STUDIO_LAST_PREVIEW_LS = 'studioLastPreviewFilename';

function rememberLastStudioPreview(filename) {
    if (!filename || !imageGenerationSettingsState.persistHistory) return;
    try {
        localStorage.setItem(STUDIO_LAST_PREVIEW_LS, String(filename));
    } catch (_err) { /* */ }
}

function readLastStudioPreviewFilename() {
    try {
        return localStorage.getItem(STUDIO_LAST_PREVIEW_LS) || '';
    } catch (_err) {
        return '';
    }
}

function isStudioStreamEnabled() {
    return imageGenerationSettingsState.streamImageGeneration !== false;
}

function isStudioStreamUnprocessed() {
    return imageGenerationSettingsState.showStreamedImagesUnprocessed === true
        || imageGenerationSettingsState.reducedMotion === true;
}

function isStudioViewerCameraLocked() {
    return imageGenerationSettingsState.lockOutputViewerCamera === true;
}

function isStudioReducedPreview() {
    return imageGenerationSettingsState.reducedMotion === true;
}

function studioPreviewDownloadName(filename, format) {
    const base = String(filename || `generated-image-${Date.now()}`).replace(/\.(png|webp|jpe?g)$/i, '');
    return `${base}.${format === 'webp' ? 'webp' : 'png'}`;
}

function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (_err) { /* */ }
    }, 1000);
}

function premultiplyImageData(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        d[i] = Math.round(d[i] * a);
        d[i + 1] = Math.round(d[i + 1] * a);
        d[i + 2] = Math.round(d[i + 2] * a);
    }
    return imageData;
}

async function convertStudioDownloadBlob(blob, settings) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.drawImage(bitmap, 0, 0);
    if (settings.alphaMode === 'premultiplied') {
        ctx.putImageData(premultiplyImageData(ctx.getImageData(0, 0, canvas.width, canvas.height)), 0, 0);
    }
    const mime = settings.imageFormat === 'webp' ? 'image/webp' : 'image/png';
    const quality = settings.imageFormat === 'webp' ? 1 : undefined;
    const out = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    return out || blob;
}

async function downloadStudioPreviewWithPrefs(imageLike) {
    const settings = imageGenerationSettingsState;
    const previewImage = document.getElementById('manualPreviewImage');
    let filename = '';
    let url = '';
    if (imageLike && typeof imageLike === 'object') {
        filename = imageLike.filename || imageLike.upscaled || imageLike.original || '';
        url = imageLike.url || '';
    } else if (typeof imageLike === 'string') {
        filename = imageLike;
    }
    if (!url && previewImage && previewImage.dataset.blobUrl) {
        url = previewImage.dataset.blobUrl;
        if (!filename) filename = studioPreviewDownloadName('generated-image', settings.imageFormat);
    }
    if (!url && filename) {
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        url = `${localGalleryImageUrl(filename)}?download=true`;
    }
    if (!url) return false;
    const response = await fetch(url);
    if (!response.ok) return false;
    let blob = await response.blob();
    const needsConvert = settings.imageFormat === 'webp' || settings.alphaMode === 'premultiplied';
    if (needsConvert) {
        blob = await convertStudioDownloadBlob(blob, settings);
    }
    triggerBlobDownload(blob, studioPreviewDownloadName(filename || 'generated-image', settings.imageFormat));
    return true;
}

async function maybeAutoDownloadStudioPreview(imageLike) {
    if (!imageGenerationSettingsState.automaticDownload) return;
    try {
        await downloadStudioPreviewWithPrefs(imageLike);
    } catch (error) {
        console.warn('Automatic Studio download failed', error);
    }
}

async function maybeRestoreLastStudioPreview() {
    if (studioPreviewRestoreInFlight) return false;
    if (!imageGenerationSettingsState.persistHistory) return false;
    if (isManualPreviewImageLoaded()) return false;
    const filename = readLastStudioPreviewFilename();
    if (!filename) return false;
    const images = allImages || [];
    const image = images.find((img) =>
        img.filename === filename || img.original === filename || img.upscaled === filename
    ) || { filename, original: filename };
    studioPreviewRestoreInFlight = true;
    try {
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        await openManualModalWithContent({ type: 'image', image });
        return true;
    } finally {
        studioPreviewRestoreInFlight = false;
    }
}

function wireImageGenerationBooleanToggle(id, key) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
        void persistImageGenerationSettingsPatch({ [key]: btn.dataset.state !== 'on' });
    });
}

function wireImageGenerationSettingsControls() {
    if (imageGenerationSettingsWired) return;
    imageGenerationSettingsWired = true;

    wireImageGenerationBooleanToggle('desktopSettingsStreamImageGenerationBtn', 'streamImageGeneration');
    wireImageGenerationBooleanToggle('desktopSettingsShowStreamedUnprocessedBtn', 'showStreamedImagesUnprocessed');
    wireImageGenerationBooleanToggle('desktopSettingsSimpleOutputViewerBtn', 'simpleOutputViewer');
    wireImageGenerationBooleanToggle('desktopSettingsLockOutputViewerCameraBtn', 'lockOutputViewerCamera');
    wireImageGenerationBooleanToggle('desktopSettingsReducedPreviewBtn', 'reducedMotion');
    wireImageGenerationBooleanToggle('desktopSettingsHideQuickstartGalleryBtn', 'hideQuickstartGallery');
    wireImageGenerationBooleanToggle('desktopSettingsPersistHistoryBtn', 'persistHistory');
    wireImageGenerationBooleanToggle('desktopSettingsAutomaticDownloadBtn', 'automaticDownload');

    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (hideGalleryBtn) {
        hideGalleryBtn.addEventListener('click', () => {
            void persistImageGenerationSettingsPatch({ hideQuickstartGallery: true });
        });
    }

    const formatToggle = document.getElementById('desktopSettingsImageFormatToggle');
    if (formatToggle) {
        formatToggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                void persistImageGenerationSettingsPatch({
                    imageFormat: normalizeImageGenerationFormatClient(btn.dataset.format)
                });
            });
        });
    }

    const alphaToggle = document.getElementById('desktopSettingsAlphaModeToggle');
    if (alphaToggle) {
        alphaToggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                void persistImageGenerationSettingsPatch({
                    alphaMode: normalizeImageGenerationAlphaModeClient(btn.dataset.alpha)
                });
            });
        });
    }

    const swatches = document.getElementById('desktopSettingsTransparencySwatches');
    if (swatches) {
        swatches.querySelectorAll('[data-bg]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void persistImageGenerationSettingsPatch({
                    transparencyBackground: normalizeImageGenerationTransparencyBackgroundClient(btn.dataset.bg)
                });
            });
        });
    }
    const custom = document.getElementById('desktopSettingsTransparencyCustomColor');
    if (custom) {
        custom.addEventListener('input', () => {
            void persistImageGenerationSettingsPatch({
                transparencyBackground: 'custom',
                transparencyCustomColor: normalizeImageGenerationCustomColorClient(custom.value)
            });
        });
    }
}

function initImageGenerationSettings() {
    wireImageGenerationSettingsControls();
    applyImageGenerationPreviewChrome();
    syncImageGenerationSettingsUI();
    if (wsClient && wsClient.on) {
        wsClient.on('preset_updated', () => {
            invalidateManualQuickstartGallery();
            refreshManualQuickstartGallery();
        });
    }
    refreshManualQuickstartGallery();
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(471.5, 'Studio quickstart gallery', async () => {
        initImageGenerationSettings();
    });
}
