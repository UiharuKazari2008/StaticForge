// Notes inbound WebSocket handlers — note push types and workspace_deleted cache clear.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

// notepadManager.js is the lazily loaded "notepad" feature (public/scripts/comp/featureLoader.js):
// until something opens it there is no global, no cache and no open notepad to update, so each
// handler reads it off window and skips its part instead of throwing a ReferenceError.
function loadedNotepadManager() {
    return window.notepadManager || null;
}

function dispatchWsMessageBridge(message) {
    document.dispatchEvent(new CustomEvent('wsMessage', {
        detail: { type: message.type, data: message.data }
    }));
}

function handleNoteCreatedMessage(message) {
    const notepadManager = loadedNotepadManager();
    if (notepadManager && message.data && message.data.note) {
        notepadManager.addNoteToCache(message.data.note);
    }

    if (notepadManager && notepadManager.notebookModal &&
        !notepadManager.notebookModal.classList.contains('hidden')) {
        notepadManager.notebookRefreshNotesList();
    }
}

function handleNoteUpdatedMessage(message) {
    const notepadManager = loadedNotepadManager();
    if (notepadManager && message.data && message.data.noteId && message.data.note) {
        notepadManager.updateNoteInCache(message.data.note);
    }

    if (notepadManager && message.data && message.data.noteId) {
        const notepad = notepadManager.getNotepadByNoteId(message.data.noteId);
        if (notepad) {
            notepad.handleNoteUpdated(message.data);
        }

        if (notepadManager.notebookCurrentNote &&
            notepadManager.notebookCurrentNote.id === message.data.noteId) {
            notepadManager.notebookLoadNote(message.data.noteId, false);
        }

        if (notepadManager.notebookModal &&
            !notepadManager.notebookModal.classList.contains('hidden')) {
            notepadManager.notebookRefreshNotesList();
        }
    }

    if (notepadManager && message.data && message.data.workspaceId) {
        notepadManager.invalidateWorkspaceNotesCache(message.data.workspaceId);
    }

    dispatchWsMessageBridge(message);
}

function handleNoteDeletedMessage(message) {
    const notepadManager = loadedNotepadManager();
    if (notepadManager && message.data && message.data.noteId) {
        notepadManager.removeNoteFromCache(message.data.noteId);
    }

    if (notepadManager && message.data && message.data.noteId) {
        const notepad = notepadManager.getNotepadByNoteId(message.data.noteId);
        if (notepad) {
            notepad.handleNoteDeleted();
        }

        if (notepadManager.notebookCurrentNote &&
            notepadManager.notebookCurrentNote.id === message.data.noteId) {
            notepadManager.notebookCurrentNote = null;
            if (notepadManager.notebookTextarea) {
                notepadManager.notebookTextarea.value = '';
            }
            notepadManager.notebookUpdateTitle();
        }

        if (notepadManager.notebookModal &&
            !notepadManager.notebookModal.classList.contains('hidden')) {
            notepadManager.notebookRefreshNotesList();
        }
    }

    dispatchWsMessageBridge(message);
}

function handleNoteContentUpdatedMessage(message) {
    const notepadManager = loadedNotepadManager();
    if (notepadManager && message.data && message.data.noteId) {
        const notepad = notepadManager.getNotepadByNoteId(message.data.noteId);
        if (notepad) {
            notepad.handleNoteContentUpdated(message.data);
        }
    }

    if (notepadManager && message.data && message.data.workspaceId) {
        notepadManager.invalidateWorkspaceNotesCache(message.data.workspaceId);
    }
}

function handleWorkspaceDeletedNotesMessage(message) {
    const notepadManager = loadedNotepadManager();
    if (notepadManager && message.data && message.data.workspaceId) {
        notepadManager.clearWorkspaceNotesCache(message.data.workspaceId);
    }
}

registerWsInboundHandler({
    id: 'notes.created',
    type: 'note_created',
    phase: 'only',
    handler(message) {
        handleNoteCreatedMessage(message);
    }
});

registerWsInboundHandler({
    id: 'notes.updated',
    type: 'note_updated',
    phase: 'only',
    handler(message) {
        handleNoteUpdatedMessage(message);
    }
});

registerWsInboundHandler({
    id: 'notes.deleted',
    type: 'note_deleted',
    phase: 'only',
    handler(message) {
        handleNoteDeletedMessage(message);
    }
});

registerWsInboundHandler({
    id: 'notes.content_updated',
    type: 'note_content_updated',
    phase: 'only',
    handler(message) {
        handleNoteContentUpdatedMessage(message);
    }
});

registerWsInboundHandler({
    id: 'notes.workspace_deleted',
    type: 'workspace_deleted',
    phase: 'only',
    handler(message) {
        handleWorkspaceDeletedNotesMessage(message);
    }
});
