const wsPacketRegistry = require('../wsPacketRegistry');
const networkShares = require('../../networkShares');

// Explorer's Network folder (modules/networkShares.js, docs/client-api/ws/networkShares.md): the DreamOS computers a
// page may see and the folders they share. Any signed-in page (shares are user-level: the guest account has its own
// access); refusals are answers (success:false), never error packets.

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[317-networkSharesHandler] registerPackets: missing handlersCtx');
        return;
    }
    const gr = () => handlersCtx.globalResources;
    const reply = (ws, type, message, data) => handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data, timestamp: new Date().toISOString() });
    const reg = (type, fn) => wsPacketRegistry.registerWsPacket(type, fn, { owner: 'networkShares' });
    const body = (message) => (message.data && typeof message.data === 'object' ? message.data : message);
    const refused = (error) => ({ success: false, code: error.code || 'ERROR', error: error.message });
    const signedIn = (clientInfo) => !!(clientInfo && clientInfo.authenticated);

    // the list now; net_computers_updated follows whenever it changes (pushed, never polled)
    reg('net_computers', async ({ ws, message, clientInfo, wsServer }) => {
        if (!signedIn(clientInfo)) { reply(ws, 'net_computers_response', message, { success: false, code: 'NOT_AUTHENTICATED', computers: [] }); return; }
        try {
            reply(ws, 'net_computers_response', message, { success: true, ...networkShares.watch(gr(), wsServer, clientInfo, ws) });
        } catch (error) {
            reply(ws, 'net_computers_response', message, { ...refused(error), computers: [] });
        }
    });

    reg('net_share_call', async ({ ws, message, clientInfo, wsServer }) => {
        if (!signedIn(clientInfo)) { reply(ws, 'net_share_call_response', message, { success: false, code: 'NOT_AUTHENTICATED' }); return; }
        try {
            const r = await networkShares.shareCall(gr(), wsServer, clientInfo, ws, body(message));
            reply(ws, 'net_share_call_response', message, { success: true, result: r.result, access: r.access });
        } catch (error) {
            reply(ws, 'net_share_call_response', message, refused(error));
        }
    });
}

module.exports = {
    registerPackets
};
