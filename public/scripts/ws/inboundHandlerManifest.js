// Ordered inbound WebSocket handler scripts — loaded synchronously before websocket.js.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js
// Blocking script tags (not sync XHR) so fetches are intercepted by public/sw.js static cache.

var WS_INBOUND_HANDLER_PATHS = [
    '/scripts/ws/handlers/10-systemInbound.js',
    '/scripts/ws/handlers/20-galleryInbound.js',
    '/scripts/ws/handlers/30-workspaceInbound.js',
    '/scripts/ws/handlers/40-appCoreInbound.js',
    '/scripts/ws/handlers/50-generationInbound.js',
    '/scripts/ws/handlers/60-searchInbound.js',
    '/scripts/ws/handlers/70-novelInbound.js',
    '/scripts/ws/handlers/80-notesInbound.js',
    '/scripts/ws/handlers/90-vfsInbound.js',
    '/scripts/ws/handlers/100-imageResponseInbound.js',
    '/scripts/ws/handlers/110-chatInbound.js',
    '/scripts/ws/handlers/120-infrastructureInbound.js'
];

function loadWsInboundHandlersSync() {
    var markup = '';
    for (var i = 0; i < WS_INBOUND_HANDLER_PATHS.length; i++) {
        var url = WS_INBOUND_HANDLER_PATHS[i];
        markup += '<script src="' + url + '"><\/script>';
    }
    document.write(markup);
}

loadWsInboundHandlersSync();
