// Wallet tray (Yozora #430): usage and balance of the connected accounts and API keys
// (modules/walletStatus.js). Cursor, Claude, TokenRouter and RunPod figures are
// admin-only; a session user gets { restricted: true } and the wallet shows NovelAI alone.
const wsPacketRegistry = require('../wsPacketRegistry');
const walletStatus = require('../../walletStatus');

async function handleWalletStatus(handlers, ws, message, clientInfo, wsServer) {
    if (!clientInfo || clientInfo.userType !== 'admin') {
        wsServer.sendToClient(ws, {
            type: 'wallet_status_response',
            requestId: message.requestId,
            data: { success: true, restricted: true },
            timestamp: new Date().toISOString()
        });
        return;
    }
    try {
        const status = await walletStatus.getWalletStatus(handlers.globalResources, {
            refresh: message.refresh === true,
            fresh: message.fresh === true
        });
        wsServer.sendToClient(ws, {
            type: 'wallet_status_response',
            requestId: message.requestId,
            data: { success: true, ...status },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlers.sendError(ws, 'Failed to get wallet status', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[176-walletHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('wallet_status', async (ctx) => {
        await handleWalletStatus(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, { owner: 'wallet' });
}

module.exports = {
    registerPackets
};
