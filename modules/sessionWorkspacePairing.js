'use strict';

// Session stays paired to one workspace. A send from another workspace must not re-pair it.
// Writes from that session go to the paired workspace even when the model or the client names another.

let workspaceLookup = null;

function setWorkspaceLookupForTests(fn) {
    workspaceLookup = typeof fn === 'function' ? fn : null;
}

function keepSessionWorkspace(chat, incomingWorkspaceId) {
    const paired = chat && typeof chat.workspaceId === 'string' ? chat.workspaceId.trim() : '';
    if (paired) return paired;
    const incoming = typeof incomingWorkspaceId === 'string' ? incomingWorkspaceId.trim() : '';
    if (chat && incoming) chat.workspaceId = incoming;
    return (chat && chat.workspaceId) || incoming || '';
}

function scopeWriteWorkspace(pairedWorkspaceId, requestedWorkspaceId) {
    const paired = typeof pairedWorkspaceId === 'string' ? pairedWorkspaceId.trim() : '';
    if (paired) return paired;
    const requested = typeof requestedWorkspaceId === 'string' ? requestedWorkspaceId.trim() : '';
    return requested;
}

function lookupRunningSessionWorkspace() {
    if (workspaceLookup) {
        const id = workspaceLookup();
        return typeof id === 'string' ? id.trim() : '';
    }
    const running = listRunningSessions();
    return running.length ? running[0].workspaceId : '';
}

function listRunningSessions() {
    const out = [];
    try {
        const wren = require('./cursorDirector');
        const wrenId = wren.activeDirectorSessionId && wren.activeDirectorSessionId();
        if (wrenId) {
            out.push({
                kind: 'wren',
                sessionId: wrenId,
                workspaceId: (wren.readChatWorkspace && wren.readChatWorkspace(wrenId)) || ''
            });
        }
    } catch (_err) { /* director index may be unavailable */ }
    try {
        const xi = require('./xiDirector');
        const xiId = xi.activeSessionId && xi.activeSessionId();
        if (xiId) {
            out.push({
                kind: 'xi',
                sessionId: xiId,
                workspaceId: (xi.readChatWorkspace && xi.readChatWorkspace(xiId)) || ''
            });
        }
    } catch (_err) { /* xi is optional */ }
    return out;
}

// Wren's jail mints "Dreamscape Director"; Xi mints "Xi". Claude Code / TokenRouter
// turns use those same keys. Guren, Ivory, and the other bot keys are not the
// running session — pairing them stole Laboratory onto the Director workspace (#568).
const WREN_ACTORS = new Set(['wren', 'director', 'dreamscape director', 'claude', 'claude code', 'grok.cursor']);
const XI_ACTORS = new Set(['xi']);

function actorKind(actorName) {
    const name = String(actorName || '').trim().toLowerCase();
    if (!name) return '';
    if (XI_ACTORS.has(name)) return 'xi';
    if (WREN_ACTORS.has(name)) return 'wren';
    return '';
}

function requestActorName(req) {
    if (!req) return '';
    if (req.actorName) return String(req.actorName).trim();
    const auth = req.applicationAuth;
    if (auth && (auth.appName != null || auth.applicationAppName != null)) {
        return String(auth.appName != null ? auth.appName : auth.applicationAppName).trim();
    }
    return '';
}

function requestSessionId(req, input) {
    return String(
        (input && (input.chatId || input.sessionId))
        || (req && (req.directorSessionId || req.chatId || req.sessionId))
        || ''
    ).trim();
}

// Pairing is per turn: only the session that is running may force its workspace.
// A missing req (unit tests / internal helpers) keeps the old global lookup.
function requestIsFromRunningSession(req, input) {
    if (!req && !input) return true;
    const asked = requestSessionId(req, input);
    const running = listRunningSessions();
    if (asked && running.some((row) => row.sessionId === asked)) return true;
    const kind = actorKind(requestActorName(req));
    if (!kind) return false;
    if (workspaceLookup) return true;
    return running.some((row) => row.kind === kind);
}

function scopeWriteWorkspaceForTurn(requestedWorkspaceId) {
    return scopeWriteWorkspace(lookupRunningSessionWorkspace(), requestedWorkspaceId);
}

// The running session this request belongs to: by session id first, then by
// actor kind. Wren and Xi can run at once; an Xi turn must get Xi's workspace.
function pairedWorkspaceForRequest(req, input) {
    if (!requestIsFromRunningSession(req, input)) return '';
    if (workspaceLookup || (!req && !input)) return lookupRunningSessionWorkspace();
    const running = listRunningSessions();
    const asked = requestSessionId(req, input);
    const byId = asked && running.find((row) => row.sessionId === asked);
    if (byId) return byId.workspaceId || '';
    const kind = actorKind(requestActorName(req));
    const byKind = running.find((row) => row.kind === kind);
    return byKind ? byKind.workspaceId || '' : '';
}

function scopeWriteWorkspaceForRequest(requestedWorkspaceId, req, input) {
    return scopeWriteWorkspace(pairedWorkspaceForRequest(req, input), requestedWorkspaceId);
}

// No paired session: the client is not constrained. Paired: true only in that workspace.
function clientInWorkspace(clientWorkspaceId, pairedWorkspaceId) {
    const paired = typeof pairedWorkspaceId === 'string' ? pairedWorkspaceId.trim() : '';
    if (!paired) return true;
    return String(clientWorkspaceId || '') === paired;
}

function annotateClients(clients, pairedWorkspaceId) {
    const paired = typeof pairedWorkspaceId === 'string' ? pairedWorkspaceId.trim() : '';
    return (Array.isArray(clients) ? clients : []).map((row) => {
        const workspaceId = row && row.workspaceId ? String(row.workspaceId) : '';
        return Object.assign({}, row, { in_workspace: clientInWorkspace(workspaceId, paired) });
    });
}

function studioWriteAllowed(pairedWorkspaceId, clientWorkspaceId) {
    return clientInWorkspace(clientWorkspaceId, pairedWorkspaceId);
}

module.exports = {
    setWorkspaceLookupForTests,
    keepSessionWorkspace,
    scopeWriteWorkspace,
    lookupRunningSessionWorkspace,
    listRunningSessions,
    actorKind,
    requestIsFromRunningSession,
    pairedWorkspaceForRequest,
    scopeWriteWorkspaceForTurn,
    scopeWriteWorkspaceForRequest,
    clientInWorkspace,
    annotateClients,
    studioWriteAllowed
};
