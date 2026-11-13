const wsPacketRegistry = require('../wsPacketRegistry');

const NOTES_DESTRUCTIVE = { destructive: true };

// modules/replicationJournal.js
async function recordReplicationNoteJournal(noteId, { operation = 'INSERT', payload = null } = {}) {
    if (!noteId) return;
    try {
        const replicationJournal = require('../../replicationJournal');
        await replicationJournal.recordNote(noteId, { operation, payload });
    } catch (_err) {}
}

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

        // an ink note (#785): the strokes in their own column, a summary in metadata.ink
        let ink = message.ink;
        if (typeof ink === 'string') ink = ink ? JSON.parse(ink) : null;
        const summary = inkSummary(ink);
        const inkJson = summary ? JSON.stringify(ink) : null;
        if (inkJson && inkJson.length > MAX_INK_CHARS) throw new Error('The drawing is too large.');
        if (summary) metadata = { ...(metadata && typeof metadata === 'object' ? metadata : {}), ink: summary };

        const note = await handlersCtx.globalResources.notesDatabase.createNote({
            id,
            name,
            workspaceId,
            content,
            icon,
            color,
            note_kind: note_kind || 'note',
            metadata: metadata || {},
            ink: inkJson
        });

        // modules/replicationJournal.js — recordReplicationNoteJournal
        await recordReplicationNoteJournal(note.id, {
            operation: 'INSERT',
            payload: { workspaceId: note.workspaceId, name: note.name, note_kind: note.note_kind }
        });

        handlersCtx.sendToClient(ws, {
            type: 'notes_create_response',
            requestId: message.requestId,
            data: { success: true, note },
            timestamp: new Date().toISOString()
        });

        wsServer.broadcast({
            type: 'note_created',
            data: { note: lightNote(note) },
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

        // modules/replicationJournal.js — recordReplicationNoteJournal
        await recordReplicationNoteJournal(noteId, {
            operation: 'UPDATE',
            payload: { updates }
        });

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

// ---- ink and recordings (#785): the phone's Notes Draw mode and voice bar, Melaton Journal ----

const MAX_INK_CHARS = 6 * 1024 * 1024;

function notesAudio() {
    return require('../../notesAudio');
}

/** A note for a broadcast: without its strokes (every client gets it; the owner re-reads them). */
function lightNote(note) {
    if (!note) return note;
    const { ink, ...rest } = note;
    return rest;
}

function inkSummary(ink) {
    if (!ink || !Array.isArray(ink.strokes) || !ink.strokes.length) return null;
    return { strokes: ink.strokes.length, w: Number(ink.w) || null, h: Number(ink.h) || null };
}

/** notes_ink_save { noteId, ink: { v, w, h, strokes: [{ tool, color, width, pts }] } | null } */
async function handleNotesInkSave(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId } = message;
        let ink = message.ink;
        if (!noteId) {
            handlersCtx.sendError(ws, 'Note ID is required', 'notes_ink_save', message.requestId);
            return;
        }
        const db = handlersCtx.globalResources.notesDatabase;
        if (!(await db.getNote(noteId))) throw new Error('Note not found');
        if (typeof ink === 'string') ink = ink ? JSON.parse(ink) : null;
        if (ink && (typeof ink !== 'object' || !Array.isArray(ink.strokes))) throw new Error('Invalid ink');
        const summary = inkSummary(ink);
        const json = summary ? JSON.stringify(ink) : null;
        if (json && json.length > MAX_INK_CHARS) throw new Error('The drawing is too large.');
        await db.updateNote(noteId, { ink: json });
        const note = await db.updateNoteMetadata(noteId, { ink: summary });
        await recordReplicationNoteJournal(noteId, { operation: 'UPDATE', payload: { updates: { ink: json } } });
        handlersCtx.sendToClient(ws, {
            type: 'notes_ink_save_response',
            requestId: message.requestId,
            data: { success: true, note: lightNote(note) },
            timestamp: new Date().toISOString()
        });
        wsServer.broadcast({
            type: 'note_updated',
            data: { noteId, updates: { ink: summary }, note: lightNote(note) },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes ink save error:', error);
        handlersCtx.sendError(ws, 'Failed to save the drawing', error.message, message.requestId);
    }
}

function audioList(note) {
    const list = note && note.metadata && Array.isArray(note.metadata.audio) ? note.metadata.audio : [];
    return list.filter((a) => a && a.id);
}

/** notes_audio_put { noteId, audioId, name, mime, ms, base64 }: adds or replaces one recording. */
async function handleNotesAudioPut(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId, audioId, base64 } = message;
        if (!noteId || !audioId || !base64) {
            handlersCtx.sendError(ws, 'Note ID, recording ID and data are required', 'notes_audio_put', message.requestId);
            return;
        }
        const db = handlersCtx.globalResources.notesDatabase;
        const before = await db.getNote(noteId);
        if (!before) throw new Error('Note not found');
        const saved = await notesAudio().put(noteId, audioId, base64, message.mime);
        const entry = {
            id: String(audioId),
            name: String(message.name || 'Recording').slice(0, 120),
            ms: Math.max(0, Math.round(Number(message.ms) || 0)),
            mime: saved.mime,
            bytes: saved.bytes,
            at: Math.floor(Date.now() / 1000)
        };
        const list = audioList(before).filter((a) => a.id !== entry.id).concat([entry]);
        const note = await db.updateNoteMetadata(noteId, { audio: list });
        handlersCtx.sendToClient(ws, {
            type: 'notes_audio_put_response',
            requestId: message.requestId,
            data: { success: true, audio: entry, note: lightNote(note) },
            timestamp: new Date().toISOString()
        });
        wsServer.broadcast({
            type: 'note_updated',
            data: { noteId, updates: { audio: list }, note: lightNote(note) },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes audio put error:', error);
        handlersCtx.sendError(ws, 'Failed to save the recording', error.message, message.requestId);
    }
}

/** notes_audio_get { noteId, audioId } -> { mime, base64 } */
async function handleNotesAudioGet(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId, audioId } = message;
        if (!noteId || !audioId) {
            handlersCtx.sendError(ws, 'Note ID and recording ID are required', 'notes_audio_get', message.requestId);
            return;
        }
        const { buffer, mime } = await notesAudio().read(noteId, audioId);
        handlersCtx.sendToClient(ws, {
            type: 'notes_audio_get_response',
            requestId: message.requestId,
            data: { success: true, mime, base64: buffer.toString('base64') },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to read the recording', error.message, message.requestId);
    }
}

/** notes_audio_delete { noteId, audioId } */
async function handleNotesAudioDelete(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { noteId, audioId } = message;
        if (!noteId || !audioId) {
            handlersCtx.sendError(ws, 'Note ID and recording ID are required', 'notes_audio_delete', message.requestId);
            return;
        }
        const db = handlersCtx.globalResources.notesDatabase;
        const before = await db.getNote(noteId);
        if (!before) throw new Error('Note not found');
        await notesAudio().remove(noteId, audioId);
        const list = audioList(before).filter((a) => a.id !== String(audioId));
        const note = await db.updateNoteMetadata(noteId, { audio: list });
        handlersCtx.sendToClient(ws, {
            type: 'notes_audio_delete_response',
            requestId: message.requestId,
            data: { success: true, note: lightNote(note) },
            timestamp: new Date().toISOString()
        });
        wsServer.broadcast({
            type: 'note_updated',
            data: { noteId, updates: { audio: list }, note: lightNote(note) },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Notes audio delete error:', error);
        handlersCtx.sendError(ws, 'Failed to delete the recording', error.message, message.requestId);
    }
}

/** notes_audio_copy { fromNoteId, toNoteId }: Create Copy gives the copy its own recordings. */
async function handleNotesAudioCopy(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { fromNoteId, toNoteId } = message;
        if (!fromNoteId || !toNoteId) {
            handlersCtx.sendError(ws, 'Both note IDs are required', 'notes_audio_copy', message.requestId);
            return;
        }
        const db = handlersCtx.globalResources.notesDatabase;
        if (!(await db.getNote(toNoteId))) throw new Error('Note not found');
        const copied = await notesAudio().copyAll(fromNoteId, toNoteId);
        handlersCtx.sendToClient(ws, {
            type: 'notes_audio_copy_response',
            requestId: message.requestId,
            data: { success: true, copied },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to copy the recordings', error.message, message.requestId);
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

        // modules/replicationJournal.js — recordReplicationNoteJournal
        await recordReplicationNoteJournal(noteId, {
            operation: 'DELETE',
            payload: { noteId }
        });

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

        // modules/replicationJournal.js — recordReplicationNoteJournal
        await recordReplicationNoteJournal(noteId, {
            operation: 'UPDATE',
            payload: { contentSaved: true }
        });

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
    reg('notes_ink_save', handleNotesInkSave, NOTES_DESTRUCTIVE);
    reg('notes_audio_put', handleNotesAudioPut, NOTES_DESTRUCTIVE);
    reg('notes_audio_get', handleNotesAudioGet);
    reg('notes_audio_delete', handleNotesAudioDelete, NOTES_DESTRUCTIVE);
    reg('notes_audio_copy', handleNotesAudioCopy, NOTES_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
