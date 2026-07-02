// Infrastructure inbound WebSocket handlers — server error banner, keep-alive.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'infrastructure.error',
    type: 'error',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.bannerManager.showWebSocketBanner('error', 'WebSocket server error: ' + message.message, '<i class="fas fa-exclamation-triangle"></i>');
    }
});

registerWsInboundHandler({
    id: 'infrastructure.request_keep_alive',
    type: 'request_keep_alive',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleKeepAlive(message);
    }
});
