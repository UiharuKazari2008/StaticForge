// Image generation / upscale / expand response inbound handlers.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'image.generation_response',
    type: 'image_generation_response',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleGeneratedImage(message.data);
    }
});

registerWsInboundHandler({
    id: 'image.upscaling_response',
    type: 'image_upscaling_response',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleUpscalingResponse(message.data);
    }
});

registerWsInboundHandler({
    id: 'image.upscaling_error',
    type: 'image_upscaling_error',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleUpscalingError(message.data);
    }
});

registerWsInboundHandler({
    id: 'image.expansion_response',
    type: 'image_expansion_response',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleExpansionResponse(message.data);
    }
});

registerWsInboundHandler({
    id: 'image.expansion_error',
    type: 'image_expansion_error',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleExpansionError(message.data);
    }
});

registerWsInboundHandler({
    id: 'image.expansion_reroll_response',
    type: 'image_expansion_reroll_response',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleExpansionRerollResponse(message.data);
    }
});

registerWsInboundHandler({
    id: 'image.expansion_reroll_error',
    type: 'image_expansion_reroll_error',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.handleExpansionRerollError(message.data);
    }
});
