/**
 * Remote Access (MCP) user defaults.
 * Persisted in config.userGlobalSettings.remoteAccess.
 */

const DEFAULT_REMOTE_ACCESS_SETTINGS = {
    defaultGenerationMethod: 'studio',
    autoGenerate: false,
    openGeneratedImages: 'ledge',
    minPrintsPerTurn: 1,
    maxPrintsPerTurn: 8
};

function normalizeDefaultGenerationMethod(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'auto') return 'auto';
    if (value === 'detached' || value === 'detachedrequest' || value === 'generateimage') {
        return 'detached';
    }
    return 'studio';
}

function normalizeOpenGeneratedImages(raw) {
    const value = String(raw || '').toLowerCase();
    if (value === 'ledge') return 'ledge';
    if (value === 'glancewell') return 'glancewell';
    if (value === 'lumen') return 'lumen';
    if (value === 'disabled' || value === 'off' || value === 'none') return 'disabled';
    return 'ledge';
}

function normalizePrintsPerTurn(raw, fallback) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(8, Math.max(1, Math.round(n)));
}

function normalizeRemoteAccessSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    let minPrintsPerTurn = normalizePrintsPerTurn(src.minPrintsPerTurn, DEFAULT_REMOTE_ACCESS_SETTINGS.minPrintsPerTurn);
    let maxPrintsPerTurn = normalizePrintsPerTurn(src.maxPrintsPerTurn, DEFAULT_REMOTE_ACCESS_SETTINGS.maxPrintsPerTurn);
    if (maxPrintsPerTurn < minPrintsPerTurn) maxPrintsPerTurn = minPrintsPerTurn;
    return {
        defaultGenerationMethod: normalizeDefaultGenerationMethod(src.defaultGenerationMethod),
        autoGenerate: src.autoGenerate === true,
        openGeneratedImages: normalizeOpenGeneratedImages(src.openGeneratedImages),
        minPrintsPerTurn,
        maxPrintsPerTurn
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
    if (patch.minPrintsPerTurn != null) out.minPrintsPerTurn = normalizePrintsPerTurn(patch.minPrintsPerTurn, out.minPrintsPerTurn);
    if (patch.maxPrintsPerTurn != null) out.maxPrintsPerTurn = normalizePrintsPerTurn(patch.maxPrintsPerTurn, out.maxPrintsPerTurn);
    if (out.maxPrintsPerTurn < out.minPrintsPerTurn) out.maxPrintsPerTurn = out.minPrintsPerTurn;
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

function clampTurnPrints(settings, n) {
    const bounds = normalizeRemoteAccessSettings(settings);
    let value = n == null || n === '' ? bounds.minPrintsPerTurn : Number(n);
    if (!Number.isFinite(value) || value < 1) value = bounds.minPrintsPerTurn;
    if (value < bounds.minPrintsPerTurn) value = bounds.minPrintsPerTurn;
    if (value > bounds.maxPrintsPerTurn) value = bounds.maxPrintsPerTurn;
    return Math.min(8, Math.max(1, Math.round(value)));
}

module.exports = {
    DEFAULT_REMOTE_ACCESS_SETTINGS,
    normalizeDefaultGenerationMethod,
    normalizeOpenGeneratedImages,
    normalizeRemoteAccessSettings,
    mergeRemoteAccessSettingsPatch,
    readRemoteAccessSettings,
    clampTurnPrints
};
