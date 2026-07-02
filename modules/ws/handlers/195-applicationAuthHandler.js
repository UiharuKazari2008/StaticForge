const wsPacketRegistry = require('../wsPacketRegistry');

const ADMIN_DESTRUCTIVE = { destructive: true };
const APP_AUTH_CRITICAL = { critical: true, owner: 'applicationAuth' };

function getManager(handlersCtx) {
    return handlersCtx.globalResources.getApplicationAuthManager();
}

function requireAdmin(clientInfo, handlersCtx, ws, message) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return false;
    }
    return true;
}

async function handleAuthenticateApplication(handlersCtx, ws, message, clientInfo, wsServer) {
    const { applicationKey, userAgent } = message;
    const ua = userAgent || message.clientUserAgent;
    if (!applicationKey) {
        handlersCtx.sendError(ws, 'applicationKey is required', 'MISSING_APPLICATION_KEY', message.requestId);
        return;
    }
    if (!ua) {
        handlersCtx.sendError(ws, 'userAgent is required', 'MISSING_USER_AGENT', message.requestId);
        return;
    }

    const manager = getManager(handlersCtx);
    const result = await manager.validateApplicationKey(applicationKey, ua);
    if (!result.valid) {
        wsServer.sendToClient(ws, {
            type: 'auth_error',
            message: result.message,
            code: result.code,
            requestId: message.requestId,
            refreshBeforeAt: result.refreshBeforeAt || null,
            timestamp: new Date().toISOString()
        });
        return;
    }

    clientInfo.authenticated = true;
    clientInfo.userType = result.userType;
    clientInfo.authMethod = 'application_key';
    clientInfo.applicationKeyId = result.applicationKeyId;
    clientInfo.applicationScopes = result.scopes;
    clientInfo.applicationUserAgent = ua;
    clientInfo.sessionId = `appkey:${result.applicationKeyId}`;

    const payload = {
        type: 'application_authenticated',
        requestId: message.requestId,
        data: {
            success: true,
            userType: result.userType,
            scopes: result.scopes,
            expiresAt: result.expiresAt,
            refreshBeforeAt: result.refreshBeforeAt,
            originalExpiresAt: result.originalExpiresAt,
            vfsPathUuid: handlersCtx.globalResources.getVfsPathUuid()
        },
        timestamp: new Date().toISOString()
    };
    if (result.userType === 'admin') {
        payload.data.logViewerPathUuid = handlersCtx.globalResources.getLogViewerPathUuid();
    }
    wsServer.sendToClient(ws, payload);
}

async function handleRefreshApplicationKey(handlersCtx, ws, message, clientInfo, wsServer) {
    const { applicationKey, userAgent } = message;
    const ua = userAgent || message.clientUserAgent || clientInfo.applicationUserAgent;
    if (!applicationKey) {
        handlersCtx.sendError(ws, 'applicationKey is required', 'MISSING_APPLICATION_KEY', message.requestId);
        return;
    }
    if (!ua) {
        handlersCtx.sendError(ws, 'userAgent is required', 'MISSING_USER_AGENT', message.requestId);
        return;
    }

    const manager = getManager(handlersCtx);
    const result = await manager.refreshApplicationKey(applicationKey, ua);
    if (!result.valid) {
        wsServer.sendToClient(ws, {
            type: 'auth_error',
            message: result.message,
            code: result.code,
            requestId: message.requestId,
            timestamp: new Date().toISOString()
        });
        return;
    }

    if (clientInfo.applicationKeyId === result.previousKeyId) {
        clientInfo.applicationKeyId = result.summary.id;
        clientInfo.sessionId = `appkey:${result.summary.id}`;
    }

    wsServer.sendToClient(ws, {
        type: 'application_key_refreshed',
        requestId: message.requestId,
        data: {
            success: true,
            applicationKey: result.key,
            summary: result.summary
        },
        timestamp: new Date().toISOString()
    });
}

async function handleRequestTempAccessToken(handlersCtx, ws, message, clientInfo, wsServer) {
    const { applicationKey, userAgent, maxUses, ttlSeconds, scopes } = message;
    const ua = userAgent || message.clientUserAgent || clientInfo.applicationUserAgent;
    if (!applicationKey) {
        handlersCtx.sendError(ws, 'applicationKey is required', 'MISSING_APPLICATION_KEY', message.requestId);
        return;
    }
    if (!ua) {
        handlersCtx.sendError(ws, 'userAgent is required', 'MISSING_USER_AGENT', message.requestId);
        return;
    }

    const manager = getManager(handlersCtx);
    const result = await manager.createTempAccessToken(applicationKey, ua, {
        maxUses: maxUses != null ? parseInt(maxUses, 10) : 1,
        ttlSeconds: ttlSeconds != null ? parseInt(ttlSeconds, 10) : 300,
        scopes: scopes || null
    });

    if (!result.valid) {
        wsServer.sendToClient(ws, {
            type: 'auth_error',
            message: result.message,
            code: result.code,
            requestId: message.requestId,
            timestamp: new Date().toISOString()
        });
        return;
    }

    wsServer.sendToClient(ws, {
        type: 'temp_access_token_response',
        requestId: message.requestId,
        data: {
            success: true,
            token: result.token,
            expiresAt: result.expiresAt,
            maxUses: result.maxUses,
            scopes: result.scopes
        },
        timestamp: new Date().toISOString()
    });
}

async function handleRequestApplicationAuthorization(handlersCtx, ws, message, clientInfo, wsServer) {
    const { appName, userAgent, scopes, userType, expiresAt, refreshIntervalDays } = message;
    if (!appName || !userAgent) {
        handlersCtx.sendError(ws, 'appName and userAgent are required', 'MISSING_FIELDS', message.requestId);
        return;
    }

    const manager = getManager(handlersCtx);
    const result = await manager.requestApplicationAuthorization({
        appName,
        userAgent,
        scopes: scopes || ['universal'],
        userType: userType || 'admin',
        expiresAt: expiresAt || null,
        refreshIntervalDays: refreshIntervalDays != null ? parseInt(refreshIntervalDays, 10) : 30
    });

    wsServer.sendToClient(ws, {
        type: 'application_authorization_requested',
        requestId: message.requestId,
        data: {
            success: true,
            requestId: result.requestId,
            requestCode: result.requestCode,
            message: 'Share this code with an administrator to approve access in Security Center'
        },
        timestamp: new Date().toISOString()
    });
}

async function handleClaimApplicationAuthorization(handlersCtx, ws, message, clientInfo, wsServer) {
    const { requestId, userAgent } = message;
    const ua = userAgent || message.clientUserAgent;
    if (!requestId) {
        handlersCtx.sendError(ws, 'requestId is required', 'MISSING_REQUEST_ID', message.requestId);
        return;
    }
    if (!ua) {
        handlersCtx.sendError(ws, 'userAgent is required', 'MISSING_USER_AGENT', message.requestId);
        return;
    }

    const manager = getManager(handlersCtx);
    const result = await manager.claimApplicationAuthorization(requestId, ua);
    if (!result.success) {
        wsServer.sendToClient(ws, {
            type: 'auth_error',
            message: result.message,
            code: result.code,
            requestId: message.requestId,
            timestamp: new Date().toISOString()
        });
        return;
    }

    wsServer.sendToClient(ws, {
        type: 'application_authorization_claimed',
        requestId: message.requestId,
        data: {
            success: true,
            applicationKey: result.applicationKey,
            summary: result.summary
        },
        timestamp: new Date().toISOString()
    });
}

async function handleCheckApplicationAuthorization(handlersCtx, ws, message, clientInfo, wsServer) {
    const { requestId, userAgent } = message;
    const ua = userAgent || message.clientUserAgent;
    if (!requestId) {
        handlersCtx.sendError(ws, 'requestId is required', 'MISSING_REQUEST_ID', message.requestId);
        return;
    }
    if (!ua) {
        handlersCtx.sendError(ws, 'userAgent is required', 'MISSING_USER_AGENT', message.requestId);
        return;
    }

    const manager = getManager(handlersCtx);
    const status = await manager.checkApplicationAuthorization(requestId, ua);

    if (status.status === 'approved') {
        wsServer.sendToClient(ws, {
            type: 'application_authorization_status',
            requestId: message.requestId,
            data: {
                status: 'approved',
                message: 'Authorization approved — send claim_application_authorization to retrieve your key once'
            },
            timestamp: new Date().toISOString()
        });
        return;
    }

    wsServer.sendToClient(ws, {
        type: 'application_authorization_status',
        requestId: message.requestId,
        data: status,
        timestamp: new Date().toISOString()
    });
}

async function handleListApplicationKeys(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const manager = getManager(handlersCtx);
    const keys = await manager.listApplicationKeys({ includeExpired: true });
    wsServer.sendToClient(ws, {
        type: 'list_application_keys_response',
        requestId: message.requestId,
        data: { success: true, keys },
        timestamp: new Date().toISOString()
    });
}

async function handleGetApplicationAuthScopes(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const manager = getManager(handlersCtx);
    wsServer.sendToClient(ws, {
        type: 'get_application_auth_scopes_response',
        requestId: message.requestId,
        data: { success: true, scopes: manager.listAvailableScopes() },
        timestamp: new Date().toISOString()
    });
}

async function handleCreateApplicationKey(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { appName, userAgent, scopes, userType, perpetual, expiresInDays, refreshIntervalDays } = message;
    if (!appName || !userAgent) {
        handlersCtx.sendError(ws, 'appName and userAgent are required', 'MISSING_FIELDS', message.requestId);
        return;
    }

    let expiresAt = null;
    if (!perpetual && expiresInDays != null) {
        expiresAt = Date.now() + Math.max(1, parseInt(expiresInDays, 10)) * 86400000;
    }

    const manager = getManager(handlersCtx);
    const created = await manager.createApplicationKey({
        appName,
        userAgent,
        scopes: scopes || ['universal'],
        userType: userType || 'admin',
        expiresAt,
        refreshIntervalDays: refreshIntervalDays != null ? parseInt(refreshIntervalDays, 10) : 30
    });

    wsServer.sendToClient(ws, {
        type: 'create_application_key_response',
        requestId: message.requestId,
        data: {
            success: true,
            applicationKey: created.key,
            summary: created.summary
        },
        timestamp: new Date().toISOString()
    });
}

async function handleRevokeApplicationKey(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { keyId } = message;
    if (!keyId) {
        handlersCtx.sendError(ws, 'keyId is required', 'MISSING_KEY_ID', message.requestId);
        return;
    }
    const manager = getManager(handlersCtx);
    const result = await manager.revokeApplicationKey(keyId);
    wsServer.sendToClient(ws, {
        type: 'revoke_application_key_response',
        requestId: message.requestId,
        data: result,
        timestamp: new Date().toISOString()
    });
}

async function handleListApplicationAuthRequests(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const manager = getManager(handlersCtx);
    const requests = await manager.listApplicationAuthRequests(message.status || 'pending');
    wsServer.sendToClient(ws, {
        type: 'list_application_auth_requests_response',
        requestId: message.requestId,
        data: { success: true, requests },
        timestamp: new Date().toISOString()
    });
}

async function handleApproveApplicationAuthRequest(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { requestId } = message;
    if (!requestId) {
        handlersCtx.sendError(ws, 'requestId is required', 'MISSING_REQUEST_ID', message.requestId);
        return;
    }
    const manager = getManager(handlersCtx);
    const result = await manager.approveApplicationAuthRequest(requestId);
    if (!result.success) {
        handlersCtx.sendError(ws, result.error || 'Failed to approve request', 'APPROVE_FAILED', message.requestId);
        return;
    }
    wsServer.sendToClient(ws, {
        type: 'approve_application_auth_request_response',
        requestId: message.requestId,
        data: {
            success: true,
            applicationKey: result.key,
            summary: result.summary
        },
        timestamp: new Date().toISOString()
    });
}

async function handleDenyApplicationAuthRequest(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { requestId } = message;
    if (!requestId) {
        handlersCtx.sendError(ws, 'requestId is required', 'MISSING_REQUEST_ID', message.requestId);
        return;
    }
    const manager = getManager(handlersCtx);
    const result = await manager.denyApplicationAuthRequest(requestId);
    wsServer.sendToClient(ws, {
        type: 'deny_application_auth_request_response',
        requestId: message.requestId,
        data: result,
        timestamp: new Date().toISOString()
    });
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[195-applicationAuthHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'applicationAuth', ...meta });
    };

    reg('authenticate_application', handleAuthenticateApplication, APP_AUTH_CRITICAL);
    reg('refresh_application_key', handleRefreshApplicationKey, APP_AUTH_CRITICAL);
    reg('request_temp_access_token', handleRequestTempAccessToken, APP_AUTH_CRITICAL);
    reg('request_application_authorization', handleRequestApplicationAuthorization, APP_AUTH_CRITICAL);
    reg('check_application_authorization', handleCheckApplicationAuthorization, APP_AUTH_CRITICAL);
    reg('claim_application_authorization', handleClaimApplicationAuthorization, APP_AUTH_CRITICAL);

    reg('list_application_keys', handleListApplicationKeys);
    reg('get_application_auth_scopes', handleGetApplicationAuthScopes);
    reg('create_application_key', handleCreateApplicationKey, ADMIN_DESTRUCTIVE);
    reg('revoke_application_key', handleRevokeApplicationKey, ADMIN_DESTRUCTIVE);
    reg('list_application_auth_requests', handleListApplicationAuthRequests);
    reg('approve_application_auth_request', handleApproveApplicationAuthRequest, ADMIN_DESTRUCTIVE);
    reg('deny_application_auth_request', handleDenyApplicationAuthRequest, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
