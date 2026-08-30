/**
 * Localhost agent session bridge — bind one connected Studio client and drive it.
 * Routes stay under /agent (loopback + devAuth). Share codes and keys are never logged.
 */

const crypto = require('crypto');
const WebSocket = require('ws');
const {
    AVAILABLE_SCOPES,
    scopesAllowPacket
} = require('./applicationAuthManager');
const { getWsPacketEntry } = require('./ws/wsPacketRegistry');

const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_TTL_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 12000;
const UPDATE_COMMAND_TIMEOUT_MS = 20000;

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

function objectHasOwn(obj, key) {
    return !!(obj && typeof obj === 'object' && !Array.isArray(obj) && Object.prototype.hasOwnProperty.call(obj, key));
}

function rejectIllegalAutoCombo(autoApply, autoGenerate) {
    if (!autoApply && autoGenerate) {
        const err = new Error('autoGenerate requires autoApply');
        err.status = 400;
        throw err;
    }
}

function coerceStudioChangeObject(change) {
    if (change && typeof change === 'object' && !Array.isArray(change)) return change;
    if (typeof change !== 'string') return null;
    const raw = change.trim();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_err) {
        return null;
    }
    return null;
}

function readArrayFieldFlag(fields, key) {
    if (!Array.isArray(fields)) return { present: false, value: undefined };
    const item = fields.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const id = entry.id || entry.name || entry.key;
        return id === key;
    });
    if (!item) return { present: false, value: undefined };
    if (item.value !== undefined) return { present: true, value: item.value };
    if (item.text !== undefined) return { present: true, value: item.text };
    const chunk = Array.isArray(item.chunks) && item.chunks[0];
    if (chunk && chunk.text !== undefined) return { present: true, value: chunk.text };
    return { present: true, value: true };
}

function readNestedFlagHost(host) {
    if (!host || typeof host !== 'object') {
        return { applyPresent: false, genPresent: false, autoApply: true, autoGenerate: false };
    }
    if (Array.isArray(host)) {
        const applyField = readArrayFieldFlag(host, 'autoApply');
        const genField = readArrayFieldFlag(host, 'autoGenerate');
        return {
            applyPresent: applyField.present,
            genPresent: genField.present,
            autoApply: readBoolFlag(applyField.present ? applyField.value : undefined, true),
            autoGenerate: readBoolFlag(genField.present ? genField.value : undefined, false)
        };
    }
    const applyPresent = objectHasOwn(host, 'autoApply');
    const genPresent = objectHasOwn(host, 'autoGenerate');
    return {
        applyPresent,
        genPresent,
        autoApply: readBoolFlag(applyPresent ? host.autoApply : undefined, true),
        autoGenerate: readBoolFlag(genPresent ? host.autoGenerate : undefined, false)
    };
}

function collectNestedFlagHosts(change) {
    const hosts = [];
    if (!change) return hosts;
    hosts.push(change);
    if (change.fields != null) hosts.push(change.fields);
    return hosts;
}

function resolveStudioAutoFlags(body) {
    const change = coerceStudioChangeObject(body && body.change);
    const siblingApply = objectHasOwn(body, 'autoApply');
    const siblingGen = objectHasOwn(body, 'autoGenerate');

    const autoApply = readBoolFlag(body && body.autoApply, true);
    const autoGenerate = readBoolFlag(body && body.autoGenerate, false);
    rejectIllegalAutoCombo(autoApply, autoGenerate);

    let nestedPresent = false;
    for (const host of collectNestedFlagHosts(change)) {
        const flags = readNestedFlagHost(host);
        if (flags.applyPresent || flags.genPresent) {
            rejectIllegalAutoCombo(flags.autoApply, flags.autoGenerate);
            nestedPresent = true;
        }
    }

    if (nestedPresent && !siblingApply && !siblingGen) {
        const err = new Error('autoApply/autoGenerate must be siblings of change, not inside change');
        err.status = 400;
        throw err;
    }

    return { autoApply, autoGenerate };
}

function stripStudioAutoFlags(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj || null;
    if (!objectHasOwn(obj, 'autoApply') && !objectHasOwn(obj, 'autoGenerate')) return obj;
    const clean = { ...obj };
    delete clean.autoApply;
    delete clean.autoGenerate;
    return clean;
}

function stripStudioAutoFlagsDeep(obj) {
    const clean = stripStudioAutoFlags(obj);
    if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return clean;
    if (clean.fields && typeof clean.fields === 'object' && !Array.isArray(clean.fields)) {
        const fieldsClean = stripStudioAutoFlags(clean.fields);
        if (fieldsClean !== clean.fields) {
            return { ...clean, fields: fieldsClean };
        }
        return clean;
    }
    if (Array.isArray(clean.fields)) {
        const next = clean.fields.filter((item) => {
            if (!item || typeof item !== 'object') return true;
            const id = item.id || item.name || item.key;
            return id !== 'autoApply' && id !== 'autoGenerate';
        });
        if (next.length !== clean.fields.length) {
            return { ...clean, fields: next };
        }
    }
    return clean;
}

function studioChangePayloadWithoutFlags(body) {
    if (!isStudioChangePayload(body)) return null;
    return stripStudioAutoFlagsDeep(body);
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

function resolveAgentAuthScopes(req) {
    if (req.authMethod === 'dev_login_key' || req.userType === 'dev_admin') {
        return ['universal'];
    }
    const scopes = req.applicationAuth && req.applicationAuth.applicationScopes;
    return Array.isArray(scopes) ? scopes : [];
}

function agentHasNamedScope(scopes, scopeId) {
    if (!scopeId) return true;
    if (!Array.isArray(scopes) || scopes.length === 0) return false;
    if (scopes.includes('universal')) return true;
    return scopes.includes(scopeId);
}

function buildAgentScopePayload(req, globalResources) {
    const scopes = resolveAgentAuthScopes(req);
    const payload = {
        scopes,
        catalog: AVAILABLE_SCOPES.map((item) => ({ ...item }))
    };
    if (agentHasNamedScope(scopes, 'vfs')) {
        payload.vfsPathUuid = globalResources.getVfsPathUuid();
    }
    return payload;
}

function resolveAgentPacketMessage(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const type = String(body.type || body.packet || '').trim();
    if (!type) return null;
    const message = { ...body, type };
    delete message.packet;
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
        Object.assign(message, body.data);
    }
    if (!message.requestId) {
        message.requestId = `agent-${crypto.randomBytes(6).toString('hex')}`;
    }
    return message;
}

function createAgentPacketSink() {
    const replies = [];
    const ws = {
        readyState: 1,
        send(raw) {
            try {
                replies.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
            } catch (_err) {
                replies.push({ type: 'error', message: 'Invalid handler payload' });
            }
        }
    };
    const wsServer = {
        clients: new Map(),
        sendToClient(_ws, payload) {
            if (payload) replies.push(payload);
        },
        broadcastToAll() {}
    };
    return { ws, wsServer, replies };
}

async function dispatchAgentPacket(globalResources, req, message) {
    const scopes = resolveAgentAuthScopes(req);
    if (!scopesAllowPacket(scopes, message.type)) {
        const err = new Error('Application key does not have scope for this operation');
        err.status = 403;
        err.code = 'INSUFFICIENT_SCOPE';
        throw err;
    }
    const entry = getWsPacketEntry(message.type);
    if (!entry || typeof entry.handler !== 'function') {
        const err = new Error(`Unknown message type: ${message.type}`);
        err.status = 404;
        throw err;
    }
    const handlers = globalResources.getWebSocketMessageHandlers();
    if (!handlers) {
        const err = new Error('WebSocket handlers are not ready');
        err.status = 503;
        throw err;
    }
    if (req.userType === 'readonly' && handlers.isDestructiveOperation(message.type)) {
        const err = new Error('Non-Administrator Login: This operation is not allowed for read-only users');
        err.status = 403;
        err.code = 'READONLY_RESTRICTED';
        throw err;
    }
    const sink = createAgentPacketSink();
    const clientInfo = {
        authenticated: true,
        userType: req.userType || 'admin',
        authMethod: req.authMethod || 'application_key',
        applicationScopes: scopes,
        sessionId: req.sessionId || (req.applicationAuth && req.applicationAuth.sessionId) || null,
        userAgent: snippetUserAgent(req.headers && req.headers['user-agent'])
    };
    await entry.handler({
        ws: sink.ws,
        message,
        clientInfo,
        wsServer: sink.wsServer,
        handlers
    });
    return sink.replies;
}

function registerRoutes(app, { devAuthMiddleware, globalResources }) {
    app.get('/agent/scopes', devAuthMiddleware, (req, res) => {
        try {
            return res.json({
                success: true,
                ...buildAgentScopePayload(req, globalResources)
            });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to list agent scopes');
        }
    });

    app.post('/agent/packet', devAuthMiddleware, async (req, res) => {
        try {
            const message = resolveAgentPacketMessage(req.body || {});
            if (!message) {
                return res.status(400).json({ success: false, error: 'type is required' });
            }
            const replies = await dispatchAgentPacket(globalResources, req, message);
            const first = replies[0] || null;
            return res.json({
                success: !(first && first.type === 'error'),
                type: first && first.type ? first.type : null,
                requestId: message.requestId,
                data: first && first.data !== undefined ? first.data : null,
                reply: first,
                replies
            });
        } catch (error) {
            const status = error && error.status ? error.status : 500;
            return res.status(status).json({
                success: false,
                error: status >= 500 ? 'Failed to dispatch agent packet' : (error.message || 'Failed to dispatch agent packet'),
                code: error && error.code ? error.code : undefined
            });
        }
    });

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
            const changeSource = coerceStudioChangeObject(body.change) || body.change;
            const data = await sendBoundCommand(globalResources, 'apply_studio', {
                change: stripStudioAutoFlagsDeep(changeSource) || null,
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

    app.post('/agent/session/update', devAuthMiddleware, async (req, res) => {
        try {
            const data = await sendBoundCommand(globalResources, 'client_update', {}, UPDATE_COMMAND_TIMEOUT_MS);
            return res.json({ success: true, ...data });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to push update+restart on bound client');
        }
    });

    app.get('/agent/session/state', devAuthMiddleware, async (req, res) => {
        try {
            const bound = getBoundRecord(globalResources);
            if (!bound) {
                return res.status(404).json({ success: false, error: 'No Studio client is bound' });
            }
            const scopePayload = buildAgentScopePayload(req, globalResources);
            const fallback = {
                workspaceId: resolveWorkspaceId(globalResources, bound.info),
                filename: null,
                model: null,
                clientId: boundClientId,
                change: null,
                scopes: scopePayload.scopes
            };
            if (scopePayload.vfsPathUuid) fallback.vfsPathUuid = scopePayload.vfsPathUuid;
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
                    change,
                    scopes: scopePayload.scopes,
                    ...(scopePayload.vfsPathUuid ? { vfsPathUuid: scopePayload.vfsPathUuid } : {})
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

function getBoundClientId() {
    return boundClientId;
}

module.exports = {
    registerRoutes,
    handleSessionShareStart,
    handleAgentSessionResult,
    listClients,
    bindClient,
    getBoundRecord,
    getBoundClientId,
    dispatchAgentPacket,
    sendBoundCommand,
    resolveStudioAutoFlags,
    coerceStudioChangeObject,
    stripStudioAutoFlagsDeep,
    studioChangePayloadWithoutFlags,
    isStudioChangePayload,
    resolveAgentPacketMessage,
    resolveAgentAuthScopes,
    agentHasNamedScope,
    buildAgentScopePayload,
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
        stripStudioAutoFlags,
        stripStudioAutoFlagsDeep,
        coerceStudioChangeObject,
        objectHasOwn,
        SHARE_TTL_MS,
        SHARE_ALPHABET,
        UPDATE_COMMAND_TIMEOUT_MS,
        resolveAgentAuthScopes,
        resolveAgentPacketMessage,
        agentHasNamedScope,
        buildAgentScopePayload
    }
};
