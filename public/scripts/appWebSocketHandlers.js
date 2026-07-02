/**
 * App WebSocket Handlers (Phase 2 — app.js refactor)
 *
 * wsClient.on event handlers for gallery, receipts, ping, etc.
 * Queue, preset, workspace push, and receipt_notification inbound handling:
 * public/scripts/ws/handlers/30-workspaceInbound.js, 40-appCoreInbound.js
 */

// Register main app initialization steps with WebSocket client
if (window.wsClient) {
    wsClient.on('disconnected', (event) => {
        console.log('🔌 WebSocket disconnected:', event);
    });

    // Handle server pings
    wsClient.on('ping', (data) => {
        if (data.data) {
            handleServerPing(data.data);
        }
    });

    // Helper function to check if message is update-related
    function isUpdateRelatedMessage(message) {
        if (!message) return false;
        const lowerMessage = message.toLowerCase();
        return lowerMessage.includes('update') ||
            lowerMessage.includes('available') ||
            lowerMessage.includes('download') ||
            lowerMessage.includes('install') ||
            lowerMessage.includes('upgrade');
    }

    // Handle system messages
    wsClient.on('system_message', (data) => {
        console.log('📢 System message received:', data);
        if (data.data && data.data.message) {
            const message = data.data.message;
            // Show system message as toast
            showGlassToast(data.data.level || 'info', null, message);
        }
    });

    // Handle notifications
    wsClient.on('notification', (data) => {
        console.log('🔔 Notification received:', data);
        if (data.data && data.data.message) {
            const message = data.data.message;
            showGlassToast(data.data.type || 'info', null, message);
        }
    });

    // Handle receipt notifications
    wsClient.on('receipt', (data) => {
        if (data.data && data.data.message) {
            const message = data.data.message;
            showGlassToast(data.data.type || 'info', null, message, false);
        }
    });

    // handleGalleryUpdatedData: public/scripts/ws/handlers/20-galleryInbound.js (inbound registry sole path)

    // handleQueueUpdateData: public/scripts/ws/handlers/40-appCoreInbound.js
    // handleReceiptNotificationMessage: public/scripts/ws/handlers/appCoreInbound.js
    // handleWorkspaceRestoredMessage, handleWorkspaceDataMessage: public/scripts/ws/handlers/30-workspaceInbound.js

    // Listen for queue status requests from other modules
    document.addEventListener('requestQueueStatus', (event) => {
        const queueStatus = {
            isBlocked: isQueueStopped || isQueueProcessing,
            isQueueStopped,
            isQueueProcessing,
            value: isQueueStopped ? 2 : (isQueueProcessing ? 1 : 0)
        };

        // Dispatch response event
        const responseEvent = new CustomEvent('queueStatusResponse', {
            detail: queueStatus
        });
        document.dispatchEvent(responseEvent);
    });
}
