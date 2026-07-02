const VfsWebSocketHandlers = require('../../vfsWebSocketHandlers');

/**
 * Register vfs_* and desktop_* WebSocket packet handlers (delegates to vfsWebSocketHandlers).
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    VfsWebSocketHandlers.registerVfsPackets(handlersCtx);
}

module.exports = {
    registerPackets
};
