/**
 * Unified AI Service Manager
 * Manages all AI services with database persistence and prompt separation
 */

class AIServiceManager {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('AIServiceManager requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.activeServices = new Map(); // chatId -> service instance
        this.serviceTimeouts = new Map(); // chatId -> timeout
        this.SERVICE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000); // Cleanup every 5 minutes
        
        // Load existing sessions from database on startup
        this.loadExistingSessions();
    }

    /**
     * Load existing chat sessions from database on startup
     */
    async loadExistingSessions() {
        try {
            this.globalResources.getLogger().bootSubStep('Chat database connection verified');
        } catch (error) {
            console.error('❌ Error loading existing sessions:', error);
        }
    }

    /**
     * Get or create AI service for a chat session
     */
    async getOrCreateService(chatId) {
        // Check if service already exists in memory
        if (this.activeServices.has(chatId)) {
            console.log(`♻️ Reusing existing AI service for ${chatId}`);
            this.resetTimeout(chatId);
            return this.activeServices.get(chatId);
        }

        console.log(`🆕 Creating new AI service for ${chatId}`);
        
        // Load session data from database
        const sessionData = await this.globalResources.getChatDatabase().getChatSession(chatId);
        if (!sessionData) {
            throw new Error(`Chat session not found: ${chatId}`);
        }

        // Get persona settings
        const personaSettings = await this.globalResources.getChatDatabase().getPersonaSettings();

        // Get system prompt using prompt manager (using characterChat prompt type)
        // Pass filename to enable dynamic context extraction
        const systemPrompt = await this.globalResources.getPromptManager().getCompleteSystemPrompt(
            'characterChat',
            sessionData,
            personaSettings,
            sessionData.filename
        );

        // Create AI service instance based on provider
        let aiService;
        if (sessionData.provider === 'grok') {
            aiService = await this.globalResources.getGrokService().createPersonaChatSession(sessionData, personaSettings, systemPrompt);
            
            // Restore last response ID from database for Responses API
            const conversationData = await this.globalResources.getChatDatabase().getConversationData(chatId);
            if (conversationData && conversationData.response_id) {
                aiService.lastResponseId = conversationData.response_id;
                console.log(`🔄 Restored previous response ID for ${chatId}: ${conversationData.response_id}`);
            }
        } else {
            throw new Error(`Unsupported chat provider: ${sessionData.provider}`);
        }

        // Store service in memory
        const serviceInfo = {
            aiService,
            sessionData,
            personaSettings,
            systemPrompt,
            createdAt: Date.now(),
            lastUsed: Date.now()
        };
        
        this.activeServices.set(chatId, serviceInfo);
        this.resetTimeout(chatId);

        return serviceInfo;
    }

    /**
     * Load conversation history from database
     */
    async loadConversationHistory(chatId, maxMessages = 20) {
        try {
            const messages = await this.globalResources.getChatDatabase().getChatMessages(chatId, maxMessages, 0);
            return messages.reverse().map(msg => ({
                message_type: msg.message_type,
                content: msg.content,
                created_at: msg.created_at
            }));
        } catch (error) {
            console.error('Error loading conversation history:', error);
            return [];
        }
    }

    /**
     * Establish persona if needed (separate from service creation)
     */
    async establishPersonaIfNeeded(chatId, personaImage, userPrompt, viewerAvatar, onStreamUpdate = null) {
        const messageCount = await this.globalResources.getChatDatabase().getChatMessageCount(chatId);
        if (messageCount > 1) {
            console.log(`🎭 Persona already established for ${chatId} (${messageCount} messages)`);
            return;
        }

        const serviceInfo = await this.getOrCreateService(chatId);
        console.log(`🎭 Establishing persona for ${chatId}`);
        
        if (serviceInfo.sessionData.provider === 'grok') {
            if (onStreamUpdate) {
                await this.globalResources.getGrokService().establishPersonaStreaming(serviceInfo.aiService, personaImage, userPrompt, viewerAvatar, onStreamUpdate);
            } else {
                await this.globalResources.getGrokService().establishPersona(serviceInfo.aiService, personaImage, userPrompt, viewerAvatar);
            }
        } else {
            throw new Error(`Unsupported chat provider: ${serviceInfo.sessionData.provider}`);
        }

        serviceInfo.lastUsed = Date.now();
    }

    /**
     * Continue conversation using existing service
     */
    async continueConversation(chatId, message, onStreamUpdate = null) {
        const serviceInfo = await this.getOrCreateService(chatId);
        console.log(`💬 Continuing conversation for ${chatId} using ${serviceInfo.sessionData.provider}`);
        
        serviceInfo.lastUsed = Date.now();
        this.resetTimeout(chatId);

        // Add user message to database
        await this.globalResources.getChatDatabase().addChatMessage(chatId, 'user', message);

        let response;
        if (serviceInfo.sessionData.provider === 'grok') {
            if (onStreamUpdate) {
                response = await this.globalResources.getGrokService().continueConversationStreaming(serviceInfo.aiService, message, onStreamUpdate);
            } else {
                response = await this.globalResources.getGrokService().continueConversation(serviceInfo.aiService, message);
            }
        } else {
            throw new Error(`Unsupported chat provider: ${serviceInfo.sessionData.provider}`);
        }

        // Clean up expired messages periodically
        if (Math.random() < 0.1) { // 10% chance to clean up on each request
            await this.globalResources.getChatDatabase().cleanupExpiredMessages();
        }

        return response;
    }

    /**
     * Reset service timeout
     */
    resetTimeout(chatId) {
        // Clear existing timeout
        if (this.serviceTimeouts.has(chatId)) {
            clearTimeout(this.serviceTimeouts.get(chatId));
        }

        // Set new timeout
        const timeout = setTimeout(() => {
            this.cleanupService(chatId);
        }, this.SERVICE_TIMEOUT);

        this.serviceTimeouts.set(chatId, timeout);
    }

    /**
     * Clean up a specific service
     */
    cleanupService(chatId) {
        console.log(`🧹 Cleaning up AI service for ${chatId}`);
        this.activeServices.delete(chatId);
        
        if (this.serviceTimeouts.has(chatId)) {
            clearTimeout(this.serviceTimeouts.get(chatId));
            this.serviceTimeouts.delete(chatId);
        }
    }

    /**
     * Force cleanup of a specific service
     */
    forceCleanupService(chatId) {
        console.log(`🗑️ Force cleaning up AI service for ${chatId}`);
        this.cleanupService(chatId);
    }

    /**
     * Clean up expired services
     */
    cleanup() {
        const now = Date.now();
        const expired = [];
        
        for (const [chatId, serviceInfo] of this.activeServices.entries()) {
            if (now - serviceInfo.lastUsed > this.SERVICE_TIMEOUT) {
                expired.push(chatId);
            }
        }
        
        expired.forEach(chatId => {
            this.cleanupService(chatId);
        });

        if (expired.length > 0) {
            console.log(`🧹 Cleaned up ${expired.length} expired AI services`);
        }
    }

    /**
     * Get service info
     */
    getServiceInfo(chatId) {
        return this.activeServices.get(chatId);
    }

    /**
     * Check if service exists
     */
    hasService(chatId) {
        return this.activeServices.has(chatId);
    }

    /**
     * Get all active service IDs
     */
    getActiveServiceIds() {
        return Array.from(this.activeServices.keys());
    }

    /**
     * Get service statistics
     */
    getStats() {
        const now = Date.now();
        const services = Array.from(this.activeServices.values());
        
        return {
            totalServices: services.length,
            activeServices: services.filter(s => now - s.lastUsed < this.SERVICE_TIMEOUT).length,
            providers: [...new Set(services.map(s => s.sessionData.provider))],
            oldestService: services.length > 0 ? Math.min(...services.map(s => s.createdAt)) : null,
            newestService: services.length > 0 ? Math.max(...services.map(s => s.createdAt)) : null
        };
    }

    /**
     * Clean up all services
     */
    cleanupAllServices() {
        console.log('🧹 Cleaning up all AI services');
        for (const chatId of this.activeServices.keys()) {
            this.cleanupService(chatId);
        }
    }

    /**
     * Restart service (force recreation)
     */
    async restartService(chatId) {
        console.log(`🔄 Restarting AI service for ${chatId}`);
        this.forceCleanupService(chatId);
        return await this.getOrCreateService(chatId);
    }

    /**
     * Restore conversation state from stored data
     */
    async restoreConversationState(chatId) {
        try {
            const conversationData = await this.globalResources.getChatDatabase().getConversationData(chatId);
            if (!conversationData || !conversationData.conversation_data) {
                return null;
            }

            const state = JSON.parse(conversationData.conversation_data);
            return {
                messages: state.messages || [],
                model: state.model,
                temperature: state.temperature,
                thoughtLevel: state.thoughtLevel,
                lastUpdated: state.lastUpdated
            };
        } catch (error) {
            console.error('Error restoring conversation state:', error);
            return null;
        }
    }

    /**
     * Check if conversation state is still valid (within 30 days)
     */
    async isConversationStateValid(chatId) {
        const conversationData = await this.globalResources.getChatDatabase().getConversationData(chatId);
        if (!conversationData) {
            return false;
        }

        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        return conversationData.created_at * 1000 > thirtyDaysAgo;
    }
}

// Export class - will be instantiated in globalResources
module.exports = AIServiceManager;
