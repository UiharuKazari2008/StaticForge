const wsPacketRegistry = require('../wsPacketRegistry');

const KNOWLEDGE_DESTRUCTIVE = { destructive: true };

const KNOWLEDGE_FILTER_DESCRIPTIONS = {
    low_confidence: 'Low Confidence (< 30%)',
    old_usage: '>30 Days Usage',
    never_used: 'Never Used',
    everything: 'Everything'
};

const VALID_KNOWLEDGE_FILTERS = ['low_confidence', 'old_usage', 'never_used', 'everything'];

async function handleListKnowledgeMemories(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { requestId, limit, offset, search, category, page, perPage } = message;

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const wantsPaging = (limit != null || offset != null || search != null || category != null || page != null || perPage != null);

        let memories;
        let total = null;
        let respPage = 1;
        let respPerPage = 25;

        if (wantsPaging) {
            const p = parseInt(page, 10);
            const pp = parseInt(perPage, 10);
            if (p > 0 && pp > 0) {
                respPage = p;
                respPerPage = Math.max(1, Math.min(200, pp));
                const computedOffset = (respPage - 1) * respPerPage;
                const res = knowledgeMemoryDb.listKnowledgeMemoriesPaged({
                    limit: respPerPage,
                    offset: computedOffset,
                    search: search || '',
                    category: category || null
                });
                memories = res.items;
                total = res.total;
            } else {
                const lim = parseInt(limit, 10) || 25;
                const off = parseInt(offset, 10) || 0;
                respPerPage = Math.max(1, Math.min(200, lim));
                respPage = Math.floor(off / respPerPage) + 1;
                const res = knowledgeMemoryDb.listKnowledgeMemoriesPaged({
                    limit: respPerPage,
                    offset: off,
                    search: search || '',
                    category: category || null
                });
                memories = res.items;
                total = res.total;
            }
        } else {
            memories = knowledgeMemoryDb.listKnowledgeMemories();
            total = memories.length;
        }

        const stats = knowledgeMemoryDb.getKnowledgeMemoryStats();

        console.log(`📚 Listed ${memories.length} knowledge memories (paged=${wantsPaging})`);

        handlersCtx.sendToClient(ws, {
            type: 'list_knowledge_memories_response',
            data: {
                success: true,
                memories: memories,
                total: (total != null ? total : memories.length),
                page: respPage,
                perPage: respPerPage,
                stats: stats
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error listing knowledge memories:', error);
        handlersCtx.sendError(ws, 'Failed to list knowledge memories', error.message, message.requestId);
    }
}

async function handleGetKnowledgeMemory(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { name, requestId } = message;

        if (!name) {
            handlersCtx.sendError(ws, 'Memory name is required', 'MISSING_NAME', requestId);
            return;
        }

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const memory = knowledgeMemoryDb.getKnowledgeMemory(name, false);

        if (!memory) {
            handlersCtx.sendError(ws, `Memory "${name}" not found`, 'MEMORY_NOT_FOUND', requestId);
            return;
        }

        console.log(`👁️ Viewed knowledge memory (no usage increment): ${name}`);

        handlersCtx.sendToClient(ws, {
            type: 'get_knowledge_memory_response',
            data: {
                success: true,
                memory: memory
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error getting knowledge memory:', error);
        handlersCtx.sendError(ws, 'Failed to get knowledge memory', error.message, message.requestId);
    }
}

async function handleDeleteKnowledgeMemory(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { name, requestId } = message;

        if (!name) {
            handlersCtx.sendError(ws, 'Memory name is required', 'MISSING_NAME', requestId);
            return;
        }

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const success = knowledgeMemoryDb.deleteKnowledgeMemory(name);

        if (!success) {
            handlersCtx.sendError(ws, `Memory "${name}" not found`, 'MEMORY_NOT_FOUND', requestId);
            return;
        }

        console.log(`🗑️ Deleted knowledge memory: ${name}`);

        handlersCtx.sendToClient(ws, {
            type: 'delete_knowledge_memory_response',
            data: {
                success: true,
                message: `Memory "${name}" deleted successfully`
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error deleting knowledge memory:', error);
        handlersCtx.sendError(ws, 'Failed to delete knowledge memory', error.message, message.requestId);
    }
}

async function handleDeleteKnowledgeMemoriesBulk(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { names, requestId } = message;

        if (!Array.isArray(names) || names.length === 0) {
            handlersCtx.sendError(ws, 'Memory names array is required and must not be empty', 'MISSING_NAMES', requestId);
            return;
        }

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const result = knowledgeMemoryDb.deleteKnowledgeMemoriesBulk(names);

        console.log(`🗑️ Bulk deleted ${result.deletedCount} knowledge memor${result.deletedCount === 1 ? 'y' : 'ies'}`);
        if (result.failedNames.length > 0) {
            console.log(`⚠️ Failed to delete ${result.failedNames.length} memor${result.failedNames.length === 1 ? 'y' : 'ies'}: ${result.failedNames.join(', ')}`);
        }

        handlersCtx.sendToClient(ws, {
            type: 'delete_knowledge_memories_bulk_response',
            data: {
                success: true,
                deletedCount: result.deletedCount,
                failedNames: result.failedNames,
                message: `Deleted ${result.deletedCount} memor${result.deletedCount === 1 ? 'y' : 'ies'}${result.failedNames.length > 0 ? `, ${result.failedNames.length} failed` : ''}`
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error bulk deleting knowledge memories:', error);
        handlersCtx.sendError(ws, 'Failed to bulk delete knowledge memories', error.message, message.requestId);
    }
}

async function handleCountKnowledgeMemoriesByFilter(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { filterType, requestId } = message;

        if (!filterType) {
            handlersCtx.sendError(ws, 'Filter type is required', 'MISSING_FILTER_TYPE', requestId);
            return;
        }

        if (!VALID_KNOWLEDGE_FILTERS.includes(filterType)) {
            handlersCtx.sendError(ws, `Invalid filter type. Must be one of: ${VALID_KNOWLEDGE_FILTERS.join(', ')}`, 'INVALID_FILTER_TYPE', requestId);
            return;
        }

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const count = knowledgeMemoryDb.countKnowledgeMemoriesByFilter(filterType);

        handlersCtx.sendToClient(ws, {
            type: 'count_knowledge_memories_by_filter_response',
            data: {
                success: true,
                count: count,
                filterType: filterType,
                description: KNOWLEDGE_FILTER_DESCRIPTIONS[filterType]
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error counting knowledge memories by filter:', error);
        handlersCtx.sendError(ws, 'Failed to count knowledge memories by filter', error.message, message.requestId);
    }
}

async function handleDeleteKnowledgeMemoriesByFilter(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { filterType, requestId } = message;

        if (!filterType) {
            handlersCtx.sendError(ws, 'Filter type is required', 'MISSING_FILTER_TYPE', requestId);
            return;
        }

        if (!VALID_KNOWLEDGE_FILTERS.includes(filterType)) {
            handlersCtx.sendError(ws, `Invalid filter type. Must be one of: ${VALID_KNOWLEDGE_FILTERS.join(', ')}`, 'INVALID_FILTER_TYPE', requestId);
            return;
        }

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const result = knowledgeMemoryDb.deleteKnowledgeMemoriesByFilter(filterType);

        console.log(`🗑️ Deleted ${result.deletedCount} knowledge memor${result.deletedCount === 1 ? 'y' : 'ies'} matching "${KNOWLEDGE_FILTER_DESCRIPTIONS[filterType]}"`);

        handlersCtx.sendToClient(ws, {
            type: 'delete_knowledge_memories_by_filter_response',
            data: {
                success: true,
                deletedCount: result.deletedCount,
                matchedCount: result.matchedCount,
                filterType: filterType,
                message: `Deleted ${result.deletedCount} memor${result.deletedCount === 1 ? 'y' : 'ies'} matching "${KNOWLEDGE_FILTER_DESCRIPTIONS[filterType]}"`
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error deleting knowledge memories by filter:', error);
        handlersCtx.sendError(ws, 'Failed to delete knowledge memories by filter', error.message, message.requestId);
    }
}

async function handleUpdateKnowledgeMemory(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { name, updates, requestId } = message;

        if (!name) {
            handlersCtx.sendError(ws, 'Memory name is required', 'MISSING_NAME', requestId);
            return;
        }

        if (!updates || typeof updates !== 'object') {
            handlersCtx.sendError(ws, 'Updates object is required', 'MISSING_UPDATES', requestId);
            return;
        }

        const knowledgeMemoryDb = handlersCtx.globalResources.getKnowledgeMemoryDb();

        if (!knowledgeMemoryDb) {
            handlersCtx.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
            return;
        }

        const existingMemory = knowledgeMemoryDb.getKnowledgeMemory(name, false);
        if (!existingMemory) {
            handlersCtx.sendError(ws, `Memory "${name}" not found`, 'MEMORY_NOT_FOUND', requestId);
            return;
        }

        const updatedName = updates.name || existingMemory.name;
        const updatedDescription = updates.description !== undefined ? updates.description : existingMemory.description;
        const updatedCategory = updates.category !== undefined ? updates.category : existingMemory.category;
        const updatedConfidence = updates.confidence !== undefined ? updates.confidence : existingMemory.confidence;
        const updatedEntities = updates.entities !== undefined ? updates.entities : existingMemory.entities;
        const updatedRelations = updates.relations !== undefined ? updates.relations : existingMemory.relations;
        const updatedObservations = updates.observations !== undefined ? updates.observations : existingMemory.observations;

        let finalName = updatedName;
        if (updates.name && updates.name !== name) {
            const existingWithNewName = knowledgeMemoryDb.getKnowledgeMemory(updates.name, false);
            if (existingWithNewName) {
                handlersCtx.sendError(ws, `Memory with name "${updates.name}" already exists`, 'NAME_EXISTS', requestId);
                return;
            }
            finalName = updates.name;
        }

        const formattedEntities = updatedEntities.map((entity, index) => ({
            id: entity.id || entity.name || `entity_${Date.now()}_${index}`,
            type: entity.type || '',
            name: entity.name || '',
            attributes: entity.attributes || {}
        }));

        const formattedObservations = updatedObservations.map((obs) => ({
            entity_id: obs.entity_id || '',
            content: obs.content || '',
            importance: obs.importance !== undefined ? obs.importance : 0.5
        }));

        if (updates.name && updates.name !== name) {
            knowledgeMemoryDb.deleteKnowledgeMemory(name);
        }

        const result = knowledgeMemoryDb.saveKnowledgeMemory(
            finalName,
            updatedDescription,
            updatedCategory,
            formattedEntities,
            updatedRelations,
            formattedObservations,
            updatedConfidence
        );

        console.log(`✏️ Updated knowledge memory: ${name}${updates.name && updates.name !== name ? ` (renamed to ${finalName})` : ''}`);

        handlersCtx.sendToClient(ws, {
            type: 'update_knowledge_memory_response',
            data: {
                success: true,
                memory: result,
                message: `Memory updated successfully${updates.name && updates.name !== name ? ` and renamed to "${finalName}"` : ''}`
            },
            timestamp: new Date().toISOString(),
            requestId: requestId
        });

    } catch (error) {
        console.error('❌ Error updating knowledge memory:', error);
        handlersCtx.sendError(ws, 'Failed to update knowledge memory', error.message, message.requestId);
    }
}

/**
 * Register knowledge memory WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[220-knowledgeHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'knowledge', ...meta });
    };

    reg('list_knowledge_memories', handleListKnowledgeMemories);
    reg('get_knowledge_memory', handleGetKnowledgeMemory);
    reg('delete_knowledge_memory', handleDeleteKnowledgeMemory, KNOWLEDGE_DESTRUCTIVE);
    reg('delete_knowledge_memories_bulk', handleDeleteKnowledgeMemoriesBulk, KNOWLEDGE_DESTRUCTIVE);
    reg('count_knowledge_memories_by_filter', handleCountKnowledgeMemoriesByFilter);
    reg('delete_knowledge_memories_by_filter', handleDeleteKnowledgeMemoriesByFilter, KNOWLEDGE_DESTRUCTIVE);
    reg('update_knowledge_memory', handleUpdateKnowledgeMemory, KNOWLEDGE_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
