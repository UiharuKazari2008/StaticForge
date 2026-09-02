// Generation inbound WebSocket handlers — image progress/errors, Rentan, quips.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleImageGenerationErrorMessage(message, wsClient) {
    console.error('❌ Image generation error:', message.error);
    console.error('❌ Full error details:', message);

    wsClient.clearStreamingStepQueues(null, true);
    if (wsClient.progressStates && message.requestId) {
        wsClient.cleanupGenerationProgressState(message.requestId);
    }
    if (message.requestId) {
        wsClient.releaseGenerationCloseGuard(message.requestId);
    }
    // clearGlassToastImagePreview: public/scripts/comp/glassToast.js
    if (typeof progressToastId !== 'undefined' && progressToastId && typeof clearGlassToastImagePreview === 'function') {
        clearGlassToastImagePreview(progressToastId);
    }

    if (message.requestId) {
        let errorMsg = message.error || message.data?.message || 'Image generation failed';

        if (message.details) {
            errorMsg += `\nDetails: ${message.details}`;
        }
        if (message.stack) {
            console.error('❌ Error stack:', message.stack);
        }

        const err = new Error(errorMsg);
        const statusCode = message.statusCode ?? message.data?.statusCode;
        const errorCode = message.code ?? message.data?.code;
        if (statusCode != null) {
            err.statusCode = statusCode;
            err.status = statusCode;
        }
        if (errorCode != null) {
            err.code = errorCode;
        }
        wsClient.resolveRequest(message.requestId, null, err);
    }

    if (typeof isGenerating !== 'undefined') {
        isGenerating = false;
    }
    // updateImageGenerationIndicator: public/scripts/comp/trayIndicators.js
    updateImageGenerationIndicator();

    // updateManualGenerateBtnState: public/scripts/comp/manualFormHelpers.js
    if (typeof updateManualGenerateBtnState === 'function') {
        updateManualGenerateBtnState();
    }

    // setGenerationPreviewForegroundLinesActive: public/scripts/comp/manualModalManager.js
    if (typeof setGenerationPreviewForegroundLinesActive === 'function') {
        setGenerationPreviewForegroundLinesActive(false);
    }
    // stopStudioPreviewForReroll: public/scripts/comp/galleryView.js
    if (isRerollImageWsRequest(message.requestId)) {
        stopStudioPreviewForReroll();
    }
}

function handleGenerationQuipsUpdatedMessage(message, wsClient) {
    const data = message.data || {};
    // handleGenerationQuipsClientUpdate: public/scripts/comp/generationQuipsTray.js
    if (typeof handleGenerationQuipsClientUpdate === 'function') {
        handleGenerationQuipsClientUpdate(data);
    }
    wsClient.triggerEvent('generation_quips_updated', message);
}

function handleGenerationQuipsProgressMessage(message, wsClient) {
    const data = message.data || {};
    // handleGenerationQuipsProgress: public/scripts/comp/generationQuipsTray.js
    if (typeof handleGenerationQuipsProgress === 'function') {
        handleGenerationQuipsProgress(data);
    }
    wsClient.triggerEvent('generation_quips_progress', message);
}

function handleGenerationQuipsStatusMessage(message, wsClient) {
    const data = message.data || {};
    // handleGenerationQuipsStatusBroadcast: public/scripts/comp/generationQuipsTray.js
    if (typeof handleGenerationQuipsStatusBroadcast === 'function') {
        handleGenerationQuipsStatusBroadcast(data);
    }
    wsClient.triggerEvent('generation_quips_status', message);
}

registerWsInboundHandler({
    id: 'generation.dynamic_progress_update',
    type: 'dynamic_generation_progress_update',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleDynamicGenerationProgressUpdate(message);
    }
});

registerWsInboundHandler({
    id: 'generation.image_progress',
    type: 'image_generation_progress',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleImageGenerationProgress(message);
    }
});

registerWsInboundHandler({
    id: 'generation.image_error',
    type: 'image_generation_error',
    phase: 'only',
    handler(message, wsClient) {
        handleImageGenerationErrorMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'generation.quips_updated',
    type: 'generation_quips_updated',
    phase: 'only',
    handler(message, wsClient) {
        handleGenerationQuipsUpdatedMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'generation.quips_progress',
    type: 'generation_quips_progress',
    phase: 'only',
    handler(message, wsClient) {
        handleGenerationQuipsProgressMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'generation.quips_status',
    type: 'generation_quips_status',
    phase: 'only',
    handler(message, wsClient) {
        handleGenerationQuipsStatusMessage(message, wsClient);
    }
});
