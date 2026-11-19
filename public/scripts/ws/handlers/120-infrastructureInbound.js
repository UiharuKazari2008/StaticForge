// Infrastructure inbound WebSocket handlers — server errors, keep-alive.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'infrastructure.error',
    type: 'error',
    phase: 'only',
    handler(message, wsClient) {
        // Agora paints these on the gallery or image page (exploreDsapApplet.js explorePaintPageError).
        if (message.requestType === 'get_novelai_explore_gallery' || message.requestType === 'get_novelai_explore_post') {
            return;
        }
        // A metadata miss (deleted or unknown image) is handled by every caller (getImageMetadata
        // toast in galleryView.js, Omegasearch detail error, desktopShortcuts viewer fallback), so it
        // is not an unhandled exception (Yozora #614).
        if (message.requestType === 'request_image_metadata') {
            return;
        }
        // The link speed probe (#952, melatonNetworkDialogs.js) handles its own failure: a server without the packet
        // just leaves the Café Miniport's Speed at Not Available.
        if (message.requestType === 'link_speed_probe' || message.requestType === 'link_speed_report') {
            return;
        }
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

// DreamOS (#910): a release was published to an update channel (modules/ws/handlers/312-dreamosUpdatesHandler.js,
// only to DreamOS desktops that asked): the machine's system agent checks it now (CaféReady firmware.rs)
registerWsInboundHandler({
    id: 'infrastructure.dreamos_channel',
    type: 'dreamos_channel',
    phase: 'only',
    handler() {
        const updates = window.DreamOSUpdates;
        if (updates && typeof updates.check === 'function') Promise.resolve().then(() => updates.check()).catch(() => { /* the host checks at its next link-up */ });
    }
});
