const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { createDatabaseCheckpointManager } = require('./databaseCheckpoint');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'chat.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

let db = null;

// Initialize checkpoint manager for chat database
const chatCheckpointManager = createDatabaseCheckpointManager(dbPath, 5);

// Track message count for periodic checkpointing
let messagesSinceLastCheckpoint = 0;
const CHECKPOINT_INTERVAL = 10; // Create checkpoint every N messages

/**
 * Initialize the SQLite database for chat system
 */
function initializeChatDatabase() {
    try {
        // Open database (creates if doesn't exist)
        db = new Database(dbPath);
        
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 10000');
        db.pragma('temp_store = MEMORY');
        
        // Create tables if they don't exist
        createChatTables();
        
        return true;
    } catch (error) {
        logger.error('Error initializing SQLite chat database:', error.message);
        return false;
    }
}

/**
 * Create database tables for chat system
 */
function createChatTables() {
    // Persona settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS persona_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT,
            profile_photo_base64 TEXT,
            backstory TEXT,
            default_verbosity INTEGER DEFAULT 3,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Chat sessions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_name TEXT,
            filename TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            character_name TEXT,
            text_context_info TEXT,
            text_viewer_info TEXT,
            story_context TEXT,
            verbosity_level INTEGER DEFAULT 3,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Add token usage tracking columns for Responses API
    try {
        db.exec(`ALTER TABLE chat_sessions ADD COLUMN total_tokens INTEGER DEFAULT 0`);
    } catch (error) {
        // Column already exists, ignore error
    }
    
    try {
        db.exec(`ALTER TABLE chat_sessions ADD COLUMN last_response_usage TEXT`);
    } catch (error) {
        // Column already exists, ignore error
    }
    
    try {
        db.exec(`ALTER TABLE chat_sessions ADD COLUMN story_context TEXT`);
    } catch (error) {
        // Column already exists, ignore error
    }
    

    // Chat messages table
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_session_id INTEGER NOT NULL,
            message_type TEXT NOT NULL, -- 'user' or 'assistant'
            content TEXT NOT NULL,
            json_data TEXT, -- JSON response data from AI (legacy format)
            event_type TEXT, -- Type of event (actions, speech, memory, etc.)
            event_metadata TEXT, -- Additional event properties (timestamp, weight, intensity, etc.)
            response_id TEXT, -- AI service response ID for conversation state
            conversation_data TEXT, -- Full conversation state data
            reasoning_content TEXT, -- AI's reasoning/thinking process (for reasoning models)
            response_output TEXT, -- Full response.output array for 30+ day reconstruction (Responses API)
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            expires_at INTEGER, -- Timestamp for 30-day retention
            FOREIGN KEY (chat_session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
        )
    `);
    
    // Create indexes for better performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_filename ON chat_sessions (filename);
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON chat_sessions (created_at);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (chat_session_id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at);
    `);
    
    logger.bootSubStep('Chat database ready');
}

/**
 * Close database connection
 */
function closeChatDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

// Persona Settings Functions
function getPersonaSettings() {
    try {
        const stmt = db.prepare('SELECT * FROM persona_settings ORDER BY id DESC LIMIT 1');
        return stmt.get() || {
            user_name: '',
            profile_photo_base64: '',
            backstory: '',
            default_verbosity: 3
        };
    } catch (error) {
        console.error('❌ Error getting persona settings:', error.message);
        return null;
    }
}

function savePersonaSettings(settings) {
    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO persona_settings 
            (id, user_name, profile_photo_base64, backstory, default_verbosity, updated_at)
            VALUES (1, ?, ?, ?, ?, strftime('%s', 'now'))
        `);
        stmt.run(
            settings.user_name,
            settings.profile_photo_base64,
            settings.backstory,
            settings.default_verbosity
        );
        return true;
    } catch (error) {
        console.error('❌ Error saving persona settings:', error.message);
        return false;
    }
}

// Chat Session Functions
function createChatSession(sessionData) {
    try {
        // Check if old columns still exist
        const tableInfo = db.prepare("PRAGMA table_info(chat_sessions)").all();
        const hasOldColumns = tableInfo.some(col => col.name === 'chat_model') && tableInfo.some(col => col.name === 'chat_service');
        
        let sql, params;
        
        if (hasOldColumns) {
            // Include old columns for backward compatibility
            sql = `
                INSERT INTO chat_sessions 
                (chat_name, filename, provider, model, character_name, text_context_info, text_viewer_info, story_context, verbosity_level, chat_model, chat_service)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            params = [
                sessionData.chat_name,
                sessionData.filename,
                sessionData.provider,
                sessionData.model,
                sessionData.character_name,
                sessionData.text_context_info,
                sessionData.text_viewer_info,
                sessionData.story_context,
                sessionData.verbosity_level,
                sessionData.model, // Use model as chat_model for backward compatibility
                'grok' // Only Grok is supported now
            ];
        } else {
            // Use new schema only
            sql = `
                INSERT INTO chat_sessions 
                (chat_name, filename, provider, model, character_name, text_context_info, text_viewer_info, story_context, verbosity_level)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            params = [
                sessionData.chat_name,
                sessionData.filename,
                sessionData.provider,
                sessionData.model,
                sessionData.character_name,
                sessionData.text_context_info,
                sessionData.text_viewer_info,
                sessionData.story_context,
                sessionData.verbosity_level
            ];
        }
        
        const stmt = db.prepare(sql);
        const result = stmt.run(...params);
        return result.lastInsertRowid;
    } catch (error) {
        console.error('❌ Error creating chat session:', error.message);
        return null;
    }
}

function getChatSession(chatId) {
    try {
        const stmt = db.prepare('SELECT * FROM chat_sessions WHERE id = ?');
        return stmt.get(chatId);
    } catch (error) {
        console.error('❌ Error getting chat session:', error.message);
        return null;
    }
}

function getChatSessionsByFilename(filename) {
    try {
        const stmt = db.prepare('SELECT * FROM chat_sessions WHERE filename = ? ORDER BY created_at DESC');
        return stmt.all(filename);
    } catch (error) {
        console.error('❌ Error getting chat sessions by filename:', error.message);
        return [];
    }
}

function getAllChatSessions() {
    try {
        const stmt = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
        return stmt.all();
    } catch (error) {
        console.error('❌ Error getting all chat sessions:', error.message);
        return [];
    }
}

function updateChatSession(chatId, updates) {
    try {
        const fields = [];
        const values = [];
        
        Object.keys(updates).forEach(key => {
            if (updates[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });
        
        // Always update updated_at timestamp, even if no other fields are being updated
        fields.push('updated_at = strftime(\'%s\', \'now\')');
        values.push(chatId);
        
        const stmt = db.prepare(`UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`);
        const result = stmt.run(...values);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error updating chat session:', error.message);
        return false;
    }
}

function deleteChatSession(chatId) {
    try {
        const stmt = db.prepare('DELETE FROM chat_sessions WHERE id = ?');
        const result = stmt.run(chatId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error deleting chat session:', error.message);
        return false;
    }
}

function restartChatSession(chatId) {
    try {
        // Delete all messages for this chat session
        const deleteMessagesStmt = db.prepare('DELETE FROM chat_messages WHERE chat_session_id = ?');
        deleteMessagesStmt.run(chatId);
        
        // Update the chat session's updated_at timestamp
        const updateStmt = db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?');
        const now = Math.floor(Date.now() / 1000);
        const result = updateStmt.run(now, chatId);
        
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error restarting chat session:', error.message);
        return false;
    }
}

// Chat Message Functions
function addChatMessage(chatSessionId, messageType, content, jsonData = null, responseId = null, conversationData = null, previousMessageId = null, eventType = null, eventMetadata = null, reasoningContent = null, responseOutput = null) {
    try {
        // Calculate expiration date (30 days from now)
        const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
        
        const stmt = db.prepare(`
            INSERT INTO chat_messages (chat_session_id, message_type, content, json_data, response_id, conversation_data, expires_at, previous_message_id, event_type, event_metadata, reasoning_content, response_output)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(chatSessionId, messageType, content, jsonData, responseId, conversationData, expiresAt, previousMessageId, eventType, eventMetadata, reasoningContent, responseOutput);
        
        // Update chat session's updated_at timestamp
        updateChatSession(chatSessionId, {});
        
        // Automatic checkpointing: create checkpoint every N messages
        messagesSinceLastCheckpoint++;
        if (messagesSinceLastCheckpoint >= CHECKPOINT_INTERVAL) {
            try {
                chatCheckpointManager.createCheckpointWithBackup();
                messagesSinceLastCheckpoint = 0;
                console.log('💾 Auto-checkpoint created');
            } catch (checkpointError) {
                console.warn('⚠️  Auto-checkpoint failed:', checkpointError.message);
                // Don't fail the message save if checkpoint fails
            }
        }
        
        return result.lastInsertRowid;
    } catch (error) {
        console.error('❌ Error adding chat message:', error.message);
        return null;
    }
}

function getChatMessages(chatSessionId, limit = 50, offset = 0) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM chat_messages 
            WHERE chat_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(chatSessionId, limit, offset);
    } catch (error) {
        console.error('❌ Error getting chat messages:', error.message);
        return [];
    }
}

function getChatMessageCount(chatSessionId) {
    try {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM chat_messages WHERE chat_session_id = ?');
        const result = stmt.get(chatSessionId);
        return result.count;
    } catch (error) {
        console.error('❌ Error getting chat message count:', error.message);
        return 0;
    }
}

function deleteChatMessage(messageId) {
    try {
        // First, get the message to find its chat_session_id
        const message = db.prepare('SELECT chat_session_id, created_at FROM chat_messages WHERE id = ?').get(messageId);
        
        if (!message) {
            console.error(`❌ Message ${messageId} not found`);
            return false;
        }
        
        const chatSessionId = message.chat_session_id;
        
        // Delete the message
        const stmt = db.prepare('DELETE FROM chat_messages WHERE id = ?');
        const result = stmt.run(messageId);
        
        if (result.changes > 0) {
            // Get the most recent remaining message's timestamp to set as the session's updated_at
            const lastMessage = getLastChatMessage(chatSessionId);
            const updateStmt = db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?');
            
            if (lastMessage && lastMessage.created_at) {
                // Set updated_at to the most recent remaining message's timestamp
                updateStmt.run(lastMessage.created_at, chatSessionId);
                console.log(`🗑️ Deleted chat message ${messageId} from session ${chatSessionId}, updated session timestamp to ${lastMessage.created_at}`);
            } else {
                // No messages remain, update to current time
                const now = Math.floor(Date.now() / 1000);
                updateStmt.run(now, chatSessionId);
                console.log(`🗑️ Deleted chat message ${messageId} from session ${chatSessionId}, no messages remain`);
            }
            
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('❌ Error deleting chat message:', error.message);
        return false;
    }
}

function getLastChatMessage(chatSessionId) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM chat_messages 
            WHERE chat_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        return stmt.get(chatSessionId);
    } catch (error) {
        console.error('❌ Error getting last chat message:', error.message);
        return null;
    }
}

function getConversationData(chatSessionId) {
    try {
        const stmt = db.prepare(`
            SELECT response_id, conversation_data, created_at, response_output 
            FROM chat_messages 
            WHERE chat_session_id = ? AND response_id IS NOT NULL 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        return stmt.get(chatSessionId);
    } catch (error) {
        console.error('❌ Error getting conversation data:', error.message);
        return null;
    }
}

function updateConversationData(chatSessionId, responseId, conversationData) {
    try {
        const stmt = db.prepare(`
            UPDATE chat_messages 
            SET response_id = ?, conversation_data = ? 
            WHERE chat_session_id = ? AND message_type = 'assistant' 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        const result = stmt.run(responseId, conversationData, chatSessionId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error updating conversation data:', error.message);
        return false;
    }
}

function cleanupExpiredMessages() {
    try {
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare('DELETE FROM chat_messages WHERE expires_at < ?');
        const result = stmt.run(now);
        
        if (result.changes > 0) {
            console.log(`🧹 Cleaned up ${result.changes} expired messages`);
        }
        
        return result.changes;
    } catch (error) {
        console.error('❌ Error cleaning up expired messages:', error.message);
        return 0;
    }
}

// Database statistics
function getChatDatabaseStats() {
    try {
        const sessionCount = db.prepare('SELECT COUNT(*) as count FROM chat_sessions').get().count;
        const messageCount = db.prepare('SELECT COUNT(*) as count FROM chat_messages').get().count;
        const personaSettings = db.prepare('SELECT COUNT(*) as count FROM persona_settings').get().count;
        
        return {
            sessions: sessionCount,
            messages: messageCount,
            personaSettings: personaSettings
        };
    } catch (error) {
        console.error('❌ Error getting chat database stats:', error.message);
        return null;
    }
}

// Checkpoint management functions for chat database
function getChatCheckpointInfo() {
    return chatCheckpointManager.getCheckpointInfo();
}

function createChatCheckpoint() {
    try {
        return chatCheckpointManager.createCheckpointWithBackup();
    } catch (error) {
        console.error('❌ Error creating chat checkpoint:', error);
        throw error;
    }
}

function restoreChatFromCheckpoint(checkpointFilename) {
    try {
        const success = chatCheckpointManager.restoreFromCheckpoint(checkpointFilename);
        if (success) {
            // Reinitialize database connection after restore
            closeChatDatabase();
            initializeChatDatabase();
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error restoring chat from checkpoint:', error);
        throw error;
    }
}

function restoreChatFromLatestCheckpoint() {
    try {
        const success = chatCheckpointManager.restoreFromLatestCheckpoint();
        if (success) {
            // Reinitialize database connection after restore
            closeChatDatabase();
            initializeChatDatabase();
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error restoring chat from latest checkpoint:', error);
        throw error;
    }
}

function clearChatCheckpoints() {
    try {
        return chatCheckpointManager.clearAllCheckpoints();
    } catch (error) {
        console.error('❌ Error clearing chat checkpoints:', error);
        throw error;
    }
}

function verifyChatDatabaseIntegrity() {
    try {
        return chatCheckpointManager.verifyDatabaseIntegrity();
    } catch (error) {
        console.error('❌ Error verifying chat database integrity:', error);
        return false;
    }
}

// Initialize database on module load
let dbInitialized = false;
try {
    dbInitialized = initializeChatDatabase();
    if (!dbInitialized) {
        throw new Error('Failed to initialize chat database');
    }
    // Logging happens in createChatTables during boot
} catch (error) {
    logger.error('Failed to initialize chat database:', error.message);
    process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', () => {
    closeChatDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeChatDatabase();
    process.exit(0);
});

module.exports = {
    initializeChatDatabase,
    closeChatDatabase,
    getPersonaSettings,
    savePersonaSettings,
    createChatSession,
    getChatSession,
    getChatSessionsByFilename,
    getAllChatSessions,
    updateChatSession,
    deleteChatSession,
    restartChatSession,
    addChatMessage,
    getChatMessages,
    getChatMessageCount,
    deleteChatMessage,
    getLastChatMessage,
    getConversationData,
    updateConversationData,
    cleanupExpiredMessages,
    getChatDatabaseStats,
    
    // Checkpoint management
    getChatCheckpointInfo,
    createChatCheckpoint,
    restoreChatFromCheckpoint,
    restoreChatFromLatestCheckpoint,
    clearChatCheckpoints,
    verifyChatDatabaseIntegrity
};
