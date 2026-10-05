const wsPacketRegistry = require('../wsPacketRegistry');
const { buildAllAccountsStatus } = require('../../menmaStatus');

async function handleGetMenmaState(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        // One pass: allAccounts already builds menma. Do not call buildMenmaStatus
        // first — that raced a second BEGIN TRANSACTION on the shared tag_wiki.db.
        // Optional log_limit (default: every meal up to LOG_TAIL) so re-pointed
        // older meals are visible in the Pantry Log tab.
        const logLimit = message && (message.log_limit != null
            ? message.log_limit
            : (message.data && message.data.log_limit));
        const allAccounts = await buildAllAccountsStatus(handlersCtx.globalResources, { logLimit });
        const menmaPayload = (allAccounts.accounts && allAccounts.accounts.menma) || {
            success: false,
            available: false
        };
        const payload = {
            ...menmaPayload,
            accounts: allAccounts.accounts
        };
        
        handlersCtx.sendToClient(ws, {
            type: 'get_menma_state_response',
            requestId: message.requestId,
            data: payload,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_menma_state failed:', error && error.message);
        handlersCtx.sendError(ws, 'Failed to load Menma state', error.message, message.requestId);
    }
}

/**
 * Register Menma progress WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[165-menmaHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, owner, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner, ...meta });
    };

    reg('get_menma_state', 'menma', handleGetMenmaState);
}

module.exports = {
    registerPackets
};
