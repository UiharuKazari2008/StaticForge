const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { asyncSQLiteManager } = require('./sqliteAsyncWrapper');

let dbPath = null;
let db = null;

// Track message count for periodic checkpointing
let messagesSinceLastCheckpoint = 0;
const CHECKPOINT_INTERVAL = 10; // Create checkpoint every N messages

/**
 * Initialize the SQLite database for chat system
 */
async function initializeChatDatabase(databasesPath) {
    try {
        dbPath = path.join(databasesPath, 'chat.db');
        db = asyncSQLiteManager.getDatabase(dbPath, {
            idleTimeoutMinutes: 30,
            maxCheckpoints: 5,
            enableCheckpointing: true
        });
        
        // Open database (creates if doesn't exist)
        await db.open();
        
        // Create tables if they don't exist
        await createChatTables();
        
        logger.bootSubStep('Chat database ready');
        return true;
    } catch (error) {
        logger.error('Error initializing SQLite chat database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

/**
 * Create database tables for chat system
 */
async function createChatTables() {
    // Persona settings table
    await db.exec(`
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
    
    // Chat engine choice on the persona row (Yozora #763)
    await addPersonaEngineColumns();
    await refreshChatEngineCache();

    // Chat sessions table
    await db.exec(`
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
        await db.exec(`ALTER TABLE chat_sessions ADD COLUMN total_tokens INTEGER DEFAULT 0`);
    } catch (error) {
        // Column already exists, ignore error
    }
    
    try {
        await db.exec(`ALTER TABLE chat_sessions ADD COLUMN last_response_usage TEXT`);
    } catch (error) {
        // Column already exists, ignore error
    }
    
    try {
        await db.exec(`ALTER TABLE chat_sessions ADD COLUMN story_context TEXT`);
    } catch (error) {
        // Column already exists, ignore error
    }

    // Chat messages table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_session_id INTEGER NOT NULL,
            message_type TEXT NOT NULL, -- 'user' or 'assistant'
            content TEXT NOT NULL,
            json_data TEXT, -- JSON response data from SI (legacy format)
            event_type TEXT, -- Type of event (actions, speech, memory, etc.)
            event_metadata TEXT, -- Additional event properties (timestamp, weight, intensity, etc.)
            response_id TEXT, -- SI service response ID for conversation state
            conversation_data TEXT, -- Full conversation state data
            reasoning_content TEXT, -- SI's reasoning/thinking process (for reasoning models)
            response_output TEXT, -- Full response.output array for 30+ day reconstruction (Responses API)
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            expires_at INTEGER, -- Timestamp for 30-day retention
            FOREIGN KEY (chat_session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
        )
    `);
    
    // Create indexes for better performance
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_filename ON chat_sessions (filename);
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON chat_sessions (created_at);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (chat_session_id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at);
    `);
}

/**
 * Close database connection
 */
async function closeChatDatabase() {
    if (db) {
        await db.close();
        db = null;
    }
}

// Persona Settings Functions
// One row (id 1) holds "My info" (user_name, profile_photo_base64, backstory, default_verbosity)
// and the chat engine choice (chat_provider, chat_model, chat_effort; Yozora #763). Saves MERGE:
// only keys present in the input are written, so the Memories applet's persona form never wipes
// the engine and the Control Panel's engine page never wipes My info.
const PERSONA_FIELDS = ['user_name', 'profile_photo_base64', 'backstory', 'default_verbosity', 'chat_provider', 'chat_model', 'chat_effort'];
const CHAT_EFFORTS = ['default', 'none', 'low', 'medium', 'high'];
let chatEngineCache = { provider: '', model: '', effort: 'default' };

function normalizeChatEngine(row) {
    const provider = String((row && row.chat_provider) || '').trim().toLowerCase();
    const model = String((row && row.chat_model) || '').trim();
    const effortText = String((row && row.chat_effort) || '').trim().toLowerCase();
    return {
        provider: /^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider) ? provider : '',
        model: model.slice(0, 300),
        effort: CHAT_EFFORTS.includes(effortText) ? effortText : 'default'
    };
}

async function addPersonaEngineColumns() {
    const cols = await db.all('PRAGMA table_info(persona_settings)');
    const have = new Set(cols.map((col) => col.name));
    for (const [name, type] of [['chat_provider', 'TEXT'], ['chat_model', 'TEXT'], ['chat_effort', 'TEXT']]) {
        if (!have.has(name)) await db.exec(`ALTER TABLE persona_settings ADD COLUMN ${name} ${type}`);
    }
}

async function readPersonaRow() {
    return db.get('SELECT * FROM persona_settings ORDER BY id DESC LIMIT 1');
}

async function refreshChatEngineCache() {
    try {
        chatEngineCache = normalizeChatEngine(await readPersonaRow());
    } catch (error) {
        console.error('❌ Error reading chat engine settings:', error.message);
    }
    return chatEngineCache;
}

// Synchronous copy for the chat service (modules/aiServices/deepInfraChatService.js).
function getChatEngineSettings() {
    return { ...chatEngineCache };
}

async function getPersonaSettings() {
    try {
        const result = await readPersonaRow();
        return result || {
            user_name: '',
            profile_photo_base64: '',
            backstory: '',
            default_verbosity: 3,
            chat_provider: '',
            chat_model: '',
            chat_effort: 'default'
        };
    } catch (error) {
        console.error('❌ Error getting persona settings:', error.message);
        return null;
    }
}

async function savePersonaSettings(settings) {
    try {
        const input = settings && typeof settings === 'object' ? settings : {};
        const current = (await readPersonaRow()) || {};
        const merged = {};
        for (const key of PERSONA_FIELDS) {
            merged[key] = Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined
                ? input[key]
                : (current[key] !== undefined ? current[key] : null);
        }
        if (merged.default_verbosity == null) merged.default_verbosity = 3;
        const id = current.id || 1;
        await db.run(`
            INSERT INTO persona_settings
            (id, user_name, profile_photo_base64, backstory, default_verbosity, chat_provider, chat_model, chat_effort, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                user_name = excluded.user_name,
                profile_photo_base64 = excluded.profile_photo_base64,
                backstory = excluded.backstory,
                default_verbosity = excluded.default_verbosity,
                chat_provider = excluded.chat_provider,
                chat_model = excluded.chat_model,
                chat_effort = excluded.chat_effort,
                updated_at = excluded.updated_at
        `, [id, ...PERSONA_FIELDS.map((key) => merged[key])]);
        chatEngineCache = normalizeChatEngine(merged);
        return true;
    } catch (error) {
        console.error('❌ Error saving persona settings:', error.message);
        return false;
    }
}

// { provider, model, effort } -> merged into the persona row. Omitted keys stay.
async function saveChatEngineSettings(engine) {
    const input = engine && typeof engine === 'object' ? engine : {};
    const patch = {};
    if (input.provider !== undefined) patch.chat_provider = String(input.provider || '').trim().toLowerCase();
    if (input.model !== undefined) patch.chat_model = String(input.model || '').trim();
    if (input.effort !== undefined) {
        const effort = String(input.effort || '').trim().toLowerCase();
        patch.chat_effort = CHAT_EFFORTS.includes(effort) ? effort : 'default';
    }
    const ok = await savePersonaSettings(patch);
    return ok ? getChatEngineSettings() : null;
}

// Chat Session Functions
async function createChatSession(sessionData) {
    try {
        // Check if old columns still exist
        const tableInfo = await db.all("PRAGMA table_info(chat_sessions)");
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
                'deepinfra' // Chat runs on DeepInfra (Yozora #736 / #738); old 'grok' rows still load
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
        
        const result = await db.run(sql, params);
        return result.lastID;
    } catch (error) {
        console.error('❌ Error creating chat session:', error.message);
        return null;
    }
}

async function getChatSession(chatId) {
    try {
        return await db.get('SELECT * FROM chat_sessions WHERE id = ?', [chatId]);
    } catch (error) {
        console.error('❌ Error getting chat session:', error.message);
        return null;
    }
}

async function getChatSessionsByFilename(filename) {
    try {
        return await db.all('SELECT * FROM chat_sessions WHERE filename = ? ORDER BY created_at DESC', [filename]);
    } catch (error) {
        console.error('❌ Error getting chat sessions by filename:', error.message);
        return [];
    }
}

async function getAllChatSessions() {
    try {
        return await db.all('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
    } catch (error) {
        console.error('❌ Error getting all chat sessions:', error.message);
        return [];
    }
}

async function updateChatSession(chatId, updates) {
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
        
        const result = await db.run(`UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`, values);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error updating chat session:', error.message);
        return false;
    }
}

async function deleteChatSession(chatId) {
    try {
        const result = await db.run('DELETE FROM chat_sessions WHERE id = ?', [chatId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error deleting chat session:', error.message);
        return false;
    }
}

async function restartChatSession(chatId) {
    try {
        // Delete all messages for this chat session
        await db.run('DELETE FROM chat_messages WHERE chat_session_id = ?', [chatId]);
        
        // Update the chat session's updated_at timestamp
        const now = Math.floor(Date.now() / 1000);
        const result = await db.run('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [now, chatId]);
        
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error restarting chat session:', error.message);
        return false;
    }
}

// Chat Message Functions
async function addChatMessage(chatSessionId, messageType, content, jsonData = null, responseId = null, conversationData = null, previousMessageId = null, eventType = null, eventMetadata = null, reasoningContent = null, responseOutput = null) {
    try {
        // Calculate expiration date (30 days from now)
        const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
        
        const result = await db.run(`
            INSERT INTO chat_messages (chat_session_id, message_type, content, json_data, response_id, conversation_data, expires_at, previous_message_id, event_type, event_metadata, reasoning_content, response_output)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [chatSessionId, messageType, content, jsonData, responseId, conversationData, expiresAt, previousMessageId, eventType, eventMetadata, reasoningContent, responseOutput]);
        
        // Update chat session's updated_at timestamp
        await updateChatSession(chatSessionId, {});
        
        // Automatic checkpointing: create checkpoint every N messages
        messagesSinceLastCheckpoint++;
        if (messagesSinceLastCheckpoint >= CHECKPOINT_INTERVAL) {
            // Fire-and-forget async checkpoint (don't block message save)
            db.createCheckpointIfDirty().then(() => {
                messagesSinceLastCheckpoint = 0;
                console.log('💾 Auto-checkpoint created');
            }).catch((checkpointError) => {
                console.warn('⚠️  Auto-checkpoint failed:', checkpointError.message);
                // Don't fail the message save if checkpoint fails
            });
        }
        
        return result.lastID;
    } catch (error) {
        console.error('❌ Error adding chat message:', error.message);
        return null;
    }
}

async function getChatMessages(chatSessionId, limit = 50, offset = 0) {
    try {
        return await db.all(`
            SELECT * FROM chat_messages 
            WHERE chat_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `, [chatSessionId, limit, offset]);
    } catch (error) {
        console.error('❌ Error getting chat messages:', error.message);
        return [];
    }
}

async function getChatMessageCount(chatSessionId) {
    try {
        const result = await db.get('SELECT COUNT(*) as count FROM chat_messages WHERE chat_session_id = ?', [chatSessionId]);
        return result?.count || 0;
    } catch (error) {
        console.error('❌ Error getting chat message count:', error.message);
        return 0;
    }
}

async function deleteChatMessage(messageId) {
    try {
        // First, get the message to find its chat_session_id
        const message = await db.get('SELECT chat_session_id, created_at FROM chat_messages WHERE id = ?', [messageId]);
        
        if (!message) {
            console.error(`❌ Message ${messageId} not found`);
            return false;
        }
        
        const chatSessionId = message.chat_session_id;
        
        // Delete the message
        const result = await db.run('DELETE FROM chat_messages WHERE id = ?', [messageId]);
        
        if (result.changes > 0) {
            // Get the most recent remaining message's timestamp to set as the session's updated_at
            const lastMessage = await getLastChatMessage(chatSessionId);
            
            if (lastMessage && lastMessage.created_at) {
                // Set updated_at to the most recent remaining message's timestamp
                await db.run('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [lastMessage.created_at, chatSessionId]);
                console.log(`🗑️ Deleted chat message ${messageId} from session ${chatSessionId}, updated session timestamp to ${lastMessage.created_at}`);
            } else {
                // No messages remain, update to current time
                const now = Math.floor(Date.now() / 1000);
                await db.run('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [now, chatSessionId]);
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

async function getLastChatMessage(chatSessionId) {
    try {
        return await db.get(`
            SELECT * FROM chat_messages 
            WHERE chat_session_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [chatSessionId]);
    } catch (error) {
        console.error('❌ Error getting last chat message:', error.message);
        return null;
    }
}

/**
 * A persona's live state for its contact card (modules/chatPersonaContacts.js, Yozora #763): the
 * newest assistant row of each state event type, the memory rows (newest first), and when the chat
 * last had a message.
 */
async function getPersonaStateRows(chatSessionId, eventTypes, memoryLimit = 200) {
    try {
        const types = Array.isArray(eventTypes) && eventTypes.length ? eventTypes : ['emotion'];
        const marks = types.map(() => '?').join(',');
        const latest = await db.all(`
            SELECT m.event_type, m.content, m.event_metadata, m.created_at
            FROM chat_messages m
            JOIN (
                SELECT event_type, MAX(id) AS id FROM chat_messages
                WHERE chat_session_id = ? AND message_type = 'assistant' AND event_type IN (${marks})
                GROUP BY event_type
            ) t ON m.id = t.id
        `, [chatSessionId, ...types]);
        const memories = await db.all(`
            SELECT content, event_metadata, created_at FROM chat_messages
            WHERE chat_session_id = ? AND message_type = 'assistant' AND event_type = 'memory'
            ORDER BY id DESC LIMIT ?
        `, [chatSessionId, memoryLimit]);
        const stats = await db.get(`
            SELECT COUNT(*) AS count, MAX(created_at) AS last_at,
                MAX(CASE WHEN message_type = 'user' THEN created_at END) AS last_user_at,
                MAX(CASE WHEN message_type = 'assistant' THEN created_at END) AS last_assistant_at
            FROM chat_messages WHERE chat_session_id = ?
        `, [chatSessionId]);
        return { latest: latest || [], memories: memories || [], stats: stats || {} };
    } catch (error) {
        console.error('❌ Error getting persona state rows:', error.message);
        return { latest: [], memories: [], stats: {} };
    }
}

async function getConversationData(chatSessionId) {
    try {
        return await db.get(`
            SELECT response_id, conversation_data, created_at, response_output 
            FROM chat_messages 
            WHERE chat_session_id = ? AND response_id IS NOT NULL 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [chatSessionId]);
    } catch (error) {
        console.error('❌ Error getting conversation data:', error.message);
        return null;
    }
}

async function updateConversationData(chatSessionId, responseId, conversationData) {
    try {
        // Note: SQLite doesn't support LIMIT in UPDATE, so we need a different approach
        // Get the most recent assistant message ID first
        const lastMessage = await db.get(`
            SELECT id FROM chat_messages 
            WHERE chat_session_id = ? AND message_type = 'assistant' 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [chatSessionId]);
        
        if (!lastMessage) {
            return false;
        }
        
        const result = await db.run(`
            UPDATE chat_messages 
            SET response_id = ?, conversation_data = ? 
            WHERE id = ?
        `, [responseId, conversationData, lastMessage.id]);
        
        return result.changes > 0;
    } catch (error) {
        console.error('❌ Error updating conversation data:', error.message);
        return false;
    }
}

async function cleanupExpiredMessages() {
    try {
        const now = Math.floor(Date.now() / 1000);
        const result = await db.run('DELETE FROM chat_messages WHERE expires_at < ?', [now]);
        
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
async function getChatDatabaseStats() {
    try {
        const sessionCount = (await db.get('SELECT COUNT(*) as count FROM chat_sessions'))?.count || 0;
        const messageCount = (await db.get('SELECT COUNT(*) as count FROM chat_messages'))?.count || 0;
        const personaSettings = (await db.get('SELECT COUNT(*) as count FROM persona_settings'))?.count || 0;
        
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

module.exports = {
    initializeChatDatabase,
    closeChatDatabase,
    getPersonaSettings,
    savePersonaSettings,
    getChatEngineSettings,
    saveChatEngineSettings,
    CHAT_EFFORTS,
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
    getPersonaStateRows,
    getConversationData,
    updateConversationData,
    cleanupExpiredMessages,
    getChatDatabaseStats
};
