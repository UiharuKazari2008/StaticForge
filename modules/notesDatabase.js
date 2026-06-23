const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');

let dbPath = null;
let db = null;

/**
 * Get checkpoint manager for notes database
 */
function getCheckpointManager() {
    return db ? db.getCheckpointManager() : null;
}

/**
 * Initialize the SQLite database for Notes system
 */
async function initializeNotesDatabase(databasesPath) {
    try {
        dbPath = path.join(databasesPath, 'notes.db');
        const cacheDir = path.dirname(dbPath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        db = new SQLiteAsyncWrapper(dbPath, 'notes', 30); // 30 minute idle timeout
        
        // Initialize database (opens connection and creates tables)
        await db.initialize();
        
        // Create tables if they don't exist
        await createNotesTables();
        
        logger.bootSubStep('Notes database ready');
        return true;
    } catch (error) {
        logger.error('Error initializing SQLite notes database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

/**
 * Create database tables for notes system
 */
async function createNotesTables() {
    // Notes table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            content TEXT DEFAULT '',
            icon TEXT DEFAULT 'fas fa-file-lines',
            color TEXT DEFAULT '#ffc107',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    try {
        await db.exec(`ALTER TABLE notes ADD COLUMN note_kind TEXT DEFAULT 'note'`);
    } catch (error) {
        // Column already exists
    }

    try {
        await db.exec(`ALTER TABLE notes ADD COLUMN metadata TEXT DEFAULT '{}'`);
    } catch (error) {
        // Column already exists
    }
    
    // Create indexes for better performance
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_workspace_id ON notes (workspace_id);
        CREATE INDEX IF NOT EXISTS idx_notes_name ON notes (name);
        CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at);
        CREATE INDEX IF NOT EXISTS idx_notes_note_kind ON notes (note_kind);
    `);
}

const DEFAULT_NOVEL_SETTINGS = {
    tone: 'neutral',
    style: 'literary',
    explicitness: 'moderate',
    persuasiveness: 'neutral',
    auto_generate: true
};

const MAX_NOVEL_UNDO_STACK = 10;

function parseNoteMetadata(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function normalizeNovelMetadata(metadata = {}) {
    const meta = { ...metadata };
    if (!meta.settings || typeof meta.settings !== 'object') {
        meta.settings = { ...DEFAULT_NOVEL_SETTINGS };
    } else {
        meta.settings = { ...DEFAULT_NOVEL_SETTINGS, ...meta.settings };
    }
    if (!Array.isArray(meta.linked_images)) meta.linked_images = [];
    if (!Array.isArray(meta.undo_stack)) meta.undo_stack = [];
    if (typeof meta.story_cursor_line !== 'number') meta.story_cursor_line = 0;
    if (meta.last_response_id == null) meta.last_response_id = null;
    return meta;
}

function formatNoteRow(note) {
    if (!note) return note;
    const formatted = { ...note };
    formatted.metadata = normalizeNovelMetadata(parseNoteMetadata(note.metadata));
    if (!formatted.note_kind) formatted.note_kind = 'note';
    return formatted;
}

function serializeNoteMetadata(metadata) {
    return JSON.stringify(normalizeNovelMetadata(metadata || {}));
}

/**
 * Close database connection
 */
async function closeNotesDatabase() {
    if (db) {
        await db.close();
        db = null;
    }
}

// Notes CRUD Functions

/**
 * Create a new note
 */
async function createNote(noteData) {
    try {
        const {
            id,
            name,
            workspaceId,
            content = '',
            icon = 'fas fa-file-lines',
            color = '#ffc107',
            note_kind = 'note',
            metadata = {}
        } = noteData;
        
        if (!id || !name || !workspaceId) {
            throw new Error('Note ID, name, and workspace ID are required');
        }

        const metadataJson = note_kind === 'novel'
            ? serializeNoteMetadata(metadata)
            : (typeof metadata === 'string' ? metadata : JSON.stringify(metadata || {}));
        
        await db.run(
            `INSERT INTO notes (id, name, workspace_id, content, icon, color, note_kind, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, workspaceId, content, icon, color, note_kind, metadataJson]
        );
        
        const note = formatNoteRow(await db.get('SELECT * FROM notes WHERE id = ?', [id]));
        console.log(`📝 Created note: ${name} in workspace ${workspaceId}`);
        return note;
    } catch (error) {
        logger.error('Error creating note:', error);
        throw error;
    }
}

/**
 * Get a note by ID
 */
async function getNote(noteId) {
    try {
        const note = await db.get('SELECT * FROM notes WHERE id = ?', [noteId]);
        return formatNoteRow(note);
    } catch (error) {
        logger.error('Error getting note:', error);
        throw error;
    }
}

/**
 * Get all notes for a workspace
 */
async function getNotesByWorkspace(workspaceId) {
    try {
        const notes = await db.all(
            'SELECT * FROM notes WHERE workspace_id = ? ORDER BY updated_at DESC',
            [workspaceId]
        );
        return notes.map(formatNoteRow);
    } catch (error) {
        logger.error('Error getting notes by workspace:', error);
        throw error;
    }
}

/**
 * Get all notes (for all workspaces)
 */
async function getAllNotes() {
    try {
        const notes = await db.all('SELECT * FROM notes ORDER BY workspace_id, updated_at DESC');
        return notes.map(formatNoteRow);
    } catch (error) {
        logger.error('Error getting all notes:', error);
        throw error;
    }
}

/**
 * Get all notes metadata (without content field for performance)
 */
async function getAllNotesMetadata() {
    try {
        const notes = await db.all(
            'SELECT id, name, workspace_id, icon, color, note_kind, metadata, created_at, updated_at FROM notes ORDER BY workspace_id, updated_at DESC'
        );
        return notes.map((note) => {
            const formatted = { ...note };
            if (note.note_kind === 'novel') {
                formatted.metadata = normalizeNovelMetadata(parseNoteMetadata(note.metadata));
            }
            return formatted;
        });
    } catch (error) {
        logger.error('Error getting all notes metadata:', error);
        throw error;
    }
}

/**
 * Update a note
 */
async function updateNote(noteId, updates) {
    try {
        const allowedFields = ['name', 'content', 'icon', 'color', 'workspace_id', 'note_kind', 'metadata'];
        const updateFields = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                if (key === 'metadata' && value && typeof value === 'object') {
                    values.push(serializeNoteMetadata(value));
                } else {
                    values.push(value);
                }
            }
        }
        
        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        // Add updated_at timestamp
        updateFields.push('updated_at = ?');
        values.push(Math.floor(Date.now() / 1000));
        
        // Add noteId for WHERE clause
        values.push(noteId);
        
        await db.run(
            `UPDATE notes SET ${updateFields.join(', ')} WHERE id = ?`,
            values
        );
        
        const note = formatNoteRow(await db.get('SELECT * FROM notes WHERE id = ?', [noteId]));
        console.log(`📝 Updated note: ${noteId}`);
        return note;
    } catch (error) {
        logger.error('Error updating note:', error);
        throw error;
    }
}

/**
 * Delete a note
 */
async function deleteNote(noteId) {
    try {
        const note = await db.get('SELECT * FROM notes WHERE id = ?', [noteId]);
        
        if (!note) {
            throw new Error('Note not found');
        }
        
        await db.run('DELETE FROM notes WHERE id = ?', [noteId]);
        console.log(`📝 Deleted note: ${note.name}`);
        return { success: true, note };
    } catch (error) {
        logger.error('Error deleting note:', error);
        throw error;
    }
}

/**
 * Save note content (convenience function for frequent saves)
 */
async function saveNoteContent(noteId, content) {
    try {
        await db.run(
            'UPDATE notes SET content = ?, updated_at = ? WHERE id = ?',
            [content, Math.floor(Date.now() / 1000), noteId]
        );
        return { success: true };
    } catch (error) {
        logger.error('Error saving note content:', error);
        throw error;
    }
}

async function getNovelNotesByWorkspace(workspaceId) {
    try {
        const notes = await db.all(
            `SELECT * FROM notes WHERE workspace_id = ? AND note_kind = 'novel' ORDER BY updated_at DESC`,
            [workspaceId]
        );
        return notes.map(formatNoteRow);
    } catch (error) {
        logger.error('Error getting novel notes by workspace:', error);
        throw error;
    }
}

async function updateNoteMetadata(noteId, metadataPatch) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    const merged = normalizeNovelMetadata({ ...note.metadata, ...metadataPatch });
    return updateNote(noteId, { metadata: merged });
}

module.exports = {
    initializeNotesDatabase,
    closeNotesDatabase,
    getCheckpointManager,
    createNote,
    getNote,
    getNotesByWorkspace,
    getNovelNotesByWorkspace,
    getAllNotes,
    getAllNotesMetadata,
    updateNote,
    updateNoteMetadata,
    deleteNote,
    saveNoteContent,
    parseNoteMetadata,
    normalizeNovelMetadata,
    serializeNoteMetadata,
    DEFAULT_NOVEL_SETTINGS,
    MAX_NOVEL_UNDO_STACK
};

