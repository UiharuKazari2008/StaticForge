const wsPacketRegistry = require('../wsPacketRegistry');
const { buildMenmaStatus, buildAllAccountsStatus } = require('../../menmaStatus');

async function handleGetMenmaState(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        // Build Menma status (backward compat) + all accounts for full pantry view
        const menmaPayload = await buildMenmaStatus(handlersCtx.globalResources);
        const allAccounts = await buildAllAccountsStatus(handlersCtx.globalResources);
        
        // Merge: menma fields at root (backward compat) + accounts object for applet
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
