/**
 * Replication service delegation — master WS auth, server proxy, client status reporting.
 */

const wsPacketRegistry = require('../../ws/wsPacketRegistry');
const { WebSocketServer } = require('../../websocket');
const replicationWsDelegate = require('../../replicationWsDelegate');
const { REPLICATION_ERROR_CODES, REPLICATION_TOKEN_SCOPES } = require('../replicationContracts');

const DELEGATION_OWNER = { owner: 'replication-delegation' };
const DELEGATION_CRITICAL = { owner: 'replication-delegation', critical: true };

function getReplicationService(globalResources) {
    return globalResources.getReplicationService();
}

function ensureReplicationAuthCritical() {
    if (!WebSocketServer.CRITICAL_MESSAGE_TYPES.includes('authenticate_replication')) {
        WebSocketServer.CRITICAL_MESSAGE_TYPES.push('authenticate_replication');
    }
}

function validateReplicationToken(globalResources, token) {
    const config = globalResources.getReplicationService().getReplicationConfig();
    const expected = config.replicationToken;
    if (!expected) return false;
    return token === expected;
}

function registerWsPackets(globalResources) {
    wsPacketRegistry.registerWsPacket('authenticate_replication', async (ctx) => {
        const { ws, message, clientInfo, wsServer, handlers } = ctx;
        const token = message.replicationToken || message.token || null;

        if (!validateReplicationToken(handlers.globalResources, token)) {
            wsServer.sendToClient(ws, {
                type: 'auth_error',
                message: 'Invalid replication read token',
                code: REPLICATION_ERROR_CODES.TOKEN_INVALID,
                requestId: message.requestId || null,
                timestamp: new Date().toISOString()
            });
            return;
        }

        clientInfo.authenticated = true;
        clientInfo.userType = 'readonly';
        clientInfo.authMethod = 'replication_token';
        clientInfo.replicationReadOnly = true;
        clientInfo.sessionId = clientInfo.sessionId || `replication:${token.slice(0, 8)}`;

        wsServer.sendToClient(ws, {
            type: 'replication_authenticated',
            requestId: message.requestId || null,
            data: {
                success: true,
                readOnly: true,
                scopes: [
                    REPLICATION_TOKEN_SCOPES.READ,
                    REPLICATION_TOKEN_SCOPES.WIKI,
                    REPLICATION_TOKEN_SCOPES.AUTOCOMPLETE
                ]
            },
            timestamp: new Date().toISOString()
        });
    }, DELEGATION_CRITICAL);

    wsPacketRegistry.registerWsPacket('replication_delegate', async (ctx) => {
        const { ws, message, wsServer, handlers } = ctx;
        const replicationService = getReplicationService(handlers.globalResources);
        const delegateType = message.delegateType || message.packetType || null;

        if (!delegateType) {
            handlers.sendError(ws, 'Missing delegateType', 'MISSING_DELEGATE_TYPE', message.requestId);
            return;
        }

        if (!replicationWsDelegate.isAllowedDelegatePacket(delegateType)) {
            handlers.sendError(ws, 'Packet not allowed for delegation', 'DELEGATION_FORBIDDEN', message.requestId);
            return;
        }

        const config = replicationService.getReplicationConfig();
        if (!replicationWsDelegate.shouldDelegatePacket(delegateType, config)) {
            handlers.sendError(ws, 'Packet is served locally', 'DELEGATION_NOT_REQUIRED', message.requestId);
            return;
        }

        try {
            const isAckless = delegateType === 'search_characters' || delegateType === 'fetch_autofill_wiki_previews';
            if (isAckless) {
                await replicationWsDelegate.proxyAcklessPacket(delegateType, message.delegatePayload || message, ws);
                wsServer.sendToClient(ws, {
                    type: 'replication_delegate_response',
                    requestId: message.requestId || null,
                    data: { success: true, delegateType, ackless: true },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            const masterResponse = await replicationWsDelegate.proxyPacket(
                delegateType,
                message.delegatePayload || message
            );

            wsServer.sendToClient(ws, {
                type: 'replication_delegate_response',
                requestId: message.requestId || null,
                data: {
                    success: true,
                    delegateType,
                    responseType: masterResponse.type,
                    response: masterResponse.data != null ? masterResponse.data : masterResponse
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            handlers.sendError(
                ws,
                error.message || 'Master delegation failed',
                error.code || 'DELEGATION_FAILED',
                message.requestId
            );
        }
    }, DELEGATION_OWNER);

    wsPacketRegistry.registerWsPacket('replication_delegation_status', async (ctx) => {
        const { ws, message, wsServer, handlers } = ctx;
        const replicationService = getReplicationService(handlers.globalResources);
        const patch = message.data || message;
        replicationService.updateDelegationStatus({
            wikiData: patch.wikiData,
            autoComplete: patch.autoComplete,
            wikiMedia: patch.wikiMedia,
            masterWsConnected: patch.masterWsConnected
        });

        wsServer.sendToClient(ws, {
            type: 'replication_delegation_status_response',
            requestId: message.requestId || null,
            data: {
                success: true,
                delegation: replicationService.getStatus().delegation
            },
            timestamp: new Date().toISOString()
        });
    }, DELEGATION_OWNER);
}

function registerHttpRoutes(app, globalResources) {
    const authMiddleware = globalResources.getAuthMiddleware();

    app.get('/replication/delegation/bridge-config', authMiddleware, (req, res) => {
        try {
            const replicationService = globalResources.getReplicationService();
            const config = replicationService.getReplicationConfig();
            res.json({
                success: true,
                data: {
                    role: config.role,
                    connectivity: config.connectivity,
                    masterAccessUrl: config.masterAccessUrl,
                    masterWsUrl: replicationWsDelegate.buildMasterWsUrl(config),
                    replicationToken: config.replicationToken || null,
                    cloneProfile: config.cloneProfile,
                    gallerySharedDefault: config.gallerySharedDefault,
                    displayName: config.displayName
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get delegation bridge config'
            });
        }
    });

    app.get('/replication/delegation/status', authMiddleware, (req, res) => {
        try {
            const replicationService = globalResources.getReplicationService();
            res.json({
                success: true,
                data: {
                    ...replicationWsDelegate.getDelegationSnapshot(),
                    delegation: replicationService.getStatus().delegation
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get delegation status'
            });
        }
    });
}

function register(app, globalResources) {
    ensureReplicationAuthCritical();
    replicationWsDelegate.initialize(globalResources);
    registerHttpRoutes(app, globalResources);
    registerWsPackets(globalResources);
}

module.exports = { register };
