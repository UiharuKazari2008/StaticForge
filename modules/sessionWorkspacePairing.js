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
    try {
        const wren = require('./cursorDirector');
        const wrenId = wren.activeDirectorSessionId && wren.activeDirectorSessionId();
        if (wrenId) return (wren.readChatWorkspace && wren.readChatWorkspace(wrenId)) || '';
    } catch (_err) { /* director index may be unavailable */ }
    try {
        const xi = require('./xiDirector');
        const xiId = xi.activeSessionId && xi.activeSessionId();
        if (xiId) return (xi.readChatWorkspace && xi.readChatWorkspace(xiId)) || '';
    } catch (_err) { /* xi is optional */ }
    return '';
}

function scopeWriteWorkspaceForTurn(requestedWorkspaceId) {
    return scopeWriteWorkspace(lookupRunningSessionWorkspace(), requestedWorkspaceId);
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
    scopeWriteWorkspaceForTurn,
    clientInWorkspace,
    annotateClients,
    studioWriteAllowed
};
