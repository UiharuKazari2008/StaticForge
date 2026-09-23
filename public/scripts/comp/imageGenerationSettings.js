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
}

function syncImageGenerationSettingsUI() {
    const hideBtn = document.getElementById('desktopSettingsHideQuickstartGalleryBtn');
    if (hideBtn) {
        hideBtn.dataset.state = imageGenerationSettingsState.hideQuickstartGallery ? 'on' : 'off';
    }
    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (hideGalleryBtn) {
        hideGalleryBtn.dataset.state = imageGenerationSettingsState.hideQuickstartGallery ? 'on' : 'off';
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

function wireImageGenerationSettingsControls() {
    if (imageGenerationSettingsWired) return;
    imageGenerationSettingsWired = true;

    const hideBtn = document.getElementById('desktopSettingsHideQuickstartGalleryBtn');
    if (hideBtn) {
        hideBtn.addEventListener('click', () => {
            void persistImageGenerationSettingsPatch({
                hideQuickstartGallery: hideBtn.dataset.state !== 'on'
            });
        });
    }

    const hideGalleryBtn = document.getElementById('manualQuickstartHideBtn');
    if (hideGalleryBtn) {
        hideGalleryBtn.addEventListener('click', () => {
            void persistImageGenerationSettingsPatch({ hideQuickstartGallery: true });
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
