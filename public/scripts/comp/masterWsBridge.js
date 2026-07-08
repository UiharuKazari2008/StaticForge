/**
 * Master WebSocket delegation bridge — wiki/autocomplete when cloneProfile omits local data.
 * assetUrlResolver.js, replicationGalleryBanner.js
 */

/** Mirrors modules/replication/replicationContracts.js REPLICATION_DELEGATED_PACKETS */
const REPLICATION_DELEGATED_PACKETS = {
    search_tag_wiki: 'wikiData',
    get_tag_wiki_page: 'wikiData',
    resolve_grimoire_url: 'wikiData',
    search_tags: 'autoComplete',
    search_characters: 'autoComplete',
    get_tag_autofill: 'autoComplete'
};

const STATIC_WIKI_DELEGATED_PACKETS = {
    get_wiki_home: 'wikiData',
    get_static_wiki_site_index: 'wikiData',
    get_static_wiki_page: 'wikiData'
};

const AUTOFILL_ACKLESS_PACKETS = {
    search_characters: 'autoComplete',
    fetch_autofill_wiki_previews: 'autoComplete'
};

const DEFAULT_CLONE_PROFILE = {
    wikiData: true,
    wikiMedia: false,
    autoComplete: true,
    workspaceImages: false,
    previewCache: true,
    imageMetadata: true
};

const MASTER_AUTH_TIMEOUT_MS = 15000;
const MASTER_REQUEST_TIMEOUT_MS = 120000;
const MASTER_RECONNECT_DELAY_MS = 5000;

let localWsClient = null;
let masterWs = null;
let masterAuthenticated = false;
let masterConnecting = false;
let bridgeInitialized = false;
let replicationConfig = null;
let masterPendingRequests = new Map();
let wrappedMethods = null;
let reconnectTimer = null;

function getDelegatedPacketMap() {
    return {
        ...REPLICATION_DELEGATED_PACKETS,
        ...STATIC_WIKI_DELEGATED_PACKETS,
        ...AUTOFILL_ACKLESS_PACKETS
    };
}

function isAllowedMasterBridgePacket(packetType) {
    return Object.prototype.hasOwnProperty.call(getDelegatedPacketMap(), packetType);
}

function getServiceKeyForPacket(packetType) {
    return getDelegatedPacketMap()[packetType] || null;
}

function shouldDelegatePacket(packetType) {
    if (!packetType || !replicationConfig) return false;
    if (replicationConfig.connectivity === 'airgapped') return false;

    const serviceKey = getServiceKeyForPacket(packetType);
    if (!serviceKey) return false;

    const profile = replicationConfig.cloneProfile || DEFAULT_CLONE_PROFILE;
    return profile[serviceKey] !== true;
}

function buildMasterWsUrl(config) {
    if (!config) return null;
    if (config.masterWsUrl) {
        return String(config.masterWsUrl).replace(/\/$/, '');
    }
    if (!config.masterAccessUrl) return null;
    try {
        const url = new URL(config.masterAccessUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch (_e) {
        return null;
    }
}

function canAttemptDirectMasterBridge(config) {
    if (!config || config.connectivity === 'airgapped') return false;
    const masterUrl = buildMasterWsUrl(config);
    if (!masterUrl || !config.replicationToken) return false;
    return true;
}

function resolveDelegationServiceStatus(serviceKey) {
    if (!replicationConfig) return 'unavailable';
    const profile = replicationConfig.cloneProfile || DEFAULT_CLONE_PROFILE;
    if (profile[serviceKey] === true) return 'local';
    if (replicationConfig.connectivity === 'airgapped') return 'unavailable';
    if (!replicationConfig.masterWsUrl && !replicationConfig.masterAccessUrl) return 'unavailable';
    if (masterAuthenticated && masterWs && masterWs.readyState === WebSocket.OPEN) {
        return 'delegated';
    }
    if (canAttemptDirectMasterBridge(replicationConfig)) {
        return 'disconnected';
    }
    return 'unavailable';
}

function buildDelegationStatusPatch() {
    return {
        wikiData: resolveDelegationServiceStatus('wikiData'),
        autoComplete: resolveDelegationServiceStatus('autoComplete'),
        wikiMedia: resolveDelegationServiceStatus('wikiMedia'),
        masterWsConnected: !!(masterAuthenticated && masterWs && masterWs.readyState === WebSocket.OPEN)
    };
}

function reportDelegationStatus() {
    if (!localWsClient || !localWsClient.isConnected || !localWsClient.isConnected()) return;
    const patch = buildDelegationStatusPatch();
    localWsClient.send({
        type: 'replication_delegation_status',
        data: patch
    });
}

async function probeMasterReachable(config) {
    if (!config || !config.masterAccessUrl || config.connectivity === 'airgapped') {
        return false;
    }
    try {
        const base = String(config.masterAccessUrl).replace(/\/$/, '');
        const url = `${base}/replication/status`;
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'omit',
            headers: config.replicationToken
                ? { 'X-Replication-Token': config.replicationToken }
                : {}
        });
        return response.ok;
    } catch (_e) {
        return false;
    }
}

function applyGalleryReplicationClientContext(config, masterReachable) {
    if (!config || config.connectivity === 'airgapped' || !config.masterAccessUrl) {
        applyGalleryReplicationContext(null);
        if (typeof hideReplicationGalleryBanner === 'function') {
            hideReplicationGalleryBanner();
        }
        return;
    }

    // applyGalleryReplicationContext: public/scripts/comp/assetUrlResolver.js
    applyGalleryReplicationContext({
        masterAccessUrl: config.masterAccessUrl,
        masterDisplayName: config.displayName || config.masterAccessUrl,
        masterReachable: masterReachable === true,
        gallerySharedDefault: config.gallerySharedDefault || 'manual',
        role: config.role,
        connectivity: config.connectivity,
        assetReadToken: config.replicationToken || null
    });
}

function applyWikiMediaContext(config, masterReachable) {
    applyGalleryReplicationClientContext(config, masterReachable);
}

function resolveWikiMediaUrl(relativePath) {
    if (!relativePath || !replicationConfig) return '';
    const profile = replicationConfig.cloneProfile || DEFAULT_CLONE_PROFILE;
    if (profile.wikiMedia === true || replicationConfig.connectivity === 'airgapped') {
        return '';
    }
    // resolveAssetUrl: public/scripts/comp/assetUrlResolver.js
    return resolveAssetUrl('wiki-media', relativePath, { storage: 'remote' });
}

function dispatchAcklessMasterMessage(message) {
    if (!message || !message.type) return;

    if (message.type.startsWith('search_characters_')) {
        // handleSearchResponse: public/scripts/comp/autocompleteUtils.js
        handleSearchResponse(message);
        return;
    }

    if (message.type === 'fetch_autofill_wiki_previews_response') {
        if (localWsClient && typeof localWsClient.triggerEvent === 'function') {
            localWsClient.triggerEvent(message.type, message);
        }
    }
}

function handleMasterSocketMessage(event) {
    let message;
    try {
        message = JSON.parse(event.data);
    } catch (_e) {
        return;
    }
    if (!message || !message.type) return;

    if (message.requestId && masterPendingRequests.has(message.requestId)) {
        const entry = masterPendingRequests.get(message.requestId);
        masterPendingRequests.delete(message.requestId);
        clearTimeout(entry.timeoutId);

        if (message.type === 'error' || message.type === 'auth_error') {
            entry.reject(new Error(message.message || message.code || 'Master bridge error'));
            return;
        }

        const payload = message.data != null ? message.data : message;
        entry.resolve(payload);
        return;
    }

    dispatchAcklessMasterMessage(message);
}

function disconnectMasterBridge() {
    masterAuthenticated = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (masterWs) {
        try {
            masterWs.onopen = null;
            masterWs.onmessage = null;
            masterWs.onclose = null;
            masterWs.onerror = null;
            masterWs.close();
        } catch (_e) {}
    }
    masterWs = null;
    masterConnecting = false;

    for (const [requestId, entry] of masterPendingRequests.entries()) {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error('Master bridge disconnected'));
        masterPendingRequests.delete(requestId);
    }

    reportDelegationStatus();
}

function scheduleMasterReconnect() {
    if (!canAttemptDirectMasterBridge(replicationConfig)) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectMasterBridge().catch(() => {});
    }, MASTER_RECONNECT_DELAY_MS);
}

function authenticateMasterBridge() {
    return new Promise((resolve, reject) => {
        const requestId = `bridge_auth_${Date.now()}`;
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Master bridge authentication timeout'));
        }, MASTER_AUTH_TIMEOUT_MS);

        function cleanup() {
            clearTimeout(timeoutId);
            masterWs.removeEventListener('message', onMessage);
        }

        function onMessage(event) {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (_e) {
                return;
            }
            if (message.requestId !== requestId) return;
            cleanup();

            if (message.type === 'replication_authenticated' && message.data && message.data.success) {
                masterAuthenticated = true;
                reportDelegationStatus();
                resolve();
                return;
            }
            reject(new Error(message.message || message.code || 'Master bridge authentication failed'));
        }

        masterWs.addEventListener('message', onMessage);
        masterWs.send(JSON.stringify({
            type: 'authenticate_replication',
            requestId,
            replicationToken: replicationConfig.replicationToken
        }));
    });
}

async function connectMasterBridge() {
    if (!canAttemptDirectMasterBridge(replicationConfig)) {
        disconnectMasterBridge();
        return false;
    }

    if (masterWs && masterWs.readyState === WebSocket.OPEN && masterAuthenticated) {
        return true;
    }

    if (masterConnecting) {
        return masterConnecting;
    }

    const masterUrl = buildMasterWsUrl(replicationConfig);
    masterConnecting = new Promise((resolve) => {
        disconnectMasterBridge();
        masterWs = new WebSocket(masterUrl);

        const connectTimeout = setTimeout(() => {
            disconnectMasterBridge();
            masterConnecting = false;
            scheduleMasterReconnect();
            resolve(false);
        }, 20000);

        masterWs.onopen = async () => {
            clearTimeout(connectTimeout);
            try {
                await authenticateMasterBridge();
                masterWs.onmessage = handleMasterSocketMessage;
                masterWs.onclose = () => {
                    masterAuthenticated = false;
                    masterWs = null;
                    reportDelegationStatus();
                    scheduleMasterReconnect();
                };
                masterWs.onerror = () => {
                    masterAuthenticated = false;
                    reportDelegationStatus();
                };
                masterConnecting = false;
                resolve(true);
            } catch (_error) {
                disconnectMasterBridge();
                masterConnecting = false;
                scheduleMasterReconnect();
                resolve(false);
            }
        };

        masterWs.onerror = () => {
            clearTimeout(connectTimeout);
            disconnectMasterBridge();
            masterConnecting = false;
            scheduleMasterReconnect();
            resolve(false);
        };
    });

    return masterConnecting;
}

function sendToMasterSocket(packetType, data, requestId) {
    return new Promise((resolve, reject) => {
        if (!isAllowedMasterBridgePacket(packetType)) {
            reject(new Error(`Master bridge read-only: packet not allowed (${packetType})`));
            return;
        }
        if (!masterWs || masterWs.readyState !== WebSocket.OPEN || !masterAuthenticated) {
            reject(new Error('Master bridge not connected'));
            return;
        }

        const effectiveRequestId = requestId || `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const timeoutId = setTimeout(() => {
            masterPendingRequests.delete(effectiveRequestId);
            reject(new Error(`Master bridge timeout for ${packetType}`));
        }, MASTER_REQUEST_TIMEOUT_MS);

        masterPendingRequests.set(effectiveRequestId, { resolve, reject, timeoutId, packetType });

        const outbound = {
            type: packetType,
            requestId: effectiveRequestId,
            ...(data || {})
        };
        delete outbound.delegateType;
        delete outbound.delegatePayload;

        masterWs.send(JSON.stringify(outbound));
    });
}

function sendAcklessToMasterSocket(packetType, data) {
    if (!isAllowedMasterBridgePacket(packetType)) {
        throw new Error(`Master bridge read-only: packet not allowed (${packetType})`);
    }
    if (!masterWs || masterWs.readyState !== WebSocket.OPEN || !masterAuthenticated) {
        throw new Error('Master bridge not connected');
    }
    masterWs.send(JSON.stringify({ type: packetType, ...(data || {}) }));
}

async function delegateThroughLocalServer(packetType, data, requestId) {
    const response = await wrappedMethods.sendMessage.call(
        localWsClient,
        'replication_delegate',
        {
            delegateType: packetType,
            delegatePayload: { ...data, requestId },
            requestId
        },
        false
    );
    if (response && response.response != null) {
        return response.response;
    }
    return response;
}

async function delegatePacket(packetType, data, requestId) {
    if (masterWs && masterWs.readyState === WebSocket.OPEN && masterAuthenticated) {
        if (packetType === 'search_characters' || packetType === 'fetch_autofill_wiki_previews') {
            sendAcklessToMasterSocket(packetType, data);
            return { success: true };
        }
        return sendToMasterSocket(packetType, data, requestId);
    }
    return delegateThroughLocalServer(packetType, data, requestId);
}

function wrapWsClient(wsClient) {
    if (!wsClient || wrappedMethods) return;

    wrappedMethods = {
        sendMessage: wsClient.sendMessage.bind(wsClient),
        sendMessageWithRequestId: wsClient.sendMessageWithRequestId.bind(wsClient),
        sendAcklessMessage: wsClient.sendAcklessMessage.bind(wsClient)
    };

    wsClient.sendMessage = function wrappedSendMessage(type, data, showBanner) {
        if (!shouldDelegatePacket(type)) {
            return wrappedMethods.sendMessage(type, data, showBanner);
        }
        return delegatePacket(type, data || {}, (data && data.requestId) || null);
    };

    wsClient.sendMessageWithRequestId = function wrappedSendMessageWithRequestId(type, requestId, data, showBanner) {
        if (!shouldDelegatePacket(type)) {
            return wrappedMethods.sendMessageWithRequestId(type, requestId, data, showBanner);
        }
        return delegatePacket(type, data || {}, requestId);
    };

    wsClient.sendAcklessMessage = function wrappedSendAcklessMessage(type, data) {
        if (!shouldDelegatePacket(type)) {
            return wrappedMethods.sendAcklessMessage(type, data);
        }
        return delegatePacket(type, data || {}, (data && data.requestId) || null);
    };
}

async function loadReplicationConfig() {
    try {
        const response = await fetch('/replication/delegation/bridge-config', {
            method: 'GET',
            credentials: 'same-origin'
        });
        if (!response.ok) return null;
        const body = await response.json();
        const status = body && body.data ? body.data : null;
        if (!status || typeof status !== 'object') return null;
        return {
            role: status.role,
            connectivity: status.connectivity,
            masterAccessUrl: status.masterAccessUrl,
            masterWsUrl: status.masterWsUrl,
            replicationToken: status.replicationToken || null,
            cloneProfile: status.cloneProfile || DEFAULT_CLONE_PROFILE,
            gallerySharedDefault: status.gallerySharedDefault,
            displayName: status.displayName
        };
    } catch (_e) {
        return null;
    }
}

async function refreshReplicationClientState() {
    try {
        replicationConfig = await loadReplicationConfig();
    } catch (error) {
        console.warn('[masterWsBridge] Failed to load replication config:', error.message || error);
        replicationConfig = null;
    }

    if (!replicationConfig || !replicationConfig.masterAccessUrl) {
        applyGalleryReplicationClientContext(null, false);
        disconnectMasterBridge();
        reportDelegationStatus();
        return;
    }

    const masterReachable = await probeMasterReachable(replicationConfig);
    applyGalleryReplicationClientContext(replicationConfig, masterReachable);

    if (!canAttemptDirectMasterBridge(replicationConfig)) {
        disconnectMasterBridge();
        reportDelegationStatus();
        return;
    }

    connectMasterBridge().finally(() => {
        reportDelegationStatus();
    });
}

async function initMasterWsBridge(wsClient) {
    if (!wsClient || bridgeInitialized) return;
    localWsClient = wsClient;
    wrapWsClient(wsClient);
    bridgeInitialized = true;
    await refreshReplicationClientState();
}

function getMasterWsBridgeState() {
    return {
        initialized: bridgeInitialized,
        masterConnected: !!(masterAuthenticated && masterWs && masterWs.readyState === WebSocket.OPEN),
        delegation: buildDelegationStatusPatch(),
        replicationConfig
    };
}

function shutdownMasterWsBridge() {
    disconnectMasterBridge();
    bridgeInitialized = false;
    replicationConfig = null;
    localWsClient = null;
    wrappedMethods = null;
}
