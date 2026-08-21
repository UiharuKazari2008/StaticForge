/**
 * Server remote-fetch — local FS → asset registry → HTTPS from masterAccessUrl.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { REPLICATION_ERROR_CODES, canGalleryUseRemoteMaster } = require('./replication/replicationContracts');

let globalResourcesRef = null;
let masterReachableCache = { value: null, expiresAt: 0 };
const REACHABLE_TTL_MS = 15000;

class ReplicationAssetError extends Error {
    constructor(code, payload) {
        super(payload.message || code);
        this.name = 'ReplicationAssetError';
        this.code = code;
        this.payload = payload;
    }
}

function initialize(globalResources) {
    globalResourcesRef = globalResources;
}

function getGlobalResources() {
    if (globalResourcesRef) return globalResourcesRef;
    try {
        const gr = require('./globalResources');
        if (gr.initialized) return gr;
    } catch (_e) {}
    return null;
}

function getReplicationConfig(globalResources) {
    const gr = globalResources || getGlobalResources();
    if (!gr || !gr.getReplicationService) return null;
    return gr.getReplicationService().getReplicationConfig();
}

function isAirgapped(config) {
    return config && config.connectivity === 'airgapped';
}

function getMasterDisplayName(config) {
    if (!config) return 'Master';
    if (config.role === 'master') return config.displayName || 'Master';
    return config.masterDisplayName || config.displayName || config.masterAccessUrl || 'Master';
}

function buildAssetUnavailableError(kind, key, config) {
    const masterDisplayName = getMasterDisplayName(config);
    return new ReplicationAssetError(REPLICATION_ERROR_CODES.ASSET_UNAVAILABLE, {
        code: REPLICATION_ERROR_CODES.ASSET_UNAVAILABLE,
        key: String(key),
        kind,
        masterDisplayName,
        message: `${masterDisplayName} is unreachable — asset not available locally`
    });
}

function resolveLocalPath(globalResources, kind, key) {
    const gr = globalResources || getGlobalResources();
    if (!gr || !key) return null;

    switch (kind) {
        case 'gallery-image':
            return path.join(gr.getPath('images'), key);
        case 'gallery-preview': {
            const previewName = key.endsWith('.webp') ? key : `${key}.webp`;
            const galleryPreview = path.join(gr.getPath('previews'), previewName);
            if (fs.existsSync(galleryPreview)) return galleryPreview;
            return path.join(gr.getPath('previewCache'), previewName);
        }
        case 'reference-upload':
            return path.join(gr.getPath('uploadCache'), key);
        case 'reference-preview': {
            const previewName = key.endsWith('.webp') ? key : `${key}.webp`;
            return path.join(gr.getPath('previewCache'), previewName);
        }
        case 'vibe': {
            const vibeName = key.endsWith('.json') ? key : `${key}.json`;
            return path.join(gr.getPath('vibeCache'), vibeName);
        }
        case 'vfs-file':
            return path.join(gr.getPath('userFiles'), key);
        case 'wiki-media':
            return path.join(gr.getPath('cache'), key);
        default:
            return null;
    }
}

function localFileExists(globalResources, kind, key) {
    const localPath = resolveLocalPath(globalResources, kind, key);
    return !!(localPath && fs.existsSync(localPath));
}

function buildRemoteAssetUrl(masterAccessUrl, kind, key) {
    const base = String(masterAccessUrl).replace(/\/$/, '');
    const segments = String(key).split('/').map((part) => encodeURIComponent(part));
    return `${base}/replication/assets/${encodeURIComponent(kind)}/${segments.join('/')}`;
}

function httpRequestBuffer(urlStr, { headers = {}, timeoutMs = 30000, method = 'GET' } = {}) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(urlStr);
        } catch (err) {
            reject(err);
            return;
        }

        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(parsed, { method, headers, timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({ buffer: Buffer.concat(chunks), headers: res.headers }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
        req.end();
    });
}

function invalidateMasterReachableCache() {
    masterReachableCache = { value: null, expiresAt: 0 };
}

async function probeMasterReachable(force = false, globalResources = null) {
    const config = getReplicationConfig(globalResources);
    if (!canGalleryUseRemoteMaster(config)) {
        return false;
    }

    const now = Date.now();
    if (!force && masterReachableCache.expiresAt > now) {
        return masterReachableCache.value === true;
    }

    try {
        const url = `${String(config.masterAccessUrl).replace(/\/$/, '')}/replication/status`;
        const headers = { 'User-Agent': 'StaticForge-Replication/1.0' };
        if (config.replicationToken) {
            headers['X-Replication-Token'] = config.replicationToken;
        }
        await httpRequestBuffer(url, { headers, timeoutMs: 8000 });
        masterReachableCache = { value: true, expiresAt: now + REACHABLE_TTL_MS };
        return true;
    } catch (_err) {
        masterReachableCache = { value: false, expiresAt: now + REACHABLE_TTL_MS };
        return false;
    }
}

async function fetchRemoteBuffer(kind, key, config) {
    const url = buildRemoteAssetUrl(config.masterAccessUrl, kind, key);
    const headers = { 'User-Agent': 'StaticForge-Replication/1.0' };
    if (config.replicationToken) {
        headers['X-Replication-Token'] = config.replicationToken;
    }
    const { buffer } = await httpRequestBuffer(url, { headers });
    return buffer;
}

async function readAssetBuffer(kind, key, globalResources = null, options = {}) {
    const gr = globalResources || getGlobalResources();
    if (!gr) {
        throw new Error('Global resources not initialized');
    }

    const localPath = resolveLocalPath(gr, kind, key);
    if (localPath && fs.existsSync(localPath)) {
        return {
            buffer: fs.readFileSync(localPath),
            storage: 'local',
            localPath
        };
    }

    const config = getReplicationConfig(gr);
    const registry = gr.getReplicationService().getAssetRegistry();
    const ownership = await registry.getOwnership(kind, key);
    const storage = ownership ? ownership.storage : null;

    if (!options.forceRemote && storage !== 'remote' && storage !== 'pending-fetch') {
        throw buildAssetUnavailableError(kind, key, config);
    }

    if (isAirgapped(config)) {
        throw buildAssetUnavailableError(kind, key, config);
    }

    const reachable = await probeMasterReachable(false, gr);
    if (!reachable) {
        throw buildAssetUnavailableError(kind, key, config);
    }

    await registry.markPendingFetch(kind, key);

    try {
        const buffer = await fetchRemoteBuffer(kind, key, config);
        if (options.cacheToLocal && localPath) {
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(localPath, buffer);
            await registry.promoteToLocal(kind, key);
        }
        return { buffer, storage: 'remote', localPath: options.cacheToLocal ? localPath : null };
    } catch (_err) {
        throw buildAssetUnavailableError(kind, key, config);
    }
}

function sendReplicationAssetError(handlers, ws, error, requestId, fallbackType) {
    if (error instanceof ReplicationAssetError) {
        handlers.sendToClient(ws, {
            type: 'error',
            requestId: requestId || null,
            code: error.code,
            message: error.message,
            data: error.payload,
            errorType: fallbackType || 'replication_asset',
            timestamp: new Date().toISOString()
        });
        return;
    }
    handlers.sendError(ws, error.message || 'Asset unavailable', error.message, requestId);
}

function shouldShowSharedGallery(config, sessionEnabled) {
    if (!config || !config.masterAccessUrl) return false;
    if (config.connectivity === 'airgapped') return false;
    const mode = config.gallerySharedDefault || 'manual';
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return sessionEnabled === true;
}

function shouldShowReplicationBanner(config, masterReachable) {
    if (!config) return false;
    if (config.connectivity === 'airgapped') return false;
    if (config.role === 'standalone') return false;
    if (config.role !== 'child' && config.role !== 'ephemeral') return false;
    if (config.connectivity !== 'normal') return false;
    return masterReachable !== true;
}

function buildReplicationContext(config, masterReachable, showSharedRemote) {
    if (!config || !config.masterAccessUrl) return null;
    return {
        masterAccessUrl: config.masterAccessUrl,
        masterDisplayName: getMasterDisplayName(config),
        masterReachable: masterReachable === true,
        gallerySharedDefault: config.gallerySharedDefault || 'manual',
        showSharedRemote: showSharedRemote === true,
        role: config.role,
        connectivity: config.connectivity,
        assetReadToken: config.replicationReadToken || config.replicationToken || null
    };
}

module.exports = {
    initialize,
    ReplicationAssetError,
    buildAssetUnavailableError,
    resolveLocalPath,
    localFileExists,
    buildRemoteAssetUrl,
    httpRequestBuffer,
    probeMasterReachable,
    readAssetBuffer,
    sendReplicationAssetError,
    shouldShowSharedGallery,
    shouldShowReplicationBanner,
    buildReplicationContext,
    invalidateMasterReachableCache,
    getMasterDisplayName
};
