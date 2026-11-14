'use strict';

/*
 * The Grok project's system message template (Yozora #828; Remote Access Properties > MCP Connector >
 * Template..., public/scripts/comp/remoteAccessProperties.js). The default is
 * ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS (mcpInstructions.js: the Enshutsuka preamble + the MCP
 * initialize rules). An administrator can keep an edited copy in the secure config
 * (secureConfig.mcpProjectInstructions = { text, updatedAt }); Restore Default removes it.
 *
 * Only the project paste-block uses the override. MCP initialize keeps MCP_INSTRUCTIONS as built:
 * it goes to every MCP client (Claude, Cursor, the Director), Wren and Xi strip it sentence by
 * sentence (cursorDirector.js / xiDirector.js), and it has no Enshutsuka preamble.
 */

const { ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS } = require('./mcpInstructions');

const CONFIG_KEY = 'mcpProjectInstructions';
const MAX_LENGTH = 200000;

function packetBody(message) {
    return message && (message.data && typeof message.data === 'object' ? message.data : message) || {};
}

function readOverride(globalResources) {
    try {
        const raw = globalResources && typeof globalResources.getSecureConfig === 'function'
            ? globalResources.getSecureConfig({ path: CONFIG_KEY })
            : null;
        if (raw && typeof raw.text === 'string' && raw.text.trim()) {
            return { text: String(raw.text), updatedAt: raw.updatedAt || null };
        }
    } catch (_err) { /* no config yet */ }
    return null;
}

/** The project instructions in use: the administrator's copy, else the built-in text. */
function resolveProjectInstructions(globalResources) {
    const override = readOverride(globalResources);
    return override ? override.text : ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS;
}

function templateState(globalResources) {
    const override = readOverride(globalResources);
    return {
        success: true,
        text: override ? override.text : ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS,
        defaultText: ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS,
        custom: !!override,
        updatedAt: override ? override.updatedAt : null
    };
}

function requireAdmin(handlersCtx, ws, message, clientInfo) {
    if (clientInfo && clientInfo.userType === 'admin') return true;
    handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
    return false;
}

/** get_mcp_project_instructions: the template, the default, and whether it was changed (admin). */
async function handleGetMcpProjectInstructions(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    handlersCtx.sendToClient(ws, {
        type: 'get_mcp_project_instructions_response',
        requestId: message.requestId,
        data: templateState(handlersCtx.globalResources),
        timestamp: new Date().toISOString()
    });
}

/**
 * save_mcp_project_instructions { text } | { restoreDefault: true } (admin). Text equal to the
 * default, or empty, removes the override as Restore Default does.
 */
async function handleSaveMcpProjectInstructions(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    const body = packetBody(message);
    let text = body.restoreDefault === true ? '' : (typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n') : null);
    if (text === null) {
        handlersCtx.sendError(ws, 'Text is required', 'MISSING_TEXT', message.requestId);
        return;
    }
    if (text.length > MAX_LENGTH) {
        handlersCtx.sendError(ws, `The template is longer than ${MAX_LENGTH} characters.`, 'TOO_LONG', message.requestId);
        return;
    }
    if (text.trim() === ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS.trim()) text = '';
    try {
        handlersCtx.globalResources.modifyConfig('secureConfig', (cfg) => {
            if (text.trim()) {
                cfg[CONFIG_KEY] = { text, updatedAt: new Date().toISOString() };
            } else {
                delete cfg[CONFIG_KEY];
            }
            return cfg;
        });
    } catch (err) {
        handlersCtx.sendError(ws, err.message || 'Could not save the template', 'SAVE_FAILED', message.requestId);
        return;
    }
    handlersCtx.sendToClient(ws, {
        type: 'save_mcp_project_instructions_response',
        requestId: message.requestId,
        data: templateState(handlersCtx.globalResources),
        timestamp: new Date().toISOString()
    });
}

function registerMcpProjectInstructionsPackets(handlersCtx, reg, ADMIN_DESTRUCTIVE) {
    reg('get_mcp_project_instructions', handleGetMcpProjectInstructions);
    reg('save_mcp_project_instructions', handleSaveMcpProjectInstructions, ADMIN_DESTRUCTIVE);
}

module.exports = {
    resolveProjectInstructions,
    templateState,
    registerMcpProjectInstructionsPackets
};
