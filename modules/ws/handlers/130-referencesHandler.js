const ReferencesWebSocketHandlers = require('../../referencesWebSocketHandlers');

/**
 * Register references, uploads, and vibe WebSocket packet handlers (delegates to referencesWebSocketHandlers).
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[130-referencesHandler] registerPackets: missing handlersCtx');
        return;
    }
    if (!handlersCtx.referencesHandlers) {
        handlersCtx.referencesHandlers = new ReferencesWebSocketHandlers(handlersCtx);
    }
    ReferencesWebSocketHandlers.registerReferencesPackets(handlersCtx);
}

module.exports = {
    registerPackets
};
