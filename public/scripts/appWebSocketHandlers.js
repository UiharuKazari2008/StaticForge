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

    // The server's own words to the user (modules/websocket.js broadcastSystemMessage / broadcastUserNotification).
    // Only a warning or an error reaches the user (N1: an info / success line only says something happened; it stays
    // in the console), and it is the message itself (N4: the notice is its own content). Warnings and errors also
    // reach the phone's inbox on the server side (notificationInboxSources.onSystemNotice).
    const serverNoticeIsNews = (level) => level === 'warning' || level === 'error';

    // Handle system messages
    wsClient.on('system_message', (data) => {
        console.log('📢 System message received:', data);
        if (data.data && data.data.message) {
            const message = data.data.message;
            const level = data.data.level || 'info';
            if (!serverNoticeIsNews(level)) return;
            // notice: server-system-message
            showGlassToast(level, null, message);
        }
    });

    // Handle notifications
    wsClient.on('notification', (data) => {
        console.log('🔔 Notification received:', data);
        if (data.data && data.data.message) {
            const message = data.data.message;
            const level = data.data.type || 'info';
            if (!serverNoticeIsNews(level)) return;
            // notice: server-user-notification
            showGlassToast(level, null, message);
        }
    });

    wsClient.on('agent_notice', (data) => {
        const notice = data && data.data ? data.data : {};
        const message = typeof notice.message === 'string' ? notice.message : '';
        if (!message) return;

        const title = notice.title || 'Agent';
        const level = notice.level || 'warning';
        const timeout = notice.timeout === false ? false : (notice.timeout ?? 10000);
        const noticeId = notice.id || `agent-notice-${Date.now()}`;
        const dialogIcon = level === 'error'
            ? 'fas fa-exclamation-circle'
            : (level === 'success'
                ? 'fas fa-check-circle'
                : (level === 'info' ? 'fas fa-info-circle' : 'fas fa-exclamation-triangle'));

        if (notice.restart === true) {
            const countdownMs = timeout === false ? 15000 : timeout;
            const countdownSec = countdownMs <= 0
                ? 0
                : Math.max(1, Math.round(Number(countdownMs) / 1000));
            // showAgentClientUpdateDialog: public/scripts/comp/agentClientUpdateDialog.js
            showAgentClientUpdateDialog({
                countdownSec,
                title,
                lead: title === 'Agent' ? 'An agent asked this client to restart.' : title,
                message
            });
            return;
        }

        if (notice.display === 'dialog') {
            // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
            showConfirmationDialog(message, [
                { text: 'OK', value: true, className: 'btn-primary' }
            ], null, { title, icon: dialogIcon });
            const dialogEl = document.getElementById('confirmationDialog');
            if (dialogEl) dialogEl.dataset.agentNoticeId = noticeId;
            if (timeout !== false && timeout > 0) {
                setTimeout(() => {
                    const openDialog = document.getElementById('confirmationDialog');
                    if (!openDialog || openDialog.dataset.agentNoticeId !== noticeId) return;
                    if (openDialog.classList.contains('hidden')) return;
                    // hideConfirmationDialog: public/scripts/comp/confirmationDialog.js
                    hideConfirmationDialog();
                }, timeout);
            }
            return;
        }

        // showGlassToast: public/scripts/comp/toastManager.js
        // notice: agent-notice-toast
        showGlassToast(level, title, message, false, timeout);
    });

    // (the old 'receipt' handler went: no server code sends a 'receipt' packet, and receipt_notification is the
    // one cost receipt path, 40-appCoreInbound.js)

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
