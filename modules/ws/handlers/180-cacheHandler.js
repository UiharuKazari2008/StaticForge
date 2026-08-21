const wsPacketRegistry = require('../wsPacketRegistry');
const runtimeAssetService = require('../../runtimeAssetService');
const { broadcastGalleryMutation } = require('./120-galleryHandler');

const CACHE_DESTRUCTIVE = { destructive: true };
const SYSTEM_DESTRUCTIVE = { destructive: true };

async function handleGetCacheManifest(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const globalCacheData = handlersCtx.globalResources.getGlobalCacheData();

        handlersCtx.sendToClient(ws, {
            type: 'cache_manifest_response',
            requestId: message.requestId,
            data: {
                assets: globalCacheData || [],
                timestamp: Date.now().valueOf()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Cache manifest error:', error);
        handlersCtx.sendError(ws, 'Failed to get cache manifest', error.message, message.requestId);
    }
}

async function handleRefreshServerCache(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendToClient(ws, {
                type: 'refresh_server_cache_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Admin access required to refresh server cache'
                },
                timestamp: new Date().toISOString()
            });
            return;
        }

        console.log('🔄 Admin requested server cache refresh via WebSocket...');

        handlersCtx.startKeepAliveInterval(ws, message.requestId, 5000);

        const compileResult = await runtimeAssetService.recompileAndRefresh({
            showConsoleProgress: true
        });

        handlersCtx.stopKeepAliveInterval(message.requestId);

        const globalCacheData = handlersCtx.globalResources.getGlobalCacheData();
        const compileOk = compileResult.errors.length === 0;

        console.log(`✅ Server cache refreshed via WebSocket: ${globalCacheData.length} assets (${compileResult.compiled} compiled)`);

        handlersCtx.sendToClient(ws, {
            type: 'refresh_server_cache_response',
            requestId: message.requestId,
            data: {
                success: compileOk,
                message: compileOk
                    ? 'Server cache refreshed successfully'
                    : 'Runtime assets recompiled with errors',
                assetsCount: globalCacheData.length,
                compiled: compileResult.compiled,
                failedCount: compileResult.errors.length,
                errors: compileResult.errors,
                timestamp: Date.now().valueOf(),
                assets: globalCacheData
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        handlersCtx.stopKeepAliveInterval(message.requestId);

        console.error('❌ Server cache refresh error:', error);
        handlersCtx.sendToClient(ws, {
            type: 'refresh_server_cache_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: 'Failed to refresh server cache',
                details: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleRebuildMetadataCache(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendToClient(ws, {
                type: 'rebuild_metadata_cache_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Admin access required to rebuild metadata cache'
                },
                timestamp: new Date().toISOString()
            });
            return;
        }

        console.log('🔄 Admin requested metadata cache rebuild via WebSocket...');

        handlersCtx.startKeepAliveInterval(ws, message.requestId, 10000);

        let lastSentPercentage = -1;

        const progressCallback = (progress) => {
            const currentPercentage = parseInt((Math.floor((progress.current / progress.total) * 100)).toFixed(0));

            if (currentPercentage > lastSentPercentage) {
                handlersCtx.sendToClient(ws, {
                    type: 'rebuild_metadata_cache_progress',
                    requestId: message.requestId,
                    data: {
                        current: progress.current,
                        total: progress.total,
                        filename: progress.filename,
                        updatedCount: progress.updatedCount,
                        errorCount: progress.errorCount,
                        percentage: currentPercentage
                    },
                    timestamp: new Date().toISOString()
                });
                lastSentPercentage = currentPercentage;
            }
        };

        const result = await handlersCtx.globalResources.getMetadataDatabase().rebuildMetadataCache(
            handlersCtx.globalResources.getPath('images'),
            progressCallback
        );

        handlersCtx.stopKeepAliveInterval(message.requestId);

        console.log(`✅ Metadata cache rebuilt successfully: ${result.updatedCount} files updated, ${result.errorCount} errors`);

        handlersCtx.sendToClient(ws, {
            type: 'rebuild_metadata_cache_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Metadata cache rebuilt successfully',
                updatedCount: result.updatedCount,
                errorCount: result.errorCount,
                totalFiles: result.totalFiles,
                timestamp: Date.now().valueOf()
            },
            timestamp: new Date().toISOString()
        });

        await broadcastGalleryMutation(handlersCtx, wsServer, clientInfo, {
            viewType: 'images',
            action: 'invalidate_sync'
        });

    } catch (error) {
        handlersCtx.stopKeepAliveInterval(message.requestId);

        console.error('❌ Metadata cache rebuild error:', error);
        handlersCtx.sendToClient(ws, {
            type: 'rebuild_metadata_cache_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: 'Failed to rebuild metadata cache',
                details: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleClearSearchCache(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendToClient(ws, {
                type: 'clear_search_cache_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Admin access required to clear search cache'
                },
                timestamp: new Date().toISOString()
            });
            return;
        }

        console.log('🔄 Admin requested search cache clear via WebSocket...');

        const tagSearchDatabase = handlersCtx.globalResources.getTagSearchDatabase();
        const result = tagSearchDatabase.clearAllCache();

        console.log(`✅ Search cache cleared successfully: ${result.total} entries removed`);

        handlersCtx.sendToClient(ws, {
            type: 'clear_search_cache_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Search cache cleared successfully',
                deletedCount: result,
                timestamp: Date.now().valueOf()
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Search cache clear error:', error);
        handlersCtx.sendToClient(ws, {
            type: 'clear_search_cache_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: 'Failed to clear search cache',
                details: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleBroadcastResourceUpdate(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required to broadcast resource updates', null, message.requestId);
            return;
        }

        const { updateType, message: updateMessage, files } = message;

        console.log('🔄 Admin broadcasting resource update:', updateType, updateMessage);

        wsServer.broadcastToAll({
            type: 'resource_update_available',
            data: {
                updateType: updateType || 'general',
                message: updateMessage || 'Resource updates are available',
                files: files || [],
                timestamp: Date.now().valueOf(),
                requiresRestart: true
            },
            timestamp: new Date().toISOString()
        });

        handlersCtx.sendToClient(ws, {
            type: 'broadcast_resource_update_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Resource update broadcast sent to all clients',
                clientsNotified: wsServer.getConnectionCount()
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error broadcasting resource update:', error);
        handlersCtx.sendToClient(ws, {
            type: 'broadcast_resource_update_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: 'Failed to broadcast resource update',
                details: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleRecompileRuntimeAssets(handlersCtx, ws, message, clientInfo, wsServer) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendToClient(ws, {
            type: 'recompile_runtime_assets_response',
            requestId: message.requestId,
            data: { success: false, error: 'Admin access required' },
            timestamp: new Date().toISOString()
        });
        return;
    }

    try {
        const result = await runtimeAssetService.recompileAndRefresh({
            force: message.data && message.data.force === true,
            silent: message.data && message.data.silent === true,
            showConsoleProgress: true
        });

        handlersCtx.sendToClient(ws, {
            type: 'recompile_runtime_assets_response',
            requestId: message.requestId,
            data: {
                success: result.errors.length === 0,
                compiled: result.compiled,
                failedCount: result.errors.length,
                errors: result.errors,
                stats: result.stats || null
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error recompiling runtime assets:', error);
        handlersCtx.sendToClient(ws, {
            type: 'recompile_runtime_assets_response',
            requestId: message.requestId,
            data: { success: false, error: error.message },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleSetRuntimeAssetsAutoRecompile(handlersCtx, ws, message, clientInfo, wsServer) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendToClient(ws, {
            type: 'set_runtime_assets_auto_recompile_response',
            requestId: message.requestId,
            data: { success: false, error: 'Admin access required' },
            timestamp: new Date().toISOString()
        });
        return;
    }

    try {
        const enabled = message.data && message.data.enabled === true;
        handlersCtx.globalResources.updateConfigValue('config', ['runtimeAssets', 'autoRecompile'], enabled, {
            save: true,
            reload: true
        });

        handlersCtx.sendToClient(ws, {
            type: 'set_runtime_assets_auto_recompile_response',
            requestId: message.requestId,
            data: {
                success: true,
                autoRecompile: runtimeAssetService.isAutoRecompileEnabled()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error updating runtime auto-recompile setting:', error);
        handlersCtx.sendToClient(ws, {
            type: 'set_runtime_assets_auto_recompile_response',
            requestId: message.requestId,
            data: { success: false, error: error.message },
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Register cache manifest, server cache, and runtime asset WebSocket packet handlers.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[180-cacheHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regCache = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'cache', ...meta });
    };

    const regSystem = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'system', ...meta });
    };

    regCache('get_cache_manifest', handleGetCacheManifest);
    regCache('refresh_server_cache', handleRefreshServerCache, CACHE_DESTRUCTIVE);
    regCache('rebuild_metadata_cache', handleRebuildMetadataCache, CACHE_DESTRUCTIVE);
    regCache('clear_search_cache', handleClearSearchCache, CACHE_DESTRUCTIVE);
    regCache('broadcast_resource_update', handleBroadcastResourceUpdate);
    regSystem('recompile_runtime_assets', handleRecompileRuntimeAssets, SYSTEM_DESTRUCTIVE);
    regSystem('set_runtime_assets_auto_recompile', handleSetRuntimeAssetsAutoRecompile, SYSTEM_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
