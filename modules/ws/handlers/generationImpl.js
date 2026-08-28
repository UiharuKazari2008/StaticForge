const { generateImageWebSocket, handleRerollGeneration, expandImage, rerollExpandedImage, enhanceImage, maxEnhanceImage, previewExpandImagePrompt, compileDynamicGenerationWebSocket, applyTendaiPreviewWebSocket } = require('../../imageGeneration');
const { upscaleImageWebSocket } = require('../../imageUpscaling');
const { resolveDynamicContext } = require('../../dynamicGenerationHandlers');
const { broadcastGalleryMutation } = require('./120-galleryHandler');

function collectSavedGenerationFilenames(result) {
    const names = [];
    const seen = new Set();
    const pushName = (filename) => {
        if (!filename || typeof filename !== 'string' || seen.has(filename)) return;
        seen.add(filename);
        names.push(filename);
    };
    if (Array.isArray(result?.filenames)) {
        for (const entry of result.filenames) {
            pushName(typeof entry === 'string' ? entry : entry?.filename);
        }
    }
    pushName(result?.filename);
    return names;
}

function attachStagedGenerationResponseFields(responseData, result) {
    if (result.compiled_prompt) {
        responseData.compiled_prompt = result.compiled_prompt;
    }
    if (result.text_replacements_seed) {
        responseData.text_replacements_seed = result.text_replacements_seed;
    }
    if (result.stage_seeds) {
        responseData.stage_seeds = result.stage_seeds;
    }
    if (result.total_stages) {
        responseData.total_stages = result.total_stages;
    }
    const filenames = collectSavedGenerationFilenames(result);
    if (filenames.length > 0) {
        responseData.filenames = filenames;
    }
}

async function broadcastSavedGenerationFilenames(handlers, wsServer, clientInfo, result) {
    const filenames = collectSavedGenerationFilenames(result);
    if (filenames.length === 0) return;
    await broadcastGalleryMutation(handlers, wsServer, clientInfo, {
        viewType: 'images',
        action: 'append_top',
        filenames
    });
}

function normalizeExpansionOverrideParams(data) {
    let op = data.overrideParams;
    if (typeof op === 'string') {
        try {
            op = JSON.parse(op);
        } catch {
            op = {};
        }
    }   
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
        op = {};
    }
    const merged = { ...op };
    const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
    if (data.inset !== undefined && data.inset !== null) {
        merged.inset = truthy(data.inset);
    } else if (data.enableInset !== undefined && data.enableInset !== null) {
        merged.inset = truthy(data.enableInset);
    }
    return merged;
}

async function handleImageGeneration(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        const { requestId: _, enableStreaming, ...data } = message;
        data.requestId = requestId;

        handlers.globalResources.getLogger().initGenerationLog(requestId);

        console.log(`🚀 Processing image generation: ${requestId} | Model: ${data.model || 'unknown'} | Resolution: ${data.resolution || 'unknown'} | ${enableStreaming ? 'streaming' : 'batch'}`);

        handlers.globalResources.getLogger().logGeneration('REQUEST_DATA', {
            requestId,
            enableStreaming,
            model: data.model,
            resolution: data.resolution,
            steps: data.steps,
            guidance: data.guidance,
            sampler: data.sampler,
            workspace: data.workspace,
            hasDynamicGen: !!data.dynamic_generation,
            fullData: data
        }, requestId);

        if (handlers.globalResources.getLogger().shouldLog(handlers.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
            console.log('📋 Generation data:', JSON.stringify(data, null, 2));
        }

        handlers.startKeepAliveInterval(ws, requestId, 15000);
        handlers.registerActiveGeneration(ws, requestId);

        let result = null;
        if (enableStreaming) {
            handlers.globalResources.getLogger().detailed('🎬 Starting streaming image generation...');

            const streamingCallback = async (event) => {
                if (event.type === 'intermediate') {
                    /* handlers.sendToClient(ws, {
                        type: 'image_generation_intermediate',
                        requestId: requestId,
                        data: {
                            step: event.step,
                            image: event.image.toString('base64'),
                            timestamp: event.timestamp
                        },
                        timestamp: new Date().toISOString()
                    }); */
                }
            };

            result = await generateImageWebSocket(handlers.globalResources,
                data,
                clientInfo.userType,
                clientInfo.sessionId,
                streamingCallback,
                ws,
                handlers,
                wsServer
            );

            const contentLength = handlers.resolveGeneratedImageContentLength(result);
            const responseData = {
                image: result.buffer ? result.buffer.toString('base64') : null,
                filename: result.filename,
                seed: result.seed || null,
                metadata: result.metadata,
                contentLength
            };
            attachStagedGenerationResponseFields(responseData, result);

            handlers.sendToClient(ws, {
                type: 'image_generation_response',
                requestId: requestId,
                data: responseData,
                timestamp: new Date().toISOString()
            });
        } else {
            result = await generateImageWebSocket(handlers.globalResources,
                data,
                clientInfo.userType,
                clientInfo.sessionId,
                null,
                ws,
                handlers,
                wsServer
            );

            const contentLength = handlers.resolveGeneratedImageContentLength(result);
            const responseData = {
                image: result.buffer ? result.buffer.toString('base64') : null,
                filename: result.filename,
                seed: result.seed || null,
                metadata: result.metadata,
                contentLength
            };
            attachStagedGenerationResponseFields(responseData, result);

            handlers.sendToClient(ws, {
                type: 'image_generation_response',
                requestId: requestId,
                data: responseData,
                timestamp: new Date().toISOString()
            });
        }

        await broadcastSavedGenerationFilenames(handlers, wsServer, clientInfo, result);

        handlers.stopKeepAliveInterval(requestId);
    } catch (error) {
        handlers.stopKeepAliveInterval(requestId);

        console.error('❌ Image generation error:', error);

        const statusCode = error?.statusCode ?? error?.status ?? null;
        const errorCode = error?.code ?? null;
        const exactMessage = error?.message || String(error);
        const errorText = statusCode != null ? `${statusCode} ${exactMessage}` : exactMessage;

        handlers.sendToClient(ws, {
            type: 'image_generation_error',
            requestId: requestId,
            data: {
                statusCode,
                code: errorCode,
                message: exactMessage
            },
            error: errorText,
            statusCode,
            code: errorCode,
            timestamp: new Date().toISOString()
        });
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

async function handleImageReroll(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId;
    try {
        const { filename, workspace, allow_paid } = message;
        console.log(`🎲 Processing image reroll request: ${requestId} for filename: ${filename}, allow_paid: ${allow_paid}`);

        const metadata = await handlers.globalResources.getMetadataDatabase().getImageMetadata(filename, handlers.globalResources.getPath('images'));
        if (!metadata) {
            throw new Error(`No metadata found for image: ${filename}`);
        }

        console.log('🎲 Retrieved metadata for reroll:', metadata);

        // Parity with handleImageGeneration: keep the socket alive and track the active generation
        handlers.startKeepAliveInterval(ws, requestId, 15000);
        handlers.registerActiveGeneration(ws, requestId);

        // Non-null streamingCallback enables the streaming API path (imageGeneration.js ~3881); step frames ship via image_generation_progress
        const streamingCallback = async () => {};

        const result = await handleRerollGeneration(handlers.globalResources,
            metadata,
            clientInfo.sessionId,
            workspace || null,
            allow_paid || false,
            ws,
            handlers,
            wsServer,
            streamingCallback,
            requestId
        );

        handlers.stopKeepAliveInterval(requestId);

        handlers.sendToClient(ws, {
            type: 'image_reroll_response',
            requestId: requestId,
            data: {
                image: result.buffer ? result.buffer.toString('base64') : null,
                filename: result.filename,
                seed: result.seed || null,
                originalFilename: filename
            },
            timestamp: new Date().toISOString()
        });

        await broadcastSavedGenerationFilenames(handlers, wsServer, clientInfo, result);
    } catch (error) {
        handlers.stopKeepAliveInterval(requestId);
        console.error('❌ Image reroll error:', error);
        handlers.sendToClient(ws, {
            type: 'image_reroll_error',
            requestId: requestId,
            data: null,
            error: error.message || 'Image reroll failed',
            timestamp: new Date().toISOString()
        });
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

async function handleImageUpscaling(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        const { requestId: _, ...data } = message;
        console.log(`📏 Processing image upscaling request: ${requestId}`);
        console.log('📋 Upscaling data:', data);

        handlers.startKeepAliveInterval(ws, requestId, 15000);

        const result = await upscaleImageWebSocket(handlers.globalResources,
            data.filename,
            data.workspace,
            clientInfo.userType,
            clientInfo.sessionId,
            data.upscaler || 'novelai',
            data.scale || 4,
            ws,
            handlers,
            requestId
        );

        handlers.stopKeepAliveInterval(requestId);

        const contentLength = handlers.resolveGeneratedImageContentLength(result);
        handlers.sendToClient(ws, {
            type: 'image_upscaling_response',
            requestId: requestId,
            data: {
                image: result.buffer ? result.buffer.toString('base64') : null,
                filename: result.filename,
                metadata: result.metadata,
                contentLength
            },
            timestamp: new Date().toISOString()
        });

        // Upscale upgrades the same base gallery row (fills upscaled) and bumps sort_mtime to head
        await broadcastGalleryMutation(handlers, wsServer, clientInfo, {
            viewType: 'images',
            action: 'append_top',
            filename: result.filename
        });
    } catch (error) {
        console.error('❌ Image upscaling error:', error);

        handlers.stopKeepAliveInterval(requestId);

        handlers.sendToClient(ws, {
            type: 'image_upscaling_error',
            requestId: requestId,
            data: null,
            error: error.message || 'Image upscaling failed',
            timestamp: new Date().toISOString()
        });
    }
}

async function handlePreviewExpandImagePrompt(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        const { requestId: _rid, ...data } = message;
        console.log(`📝 Preview expand prompt: ${requestId}`);

        const overrideParams = normalizeExpansionOverrideParams(data);

        if (!data.filename) {
            throw new Error('Filename is required');
        }
        if (!data.resolution) {
            throw new Error('Resolution is required');
        }
        if (data.imageBias === undefined || data.imageBias === null) {
            throw new Error('Image bias is required');
        }

        handlers.startKeepAliveInterval(ws, requestId, 15000);

        const result = await previewExpandImagePrompt(handlers.globalResources,
            data.filename,
            data.resolution,
            data.imageBias,
            overrideParams,
            data.sourceFilename || data.filename,
            data.enableAI || false,
            ws,
            handlers,
            requestId
        );

        handlers.stopKeepAliveInterval(requestId);

        handlers.sendToClient(ws, {
            type: 'expand_image_prompt_preview_response',
            requestId: requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Preview expand prompt error:', error);
        handlers.stopKeepAliveInterval(requestId);
        handlers.sendToClient(ws, {
            type: 'expand_image_prompt_preview_error',
            requestId: requestId,
            data: null,
            error: error.message || 'Preview failed',
            timestamp: new Date().toISOString()
        });
    }
}

async function handleImageExpansion(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        const { requestId: _, enableStreaming, ...data } = message;
        console.log(`🔍 Processing image expansion request: ${requestId}`);
        console.log('📋 Expansion data:', data);

        const overrideParams = normalizeExpansionOverrideParams(data);
        console.log('📌 Normalized expansion overrideParams:', overrideParams);

        if (!data.filename) {
            throw new Error('Filename is required');
        }
        if (!data.resolution) {
            throw new Error('Resolution is required');
        }
        if (data.imageBias === undefined || data.imageBias === null) {
            throw new Error('Image bias is required');
        }

        handlers.startKeepAliveInterval(ws, requestId, 15000);
        handlers.registerActiveGeneration(ws, requestId);

        let streamingCallback = null;
        if (enableStreaming) {
            console.log('🎬 Starting streaming image expansion...');
            streamingCallback = async (event) => {
                if (event.type === 'intermediate') {
                    /* handlers.sendToClient(ws, {
                        type: 'image_generation_intermediate',
                        requestId: requestId,
                        data: {
                            step: event.step,
                            image: event.image.toString('base64'),
                            timestamp: event.timestamp
                        },
                        timestamp: new Date().toISOString()
                    }); */
                }
            };
        }

        const result = await expandImage(handlers.globalResources,
            data.filename,
            data.resolution,
            data.imageBias,
            data.upscaleAfterComplete || false,
            overrideParams,
            clientInfo.sessionId,
            data.workspace,
            streamingCallback,
            ws,
            handlers,
            requestId,
            data.sourceFilename || data.filename,
            data.enableAI || false,
            data.stepPreviewWidth,
            data.stepPreviewHeight
        );

        handlers.stopKeepAliveInterval(requestId);

        const contentLength = handlers.resolveGeneratedImageContentLength(result);
        handlers.sendToClient(ws, {
            type: 'image_expansion_response',
            requestId: requestId,
            data: {
                image: result.image,
                filename: result.filename,
                seed: result.seed,
                expansionPrompt: result.expansionPrompt,
                expansionReason: result.expansionReason,
                metadata: result.metadata,
                contentLength
            },
            timestamp: new Date().toISOString()
        });

        if (result && result.filename) {
            await broadcastGalleryMutation(handlers, wsServer, clientInfo, {
                viewType: 'images',
                action: 'append_top',
                filename: result.filename
            });
        }
    } catch (error) {
        console.error('❌ Image expansion error:', error);

        handlers.stopKeepAliveInterval(requestId);

        handlers.sendToClient(ws, {
            type: 'image_expansion_error',
            requestId: requestId,
            data: null,
            error: error.message || 'Image expansion failed',
            timestamp: new Date().toISOString()
        });
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

async function handleMaxEnhanceImage(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        if (!message.filename) {
            throw new Error('Filename is required');
        }

        handlers.startKeepAliveInterval(ws, requestId, 15000);
        handlers.registerActiveGeneration(ws, requestId);

        const result = await maxEnhanceImage(
            handlers.globalResources,
            message.filename,
            clientInfo.sessionId,
            message.workspace || null,
            null,
            ws,
            handlers,
            requestId,
            {
                strength: message.strength,
                noise: message.noise,
                steps: message.steps,
                guidance: message.guidance,
                rescale: message.rescale,
                sampler: message.sampler,
                noiseScheduler: message.noiseScheduler,
                seed: message.seed,
                model: message.model
            }
        );

        handlers.stopKeepAliveInterval(requestId);
        const contentLength = handlers.resolveGeneratedImageContentLength(result);
        handlers.sendToClient(ws, {
            type: 'max_enhance_image_response',
            requestId,
            data: {
                image: result.buffer ? result.buffer.toString('base64') : null,
                filename: result.filename,
                seed: result.seed,
                metadata: result.metadata,
                contentLength
            },
            timestamp: new Date().toISOString()
        });
        if (result.filename) {
            await broadcastGalleryMutation(handlers, wsServer, clientInfo, {
                viewType: 'images',
                action: 'append_top',
                filename: result.filename
            });
        }
    } catch (error) {
        handlers.stopKeepAliveInterval(requestId);
        handlers.sendToClient(ws, {
            type: 'max_enhance_image_error',
            requestId,
            data: null,
            error: error.message || 'Max Enhance failed',
            timestamp: new Date().toISOString()
        });
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

async function handleEnhanceImage(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        if (!message.filename) {
            throw new Error('Filename is required');
        }

        handlers.startKeepAliveInterval(ws, requestId, 15000);
        handlers.registerActiveGeneration(ws, requestId);

        const result = await enhanceImage(
            handlers.globalResources,
            message.filename,
            message.scale,
            clientInfo.sessionId,
            message.workspace || null,
            null,
            ws,
            handlers,
            requestId,
            {
                strength: message.strength,
                noise: message.noise,
                steps: message.steps,
                guidance: message.guidance,
                rescale: message.rescale,
                sampler: message.sampler,
                noiseScheduler: message.noiseScheduler,
                seed: message.seed,
                model: message.model
            }
        );

        handlers.stopKeepAliveInterval(requestId);
        const contentLength = handlers.resolveGeneratedImageContentLength(result);
        handlers.sendToClient(ws, {
            type: 'enhance_image_response',
            requestId,
            data: {
                image: result.buffer ? result.buffer.toString('base64') : null,
                filename: result.filename,
                seed: result.seed,
                metadata: result.metadata,
                contentLength
            },
            timestamp: new Date().toISOString()
        });
        if (result.filename) {
            await broadcastGalleryMutation(handlers, wsServer, clientInfo, {
                viewType: 'images',
                action: 'append_top',
                filename: result.filename
            });
        }
    } catch (error) {
        handlers.stopKeepAliveInterval(requestId);
        handlers.sendToClient(ws, {
            type: 'enhance_image_error',
            requestId,
            data: null,
            error: error.message || 'Enhance failed',
            timestamp: new Date().toISOString()
        });
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

async function handleImageExpansionReroll(handlers, ws, message, clientInfo, wsServer) {
    const requestId = message.requestId || 'unknown';

    try {
        const { requestId: _, enableStreaming, ...data } = message;
        console.log(`🔄 Processing image expansion reroll: ${requestId}`);

        if (!data.filename) {
            throw new Error('Filename is required');
        }

        const overrideParams = normalizeExpansionOverrideParams(data);
        console.log('📌 Normalized expansion reroll overrideParams:', overrideParams);

        handlers.startKeepAliveInterval(ws, requestId, 15000);
        handlers.registerActiveGeneration(ws, requestId);

        let streamingCallback = null;
        if (enableStreaming) {
            console.log('🎬 Starting streaming image expansion reroll...');
            streamingCallback = async (event) => {
            };
        }

        const result = await rerollExpandedImage(handlers.globalResources,
            data.filename,
            overrideParams,
            clientInfo.sessionId,
            data.workspace,
            streamingCallback,
            ws,
            handlers,
            requestId,
            data.stepPreviewWidth,
            data.stepPreviewHeight
        );

        handlers.stopKeepAliveInterval(requestId);

        handlers.sendToClient(ws, {
            type: 'image_expansion_reroll_response',
            requestId: requestId,
            data: {
                image: result.image,
                filename: result.filename,
                seed: result.seed,
                expansionPrompt: result.expansionPrompt,
                expansionReason: result.expansionReason,
                metadata: result.metadata
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Image expansion reroll error:', error);

        handlers.stopKeepAliveInterval(requestId);

        handlers.sendToClient(ws, {
            type: 'image_expansion_reroll_error',
            requestId: requestId,
            data: null,
            error: error.message || 'Image expansion reroll failed',
            timestamp: new Date().toISOString()
        });
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

async function handleCancelGeneration(handlers, ws, message, clientInfo, wsServer) {
    try {
        const ids = message.cancelledRequestIds || message.data?.cancelledRequestIds;
        if (Array.isArray(ids)) {
            for (const id of ids) {
                if (typeof id === 'string') {
                    handlers.markGenerationCancelled(id);
                    handlers.stopKeepAliveInterval(id);
                }
            }
        }

        handlers.sendToClient(ws, {
            type: 'cancel_generation_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Generation cancellation acknowledged'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error cancelling generation:', error);
        handlers.sendError(ws, 'Failed to cancel generation', error.message, message.requestId);
    }
}

async function handleDynamicGenerationProgress(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { phase, data } = message;

        wsServer.broadcast({
            type: 'dynamic_generation_progress_update',
            phase: phase,
            data: data,
            timestamp: new Date().toISOString(),
            sessionId: clientInfo.sessionId
        });
    } catch (error) {
        console.error('❌ Error handling dynamic generation progress:', error);
        handlers.sendError(ws, 'Failed to handle dynamic generation progress', error.message, message.requestId);
    }
}

async function handleResolveDynamicContext(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { dynamicConfig, requestId } = message;

        if (!dynamicConfig) {
            handlers.sendError(ws, 'Dynamic config is required', 'MISSING_CONFIG', requestId);
            return;
        }

        const resolvedContext = await resolveDynamicContext(handlers.globalResources, dynamicConfig, clientInfo.ip);

        handlers.sendToClient(ws, {
            type: 'resolve_dynamic_context_response',
            requestId: requestId,
            data: resolvedContext,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error resolving dynamic context:', error);
        handlers.sendError(ws, 'Failed to resolve dynamic context', error.message, message.requestId);
    }
}

async function handleCompileDynamicGeneration(handlers, ws, message, clientInfo, wsServer) {
    try {
        const body = message.data || message;
        const requestId = message.requestId || body.requestId;

        const result = await compileDynamicGenerationWebSocket(
            handlers.globalResources,
            body,
            ws,
            handlers,
            wsServer
        );

        handlers.sendToClient(ws, {
            type: 'compile_dynamic_generation_response',
            requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error compiling dynamic generation:', error);
        handlers.sendError(ws, 'Failed to compile dynamic generation', error.message, message.requestId);
    }
}

async function handleApplyTendaiPreview(handlers, ws, message, clientInfo, wsServer) {
    try {
        const body = message.data || message;
        const requestId = message.requestId || body.requestId;

        const result = await applyTendaiPreviewWebSocket(
            handlers.globalResources,
            body,
            ws,
            handlers,
            wsServer
        );

        handlers.sendToClient(ws, {
            type: 'apply_tendai_preview_response',
            requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error applying Tendai preview:', error);
        handlers.sendError(ws, 'Failed to apply Tendai replacements', error.message, message.requestId);
    }
}

async function handleResolveTextReplacements(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { text, presetName, model, periodKey, text_replacements_seed, requestId } = message;
        if (!text || typeof text !== 'string') {
            handlers.sendError(ws, 'Invalid text', 'Text is required', requestId);
            return;
        }

        const lockedReplacements = Array.isArray(text_replacements_seed) && text_replacements_seed.length
            ? text_replacements_seed
            : null;

        const result = handlers.globalResources.getTextReplacements().applyTextReplacements(
            text,
            presetName || null,
            model || null,
            periodKey || null,
            lockedReplacements,
            { stageIndex: 0, stageType: 'base', text_replacements: [], pipelineStageGeneration: false }
        );

        handlers.sendToClient(ws, {
            type: 'resolve_text_replacements_response',
            requestId,
            data: {
                success: true,
                text: result.text,
                replacements: result.replacements
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error resolving text replacements:', error);
        handlers.sendError(ws, 'Failed to resolve text replacements', error.message, message.requestId);
    }
}

module.exports = {
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
};
