// App core inbound WebSocket handlers — queue, presets, receipts.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleQueueUpdateData(data, wsClient) {
    wsClient.triggerEvent('queue_update', data);

    if (window.optionsData) {
        window.optionsData.queue_status = data.value;
    }

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

    // No "Queue Blocked" / "Queue Unblocked" toast (N1, N2): the Generate button state above is the status, and the
    // printer tray icon (printQueue.js) shows the queue
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

    // Only a DEPOSIT is told (Anlas arriving the user did not cause by an action of theirs; a click opens Account
    // Manager's Status, the tray's wallet balloon, switch Notifications > Deposit Receipt). The cost of a print, an
    // upscale or a vibe encoding the user just ran is a status echo (N1, N2): the balance in Account Manager's Status
    // and the Anlas row show what it cost (receipt_notification above stays the data's path for anything listening).
    const receipt = message.receipt;
    if (receipt && receipt.cost > 0 && receipt.type === 'deposit') {
        // notice: deposit-receipt
        showGlassToast('success', 'Deposit Receipt', `<i class="nai-anla"></i> +${receipt.cost || 0} (using ${receipt.creditType || 'unknown'})`,
            false, window.isDesktop ? false : 10000, '<i class="fas fa-plus-circle"></i>');
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
