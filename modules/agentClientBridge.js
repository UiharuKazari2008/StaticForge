/**
 * Localhost agent session bridge — bind one connected Studio client and drive it.
 * Routes stay under /agent (loopback + devAuth). Share codes and keys are never logged.
 */

const crypto = require('crypto');
const WebSocket = require('ws');

const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_TTL_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 12000;

const shareCodes = new Map(); // code -> { clientId, expiresAt }
const pendingResults = new Map(); // requestId -> { resolve, reject, timer, clientId }
let boundClientId = null;

function generateClientId() {
    return crypto.randomBytes(6).toString('hex');
}

function generateShareCode() {
    const bytes = crypto.randomBytes(6);
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += SHARE_ALPHABET[bytes[i] % SHARE_ALPHABET.length];
    }
    return out;
}

function snippetUserAgent(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isStudioChangePayload(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const kind = obj.dreamscape || obj.type || obj.kind;
    return kind === 'change' || kind === 'dreamscape-change' || kind === 'studio-change';
}

function readBoolFlag(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return defaultValue;
}

function resolveStudioAutoFlags(body) {
    const autoApply = readBoolFlag(body && body.autoApply, true);
    const autoGenerate = readBoolFlag(body && body.autoGenerate, false);
    if (!autoApply && autoGenerate) {
        const err = new Error('autoGenerate requires autoApply');
        err.status = 400;
        throw err;
    }
    return { autoApply, autoGenerate };
}

function studioChangePayloadWithoutFlags(body) {
    if (!isStudioChangePayload(body)) return null;
    const payload = { ...body };
    delete payload.autoApply;
    delete payload.autoGenerate;
    return payload;
}

function getWsServer(globalResources) {
    try {
        return globalResources.getWebSocketServer();
    } catch (_err) {
        return null;
    }
}

function ensureClientId(info) {
    if (!info) return null;
    if (!info.clientId) {
        info.clientId = generateClientId();
    }
    return info.clientId;
}

function pruneShareCodes(now = Date.now()) {
    for (const [code, entry] of shareCodes) {
        if (!entry || entry.expiresAt <= now) {
            shareCodes.delete(code);
        }
    }
}

function findClientById(wsServer, clientId) {
    if (!wsServer || !wsServer.clients || !clientId) return null;
    for (const [ws, info] of wsServer.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (ensureClientId(info) === clientId) {
            return { ws, info };
        }
    }
    return null;
}

function resolveWorkspaceId(globalResources, info) {
    try {
        const workspaceManager = globalResources.getWorkspaceManager();
        if (info && info.sessionId && typeof workspaceManager.getActiveWorkspace === 'function') {
            return workspaceManager.getActiveWorkspace(info.sessionId) || null;
        }
    } catch (_err) {
        // session/workspace may be unavailable
    }
    return null;
}

function listClients(globalResources) {
    const wsServer = getWsServer(globalResources);
    pruneShareCodes();
    if (!wsServer || !wsServer.clients) return [];
    const out = [];
    for (const [ws, info] of wsServer.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const clientId = ensureClientId(info);
        out.push({
            clientId,
            userType: info.userType || null,
            workspaceId: resolveWorkspaceId(globalResources, info),
            connectedAt: info.connectedAt ? new Date(info.connectedAt).toISOString() : null,
            userAgent: snippetUserAgent(info.userAgent),
            bound: boundClientId === clientId,
            authenticated: !!info.authenticated
        });
    }
    return out;
}

function getBoundRecord(globalResources) {
    if (!boundClientId) return null;
    const found = findClientById(getWsServer(globalResources), boundClientId);
    if (!found) {
        boundClientId = null;
        return null;
    }
    return found;
}

function notifyClient(wsServer, ws, type, data) {
    if (!wsServer || typeof wsServer.sendToClient !== 'function' || !ws) return;
    wsServer.sendToClient(ws, {
        type,
        data: data || {},
        timestamp: new Date().toISOString()
    });
}

function bindClient(globalResources, { clientId, code }) {
    const wsServer = getWsServer(globalResources);
    pruneShareCodes();
    let targetId = clientId ? String(clientId).trim() : '';
    if (code) {
        const normalized = String(code).trim().toUpperCase();
        const entry = shareCodes.get(normalized);
        if (!entry || entry.expiresAt <= Date.now()) {
            const err = new Error('Share code is invalid or expired');
            err.status = 404;
            throw err;
        }
        targetId = entry.clientId;
        shareCodes.delete(normalized);
    }
    if (!targetId) {
        const err = new Error('clientId or code is required');
        err.status = 400;
        throw err;
    }
    const found = findClientById(wsServer, targetId);
    if (!found) {
        const err = new Error('Client is not connected');
        err.status = 404;
        throw err;
    }
    if (boundClientId && boundClientId !== targetId) {
        const previous = findClientById(wsServer, boundClientId);
        if (previous) {
            notifyClient(wsServer, previous.ws, 'agent_session_unbound', { clientId: boundClientId });
        }
    }
    boundClientId = targetId;
    notifyClient(wsServer, found.ws, 'agent_session_bound', { clientId: targetId });
    return {
        success: true,
        clientId: targetId,
        bound: true,
        userType: found.info.userType || null,
        workspaceId: resolveWorkspaceId(globalResources, found.info)
    };
}

function handleSessionShareStart(handlersCtx, ws, message, clientInfo) {
    const wsServer = handlersCtx && handlersCtx.globalResources
        ? getWsServer(handlersCtx.globalResources)
        : null;
    const info = clientInfo || (wsServer && wsServer.clients ? wsServer.clients.get(ws) : null);
    if (!info) {
        handlersCtx.sendError(ws, 'Unknown client', 'session_share_start', message.requestId);
        return;
    }
    const clientId = ensureClientId(info);
    if (message.userAgent) {
        info.userAgent = snippetUserAgent(message.userAgent);
    }
    pruneShareCodes();
    for (const [existingCode, entry] of shareCodes) {
        if (entry.clientId === clientId) {
            shareCodes.delete(existingCode);
        }
    }
    let code = generateShareCode();
    while (shareCodes.has(code)) {
        code = generateShareCode();
    }
    shareCodes.set(code, {
        clientId,
        expiresAt: Date.now() + SHARE_TTL_MS
    });
    handlersCtx.sendToClient(ws, {
        type: 'session_share_code_response',
        requestId: message.requestId,
        data: {
            success: true,
            clientId,
            code,
            expiresInSec: Math.round(SHARE_TTL_MS / 1000)
        },
        timestamp: new Date().toISOString()
    });
}

function handleAgentSessionResult(handlersCtx, ws, message) {
    const requestId = message && message.requestId;
    const entry = pendingResults.get(requestId);
    if (!entry) return;
    const wsServer = handlersCtx && handlersCtx.globalResources
        ? getWsServer(handlersCtx.globalResources)
        : null;
    const info = wsServer && wsServer.clients ? wsServer.clients.get(ws) : null;
    const clientId = info ? ensureClientId(info) : null;
    if (clientId !== entry.clientId) return;
    clearTimeout(entry.timer);
    pendingResults.delete(requestId);
    entry.resolve(message.data || {});
}

function sendBoundCommand(globalResources, command, payload, timeoutMs = COMMAND_TIMEOUT_MS) {
    const bound = getBoundRecord(globalResources);
    if (!bound) {
        const err = new Error('No Studio client is bound');
        err.status = 404;
        throw err;
    }
    const wsServer = getWsServer(globalResources);
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingResults.delete(requestId);
            const err = new Error('Bound client did not reply');
            err.status = 504;
            reject(err);
        }, timeoutMs);
        pendingResults.set(requestId, {
            resolve,
            reject,
            timer,
            clientId: boundClientId
        });
        wsServer.sendToClient(bound.ws, {
            type: 'agent_session_command',
            requestId,
            data: {
                command,
                ...(payload || {})
            },
            timestamp: new Date().toISOString()
        });
    });
}

function handleRouteError(res, error, fallback) {
    const status = error && error.status ? error.status : 500;
    const message = status >= 500 ? fallback : (error.message || fallback);
    return res.status(status).json({ success: false, error: message });
}

function registerRoutes(app, { devAuthMiddleware, globalResources }) {
    app.get('/agent/clients', devAuthMiddleware, (req, res) => {
        try {
            return res.json({
                success: true,
                clients: listClients(globalResources),
                boundClientId
            });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to list clients');
        }
    });

    app.post('/agent/bind', devAuthMiddleware, (req, res) => {
        try {
            const body = req.body || {};
            return res.json(bindClient(globalResources, {
                clientId: body.clientId || body.client_id,
                code: body.code
            }));
        } catch (error) {
            return handleRouteError(res, error, 'Failed to bind client');
        }
    });

    app.post('/agent/session/open-image', devAuthMiddleware, async (req, res) => {
        try {
            const filename = String((req.body && req.body.filename) || '').trim();
            if (!filename) {
                return res.status(400).json({ success: false, error: 'filename is required' });
            }
            const data = await sendBoundCommand(globalResources, 'open_image', { filename });
            return res.json({ success: true, ...data });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to open image on bound client');
        }
    });

    app.post('/agent/session/studio', devAuthMiddleware, async (req, res) => {
        try {
            const body = req.body || {};
            if (!body.change && body.prompt == null && body.uc == null && !isStudioChangePayload(body)) {
                return res.status(400).json({ success: false, error: 'change JSON or prompt/uc fields are required' });
            }
            const { autoApply, autoGenerate } = resolveStudioAutoFlags(body);
            const data = await sendBoundCommand(globalResources, 'apply_studio', {
                change: body.change || null,
                prompt: body.prompt,
                uc: body.uc,
                payload: studioChangePayloadWithoutFlags(body),
                autoApply,
                autoGenerate
            });
            return res.json({ success: true, ...data });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to apply studio change on bound client');
        }
    });

    app.get('/agent/session/state', devAuthMiddleware, async (req, res) => {
        try {
            const bound = getBoundRecord(globalResources);
            if (!bound) {
                return res.status(404).json({ success: false, error: 'No Studio client is bound' });
            }
            const fallback = {
                workspaceId: resolveWorkspaceId(globalResources, bound.info),
                filename: null,
                model: null,
                clientId: boundClientId,
                change: null
            };
            try {
                const data = await sendBoundCommand(globalResources, 'get_state', {}, 8000);
                const change = (data && data.change && typeof data.change === 'object' && !Array.isArray(data.change))
                    ? data.change
                    : null;
                return res.json({
                    success: true,
                    workspaceId: data.workspaceId || fallback.workspaceId,
                    filename: data.filename || null,
                    model: data.model || null,
                    clientId: boundClientId,
                    bound: true,
                    change
                });
            } catch (error) {
                if (error.status === 504) {
                    return res.json({
                        success: true,
                        ...fallback,
                        bound: true,
                        partial: true
                    });
                }
                throw error;
            }
        } catch (error) {
            return handleRouteError(res, error, 'Failed to read bound session state');
        }
    });
}

module.exports = {
    registerRoutes,
    handleSessionShareStart,
    handleAgentSessionResult,
    listClients,
    bindClient,
    _test: {
        generateShareCode,
        generateClientId,
        pruneShareCodes,
        shareCodes,
        snippetUserAgent,
        isStudioChangePayload,
        readBoolFlag,
        resolveStudioAutoFlags,
        studioChangePayloadWithoutFlags,
        SHARE_TTL_MS,
        SHARE_ALPHABET
    }
};
