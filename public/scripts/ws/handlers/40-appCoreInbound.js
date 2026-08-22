// App core inbound WebSocket handlers — queue, presets, receipts.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleQueueUpdateData(data, wsClient) {
    wsClient.triggerEvent('queue_update', data);

    if (window.optionsData) {
        window.optionsData.queue_status = data.value;
    }

    const wasBlockedOrProcessing = isQueueStopped || isQueueProcessing;

    if (data.value === 2) {
        isQueueStopped = true;
        isQueueProcessing = false;
    } else if (data.value === 1) {
        isQueueStopped = false;
        isQueueProcessing = true;
    } else {
        isQueueStopped = false;
        isQueueProcessing = false;
    }

    // updateManualGenerateBtnState: public/scripts/comp/manualFormHelpers.js
    if (typeof updateManualGenerateBtnState === 'function') {
        updateManualGenerateBtnState();
    }

    if (data.value === 2) {
        showGlassToast('warning', 'Queue Blocked', 'Generation is currently blocked. Please wait.', false, 5000);
    } else if (data.value === 0 && wasBlockedOrProcessing) {
        showGlassToast('success', 'Queue Unblocked', 'Generation is now available.', false, 3000);
    }
}

function handlePresetUpdatedBroadcast(data, wsClient) {
    // handlePresetUpdated: public/scripts/comp/presetManager.js (wsClient.on preset_updated)
    wsClient.triggerEvent('preset_updated', data);
}

function handlePresetGroupUpdatedMessage(message, wsClient) {
    if (message.data) {
        // handlePresetUpdated: public/scripts/comp/presetManager.js (wsClient.on preset_updated)
        wsClient.triggerEvent('preset_updated', message.data);
    }
}

function handleReceiptNotificationMessage(message, wsClient) {
    wsClient.triggerEvent('receipt_notification', message);

    if (message.receipt && message.receipt?.cost > 0) {
        const receipt = message.receipt;
        let toastMessage = '';
        let type = 'info';
        let header = '';

        switch (receipt.type) {
            case 'generation':
                header = 'Generation Receipt';
                toastMessage = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                type = 'success';
                break;
            case 'upscaling':
                header = 'Upscaling Receipt';
                toastMessage = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                type = 'success';
                break;
            case 'vibe_encoding':
                header = 'Vibe Encoding Receipt';
                toastMessage = ` <i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                type = 'info';
                break;
            case 'deposit':
                header = 'Deposit Receipt';
                toastMessage = `<i class="nai-anla"></i> +${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                type = 'success';
                break;
            default:
                header = 'Operation Receipt';
                toastMessage = `<i class="nai-anla"></i> ${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`;
                type = 'info';
        }

        if (toastMessage) {
            let icon = '<i class="fas fa-file-invoice-dollar"></i>';
            if (receipt.type === 'generation') {
                icon = '<i class="fas fa-sparkles"></i>';
            } else if (receipt.type === 'upscaling') {
                icon = '<i class="fas fa-expand"></i>';
            } else if (receipt.type === 'deposit') {
                icon = '<i class="fas fa-plus-circle"></i>';
            }

            showGlassToast(type, header, toastMessage, false, window.isDesktop ? false : 10000, icon);
        }
    }
}

registerWsInboundHandler({
    id: 'app.queue_update',
    type: 'queue_update',
    phase: 'only',
    handler(message, wsClient) {
        handleQueueUpdateData(message.data, wsClient);
    }
});

registerWsInboundHandler({
    id: 'app.preset_updated',
    type: 'preset_updated',
    phase: 'only',
    handler(message, wsClient) {
        handlePresetUpdatedBroadcast(message.data, wsClient);
    }
});

registerWsInboundHandler({
    id: 'app.preset_group_updated',
    type: 'preset_group_updated',
    phase: 'only',
    handler(message, wsClient) {
        handlePresetGroupUpdatedMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'app.receipt_notification',
    type: 'receipt_notification',
    phase: 'only',
    handler(message, wsClient) {
        handleReceiptNotificationMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'app.account_data_health_updated',
    type: 'account_data_health_updated',
    phase: 'only',
    handler(message) {
        const payload = message.data || message;
        // applyAccountHealthFieldsToOptions / handleAccountHealthUpdate: public/scripts/comp/accountDataBootstrap.js
        if (typeof applyAccountHealthFieldsToOptions === 'function') {
            applyAccountHealthFieldsToOptions(payload, payload.balance);
        }
        if (typeof handleAccountHealthUpdate === 'function') {
            handleAccountHealthUpdate(payload, payload.balance);
        }
    }
});
