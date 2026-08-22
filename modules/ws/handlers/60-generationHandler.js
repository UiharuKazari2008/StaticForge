const wsPacketRegistry = require('../wsPacketRegistry');
const { WS_DISPATCH_FIFO_CONNECTION } = require('../wsMessageDispatcher');
const {
    handleImageGeneration,
    handleImageReroll,
    handleImageUpscaling,
    handlePreviewExpandImagePrompt,
    handleImageExpansion,
    handleEnhanceImage,
    handleMaxEnhanceImage,
    handleImageExpansionReroll,
    handleCancelGeneration,
    handleDynamicGenerationProgress,
    handleResolveDynamicContext,
    handleCompileDynamicGeneration,
    handleApplyTendaiPreview,
    handleResolveTextReplacements
} = require('./generationImpl');

const GENERATION_DESTRUCTIVE = { destructive: true, ...WS_DISPATCH_FIFO_CONNECTION };

/**
 * Register generation / image / dynamic-gen WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[60-generationHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'generation', ...meta });
    };

    regFn('generate_image', handleImageGeneration, GENERATION_DESTRUCTIVE);
    regFn('reroll_image', handleImageReroll, GENERATION_DESTRUCTIVE);
    regFn('upscale_image', handleImageUpscaling, GENERATION_DESTRUCTIVE);
    regFn('expand_image', handleImageExpansion, GENERATION_DESTRUCTIVE);
    regFn('enhance_image', handleEnhanceImage, GENERATION_DESTRUCTIVE);
    regFn('max_enhance_image', handleMaxEnhanceImage, GENERATION_DESTRUCTIVE);
    regFn('preview_expand_image_prompt', handlePreviewExpandImagePrompt, GENERATION_DESTRUCTIVE);
    regFn('reroll_expanded_image', handleImageExpansionReroll, GENERATION_DESTRUCTIVE);
    regFn('cancel_generation', handleCancelGeneration, WS_DISPATCH_FIFO_CONNECTION);
    regFn('dynamic_generation_progress', handleDynamicGenerationProgress);
    regFn('resolve_dynamic_context', handleResolveDynamicContext);
    regFn('compile_dynamic_generation', handleCompileDynamicGeneration, GENERATION_DESTRUCTIVE);
    regFn('apply_tendai_preview', handleApplyTendaiPreview, GENERATION_DESTRUCTIVE);
    regFn('resolve_text_replacements', handleResolveTextReplacements, GENERATION_DESTRUCTIVE);
}

module.exports = { registerPackets };
