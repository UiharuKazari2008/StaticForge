/**
 * Character database (SQLite) browse + CRUD WebSocket handlers.
 * modules/charactersDatabase.js
 */
const wsPacketRegistry = require('../wsPacketRegistry');

const CHARACTER_DB_DESTRUCTIVE = { destructive: true };

function getDb(handlers) {
    return handlers.globalResources.getCharactersDatabase();
}

function refreshCache(handlers) {
    if (typeof handlers.globalResources.refreshCharacterDataCache === 'function') {
        return handlers.globalResources.refreshCharacterDataCache();
    }
    return handlers.globalResources.getCharacterData();
}

function validateCharacterPayload(character) {
    if (!character || typeof character !== 'object' || Array.isArray(character)) {
        return 'character must be an object';
    }
    if (typeof character.name !== 'string' || !character.name.trim()) {
        return 'character.name is required';
    }
    if (character.copyright != null && typeof character.copyright !== 'string') {
        return 'character.copyright must be a string';
    }
    if (character.prompt != null && typeof character.prompt !== 'string') {
        return 'character.prompt must be a string';
    }
    if (character.enhancers != null) {
        if (!Array.isArray(character.enhancers)) {
            return 'character.enhancers must be an array of string arrays';
        }
        for (const group of character.enhancers) {
            if (!Array.isArray(group) || !group.every((t) => typeof t === 'string')) {
                return 'character.enhancers must be an array of string arrays';
            }
        }
    }
    return null;
}

async function handleGetCharacterDb(handlers, ws, message) {
    try {
        const data = refreshCache(handlers);
        handlers.sendToClient(ws, {
            type: 'get_character_db_response',
            requestId: message.requestId,
            data: {
                data,
                copyrights: getDb(handlers).listCopyrights()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_character_db:', error);
        handlers.sendError(ws, 'Failed to load character database', error.message, message.requestId);
    }
}

async function handleCharacterDbUpsert(handlers, ws, message) {
    try {
        const err = validateCharacterPayload(message.character);
        if (err) {
            handlers.sendError(ws, 'Invalid character', err, message.requestId);
            return;
        }
        const oldName = typeof message.oldName === 'string' ? message.oldName : null;
        const saved = getDb(handlers).upsertCharacter(message.character, { oldName });
        const data = refreshCache(handlers);
        handlers.sendToClient(ws, {
            type: 'character_db_upsert_response',
            requestId: message.requestId,
            data: { success: true, character: saved, data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('character_db_upsert:', error);
        handlers.sendError(ws, 'Failed to save character', error.message, message.requestId);
    }
}

async function handleCharacterDbDelete(handlers, ws, message) {
    try {
        const name = typeof message.name === 'string' ? message.name.trim() : '';
        if (!name) {
            handlers.sendError(ws, 'Invalid name', 'name is required', message.requestId);
            return;
        }
        const deleted = getDb(handlers).deleteCharacter(name);
        if (!deleted) {
            handlers.sendError(ws, 'Not found', `Character "${name}" not found`, message.requestId);
            return;
        }
        const data = refreshCache(handlers);
        handlers.sendToClient(ws, {
            type: 'character_db_delete_response',
            requestId: message.requestId,
            data: { success: true, name, data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('character_db_delete:', error);
        handlers.sendError(ws, 'Failed to delete character', error.message, message.requestId);
    }
}

async function handleCharacterDbRenameCopyright(handlers, ws, message) {
    try {
        const oldCopyright = typeof message.oldCopyright === 'string' ? message.oldCopyright.trim() : '';
        const newCopyright = typeof message.newCopyright === 'string' ? message.newCopyright.trim() : '';
        if (!oldCopyright || !newCopyright) {
            handlers.sendError(ws, 'Invalid copyright', 'oldCopyright and newCopyright are required', message.requestId);
            return;
        }
        const renamed = getDb(handlers).renameCopyright(oldCopyright, newCopyright);
        const data = refreshCache(handlers);
        handlers.sendToClient(ws, {
            type: 'character_db_rename_copyright_response',
            requestId: message.requestId,
            data: { success: true, copyright: renamed, data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('character_db_rename_copyright:', error);
        handlers.sendError(ws, 'Failed to rename copyright', error.message, message.requestId);
    }
}

async function handleCharacterDbDeleteCopyright(handlers, ws, message) {
    try {
        const copyright = typeof message.copyright === 'string' ? message.copyright.trim() : '';
        if (!copyright) {
            handlers.sendError(ws, 'Invalid copyright', 'copyright is required', message.requestId);
            return;
        }
        const result = getDb(handlers).deleteCopyright(copyright);
        if (!result.deleted) {
            handlers.sendError(ws, 'Not found', `Copyright "${copyright}" not found`, message.requestId);
            return;
        }
        const data = refreshCache(handlers);
        handlers.sendToClient(ws, {
            type: 'character_db_delete_copyright_response',
            requestId: message.requestId,
            data: {
                success: true,
                copyright,
                charactersRemoved: result.charactersRemoved,
                data
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('character_db_delete_copyright:', error);
        handlers.sendError(ws, 'Failed to delete copyright', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[235-characterDbHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'character_db', ...meta });
    };

    reg('get_character_db', handleGetCharacterDb);
    reg('character_db_upsert', handleCharacterDbUpsert, CHARACTER_DB_DESTRUCTIVE);
    reg('character_db_delete', handleCharacterDbDelete, CHARACTER_DB_DESTRUCTIVE);
    reg('character_db_rename_copyright', handleCharacterDbRenameCopyright, CHARACTER_DB_DESTRUCTIVE);
    reg('character_db_delete_copyright', handleCharacterDbDeleteCopyright, CHARACTER_DB_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
