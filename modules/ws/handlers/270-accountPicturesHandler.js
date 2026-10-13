const wsPacketRegistry = require('../wsPacketRegistry');
const accountPictures = require('../../accountPictures');

// Account pictures for Control Panel's User Accounts (modules/accountPictures.js): everyone can
// read them (the start menu shows the signed-in account's), only an administrator changes them.

async function handleGet(handlersCtx, ws, message) {
    try {
        const config = handlersCtx.globalResources.getConfig() || {};
        handlersCtx.sendToClient(ws, {
            type: 'get_account_pictures_response',
            requestId: message.requestId,
            data: { success: true, accounts: accountPictures.describe(config), defaults: accountPictures.DEFAULT_PICTURES },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load account pictures', error.message, message.requestId);
    }
}

async function handleSet(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (!clientInfo || clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const account = String(message.account || '');
        const value = accountPictures.applyChange(account, String(message.picture || ''), message.dataUrl);
        await handlersCtx.globalResources.modifyConfig('config', (cfg) => {
            cfg.accountPictures = { ...(cfg.accountPictures || {}), [account]: value };
            return cfg;
        });
        const accounts = accountPictures.describe(handlersCtx.globalResources.getConfig() || {});
        handlersCtx.sendToClient(ws, {
            type: 'set_account_picture_response',
            requestId: message.requestId,
            data: { success: true, accounts },
            timestamp: new Date().toISOString()
        });
        // every client's start menu follows
        if (wsServer && typeof wsServer.broadcast === 'function') {
            wsServer.broadcast({ type: 'account_pictures_changed', data: { accounts }, timestamp: new Date().toISOString() });
        }
    } catch (error) {
        if (error instanceof accountPictures.AccountPictureError) {
            handlersCtx.sendError(ws, error.message, error.code, message.requestId);
            return;
        }
        handlersCtx.sendError(ws, 'Failed to save the account picture', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[270-accountPicturesHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'accountPictures', ...meta });
    };
    reg('get_account_pictures', handleGet);
    reg('set_account_picture', handleSet, { destructive: true });
}

module.exports = {
    registerPackets
};
