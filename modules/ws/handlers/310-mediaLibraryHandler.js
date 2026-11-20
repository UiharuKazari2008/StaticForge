const wsPacketRegistry = require('../wsPacketRegistry');

// Melaton Media Player's library (Yozora #956, modules/mediaLibrary.js): the VFS's music and video with their tags.
//   media_library_get {} -> { audio[], video[], scannedAt }
// The clients hear 'media_library_changed' (a push) when a VFS change brought new or fewer files.

function sessionOf(clientInfo, ws) {
    const info = clientInfo || (ws && ws.clientInfo) || {};
    return { userType: info.userType || (ws && ws.userType) || 'admin', applicationScopes: info.applicationScopes || (ws && ws.applicationScopes) };
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    const lib = require('../../mediaLibrary');
    lib.init(handlersCtx.globalResources);
    wsPacketRegistry.registerWsPacket('media_library_get', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        try {
            const data = await lib.getLibrary(sessionOf(clientInfo, ws));
            handlersCtx.sendToClient(ws, { type: 'media_library_get_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        } catch (e) {
            handlersCtx.sendError(ws, (e && e.message) || 'The library could not be read.', null, message.requestId);
        }
    }, { owner: 'mediaLibrary' });
}

module.exports = { registerPackets };
