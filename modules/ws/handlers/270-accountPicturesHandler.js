const wsPacketRegistry = require('../wsPacketRegistry');
const accountPictures = require('../../accountPictures');

// Account pictures and names for Control Panel's User Accounts (modules/accountPictures.js):
// everyone can read them (the start menu shows the signed-in account's), only an administrator
// changes them.

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

// Change the account name (User Accounts; Yukimi 2026-10-21): stored in config.accountNames and
// shown on the Welcome screen, the Start menu, the lock screen and the About box
async function handleSetName(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (!clientInfo || clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const account = String(message.account || '');
        if (!accountPictures.ACCOUNTS.includes(account)) {
            handlersCtx.sendError(ws, 'Unknown account', 'BAD_ACCOUNT', message.requestId);
            return;
        }
        const name = accountPictures.normalizeName(message.name);
        const config = handlersCtx.globalResources.getConfig() || {};
        const other = accountPictures.ACCOUNTS.find((a) => a !== account);
        if (other && accountPictures.accountName(config, other).toLowerCase() === name.toLowerCase()) {
            handlersCtx.sendError(ws, 'The name is already used by another account.', 'NAME_TAKEN', message.requestId);
            return;
        }
        await handlersCtx.globalResources.modifyConfig('config', (cfg) => {
            const names = { ...(cfg.accountNames || {}) };
            // Vista's built-in name again: nothing to store
            if (name === accountPictures.DEFAULT_NAMES[account]) delete names[account];
            else names[account] = name;
            cfg.accountNames = names;
            return cfg;
        });
        const accounts = accountPictures.describe(handlersCtx.globalResources.getConfig() || {});
        handlersCtx.sendToClient(ws, {
            type: 'set_account_name_response',
            requestId: message.requestId,
            data: { success: true, accounts },
            timestamp: new Date().toISOString()
        });
        if (wsServer && typeof wsServer.broadcast === 'function') {
            wsServer.broadcast({ type: 'account_pictures_changed', data: { accounts }, timestamp: new Date().toISOString() });
        }
    } catch (error) {
        if (error instanceof accountPictures.AccountPictureError) {
            handlersCtx.sendError(ws, error.message, error.code, message.requestId);
            return;
        }
        handlersCtx.sendError(ws, 'Failed to change the account name', error.message, message.requestId);
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
    reg('set_account_name', handleSetName, { destructive: true });
}

module.exports = {
    registerPackets
};
