const wsPacketRegistry = require('../wsPacketRegistry');
const browsingSessions = require('../../browsingSessions');

// Browsing sessions (Yozora #756, modules/browsingSessions.js): device -> client -> IE window -> tab ownership,
// Restore Session and Other Devices. Every packet needs a signed-in client; Other Devices shows every
// device's tabs to administrators and only the client's own device to anyone else.

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[302-browsingSessionsHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reply = (ws, type, message, data) => handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data, timestamp: new Date().toISOString() });
    const body = (message) => (message.data && typeof message.data === 'object' ? message.data : message);
    const refused = (error) => ({ success: false, code: error.code || 'ERROR', error: error.message });
    const reg = (type, fn) => wsPacketRegistry.registerWsPacket(type, async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!clientInfo || !clientInfo.authenticated) {
            reply(ws, type + '_response', message, { success: false, code: 'NOT_SIGNED_IN', error: 'Sign in first' });
            return;
        }
        try {
            reply(ws, type + '_response', message, await fn(clientInfo, body(message), ws));
        } catch (error) {
            reply(ws, type + '_response', message, refused(error));
        }
    }, { owner: 'browsingSessions' });

    reg('browsing_session_hello', (clientInfo, data, ws) => browsingSessions.hello(clientInfo, ws, data));
    reg('browsing_session_update', (clientInfo, data) => browsingSessions.update(clientInfo, data));
    reg('browsing_session_list', (clientInfo) => browsingSessions.list(clientInfo));
    reg('browsing_session_restore', (clientInfo, data) => browsingSessions.restore(clientInfo, data));
    reg('browsing_session_discard', (clientInfo, data) => browsingSessions.discard(clientInfo, data));
    reg('browsing_session_take', (clientInfo, data) => browsingSessions.take(clientInfo, data));
    reg('browsing_session_take_back', (clientInfo, data) => browsingSessions.takeBack(clientInfo, data));
    browsingSessions.init();
}

module.exports = { registerPackets };
