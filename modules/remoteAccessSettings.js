/**
 * Remote Access (MCP) user defaults.
 * Persisted in config.userGlobalSettings.remoteAccess.
 */

const DEFAULT_REMOTE_ACCESS_SETTINGS = {
    defaultGenerationMethod: 'studio',
    autoGenerate: false,
    openGeneratedImages: 'lumen'
};

function normalizeDefaultGenerationMethod(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'detached' || value === 'detachedrequest' || value === 'generateimage') {
        return 'detached';
    }
    return 'studio';
}

function normalizeOpenGeneratedImages(raw) {
    const value = String(raw || '').toLowerCase();
    if (value === 'glancewell') return 'glancewell';
    if (value === 'disabled' || value === 'off' || value === 'none') return 'disabled';
    return 'lumen';
}

function normalizeRemoteAccessSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        defaultGenerationMethod: normalizeDefaultGenerationMethod(src.defaultGenerationMethod),
        autoGenerate: src.autoGenerate === true,
        openGeneratedImages: normalizeOpenGeneratedImages(src.openGeneratedImages)
    };
}

function mergeRemoteAccessSettingsPatch(existing, patch) {
    const out = normalizeRemoteAccessSettings(existing);
    if (!patch || typeof patch !== 'object') return out;
    if (patch.defaultGenerationMethod != null) {
        out.defaultGenerationMethod = normalizeDefaultGenerationMethod(patch.defaultGenerationMethod);
    }
    if (typeof patch.autoGenerate === 'boolean') {
        out.autoGenerate = patch.autoGenerate;
    }
    if (patch.openGeneratedImages != null) {
        out.openGeneratedImages = normalizeOpenGeneratedImages(patch.openGeneratedImages);
    }
    return out;
}

function readRemoteAccessSettings(globalResources) {
    let raw = null;
    try {
        const config = globalResources && typeof globalResources.getConfig === 'function'
            ? globalResources.getConfig()
            : null;
        raw = config && config.userGlobalSettings && config.userGlobalSettings.remoteAccess;
    } catch (_err) {
        raw = null;
    }
    return normalizeRemoteAccessSettings(raw);
}

module.exports = {
    DEFAULT_REMOTE_ACCESS_SETTINGS,
    normalizeDefaultGenerationMethod,
    normalizeOpenGeneratedImages,
    normalizeRemoteAccessSettings,
    mergeRemoteAccessSettingsPatch,
    readRemoteAccessSettings
};
