// Novel inbound WebSocket handlers — progress, updates, generation complete.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleNovelProgressMessage(message, wsClient) {
    const data = message.data || {};
    // handleNovelProgressUpdate: public/scripts/comp/novelManager.js
    if (typeof handleNovelProgressUpdate === 'function') {
        handleNovelProgressUpdate(data);
    }
    wsClient.triggerEvent('novel_progress', message);
}

function handleNovelUpdatedMessage(message, wsClient) {
    const data = message.data || {};
    // handleNovelClientUpdate: public/scripts/comp/novelManager.js
    if (typeof handleNovelClientUpdate === 'function') {
        handleNovelClientUpdate(data);
    }
    wsClient.triggerEvent('novel_updated', message);
}

function handleNovelGenerateCompleteMessage(message, wsClient) {
    const data = message.data || {};
    // handleNovelGenerateComplete: public/scripts/comp/novelManager.js
    if (typeof handleNovelGenerateComplete === 'function') {
        handleNovelGenerateComplete(data, message.requestId);
    }
    wsClient.triggerEvent('novel_generate_complete', message);
}

registerWsInboundHandler({
    id: 'novel.progress',
    type: 'novel_progress',
    phase: 'only',
    handler(message, wsClient) {
        handleNovelProgressMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'novel.updated',
    type: 'novel_updated',
    phase: 'only',
    handler(message, wsClient) {
        handleNovelUpdatedMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'novel.generate_complete',
    type: 'novel_generate_complete',
    phase: 'only',
    handler(message, wsClient) {
        handleNovelGenerateCompleteMessage(message, wsClient);
    }
});
