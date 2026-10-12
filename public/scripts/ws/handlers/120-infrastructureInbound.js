// Infrastructure inbound WebSocket handlers — server errors, keep-alive.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'infrastructure.error',
    type: 'error',
    phase: 'only',
    handler(message, wsClient) {
        // Desktop: a .NET-style "Unhandled exception" window in Windows wording instead of a toast
        // (public/scripts/comp/mainframeExceptionDialog.js). Logon / boot (auth errors, the desktop
        // not up yet) and narrow mode keep the banner.
        const desktopUp = window.isDesktop && wsClient.initializationCompleted && message.code !== 'AUTH_REQUIRED';
        if (desktopUp && window.mainframeExceptionDialog) {
            window.mainframeExceptionDialog.show(message);
            return;
        }
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
