const { zodResponseFormat } = require("openai/helpers/zod");
const { z } = require('zod');
const clarinet = require('clarinet');
const sharp = require('sharp');
const { toResponsesApiMessages } = require('./responsesApiInput');
const { DEFAULT_FORGE_MODEL } = require('../modelFeatures');

/**
 * GrokService class - handles all Grok SI service interactions
 */
class GrokService {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('GrokService requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
    }

    /** Default Grok model id when none is specified (from config.json `defaultGrokModel`) */
    getDefaultGrokModel() {
        return this.globalResources.getConfig({ path: 'defaultGrokModel' }) || 'grok-4-fast-reasoning';
    }

    // Zod schema for chat event responses (shared constants)
    static get ChatEventSchema() {
        return z.object({
            type: z.enum([
                'actions', 'sfx', 'speechdirect', 'speech', 'reply', 'innerspeech',
                'emotion', 'environment', 'memory', 'currplan', 'futureplans',
                'trustlevel', 'inventory', 'sensory', 'offlinemessage',
                'timeofday', 'location', 'myname'
            ]),
            content: z.string(),
            timestamp: z.number().nullable().optional(),
            weight: z.number().nullable().optional(), // For memory events
            intensity: z.number().nullable().optional() // For emotion events
        });
    }

    static get ChatResponseSchema() {
        return z.object({
            events: z.array(GrokService.ChatEventSchema)
        });
    }

    /**
     * Gracefully parse a Zod schema, filtering out invalid items from arrays instead of failing
     * @param {z.ZodSchema} schema - The Zod schema to validate against
     * @param {any} rawData - The raw data to parse
     * @param {string} context - Context for logging (e.g., "dynamic generation response")
     * @returns {Object} - { success: boolean, data: any, errors: array, filtered: object }
     */
    gracefulParse(schema, rawData, context = 'response') {
        const result = schema.safeParse(rawData);
        
        if (result.success) {
            this.globalResources.getLogger().verbose(`✅ ${context} parsed successfully`);
            return { success: true, data: result.data, errors: [], filtered: {} };
        }
        
        // Parsing failed - try to salvage what we can
        this.globalResources.getLogger().detailed(`⚠️ ${context} validation failed, attempting graceful degradation`);
        const errors = result.error.errors;
        const filtered = {};
        
        // Clone the raw data to work with
        const cleanedData = JSON.parse(JSON.stringify(rawData));
        
        // Group errors by path
        const errorsByPath = {};
        errors.forEach(err => {
            const pathKey = err.path.join('.');
            if (!errorsByPath[pathKey]) {
                errorsByPath[pathKey] = [];
            }
            errorsByPath[pathKey].push(err);
        });
        
        // Process each error path - track unique array items to remove
        const itemsToRemove = new Map(); // Map<arrayName, Set<index>>
        
        for (const [pathKey, pathErrors] of Object.entries(errorsByPath)) {
            const pathParts = pathKey.split('.');
            
            // Check if this is an array item error (has numeric index in path)
            const arrayIndex = pathParts.findIndex(part => !isNaN(parseInt(part)));
            
            if (arrayIndex !== -1) {
                // This is an array item error - filter out the invalid item
                const arrayPath = pathParts.slice(0, arrayIndex);
                const itemIndex = parseInt(pathParts[arrayIndex]);
                const fieldPath = pathParts.slice(arrayIndex + 1).join('.');
                
                // Navigate to the array
                let arrayRef = cleanedData;
                let validPath = true;
                for (const part of arrayPath) {
                    if (arrayRef && typeof arrayRef === 'object') {
                        arrayRef = arrayRef[part];
                    } else {
                        validPath = false;
                        break;
                    }
                }
                
                if (validPath && Array.isArray(arrayRef) && itemIndex < arrayRef.length) {
                    const arrayName = arrayPath.join('.') || 'root';
                    
                    // Track unique items to remove (deduplicate by index)
                    if (!itemsToRemove.has(arrayName)) {
                        itemsToRemove.set(arrayName, new Map());
                    }
                    const indexMap = itemsToRemove.get(arrayName);
                    
                    // Only track this index once, but accumulate all errors
                    if (!indexMap.has(itemIndex)) {
                        const invalidItem = arrayRef[itemIndex];
                        indexMap.set(itemIndex, {
                            index: itemIndex,
                            item: JSON.parse(JSON.stringify(invalidItem)), // Deep clone
                            errors: [],
                            reason: ''
                        });
                    }
                    
                    // Add errors to the tracked item
                    const trackedItem = indexMap.get(itemIndex);
                    trackedItem.errors.push(...pathErrors);
                    const errorReason = `${fieldPath || 'item'}: ${pathErrors.map(e => e.message).join(', ')}`;
                    trackedItem.reason = trackedItem.reason 
                        ? `${trackedItem.reason}; ${errorReason}` 
                        : errorReason;
                    
                    console.log(`   🗑️  Filtering ${arrayName}[${itemIndex}]: ${pathErrors.map(e => e.message).join(', ')}`);
                }
            } else {
                // Non-array error - log but keep the field
                this.globalResources.getLogger().verbose(`   ⚠️  Non-array validation error at ${pathKey}:`, pathErrors.map(e => e.message).join(', '));
            }
        }
        
        // Convert to filtered format and remove items
        for (const [arrayName, indexMap] of itemsToRemove.entries()) {
            const arrayPath = arrayName === 'root' ? [] : arrayName.split('.');
            let arrayRef = cleanedData;
            
            // Navigate to the array
            for (const part of arrayPath) {
                if (arrayRef && typeof arrayRef === 'object') {
                    arrayRef = arrayRef[part];
                } else {
                    arrayRef = null;
                    break;
                }
            }
            
            if (Array.isArray(arrayRef)) {
                // Convert Map to array and sort by index descending to remove from end to start
                const items = Array.from(indexMap.values());
                const sortedItems = items.sort((a, b) => b.index - a.index);
                
                // Store in filtered for return value
                if (!filtered[arrayName]) {
                    filtered[arrayName] = [];
                }
                filtered[arrayName].push(...items);
                
                // Remove items (from highest index to lowest to maintain indices)
                for (const item of sortedItems) {
                    if (item.index < arrayRef.length) {
                        arrayRef.splice(item.index, 1);
                    }
                }
                
                console.log(`   ✂️  Removed ${items.length} invalid item(s) from ${arrayName}, ${arrayRef.length} valid items remaining`);
            }
        }
        
        // Try parsing again with cleaned data
        const retryResult = schema.safeParse(cleanedData);
        
        if (retryResult.success) {
            this.globalResources.getLogger().detailed(`✅ ${context} parsed after filtering ${Object.keys(filtered).length} array(s)`);
            return { 
                success: true, 
                data: retryResult.data, 
                errors: errors, 
                filtered: filtered,
                partialSuccess: true 
            };
        }
        
        // Still failing - return what we have with error flag
        console.error(`❌ ${context} still invalid after filtering. Returning partial data.`);
        return { 
            success: false, 
            data: cleanedData, 
            errors: retryResult.error.errors, 
            filtered: filtered,
            partialFailure: true 
        };
    }

/**
 * Ensures all events have unique sequential timestamps
 * Auto-increments any duplicate timestamps
 */
    ensureUniqueTimestamps(events) {
    const usedTimestamps = new Set();
    let maxTimestamp = -1;
    
    // First pass: collect used timestamps and find max
    events.forEach(event => {
        if (event.timestamp !== null && event.timestamp !== undefined) {
            usedTimestamps.add(event.timestamp);
            if (event.timestamp > maxTimestamp) {
                maxTimestamp = event.timestamp;
            }
        }
    });
    
    // Second pass: assign unique timestamps
    events.forEach(event => {
        // If timestamp is missing, null, or already used, assign a new one
        if (event.timestamp === null || event.timestamp === undefined || usedTimestamps.has(event.timestamp)) {
            // Check if this timestamp was already used
            const originalTimestamp = event.timestamp;
            if (originalTimestamp !== null && originalTimestamp !== undefined) {
                // Duplicate timestamp - increment from max
                maxTimestamp++;
                event.timestamp = maxTimestamp;
                usedTimestamps.add(maxTimestamp);
                console.log(`⏰ Auto-incremented duplicate timestamp ${originalTimestamp} → ${maxTimestamp}`);
            } else {
                // Missing timestamp - assign next sequential
                maxTimestamp++;
                event.timestamp = maxTimestamp;
                usedTimestamps.add(maxTimestamp);
            }
        }
    });
    
    return events;
}

    getVerbosityInstruction(level) {
    if (level === 'auto') {
        return "Adjust your response length and level of detail naturally based on the conversational context. Be as brief or as elaborate as the moment requires.";
    }
    switch (level) {
        case 1: return "You are extremely terse and brief. Use as few words as possible. Get straight to the point.";
        case 2: return "You are concise and direct. Avoid unnecessary elaboration.";
        case 3: return "You are moderately detailed in your expression.";
        case 4: return "You are quite descriptive and tend to elaborate on your thoughts and feelings.";
        case 5: return "You are highly verbose and poetic. You describe your sensory experiences, emotions, and thoughts with rich, intricate detail.";
        default: return "Adjust your response length and level of detail naturally.";
    }
};

// This function is now handled by the prompt manager
// The system prompt is loaded from JSON templates
    async createPersonaChatSession(sessionData, personaSettings, systemPrompt) {
    
        // Load conversation context and memories
        const conversationContext = await this.globalResources.getPromptManager().prepareConversationContext(sessionData.id, 'grok');
        const characterMemories = await this.globalResources.getMemoryManager().getCharacterMemories(sessionData.id);
        const conversationSummary = await this.globalResources.getMemoryManager().getConversationSummary(sessionData.id);
    
    // Format memories with weights for better context
    const formattedMemories = characterMemories
        .sort((a, b) => b.weight - a.weight) // Sort by importance
        .slice(0, 20) // Take top 20 most important memories
        .map(m => `[${m.weight}%] ${m.content}`)
        .join(', ');
    
    // Enhance system prompt with context
    const enhancedSystemPrompt = systemPrompt
        .replace('{{character_memories}}', characterMemories.length > 0 ? `- **Your Core Memories (weighted by importance):** ${formattedMemories}` : '')
        .replace('{{conversation_history}}', conversationContext.conversationHistory);
    
    return {
        messages: [
            {
                role: "system",
                content: enhancedSystemPrompt
            }
        ],
        verbosityLevel: sessionData.verbosity_level || 3,
        model: sessionData.model || this.getDefaultGrokModel(),
        chatId: sessionData.id,
        sessionData: sessionData,
        personaSettings: personaSettings
    };
}

// Helper function to compress images for API requests
    async compressImage(base64String, mimeType, maxDimension = 1024, quality = 85) {
    try {
        const imageBuffer = Buffer.from(base64String, 'base64');
        const metadata = await sharp(imageBuffer).metadata();
        
        // Calculate dimensions to fit within maxDimension while preserving aspect ratio
        let newWidth = metadata.width;
        let newHeight = metadata.height;
        
        if (metadata.width > maxDimension || metadata.height > maxDimension) {
            const scale = maxDimension / Math.max(metadata.width, metadata.height);
            newWidth = Math.round(metadata.width * scale);
            newHeight = Math.round(metadata.height * scale);
            console.log(`🖼️ Compressing image from ${metadata.width}x${metadata.height} to ${newWidth}x${newHeight}`);
        }
        
        // Compress the image
        const compressedBuffer = await sharp(imageBuffer)
            .resize(newWidth, newHeight, {
                fit: 'inside',
                withoutEnlargement: false
            })
            .jpeg({ quality: quality }) // Convert to JPEG with specified quality
            .toBuffer();
        
        const compressedBase64 = compressedBuffer.toString('base64');
        const originalSize = base64String.length;
        const compressedSize = compressedBase64.length;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        
        console.log(`📦 Image compression: ${originalSize} → ${compressedSize} bytes (${compressionRatio}% reduction)`);
        
        return {
            base64: compressedBase64,
            mimeType: 'image/jpeg',
            originalSize: originalSize,
            compressedSize: compressedSize
        };
    } catch (error) {
        console.error('❌ Error compressing image:', error.message);
        // Return original if compression fails
        return {
            base64: base64String,
            mimeType: mimeType,
            originalSize: 0,
            compressedSize: 0
        };
    }
}

    async establishPersona(chat, personaImage, userPrompt, viewerAvatar) {
    try {
        const messages = [...chat.messages];
        
        // Get persona establishment prompt from prompt manager
        const personaPrompt = this.globalResources.getPromptManager().getPersonaEstablishmentPrompt('characterChat', userPrompt);
        
        // Compress persona image to reduce API request size
        const compressedPersona = await this.compressImage(personaImage.base64, personaImage.mimeType);
        
        // Add the persona establishment message
        // NOTE: Responses API uses "input_text" and "input_image", not "text" and "image_url"
        const content = [
            {
                type: "input_text",
                text: personaPrompt
            },
            {
                type: "input_image",
                image_url: `data:${compressedPersona.mimeType};base64,${compressedPersona.base64}`
            }
        ];

        // Add viewer avatar if provided
        if (viewerAvatar) {
            // Compress viewer avatar as well
            const compressedAvatar = await this.compressImage(viewerAvatar.base64, viewerAvatar.mimeType);
            
            content.push({
                type: "input_text",
                text: "\n\nThis is my beloved, who I am speaking to:"
            });
            content.push({
                type: "input_image",
                image_url: `data:${compressedAvatar.mimeType};base64,${compressedAvatar.base64}`
            });
        }

        messages.push({
            role: "user",
            content: content
        });

        const input = messages.map(message => ({
            role: message.role,
            content: message.content
        }));

        // NOTE: Using Responses API with store: false for initial persona establishment with images
        // to avoid 413 errors when sending large images, as per x.ai documentation recommendation.
        const apiConfig = {
            model: chat.model || this.getDefaultGrokModel(),
            input: input,
            max_completion_tokens: 8000,
            response_format: zodResponseFormat(GrokService.ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"],
            store: true
        };
        
        // Calculate and log total request size for debugging
        const requestPayload = JSON.stringify(apiConfig);
        const requestSizeMB = (requestPayload.length / (1024 * 1024)).toFixed(2);
        console.log(`📏 [establishPersona] Total request size: ${requestSizeMB} MB`);

        const completion = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));

        // DEBUG: Log full completion object
        console.log('🔍 [Responses API] Full completion object:', JSON.stringify(completion, null, 2));

        // Extract response content - Responses API structure is different
        const response = completion.output_text || completion.output?.[0]?.content || completion.content;
        const responseId = completion.id; // Store the response ID for conversation state
        const encryptedThinking = completion.reasoning?.encrypted_content || null;
        
        // DEBUG: Log extracted values
        console.log('🔍 [Responses API] Extracted response:', response);
        console.log('🔍 [Responses API] Response ID:', responseId);
        console.log('🔍 [Responses API] Encrypted thinking:', encryptedThinking ? 'Present' : 'Not present');
        
        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: response,
            responseId: responseId
        });

        // Update the chat object with the stored response ID
        chat.messages = messages;
        chat.lastResponseId = responseId; // Store response ID for Responses API

        // Parse and validate response using Zod schema
        if (chat.chatId) {
            let validated = null;
            
            try {
                // Parse and validate with Zod schema - structured output guarantees valid JSON
                const rawParsed = JSON.parse(response);
                // Responses API returns the events array directly - wrap it for schema validation
                const responseData = Array.isArray(rawParsed) ? { events: rawParsed } : rawParsed;
                validated = ChatResponseSchema.parse(responseData);
            } catch (parseError) {
                console.error('❌ Failed to parse/validate persona establishment response:', parseError.message);
                throw new Error('Invalid response format from SI');
            }
            
            // Store conversation data for context
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                lastResponseId: responseId,
                lastUpdated: Date.now()
            });
            
            // Store response.output for 30+ day reconstruction
            const responseOutput = completion.output ? JSON.stringify(completion.output) : null;
            
            // DEBUG: Log response output
            console.log('🔍 [Responses API] Response output:', responseOutput);
            
            // Ensure all events have unique sequential timestamps
            ensureUniqueTimestamps(validated.events);
            
            // Store each event as a separate message
            for (const event of validated.events) {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                await this.globalResources.getChatDatabase().addChatMessage(
                    chat.chatId, 
                    'assistant', 
                    event.content, 
                    null,
                    responseId, 
                    conversationData, 
                    null, 
                    event.type,
                    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    encryptedThinking,
                    responseOutput
                );
            }
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Update token usage tracking for chat session
            if (completion?.usage) {
                const totalTokens = completion.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completion.usage)
                };
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API] Token usage: ${totalTokens} total tokens`);
            }
        }

        // Return response with usage data
        return {
            content: response,
            usage: completion?.usage || null
        };
    } catch (error) {
        console.error("Error establishing persona:", error);
        throw new Error("The SI could not establish the persona. Please check the console for details.");
    }
}

    async continueConversation(chat, message) {
    try {
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const conversationData = await this.globalResources.getChatDatabase().getConversationData(chat.chatId);
            if (conversationData && conversationData.response_id) {
                previousResponseId = conversationData.response_id;
                lastMessageCreatedAt = conversationData.created_at;
                responseOutput = conversationData.response_output ? JSON.parse(conversationData.response_output) : null;
            }
        }
        
        // Check if message is older than 30 days
        const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
        const currentTime = Math.floor(Date.now() / 1000);
        const isMessageOld = lastMessageCreatedAt && (currentTime - lastMessageCreatedAt > thirtyDaysInSeconds);
        
        // Build input array - use response.output if message is old for 30+ day reconstruction
        let messages = [];
        if (isMessageOld && responseOutput && Array.isArray(responseOutput)) {
            // Message is older than 30 days - use response.output to include encrypted reasoning
            messages = [...responseOutput];
            console.log(`📦 Using response.output (${responseOutput.length} items) for encrypted reasoning context - message is older than 30 days`);
        } else if (previousResponseId) {
            // Use previous_response_id if message is fresh (within 30 days)
            console.log(`🔄 Using Responses API with previous_response_id: ${previousResponseId}`);
        } else {
            // Fall back to messages array approach
            messages = [...chat.messages];
        }
        
        // Add user message
        messages.push({
            role: "user",
            content: message
        });

        // Configure API call based on model - using Responses API format
        const apiConfig = {
            model: chat.model || this.getDefaultGrokModel(),
            input: messages,
            max_completion_tokens: 8000,
            response_format: zodResponseFormat(GrokService.ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id: ${previousResponseId}`);
        }

        const completion = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));

        // DEBUG: Log full completion object to see Responses API structure
        console.log('🔍 [Responses API] Full completion object (continue):', JSON.stringify(completion, null, 2));

        // Responses API returns data differently than chat completions
        const response = completion.output_text || completion.output?.[0]?.content || completion.content;
        const responseId = completion.id; // Store the response ID for conversation state
        const reasoningContent = completion.reasoning?.encrypted_content || null; // Store encrypted thinking content if available
        
        // DEBUG: Log extracted values
        console.log('🔍 [Responses API] Extracted response (continue):', response?.substring(0, 200));
        console.log('🔍 [Responses API] Response ID (continue):', responseId);
        console.log('🔍 [Responses API] Encrypted thinking (continue):', reasoningContent ? 'Present' : 'Not present');
        
        // Update chat object with new response ID
        chat.lastResponseId = responseId;
        
        // Add the response to chat history (only if not using Responses API)
        if (!previousResponseId || messages.length > 1) {
            messages.push({
                role: "assistant",
                content: response,
                responseId: responseId
            });
            chat.messages = messages;
        } else {
            // When using Responses API, we only track the latest response
            // The API maintains the full conversation state
            chat.messages = [...chat.messages, {
                role: "user",
                content: message
            }, {
                role: "assistant",
                content: response,
                responseId: responseId
            }];
        }

        // Parse and validate response using Zod schema
        if (chat.chatId) {
            let validated = null;
            
            try {
                // Parse and validate with Zod schema - structured output guarantees valid JSON
                const rawParsed = JSON.parse(response);
                // Responses API returns the events array directly - wrap it for schema validation
                const responseData = Array.isArray(rawParsed) ? { events: rawParsed } : rawParsed;
                validated = ChatResponseSchema.parse(responseData);
            } catch (parseError) {
                console.error('❌ Failed to parse/validate non-streaming response:', parseError.message);
                throw new Error('Invalid response format from SI');
            }
            
            // Store conversation data for context
            const conversationData = JSON.stringify({
                model: chat.model,
                lastResponseId: responseId,
                lastUpdated: Date.now()
            });
            
            // Store response.output for 30+ day reconstruction
            const responseOutput = completion.output ? JSON.stringify(completion.output) : null;
            
            // Ensure all events have unique sequential timestamps
            ensureUniqueTimestamps(validated.events);
            
            // Store each event as a separate message
            await Promise.all(validated.events.map(async event => {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                await this.globalResources.getChatDatabase().addChatMessage(
                    chat.chatId, 
                    'assistant', 
                    event.content, 
                    null,
                    responseId, 
                    conversationData, 
                    previousResponseId, 
                    event.type,
                    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    reasoningContent,
                    responseOutput
                );
            }));
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = this.globalResources.getMemoryManager().extractMemoriesFromResponse(response);
            await Promise.all(memories.map(async memory => {
                await this.globalResources.getMemoryManager().addCharacterMemory(chat.chatId, memory);
            }));
            
            // Update conversation summary (use chat.messages for context)
            const summary = await this.globalResources.getMemoryManager().generateConversationSummary(chat.messages);
            await this.globalResources.getMemoryManager().updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completion?.usage) {
                const totalTokens = completion.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completion.usage)
                };
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API continue] Token usage: ${totalTokens} total tokens`);
            }
        }

        // Return response with usage data
        return {
            content: response,
            usage: completion?.usage || null
        };
    } catch (error) {
        console.error("Error continuing conversation:", error);
        throw new Error("The SI could not generate a response. Please check the console for details.");
    }
}

// New function that expects complete conversation context (no separate message parameter)
    async continueConversationWithContext(chat) {
    try {
        const messages = [...chat.messages];
        
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const conversationData = await this.globalResources.getChatDatabase().getConversationData(chat.chatId);
            if (conversationData && conversationData.response_id) {
                previousResponseId = conversationData.response_id;
                lastMessageCreatedAt = conversationData.created_at;
                responseOutput = conversationData.response_output ? JSON.parse(conversationData.response_output) : null;
            }
        }
        
        // Check if message is older than 30 days
        const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
        const currentTime = Math.floor(Date.now() / 1000);
        const isMessageOld = lastMessageCreatedAt && (currentTime - lastMessageCreatedAt > thirtyDaysInSeconds);

        // Build input array - use response.output if message is old for 30+ day reconstruction
        let inputMessages = [];
        if (isMessageOld && responseOutput && Array.isArray(responseOutput)) {
            // Message is older than 30 days - use response.output to include encrypted reasoning
            inputMessages = [...responseOutput];
            console.log(`📦 Using response.output (${responseOutput.length} items) for encrypted reasoning context - message is older than 30 days`);
        } else if (previousResponseId) {
            // Use previous_response_id if message is fresh (within 30 days)
            console.log(`🔄 Using Responses API with previous_response_id: ${previousResponseId}`);
        } else {
            // Fall back to messages array approach
            inputMessages = messages;
        }

        // Configure API call based on model - using Responses API format
        const apiConfig = {
            model: chat.model || this.getDefaultGrokModel(),
            input: inputMessages,
            max_completion_tokens: 8000,
            timeout: 25000,
            response_format: zodResponseFormat(GrokService.ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id (context): ${previousResponseId}`);
        }

        const completion = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));

        // DEBUG: Log full completion object to see Responses API structure
        console.log('🔍 [Responses API] Full completion object (context):', JSON.stringify(completion, null, 2));

        // Responses API returns data differently than chat completions
        const response = completion.output_text || completion.output?.[0]?.content || completion.content;
        const responseId = completion.id; // Store the response ID for conversation state
        const reasoningContent = completion.reasoning?.encrypted_content || null; // Store encrypted thinking content if available
        
        // DEBUG: Log extracted values
        console.log('🔍 [Responses API] Extracted response (context):', response?.substring(0, 200));
        console.log('🔍 [Responses API] Response ID (context):', responseId);
        console.log('🔍 [Responses API] Encrypted thinking (context):', reasoningContent ? 'Present' : 'Not present');
        
        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: response,
            responseId: responseId
        });

        // Update the chat object
        chat.messages = messages;

        // Parse and validate response using Zod schema
        if (chat.chatId) {
            let validated = null;
            
            try {
                // Parse and validate with Zod schema - structured output guarantees valid JSON
                const rawParsed = JSON.parse(response);
                // Responses API returns the events array directly - wrap it for schema validation
                const responseData = Array.isArray(rawParsed) ? { events: rawParsed } : rawParsed;
                validated = ChatResponseSchema.parse(responseData);
            } catch (parseError) {
                console.error('❌ Failed to parse/validate context response:', parseError.message);
                throw new Error('Invalid response format from SI');
            }
            
            // Store conversation data for context
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                lastUpdated: Date.now()
            });
            
            // Store response.output for 30+ day reconstruction
            const responseOutput = completion.output ? JSON.stringify(completion.output) : null;
            
            // Ensure all events have unique sequential timestamps
            ensureUniqueTimestamps(validated.events);
            
            // Store each event as a separate message
            for (const event of validated.events) {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                await this.globalResources.getChatDatabase().addChatMessage(
                    chat.chatId, 
                    'assistant', 
                    event.content, 
                    null,
                    responseId, 
                    conversationData, 
                    previousResponseId, 
                    event.type,
                    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    reasoningContent,
                    responseOutput
                );
            }
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = this.globalResources.getMemoryManager().extractMemoriesFromResponse(response);
            for (const memory of memories) {
                await this.globalResources.getMemoryManager().addCharacterMemory(chat.chatId, memory);
            }
            
            // Update conversation summary
            const summary = this.globalResources.getMemoryManager().generateConversationSummary(messages);
            this.globalResources.getMemoryManager().updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completion?.usage) {
                const totalTokens = completion.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completion.usage)
                };
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API context] Token usage: ${totalTokens} total tokens`);
            }
        }

        // Return response with usage data
        return {
            content: response,
            usage: completion?.usage || null
        };
    } catch (error) {
        console.error("Error continuing conversation with context:", error);
        throw new Error("The SI could not generate a response. Please check the console for details.");
    }
}

// Streaming versions for real-time updates
    async establishPersonaStreaming(chat, personaImage, userPrompt, viewerAvatar, onStreamUpdate) {
    try {
        const messages = [...chat.messages];
        
        // For persona establishment, there's no previous response ID
        const previousResponseId = null;
        
        // Get persona establishment prompt from prompt manager
        const personaPrompt = this.globalResources.getPromptManager().getPersonaEstablishmentPrompt('characterChat', userPrompt);
        
        // Compress persona image to reduce API request size
        const compressedPersona = await this.compressImage(personaImage.base64, personaImage.mimeType);
        
        // Add the persona establishment message
        // NOTE: Responses API uses "input_text" and "input_image", not "text" and "image_url"
        const content = [
            {
                type: "input_text",
                text: personaPrompt
            },
            {
                type: "input_image",
                image_url: `data:${compressedPersona.mimeType};base64,${compressedPersona.base64}`
            }
        ];

        // Add viewer avatar if provided
        if (viewerAvatar) {
            // Compress viewer avatar as well
            const compressedAvatar = await this.compressImage(viewerAvatar.base64, viewerAvatar.mimeType);
            
            content.push({
                type: "input_text",
                text: "\n\nThis is my beloved, who I am speaking to:"
            });
            content.push({
                type: "input_image",
                image_url: `data:${compressedAvatar.mimeType};base64,${compressedAvatar.base64}`
            });
        }

        messages.push({
            role: "user",
            content: content
        });

        const input = messages.map(message => ({
            role: message.role,
            content: message.content
        }));

        // NOTE: Using Responses API with store: false for initial persona establishment with images
        // to avoid 413 errors when sending large images, as per x.ai documentation recommendation. (Temp set to true for now to test)
        const apiConfig = {
            model: chat.model || this.getDefaultGrokModel(),
            input: input,
            max_completion_tokens: 120000,
            response_format: zodResponseFormat(GrokService.ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"],
            stream: true,
            store: true
        };
        
        // Calculate and log total request size for debugging
        const requestPayload = JSON.stringify(apiConfig);
        const requestSizeMB = (requestPayload.length / (1024 * 1024)).toFixed(2);
        console.log(`📏 [establishPersonaStreaming] Total request size: ${requestSizeMB} MB`);

        const completion = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));

        let fullResponse = '';
        let responseId = null;
        
        // Use clarinet to extract complete events as they stream in
        const jsonParser = clarinet.createStream();
        const path = [];
        let currentEvent = null;
        let extractedEvents = [];
        let inArray = false;
        let objectDepth = 0;
        
        jsonParser.on('openarray', () => {
            inArray = true;
        });
        
        jsonParser.on('openobject', (key) => {
            objectDepth++;
            if (key !== undefined) {
                path.push(key);
            }
            // Start of a new event object (when we're in an array and at root level)
            if (inArray && objectDepth === 1) {
                currentEvent = { type: null, content: null, timestamp: null };
            }
        });
        
        jsonParser.on('key', (key) => {
            if (!isNaN(key)) {
                path.push(`[${key}]`);
            } else {
                path.push(key);
            }
        });
        
        jsonParser.on('value', (value) => {
            if (currentEvent && objectDepth === 1) {
                // Only extract from root-level keys of event objects
                const key = path[path.length - 1];
                if (key === 'type') {
                    currentEvent.type = value;
                } else if (key === 'content') {
                    currentEvent.content = value;
                } else if (key === 'timestamp') {
                    currentEvent.timestamp = value;
                } else if (key === 'weight') {
                    currentEvent.weight = value;
                } else if (key === 'intensity') {
                    currentEvent.intensity = value;
                }
            }
            path.pop();
        });
        
        jsonParser.on('closeobject', () => {
            objectDepth--;
            if (currentEvent && currentEvent.type && currentEvent.content !== null) {
                // Complete event extracted - send it to client
                extractedEvents.push({ ...currentEvent });
                if (onStreamUpdate) {
                    onStreamUpdate(null, fullResponse, [currentEvent]);
                }
            }
            currentEvent = null;
            if (path.length > 0) path.pop();
        });
        
        jsonParser.on('closearray', () => {
            inArray = false;
            if (path.length > 0) path.pop();
        });
        
        jsonParser.on('error', (error) => {
            // Silently handle incomplete JSON during streaming
        });
        
        let lastChunk = null;
        let completionObject = null;
        
        for await (const chunk of completion) {
            // Log chunk structure only in verbose mode
            if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE) && 
                (chunk.type === 'response.completed' || chunk.type === 'response.output_item.done')) {
                this.globalResources.getLogger().detailed(`[Responses Streaming] Chunk: ${chunk.type}`);
            }
            
            // Process different chunk types
            if (chunk.type === 'response.created' || chunk.type === 'response.in_progress') {
                // Initial response object - capture ID
                if (chunk.response?.id) {
                    responseId = chunk.response.id;
                }
            } else if (chunk.type === 'response.output_item.done' && chunk.item) {
                // Complete reasoning output item - capture encrypted content for later saving
                if (chunk.item.type === 'reasoning' && chunk.item.encrypted_content) {
                    // Store for database save, but don't save yet
                    lastChunk = chunk;
                }
            } else if (chunk.type === 'response.output_text.delta') {
                // Text delta chunks - feed to clarinet parser for live event streaming to client
                const content = chunk.delta || '';
                if (content) {
                    fullResponse += content;
                    jsonParser.write(content);
                }
                
                // Capture response ID from chunk.item_id
                if (!responseId && chunk.item_id) {
                    // Extract base response ID from item_id format: "msg_{response_id}"
                    responseId = chunk.item_id.replace(/^msg_/, '');
                }
            } else if (chunk.type === 'response.completed') {
                // Final completed response - use this for database saving
                if (chunk.response) {
                    completionObject = chunk.response;
                    responseId = chunk.response.id;
                }
            }
        }
        
        // Signal end of stream
        jsonParser.end();

        // Log streaming completion info only in verbose mode
        if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
            this.globalResources.getLogger().detailed(`[Responses Streaming] Full response length: ${fullResponse.length}, Response ID: ${responseId}`);
        }

        // Extract reasoning content from output array if available (Responses API format)
        // Reasoning items are in completionObject.output with type: 'reasoning'
        let reasoningContent = null;
        if (completionObject?.output) {
            for (const outputItem of completionObject.output) {
                if (outputItem.type === 'reasoning' && outputItem.encrypted_content) {
                    reasoningContent = outputItem.encrypted_content;
                    break;
                }
            }
        }
        
        // DEBUG: Log encrypted thinking
        console.log('🔍 [Responses Streaming] Encrypted thinking:', reasoningContent ? 'Present' : 'Not present');

        // Update chat object with stored response ID
        chat.lastResponseId = responseId;
        
        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: fullResponse,
            responseId: responseId
        });

        // Update the chat object
        chat.messages = messages;

        // Parse and validate response using Zod schema
        if (chat.chatId && completionObject) {
            let validated = null;
            
            try {
                // Extract events from completionObject.output[].content[].text
                // The events are in the message output's text field
                let eventsText = null;
                if (completionObject.output) {
                    for (const outputItem of completionObject.output) {
                        if (outputItem.type === 'message' && outputItem.content) {
                            for (const contentPart of outputItem.content) {
                                if (contentPart.type === 'output_text' && contentPart.text) {
                                    eventsText = contentPart.text;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                if (!eventsText) {
                    throw new Error('No events found in completion output');
                }
                
                // Parse and validate with Zod schema
                const rawParsed = JSON.parse(eventsText);
                const responseData = Array.isArray(rawParsed) ? { events: rawParsed } : rawParsed;
                validated = ChatResponseSchema.parse(responseData);
                
                // DEBUG: Log event breakdown
                console.log('📊 [Responses Streaming] Event Breakdown:');
                console.log(`   Total events received: ${validated.events.length}`);
                const eventTypes = validated.events.map(e => e.type);
                const eventTypeCounts = {};
                eventTypes.forEach(type => {
                    eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
                });
                console.log('   Event types:', eventTypeCounts);
                
                // Expected event types for persona establishment
                const expectedTypes = ['myname', 'location', 'timeofday', 'environment', 'sensory', 'emotion', 'actions', 'innerspeech', 'speech', 'speechdirect', 'memory'];
                const missingTypes = expectedTypes.filter(type => !eventTypes.includes(type));
                if (missingTypes.length > 0) {
                    console.log('   ⚠️  Missing event types:', missingTypes);
                } else {
                    console.log('   ✅ All expected event types present');
                }
                
            } catch (parseError) {
                console.error('❌ Failed to parse/validate streaming response:', parseError.message);
                console.error('❌ Completion object:', JSON.stringify(completionObject, null, 2));
                throw new Error('Invalid response format from SI');
            }
            
            // Store conversation data for context
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                lastResponseId: responseId,
                lastUpdated: Date.now()
            });
            
            // Store response.output for 30+ day reconstruction
            const responseOutput = completionObject?.output ? JSON.stringify(completionObject.output) : null;
            
            // DEBUG: Log response output
            console.log('🔍 [Responses Streaming] Response output:', responseOutput);
            
            // Ensure all events have unique sequential timestamps
            ensureUniqueTimestamps(validated.events);
            
            // Store each event as a separate message
            for (const event of validated.events) {
                // Build event metadata
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                await this.globalResources.getChatDatabase().addChatMessage(
                    chat.chatId, 
                    'assistant', 
                    event.content, 
                    null,
                    responseId, 
                    conversationData, 
                    null, 
                    event.type,
                    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    reasoningContent,
                    responseOutput
                );
            }
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = this.globalResources.getMemoryManager().extractMemoriesFromResponse(fullResponse);
            for (const memory of memories) {
                await this.globalResources.getMemoryManager().addCharacterMemory(chat.chatId, memory);
            }
            
            // Update conversation summary
            const summary = this.globalResources.getMemoryManager().generateConversationSummary(messages);
            this.globalResources.getMemoryManager().updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completionObject?.usage) {
                const totalTokens = completionObject.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completionObject.usage)
                };
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses Streaming] Token usage: ${totalTokens} total tokens`);
            }
        }

        // Return response with usage data (convert to simplified format)
        let simplifiedUsage = null;
        if (completionObject?.usage) {
            const usageData = completionObject.usage;
            const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
            const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
            simplifiedUsage = {
                total: usageData.total_tokens || 0,
                input: usageData.prompt_tokens || usageData.input_tokens || 0,
                output: usageData.completion_tokens || usageData.output_tokens || 0,
                cache: promptDetails?.cached_tokens || 0,
                reasoning: completionDetails?.reasoning_tokens || 0
            };
        }
        
        return {
            content: fullResponse,
            usage: simplifiedUsage
        };
    } catch (error) {
        console.error("Error establishing persona with streaming:", error);
        throw new Error("The SI could not establish the persona. Please check the console for details.");
    }
}

    async continueConversationStreaming(chat, message, onStreamUpdate) {
    try {
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const conversationData = await this.globalResources.getChatDatabase().getConversationData(chat.chatId);
            if (conversationData && conversationData.response_id) {
                previousResponseId = conversationData.response_id;
                lastMessageCreatedAt = conversationData.created_at;
                responseOutput = conversationData.response_output ? JSON.parse(conversationData.response_output) : null;
            }
        }
        
        // Check if message is older than 30 days
        const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
        const currentTime = Math.floor(Date.now() / 1000);
        const isMessageOld = lastMessageCreatedAt && (currentTime - lastMessageCreatedAt > thirtyDaysInSeconds);
        
        // Build input array - use response.output if message is old for 30+ day reconstruction
        let messages = [];
        if (isMessageOld && responseOutput && Array.isArray(responseOutput)) {
            // Message is older than 30 days - use response.output to include encrypted reasoning
            messages = [...responseOutput];
            console.log(`📦 Using response.output (${responseOutput.length} items) for encrypted reasoning context - message is older than 30 days`);
        } else if (previousResponseId) {
            // Use previous_response_id if message is fresh (within 30 days)
            console.log(`🔄 Using Responses API with previous_response_id: ${previousResponseId}`);
        } else {
            // Fall back to messages array approach
            messages = [...chat.messages];
        }
        
        // Add user message
        messages.push({
            role: "user",
            content: message
        });

        // Configure API call based on model - using Responses API format
        const apiConfig = {
            model: chat.model || this.getDefaultGrokModel(),
            input: messages,
            max_completion_tokens: 8000,
            response_format: zodResponseFormat(GrokService.ChatResponseSchema, "response"),
            stream: true,
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id (streaming): ${previousResponseId}`);
        }

        const completion = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));

        let fullResponse = '';
        let responseId = null;
        
        // Use clarinet to extract complete events as they stream in
        const jsonParser = clarinet.createStream();
        const path = [];
        let currentEvent = null;
        let extractedEvents = [];
        let inArray = false;
        let objectDepth = 0;
        
        jsonParser.on('openarray', () => {
            inArray = true;
        });
        
        jsonParser.on('openobject', (key) => {
            objectDepth++;
            if (key !== undefined) {
                path.push(key);
            }
            // Start of a new event object (when we're in an array and at root level)
            if (inArray && objectDepth === 1) {
                currentEvent = { type: null, content: null, timestamp: null };
            }
        });
        
        jsonParser.on('key', (key) => {
            if (!isNaN(key)) {
                path.push(`[${key}]`);
            } else {
                path.push(key);
            }
        });
        
        jsonParser.on('value', (value) => {
            if (currentEvent && objectDepth === 1) {
                // Only extract from root-level keys of event objects
                const key = path[path.length - 1];
                if (key === 'type') {
                    currentEvent.type = value;
                } else if (key === 'content') {
                    currentEvent.content = value;
                } else if (key === 'timestamp') {
                    currentEvent.timestamp = value;
                } else if (key === 'weight') {
                    currentEvent.weight = value;
                } else if (key === 'intensity') {
                    currentEvent.intensity = value;
                }
            }
            path.pop();
        });
        
        jsonParser.on('closeobject', () => {
            objectDepth--;
            if (currentEvent && currentEvent.type && currentEvent.content !== null) {
                // Complete event extracted - send it to client
                extractedEvents.push({ ...currentEvent });
                if (onStreamUpdate) {
                    onStreamUpdate(null, fullResponse, [currentEvent]);
                }
            }
            currentEvent = null;
            if (path.length > 0) path.pop();
        });
        
        jsonParser.on('closearray', () => {
            inArray = false;
            if (path.length > 0) path.pop();
        });
        
        jsonParser.on('error', (error) => {
            // Silently handle incomplete JSON during streaming
        });
        
        let lastChunk = null;
        let completionObject = null;
        for await (const chunk of completion) {
            // Process different chunk types
            if (chunk.type === 'response.created' || chunk.type === 'response.in_progress') {
                // Initial response object - capture ID
                if (chunk.response?.id) {
                    responseId = chunk.response.id;
                    console.log('🔍 [Responses API Streaming continue] Response ID:', responseId);
                }
            } else if (chunk.type === 'response.output_item.done' && chunk.item) {
                // Complete reasoning output item - capture encrypted content for later saving
                if (chunk.item.type === 'reasoning' && chunk.item.encrypted_content) {
                    lastChunk = chunk;
                }
            } else if (chunk.type === 'response.output_text.delta') {
                // Text delta chunks - feed to clarinet parser for live event streaming to client
                const content = chunk.delta || '';
                if (content) {
                    fullResponse += content;
                    jsonParser.write(content);
                }
                
                // Capture response ID from chunk.item_id
                if (!responseId && chunk.item_id) {
                    responseId = chunk.item_id.replace(/^msg_/, '');
                }
            } else if (chunk.type === 'response.completed') {
                // Final completed response - use this for database saving
                if (chunk.response) {
                    completionObject = chunk.response;
                    responseId = chunk.response.id;
                }
            }
        }
        
        // Signal end of stream
        jsonParser.end();

        // Extract reasoning content from output array if available (Responses API format)
        // Reasoning items are in completionObject.output with type: 'reasoning'
        let reasoningContent = null;
        if (completionObject?.output) {
            for (const outputItem of completionObject.output) {
                if (outputItem.type === 'reasoning' && outputItem.encrypted_content) {
                    reasoningContent = outputItem.encrypted_content;
                    break;
                }
            }
        }

        // DEBUG: Log streaming completion info
        console.log('🔍 [Responses API Streaming continue] Full response length:', fullResponse.length);
        console.log('🔍 [Responses API Streaming continue] Completion object:', completionObject ? 'Present' : 'null');
        console.log('🔍 [Responses API Streaming continue] Encrypted thinking:', reasoningContent ? 'Present' : 'Not present');

        // Update chat object with new response ID
        chat.lastResponseId = responseId;
        
        // Add the response to chat history (only if not using Responses API)
        if (!previousResponseId || messages.length > 1) {
            messages.push({
                role: "assistant",
                content: fullResponse,
                responseId: responseId
            });
            chat.messages = messages;
        } else {
            // When using Responses API, we only track the latest response
            chat.messages = [...chat.messages, {
                role: "user",
                content: message
            }, {
                role: "assistant",
                content: fullResponse,
                responseId: responseId
            }];
        }

        // Store conversation data and response ID in database
        if (chat.chatId && completionObject) {
            let validated = null;
            
            try {
                // Extract events from completionObject.output[].content[].text
                let eventsText = null;
                if (completionObject.output) {
                    for (const outputItem of completionObject.output) {
                        if (outputItem.type === 'message' && outputItem.content) {
                            for (const contentPart of outputItem.content) {
                                if (contentPart.type === 'output_text' && contentPart.text) {
                                    eventsText = contentPart.text;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                if (!eventsText) {
                    throw new Error('No events found in completion output');
                }
                
                // Parse and validate with Zod schema
                const rawParsed = JSON.parse(eventsText);
                const responseData = Array.isArray(rawParsed) ? { events: rawParsed } : rawParsed;
                validated = ChatResponseSchema.parse(responseData);
                
                // DEBUG: Log event breakdown
                console.log('📊 [Responses API Streaming continue] Event Breakdown:');
                console.log(`   Total events received: ${validated.events.length}`);
                const eventTypes = validated.events.map(e => e.type);
                const eventTypeCounts = {};
                eventTypes.forEach(type => {
                    eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
                });
                console.log('   Event types:', eventTypeCounts);
                
            } catch (parseError) {
                console.error('❌ Failed to parse/validate streaming response:', parseError.message);
                console.error('❌ Completion object:', JSON.stringify(completionObject, null, 2));
                throw new Error('Invalid response format from SI');
            }
            
            // Store conversation data for context
            const conversationData = JSON.stringify({
                model: chat.model,
                lastResponseId: responseId,
                lastUpdated: Date.now()
            });
            
            // Store response.output for 30+ day reconstruction (from completion object)
            const responseOutput = completionObject?.output ? JSON.stringify(completionObject.output) : null;
            
            // Ensure all events have unique sequential timestamps
            ensureUniqueTimestamps(validated.events);
            
            // Store each event as a separate message
            for (const event of validated.events) {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                await this.globalResources.getChatDatabase().addChatMessage(
                    chat.chatId, 
                    'assistant', 
                    event.content, 
                    null,
                    responseId, 
                    conversationData, 
                    previousResponseId, 
                    event.type,
                    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    reasoningContent,
                    responseOutput
                );
            }
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = this.globalResources.getMemoryManager().extractMemoriesFromResponse(fullResponse);
            for (const memory of memories) {
                await this.globalResources.getMemoryManager().addCharacterMemory(chat.chatId, memory);
            }
            
            // Update conversation summary (use chat.messages for context)
            const summary = this.globalResources.getMemoryManager().generateConversationSummary(chat.messages);
            this.globalResources.getMemoryManager().updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completionObject?.usage) {
                const totalTokens = completionObject.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completionObject.usage)
                };
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API Streaming continue] Token usage: ${totalTokens} total tokens`);
            }
        }

        // Return response with usage data (convert to simplified format)
        let simplifiedUsage = null;
        if (completionObject?.usage) {
            const usageData = completionObject.usage;
            const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
            const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
            simplifiedUsage = {
                total: usageData.total_tokens || 0,
                input: usageData.prompt_tokens || usageData.input_tokens || 0,
                output: usageData.completion_tokens || usageData.output_tokens || 0,
                cache: promptDetails?.cached_tokens || 0,
                reasoning: completionDetails?.reasoning_tokens || 0
            };
        }
        
        return {
            content: fullResponse,
            usage: simplifiedUsage
        };
    } catch (error) {
        console.error("Error continuing conversation with streaming:", error);
        throw new Error("The SI could not generate a response. Please check the console for details.");
    }
}

// New streaming function that expects complete conversation context (no separate message parameter)
    async continueConversationWithContextStreaming(chat, onStreamUpdate) {
    try {
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const conversationData = await this.globalResources.getChatDatabase().getConversationData(chat.chatId);
            if (conversationData && conversationData.response_id) {
                previousResponseId = conversationData.response_id;
                lastMessageCreatedAt = conversationData.created_at;
                responseOutput = conversationData.response_output ? JSON.parse(conversationData.response_output) : null;
            }
        }
        
        // Check if message is older than 30 days
        const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
        const currentTime = Math.floor(Date.now() / 1000);
        const isMessageOld = lastMessageCreatedAt && (currentTime - lastMessageCreatedAt > thirtyDaysInSeconds);
        
        // Build input array - use response.output if message is old for 30+ day reconstruction
        let inputMessages = [];
        if (isMessageOld && responseOutput && Array.isArray(responseOutput)) {
            // Message is older than 30 days - use response.output to include encrypted reasoning
            inputMessages = [...responseOutput];
            console.log(`📦 Using response.output (${responseOutput.length} items) for encrypted reasoning context - message is older than 30 days`);
        } else if (previousResponseId) {
            // Use previous_response_id if message is fresh (within 30 days)
            console.log(`🔄 Using Responses API with previous_response_id: ${previousResponseId}`);
        } else {
            // Fall back to messages array approach
            inputMessages = [...chat.messages];
        }

        // Configure API call based on model - using Responses API format
        const apiConfig = {
            model: chat.model || this.getDefaultGrokModel(),
            input: inputMessages,
            max_completion_tokens: 10000,
            timeout: 120000,
            response_format: zodResponseFormat(GrokService.ChatResponseSchema, "response"),
            stream: true,
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id (context streaming): ${previousResponseId}`);
        }

        const completion = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));

        let fullResponse = '';
        let responseId = null;
        
        // Use clarinet to extract complete events as they stream in
        const jsonParser = clarinet.createStream();
        const path = [];
        let currentEvent = null;
        let extractedEvents = [];
        let inArray = false;
        let objectDepth = 0;
        
        jsonParser.on('openarray', () => {
            inArray = true;
        });
        
        jsonParser.on('openobject', (key) => {
            objectDepth++;
            if (key !== undefined) {
                path.push(key);
            }
            // Start of a new event object (when we're in an array and at root level)
            if (inArray && objectDepth === 1) {
                currentEvent = { type: null, content: null, timestamp: null };
            }
        });
        
        jsonParser.on('key', (key) => {
            if (!isNaN(key)) {
                path.push(`[${key}]`);
            } else {
                path.push(key);
            }
        });
        
        jsonParser.on('value', (value) => {
            if (currentEvent && objectDepth === 1) {
                // Only extract from root-level keys of event objects
                const key = path[path.length - 1];
                if (key === 'type') {
                    currentEvent.type = value;
                } else if (key === 'content') {
                    currentEvent.content = value;
                } else if (key === 'timestamp') {
                    currentEvent.timestamp = value;
                } else if (key === 'weight') {
                    currentEvent.weight = value;
                } else if (key === 'intensity') {
                    currentEvent.intensity = value;
                }
            }
            path.pop();
        });
        
        jsonParser.on('closeobject', () => {
            objectDepth--;
            if (currentEvent && currentEvent.type && currentEvent.content !== null) {
                // Complete event extracted - send it to client
                extractedEvents.push({ ...currentEvent });
                if (onStreamUpdate) {
                    onStreamUpdate(null, fullResponse, [currentEvent]);
                }
            }
            currentEvent = null;
            if (path.length > 0) path.pop();
        });
        
        jsonParser.on('closearray', () => {
            inArray = false;
            if (path.length > 0) path.pop();
        });
        
        jsonParser.on('error', (error) => {
            // Silently handle incomplete JSON during streaming
        });
        
        let lastChunk = null;
        let completionObject = null;
        for await (const chunk of completion) {
            // Process different chunk types
            if (chunk.type === 'response.created' || chunk.type === 'response.in_progress') {
                // Initial response object - capture ID
                if (chunk.response?.id) {
                    responseId = chunk.response.id;
                }
            } else if (chunk.type === 'response.output_item.done' && chunk.item) {
                // Complete reasoning output item - capture encrypted content for later saving
                if (chunk.item.type === 'reasoning' && chunk.item.encrypted_content) {
                    lastChunk = chunk;
                }
            } else if (chunk.type === 'response.output_text.delta') {
                // Text delta chunks - feed to clarinet parser for live event streaming to client
                const content = chunk.delta || '';
                if (content) {
                    fullResponse += content;
                    jsonParser.write(content);
                }
                
                // Capture response ID from chunk.item_id
                if (!responseId && chunk.item_id) {
                    responseId = chunk.item_id.replace(/^msg_/, '');
                }
            } else if (chunk.type === 'response.completed') {
                // Final completed response - use this for database saving
                if (chunk.response) {
                    completionObject = chunk.response;
                    responseId = chunk.response.id;
                }
            }
        }
        
        // Signal end of stream
        jsonParser.end();

        // Extract reasoning content from output array if available (Responses API format)
        // Reasoning items are in completionObject.output with type: 'reasoning'
        let reasoningContent = null;
        if (completionObject?.output) {
            for (const outputItem of completionObject.output) {
                if (outputItem.type === 'reasoning' && outputItem.encrypted_content) {
                    reasoningContent = outputItem.encrypted_content;
                    break;
                }
            }
        }

        // DEBUG: Log streaming completion info
        console.log('🔍 [Responses API Streaming context] Full response length:', fullResponse.length);
        console.log('🔍 [Responses API Streaming context] Response ID:', responseId);
        console.log('🔍 [Responses API Streaming context] Completion object:', completionObject ? 'Present' : 'null');
        console.log('🔍 [Responses API Streaming context] Encrypted thinking:', reasoningContent ? 'Present' : 'Not present');

        // Update chat object with new response ID
        chat.lastResponseId = responseId;

        // Add the response to chat history (only if not using Responses API)
        if (!previousResponseId || messages.length > 1) {
            const allMessages = previousResponseId ? [...chat.messages] : messages;
            allMessages.push({
                role: "assistant",
                content: fullResponse,
                responseId: responseId
            });
            chat.messages = allMessages;
        } else {
            // When using Responses API, we only track the latest response
            chat.messages = [...chat.messages, {
                role: "assistant",
                content: fullResponse,
                responseId: responseId
            }];
        }

        // Store conversation data and response ID in database
        if (chat.chatId && completionObject) {
            let validated = null;
            
            try {
                // Extract events from completionObject.output[].content[].text
                let eventsText = null;
                if (completionObject.output) {
                    for (const outputItem of completionObject.output) {
                        if (outputItem.type === 'message' && outputItem.content) {
                            for (const contentPart of outputItem.content) {
                                if (contentPart.type === 'output_text' && contentPart.text) {
                                    eventsText = contentPart.text;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                if (!eventsText) {
                    throw new Error('No events found in completion output');
                }
                
                // Parse and validate with Zod schema
                const rawParsed = JSON.parse(eventsText);
                const responseData = Array.isArray(rawParsed) ? { events: rawParsed } : rawParsed;
                validated = ChatResponseSchema.parse(responseData);
                
                // DEBUG: Log event breakdown
                console.log('📊 [Responses API Streaming context] Event Breakdown:');
                console.log(`   Total events received: ${validated.events.length}`);
                const eventTypes = validated.events.map(e => e.type);
                const eventTypeCounts = {};
                eventTypes.forEach(type => {
                    eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
                });
                console.log('   Event types:', eventTypeCounts);
                
            } catch (parseError) {
                console.error('❌ Failed to parse/validate streaming response:', parseError.message);
                console.error('❌ Completion object:', JSON.stringify(completionObject, null, 2));
                throw new Error('Invalid response format from SI');
            }
            
            // Store conversation data for context
            const conversationData = JSON.stringify({
                model: chat.model,
                lastResponseId: responseId,
                lastUpdated: Date.now()
            });
            
            // Store response.output for 30+ day reconstruction (from completion object)
            const responseOutput = completionObject?.output ? JSON.stringify(completionObject.output) : null;
            
            // Ensure all events have unique sequential timestamps
            ensureUniqueTimestamps(validated.events);
            
            // Store each event as a separate message
            for (const event of validated.events) {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                await this.globalResources.getChatDatabase().addChatMessage(
                    chat.chatId, 
                    'assistant', 
                    event.content, 
                    null,
                    responseId, 
                    conversationData, 
                    previousResponseId, 
                    event.type,
                    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    reasoningContent,
                    responseOutput
                );
            }
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }

            // Extract and store memories
            const memories = this.globalResources.getMemoryManager().extractMemoriesFromResponse(fullResponse);
            for (const memory of memories) {
                await this.globalResources.getMemoryManager().addCharacterMemory(chat.chatId, memory);
            }

            // Update conversation summary (use chat.messages for context)
            const summary = this.globalResources.getMemoryManager().generateConversationSummary(chat.messages);
            this.globalResources.getMemoryManager().updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completionObject?.usage) {
                const totalTokens = completionObject.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completionObject.usage)
                };
                await this.globalResources.getChatDatabase().updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API Streaming context] Token usage: ${totalTokens} total tokens`);
            }
        }

        // Return response with usage data (convert to simplified format)
        let simplifiedUsage = null;
        if (completionObject?.usage) {
            const usageData = completionObject.usage;
            const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
            const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
            simplifiedUsage = {
                total: usageData.total_tokens || 0,
                input: usageData.prompt_tokens || usageData.input_tokens || 0,
                output: usageData.completion_tokens || usageData.output_tokens || 0,
                cache: promptDetails?.cached_tokens || 0,
                reasoning: completionDetails?.reasoning_tokens || 0
            };
        }
        
        return {
            content: fullResponse,
            usage: simplifiedUsage
        };
    } catch (error) {
        console.error("Error continuing conversation with context streaming:", error);
        throw new Error("The SI could not generate a response. Please check the console for details.");
    }
}

    accumulateUsageTotals(usageData, currentTotals = null) {
    if (!usageData) {
        return currentTotals;
    }
    
    const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
    const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
    
    if (!currentTotals) {
        currentTotals = {
            total: 0,
            input: 0,
            output: 0,
            cache: 0,
            reasoning: 0
        };
    }
    
    currentTotals.total += usageData.total_tokens || 0;
    currentTotals.input += usageData.prompt_tokens || usageData.input_tokens || 0;
    currentTotals.output += usageData.completion_tokens || usageData.output_tokens || 0;
    currentTotals.cache += promptDetails?.cached_tokens || 0;
    currentTotals.reasoning += completionDetails?.reasoning_tokens || 0;
    
    return currentTotals;
}

    // Dynagen tool handlers removed (#347). Other callers still use structured output.
    async executeTool() {
        throw new Error('Grok dynagen tool loop was removed (#347)');
    }

/**
 * Parses XML-wrapped function calls and converts them to standard tool call format
 * @param {string} text - Text content that may contain XML-wrapped function calls
 * @returns {Array} - Array of tool call objects in standard format, or empty array if none found
 */
    parseXmlWrappedFunctionCalls(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    const toolCalls = [];
    
    // Find all XML-wrapped function calls in the text
    const functionCallPattern = /<xai:function_call[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/xai:function_call>|$)/gi;
    let match;
    let callIndex = 0;
    
    while ((match = functionCallPattern.exec(text)) !== null) {
        const functionName = match[1];
        const content = match[2].trim();
        
        // Extract parameters from the content
        const parameterPattern = /<parameter[^>]*name\s*=\s*(["']?)(\w+)\1[^>]*>([\s\S]*?)(?:<\/parameter>|$)/gi;
        const parameters = {};
        let paramMatch;
        
        while ((paramMatch = parameterPattern.exec(content)) !== null) {
            const paramName = paramMatch[2];
            let paramValue = paramMatch[3].trim();
            
            // Try to parse as JSON, otherwise keep as string
            try {
                parameters[paramName] = JSON.parse(paramValue);
            } catch (e) {
                parameters[paramName] = paramValue;
            }
        }
        
        // If no parameters found, try to parse the entire content as JSON
        if (Object.keys(parameters).length === 0 && content) {
            try {
                const parsed = JSON.parse(content);
                // If it's an object, use it as the arguments
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    Object.assign(parameters, parsed);
                } else if (Array.isArray(parsed)) {
                    // If it's an array, it might be a single parameter (like tags array)
                    // Check if there's a common parameter name for arrays
                    parameters.tags = parsed; // Common case for searchTagsBatch
                }
            } catch (e) {
                // Not JSON, ignore
            }
        }
        
        // Convert to standard tool call format
        const toolCall = {
            id: `call_${Date.now()}_${callIndex++}`,
            type: 'function',
            function: {
                name: functionName,
                arguments: JSON.stringify(parameters)
            }
        };
        
        toolCalls.push(toolCall);
    }
    
    return toolCalls;
}

/**
 * Extracts JSON content from xAI function call wrapper XML format
 * 
 * Expected formats from xAI API:
 * 1. <xai:function_call name="functionName">...</xai:function_call>
 * 2. <xai:function_call name="functionName"><parameter name="paramName">JSON content</parameter></xai:function_call>
 * 3. <xai:function_call name="functionName"><parameter name="param1">text</parameter><parameter name="param2">JSON</parameter></xai:function_call>
 * 4. Truncated responses (missing closing tags)
 * 5. Multiple parameters with JSON split across them
 * 6. Direct JSON content without parameter tags
 * 
 * Common function names seen:
 * - completeTooling (with "reason" parameter)
 * - Other tool functions with various parameter names
 * 
 * @param {string} response - The raw response string
 * @returns {Object|null} - Parsed JSON object or null if extraction fails
 */
    extractJsonFromXaiFunctionCall(response) {
    if (!response || typeof response !== 'string') {
        return null;
    }

    const trimmed = response.trim();
    
    // Check if it's an xAI function call wrapper (case-insensitive check)
    if (!trimmed.match(/^<xai:function_call/i)) {
        return null;
    }

    try {
        // Extract function name for logging
        const functionNameMatch = trimmed.match(/<xai:function_call[^>]*name=["']([^"']+)["']/i);
        const functionName = functionNameMatch ? functionNameMatch[1] : 'unknown';
        console.warn(`🔧 Extracting JSON from xAI function call: "${functionName}"`);
        
        // First, try to extract content between function call tags (with or without closing tag)
        // Handle both self-closing and regular tags, with or without closing tag
        let functionCallMatch = trimmed.match(/<xai:function_call[^>]*>([\s\S]*?)(?:<\/xai:function_call>|$)/i);
        
        if (!functionCallMatch || !functionCallMatch[1]) {
            // Try to extract everything after the opening tag if no closing tag found
            const openTagMatch = trimmed.match(/<xai:function_call[^>]*>([\s\S]*)/i);
            if (!openTagMatch || !openTagMatch[1]) {
                console.warn(`❌ Could not extract content from xAI function call wrapper`);
                return null;
            }
            functionCallMatch = openTagMatch;
        }

        let extractedContent = functionCallMatch[1].trim();
        
        // Handle CDATA sections if present
        if (extractedContent.includes('<![CDATA[')) {
            const cdataMatch = extractedContent.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
            if (cdataMatch && cdataMatch[1]) {
                extractedContent = cdataMatch[1].trim();
            }
        }
        
        // Try to find JSON in parameter tags
        // Handle various quote styles: name="value", name='value', name=value
        // Handle self-closing and regular parameter tags
        const parameterPattern = /<parameter[^>]*name\s*=\s*(["']?)(\w+)\1[^>]*>([\s\S]*?)(?:<\/parameter>|$)/gi;
        const parameterMatches = extractedContent.matchAll(parameterPattern);
        const parameters = Array.from(parameterMatches);
        
        if (parameters.length > 0) {
            console.warn(`📋 Found ${parameters.length} parameter(s) in xAI function call wrapper`);
            
            // Strategy 1: Try each parameter individually for valid JSON
            for (const paramMatch of parameters) {
                const paramName = paramMatch[2]; // Group 2 is the parameter name
                let paramContent = paramMatch[3].trim(); // Group 3 is the content
                
                // Handle XML entities if present
                paramContent = paramContent
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'");
                
                // Try to parse as JSON
                try {
                    const parsed = JSON.parse(paramContent);
                    console.warn(`✅ Extracted JSON from parameter "${paramName}" in xAI function call "${functionName}"`);
                    return parsed;
                } catch (e) {
                    // Not JSON, try next parameter
                    continue;
                }
            }
            
            // Strategy 2: Try concatenating all parameter contents (in case JSON is split)
            const allParamContent = parameters.map(p => {
                let content = p[3].trim();
                // Handle XML entities
                return content
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'");
            }).join('').trim();
            
            if (allParamContent) {
                try {
                    const parsed = JSON.parse(allParamContent);
                    console.warn(`✅ Extracted JSON from concatenated parameters in xAI function call "${functionName}"`);
                    return parsed;
                } catch (e) {
                    // Not valid JSON when concatenated
                }
            }
            
            // Strategy 3: Look for JSON object boundaries within parameter contents
            for (const paramMatch of parameters) {
                let paramContent = paramMatch[3].trim();
                // Handle XML entities
                paramContent = paramContent
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'");
                
                // Try to find JSON object boundaries
                const jsonStart = paramContent.indexOf('{');
                const jsonEnd = paramContent.lastIndexOf('}');
                
                if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                    const jsonCandidate = paramContent.substring(jsonStart, jsonEnd + 1);
                    try {
                        const parsed = JSON.parse(jsonCandidate);
                        console.warn(`✅ Extracted JSON from parameter content boundaries in xAI function call "${functionName}"`);
                        return parsed;
                    } catch (e) {
                        // Not valid JSON
                    }
                }
            }
        }
        
        // Strategy 4: If no parameters or parameters didn't contain JSON, try the direct content
        // Remove any remaining XML tags but preserve content
        let cleanContent = extractedContent
            .replace(/<parameter[^>]*>/gi, '') // Remove opening parameter tags
            .replace(/<\/parameter>/gi, '') // Remove closing parameter tags
            .replace(/<[^>]+>/g, '') // Remove any other XML tags
            .trim();
        
        // Handle XML entities in cleaned content
        cleanContent = cleanContent
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
        
        // Try to find JSON object boundaries
        const jsonStart = cleanContent.indexOf('{');
        const jsonEnd = cleanContent.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            const jsonCandidate = cleanContent.substring(jsonStart, jsonEnd + 1);
            try {
                const parsed = JSON.parse(jsonCandidate);
                console.warn(`✅ Extracted JSON from function call wrapper content boundaries in "${functionName}"`);
                return parsed;
            } catch (e) {
                // Not valid JSON
            }
        }
        
        // Strategy 5: Try parsing the entire extracted content (handle XML entities first)
        let processedContent = extractedContent
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
        
        try {
            const parsed = JSON.parse(processedContent);
            console.warn(`✅ Extracted JSON from entire function call wrapper content in "${functionName}"`);
            return parsed;
        } catch (e) {
            // Final fallback: try parsing cleaned content
            try {
                const parsed = JSON.parse(cleanContent);
                console.warn(`✅ Extracted JSON from cleaned function call wrapper content in "${functionName}"`);
                return parsed;
            } catch (e2) {
                console.warn(`❌ Could not extract valid JSON from xAI function call wrapper "${functionName}"`);
                console.warn(`   Content preview: ${extractedContent.substring(0, 200)}${extractedContent.length > 200 ? '...' : ''}`);
                return null;
            }
        }
    } catch (error) {
        console.warn(`❌ Error extracting JSON from xAI function call wrapper:`, error.message);
        return null;
    }
}

// Modified callDirectorAIWithStructuredOutput with tool calling loop
    async callDirectorAIWithStructuredOutput(messages, options = {}, onStreamUpdate = null) {
    try {
        let maxLoops = options?.toolLoops || 5; // Prevent infinite loops
        const initialMaxLoops = maxLoops; // Track initial value to determine first iteration
        let toolingComplete = false; // Track if completeTooling was called
        let useTools = options?.tools && options.tools.length > 0; // Track whether to use tools
        let lastResponseId = null; // Track the last response ID for stateful continuation
        let nextIterationMessages = toResponsesApiMessages(messages); // Chat Completions image_url/text → Responses input_image/input_text
        let totalUsageData = null; // Track cumulative usage across all API calls
        let apiCallIndex = 0; // Track index for mailstack ordering
        let publishedAnalysis = null; // Track analysis from publishAnalysisResults tool (function-level scope)
        let apiCalls = []; // Track local api calls for loop-level operations
        
        // Create mailbox for apiCalls at start (will accumulate all calls, including initial system message)
        const apiCallsMailboxId = options._attemptId ? `${options._attemptId}:apiCalls` : null;
        if (apiCallsMailboxId) {
            this.globalResources.getDataPlumbing().createMailbox(apiCallsMailboxId, {
                removeAfterRead: false, // Keep all attempts - they cost money
                category: 'tool_results',
                tags: ['api_calls']
            });
        }
        let replacementPlan = null; // Track plan from planTextReplacements tool (function-level scope)
        let phaseStatus = {
            analysis: false,    // Phase 1: publishAnalysisResults
            planning: false,    // Phase 2: planTextReplacements
            execution: false,   // Phase 3: validateTextReplacement, text_replacements
            validation: false   // Phase 4: completeTooling
        };

        // Helper function to get requestId from Kaze or options
        const getRequestId = () => {
            if (options.requestId) return options.requestId;
            if (options._attemptId) {
                const buildOptions = this.globalResources.getDataPlumbing().get(`${options._attemptId}:buildOptions`);
                if (buildOptions?._requestId) return buildOptions._requestId;
            }
            return 'unknown';
        };
        
        // Helper function to get buildOptions from Kaze for hydration
        const getBuildOptions = () => {
            if (options._attemptId) {
                return this.globalResources.getDataPlumbing().get(`${options._attemptId}:buildOptions`);
            }
            return null;
        };
        
        // Helper function to send data back via Kaze mailboxes (instead of returning in response object)
        const sendDataViaMailboxes = (data) => {
            const attemptId = options._attemptId;
            if (!attemptId) {
                console.warn('⚠️ sendDataViaMailboxes: No attemptId provided, skipping mailbox sending');
                return; // No attemptId, skip mailbox sending
            }
            
            if (data.publishedAnalysis !== undefined) {
                this.globalResources.getDataPlumbing().createLetter(data.publishedAnalysis, `${attemptId}:publishedAnalysis`, {
                    category: 'tool_results',
                    tags: ['workflow', 'analysis'],
                    removeAfterRead: true
                });
            }
            if (data.replacementPlan !== undefined) {
                this.globalResources.getDataPlumbing().createLetter(data.replacementPlan, `${attemptId}:replacementPlan`, {
                    category: 'tool_results',
                    tags: ['workflow', 'planning'],
                    removeAfterRead: true
                });
            }
            if (data.usage !== undefined && data.usage !== null) {
                this.globalResources.getDataPlumbing().createLetter(data.usage, `${attemptId}:usageData`, {
                    category: 'tool_results',
                    tags: ['usage'],
                    removeAfterRead: true
                });
            }
            if (data.responseId !== undefined) {
                this.globalResources.getDataPlumbing().createLetter(data.responseId, `${attemptId}:responseId`, {
                    category: 'tool_results',
                    tags: ['response_id'],
                    removeAfterRead: true
                });
            }
            if (data.chainRejected === true) {
                this.globalResources.getDataPlumbing().createLetter(true, `${attemptId}:chainRejected`, {
                    category: 'tool_results',
                    tags: ['chain_rejected'],
                    removeAfterRead: true
                });
            }
        };

        while (maxLoops > 0) {
            let filteredTools = Array.isArray(options?.tools) ? [...options.tools] : [];
            
            // Determine response format based on responseSchema parameter and tools presence
            let responseFormat = null;
            let textFormat = null;
            const hasTools = useTools && !toolingComplete && filteredTools.length > 0; // Only use tools if tooling not complete
            const isFirstIteration = maxLoops === initialMaxLoops; // Check if this is the first iteration
            
            // Use the messages prepared for this iteration
            const messagesToSend = nextIterationMessages;
            this.globalResources.getLogger().detailed(`📨 Iteration ${initialMaxLoops - maxLoops + 1}: ${messagesToSend.length} message(s)${lastResponseId ? ' | stateful' : ''}`)

            if (options?.responseSchema === null || options?.responseSchema === undefined) {
            // No schema provided - use normal text response
            responseFormat = null;
        } else if (typeof options?.responseSchema === 'string') {
            // String format provided (e.g., "json_object")
            responseFormat = { type: options?.responseSchema };
        } else if (typeof options?.responseSchema === 'object' && options?.responseSchema._def) {
            // Zod schema provided - use structured output
            if (hasTools) {
                // Tools present: DON'T use text.format or response_format
                // Let SI call tools freely without structured output constraints
                responseFormat = null;
                textFormat = null;
                this.globalResources.getLogger().verbose('🔧 Tools active - structured output disabled until tooling complete');
            } else if (toolingComplete) {
                // Tooling complete: NOW use text.format for final structured response
                const zodFormat = zodResponseFormat(options?.responseSchema, "text");
                textFormat = {
                    format: {
                        name: "structured_output",
                        type: "json_schema",
                        strict: true,
                        schema: zodFormat.json_schema.schema
                    }
                };
                responseFormat = null;
                    console.log('🔧 Tooling complete - using text.format for final structured response');
            } else {
                // No tools: Responses API requires text.format (response_format is chat/completions only)
                const zodFormat = zodResponseFormat(options?.responseSchema, "text");
                textFormat = {
                    format: {
                        name: "structured_output",
                        type: "json_schema",
                        strict: true,
                        schema: zodFormat.json_schema.schema
                    }
                };
                responseFormat = null;
            }
        } else {
            // Fallback to normal text if invalid schema type
            console.warn('⚠️ Invalid responseSchema type, falling back to normal text response');
            responseFormat = null;
            }
            
            let apiConfig = {
                model: options?.model || this.getDefaultGrokModel(), 
                input: messagesToSend,
                max_output_tokens: options?.max_completion_tokens !== undefined ? options.max_completion_tokens : options?.max_output_tokens !== undefined ? options.max_output_tokens : 4000,
                temperature: parseFloat((options?.temperature !== undefined ? options.temperature : 0.1).toFixed(2)),
                timeout: options?.timeout !== undefined ? options.timeout : 15000,
                store: options?.store !== undefined ? options.store : true,
                stream: options?.stream !== undefined ? options.stream : this.globalResources.getConfig()?.chat_streaming_enabled || false, // Always use streaming
                parallel_function_calling: true, // Enable parallel function calls by default
                tools: hasTools ? filteredTools : undefined,
                tool_choice: hasTools ? (options?.tool_choice || (isFirstIteration ? "required" : "auto")) : undefined,
                reasoning: { summary: "detailed" }
            };
            
            // Add previous_response_id for stateful conversation
            if (lastResponseId && !isFirstIteration) {
                apiConfig.previous_response_id = lastResponseId;
                this.globalResources.getLogger().verbose(`🔗 Using previous_response_id: ${lastResponseId}`);
            } else if (options?.previous_response_id) {
                // Also support external previous_response_id (for retries)
                apiConfig.previous_response_id = options.previous_response_id;
                this.globalResources.getLogger().verbose(`🔗 Using external previous_response_id: ${options.previous_response_id}`);
            }
            
            // Add response_format or text.format based on tools presence
            if (responseFormat) {
                apiConfig.response_format = responseFormat;
            } else if (textFormat) {
                apiConfig.text = textFormat;
            }

            // Add tokenizer collection if optimize is enabled
            if (options?.enableOptimize && this.globalResources.getSecureConfig({ path: 'grok.tokenizerCollectionId' })) {
                apiConfig.knowledge_base = {
                    collection_ids: [this.globalResources.getSecureConfig({ path: 'grok.tokenizerCollectionId' })]
                };
                this.globalResources.getLogger().detailed('⚡ Token optimization enabled with collection');
            }

            // Summarized console output
            const iteration = initialMaxLoops - maxLoops + 1;
            this.globalResources.getLogger().detailed(`🎯 SI: ${apiConfig.model} | Iter ${iteration}/${initialMaxLoops} | ${apiConfig.input?.length || 0} msgs | ${apiConfig.tools ? apiConfig.tools.length : 0} tools${apiConfig.previous_response_id ? ' | stateful' : ''}`);
            
            // Detailed file logging
            const logRequestId = getRequestId();
            
            // Log messages being sent (system + user messages)
            const totalChars = apiConfig.input.reduce((sum, msg) => {
                if (typeof msg.content === 'string') {
                    return sum + msg.content.length;
                } else if (Array.isArray(msg.content)) {
                    return sum + msg.content.reduce((s, item) => {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            return s + item.text.length;
                        }
                        // Don't count image data in character count
                        return s;
                    }, 0);
                }
                return sum;
            }, 0);
            
            this.globalResources.getLogger().logGeneration('AI_MESSAGES_SENT', {
                model: apiConfig.model,
                iteration: iteration,
                maxLoops: initialMaxLoops,
                maxRetries: 3, // API call retry attempts
                hasTools: !!apiConfig.tools,
                isStateful: !!apiConfig.previous_response_id,
                messageCount: apiConfig.input.length,
                totalChars: totalChars,
                messages: apiConfig.input.map((msg, idx) => ({
                    index: idx,
                    role: msg.role,
                    contentPreview: typeof msg.content === 'string' ? 
                        msg.content : 
                        '[complex content]',
                    contentLength: typeof msg.content === 'string' ? msg.content.length : 'N/A',
                    fullContent: msg.content // Store full content in log
                })),
                toolCount: apiConfig.tools ? apiConfig.tools.length : 0,
                toolNames: apiConfig.tools ? apiConfig.tools.map(t => t.name || t.type || 'unknown') : [],
                usingFileSearch: this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' }) ? true : false,
                usingCloudWebSearch: this.globalResources.getSecureConfig({ path: 'grok.useWebSearch' }) === true
            }, logRequestId);
            
            // Verbose console output
            if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                console.log(`   Model: ${apiConfig.model}, Iteration: ${iteration}/${initialMaxLoops}, Messages: ${apiConfig.input?.length || 0}, Tools: ${apiConfig.tools ? apiConfig.tools.length : 0}${apiConfig.previous_response_id ? `, Previous Response ID: ${apiConfig.previous_response_id.substring(0, 8)}...` : ''}`);
            }

            // Initialize progress tracking variables (moved outside retry loop)
            const totalKeys = options?.totalKeys || 0; // 0 means no key tracking needed
            let currentKeyIndex = 0;
            let startedKeys = new Set();

            // Retry streaming up to 3 times before giving up
            let retryCount = 0; // Reset retry counter for each outer loop iteration
            const maxRetries = 3;
            let toolCalls = {}; // Track tool calls from streaming chunks - declared outside retry loop
            let toolCallsExecuted = false; // Track if tools were executed to continue outer loop (reset each iteration)

        while (retryCount < maxRetries) {
            try {
                this.globalResources.getLogger().detailed(`🎯 API call (attempt ${retryCount + 1}/${maxRetries})...`);
                const streamStartTime = Date.now();
                const callStartTime = streamStartTime; // Track when this API call started
                const stream = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().responses.create(apiConfig));
                let fullResponse = '';
                let lastChunk = null;
                let responseId = null;
                let completionObject = null;
                // Reset toolCalls for each retry attempt
                toolCalls = {};

                // Send initial streaming start signal
                if (options.ws && options.handler) {
                    options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                        phase: 'streaming',
                        currentKey: totalKeys > 0 ? 0 : undefined,
                        totalKeys: totalKeys > 0 ? totalKeys : undefined
                    });
                }

                // Real-time JSON parsing using clarinet (streaming SAX parser)
                const extractKeys = options?.extractKeys;

                // Reset progress tracking for new retry attempt
                currentKeyIndex = 0;
                startedKeys.clear();

                // Function to check if a key path matches the specified patterns
                function shouldExtractKey(fullPath) {
                    if (!extractKeys) return true; // Extract all if no filter specified

                    const patterns = Array.isArray(extractKeys) ? extractKeys : [extractKeys];

                    return patterns.some(pattern => {
                        // Convert glob pattern to regex
                        let regexPattern = pattern
                            .replace(/\[\*\]\./g, '.')  // Replace [*]. with . first (since clarinet flattens arrays)
                            .replace(/\*/g, '.*');     // Then * matches any characters including dots

                        // Also try the pattern with [*] replaced by array indices
                        const arrayRegexPattern = pattern
                            .replace(/\[\*\]/g, '\\[\\d+\\]')  // [*] matches [0], [1], etc.
                            .replace(/\*/g, '.*');

                        const regex1 = new RegExp(`^${regexPattern}$`);
                        const regex2 = new RegExp(`^${arrayRegexPattern}$`);

                        return regex1.test(fullPath) || regex2.test(fullPath);
                    });
                }

                let seenKeys = new Set();
                let extractedKeysInChunk = []; // Track keys extracted in current chunk
                const jsonParser = clarinet.createStream();
                const path = [];

                // Set up clarinet event handlers for live key extraction
                jsonParser.on('openobject', (key) => {
                    if (key !== undefined) {
                        path.push(key);
                        const fullPath = path.join('.');
                        const eventKey = `${fullPath}:object`;

                        if (!seenKeys.has(eventKey) && shouldExtractKey(fullPath)) {
                            seenKeys.add(eventKey);
                            extractedKeysInChunk.push({ path: fullPath, value: 'object', type: 'openobject' });

                            // Track top-level keys for progress (only when key tracking is enabled)
                            if (totalKeys > 0 && path.length === 1 && !startedKeys.has(key)) {
                                startedKeys.add(key);
                                currentKeyIndex = Math.min(currentKeyIndex + 1, totalKeys);

                                // Send progress update for key start
                                if (options.ws && options.handler) {
                                    options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                                        phase: 'streaming',
                                        currentKey: currentKeyIndex,
                                        totalKeys: totalKeys,
                                        reasoning: `Processing ${key}...`
                                    });
                                }
                            }
                        }
                    }
                });

                jsonParser.on('key', (key) => {
                    // Handle array indices
                    if (!isNaN(key)) {
                        path.push(`[${key}]`);
                    } else {
                        path.push(key);
                    }
                });

                jsonParser.on('value', (value) => {
                    const fullPath = path.join('.');
                    const eventKey = `${fullPath}:${JSON.stringify(value)}`;

                    if (!seenKeys.has(eventKey) && shouldExtractKey(fullPath)) {
                        seenKeys.add(eventKey);
                        extractedKeysInChunk.push({ path: fullPath, value: value, type: 'value' });

                        // Send reasoning update if this is a reasoning field
                        if (fullPath.endsWith('.reason') || fullPath.endsWith('.reason_display')) {
                            if (options.ws && options.handler && typeof value === 'string') {
                                options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                                    phase: 'streaming',
                                    currentKey: currentKeyIndex,
                                    totalKeys: totalKeys,
                                    reasoning: value
                                });
                            }
                        }
                    }

                    path.pop(); // Remove the key after processing value
                });

                jsonParser.on('openarray', () => {
                    const fullPath = path.join('.');
                    const eventKey = `${fullPath}:array`;

                    if (!seenKeys.has(eventKey) && shouldExtractKey(fullPath)) {
                        seenKeys.add(eventKey);
                        extractedKeysInChunk.push({ path: fullPath, value: 'array', type: 'openarray' });
                    }
                });

                jsonParser.on('closeobject', () => {
                    if (path.length > 0) path.pop();
                });

                jsonParser.on('closearray', () => {
                    if (path.length > 0) path.pop();
                });

                jsonParser.on('end', () => {
                    this.globalResources.getLogger().verbose(`\\n🏁 Complete JSON received (${seenKeys.size} elements)`);
                });

                jsonParser.on('error', (error) => {
                    //console.warn('⚠️ Clarinet parsing error (JSON may be incomplete):', error.message);
                    // Clarinet handles incomplete JSON gracefully - continues parsing valid portions
                });

                // Process streaming chunks with live output - Responses API format
                for await (const chunk of stream) {
                    // Check ALL chunks for usage data (may appear in various chunk types)
                    if (chunk.usage) {
                        if (!completionObject) {
                            completionObject = {};
                        }
                        completionObject.usage = chunk.usage;
                    }
                    
                    // Handle different chunk types from Responses API
                    if (chunk.type === 'response.created' || chunk.type === 'response.in_progress') {
                        // Initial response object - capture ID
                        if (chunk.response?.id) {
                            responseId = chunk.response.id;
                        }
                        // Check if usage is in response object
                        if (chunk.response?.usage) {
                            if (!completionObject) {
                                completionObject = {};
                            }
                            completionObject.usage = chunk.response.usage;
                        }
                    } else if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
                        // Starting a function call - track it
                        if (!toolCalls[chunk.output_index]) {
                            // Check if arguments are already complete in the item (common for Grok)
                            const initialArguments = chunk.item.arguments || '';
                            
                            toolCalls[chunk.output_index] = {
                                id: chunk.item.id,
                                type: 'function',
                                function: {
                                    name: chunk.item.name,
                                    arguments: initialArguments
                                }
                            };
                        }
                    } else if (chunk.type === 'response.function_call_arguments.delta') {
                        // Accumulate function call arguments
                        const toolCall = toolCalls[chunk.output_index];
                        if (toolCall) {
                            toolCall.function.arguments += chunk.delta || '';
                        }
                    } else if (chunk.type === 'response.output_item.done' && chunk.item) {
                        // Complete output item - capture for later processing
                        lastChunk = chunk;
                    } else if (chunk.type === 'response.output_text.delta') {
                        // Text delta chunks - this is the actual content
                        const content = chunk.delta || '';
                        if (content) {
                            fullResponse += content;
                            
                            // Check if this chunk contains XML-wrapped function calls
                            // If so, parse and convert them to standard tool call format
                            if (content.includes('<xai:function_call')) {
                                // Check the accumulated fullResponse for complete function calls
                                const xmlToolCalls = this.parseXmlWrappedFunctionCalls(fullResponse);
                                
                                if (xmlToolCalls.length > 0) {
                                    console.warn(`🔧 Detected ${xmlToolCalls.length} XML function call(s) in text delta - converting to standard format`);
                                    
                                    // Add each parsed tool call to toolCalls object
                                    xmlToolCalls.forEach((xmlToolCall, idx) => {
                                        const outputIndex = Object.keys(toolCalls).length;
                                        if (!toolCalls[outputIndex]) {
                                            toolCalls[outputIndex] = xmlToolCall;
                                            console.warn(`   ✅ Converted XML function call "${xmlToolCall.function.name}" to standard format`);
                                        }
                                    });
                                }
                            }

                            // Reset extracted keys for this chunk
                            extractedKeysInChunk = [];

                            // Feed content to clarinet parser - extracts keys LIVE as they arrive
                            jsonParser.write(content);

                            // Send streaming update to UI if callback provided (after processing)
                            if (onStreamUpdate) {
                                // Call with extracted keys as third parameter for filtering support
                                // Backward compatible - existing callbacks that expect 2 params still work
                                onStreamUpdate(content, fullResponse, extractedKeysInChunk);
                            }
                        }
                        
                        // Capture response ID from chunk if not already set
                        if (!responseId && chunk.item_id) {
                            responseId = chunk.item_id.replace(/^msg_/, '');
                        }
                    } else if (chunk.type === 'response.completed') {
                        // Final completed response - use this for final processing
                        if (chunk.response) {
                            completionObject = chunk.response;
                            responseId = chunk.response.id;
                            
                            // Check for usage in response object
                            if (chunk.response.usage) {
                                completionObject.usage = chunk.response.usage;
                            }
                        }
                        // Also check chunk root level for usage (backup)
                        if (chunk.usage && !completionObject?.usage) {
                            if (!completionObject) {
                                completionObject = {};
                            }
                            completionObject.usage = chunk.usage;
                        }
                    } else {
                        // Unhandled chunk type - only log in verbose mode
                        if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                            this.globalResources.getLogger().detailed(`Unhandled chunk type: ${chunk.type}`);
                        }  
                    }
                }

                // Signal end of stream to clarinet
                jsonParser.end();

                // Ensure we captured a response ID before further processing
                if (!responseId) {
                    if (completionObject?.id) {
                        responseId = completionObject.id;
                    } else if (completionObject?.response?.id) {
                        responseId = completionObject.response.id;
                    }
                }

                // Extract response data from completionObject (Responses API format)
                // Tool calls are now accumulated from streaming chunks, but also check completion object as fallback
                let finalToolCalls = null;
                if (Object.keys(toolCalls).length > 0) {
                    // Use tool calls accumulated from streaming chunks
                    finalToolCalls = Object.values(toolCalls);
                    this.globalResources.getLogger().detailed(`🔧 Found ${finalToolCalls.length} tool calls from streaming`);
                } else if (completionObject?.output) {
                    // Fallback: Check for tool calls in the completion object output
                    for (const outputItem of completionObject.output) {
                        if (outputItem.type === 'message' && outputItem.tool_calls) {
                            finalToolCalls = outputItem.tool_calls;
                            this.globalResources.getLogger().detailed(`🔧 Found ${finalToolCalls.length} tool calls from completion`);
                            break;
                        }
                    }
                    
                    // Additional fallback: some Grok responses may return XML-wrapped function calls
                    // in the message text instead of structured tool_calls. Detect and convert them.
                    if ((!finalToolCalls || finalToolCalls.length === 0) && completionObject.output) {
                        let xmlWrappedText = '';
                        
                        for (const outputItem of completionObject.output) {
                            if (outputItem.type === 'message' && outputItem.content && Array.isArray(outputItem.content)) {
                                for (const contentItem of outputItem.content) {
                                    if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
                                        xmlWrappedText += contentItem.text;
                                    }
                                }
                            }
                        }
                        
                        if (xmlWrappedText && xmlWrappedText.includes('<xai:function_call')) {
                            const xmlToolCalls = this.parseXmlWrappedFunctionCalls(xmlWrappedText);
                            
                            if (xmlToolCalls.length > 0) {
                                finalToolCalls = xmlToolCalls;
                                this.globalResources.getLogger().detailed(`🔧 Detected ${xmlToolCalls.length} XML function call(s) in message text - converting to standard tool call format`);
                            }
                        }
                    }
                }

                // Calculate call duration
                const callEndTime = Date.now();
                const callDuration = callEndTime - callStartTime;

                // Extract tool information (with size optimization)
                const tools = [];
                if (finalToolCalls && finalToolCalls.length > 0) {
                    finalToolCalls.forEach(toolCall => {
                        const toolName = toolCall.function?.name || toolCall.name || 'unknown';
                        let toolArgs = typeof toolCall.function?.arguments === 'string' 
                            ? JSON.parse(toolCall.function.arguments) 
                            : (toolCall.function?.arguments || toolCall.arguments || {});
                        
                        // Optimize parameters based on tool type to reduce storage size
                        if (toolName === 'validateTextReplacement') {
                            // Remove large text fields from textReplacements to avoid duplication
                            if (toolArgs.textReplacements) {
                                const textReplacements = { ...toolArgs.textReplacements };
                                delete textReplacements.dialogs;
                                delete textReplacements.insightMemory;
                                delete textReplacements.errors;
                                delete textReplacements.warnings;
                                delete textReplacements.generated_image_name;
                                delete textReplacements.character_names;
                                
                                // Remove large fields from prompt replacements
                                if (textReplacements.prompt && Array.isArray(textReplacements.prompt)) {
                                    textReplacements.prompt = textReplacements.prompt.map(replacement => {
                                        const { select_text, replace_text, fallback_select_text, alternative_text, ...rest } = replacement;
                                        return { ...rest, _hasTextFields: true };
                                    });
                                }
                                
                                // Remove large fields from uc replacements
                                if (textReplacements.uc && Array.isArray(textReplacements.uc)) {
                                    textReplacements.uc = textReplacements.uc.map(replacement => {
                                        const { select_text, replace_text, fallback_select_text, alternative_text, ...rest } = replacement;
                                        return { ...rest, _hasTextFields: true };
                                    });
                                }
                                
                                // Remove large fields from character prompt replacements
                                if (textReplacements.character_prompts && Array.isArray(textReplacements.character_prompts)) {
                                    textReplacements.character_prompts = textReplacements.character_prompts.map(charReplacement => {
                                        if (!charReplacement || typeof charReplacement !== 'object') return charReplacement;
                                        
                                        const optimized = {};
                                        if (charReplacement.prompt && Array.isArray(charReplacement.prompt)) {
                                            optimized.prompt = charReplacement.prompt.map(replacement => {
                                                const { select_text, replace_text, fallback_select_text, alternative_text, ...rest } = replacement;
                                                return { ...rest, _hasTextFields: true };
                                            });
                                        }
                                        if (charReplacement.uc && Array.isArray(charReplacement.uc)) {
                                            optimized.uc = charReplacement.uc.map(replacement => {
                                                const { select_text, replace_text, fallback_select_text, alternative_text, ...rest } = replacement;
                                                return { ...rest, _hasTextFields: true };
                                            });
                                        }
                                        return optimized;
                                    });
                                }
                                
                                toolArgs.textReplacements = textReplacements;
                            }
                        } else if (toolName === 'analyzeTokenCount') {
                            // Convert texts array to just show length
                            if (toolArgs.texts && Array.isArray(toolArgs.texts)) {
                                toolArgs.texts = toolArgs.texts.length;
                            }
                        } else if (toolName === 'saveKnowledgeMemory') {
                            // Only keep name and reason
                            toolArgs = {
                                name: toolArgs.name || null,
                                reason: toolArgs.reason || null
                            };
                        }
                        
                        tools.push({
                            name: toolName,
                            parameters: toolArgs
                        });
                    });
                }

                // Determine call type
                const callType = finalToolCalls && finalToolCalls.length > 0 ? 'tool_call' : 'request';

                // Log usage data immediately after stream ends (for ALL API calls, including tool iterations)
                const logRequestId = getRequestId();
                const iteration = initialMaxLoops - maxLoops + 1;
                
                // Ensure apiCalls is always populated for this iteration, even if completionObject is null or missing usage
                // This is critical for usage tracking - we must track every API call
                if (completionObject?.usage) {
                    const usageData = completionObject.usage;
                    
                    // Handle both naming conventions: input_tokens/output_tokens (actual API) or prompt_tokens/completion_tokens (docs)
                    // Extract prompt/input tokens
                    const promptTokens = usageData.prompt_tokens || usageData.input_tokens || 0;
                    const completionTokens = usageData.completion_tokens || usageData.output_tokens || 0;
                    
                    // Extract details - check both naming conventions
                    const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
                    const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
                    
                    const totalTokens = usageData.total_tokens || 0;
                    const cachedTokens = promptDetails?.cached_tokens || 0;
                    const reasoningTokens = completionDetails?.reasoning_tokens || 0;
                    
                    // Track this individual API call
                    // Detect initial system message call (first iteration with no previous_response_id)
                    const isInitialSystemCall = isFirstIteration && !apiConfig.previous_response_id && callType === 'request';
                    
                    const callEntry = {
                        phase: options.buildOptions?.phase || 'phase1', // Include phase from buildOptions if available
                        iteration: iteration,
                        callType: isInitialSystemCall ? 'system_message' : callType, // 'system_message', 'request', or 'tool_call'
                        isInitialSystemCall: isInitialSystemCall,
                        timestamp: callStartTime,
                        duration: callDuration, // Duration in milliseconds
                        usage: {
                            total: totalTokens,
                            input: promptTokens,
                            output: completionTokens,
                            cache: cachedTokens,
                            reasoning: reasoningTokens
                        },
                        pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK'),
                        responseId: responseId || null,
                        toolCalls: finalToolCalls ? finalToolCalls.length : 0,
                        tools: tools, // Array of tool information (name, reason, parameters)
                        hasResponseId: !!apiConfig.previous_response_id
                    };
                    if (options._attemptId && apiCallsMailboxId) {
                        // Use createLetter to keep all attempts (they cost money)
                        // removeAfterRead is false on mailbox, so letters persist for tracking
                        this.globalResources.getDataPlumbing().createLetter(callEntry, apiCallsMailboxId, {
                            index: apiCallIndex++,
                            category: 'tool_results',
                            tags: ['api_calls']
                        });
                    }
                    
                    this.globalResources.getLogger().logGeneration('AI_API_USAGE', {
                        iteration: iteration,
                        apiCallType: 'api_call',
                        total: totalTokens,
                        input: promptTokens,
                        output: completionTokens,
                        cache: cachedTokens,
                        reasoning: reasoningTokens,
                        prompt_tokens_details: promptDetails,
                        completion_tokens_details: completionDetails,
                        num_sources_used: usageData.num_sources_used || 0,
                        pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK')
                    }, logRequestId);
                } else {
                    // Log warning if no usage data found (only in verbose mode)
                    if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                        this.globalResources.getLogger().detailed(`⚠️ No usage data found after stream end for iteration ${iteration}`);
                    }
                    // Still track the call even without usage data
                    const callEndTimeNoUsage = Date.now();
                    const callDurationNoUsage = callEndTimeNoUsage - callStartTime;
                    
                    // Detect initial system message call (first iteration with no previous_response_id)
                    const isInitialSystemCallNoUsage = isFirstIteration && !apiConfig.previous_response_id && callType === 'request';
                    
                    const callEntryNoUsage = {
                        phase: options.buildOptions?.phase || 'phase1', // Include phase from buildOptions if available
                        iteration: iteration,
                        callType: isInitialSystemCallNoUsage ? 'system_message' : callType, // 'system_message', 'request', or 'tool_call'
                        isInitialSystemCall: isInitialSystemCallNoUsage,
                        timestamp: callStartTime,
                        duration: callDurationNoUsage, // Duration in milliseconds
                        usage: null,
                        responseId: responseId || null,
                        toolCalls: finalToolCalls ? finalToolCalls.length : 0,
                        tools: tools, // Array of tool information (name, reason, parameters)
                        hasResponseId: !!apiConfig.previous_response_id
                    };
                    
                    if (options._attemptId && apiCallsMailboxId) {
                        // Use createLetter to keep all attempts (they cost money)
                        this.globalResources.getDataPlumbing().createLetter(callEntryNoUsage, apiCallsMailboxId, {
                            index: apiCallIndex++,
                            category: 'tool_results',
                            tags: ['api_calls']
                        });
                    }
                }

                // Check for tool calls first
                if (finalToolCalls && finalToolCalls.length > 0) {
                    this.globalResources.getLogger().detailed(`🔧 Processing ${finalToolCalls.length} tool call(s)`);
                    
                    // Log raw SI response before tool execution
                    this.globalResources.getLogger().logGeneration('AI_MESSAGES_RESPONSE', {
                        model: apiConfig.model,
                        iteration: iteration,
                        maxLoops: initialMaxLoops,
                        hasTools: !!apiConfig.tools,
                        isStateful: !!apiConfig.previous_response_id,
                        responseLength: fullResponse.length,
                        toolCallCount: finalToolCalls.length,
                        responseId: responseId || null,
                        fullResponse: fullResponse || '',
                        completionObject: completionObject || null
                    }, logRequestId);
                    
                    // Store response ID for next iteration
                    lastResponseId = responseId;
                    this.globalResources.getLogger().verbose(`💾 Stored response ID: ${lastResponseId}`);
                    
                    let toolResultMessages = [];
                    let toolsCalledSoFar = [];

                    for (const toolCall of finalToolCalls) {
                        const toolStartTime = Date.now();
                        
                        // Send tool execution start progress update
                        let toolReasoningId = null;
                        if (options.ws && options.handler) {
                            const toolArgs = typeof toolCall.function.arguments === 'string' ? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments;
                            let toolReason = toolArgs.reason || toolArgs.query || `Executing ${toolCall.function.name}`;
                            
                            // For searchTagsBatch, format the tags list (max 7 tags + "... (+X more)")
                            if (toolCall.function.name === 'searchTagsBatch' && toolArgs.tags && Array.isArray(toolArgs.tags)) {
                                const tagsList = toolArgs.tags.map(t => t.name);
                                if (tagsList.length > 7) {
                                    const displayTags = tagsList.slice(0, 7).join(', ');
                                    toolReason = `Searching: ${displayTags} (+${tagsList.length - 7} more)`;
                                } else {
                                    toolReason = `Searching: ${tagsList.join(', ')}`;
                                }
                            }
                            
                            // Generate unique ID for this reasoning item
                            toolReasoningId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                            
                            options.handler.sendToClient(options.ws, {
                                type: 'dynamic_generation_progress_update',
                                phase: 'tool_execution',
                                data: {
                                    currentKey: toolResultMessages.length + 1,
                                    totalKeys: finalToolCalls.length,
                                    toolName: toolCall.function.name,
                                    toolState: 'executing',
                                    toolReasoningId: toolReasoningId,
                                    reason: toolReason
                                },
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Pass websocket info to tool for progress updates
                        const toolContext = {
                            ws: options.ws,
                            handler: options.handler,
                            toolIndex: toolResultMessages.length + 1,
                            totalTools: finalToolCalls.length,
                            toolReasoningId: toolReasoningId
                        };
                        
                        // Execute tool - it will fetch buildOptions from Kaze using attemptId
                        const toolResult = await this.executeTool(toolCall, options._attemptId, toolContext);
                        const toolDuration = Date.now() - toolStartTime;
                        
                        // Extract published_analysis and replacement_plan from tool result return values
                        // These will be sent via mailboxes after all tool calls complete
                        if (toolCall.function.name === 'publishAnalysisResults' && toolResult?.published_analysis) {
                            publishedAnalysis = toolResult.published_analysis;
                        }
                        if (toolCall.function.name === 'planTextReplacements' && toolResult?.replacement_plan) {
                            replacementPlan = toolResult.replacement_plan;
                        }

                        // Summarized console (already logged by executeTool)
                        
                        // Detailed file logging - full input/output
                        this.globalResources.getLogger().logGeneration('TOOL_COMPLETE', {
                            toolNumber: toolResultMessages.length + 1,
                            totalTools: finalToolCalls.length,
                            toolName: toolCall.function.name,
                            duration: toolDuration,
                            input: typeof toolCall.function.arguments === 'string' ? 
                                JSON.parse(toolCall.function.arguments) : toolCall.function.arguments,
                            output: toolResult
                        }, logRequestId);
                        
                        // Verbose console output
                        if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                            console.log(`🔧 Tool [${toolResultMessages.length + 1}/${finalToolCalls.length}]: ${toolCall.function.name} (${toolDuration}ms)`);
                            console.log(`   Input:`, typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : JSON.stringify(toolCall.function.arguments, null, 2));
                            console.log(`   Output:`, JSON.stringify(toolResult, null, 2));
                        }
                        
                        // Tool completion messages are sent by the tools themselves or executeTool's completion handler
                        // No need to send completion here to avoid duplicates

                        // Check if tool requested auto-completion
                        if (toolResult && toolResult.autoComplete === true && toolResult.finalOutput) {
                            this.globalResources.getLogger().normal(`🎯 Auto-complete triggered`);
                            this.globalResources.getLogger().logGeneration('AI_AUTO_COMPLETE', {
                                tool: toolCall.function.name,
                                finalOutput: toolResult.finalOutput
                            }, logRequestId);
                            
                            // Build full structured usage format (phase1/phase2 objects) from apiCalls
                            // This matches the format expected by dynamicGenerationHandlers
                            const phase1Calls = apiCalls.filter(call => call.phase === 'phase1' || !call.phase);
                            const phase2Calls = apiCalls.filter(call => call.phase === 'phase2');
                            
                            // Calculate phase1 total from last call with usage
                            let phase1Total = null;
                            if (phase1Calls.length > 0) {
                                const lastPhase1WithUsage = [...phase1Calls].reverse().find(call => call && call.usage);
                                if (lastPhase1WithUsage && lastPhase1WithUsage.usage) {
                                    phase1Total = {
                                        total: lastPhase1WithUsage.usage.total || 0,
                                        input: lastPhase1WithUsage.usage.input || 0,
                                        output: lastPhase1WithUsage.usage.output || 0,
                                        cache: lastPhase1WithUsage.usage.cache || 0,
                                        reasoning: lastPhase1WithUsage.usage.reasoning || 0
                                    };
                                }
                            }
                            
                            // Calculate phase2 total from last call with usage
                            let phase2Total = null;
                            if (phase2Calls.length > 0) {
                                const lastPhase2WithUsage = [...phase2Calls].reverse().find(call => call && call.usage);
                                if (lastPhase2WithUsage && lastPhase2WithUsage.usage) {
                                    phase2Total = {
                                        total: lastPhase2WithUsage.usage.total || 0,
                                        input: lastPhase2WithUsage.usage.input || 0,
                                        output: lastPhase2WithUsage.usage.output || 0,
                                        cache: lastPhase2WithUsage.usage.cache || 0,
                                        reasoning: lastPhase2WithUsage.usage.reasoning || 0
                                    };
                                }
                            }
                            
                            // Build structured usage object
                            const structuredUsage = {};
                            if (phase1Total || phase1Calls.length > 0) {
                                structuredUsage.phase1 = {
                                    total: phase1Total,
                                    calls: phase1Calls
                                };
                            }
                            if (phase2Total || phase2Calls.length > 0) {
                                structuredUsage.phase2 = {
                                    total: phase2Total,
                                    calls: phase2Calls
                                };
                            }
                            
                            // Calculate totalUsage from last call with usage (for backward compatibility)
                            const lastCallWithUsage = [...apiCalls].reverse().find(call => call && call.usage);
                            const totalUsage = lastCallWithUsage && lastCallWithUsage.usage ? {
                                total: lastCallWithUsage.usage.total || 0,
                                input: lastCallWithUsage.usage.input || 0,
                                output: lastCallWithUsage.usage.output || 0,
                                cache: lastCallWithUsage.usage.cache || 0,
                                reasoning: lastCallWithUsage.usage.reasoning || 0
                            } : null;
                            
                            return {
                                content: toolResult.finalOutput,
                                responseId: lastResponseId,
                                autoCompleted: true,
                                completedByTool: toolCall.function.name,
                                usage: Object.keys(structuredUsage).length > 0 ? structuredUsage : null, // Full structured usage format
                                totalUsage: totalUsage, // Total usage for backward compatibility
                                publishedAnalysis: publishedAnalysis,
                                replacementPlan: replacementPlan
                            };
                        }

                        // Track this tool as called
                        toolsCalledSoFar.push(toolCall.function.name);
                        
                        // Update phase status based on tool completion
                        if (toolCall.function.name === 'publishAnalysisResults' && toolResult?.published_analysis) {
                            phaseStatus.analysis = true;
                        }
                        if (toolCall.function.name === 'planTextReplacements' && toolResult?.replacement_plan) {
                            phaseStatus.planning = true;
                        }
                        if (toolCall.function.name === 'validateTextReplacement' && toolResult?.validationPassed) {
                            phaseStatus.execution = true;
                        }
                        if (toolCall.function.name === 'completeTooling') {
                            phaseStatus.validation = true;
                        }
                        
                        // Calculate total tokens used so far
                        const currentTotalTokens = totalUsageData ? totalUsageData.total : 0;
                        
                        // Get max tool calls from options
                        const maxToolCalls = options?.toolLoops || 8;
                        
                        // Get dynamic config and context from buildOptions
                        const dynamicConfig = options?.buildOptions || {};
                        const context = options?.buildOptions?.contextData || null;
                        
                        const header = 'Tool ' + (toolCall.function && toolCall.function.name || '');

                        // Add ONLY the tool result message (previous context maintained by response ID)
                        // Note: XAI Grok Responses API doesn't allow 'name' field in tool messages
                        // Format content as markdown if available, otherwise use JSON
                        let toolContent;
                        if (toolResult && toolResult.markdown) {
                            toolContent = header + toolResult.markdown;
                        } else if (toolResult && toolResult.message) {
                            toolContent = header + toolResult.message;
                        } else {
                            toolContent = header + JSON.stringify(toolResult);
                        }
                        
                        toolResultMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: toolContent
                        });
                        
                        // Check if this is the completeTooling call
                        if (toolCall.function.name === 'completeTooling') {
                            toolingComplete = true;
                            console.log(`✅ TOOLING COMPLETE - Next iteration will provide structured response`);
                        }
                        
                        // Check if this is the rejectChain call
                        if (toolCall.function.name === 'rejectChain' && toolResult?.willPerformFullRegeneration === true) {
                            console.log(`🚫 CHAIN REJECTED - Returning immediately to restart process`);
                            let simplifiedUsage = null;
                            if (completionObject?.usage) {
                                const usageData = completionObject.usage;
                                const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
                                const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
                                simplifiedUsage = {
                                    total: usageData.total_tokens || 0,
                                    input: usageData.prompt_tokens || usageData.input_tokens || 0,
                                    output: usageData.completion_tokens || usageData.output_tokens || 0,
                                    cache: promptDetails?.cached_tokens || 0,
                                    reasoning: completionDetails?.reasoning_tokens || 0
                                };
                            }
                            // Send data via mailboxes
                            sendDataViaMailboxes({
                                chainRejected: true,
                                responseId: null,  // Clear response ID completely
                                usage: simplifiedUsage,
                                publishedAnalysis: publishedAnalysis,
                                replacementPlan: replacementPlan
                            });
                            
                            return {
                                content: null,
                                chainRejected: true
                            };
                        }

                        // Check if this is the start tool with successful validation
                        if (toolCall.function.name === 'start' && toolResult?.validationPassed === true) {
                            console.log(`✅ START TOOL VALIDATION PASSED - Ending conversation immediately`);
                            // Return immediately with validationPassed flag
                            // Calculate usage data before returning
                            let finalUsageDataForReturn = null;
                            const currentUsageData = completionObject?.usage || null;
                            if (currentUsageData) {
                                const promptDetails = currentUsageData.prompt_tokens_details || currentUsageData.input_tokens_details || null;
                                const completionDetails = currentUsageData.completion_tokens_details || currentUsageData.output_tokens_details || null;
                                
                                // Check if we're using stateful continuation (previous_response_id is set for non-first iterations)
                                const isStateful = lastResponseId && maxLoops < initialMaxLoops;
                                
                                if (isStateful) {
                                    // Stateful continuation: API provides cumulative totals, so use directly
                                    finalUsageDataForReturn = {
                                        total: currentUsageData.total_tokens || 0,
                                        input: currentUsageData.prompt_tokens || currentUsageData.input_tokens || 0,
                                        output: currentUsageData.completion_tokens || currentUsageData.output_tokens || 0,
                                        cache: promptDetails?.cached_tokens || 0,
                                        reasoning: completionDetails?.reasoning_tokens || 0
                                    };
                                } else {
                                    // Non-stateful: accumulate with existing totalUsageData
                                    if (!totalUsageData) {
                                        totalUsageData = {
                                            total: 0,
                                            input: 0,
                                            output: 0,
                                            cache: 0,
                                            reasoning: 0
                                        };
                                    }
                                    totalUsageData.total += currentUsageData.total_tokens || 0;
                                    totalUsageData.input += currentUsageData.prompt_tokens || currentUsageData.input_tokens || 0;
                                    totalUsageData.output += currentUsageData.completion_tokens || currentUsageData.output_tokens || 0;
                                    totalUsageData.cache += promptDetails?.cached_tokens || 0;
                                    totalUsageData.reasoning += completionDetails?.reasoning_tokens || 0;
                                    finalUsageDataForReturn = totalUsageData;
                                }
                            } else if (totalUsageData) {
                                // Use accumulated totalUsageData even if current call has no usage
                                finalUsageDataForReturn = totalUsageData;
                            }
                            
                            // Send data via mailboxes
                            sendDataViaMailboxes({
                                responseId: lastResponseId,
                                usage: finalUsageDataForReturn,
                                apiCalls: apiCalls,
                                publishedAnalysis: publishedAnalysis,
                                replacementPlan: replacementPlan
                            });
                            
                            return {
                                content: toolResult.message,
                                validationPassed: true,
                                completedByTool: 'start',
                                responseId: lastResponseId || responseId || null
                            };
                        }
                    }
                    
                    // Accumulate usage data from this API call before continuing
                    // Handle both naming conventions: input_tokens/output_tokens (actual API) or prompt_tokens/completion_tokens (docs)
                    const currentUsageData = completionObject?.usage || null;
                    if (currentUsageData) {
                        const promptDetails = currentUsageData.prompt_tokens_details || currentUsageData.input_tokens_details || null;
                        const completionDetails = currentUsageData.completion_tokens_details || currentUsageData.output_tokens_details || null;
                        
                        // Check if we're using stateful continuation (previous_response_id is set for non-first iterations)
                        const isStateful = lastResponseId && maxLoops < initialMaxLoops;
                        
                        if (isStateful) {
                            // Stateful continuation: API provides cumulative totals, so REPLACE not accumulate
                            totalUsageData = {
                                total: currentUsageData.total_tokens || 0,
                                input: currentUsageData.prompt_tokens || currentUsageData.input_tokens || 0,
                                output: currentUsageData.completion_tokens || currentUsageData.output_tokens || 0,
                                cache: promptDetails?.cached_tokens || 0,
                                reasoning: completionDetails?.reasoning_tokens || 0
                            };
                        } else {
                            // Non-stateful: accumulate normally (first iteration or no previous_response_id)
                            if (!totalUsageData) {
                                totalUsageData = {
                                    total: 0,
                                    input: 0,
                                    output: 0,
                                    cache: 0,
                                    reasoning: 0
                                };
                            }
                            totalUsageData.total += currentUsageData.total_tokens || 0;
                            totalUsageData.input += currentUsageData.prompt_tokens || currentUsageData.input_tokens || 0;
                            totalUsageData.output += currentUsageData.completion_tokens || currentUsageData.output_tokens || 0;
                            totalUsageData.cache += promptDetails?.cached_tokens || 0;
                            totalUsageData.reasoning += completionDetails?.reasoning_tokens || 0;
                        }
                        
                        // Note: Usage was already logged right after stream ended, so we just accumulate here
                    }
                    
                    // Verify all tool results were collected
                    console.log(`✅ Collected ${toolResultMessages.length} tool result(s) from ${finalToolCalls.length} tool call(s)`);
                    
                    // Send tool results data via Kaze mailboxes after all tool calls complete
                    // This is where callDirectorAIWithStructuredOutput controls the tool filter and sends results
                    if (options._attemptId) {
                        sendDataViaMailboxes({
                            publishedAnalysis: publishedAnalysis,
                            replacementPlan: replacementPlan,
                            usage: totalUsageData,
                            apiCalls: apiCalls,
                            responseId: lastResponseId
                        });
                    }
                    
                    // Set next iteration to send ONLY tool results with previous_response_id
                    nextIterationMessages = toolResultMessages;
                    
                    // Decrement maxLoops and continue to next iteration with tool results
                    maxLoops--;
                    toolCallsExecuted = true; // Mark that we executed tools
                    this.globalResources.getLogger().verbose(`🔄 Continuing to iteration ${initialMaxLoops - maxLoops + 1} with ${nextIterationMessages.length} tool result(s)`);
                    break; // Break out of retry loop to continue outer tool loop
                } else {
                    // No tool calls detected in chunks or converted from XML - extract final response from completionObject
                    // Note: XML-wrapped function calls in text deltas are handled above and converted to tool calls,
                    // so if we reach here, there are truly no tool calls
                    // Clarinet/fullResponse is ONLY for live streaming callbacks
                    // Final result MUST come from completionObject
                    let response = '';
                    let citations = [];
                    
                    if (completionObject?.output) {
                        for (const outputItem of completionObject.output) {
                            if (outputItem.type === 'message') {
                                // Extract text from message content
                                if (outputItem.content && Array.isArray(outputItem.content)) {
                                    for (const contentItem of outputItem.content) {
                                        if (contentItem.type === 'output_text' && contentItem.text) {
                                            response = contentItem.text;
                                            break;
                                        }
                                    }
                                }
                                
                                // Extract citations if present
                                if (outputItem.citations) {
                                    citations = outputItem.citations;
                                }
                                
                                break;
                            }
                        }
                    }
                    
                    // Summarized console output
                    this.globalResources.getLogger().detailed(`📚 Response received: ${response.length} chars${citations.length > 0 ? ` | ${citations.length} citations` : ''}`);
                    
                    // Detailed file logging - full SI response
                    const responseIteration = initialMaxLoops - maxLoops + 1;
                    this.globalResources.getLogger().logGeneration('AI_MESSAGES_RESPONSE', {
                        model: apiConfig.model,
                        iteration: responseIteration,
                        maxLoops: initialMaxLoops,
                        hasTools: !!apiConfig.tools,
                        isStateful: !!apiConfig.previous_response_id,
                        responseLength: response.length,
                        toolCallCount: 0, // No tool calls in this path
                        responseId: lastResponseId || null,
                        citationCount: citations.length,
                        citations: citations,
                        fullResponse: response,
                        completionObject: null
                    }, logRequestId);
                    
                    // Verbose console output
                    if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                        console.log(`📚 [Responses API] Found ${citations.length} citations in response`);
                        if (citations.length > 0) {
                            console.log(`📚 Citations:`, JSON.stringify(citations, null, 2));
                        }
                    }

                    let parsedResponse;
                    if (typeof response === 'string' && response.trim()) {
                        // Handle different response types based on responseSchema and tooling state

                        if (options?.responseSchema === null || options?.responseSchema === undefined) {
                            // Normal text response - return as is
                            parsedResponse = response;
                            this.globalResources.getLogger().detailed('✅ Text response received');
                            this.globalResources.getLogger().logGeneration('AI_RESPONSE_PARSED', {
                                responseType: 'text',
                                response: response
                            }, logRequestId);
                        } else if (toolingComplete && typeof options?.responseSchema === 'object' && options?.responseSchema._def) {
                            // Tooling complete with text.format response - parse JSON from text
                            try {
                                const rawJson = JSON.parse(response);
                                
                                // Try normal parse first
                                try {
                                    const validatedResponse = options.responseSchema.parse(rawJson);
                                    
                                    if (validatedResponse.text_replacements) {
                                        const buildOptionsForHydration = getBuildOptions();
                                        if (buildOptionsForHydration) {
                                        const { hydrateTextReplacements } = require('../promptSegments');
                                            const hydrationResult = hydrateTextReplacements(validatedResponse.text_replacements, buildOptionsForHydration);
                                        if (hydrationResult) {
                                            Object.assign(validatedResponse.text_replacements, hydrationResult.replacements);
                                            validatedResponse.text_replacements._hydrationMetadata = hydrationResult.metadata;
                                            }
                                        }
                                    }
                                    
                                    parsedResponse = { ...validatedResponse, citations: citations };
                                    this.globalResources.getLogger().detailed(`✅ Response parsed and validated (post-tooling)`);
                                    
                                    // Log parsed response structure
                                    this.globalResources.getLogger().logGeneration('AI_RESPONSE_PARSED', {
                                        responseType: 'structured_post_tooling',
                                        parsedResponse: parsedResponse
                                    }, logRequestId);
                                } catch (zodError) {
                                    // Only use graceful parse on validation failure
                                    if (zodError.name === 'ZodError') {
                                        console.log('⚠️ Validation failed, attempting graceful recovery...');
                                        const parseResult = this.gracefulParse(options.responseSchema, rawJson, 'structured response (post-tooling)');
                                        
                                        if (parseResult.success || parseResult.partialSuccess) {
                                            if (parseResult.data?.text_replacements) {
                                                const buildOptionsForHydration = getBuildOptions();
                                                if (buildOptionsForHydration) {
                                                const { hydrateTextReplacements } = require('../promptSegments');
                                                    const hydrationResult = hydrateTextReplacements(parseResult.data.text_replacements, buildOptionsForHydration);
                                                if (hydrationResult) {
                                                    Object.assign(parseResult.data.text_replacements, hydrationResult.replacements);
                                                    parseResult.data.text_replacements._hydrationMetadata = hydrationResult.metadata;
                                                    }
                                                }
                                            }
                                            
                                            parsedResponse = { ...parseResult.data, citations: citations };
                                            
                                            // Log any filtered items
                                            if (Object.keys(parseResult.filtered).length > 0) {
                                                this.globalResources.getLogger().verbose('📊 Filtered items:', JSON.stringify(parseResult.filtered, null, 2));
                                            }
                                        } else {                            
                                            this.globalResources.getLogger().detailed('⚠️ Schema validation failed after graceful degradation (post-tooling) - triggering full retry');
                                            
                                            // Log what was filtered
                                            if (Object.keys(parseResult.filtered).length > 0) {
                                                console.log(`   🗑️  Filtered ${Object.keys(parseResult.filtered).length} array(s) but validation still failed`);
                                                this.globalResources.getLogger().verbose('📊 Filtered items before discard:', JSON.stringify(parseResult.filtered, null, 2));
                                            }
                                            
                                            // Format validation errors for logging
                                            const errorMessages = parseResult.errors.map(err => {
                                                const path = err.path.length > 0 ? err.path.join('.') : 'root';
                                                return `- Field "${path}": ${err.message}`;
                                            }).join('\n');
                                            
                                            this.globalResources.getLogger().logGeneration('VALIDATION_FAILED_AFTER_RECOVERY', {
                                                validationErrors: parseResult.errors,
                                                filteredItems: parseResult.filtered,
                                                errorDetails: errorMessages,
                                                context: 'post-tooling'
                                            }, logRequestId);
                                            
                                            // Send progress update if websocket is available
                                            if (options.ws && options.handler) {
                                                options.handler.sendToClient(options.ws, {
                                                    type: 'dynamic_generation_progress_update',
                                                    phase: 'validation_failed',
                                                    data: {
                                                        reason: 'Schema validation failed after recovery - restarting request',
                                                        errorCount: parseResult.errors.length
                                                    },
                                                    timestamp: new Date().toISOString()
                                                });
                                            }
                                            
                                            // Throw error to trigger retry from scratch
                                            throw new Error(`Schema validation failed after filtering invalid items (post-tooling). ${parseResult.errors.length} validation error(s) remaining. Discarding response and retrying.`);
                                        }
                                    } else {
                                        throw zodError;
                                    }
                                }
                            } catch (parseError) {
                                console.error('❌ Response parsing failed:', parseError.message);
                                console.warn('🔍 Raw response preview:', response.substring(0, 200) + (response.length > 200 ? '...' : ''));

                                // Check if response starts with function call wrapper
                                // xAI function call wrappers are ALWAYS tool calls, never structured responses
                                if (response.trim().startsWith('<xai:function_call')) {
                                    // Extract tool call information using parseXmlWrappedFunctionCalls
                                    const extractedToolCalls = this.parseXmlWrappedFunctionCalls(response);
                                    if (extractedToolCalls.length > 0) {
                                        const toolCall = extractedToolCalls[0];
                                        const functionName = toolCall.function?.name || 'unknown';
                                        // Parse arguments if it's a string, otherwise use as-is
                                        let toolArgs = toolCall.function?.arguments || {};
                                        if (typeof toolArgs === 'string') {
                                            try {
                                                toolArgs = JSON.parse(toolArgs);
                                            } catch (e) {
                                                // If parsing fails, keep as string
                                            }
                                        }
                                        console.warn(`🔧 Extracted tool call "${functionName}" with parameters:`, typeof toolArgs === 'object' && toolArgs !== null ? Object.keys(toolArgs) : 'N/A');
                                        
                                        // If there are tool loops left, let the tool handler process it
                                        // This overrides toolingComplete status
                                        if (maxLoops > 0) {
                                            console.warn(`🔧 Tool call detected with ${maxLoops} loop(s) remaining - letting tool handler process it`);
                                            throw new Error(`Tool call "${functionName}" detected - should be processed by tool handler, not parsed as structured response. Retrying...`);
                                        } else {
                                            throw new Error(`Tool call "${functionName}" detected but no tool loops remaining. This should not happen.`);
                                        }
                                    } else {
                                        console.warn(`⚠️ Detected xAI function call wrapper but could not extract tool call information`);
                                        throw new Error(`Tool call wrapper detected but extraction failed. Retrying...`);
                                    }
                                } else {
                                    // For structured output expectations, retry instead of falling back
                                    throw new Error(`JSON parsing failed for structured response: ${parseError.message}`);
                                }
                            }
                        } else if (typeof options?.responseSchema === 'string') {
                            // String format response (e.g., "json_object") - parse as JSON
                            try {
                                const rawJson = JSON.parse(response);
                                parsedResponse = { ...rawJson, citations: citations };
                                console.log('✅ JSON response parsed successfully');
                            } catch (parseError) {
                                console.warn('⚠️ Failed to parse JSON response:', parseError.message);
                                console.warn('🔍 Raw response preview:', response.substring(0, 200) + (response.length > 200 ? '...' : ''));

                                // Check if response starts with function call wrapper
                                if (response.trim().startsWith('<xai:function_call')) {
                                    console.warn('🔧 Detected xAI function call wrapper - attempting to extract JSON content');
                                    
                                    const extractedJson = this.extractJsonFromXaiFunctionCall(response);
                                    if (extractedJson) {
                                        parsedResponse = { ...extractedJson, citations: citations };
                                        console.warn('✅ Successfully extracted and parsed JSON from xAI function call wrapper');
                                        // Continue with successful parsing instead of throwing error
                                    } else {
                                        console.warn('❌ Could not extract valid JSON from xAI function call wrapper');
                                        // For structured output expectations, retry instead of falling back
                                        throw new Error(`JSON parsing failed for structured response: ${parseError.message}`);
                                    }
                                } else {
                                    // For structured output expectations, retry instead of falling back
                                    throw new Error(`JSON parsing failed for structured response: ${parseError.message}`);
                                }
                            }
                        } else if (typeof options?.responseSchema === 'object' && options?.responseSchema._def) {
                            // Zod schema response - validate with schema
                            try {
                                const rawJson = JSON.parse(response);
                                
                                // Try normal parse first
                                try {
                                    const validatedResponse = options.responseSchema.parse(rawJson);
                                    
                                    // 🚨 CRITICAL: Tendai - Hydrate Tanei (segment_index) to Tendai (select_text) immediately after schema validation
                                    if (validatedResponse.text_replacements) {
                                        const buildOptionsForHydration = getBuildOptions();
                                        if (buildOptionsForHydration) {
                                        const { hydrateTextReplacements } = require('../promptSegments');
                                            const hydrationResult = hydrateTextReplacements(validatedResponse.text_replacements, buildOptionsForHydration);
                                        if (hydrationResult) {
                                            Object.assign(validatedResponse.text_replacements, hydrationResult.replacements);
                                            validatedResponse.text_replacements._hydrationMetadata = hydrationResult.metadata;
                                            }
                                        }
                                    }
                                    
                                    parsedResponse = { ...validatedResponse, citations: citations };
                                    console.log('✅ Zod schema validation passed');
                                } catch (zodError) {
                                    // Only use graceful parse on validation failure
                                    if (zodError.name === 'ZodError') {
                                        console.log('⚠️ Validation failed, attempting graceful recovery...');
                                        const parseResult = this.gracefulParse(options.responseSchema, rawJson, 'Zod schema response');
                                        
                                        if (parseResult.success || parseResult.partialSuccess) {
                                            // 🚨 CRITICAL: Tendai - Hydrate Tanei (segment_index) to Tendai (select_text) after graceful parse
                                            if (parseResult.data?.text_replacements) {
                                                const buildOptionsForHydration = getBuildOptions();
                                                if (buildOptionsForHydration) {
                                                const { hydrateTextReplacements } = require('../promptSegments');
                                                    const hydrationResult = hydrateTextReplacements(parseResult.data.text_replacements, buildOptionsForHydration);
                                                if (hydrationResult) {
                                                    Object.assign(parseResult.data.text_replacements, hydrationResult.replacements);
                                                    parseResult.data.text_replacements._hydrationMetadata = hydrationResult.metadata;
                                                    }
                                                }
                                            }
                                            
                                            parsedResponse = { ...parseResult.data, citations: citations };
                                            
                                            // Log any filtered items
                                            if (Object.keys(parseResult.filtered).length > 0) {
                                                this.globalResources.getLogger().verbose('📊 Filtered items:', JSON.stringify(parseResult.filtered, null, 2));
                                            }
                                        } else {
                                            // Validation failed even after graceful degradation - discard and restart
                                            console.error('❌ Schema validation failed after filtering invalid items. Discarding response and restarting request.');
                                            this.globalResources.getLogger().detailed('⚠️ Schema validation failed after graceful degradation - triggering full retry');
                                            
                                            // Log what was filtered
                                            if (Object.keys(parseResult.filtered).length > 0) {
                                                console.log(`   🗑️  Filtered ${Object.keys(parseResult.filtered).length} array(s) but validation still failed`);
                                                this.globalResources.getLogger().verbose('📊 Filtered items before discard:', JSON.stringify(parseResult.filtered, null, 2));
                                            }
                                            
                                            // Format validation errors for logging
                                            const errorMessages = parseResult.errors.map(err => {
                                                const path = err.path.length > 0 ? err.path.join('.') : 'root';
                                                return `- Field "${path}": ${err.message}`;
                                            }).join('\n');
                                            
                                            this.globalResources.getLogger().logGeneration('VALIDATION_FAILED_AFTER_RECOVERY', {
                                                validationErrors: parseResult.errors,
                                                filteredItems: parseResult.filtered,
                                                errorDetails: errorMessages
                                            }, logRequestId);
                                            
                                            // Send progress update if websocket is available
                                            if (options.ws && options.handler) {
                                                options.handler.sendToClient(options.ws, {
                                                    type: 'dynamic_generation_progress_update',
                                                    phase: 'validation_failed',
                                                    data: {
                                                        reason: 'Schema validation failed after recovery - restarting request',
                                                        errorCount: parseResult.errors.length
                                                    },
                                                    timestamp: new Date().toISOString()
                                                });
                                            }
                                            
                                            // Throw error to trigger retry from scratch
                                            throw new Error(`Schema validation failed after filtering invalid items. ${parseResult.errors.length} validation error(s) remaining. Discarding response and retrying.`);
                                        }
                                    } else {
                                        throw zodError;
                                    }
                                }
                            } catch (parseError) {
                                console.warn('⚠️ Failed to parse streaming SI response as JSON:', parseError.message);
                                console.warn('🔍 Raw response preview:', response.substring(0, 200) + (response.length > 200 ? '...' : ''));

                                // Check if response starts with function call wrapper
                                // xAI function call wrappers are ALWAYS tool calls, never structured responses
                                if (response.trim().startsWith('<xai:function_call')) {
                                    // Extract tool call information using parseXmlWrappedFunctionCalls
                                    const extractedToolCalls = this.parseXmlWrappedFunctionCalls(response);
                                    if (extractedToolCalls.length > 0) {
                                        const toolCall = extractedToolCalls[0];
                                        const functionName = toolCall.function?.name || 'unknown';
                                        // Parse arguments if it's a string, otherwise use as-is
                                        let toolArgs = toolCall.function?.arguments || {};
                                        if (typeof toolArgs === 'string') {
                                            try {
                                                toolArgs = JSON.parse(toolArgs);
                                            } catch (e) {
                                                // If parsing fails, keep as string
                                            }
                                        }
                                        console.warn(`🔧 Extracted tool call "${functionName}" with parameters:`, typeof toolArgs === 'object' && toolArgs !== null ? Object.keys(toolArgs) : 'N/A');
                                        
                                        // If there are tool loops left, let the tool handler process it
                                        // This overrides toolingComplete status
                                        if (maxLoops > 0) {
                                            console.warn(`🔧 Tool call detected with ${maxLoops} loop(s) remaining - letting tool handler process it`);
                                            throw new Error(`Tool call "${functionName}" detected - should be processed by tool handler, not parsed as structured response. Retrying...`);
                                        } else {
                                            throw new Error(`Tool call "${functionName}" detected but no tool loops remaining. This should not happen.`);
                                        }
                                    } else {
                                        console.warn(`⚠️ Detected xAI function call wrapper but could not extract tool call information`);
                                        throw new Error(`Tool call wrapper detected but extraction failed. Retrying...`);
                                    }
                                } else {
                                    // For structured output expectations, retry instead of falling back
                                    throw new Error(`JSON parsing failed for structured response: ${parseError.message}`);
                                }
                            }
                        } else {
                            // Fallback to normal text
                            parsedResponse = response;
                            console.log('✅ Fallback to normal text response');
                        }
                    } else {
                        parsedResponse = response || { error: 'Empty response from SI' };
                    }

                    const streamDuration = Date.now() - streamStartTime;
                    this.globalResources.getLogger().detailed(`✅ Streaming completed: ${fullResponse.length} chars in ${Math.round(streamDuration/1000)}s`);

                    // Determine if response is structured based on responseSchema and tooling state
                    const isStructured = (options?.responseSchema !== null && options?.responseSchema !== undefined) ||
                                        (toolingComplete && typeof options?.responseSchema === 'object' && options?.responseSchema._def);

                    // Accumulate usage data from this API call
                    // IMPORTANT: When using stateful continuation (previous_response_id), the API returns CUMULATIVE usage
                    // that includes all previous tokens. So we REPLACE instead of accumulate to avoid double-counting.
                    // When NOT using stateful continuation, we accumulate normally.
                    const currentUsageData = completionObject?.usage || null;
                    let finalUsageData = null;
                    
                    if (currentUsageData) {
                        const promptDetails = currentUsageData.prompt_tokens_details || currentUsageData.input_tokens_details || null;
                        const completionDetails = currentUsageData.completion_tokens_details || currentUsageData.output_tokens_details || null;
                        
                        // Check if we're using stateful continuation (previous_response_id is set for non-first iterations)
                        const isStateful = lastResponseId && maxLoops < initialMaxLoops;
                        
                        if (isStateful) {
                            // Stateful continuation: API provides cumulative totals, so REPLACE not accumulate
                            totalUsageData = {
                                total: currentUsageData.total_tokens || 0,
                                input: currentUsageData.prompt_tokens || currentUsageData.input_tokens || 0,
                                output: currentUsageData.completion_tokens || currentUsageData.output_tokens || 0,
                                cache: promptDetails?.cached_tokens || 0,
                                reasoning: completionDetails?.reasoning_tokens || 0
                            };
                            finalUsageData = totalUsageData;
                        } else {
                            // Non-stateful: accumulate normally (first iteration or no previous_response_id)
                            if (!totalUsageData) {
                                totalUsageData = {
                                    total: 0,
                                    input: 0,
                                    output: 0,
                                    cache: 0,
                                    reasoning: 0
                                };
                            }
                            totalUsageData.total += currentUsageData.total_tokens || 0;
                            totalUsageData.input += currentUsageData.prompt_tokens || currentUsageData.input_tokens || 0;
                            totalUsageData.output += currentUsageData.completion_tokens || currentUsageData.output_tokens || 0;
                            totalUsageData.cache += promptDetails?.cached_tokens || 0;
                            totalUsageData.reasoning += completionDetails?.reasoning_tokens || 0;
                            finalUsageData = totalUsageData;
                        }
                    } else if (totalUsageData) {
                        // Use accumulated totalUsageData even if current call has no usage
                        finalUsageData = totalUsageData;
                    }
                    
                    // Log cumulative usage summary (individual calls were already logged after each stream ended)
                    if (finalUsageData) {
                        const totalTokens = finalUsageData.total || 0;
                        const inputTokens = finalUsageData.input || 0;
                        const outputTokens = finalUsageData.output || 0;
                        this.globalResources.getLogger().detailed(`💾 [Director SI Structured] Cumulative token usage: ${totalTokens} total (${inputTokens} input, ${outputTokens} output)`);
                    }
                    
                    // NOTE: This only runs on final structured responses, not on tool call responses
                    // Tool calls return early and never reach this point
                    if (parsedResponse?.text_replacements) {
                        const buildOptionsForHydration = getBuildOptions();
                        if (buildOptionsForHydration) {
                        const { hydrateTextReplacements } = require('../promptSegments');
                            const hydrationResult = hydrateTextReplacements(parsedResponse.text_replacements, buildOptionsForHydration);
                        if (hydrationResult) {
                            Object.assign(parsedResponse.text_replacements, hydrationResult.replacements);
                            parsedResponse.text_replacements._hydrationMetadata = hydrationResult.metadata;
                            }
                        }
                    }
                    
                    // Send data back via Kaze mailboxes instead of returning in response object
                    // This avoids messy merging in stage 1 and stage 2
                    lastResponseId = responseId || lastResponseId;

                    sendDataViaMailboxes({
                        publishedAnalysis: publishedAnalysis,
                        replacementPlan: replacementPlan,
                        usage: finalUsageData,
                        apiCalls: apiCalls,
                        responseId: lastResponseId,
                        chainRejected: options.chainRejected === true
                    });
                    
                    return {
                        content: parsedResponse,
                        message: parsedResponse,
                        rawContent: response,
                        citations: citations,
                        isStructured: isStructured,
                        responseId: lastResponseId || null
                    };
                }
            } catch (streamError) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    console.error(`❌ Streaming failed after ${maxRetries} attempts:`, streamError.message);
                    throw new Error(`Streaming failed after ${maxRetries} retries: ${streamError.message}`);
                } else {
                    console.warn(`⚠️ Streaming attempt ${retryCount} failed, retrying:`, streamError.message);
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
        
        // Check if we should continue the outer loop or throw an error
        if (toolCallsExecuted) {
            // Tools were executed, continue to next iteration of outer loop
            this.globalResources.getLogger().verbose(`🔄 Returning to outer loop for next API call`);
            
            // Check if we're about to run out of loops
            if (maxLoops === 0) {
                this.globalResources.getLogger().normal(`⚠️ Max tool loops reached - forcing final output`);
                // Force tooling complete to disable tools and enable structured output
                toolingComplete = true;
                useTools = false;
                maxLoops = 1; // Allow one more iteration for final structured output
            }
            
            continue;
        } else {
            // Retry loop completed without success and no tools were executed
            throw new Error("Streaming failed after all retries");
        }
        }

        // If we exit the while loop naturally (maxLoops reached 0 without tool calls)
        // This shouldn't happen in normal operation, but handle it gracefully
        this.globalResources.getLogger().normal(`⚠️ Max tool loops reached without completing`);
        throw new Error("Max tool calling loops reached without completing");
    } catch (error) {
        console.error('❌ Error calling Director SI with structured output:', error);
        throw error;
    }
}

/**
 * Director-specific SI function using Chat Completions API
 * This is a duplicate created for the director system to avoid breaking the migrated system
 * Uses grok.chat.completions.create() instead of grok.responses.create()
 * MIGRATE-ENSHUTSUKA-MCP: API-billed Director completion. Removable when Enshutsuka
 * requests run from grok.com (consumer client) via the public MCP connector.
 */
    async callDirectorAIWithCompletion(messages, options = {}, onStreamUpdate = null) {
        try {
        let maxLoops = options?.toolLoops || 5; // Prevent infinite loops
        const initialMaxLoops = maxLoops; // Track initial value to determine first iteration
        let toolingComplete = false; // Track if completeTooling was called
        let useTools = options?.tools && options.tools.length > 0; // Track whether to use tools
        let conversationMessages = [...messages]; // Track conversation history
        let totalUsageData = null; // Track cumulative usage across all API calls

        while (maxLoops > 0) {
            // Determine response format based on responseSchema parameter and tools presence
            let responseFormat = null;
            const hasTools = useTools && !toolingComplete; // Only use tools if tooling not complete
            const isFirstIteration = maxLoops === initialMaxLoops; // Check if this is the first iteration
            
            if (options?.responseSchema === null || options?.responseSchema === undefined) {
                // No schema provided - use normal text response
                responseFormat = null;
            } else if (typeof options?.responseSchema === 'string') {
                // String format provided (e.g., "json_object")
                responseFormat = { type: options?.responseSchema };
            } else if (typeof options?.responseSchema === 'object' && options?.responseSchema._def) {
                // Zod schema provided - use structured output
                if (hasTools) {
                    // Tools present: DON'T use response_format
                    // Let SI call tools freely without structured output constraints
                    responseFormat = null;
                    this.globalResources.getLogger().verbose('🔧 Tools active - structured output disabled until tooling complete');
                } else {
                    // No tools or tooling complete: use normal response_format
                    responseFormat = zodResponseFormat(options?.responseSchema, "response");
                }
            } else {
                // Fallback to normal text if invalid schema type
                console.warn('⚠️ Invalid responseSchema type, falling back to normal text response');
                responseFormat = null;
            }
            
            let apiConfig = {
                model: options?.model || this.getDefaultGrokModel(), 
                messages: conversationMessages,
                max_tokens: options?.max_completion_tokens || options?.max_tokens || 8000,
                temperature: options.temperature,
                timeout: options?.timeout || 60000,
                stream: options?.stream || this.globalResources.getConfig()?.chat_streaming_enabled || false,
                tools: hasTools ? options?.tools : undefined,
                tool_choice: hasTools ? (options?.tool_choice || (isFirstIteration ? "required" : "auto")) : undefined
            };
            
            // Add response_format if provided
            if (responseFormat) {
                apiConfig.response_format = responseFormat;
            }

            // Summarized console output
            const iteration = initialMaxLoops - maxLoops + 1;
            this.globalResources.getLogger().detailed(`🎯 Director SI (Completions): ${apiConfig.model} | Iter ${iteration}/${initialMaxLoops} | ${apiConfig.messages?.length || 0} msgs | ${apiConfig.tools ? apiConfig.tools.length : 0} tools`);
            
            // Detailed file logging
            const logRequestId = options.buildOptions?._requestId || options.requestId || 'unknown';
            
            this.globalResources.getLogger().logGeneration('DIRECTOR_AI_CALL', {
                model: apiConfig.model,
                iteration: iteration,
                maxIterations: initialMaxLoops,
                messageCount: apiConfig.messages?.length || 0,
                toolCount: apiConfig.tools ? apiConfig.tools.length : 0,
                usage: null // Usage data will be added after API call completes
            }, logRequestId);

            // Initialize progress tracking variables
            const totalKeys = options?.totalKeys || 0;
            let currentKeyIndex = 0;
            let startedKeys = new Set();

            // Retry up to 3 times before giving up
            let retryCount = 0;
            const maxRetries = 3;
            let toolCallsExecuted = false;

            while (retryCount < maxRetries) {
                try {
                    this.globalResources.getLogger().detailed(`🎯 API call (attempt ${retryCount + 1}/${maxRetries})...`);
                    const streamStartTime = Date.now();
                    const stream = await this.globalResources.guardServiceCall('grok', () => this.globalResources.getGrokClient().chat.completions.create(apiConfig));
                    let fullResponse = '';
                    let toolCalls = [];
                    let toolCallsMap = {}; // Track partial tool calls during streaming

                    // Send initial streaming start signal
                    if (options.ws && options.handler) {
                        options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                            phase: 'streaming',
                            currentKey: totalKeys > 0 ? 0 : undefined,
                            totalKeys: totalKeys > 0 ? totalKeys : undefined
                        });
                    }

                    // Real-time JSON parsing using clarinet
                    const extractKeys = options?.extractKeys;
                    currentKeyIndex = 0;
                    startedKeys.clear();

                    function shouldExtractKey(fullPath) {
                        if (!extractKeys) return true;
                        const patterns = Array.isArray(extractKeys) ? extractKeys : [extractKeys];
                        return patterns.some(pattern => {
                            let regexPattern = pattern
                                .replace(/\[\*\]\./g, '.')
                                .replace(/\*/g, '.*');
                            const arrayRegexPattern = pattern
                                .replace(/\[\*\]/g, '\\[\\d+\\]')
                                .replace(/\*/g, '.*');
                            const regex1 = new RegExp(`^${regexPattern}$`);
                            const regex2 = new RegExp(`^${arrayRegexPattern}$`);
                            return regex1.test(fullPath) || regex2.test(fullPath);
                        });
                    }

                    let seenKeys = new Set();
                    let extractedKeysInChunk = [];
                    const jsonParser = clarinet.createStream();
                    const path = [];

                    // Set up clarinet event handlers
                    jsonParser.on('openobject', (key) => {
                        if (key !== undefined) {
                            path.push(key);
                            const fullPath = path.join('.');
                            const eventKey = `${fullPath}:object`;
                            if (!seenKeys.has(eventKey) && shouldExtractKey(fullPath)) {
                                seenKeys.add(eventKey);
                                extractedKeysInChunk.push({ path: fullPath, value: 'object', type: 'openobject' });
                                if (totalKeys > 0 && path.length === 1 && !startedKeys.has(key)) {
                                    startedKeys.add(key);
                                    currentKeyIndex = Math.min(currentKeyIndex + 1, totalKeys);
                                    if (options.ws && options.handler) {
                                        options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                                            phase: 'streaming',
                                            currentKey: currentKeyIndex,
                                            totalKeys: totalKeys,
                                            reasoning: `Processing ${key}...`
                                        });
                                    }
                                }
                            }
                        }
                    });

                    jsonParser.on('key', (key) => {
                        if (!isNaN(key)) {
                            path.push(`[${key}]`);
                        } else {
                            path.push(key);
                        }
                    });

                    jsonParser.on('value', (value) => {
                        const fullPath = path.join('.');
                        const eventKey = `${fullPath}:${JSON.stringify(value)}`;
                        if (!seenKeys.has(eventKey) && shouldExtractKey(fullPath)) {
                            seenKeys.add(eventKey);
                            extractedKeysInChunk.push({ path: fullPath, value: value, type: 'value' });
                            if (fullPath.endsWith('.reason') || fullPath.endsWith('.reason_display')) {
                                if (options.ws && options.handler && typeof value === 'string') {
                                    options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                                        phase: 'streaming',
                                        currentKey: currentKeyIndex,
                                        totalKeys: totalKeys,
                                        reasoning: value
                                    });
                                }
                            }
                        }
                        path.pop();
                    });

                    jsonParser.on('openarray', () => {
                        const fullPath = path.join('.');
                        const eventKey = `${fullPath}:array`;
                        if (!seenKeys.has(eventKey) && shouldExtractKey(fullPath)) {
                            seenKeys.add(eventKey);
                            extractedKeysInChunk.push({ path: fullPath, value: 'array', type: 'openarray' });
                        }
                    });

                    jsonParser.on('closeobject', () => {
                        if (path.length > 0) path.pop();
                    });

                    jsonParser.on('closearray', () => {
                        if (path.length > 0) path.pop();
                    });

                    jsonParser.on('end', () => {
                        this.globalResources.getLogger().verbose(`\n🏁 Complete JSON received (${seenKeys.size} elements)`);
                    });

                    jsonParser.on('error', (error) => {
                        // Clarinet handles incomplete JSON gracefully
                    });

                    // Process streaming chunks - Chat Completions API format
                    let usageData = null;
                    for await (const chunk of stream) {
                        // Capture usage data if available (typically in final chunk)
                        if (chunk.usage) {
                            usageData = chunk.usage;
                        }
                        
                        const delta = chunk.choices?.[0]?.delta;
                        if (!delta) continue;

                        // Handle text content
                        if (delta.content) {
                            fullResponse += delta.content;
                            extractedKeysInChunk = [];
                            jsonParser.write(delta.content);
                            if (onStreamUpdate) {
                                onStreamUpdate(delta.content, fullResponse, extractedKeysInChunk);
                            }
                        }

                        // Handle tool calls
                        if (delta.tool_calls) {
                            for (const toolCallDelta of delta.tool_calls) {
                                const index = toolCallDelta.index;
                                if (!toolCallsMap[index]) {
                                    toolCallsMap[index] = {
                                        id: toolCallDelta.id || '',
                                        type: 'function',
                                        function: {
                                            name: toolCallDelta.function?.name || '',
                                            arguments: toolCallDelta.function?.arguments || ''
                                        }
                                    };
                                } else {
                                    if (toolCallDelta.id) toolCallsMap[index].id = toolCallDelta.id;
                                    if (toolCallDelta.function?.name) toolCallsMap[index].function.name = toolCallDelta.function.name;
                                    if (toolCallDelta.function?.arguments) toolCallsMap[index].function.arguments += toolCallDelta.function.arguments;
                                }
                            }
                        }
                    }

                    jsonParser.end();

                    // Log usage data immediately after stream ends (for ALL API calls, including tool iterations)
                    const logRequestId = options.buildOptions?._requestId || options.requestId || 'unknown';
                    if (usageData) {

                        // Handle both naming conventions: input_tokens/output_tokens (actual API) or prompt_tokens/completion_tokens (docs)
                        // Extract prompt/input tokens
                        const promptTokens = usageData.prompt_tokens || usageData.input_tokens || 0;
                        const completionTokens = usageData.completion_tokens || usageData.output_tokens || 0;
                        
                        // Extract details - check both naming conventions
                        const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
                        const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
                        
                        const totalTokens = usageData.total_tokens || 0;
                        const cachedTokens = promptDetails?.cached_tokens || 0;
                        const reasoningTokens = completionDetails?.reasoning_tokens || 0;
                        
                        this.globalResources.getLogger().logGeneration('AI_API_USAGE', {
                            iteration: initialMaxLoops - maxLoops + 1,
                            apiCallType: 'api_call',
                            total: totalTokens,
                            input: promptTokens,
                            output: completionTokens,
                            cache: cachedTokens,
                            reasoning: reasoningTokens,
                            prompt_tokens_details: promptDetails,
                            completion_tokens_details: completionDetails,
                            num_sources_used: usageData.num_sources_used || 0,
                            pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK')
                        }, logRequestId);
                    } else {
                        // Log warning if no usage data found (only in verbose mode)
                        if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                            this.globalResources.getLogger().detailed(`⚠️ No usage data found after stream end for iteration ${initialMaxLoops - maxLoops + 1} (Chat Completions API)`);
                        }
                    }

                    // Convert toolCallsMap to array
                    if (Object.keys(toolCallsMap).length > 0) {
                        toolCalls = Object.values(toolCallsMap);
                    }

                    // Check for tool calls
                    if (toolCalls && toolCalls.length > 0) {
                        this.globalResources.getLogger().detailed(`🔧 Processing ${toolCalls.length} tool call(s)`);
                        
                        // Log raw SI response before tool execution
                        const completionLogRequestId = options.buildOptions?._requestId || options.requestId || 'unknown';
                        const completionIteration = initialMaxLoops - maxLoops + 1;
                        this.globalResources.getLogger().logGeneration('AI_MESSAGES_RESPONSE', {
                            model: apiConfig.model,
                            iteration: completionIteration,
                            maxLoops: initialMaxLoops,
                            hasTools: !!apiConfig.tools,
                            isStateful: false, // Chat Completions API doesn't support stateful
                            responseLength: fullResponse ? fullResponse.length : 0,
                            toolCallCount: toolCalls.length,
                            responseId: null, // Chat Completions API doesn't use response IDs
                            fullResponse: fullResponse || '',
                            completionObject: null // Not available in Chat Completions API format
                        }, completionLogRequestId);
                        
                        // Add assistant message with tool calls to conversation
                        conversationMessages.push({
                            role: 'assistant',
                            content: fullResponse || null,
                            tool_calls: toolCalls
                        });

                        // Execute tools and add results
                        let autoCompletePayload = null;
                        for (const toolCall of toolCalls) {
                            const toolStartTime = Date.now();
                            
                            // Send tool execution start progress update
                            if (options.ws && options.handler) {
                                const toolArgs = typeof toolCall.function.arguments === 'string' ? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments;
                                let toolReason = toolArgs.reason || toolArgs.query || `Executing ${toolCall.function.name}`;
                                
                                if (toolCall.function.name === 'searchTagsBatch' && toolArgs.tags && Array.isArray(toolArgs.tags)) {
                                    const tagsList = toolArgs.tags.map(t => t.name);
                                    if (tagsList.length > 7) {
                                        toolReason = `🔍 ${tagsList.slice(0, 7).join(', ')}... (+${tagsList.length - 7} more)`;
                                    } else {
                                        toolReason = `🔍 ${tagsList.join(', ')}`;
                                    }
                                }
                                
                                options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                                    phase: 'tool_execution',
                                    reasoning: toolReason
                                });
                            }

                            // Get attemptId from options or buildOptions for this function
                            const attemptId = options._attemptId;
                            if (!attemptId) {
                                throw new Error('executeTool requires attemptId');
                            }
                            const toolResult = await this.executeTool(toolCall, attemptId, {
                                ws: options.ws,
                                handler: options.handler,
                                requestId: options.requestId
                            });

                            const toolDuration = Date.now() - toolStartTime;
                            this.globalResources.getLogger().detailed(`   ⏱️ Tool completed in ${toolDuration}ms`);

                            if (toolResult && toolResult.autoComplete === true && toolResult.finalOutput) {
                                this.globalResources.getLogger().normal(`🎯 Auto-complete triggered`);
                                this.globalResources.getLogger().logGeneration('AI_AUTO_COMPLETE', {
                                    tool: toolCall.function.name,
                                    finalOutput: toolResult.finalOutput
                                }, completionLogRequestId);
                                
                                autoCompletePayload = {
                                    finalOutput: toolResult.finalOutput,
                                    toolName: toolCall.function.name
                                };
                                break;
                            }

                            // Add tool result to conversation
                            conversationMessages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(toolResult)
                            });

                            if (toolCall.function.name === 'completeTooling') {
                                toolingComplete = true;
                                console.log(`✅ TOOLING COMPLETE - Next iteration will provide structured response`);
                            }
                        }

                        if (autoCompletePayload) {
                            if (usageData) {
                                totalUsageData = this.accumulateUsageTotals(usageData, totalUsageData);
                            }
                            const finalUsageData = totalUsageData || null;

                            return {
                                content: autoCompletePayload.finalOutput,
                                message: autoCompletePayload.finalOutput,
                                autoCompleted: true,
                                completedByTool: autoCompletePayload.toolName,
                                usage: finalUsageData
                            };
                        }

                        // Accumulate usage data from this API call before continuing
                        // Note: Usage was already logged right after stream ended, so we just accumulate here
                        totalUsageData = this.accumulateUsageTotals(usageData, totalUsageData);
                        
                        toolCallsExecuted = true;
                        break; // Exit retry loop, continue outer loop
                    } else {
                        // No tool calls - return the response
                        const duration = Date.now() - streamStartTime;
                        this.globalResources.getLogger().detailed(`✅ SI request completed in ${Math.round(duration/1000)}s`);
                        
                        // Accumulate usage data (usage was already logged right after stream ended)
                        // Handle both naming conventions: input_tokens/output_tokens (actual API) or prompt_tokens/completion_tokens (docs)
                        let finalUsageData = null;
                        
                        if (usageData) {
                            totalUsageData = this.accumulateUsageTotals(usageData, totalUsageData);
                            finalUsageData = totalUsageData;
                        } else if (totalUsageData) {
                            // Use accumulated totalUsageData even if current call has no usage
                            finalUsageData = totalUsageData;
                        }
                        
                        // Log cumulative usage summary
                        if (finalUsageData) {
                            const totalTokens = finalUsageData.total || 0;
                            const inputTokens = finalUsageData.input || 0;
                            const outputTokens = finalUsageData.output || 0;
                            this.globalResources.getLogger().detailed(`💾 [Director SI] Cumulative token usage: ${totalTokens} total (${inputTokens} input, ${outputTokens} output)`);
                        }
                        
                        return {
                            content: fullResponse,
                            message: fullResponse,
                            usage: finalUsageData || null
                        };
                    }
                } catch (error) {
                    retryCount++;
                    console.error(`❌ Error on attempt ${retryCount}/${maxRetries}:`, error.message);
                    
                    if (retryCount >= maxRetries) {
                        throw error;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }

            if (toolCallsExecuted) {
                maxLoops--;
                toolCallsExecuted = false;
                
                if (maxLoops === 0) {
                    this.globalResources.getLogger().normal(`⚠️ Max tool loops reached - forcing final output`);
                    toolingComplete = true;
                    useTools = false;
                    maxLoops = 1;
                }
                
                continue;
            } else {
                throw new Error("Streaming failed after all retries");
            }
        }

        this.globalResources.getLogger().normal(`⚠️ Max tool loops reached without completing`);
        throw new Error("Max tool calling loops reached without completing");
    } catch (error) {
        console.error('❌ Error calling Director SI with completion:', error);
        throw error;
    }
    }
}

module.exports = GrokService;