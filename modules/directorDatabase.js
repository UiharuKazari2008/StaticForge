const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'director.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

let db = null;

/**
 * Initialize the SQLite database for Director system
 */
function initializeDirectorDatabase() {
    try {
        // Open database (creates if doesn't exist)
        db = new Database(dbPath);
        
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 10000');
        db.pragma('temp_store = MEMORY');
        
        // Create tables if they don't exist
        createDirectorTables();
        
        return true;
    } catch (error) {
        console.error('❌ Error initializing SQLite Director database:', error.message);
        return false;
    }
}

/**
 * Create database tables for Director system
 */
function createDirectorTables() {
    // Director sessions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS director_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            filename TEXT NOT NULL,
            image_type TEXT DEFAULT 'generated',
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            max_resolution INTEGER DEFAULT 0,
            session_mode TEXT DEFAULT 'analyse',
            user_intent TEXT DEFAULT '',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Add image_type column if it doesn't exist (for existing databases)
    try {
        db.exec(`ALTER TABLE director_sessions ADD COLUMN image_type TEXT DEFAULT 'generated'`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Add session_mode column if it doesn't exist
    try {
        db.exec(`ALTER TABLE director_sessions ADD COLUMN session_mode TEXT DEFAULT 'analyse'`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Add user_intent column if it doesn't exist
    try {
        db.exec(`ALTER TABLE director_sessions ADD COLUMN user_intent TEXT DEFAULT ''`);
    } catch (e) {
        // Column already exists, ignore error
    }
    
    // Director messages table - stores OpenAI format messages
    db.exec(`
        CREATE TABLE IF NOT EXISTS director_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            director_session_id INTEGER NOT NULL,
            role TEXT NOT NULL, -- 'system', 'user', 'assistant'
            content TEXT NOT NULL, -- Message content
            previous_message_id INTEGER, -- For conversation continuity
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            expires_at INTEGER, -- Timestamp for 30-day retention
            FOREIGN KEY (director_session_id) REFERENCES director_sessions (id) ON DELETE CASCADE,
            FOREIGN KEY (previous_message_id) REFERENCES director_messages (id) ON DELETE SET NULL
        )
    `);
    
    // Create indexes for better performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_director_sessions_created_at ON director_sessions (created_at);
        CREATE INDEX IF NOT EXISTS idx_director_sessions_model ON director_sessions (model);
        CREATE INDEX IF NOT EXISTS idx_director_messages_session_id ON director_messages (director_session_id);
        CREATE INDEX IF NOT EXISTS idx_director_messages_created_at ON director_messages (created_at);
        CREATE INDEX IF NOT EXISTS idx_director_messages_role ON director_messages (role);
    `);
    
    console.log('✅ Director database tables created/verified');
}

/**
 * Close database connection
 */
function closeDirectorDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

// Director Session Functions
function createDirectorSession(sessionData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO director_sessions
            (name, filename, image_type, provider, model, max_resolution, session_mode, user_intent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            sessionData.name,
            sessionData.filename,
            sessionData.imageType || 'generated',
            sessionData.provider,
            sessionData.model,
            sessionData.max_resolution ? 1 : 0,
            sessionData.sessionMode || 'analyse',
            sessionData.userIntent || ''
        );
        return result.lastInsertRowid;
    } catch (error) {
        console.error('❌ Error creating Director session:', error.message);
        return null;
    }
}

function getDirectorSession(sessionId) {
    try {
        const stmt = db.prepare('SELECT * FROM director_sessions WHERE id = ?');
        return stmt.get(sessionId);
    } catch (error) {
        console.error('❌ Error getting Director session:', error.message);
        return null;
    }
}

function getAllDirectorSessions() {
    try {
        const stmt = db.prepare('SELECT * FROM director_sessions ORDER BY created_at DESC');
        return stmt.all();
    } catch (error) {
        console.error('❌ Error getting all Director sessions:', error.message);
        return [];
    }
}

function updateDirectorSession(sessionId, updates) {
    try {
        const fields = [];
        const values = [];
        
        Object.keys(updates).forEach(key => {
            if (updates[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });
        
        if (fields.length === 0) return false;
        
        fields.push('updated_at = strftime(\'%s\', \'now\')');
        values.push(sessionId);
        
        const stmt = db.prepare(`UPDATE director_sessions SET ${fields.join(', ')} WHERE id = ?`);
        const result = stmt.run(...values);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error updating Director session:', error.message);
        return false;
    }
}

function deleteDirectorSession(sessionId) {
    try {
        const stmt = db.prepare('DELETE FROM director_sessions WHERE id = ?');
        const result = stmt.run(sessionId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error deleting Director session:', error.message);
        return false;
    }
}

// Director Message Functions
function addDirectorMessage(directorSessionId, role, content, previousMessageId = null, messageType = null, userInput = null) {
    try {
        // Calculate expiration date (30 days from now)
        const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
        
        // Convert content to JSON string if it's an object/array
        let contentString = content;
        if (typeof content === 'object' && content !== null) {
            contentString = JSON.stringify(content);
        }
        
        const stmt = db.prepare(`
            INSERT INTO director_messages 
            (director_session_id, role, content, message_type, user_input, previous_message_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            directorSessionId,
            role,
            contentString,
            messageType,
            userInput,
            previousMessageId,
            expiresAt
        );
        
        // Update session's updated_at timestamp
        updateDirectorSession(directorSessionId, {});
        
        return result.lastInsertRowid;
    } catch (error) {
        console.error('❌ Error adding Director message:', error.message);
        return null;
    }
}

// Extract JSON data from assistant message content - server-side only
function extractAssistantData(rawContent) {
    try {
        let parsedContent = rawContent;

        // Handle string content
        if (typeof rawContent === 'string') {
            parsedContent = JSON.parse(rawContent);
        }

        // Handle array format [{ type: "text", text: "..." }]
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
            const textItem = parsedContent.find(item => item.type === 'text');
            if (textItem && textItem.text) {
                try {
                    const extractedData = JSON.parse(textItem.text);
                    return {
                        type: 'structured',
                        data: extractedData
                    };
                } catch (e) {
                    return {
                        type: 'error',
                        data: { error: 'Invalid Response from AI' }
                    };
                }
            }
        }

        // Handle direct object format
        if (typeof parsedContent === 'object' && parsedContent !== null) {
            return {
                type: 'structured',
                data: parsedContent
            };
        }

        // Fallback for any other format
        return {
            type: 'error',
            data: { error: 'Invalid Response from AI' }
        };

    } catch (e) {
        return {
            type: 'error',
            data: { error: 'Invalid Response from AI' }
        };
    }
}

function getDirectorMessages(sessionId, limit = 100, offset = 0, includeSystem = false, includeExtraFields = true) {
    try {
        // Filter out system messages unless explicitly requested
        const whereClause = includeSystem ? 
            'WHERE director_session_id = ?' : 
            'WHERE director_session_id = ? AND role != \'system\'';
            
        const stmt = db.prepare(`
            SELECT * FROM director_messages 
            ${whereClause}
            ORDER BY created_at ASC 
            LIMIT ? OFFSET ?
        `);
        const messages = stmt.all(sessionId, limit, offset);
        
        // Return messages in OpenAI format
        return messages.map(msg => {
            let content = msg.content;
            
            // Try to parse complex content (JSON array format)
            try {
                const parsedContent = JSON.parse(msg.content);
                if (Array.isArray(parsedContent)) {
                    content = parsedContent;
                }
            } catch (e) {
                // Not JSON, use as simple string
                content = msg.content;
            }
            
            const messageObj = {
                role: msg.role,
                content: content
            };
            
            // Add extra fields for client display (only if includeExtraFields is true)
            if (includeExtraFields) {
                if (msg.role === 'user') {
                    // Add message_type and user_input for user messages
                    if (msg.message_type) {
                        messageObj.message_type = msg.message_type;
                    }
                    if (msg.user_input) {
                        messageObj.user_input = msg.user_input;
                        delete messageObj.content;
                    }
                } else if (msg.role === 'assistant') {
                    // Extract JSON data from content - server-side only processing
                    const extractedData = extractAssistantData(content);
                    if (extractedData.type === 'structured') {
                        // Return structured data in single 'data' field
                        messageObj.data = extractedData.data;
                    } else {
                        // Error case - return error message in 'data' field
                        messageObj.data = { error: 'Invalid Response from AI' };
                    }
                    delete messageObj.content; // Always remove raw content
                }
                
                // Add database ID for client-side message identification (separate from message body)
                return {
                    id: msg.id,  // Database primary key for client-side use
                    ...messageObj  // Message body for AI (role, content, etc.)
                };
            } else {
                return messageObj;
            }
        });
    } catch (error) {
        console.error('❌ Error getting Director messages:', error.message);
        return [];
    }
}

function getDirectorMessageCount(sessionId) {
    try {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM director_messages WHERE director_session_id = ?');
        const result = stmt.get(sessionId);
        return result.count;
    } catch (error) {
        console.error('❌ Error getting Director message count:', error.message);
        return 0;
    }
}

function getLastDirectorMessage(sessionId) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM director_messages 
            WHERE director_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        const message = stmt.get(sessionId);
        
        if (message) {
            return {
                id: message.id,
                role: message.role,
                content: message.content,
                previous_message_id: message.previous_message_id
            };
        }
        
        return null;
    } catch (error) {
        console.error('❌ Error getting last Director message:', error.message);
        return null;
    }
}

function getLastDirectorMessageId(sessionId) {
    try {
        const stmt = db.prepare(`
            SELECT id FROM director_messages 
            WHERE director_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        const result = stmt.get(sessionId);
        return result ? result.id : null;
    } catch (error) {
        console.error('❌ Error getting last Director message ID:', error.message);
        return null;
    }
}

// Database statistics
function getDirectorDatabaseStats() {
    try {
        const sessionCount = db.prepare('SELECT COUNT(*) as count FROM director_sessions').get().count;
        const messageCount = db.prepare('SELECT COUNT(*) as count FROM director_messages').get().count;

        return {
            sessions: sessionCount,
            messages: messageCount
        };
    } catch (error) {
        console.error('❌ Error getting Director database stats:', error.message);
        return null;
    }
}

/**
 * Delete a director message and all messages after it in the session
 */
function deleteDirectorMessagesFrom(sessionId, messageId) {
    try {
        // First get the target message to find its timestamp
        const targetMessage = db.prepare(`
            SELECT created_at FROM director_messages
            WHERE id = ? AND director_session_id = ?
        `).get(messageId, sessionId);

        if (!targetMessage) {
            console.error(`❌ Message ${messageId} not found in session ${sessionId}`);
            return false;
        }

        // Delete all messages from the target message onwards (including the target)
        // We need to be careful about foreign key constraints
        const deleteStmt = db.prepare(`
            DELETE FROM director_messages
            WHERE director_session_id = ? AND created_at >= ?
        `);

        const result = deleteStmt.run(sessionId, targetMessage.created_at);
        console.log(`🗑️ Deleted ${result.changes} messages from session ${sessionId} starting from message ${messageId}`);

        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error deleting director messages:', error);
        return false;
    }
}

// Initialize database on module load
let dbInitialized = false;
try {
    dbInitialized = initializeDirectorDatabase();
    if (!dbInitialized) {
        throw new Error('Failed to initialize Director database');
    }
    console.log('✅ Director database module ready');
} catch (error) {
    console.error('❌ Failed to initialize Director database:', error.message);
    process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', () => {
    closeDirectorDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDirectorDatabase();
    process.exit(0);
});

module.exports = {
    initializeDirectorDatabase,
    closeDirectorDatabase,
    createDirectorSession,
    getDirectorSession,
    getAllDirectorSessions,
    updateDirectorSession,
    deleteDirectorSession,
    addDirectorMessage,
    getDirectorMessages,
    getDirectorMessageCount,
    getLastDirectorMessage,
    getLastDirectorMessageId,
    getDirectorDatabaseStats,
    extractAssistantData,
    deleteDirectorMessagesFrom
};
