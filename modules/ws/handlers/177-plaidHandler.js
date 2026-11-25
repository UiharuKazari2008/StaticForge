// Wallet's bank balance (Yozora #1123): Plaid items linked to the household admin's bank accounts
// (modules/plaidBank.js). Admin only: a session user gets { restricted: true }. Access tokens never leave the server.
const wsPacketRegistry = require('../wsPacketRegistry');
const plaidBank = require('../../plaidBank');

const isAdmin = (clientInfo) => !!clientInfo && clientInfo.userType === 'admin';

function reply(wsServer, ws, type, message, data) {
    wsServer.sendToClient(ws, { type, requestId: message.requestId, data, timestamp: new Date().toISOString() });
}

async function handlePlaidStatus(handlers, ws, message, clientInfo, wsServer) {
    if (!isAdmin(clientInfo)) return reply(wsServer, ws, 'plaid_status_response', message, { success: true, restricted: true });
    try {
        plaidBank.attach(handlers.globalResources);
        reply(wsServer, ws, 'plaid_status_response', message, await plaidBank.getStatus({ refresh: message.refresh === true }));
    } catch (error) {
        handlers.sendError(ws, 'Failed to get bank status', error.message, message.requestId);
    }
}

async function handlePlaidLinkStart(handlers, ws, message, clientInfo, wsServer) {
    if (!isAdmin(clientInfo)) return reply(wsServer, ws, 'plaid_link_start_response', message, { success: true, restricted: true });
    try {
        plaidBank.attach(handlers.globalResources);
        const itemId = typeof message.itemId === 'string' && message.itemId ? message.itemId : null;
        reply(wsServer, ws, 'plaid_link_start_response', message, await plaidBank.linkStart(itemId, { confirmCharge: message.confirmCharge === true }));
    } catch (error) {
        handlers.sendError(ws, 'Failed to start the bank link', error.message, message.requestId);
    }
}

function handlePlaidLinkCancel(handlers, ws, message, clientInfo, wsServer) {
    if (!isAdmin(clientInfo)) return reply(wsServer, ws, 'plaid_link_cancel_response', message, { success: true, restricted: true });
    plaidBank.attach(handlers.globalResources);
    plaidBank.cancelLinks();
    reply(wsServer, ws, 'plaid_link_cancel_response', message, { success: true });
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[177-plaidHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('plaid_status', async (ctx) => {
        await handlePlaidStatus(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, { owner: 'wallet' });
    wsPacketRegistry.registerWsPacket('plaid_link_start', async (ctx) => {
        await handlePlaidLinkStart(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, { owner: 'wallet' });
    wsPacketRegistry.registerWsPacket('plaid_link_cancel', async (ctx) => {
        handlePlaidLinkCancel(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, { owner: 'wallet' });
}

module.exports = {
    registerPackets
};
