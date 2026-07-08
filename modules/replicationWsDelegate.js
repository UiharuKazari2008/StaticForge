/**
 * Server-side master WebSocket proxy — fallback when the browser cannot reach masterWsUrl.
 */

const WebSocket = require('ws');
const { URL } = require('url');
const {
    REPLICATION_DELEGATED_PACKETS,
    REPLICATION_DELEGATED_STATIC_WIKI_PACKETS,
    REPLICATION_DELEGATED_ACKLESS_PACKETS,
    REPLICATION_ERROR_CODES,
    DEFAULT_CLONE_PROFILE,
    getReplicationDelegatedPacketMap,
    isReplicationDelegatedPacket
} = require('./replication/replicationContracts');

const DELEGATE_RESPONSE_SUFFIX = '_response';
const PROXY_REQUEST_TIMEOUT_MS = 120000;
const RECONNECT_DELAY_MS = 5000;

let globalResourcesRef = null;
let masterSocket = null;
let masterConnecting = null;
let masterAuthenticated = false;
const pendingProxyRequests = new Map();
const acklessClientRoutes = new Map();

function initialize(globalResources) {
    globalResourcesRef = globalResources;
}

function getReplicationService() {
    if (!globalResourcesRef || !globalResourcesRef.getReplicationService) return null;
    return globalResourcesRef.getReplicationService();
}

function getReplicationConfig() {
    const service = getReplicationService();
    return service ? service.getReplicationConfig() : null;
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

function getDelegatedPacketMap() {
    return getReplicationDelegatedPacketMap();
}

function getServiceKeyForPacket(packetType) {
    return getDelegatedPacketMap()[packetType] || null;
}

function shouldDelegatePacket(packetType, config) {
    if (!packetType || !config) return false;
    if (config.connectivity === 'airgapped') return false;

    const serviceKey = getServiceKeyForPacket(packetType);
    if (!serviceKey) return false;

    const profile = config.cloneProfile || DEFAULT_CLONE_PROFILE;
    return profile[serviceKey] !== true;
}

function isAllowedDelegatePacket(packetType) {
    return isReplicationDelegatedPacket(packetType);
}

function patchDelegationRuntimeStatus(patch) {
    const service = getReplicationService();
    if (!service) return;
    service.updateDelegationStatus(patch);
}

function clearMasterSocket() {
    masterAuthenticated = false;
    if (masterSocket) {
        try {
            masterSocket.removeAllListeners();
            if (masterSocket.readyState === WebSocket.OPEN || masterSocket.readyState === WebSocket.CONNECTING) {
                masterSocket.close();
            }
        } catch (_e) {}
    }
    masterSocket = null;
    masterConnecting = null;

    for (const [requestId, entry] of pendingProxyRequests.entries()) {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error('Master delegation connection closed'));
        pendingProxyRequests.delete(requestId);
    }

    patchDelegationRuntimeStatus({ masterWsConnected: false });
}

function handleMasterMessage(raw) {
    let message;
    try {
        message = JSON.parse(raw);
    } catch (_e) {
        return;
    }
    if (!message || !message.type) return;

    if (message.requestId && pendingProxyRequests.has(message.requestId)) {
        const entry = pendingProxyRequests.get(message.requestId);
        pendingProxyRequests.delete(message.requestId);
        clearTimeout(entry.timeoutId);

        if (message.type === 'error' || message.type === 'auth_error') {
            entry.reject(new Error(message.message || message.code || 'Master delegation error'));
            return;
        }
        entry.resolve(message);
        return;
    }

    const acklessTypes = message.type.startsWith('search_characters_')
        || message.type === 'fetch_autofill_wiki_previews_response';
    if (!acklessTypes) return;

    const sessionId = message.autofillSessionId
        || (message.data && message.data.autofillSessionId)
        || null;
    const route = sessionId ? acklessClientRoutes.get(sessionId) : null;
    const wsServer = globalResourcesRef && globalResourcesRef.getWebSocketServer
        ? globalResourcesRef.getWebSocketServer()
        : null;
    if (route && route.ws && wsServer) {
        wsServer.sendToClient(route.ws, message);
    }
}

function rememberAcklessRoute(message, targetWs) {
    const sessionId = message && (message.autofillSessionId || message.autofillSessionID);
    if (!sessionId || !targetWs) return;
    acklessClientRoutes.set(sessionId, { ws: targetWs, at: Date.now() });
    if (acklessClientRoutes.size > 200) {
        const oldest = [...acklessClientRoutes.entries()]
            .sort((a, b) => a[1].at - b[1].at)
            .slice(0, 50);
        oldest.forEach(([key]) => acklessClientRoutes.delete(key));
    }
}

function authenticateMasterSocket(ws, config) {
    return new Promise((resolve, reject) => {
        const requestId = `repl_auth_${Date.now()}`;
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Master replication authentication timeout'));
        }, 15000);

        function cleanup() {
            clearTimeout(timeoutId);
            ws.removeListener('message', onMessage);
        }

        function onMessage(raw) {
            let message;
            try {
                message = JSON.parse(raw);
            } catch (_e) {
                return;
            }
            if (message.requestId !== requestId) return;
            cleanup();
            if (message.type === 'replication_authenticated' && message.data && message.data.success) {
                masterAuthenticated = true;
                patchDelegationRuntimeStatus({ masterWsConnected: true });
                resolve();
                return;
            }
            reject(new Error(message.message || message.code || 'Master replication authentication failed'));
        }

        ws.on('message', onMessage);
        ws.send(JSON.stringify({
            type: 'authenticate_replication',
            requestId,
            replicationToken: config.replicationToken || null
        }));
    });
}

function connectToMaster(force) {
    const config = getReplicationConfig();
    if (!config || config.connectivity === 'airgapped') {
        return Promise.resolve(null);
    }

    const masterUrl = buildMasterWsUrl(config);
    if (!masterUrl || !config.replicationToken) {
        return Promise.resolve(null);
    }

    if (masterSocket && masterSocket.readyState === WebSocket.OPEN && masterAuthenticated) {
        return Promise.resolve(masterSocket);
    }

    if (masterConnecting && !force) {
        return masterConnecting;
    }

    clearMasterSocket();

    masterConnecting = new Promise((resolve, reject) => {
        const ws = new WebSocket(masterUrl);
        masterSocket = ws;

        const connectTimeout = setTimeout(() => {
            try {
                ws.terminate();
            } catch (_e) {}
            masterConnecting = null;
            reject(new Error('Master WebSocket connection timeout'));
        }, 20000);

        ws.on('open', async () => {
            clearTimeout(connectTimeout);
            try {
                await authenticateMasterSocket(ws, config);
                ws.on('message', handleMasterMessage);
                ws.on('close', () => {
                    clearMasterSocket();
                    setTimeout(() => {
                        connectToMaster(true).catch(() => {});
                    }, RECONNECT_DELAY_MS);
                });
                ws.on('error', () => {});
                masterConnecting = null;
                resolve(ws);
            } catch (error) {
                clearMasterSocket();
                masterConnecting = null;
                reject(error);
            }
        });

        ws.on('error', (error) => {
            clearTimeout(connectTimeout);
            clearMasterSocket();
            masterConnecting = null;
            reject(error);
        });
    });

    return masterConnecting;
}

function proxyPacket(packetType, message) {
    const config = getReplicationConfig();
    if (!config) {
        return Promise.reject(new Error('Replication not configured'));
    }
    if (config.connectivity === 'airgapped') {
        const err = new Error('Replication connectivity is airgapped');
        err.code = REPLICATION_ERROR_CODES.CONNECTIVITY_BLOCKED;
        return Promise.reject(err);
    }
    if (!isAllowedDelegatePacket(packetType)) {
        return Promise.reject(new Error(`Packet not allowed for delegation: ${packetType}`));
    }
    if (!shouldDelegatePacket(packetType, config)) {
        return Promise.reject(new Error(`Packet ${packetType} is served locally`));
    }

    return connectToMaster(false).then((ws) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            const err = new Error('Master WebSocket unavailable');
            err.code = REPLICATION_ERROR_CODES.ASSET_UNAVAILABLE;
            return Promise.reject(err);
        }

        const requestId = message.requestId || `repl_proxy_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const outbound = { ...message, type: packetType, requestId };

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                pendingProxyRequests.delete(requestId);
                reject(new Error(`Master delegation timeout for ${packetType}`));
            }, PROXY_REQUEST_TIMEOUT_MS);

            pendingProxyRequests.set(requestId, { resolve, reject, timeoutId, packetType });
            ws.send(JSON.stringify(outbound));
        });
    });
}

function proxyAcklessPacket(packetType, message, targetWs) {
    return connectToMaster(false).then((ws) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            const err = new Error('Master WebSocket unavailable');
            err.code = REPLICATION_ERROR_CODES.ASSET_UNAVAILABLE;
            return Promise.reject(err);
        }
        rememberAcklessRoute(message, targetWs);
        ws.send(JSON.stringify({ type: packetType, ...message }));
        return { success: true };
    });
}

function getDelegationSnapshot() {
    const config = getReplicationConfig();
    const service = getReplicationService();
    if (!service || !config) {
        return {
            masterWsConnected: false,
            shouldUseProxy: false
        };
    }
    return {
        masterWsConnected: masterAuthenticated && masterSocket && masterSocket.readyState === WebSocket.OPEN,
        shouldUseProxy: config.connectivity !== 'airgapped' && !!buildMasterWsUrl(config) && !!config.replicationToken,
        delegation: service.getStatus().delegation
    };
}

function shutdown() {
    clearMasterSocket();
}

module.exports = {
    initialize,
    buildMasterWsUrl,
    getDelegatedPacketMap,
    getServiceKeyForPacket,
    shouldDelegatePacket,
    isAllowedDelegatePacket,
    connectToMaster,
    proxyPacket,
    proxyAcklessPacket,
    getDelegationSnapshot,
    shutdown,
    STATIC_WIKI_DELEGATED_PACKETS: REPLICATION_DELEGATED_STATIC_WIKI_PACKETS,
    AUTOFILL_ACKLESS_PACKETS: REPLICATION_DELEGATED_ACKLESS_PACKETS
};
