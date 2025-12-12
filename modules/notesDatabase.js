const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'notes.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

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
async function initializeNotesDatabase() {
    try {
        // Initialize async wrapper (checkpoint manager is automatically connected)
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
    
    // Create indexes for better performance
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_workspace_id ON notes (workspace_id);
        CREATE INDEX IF NOT EXISTS idx_notes_name ON notes (name);
        CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at);
    `);
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
        const { id, name, workspaceId, content = '', icon = 'fas fa-file-lines', color = '#ffc107' } = noteData;
        
        if (!id || !name || !workspaceId) {
            throw new Error('Note ID, name, and workspace ID are required');
        }
        
        await db.run(
            `INSERT INTO notes (id, name, workspace_id, content, icon, color) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name, workspaceId, content, icon, color]
        );
        
        const note = await db.get('SELECT * FROM notes WHERE id = ?', [id]);
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
        return note;
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
        return notes;
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
        return notes;
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
            'SELECT id, name, workspace_id, icon, color, created_at, updated_at FROM notes ORDER BY workspace_id, updated_at DESC'
        );
        return notes;
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
        const allowedFields = ['name', 'content', 'icon', 'color', 'workspace_id'];
        const updateFields = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                values.push(value);
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
        
        const note = await db.get('SELECT * FROM notes WHERE id = ?', [noteId]);
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

module.exports = {
    initializeNotesDatabase,
    closeNotesDatabase,
    getCheckpointManager,
    createNote,
    getNote,
    getNotesByWorkspace,
    getAllNotes,
    getAllNotesMetadata,
    updateNote,
    deleteNote,
    saveNoteContent
};

