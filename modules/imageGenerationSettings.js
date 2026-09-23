/**
 * Studio / Image Generation user prefs.
 * Persisted in config.userGlobalSettings.imageGeneration.
 * NAI web User Settings → Image Generation parity (Dreamscape voice).
 */

const TRANSPARENCY_BACKGROUNDS = new Set([
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

const IMAGE_FORMATS = new Set(['png', 'webp']);
const ALPHA_MODES = new Set(['straight', 'premultiplied']);

const DEFAULT_IMAGE_GENERATION_SETTINGS = {
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

function asBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    return fallback;
}

function normalizeTransparencyBackground(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_]+/g, '-');
    if (TRANSPARENCY_BACKGROUNDS.has(value)) return value;
    if (value === 'checker' || value === 'checkerboard') return 'checker-dark';
    return DEFAULT_IMAGE_GENERATION_SETTINGS.transparencyBackground;
}

function normalizeTransparencyCustomColor(raw) {
    const value = String(raw || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
        const r = value[1];
        const g = value[2];
        const b = value[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return DEFAULT_IMAGE_GENERATION_SETTINGS.transparencyCustomColor;
}

function normalizeImageFormat(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'webp' || value === 'webplossless') return 'webp';
    if (value === 'png') return 'png';
    return DEFAULT_IMAGE_GENERATION_SETTINGS.imageFormat;
}

function normalizeAlphaMode(raw) {
    const value = String(raw || '').toLowerCase();
    if (ALPHA_MODES.has(value)) return value;
    return DEFAULT_IMAGE_GENERATION_SETTINGS.alphaMode;
}

function normalizeImageGenerationSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        streamImageGeneration: asBoolean(src.streamImageGeneration, DEFAULT_IMAGE_GENERATION_SETTINGS.streamImageGeneration),
        showStreamedImagesUnprocessed: asBoolean(
            src.showStreamedImagesUnprocessed,
            DEFAULT_IMAGE_GENERATION_SETTINGS.showStreamedImagesUnprocessed
        ),
        simpleOutputViewer: asBoolean(src.simpleOutputViewer, DEFAULT_IMAGE_GENERATION_SETTINGS.simpleOutputViewer),
        lockOutputViewerCamera: asBoolean(src.lockOutputViewerCamera, DEFAULT_IMAGE_GENERATION_SETTINGS.lockOutputViewerCamera),
        reducedMotion: asBoolean(src.reducedMotion, DEFAULT_IMAGE_GENERATION_SETTINGS.reducedMotion),
        transparencyBackground: normalizeTransparencyBackground(src.transparencyBackground),
        transparencyCustomColor: normalizeTransparencyCustomColor(src.transparencyCustomColor),
        hideQuickstartGallery: asBoolean(src.hideQuickstartGallery, DEFAULT_IMAGE_GENERATION_SETTINGS.hideQuickstartGallery),
        persistHistory: asBoolean(src.persistHistory, DEFAULT_IMAGE_GENERATION_SETTINGS.persistHistory),
        imageFormat: normalizeImageFormat(src.imageFormat),
        automaticDownload: asBoolean(src.automaticDownload, DEFAULT_IMAGE_GENERATION_SETTINGS.automaticDownload),
        alphaMode: normalizeAlphaMode(src.alphaMode)
    };
}

function mergeImageGenerationSettingsPatch(existing, patch) {
    const out = normalizeImageGenerationSettings(existing);
    if (!patch || typeof patch !== 'object') return out;
    if (typeof patch.streamImageGeneration === 'boolean') {
        out.streamImageGeneration = patch.streamImageGeneration;
    }
    if (typeof patch.showStreamedImagesUnprocessed === 'boolean') {
        out.showStreamedImagesUnprocessed = patch.showStreamedImagesUnprocessed;
    }
    if (typeof patch.simpleOutputViewer === 'boolean') {
        out.simpleOutputViewer = patch.simpleOutputViewer;
    }
    if (typeof patch.lockOutputViewerCamera === 'boolean') {
        out.lockOutputViewerCamera = patch.lockOutputViewerCamera;
    }
    if (typeof patch.reducedMotion === 'boolean') {
        out.reducedMotion = patch.reducedMotion;
    }
    if (patch.transparencyBackground != null) {
        out.transparencyBackground = normalizeTransparencyBackground(patch.transparencyBackground);
    }
    if (patch.transparencyCustomColor != null) {
        out.transparencyCustomColor = normalizeTransparencyCustomColor(patch.transparencyCustomColor);
    }
    if (typeof patch.hideQuickstartGallery === 'boolean') {
        out.hideQuickstartGallery = patch.hideQuickstartGallery;
    }
    if (typeof patch.persistHistory === 'boolean') {
        out.persistHistory = patch.persistHistory;
    }
    if (patch.imageFormat != null) {
        out.imageFormat = normalizeImageFormat(patch.imageFormat);
    }
    if (typeof patch.automaticDownload === 'boolean') {
        out.automaticDownload = patch.automaticDownload;
    }
    if (patch.alphaMode != null) {
        out.alphaMode = normalizeAlphaMode(patch.alphaMode);
    }
    return out;
}

function readImageGenerationSettings(globalResources) {
    let raw = null;
    try {
        const config = globalResources && globalResources.getConfig
            ? globalResources.getConfig()
            : null;
        raw = config && config.userGlobalSettings && config.userGlobalSettings.imageGeneration;
    } catch (_err) {
        raw = null;
    }
    return normalizeImageGenerationSettings(raw);
}

module.exports = {
    DEFAULT_IMAGE_GENERATION_SETTINGS,
    TRANSPARENCY_BACKGROUNDS,
    IMAGE_FORMATS,
    ALPHA_MODES,
    normalizeTransparencyBackground,
    normalizeTransparencyCustomColor,
    normalizeImageFormat,
    normalizeAlphaMode,
    normalizeImageGenerationSettings,
    mergeImageGenerationSettingsPatch,
    readImageGenerationSettings
};
