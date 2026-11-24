'use strict';

/**
 * Fleet's global activity list (#1154): every shell command, tool call and file edit of every Claude Code
 * session on this host, paged, with a detail (who, why, input, output). Admin only, as 313. The index is
 * modules/agentCoord/activityIndex.js; a list first runs a budgeted refresh, at most once per 20 s.
 * docs/client-api/ws/account.md#fleet-activity
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const activity = require('../../agentCoord/activityIndex');

const REFRESH_EVERY_MS = 20000;
let lastRefresh = 0;

const isAdmin = (clientInfo) => !!(clientInfo && clientInfo.userType === 'admin');

async function handle(handlersCtx, ws, message, clientInfo) {
    if (!isAdmin(clientInfo)) {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message && message.requestId);
        return;
    }
    try {
        const action = String((message && message.action) || 'list');
        let data;
        if (action === 'list') {
            if (Date.now() - lastRefresh >= REFRESH_EVERY_MS) {
                lastRefresh = Date.now();
                await activity.refresh({ budgetMs: 3000 });
            }
            data = activity.query({ kind: message.kind, sessionId: message.sessionId, q: message.q, before: message.before, limit: message.limit });
        } else if (action === 'detail') {
            data = activity.detail(message.id);
        } else {
            throw new Error('action must be list or detail');
        }
        handlersCtx.sendToClient(ws, { type: 'claude_fleet_activity_response', requestId: message.requestId, data: Object.assign({ success: true, action }, data), timestamp: new Date().toISOString() });
    } catch (error) {
        console.warn(`[fleetActivity] ${error.message}`);
        handlersCtx.sendError(ws, error.message, 'FLEET_ACTIVITY_FAILED', message && message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    wsPacketRegistry.registerWsPacket('claude_fleet_activity', async (ctx) => {
        await handle(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, { owner: 'fleetActivity' });
}

module.exports = { registerPackets, _handle: handle };
