// Chat inbound WebSocket handlers — message and streaming responses.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleChatMessageResponse(message, wsClient) {
    if (!window.chatSystem) return;

    window.chatSystem.handleChatMessageResponse(message);
    if (message.requestId) {
        wsClient.resolveRequest(message.requestId, message.data, message.error);
    }
}

function handleChatStreamingStart(message, wsClient) {
    if (!window.chatSystem) return;

    window.chatSystem.handleStreamingStart(message);
}

function handleChatStreamingUpdate(message, wsClient) {
    if (!window.chatSystem) return;

    window.chatSystem.handleStreamingUpdate(message);
}

function handleChatStreamingComplete(message, wsClient) {
    if (!window.chatSystem) return;

    window.chatSystem.handleStreamingComplete(message);
    if (message.requestId) {
        wsClient.resolveRequest(message.requestId, { success: true }, null);
    }
}

registerWsInboundHandler({
    id: 'chat.message_response',
    type: 'chat_message_response',
    phase: 'only',
    handler(message, wsClient) {
        handleChatMessageResponse(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'chat.streaming_start',
    type: 'chat_streaming_start',
    phase: 'only',
    handler(message, wsClient) {
        handleChatStreamingStart(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'chat.streaming_update',
    type: 'chat_streaming_update',
    phase: 'only',
    handler(message, wsClient) {
        handleChatStreamingUpdate(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'chat.streaming_complete',
    type: 'chat_streaming_complete',
    phase: 'only',
    handler(message, wsClient) {
        handleChatStreamingComplete(message, wsClient);
    }
});
