const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'director.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

let db = null; // Now an instance of SQLiteAsyncWrapper

/**
 * Get checkpoint manager for director database
 */
function getCheckpointManager() {
    return db ? db.getCheckpointManager() : null;
}

/**
 * Initialize the SQLite database for Director system
 */
async function initializeDirectorDatabase() {
    try {
        // Initialize async wrapper (checkpoint manager is automatically connected)
        db = new SQLiteAsyncWrapper(dbPath, 'director', 30); // 30 minute idle timeout
        
        // Initialize database (opens connection and creates tables)
        await db.initialize();
        
        // Create tables if they don't exist
        await createDirectorTables();
        
        return true;
    } catch (error) {
        logger.error('Error initializing SQLite Director database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

/**
 * Create database tables for Director system
 */
async function createDirectorTables() {
    // Director sessions table
    await db.exec(`
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
        await db.exec(`ALTER TABLE director_sessions ADD COLUMN image_type TEXT DEFAULT 'generated'`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Add session_mode column if it doesn't exist
    try {
        await db.exec(`ALTER TABLE director_sessions ADD COLUMN session_mode TEXT DEFAULT 'analyse'`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Add user_intent column if it doesn't exist
    try {
        await db.exec(`ALTER TABLE director_sessions ADD COLUMN user_intent TEXT DEFAULT ''`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Director messages table - stores OpenAI format messages
    await db.exec(`
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

    // Add message_type column if it doesn't exist (for existing databases)
    try {
        await db.exec(`ALTER TABLE director_messages ADD COLUMN message_type TEXT`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Add user_input column if it doesn't exist (for existing databases)
    try {
        await db.exec(`ALTER TABLE director_messages ADD COLUMN user_input TEXT`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Create indexes for better performance
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_director_sessions_created_at ON director_sessions (created_at);
        CREATE INDEX IF NOT EXISTS idx_director_sessions_model ON director_sessions (model);
        CREATE INDEX IF NOT EXISTS idx_director_messages_session_id ON director_messages (director_session_id);
        CREATE INDEX IF NOT EXISTS idx_director_messages_created_at ON director_messages (created_at);
        CREATE INDEX IF NOT EXISTS idx_director_messages_role ON director_messages (role);
    `);
    
    logger.bootSubStep('Director database ready');
}

/**
 * Close database connection
 */
async function closeDirectorDatabase() {
    if (db) {
        await db.close();
        db = null;
    }
}

// Director Session Functions
async function createDirectorSession(sessionData) {
    try {
        const result = await db.run(`
            INSERT INTO director_sessions
            (name, filename, image_type, provider, model, max_resolution, session_mode, user_intent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            sessionData.name,
            sessionData.filename,
            sessionData.imageType || 'generated',
            sessionData.provider,
            sessionData.model,
            sessionData.max_resolution ? 1 : 0,
            sessionData.sessionMode || 'analyse',
            sessionData.userIntent || ''
        ]);
        return result.lastID;
    } catch (error) {
        console.error('❌ Error creating Director session:', error.message);
        return null;
    }
}

async function getDirectorSession(sessionId) {
    try {
        return await db.get('SELECT * FROM director_sessions WHERE id = ?', [sessionId]);
    } catch (error) {
        console.error('❌ Error getting Director session:', error.message);
        return null;
    }
}

async function getAllDirectorSessions() {
    try {
        return await db.all('SELECT * FROM director_sessions ORDER BY created_at DESC');
    } catch (error) {
        console.error('❌ Error getting all Director sessions:', error.message);
        return [];
    }
}

async function updateDirectorSession(sessionId, updates) {
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
        
        const result = await db.run(`UPDATE director_sessions SET ${fields.join(', ')} WHERE id = ?`, values);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error updating Director session:', error.message);
        return false;
    }
}

async function deleteDirectorSession(sessionId) {
    try {
        const result = await db.run('DELETE FROM director_sessions WHERE id = ?', [sessionId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error deleting Director session:', error.message);
        return false;
    }
}

// Director Message Functions
async function addDirectorMessage(directorSessionId, role, content, previousMessageId = null, messageType = null, userInput = null) {
    try {
        // Calculate expiration date (30 days from now)
        const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
        
        // Convert content to JSON string if it's an object/array
        let contentString = content;
        if (typeof content === 'object' && content !== null) {
            contentString = JSON.stringify(content);
        }
        
        const result = await db.run(`
            INSERT INTO director_messages 
            (director_session_id, role, content, message_type, user_input, previous_message_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            directorSessionId,
            role,
            contentString,
            messageType,
            userInput,
            previousMessageId,
            expiresAt
        ]);
        
        // Update session's updated_at timestamp
        await updateDirectorSession(directorSessionId, {});
        
        return result.lastID;
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
                if (typeof textItem.text === 'string') {
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
                } else {
                    return {
                        type: 'structured',
                        data: textItem.text
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
    } catch (e) {
        return {
            type: 'error',
            data: { error: 'Invalid Response from AI' }
        };
    }
}

async function getDirectorMessages(sessionId, limit = 100, offset = 0, includeSystem = false, includeExtraFields = true) {
    try {
        // Filter out system messages unless explicitly requested
        let sql = 'SELECT * FROM director_messages';
        let params = [];

        if (includeSystem) {
            sql += ' WHERE director_session_id = ?';
            params.push(sessionId);
        } else {
            sql += ' WHERE director_session_id = ? AND role != ?';
            params.push(sessionId, 'system');
        }

        sql += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const messages = await db.all(sql, params);
        
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

async function getDirectorMessageCount(sessionId) {
    try {
        const result = await db.get('SELECT COUNT(*) as count FROM director_messages WHERE director_session_id = ?', [sessionId]);
        return result.count;
    } catch (error) {
        console.error('❌ Error getting Director message count:', error.message);
        return 0;
    }
}

async function getLastDirectorMessage(sessionId) {
    try {
        const message = await db.get(`
            SELECT * FROM director_messages 
            WHERE director_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [sessionId]);
        
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

async function getLastDirectorMessageId(sessionId) {
    try {
        const result = await db.get(`
            SELECT id FROM director_messages 
            WHERE director_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [sessionId]);
        return result ? result.id : null;
    } catch (error) {
        console.error('❌ Error getting last Director message ID:', error.message);
        return null;
    }
}

// Database statistics
async function getDirectorDatabaseStats() {
    try {
        const sessionCount = (await db.get('SELECT COUNT(*) as count FROM director_sessions'))?.count;
        const messageCount = (await db.get('SELECT COUNT(*) as count FROM director_messages'))?.count;

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
async function deleteDirectorMessagesFrom(sessionId, messageId) {
    try {
        // First get the target message to find its timestamp
        const targetMessage = await db.get(`
            SELECT created_at FROM director_messages
            WHERE id = ? AND director_session_id = ?
        `, [messageId, sessionId]);

        if (!targetMessage) {
            console.error(`❌ Message ${messageId} not found in session ${sessionId}`);
            return false;
        }

        // Delete all messages from the target message onwards (including the target)
        // We need to be careful about foreign key constraints
        const result = await db.run(`
            DELETE FROM director_messages
            WHERE director_session_id = ? AND created_at >= ?
        `, [sessionId, targetMessage.created_at]);
        
        console.log(`🗑️ Deleted ${result.changes} messages from session ${sessionId} starting from message ${messageId}`);

        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error deleting director messages:', error);
        return false;
    }
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
    getCheckpointManager,
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
