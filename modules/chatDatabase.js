const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'chat.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

let db = null;

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
        
        console.log('✅ SQLite chat database initialized');
        return true;
    } catch (error) {
        console.error('❌ Error initializing SQLite chat database:', error.message);
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
            default_ai_engine TEXT DEFAULT 'grok-2',
            default_temperature REAL DEFAULT 0.8,
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
            verbosity_level INTEGER DEFAULT 3,
            temperature REAL DEFAULT 0.8,
            thought_level TEXT DEFAULT 'minimal',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Add thought_level column if it doesn't exist (migration)
    try {
        db.exec(`ALTER TABLE chat_sessions ADD COLUMN thought_level TEXT DEFAULT 'minimal'`);
    } catch (error) {
        // Column already exists, ignore error
    }
    
    // Migration: Add provider and model columns, migrate from chat_model and chat_service
    try {
        // Check if old columns exist
        const tableInfo = db.prepare("PRAGMA table_info(chat_sessions)").all();
        const hasOldColumns = tableInfo.some(col => col.name === 'chat_model') && tableInfo.some(col => col.name === 'chat_service');
        const hasNewColumns = tableInfo.some(col => col.name === 'provider') && tableInfo.some(col => col.name === 'model');
        
        if (hasOldColumns && !hasNewColumns) {
            console.log('🔄 Migrating chat_sessions table to new provider/model structure...');
            
            // Add new columns with error handling
            try {
                db.exec(`ALTER TABLE chat_sessions ADD COLUMN provider TEXT`);
            } catch (error) {
                if (!error.message.includes('duplicate column name')) {
                    throw error;
                }
                console.log('⚠️ Provider column already exists, skipping...');
            }
            
            try {
                db.exec(`ALTER TABLE chat_sessions ADD COLUMN model TEXT`);
            } catch (error) {
                if (!error.message.includes('duplicate column name')) {
                    throw error;
                }
                console.log('⚠️ Model column already exists, skipping...');
            }
            
            // Migrate existing data
            const sessions = db.prepare('SELECT id, chat_model, chat_service FROM chat_sessions').all();
            const updateStmt = db.prepare('UPDATE chat_sessions SET provider = ?, model = ? WHERE id = ?');
            
            for (const session of sessions) {
                let provider = 'grok';
                let model = session.chat_model;
                
                // Determine provider from chat_service or model name
                if (session.chat_service === 'chatgpt' || 
                    (session.chat_model && (session.chat_model.includes('gpt') || session.chat_model.includes('o4')))) {
                    provider = 'openai';
                }
                
                // Extract clean model name (remove provider prefix if present)
                if (model && model.includes('-')) {
                    const parts = model.split('-');
                    if (parts[0] === 'gpt' || parts[0] === 'o4') {
                        model = model; // Keep full model name for OpenAI
                    }
                }
                
                updateStmt.run(provider, model, session.id);
            }
            
            console.log(`✅ Migrated ${sessions.length} chat sessions to new structure`);
        } else {
            console.log('ℹ️ Migration not needed - new columns already exist or no old columns found');
        }
    } catch (error) {
        console.warn('⚠️ Migration error (may be expected):', error.message);
    }
    
    // Migration: Add response_id, conversation_data, and expires_at columns to chat_messages
    try {
        const messageTableInfo = db.prepare("PRAGMA table_info(chat_messages)").all();
        const hasResponseId = messageTableInfo.some(col => col.name === 'response_id');
        const hasConversationData = messageTableInfo.some(col => col.name === 'conversation_data');
        const hasExpiresAt = messageTableInfo.some(col => col.name === 'expires_at');
        
        if (!hasResponseId) {
            db.exec(`ALTER TABLE chat_messages ADD COLUMN response_id TEXT`);
            console.log('✅ Added response_id column to chat_messages');
        }
        
        if (!hasConversationData) {
            db.exec(`ALTER TABLE chat_messages ADD COLUMN conversation_data TEXT`);
            console.log('✅ Added conversation_data column to chat_messages');
        }
        
        if (!hasExpiresAt) {
            db.exec(`ALTER TABLE chat_messages ADD COLUMN expires_at INTEGER`);
            console.log('✅ Added expires_at column to chat_messages');
        }
        
        // Add previous_message_id column for conversation continuity
        const hasPreviousMessageId = messageTableInfo.some(col => col.name === 'previous_message_id');
        if (!hasPreviousMessageId) {
            db.exec(`ALTER TABLE chat_messages ADD COLUMN previous_message_id TEXT`);
            console.log('✅ Added previous_message_id column to chat_messages');
        }
    } catch (error) {
        console.warn('⚠️ Migration error for chat_messages (may be expected):', error.message);
    }
    
    // Chat messages table
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_session_id INTEGER NOT NULL,
            message_type TEXT NOT NULL, -- 'user' or 'assistant'
            content TEXT NOT NULL,
            json_data TEXT, -- JSON response data from AI
            response_id TEXT, -- AI service response ID for conversation state
            conversation_data TEXT, -- Full conversation state data
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
    
    console.log('✅ Chat database tables created/verified');
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
            default_verbosity: 3,
            default_ai_engine: 'grok-2',
            default_temperature: 0.8,
            default_reasoning_level: 'medium'
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
            (id, user_name, profile_photo_base64, backstory, default_verbosity, default_ai_engine, default_temperature, default_reasoning_level, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        `);
        stmt.run(
            settings.user_name,
            settings.profile_photo_base64,
            settings.backstory,
            settings.default_verbosity,
            settings.default_ai_engine,
            settings.default_temperature || 0.8,
            settings.default_reasoning_level || 'medium'
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
                (chat_name, filename, provider, model, character_name, text_context_info, text_viewer_info, verbosity_level, temperature, thought_level, chat_model, chat_service)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            params = [
                sessionData.chat_name,
                sessionData.filename,
                sessionData.provider,
                sessionData.model,
                sessionData.character_name,
                sessionData.text_context_info,
                sessionData.text_viewer_info,
                sessionData.verbosity_level,
                sessionData.temperature || 0.8,
                sessionData.thought_level || 'minimal',
                sessionData.model, // Use model as chat_model for backward compatibility
                sessionData.provider === 'openai' ? 'chatgpt' : 'grok' // Convert provider to old format
            ];
        } else {
            // Use new schema only
            sql = `
                INSERT INTO chat_sessions 
                (chat_name, filename, provider, model, character_name, text_context_info, text_viewer_info, verbosity_level, temperature, thought_level)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            params = [
                sessionData.chat_name,
                sessionData.filename,
                sessionData.provider,
                sessionData.model,
                sessionData.character_name,
                sessionData.text_context_info,
                sessionData.text_viewer_info,
                sessionData.verbosity_level,
                sessionData.temperature || 0.8,
                sessionData.thought_level || 'minimal'
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
        
        if (fields.length === 0) return false;
        
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
function addChatMessage(chatSessionId, messageType, content, jsonData = null, responseId = null, conversationData = null, previousMessageId = null) {
    try {
        // Calculate expiration date (30 days from now)
        const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
        
        const stmt = db.prepare(`
            INSERT INTO chat_messages (chat_session_id, message_type, content, json_data, response_id, conversation_data, expires_at, previous_message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(chatSessionId, messageType, content, jsonData, responseId, conversationData, expiresAt, previousMessageId);
        
        // Update chat session's updated_at timestamp
        updateChatSession(chatSessionId, {});
        
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
            SELECT response_id, conversation_data, created_at 
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

// Initialize database on module load
let dbInitialized = false;
try {
    dbInitialized = initializeChatDatabase();
    if (!dbInitialized) {
        throw new Error('Failed to initialize chat database');
    }
    console.log('✅ Chat database module ready');
} catch (error) {
    console.error('❌ Failed to initialize chat database:', error.message);
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
    getLastChatMessage,
    getConversationData,
    updateConversationData,
    cleanupExpiredMessages,
    getChatDatabaseStats
};
