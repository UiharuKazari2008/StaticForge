const wsPacketRegistry = require('../wsPacketRegistry');

const NOTES_DESTRUCTIVE = { destructive: true };

async function handleNotesCreate(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        let { id, name, workspaceId, content, icon, color, note_kind, metadata } = message;

        if (!id || !workspaceId) {
            handlersCtx.sendError(ws, 'Note ID and workspace ID are required', 'notes_create', message.requestId);
            return;
        }

        if (note_kind === 'novel' && (!name || !String(name).trim())) {
            const novelHandlers = handlersCtx.globalResources.getNovelHandlers();
            name = novelHandlers.generateNoteName({
                directive: message.directive,
                generatedImageName: message.generatedImageName,
                content
            });
        }

        if (!name) {
            handlersCtx.sendError(ws, 'Note name is required', 'notes_create', message.requestId);
            return;
        }

        if (note_kind === 'novel') {
            icon = icon || 'fas fa-book-open';
            const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
            if (message.directive && String(message.directive).trim()) {
                meta.directive_snapshot = String(message.directive).trim();
            }
            metadata = meta;
        }

        const note = await handlersCtx.globalResources.notesDatabase.createNote({
            id,
            name,
            workspaceId,
            content,
            icon,
            color,
            note_kind: note_kind || 'note',
            metadata: metadata || {}
        });

        handlersCtx.sendToClient(ws, {
            type: 'notes_create_response',
            requestId: message.requestId,
            data: { success: true, note },
            timestamp: new Date().toISOString()
        });

        wsServer.broadcast({
            type: 'note_created',
            data: { note },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes create error:', error);
        handlersCtx.sendError(ws, 'Failed to create note', error.message, message.requestId);
    }
}

async function handleNotesGet(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId } = message;

        if (!noteId) {
            handlersCtx.sendError(ws, 'Note ID is required', 'notes_get', message.requestId);
            return;
        }

        const note = await handlersCtx.globalResources.notesDatabase.getNote(noteId);

        handlersCtx.sendToClient(ws, {
            type: 'notes_get_response',
            requestId: message.requestId,
            data: { note },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes get error:', error);
        handlersCtx.sendError(ws, 'Failed to get note', error.message, message.requestId);
    }
}

async function handleNotesGetByWorkspace(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { workspaceId } = message;

        if (!workspaceId) {
            handlersCtx.sendError(ws, 'Workspace ID is required', 'notes_get_by_workspace', message.requestId);
            return;
        }

        const notes = await handlersCtx.globalResources.notesDatabase.getNotesByWorkspace(workspaceId);

        handlersCtx.sendToClient(ws, {
            type: 'notes_get_by_workspace_response',
            requestId: message.requestId,
            data: { notes },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes get by workspace error:', error);
        handlersCtx.sendError(ws, 'Failed to get notes by workspace', error.message, message.requestId);
    }
}

async function handleNotesGetAll(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const notes = await handlersCtx.globalResources.notesDatabase.getAllNotes();

        handlersCtx.sendToClient(ws, {
            type: 'notes_get_all_response',
            requestId: message.requestId,
            data: { notes },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes get all error:', error);
        handlersCtx.sendError(ws, 'Failed to get all notes', error.message, message.requestId);
    }
}

async function handleNotesGetAllMetadata(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const notes = await handlersCtx.globalResources.notesDatabase.getAllNotesMetadata();

        handlersCtx.sendToClient(ws, {
            type: 'notes_get_all_metadata_response',
            requestId: message.requestId,
            data: { notes },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes get all metadata error:', error);
        handlersCtx.sendError(ws, 'Failed to get all notes metadata', error.message, message.requestId);
    }
}

async function handleNotesUpdate(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId, updates } = message;

        if (!noteId || !updates) {
            handlersCtx.sendError(ws, 'Note ID and updates are required', 'notes_update', message.requestId);
            return;
        }

        const note = await handlersCtx.globalResources.notesDatabase.updateNote(noteId, updates);

        handlersCtx.sendToClient(ws, {
            type: 'notes_update_response',
            requestId: message.requestId,
            data: { success: true, note },
            timestamp: new Date().toISOString()
        });

        wsServer.broadcast({
            type: 'note_updated',
            data: { noteId, updates, note },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes update error:', error);
        handlersCtx.sendError(ws, 'Failed to update note', error.message, message.requestId);
    }
}

async function handleNotesDelete(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId } = message;

        if (!noteId) {
            handlersCtx.sendError(ws, 'Note ID is required', 'notes_delete', message.requestId);
            return;
        }

        const result = await handlersCtx.globalResources.notesDatabase.deleteNote(noteId);

        handlersCtx.sendToClient(ws, {
            type: 'notes_delete_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });

        wsServer.broadcast({
            type: 'note_deleted',
            data: { noteId },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes delete error:', error);
        handlersCtx.sendError(ws, 'Failed to delete note', error.message, message.requestId);
    }
}

async function handleNotesSaveContent(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId, content } = message;

        if (!noteId || content === undefined) {
            handlersCtx.sendError(ws, 'Note ID and content are required', 'notes_save_content', message.requestId);
            return;
        }

        await handlersCtx.globalResources.notesDatabase.saveNoteContent(noteId, content);

        handlersCtx.sendToClient(ws, {
            type: 'notes_save_content_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });

        wsServer.broadcast({
            type: 'note_content_updated',
            data: { noteId },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes save content error:', error);
        handlersCtx.sendError(ws, 'Failed to save note content', error.message, message.requestId);
    }
}

/**
 * Register notes_* WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[30-notesHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'notes', ...meta });
    };

    reg('notes_create', handleNotesCreate, NOTES_DESTRUCTIVE);
    reg('notes_get', handleNotesGet);
    reg('notes_get_by_workspace', handleNotesGetByWorkspace);
    reg('notes_get_all', handleNotesGetAll);
    reg('notes_get_all_metadata', handleNotesGetAllMetadata);
    reg('notes_update', handleNotesUpdate, NOTES_DESTRUCTIVE);
    reg('notes_delete', handleNotesDelete, NOTES_DESTRUCTIVE);
    reg('notes_save_content', handleNotesSaveContent, NOTES_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
