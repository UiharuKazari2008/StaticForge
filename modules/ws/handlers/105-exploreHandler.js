/**
 * NovelAI Explore (Agora) WebSocket packets
 */

const wsPacketRegistry = require('../wsPacketRegistry');

function exploreApiOpts(handler, message) {
    const apiKeyManager = handler.globalResources.getApiKeyManager();
    return {
        getApiKey: () => apiKeyManager.getActiveApiKey('novelai'),
        apiKey: apiKeyManager.getActiveApiKey('novelai'),
        apiKeyManager
    };
}

/** config.json novelaiExplore.uploadsEnabled — must be explicitly true to allow POSTs */
function exploreUploadsEnabled(handler) {
    try {
        const cfg = handler.globalResources.getConfig({ path: 'novelaiExplore' });
        return cfg?.uploadsEnabled === true;
    } catch {
        return false;
    }
}

function exploreUploadOpts(handler, message) {
    return {
        ...exploreApiOpts(handler, message),
        uploadsEnabled: exploreUploadsEnabled(handler),
        imagesDir: handler.globalResources.getPath('images'),
        // getPngMetadata: modules/globalResources.js
        pngMetadata: handler.globalResources.getPngMetadata()
    };
}

async function handleGetNovelaiExploreGallery(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = await explore.getExploreGallery({
            sort: message.sort,
            period: message.period,
            search: message.search,
            creatorId: message.creatorId,
            page: message.page,
            offset: message.offset,
            limit: message.limit,
            forceRefresh: !!message.forceRefresh,
            likedBySelf: !!message.likedBySelf,
            sortDirection: message.sortDirection,
            ...exploreApiOpts(handler, message)
        });
        handler.sendToClient(ws, {
            type: 'get_novelai_explore_gallery_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_novelai_explore_gallery:', error);
        if (error.code === 'EXPLORE_NOT_REGISTERED') {
            handler.sendError(ws, 'Explore registration required', error.message, message.requestId);
            return;
        }
        handler.sendError(ws, 'Failed to load Explore gallery', error.message, message.requestId);
    }
}

async function handleGetNovelaiExploreUser(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = await explore.getExploreUserSelf({
            forceRefresh: !!message.forceRefresh,
            ...exploreApiOpts(handler, message)
        });
        handler.sendToClient(ws, {
            type: 'get_novelai_explore_user_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_novelai_explore_user:', error);
        handler.sendError(ws, 'Failed to load Explore user', error.message, message.requestId);
    }
}

async function handleGetNovelaiExplorePost(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = await explore.getExplorePost(message.id, exploreApiOpts(handler, message));
        handler.sendToClient(ws, {
            type: 'get_novelai_explore_post_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_novelai_explore_post:', error);
        handler.sendError(ws, 'Failed to load Explore post', error.message, message.requestId);
    }
}

async function handleSetNovelaiExplorePostLike(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const like = message.like !== false && message.like !== 0 && message.like !== '0';
        const data = await explore.setExplorePostLike(message.id, like, exploreApiOpts(handler, message));
        handler.sendToClient(ws, {
            type: 'set_novelai_explore_post_like_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('set_novelai_explore_post_like:', error);
        handler.sendToClient(ws, {
            type: 'set_novelai_explore_post_like_response',
            requestId: message.requestId,
            error: error.message,
            code: error.code || null,
            registerUrl: error.registerUrl || null,
            timestamp: new Date().toISOString()
        });
    }
}

async function handleDownvoteNovelaiExplorePost(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const undo = !!message.undo;
        const data = undo
            ? explore.removeExploreUndesiredId(message.id)
            : explore.addExploreUndesiredId(message.id);
        handler.sendToClient(ws, {
            type: 'downvote_novelai_explore_post_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('downvote_novelai_explore_post:', error);
        handler.sendError(ws, 'Failed to update Explore downvote list', error.message, message.requestId);
    }
}

async function handleBlockNovelaiExploreCreator(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const undo = !!message.undo;
        const data = undo
            ? explore.removeExploreBlockedCreator(message.id)
            : explore.addExploreBlockedCreator(message.id, message.name || '');
        handler.sendToClient(ws, {
            type: 'block_novelai_explore_creator_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('block_novelai_explore_creator:', error);
        handler.sendError(ws, 'Failed to update Explore blocked creators', error.message, message.requestId);
    }
}

async function handleListNovelaiExploreBlockedCreators(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = explore.listExploreBlockedCreators();
        handler.sendToClient(ws, {
            type: 'list_novelai_explore_blocked_creators_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('list_novelai_explore_blocked_creators:', error);
        handler.sendError(ws, 'Failed to list Explore blocked creators', error.message, message.requestId);
    }
}

async function handleClearNovelaiExploreGalleryCache(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = explore.clearExploreGalleryCache({
            clearImages: !!message.clearImages
        });
        handler.sendToClient(ws, {
            type: 'clear_novelai_explore_gallery_cache_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('clear_novelai_explore_gallery_cache:', error);
        handler.sendError(ws, 'Failed to clear Explore gallery cache', error.message, message.requestId);
    }
}

async function handleEnsureNovelaiExploreImage(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const kind = message.kind === 'blob' ? 'blob'
            : message.kind === 'png' ? 'png'
                : 'thumbnail';
        const data = await explore.ensureExploreImage(message.id, kind, {
            ...exploreApiOpts(handler, message),
            // getPngMetadata: modules/globalResources.js — embed Comment/Source on png export
            pngMetadata: kind === 'png' ? handler.globalResources.getPngMetadata() : null,
            naiMetadata: message.naiMetadata || message.nai_metadata || null,
            forceRefresh: !!message.forceRefresh
        });
        let post = null;
        if (typeof explore.getExplorePostFromCache === 'function') {
            post = explore.getExplorePostFromCache(message.id);
        }
        handler.sendToClient(ws, {
            type: 'ensure_novelai_explore_image_response',
            requestId: message.requestId,
            data: { ...data, post },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('ensure_novelai_explore_image:', error);
        handler.sendError(ws, 'Failed to ensure Explore image', error.message, message.requestId);
    }
}

async function handleCheckNovelaiExploreUpload(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = await explore.checkExploreUploadImage(message.filename, {
            ...exploreUploadOpts(handler, message),
            forceRefreshUser: !!message.forceRefresh
        });
        handler.sendToClient(ws, {
            type: 'check_novelai_explore_upload_response',
            requestId: message.requestId,
            data: { success: true, ...data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('check_novelai_explore_upload:', error);
        // Soft-fail in data so client Promise resolves (websocket.js resolveRequest rejects on top-level error)
        handler.sendToClient(ws, {
            type: 'check_novelai_explore_upload_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: error.message,
                code: error.code || null,
                registerUrl: error.registerUrl || null,
                uploadsEnabled: exploreUploadsEnabled(handler)
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleUploadNovelaiExploreImage(handler, ws, message, clientInfo, wsServer) {
    try {
        const explore = handler.globalResources.getNovelaiExploreGallery();
        const data = await explore.uploadExploreImage(
            message.filename,
            message.title,
            exploreUploadOpts(handler, message)
        );
        handler.sendToClient(ws, {
            type: 'upload_novelai_explore_image_response',
            requestId: message.requestId,
            data: { success: true, ...data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('upload_novelai_explore_image:', error);
        handler.sendToClient(ws, {
            type: 'upload_novelai_explore_image_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: error.message,
                code: error.code || null,
                registerUrl: error.registerUrl || null,
                restriction: error.restriction || null,
                uploadsEnabled: exploreUploadsEnabled(handler)
            },
            timestamp: new Date().toISOString()
        });
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[105-exploreHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'explore', ...meta });
    };

    regFn('get_novelai_explore_gallery', handleGetNovelaiExploreGallery);
    regFn('get_novelai_explore_user', handleGetNovelaiExploreUser);
    regFn('get_novelai_explore_post', handleGetNovelaiExplorePost);
    regFn('set_novelai_explore_post_like', handleSetNovelaiExplorePostLike);
    regFn('downvote_novelai_explore_post', handleDownvoteNovelaiExplorePost);
    regFn('block_novelai_explore_creator', handleBlockNovelaiExploreCreator);
    regFn('list_novelai_explore_blocked_creators', handleListNovelaiExploreBlockedCreators);
    regFn('clear_novelai_explore_gallery_cache', handleClearNovelaiExploreGalleryCache);
    regFn('ensure_novelai_explore_image', handleEnsureNovelaiExploreImage);
    regFn('check_novelai_explore_upload', handleCheckNovelaiExploreUpload);
    regFn('upload_novelai_explore_image', handleUploadNovelaiExploreImage);
}

module.exports = {
    registerPackets,
    handleGetNovelaiExploreGallery,
    handleGetNovelaiExploreUser,
    handleGetNovelaiExplorePost,
    handleSetNovelaiExplorePostLike,
    handleDownvoteNovelaiExplorePost,
    handleBlockNovelaiExploreCreator,
    handleListNovelaiExploreBlockedCreators,
    handleClearNovelaiExploreGalleryCache,
    handleEnsureNovelaiExploreImage,
    handleCheckNovelaiExploreUpload,
    handleUploadNovelaiExploreImage
};
