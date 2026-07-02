const fs = require('fs');
const wsPacketRegistry = require('../wsPacketRegistry');

const NAX_DESTRUCTIVE = { destructive: true };

async function handleGetNaxGalleries(handler, ws, message, clientInfo, wsServer) {
    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const naxTagGeneration = handler.globalResources.getNaxTagGeneration();
        const generationSlugs = new Set(naxTagGeneration.getGenerationSlugs());
        const galleries = naxTagsDatabase.getGalleries().map((g) => ({
            ...g,
            generationEnabled: generationSlugs.has(g.slug)
        }));
        handler.sendToClient(ws, {
            type: 'get_nax_galleries_response',
            requestId: message.requestId,
            data: { galleries },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_nax_galleries:', error);
        handler.sendError(ws, 'Failed to list NAX galleries', error.message, message.requestId);
    }
}

async function handleGetNaxTags(handler, ws, message, clientInfo, wsServer) {
    const {
        gallerySlug,
        query = '',
        sort = 'score',
        invert = false,
        minUp,
        maxUp,
        minDown,
        maxDown,
        minScore,
        maxScore,
        minRatio,
        maxRatio,
        randomSeed,
        markFilter = 'all',
        offset = 0,
        limit = 50
    } = message;

    if (!gallerySlug) {
        handler.sendError(ws, 'Missing gallerySlug', 'get_nax_tags', message.requestId);
        return;
    }

    const sortKey = ['score', 'name', 'date', 'ratio', 'random'].includes(sort) ? sort : 'score';
    const markKey = ['all', 'favorites', 'try', 'unmarked', 'hidden', 'custom'].includes(markFilter) ? markFilter : 'all';
    const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
    let elevatePins = 0;
    if (typeof message.elevatePins !== 'undefined') {
        elevatePins = naxTagsDatabase.normalizeElevatePins(message.elevatePins);
    } else if (message.elevateFavorites === true) {
        elevatePins = 1;
    }

    try {
        const result = naxTagsDatabase.queryTags({
            gallerySlug,
            query,
            sort: sortKey,
            invert: !!invert,
            minUp,
            maxUp,
            minDown,
            maxDown,
            minScore,
            maxScore,
            minRatio,
            maxRatio,
            randomSeed: sortKey === 'random' ? randomSeed : null,
            markFilter: markKey,
            elevatePins,
            offset,
            limit
        });
        handler.sendToClient(ws, {
            type: 'get_nax_tags_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_nax_tags:', error);
        handler.sendError(ws, 'Failed to load NAX tags', error.message, message.requestId);
    }
}

async function handleGetNaxMarkedTags(handler, ws, message, clientInfo, wsServer) {
    const { markFilter = 'favorites', gallerySlug = null, limit = 500 } = message;
    const markKey = ['favorites', 'try'].includes(markFilter) ? markFilter : 'favorites';

    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const items = naxTagsDatabase.queryMarkedTags({
            markFilter: markKey,
            gallerySlug,
            limit
        });
        handler.sendToClient(ws, {
            type: 'get_nax_marked_tags_response',
            requestId: message.requestId,
            data: { items, markFilter: markKey },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_nax_marked_tags:', error);
        handler.sendError(ws, 'Failed to load marked NAX tags', error.message, message.requestId);
    }
}

async function handleGetNaxExpanderPresets(handler, ws, message, clientInfo, wsServer) {
    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const presets = naxTagsDatabase.getNaxExpanderPresetsForClient(message.model || null);
        handler.sendToClient(ws, {
            type: 'get_nax_expander_presets_response',
            requestId: message.requestId,
            data: { presets },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_nax_expander_presets:', error);
        handler.sendError(ws, 'Failed to load NAX expander presets', error.message, message.requestId);
    }
}

async function handleSetNaxFavorite(handler, ws, message, clientInfo, wsServer) {
    const { gallerySlug, tag, favorite } = message;
    if (!gallerySlug || !tag) {
        handler.sendError(ws, 'Missing gallerySlug or tag', 'set_nax_favorite', message.requestId);
        return;
    }

    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const out = naxTagsDatabase.setFavorite(gallerySlug, tag, !!favorite);
        handler.sendToClient(ws, {
            type: 'set_nax_favorite_response',
            requestId: message.requestId,
            data: { success: true, favorite: out.favorite },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('set_nax_favorite:', error);
        handler.sendError(ws, 'Failed to update favorite', error.message, message.requestId);
    }
}

async function handleSetNaxTry(handler, ws, message, clientInfo, wsServer) {
    const { gallerySlug, tag, tryMark } = message;
    if (!gallerySlug || !tag) {
        handler.sendError(ws, 'Missing gallerySlug or tag', 'set_nax_try', message.requestId);
        return;
    }

    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const out = naxTagsDatabase.setTryMark(gallerySlug, tag, !!tryMark);
        handler.sendToClient(ws, {
            type: 'set_nax_try_response',
            requestId: message.requestId,
            data: { success: true, tryMark: out.tryMark },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('set_nax_try:', error);
        handler.sendError(ws, 'Failed to update try mark', error.message, message.requestId);
    }
}

async function handleSetNaxHidden(handler, ws, message, clientInfo, wsServer) {
    const { gallerySlug, tag, hidden } = message;
    if (!gallerySlug || !tag) {
        handler.sendError(ws, 'Missing gallerySlug or tag', 'set_nax_hidden', message.requestId);
        return;
    }

    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const out = naxTagsDatabase.setHiddenMark(gallerySlug, tag, !!hidden);
        handler.sendToClient(ws, {
            type: 'set_nax_hidden_response',
            requestId: message.requestId,
            data: { success: true, hidden: out.hidden },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('set_nax_hidden:', error);
        handler.sendError(ws, 'Failed to update hidden mark', error.message, message.requestId);
    }
}

async function handleGenerateNaxCustomTag(handler, ws, message, clientInfo, wsServer) {
    const { gallerySlug, tag } = message;
    if (!gallerySlug || !tag) {
        handler.sendError(ws, 'Missing gallerySlug or tag', 'generate_nax_custom_tag', message.requestId);
        return;
    }

    const naxTagGeneration = handler.globalResources.getNaxTagGeneration();

    if (!naxTagGeneration.isValidCustomTag(tag)) {
        const validationError = naxTagGeneration.getCustomTagValidationError(tag) || 'Invalid tag';
        handler.sendError(ws, validationError, 'generate_nax_custom_tag', message.requestId);
        return;
    }

    const tagValue = naxTagGeneration.prepareTagInput(tag);

    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        if (!naxTagsDatabase.slugExists(gallerySlug)) {
            handler.sendError(ws, 'Unknown gallery', 'generate_nax_custom_tag', message.requestId);
            return;
        }
        if (naxTagsDatabase.tagExists(gallerySlug, tagValue)) {
            const existing = naxTagsDatabase.getTagRow(gallerySlug, tagValue);
            handler.sendToClient(ws, {
                type: 'generate_nax_custom_tag_response',
                requestId: message.requestId,
                data: { success: true, item: existing, alreadyExists: true },
                timestamp: new Date().toISOString()
            });
            return;
        }

        const { filename, absPath } = await naxTagGeneration.generateNaxTagImage(gallerySlug, tagValue);

        let item;
        try {
            item = naxTagsDatabase.insertCustomTag(gallerySlug, tagValue, filename);
        } catch (dbErr) {
            try {
                if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
            } catch {
                /* */
            }
            throw dbErr;
        }

        handler.sendToClient(ws, {
            type: 'generate_nax_custom_tag_response',
            requestId: message.requestId,
            data: { success: true, item },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('generate_nax_custom_tag:', error);
        handler.sendError(ws, 'Failed to generate custom NAX tag', error.message, message.requestId);
    }
}

async function handleDeleteNaxCustomTag(handler, ws, message, clientInfo, wsServer) {
    const { gallerySlug, tag } = message;
    if (!gallerySlug || !tag) {
        handler.sendError(ws, 'Missing gallerySlug or tag', 'delete_nax_custom_tag', message.requestId);
        return;
    }

    const naxTagGeneration = handler.globalResources.getNaxTagGeneration();
    const tagValue = naxTagGeneration.prepareTagInput(tag);

    try {
        const naxTagsDatabase = handler.globalResources.getNaxTagsDatabase();
        const out = naxTagsDatabase.deleteCustomTag(gallerySlug, tagValue);
        handler.sendToClient(ws, {
            type: 'delete_nax_custom_tag_response',
            requestId: message.requestId,
            data: { success: true, ...out },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('delete_nax_custom_tag:', error);
        handler.sendError(ws, 'Failed to delete custom NAX tag', error.message, message.requestId);
    }
}

async function handleGetNaxVibesGallery(handler, ws, message, clientInfo, wsServer) {
    try {
        const naxVibes = handler.globalResources.getNaxVibesGallery();
        const data = await naxVibes.getNaxVibesGallery({
            preset: message.preset || null,
            page: message.page,
            search: message.search,
            filter45Curated: message.filter45Curated,
            filter45Full: message.filter45Full,
            filter4Curated: message.filter4Curated,
            filter4Full: message.filter4Full,
            forceRefresh: !!message.forceRefresh
        });
        handler.sendToClient(ws, {
            type: 'get_nax_vibes_gallery_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_nax_vibes_gallery:', error);
        handler.sendError(ws, 'Failed to load NAX vibes gallery', error.message, message.requestId);
    }
}

async function handleClearNaxVibesGalleryCache(handler, ws, message, clientInfo, wsServer) {
    try {
        const naxVibes = handler.globalResources.getNaxVibesGallery();
        const data = naxVibes.clearNaxVibesGalleryCache();
        handler.sendToClient(ws, {
            type: 'clear_nax_vibes_gallery_cache_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('clear_nax_vibes_gallery_cache:', error);
        handler.sendError(ws, 'Failed to clear NAX vibes cache', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[100-naxHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'nax', ...meta });
    };

    regFn('get_nax_galleries', handleGetNaxGalleries);
    regFn('get_nax_tags', handleGetNaxTags);
    regFn('get_nax_marked_tags', handleGetNaxMarkedTags);
    regFn('get_nax_expander_presets', handleGetNaxExpanderPresets);
    regFn('set_nax_favorite', handleSetNaxFavorite);
    regFn('set_nax_try', handleSetNaxTry);
    regFn('set_nax_hidden', handleSetNaxHidden);
    regFn('generate_nax_custom_tag', handleGenerateNaxCustomTag, NAX_DESTRUCTIVE);
    regFn('delete_nax_custom_tag', handleDeleteNaxCustomTag, NAX_DESTRUCTIVE);
    regFn('get_nax_vibes_gallery', handleGetNaxVibesGallery);
    regFn('clear_nax_vibes_gallery_cache', handleClearNaxVibesGalleryCache);
}

module.exports = {
    registerPackets,
    handleGetNaxGalleries,
    handleGetNaxTags,
    handleGetNaxMarkedTags,
    handleGetNaxExpanderPresets,
    handleSetNaxFavorite,
    handleSetNaxTry,
    handleSetNaxHidden,
    handleGenerateNaxCustomTag,
    handleDeleteNaxCustomTag,
    handleGetNaxVibesGallery,
    handleClearNaxVibesGalleryCache
};
