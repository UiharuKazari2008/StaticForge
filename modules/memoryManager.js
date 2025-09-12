/**
 * Centralized Memory Management System
 * Handles character memories and conversation summaries with database persistence
 */

const { addChatMessage, getChatMessages } = require('./chatDatabase');

class MemoryManager {
    constructor() {
        this.characterMemories = new Map(); // chatId -> memories array (in-memory cache)
        this.conversationSummaries = new Map(); // chatId -> conversation summary (in-memory cache)
        this.loadExistingMemories();
    }

    /**
     * Load existing memories from database on startup
     */
    async loadExistingMemories() {
        try {
            console.log('🔄 Loading existing memories from database...');
            // Note: We don't preload all memories, just ensure database is accessible
            console.log('✅ Memory manager ready');
        } catch (error) {
            console.error('❌ Error loading existing memories:', error);
        }
    }

    /**
     * Get character memories for a specific chat session
     */
    getCharacterMemories(chatId) {
        // Return cached memories if available
        if (this.characterMemories.has(chatId)) {
            return this.characterMemories.get(chatId);
        }

        // Load from database if not in cache
        try {
            const messages = getChatMessages(chatId, 100, 0);
            const memories = [];
            
            // Extract memories from assistant messages
            for (const message of messages) {
                if (message.message_type === 'assistant' && message.content) {
                    const extractedMemories = this.extractMemoriesFromResponse(message.content);
                    extractedMemories.forEach(memory => {
                        memories.push({
                            content: memory,
                            timestamp: message.created_at * 1000, // Convert to milliseconds
                            importance: 'medium'
                        });
                    });
                }
            }

            // Sort by timestamp (newest first) and limit to 50
            memories.sort((a, b) => b.timestamp - a.timestamp);
            const limitedMemories = memories.slice(0, 50);
            
            // Cache the memories
            this.characterMemories.set(chatId, limitedMemories);
            return limitedMemories;
        } catch (error) {
            console.error('Error loading character memories:', error);
            return [];
        }
    }

    /**
     * Add a memory to a character's memory bank
     */
    addCharacterMemory(chatId, memory) {
        if (!this.characterMemories.has(chatId)) {
            this.characterMemories.set(chatId, []);
        }
        
        const memories = this.characterMemories.get(chatId);
        
        // Handle both old string format and new object format
        const memoryObj = typeof memory === 'string' ? {
            content: memory,
            timestamp: Date.now(),
            weight: 50,
            importance: 'medium'
        } : {
            content: memory.content,
            timestamp: memory.timestamp || Date.now(),
            weight: memory.weight || 50,
            importance: memory.weight > 75 ? 'high' : memory.weight > 25 ? 'medium' : 'low'
        };
        
        memories.push(memoryObj);
        
        // Sort by weight (importance) and keep only the most important 50 memories
        memories.sort((a, b) => b.weight - a.weight);
        if (memories.length > 50) {
            memories.splice(50);
        }

        // Persist to database by adding a special memory message
        try {
            addChatMessage(chatId, 'memory', memoryObj.content, JSON.stringify(memoryObj), null, null, null);
        } catch (error) {
            console.error('Error persisting memory to database:', error);
        }
    }

    /**
     * Get conversation summary for context
     */
    getConversationSummary(chatId) {
        // Return cached summary if available
        if (this.conversationSummaries.has(chatId)) {
            return this.conversationSummaries.get(chatId);
        }

        // Generate summary from recent messages
        try {
            const messages = getChatMessages(chatId, 20, 0);
            const summary = this.generateConversationSummary(messages);
            this.conversationSummaries.set(chatId, summary);
            return summary;
        } catch (error) {
            console.error('Error loading conversation summary:', error);
            return '';
        }
    }

    /**
     * Update conversation summary
     */
    updateConversationSummary(chatId, summary) {
        this.conversationSummaries.set(chatId, summary);
    }

    /**
     * Extract key memories from AI response (supports both old and new formats)
     */
    extractMemoriesFromResponse(response) {
        try {
            const parsed = JSON.parse(response);
            
            // New event-based format
            if (Array.isArray(parsed)) {
                const memories = [];
                parsed.forEach(event => {
                    if (event.type === 'memory' && event.content) {
                        memories.push({
                            content: event.content,
                            weight: event.weight || 50, // Default weight if not specified
                            timestamp: event.timestamp || Date.now()
                        });
                    }
                });
                return memories;
            }
            
            // Old format compatibility
            if (parsed.appendMemory && Array.isArray(parsed.appendMemory)) {
                return parsed.appendMemory.map(memory => ({
                    content: memory,
                    weight: 50, // Default weight for old format
                    timestamp: Date.now()
                }));
            }
        } catch (e) {
            // If parsing fails, try to extract memories from text
            const memoryMatches = response.match(/memory[:\s]+([^,]+)/gi);
            if (memoryMatches) {
                return memoryMatches.map(m => ({
                    content: m.replace(/memory[:\s]+/i, '').trim(),
                    weight: 50,
                    timestamp: Date.now()
                }));
            }
        }
        return [];
    }

    /**
     * Generate conversation summary from recent messages
     */
    generateConversationSummary(messages, maxLength = 500) {
        if (messages.length === 0) return '';
        
        // Get last 10 messages for summary
        const recentMessages = messages.slice(-10);
        const summary = recentMessages.map(msg => {
            const role = msg.message_type === 'user' ? 'User' : 'Character';
            const content = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;
            return `${role}: ${content}`;
        }).join('\n');
        
        return summary.length > maxLength ? summary.substring(0, maxLength) + '...' : summary;
    }

    /**
     * Clear memories for a specific chat session
     */
    clearMemories(chatId) {
        this.characterMemories.delete(chatId);
        this.conversationSummaries.delete(chatId);
    }

    /**
     * Get memory statistics
     */
    getMemoryStats() {
        const totalMemories = Array.from(this.characterMemories.values())
            .reduce((sum, memories) => sum + memories.length, 0);
        
        return {
            totalMemories,
            activeChats: this.characterMemories.size,
            totalSummaries: this.conversationSummaries.size
        };
    }
}

// Create singleton instance
const memoryManager = new MemoryManager();

module.exports = memoryManager;
