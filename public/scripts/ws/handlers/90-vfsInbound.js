// VFS inbound WebSocket handlers — vfs_updated and desktop shortcut push types.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function dispatchWsMessageBridge(message) {
    document.dispatchEvent(new CustomEvent('wsMessage', {
        detail: { type: message.type, data: message.data }
    }));
}

function handleVfsExplorerRefreshMessage(message) {
    const desktopBroadcastTypes = new Set([
        'desktop_shortcut_added',
        'desktop_shortcut_removed',
        'desktop_shortcut_updated',
        'desktop_positions_updated'
    ]);

    // explorerApplet: public/scripts/comp/explorerApplet.js (lazy via featureLoader)
    if (typeof explorerApplet !== 'undefined' && explorerApplet) {
        if (desktopBroadcastTypes.has(message.type)) {
            explorerApplet.handleDesktopBroadcast(message);
        } else {
            explorerApplet.refreshIfOpen(message.data && message.data.path);
        }
    }

    dispatchWsMessageBridge(message);
}

registerWsInboundHandler({
    id: 'vfs.explorer_refresh',
    type: 'vfs_updated',
    alias: ['desktop_shortcut_added', 'desktop_shortcut_removed', 'desktop_shortcut_updated', 'desktop_positions_updated'],
    phase: 'only',
    handler(message) {
        handleVfsExplorerRefreshMessage(message);
    }
});
