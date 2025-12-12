const { zodResponseFormat } = require("openai/helpers/zod");
const { z } = require('zod');
const clarinet = require('clarinet');
const sharp = require('sharp');
const { createDynamicGenerationResponseSchema } = require('../dynamicGenerationSchema');

/**
 * GrokService class - handles all Grok AI service interactions
 */
class GrokService {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('GrokService requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
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
        model: sessionData.model || "grok-4-fast-reasoning",
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
            model: chat.model || "grok-4-fast-reasoning",
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

        const completion = await this.globalResources.getGrokClient().responses.create(apiConfig);

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
                throw new Error('Invalid response format from AI');
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
        throw new Error("The AI could not establish the persona. Please check the console for details.");
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
            model: chat.model || "grok-4-fast-reasoning",
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

        const completion = await this.globalResources.getGrokClient().responses.create(apiConfig);

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
                throw new Error('Invalid response format from AI');
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
        throw new Error("The AI could not generate a response. Please check the console for details.");
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
            model: chat.model || "grok-4-fast-reasoning",
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

        const completion = await this.globalResources.getGrokClient().responses.create(apiConfig);

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
                throw new Error('Invalid response format from AI');
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
        throw new Error("The AI could not generate a response. Please check the console for details.");
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
            model: chat.model || "grok-4-fast-reasoning",
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

        const completion = await this.globalResources.getGrokClient().responses.create(apiConfig);

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
                throw new Error('Invalid response format from AI');
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
        throw new Error("The AI could not establish the persona. Please check the console for details.");
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
            model: chat.model || "grok-4-fast-reasoning",
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

        const completion = await this.globalResources.getGrokClient().responses.create(apiConfig);

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
                throw new Error('Invalid response format from AI');
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
        throw new Error("The AI could not generate a response. Please check the console for details.");
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
            model: chat.model || "grok-4-fast-reasoning",
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

        const completion = await this.globalResources.getGrokClient().responses.create(apiConfig);

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
                throw new Error('Invalid response format from AI');
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
        throw new Error("The AI could not generate a response. Please check the console for details.");
    }
}

/**
 * Get all available tool definitions for AI calls
 * @returns {Array<Object>} Array of all tool definitions
 */
// Utility function to escape regex special characters
    escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format tool result header with progress information
 * @param {Object} params - Header parameters
 * @param {number} params.toolNumber - Current tool call number
 * @param {number} params.totalTools - Total tool calls in this iteration
 * @param {number} params.totalTokens - Total tokens used so far
 * @param {number} params.maxTokens - Maximum tokens (default: 128000)
 * @param {Object} params.phaseStatus - Phase completion status
 * @param {string} params.currentTask - Current task description
 * @param {Date} params.timestamp - Current timestamp
 * @returns {string} Formatted header string
 */
    formatToolResultHeader({ toolNumber, totalTools, resultPage, totalResultPages, totalTokens, maxTokens = 128000, phaseStatus, toolName, toolsCalledSoFar = [], maxToolCalls = 8, publishedAnalysis = null, dynamicConfig = {}, context = null, timestamp }) {
    // Calculate token usage - show remaining percentage instead of used
    const tokenPercent = ((totalTokens || 0) / maxTokens * 100).toFixed(0);
    const remainingPercent = Math.max(0, 100 - parseFloat(tokenPercent)).toFixed(0);
    const tokenUsagePercent = `${remainingPercent}%`;
    
    // Map tool names to page descriptions (single source of truth)
    const toolNameToDescription = {
        'publishAnalysisResults': 'Image Analysis',
        'planTextReplacements': 'Implementation Plan',
        'validateTextReplacement': 'Rentan: Validate Tanei',
        'validateSegmentSyntax': 'Rentan: Validate Tanei (Syntax)',
        'searchTagDatabase': 'Research Tags',
        'searchTagsBatch': 'Research Tags',
        'getTagDetails': 'Tag Details',
        'resolveTagLinks': 'Tag Relationships',
        'searchByDescription': 'Research Tags (Description)',
        'getBodyChunk': 'Read Wiki Document',
        'getDatasetGroupContents': 'Read Dataset Group',
        'file_search': 'Research Tags',
        'web_search': 'Web Search',
        'webSearch': 'Web Search',
        'x_search': 'Search SNS (X)',
        'fetchUrl': 'Get URL Content',
        'fetchImage': 'Get Image',
        'saveKnowledgeMemory': 'Save Knowledge',
        'retrieveKnowledgeMemory': 'Examin Memories',
        'searchKnowledgeMemories': 'Search for Memories',
        'analyzeTokenCount': 'Analyze Tokens',
        'completeTooling': 'Complete Tooling',
        'rejectChain': 'Reject Chain'
    };
    
    // Calculate max page description length for column width calculation
    // This ensures the column adapts as tool name mappings change
    const allDescriptions = Object.values(toolNameToDescription);
    const maxPageDescriptionLength = Math.max(...allDescriptions.map(d => d.length));
    
    // Determine "what this page is" - description of current tool result
    const pageDescription = toolNameToDescription[toolName] || toolName;
    
    // Extract formatted context data (already formatted in context object)
    let dateStr = '';
    let timeStr = '';
    let periodName = '';
    let seasonName = '';
    let weatherDisplay = '';
    
    if (context) {
        // Date: short month and day (from context.time)
        if (context.time) {
            const t = context.time;
            // Use monthName from context (already available)
            dateStr = `${t.monthName ? t.monthName.substring(0, 3) : ''} ${t.dayOfMonth || ''}`.trim();
            // Time: hh:MM PM/AM (from context.time)
            const hour = t.hour || 0;
            const minute = t.minute || 0;
            const displayHour = hour % 12 || 12;
            timeStr = `${String(displayHour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${t.am_pm || (hour >= 12 ? 'PM' : 'AM')}`;
        }
        
        // Period name (already in context.timePeriod)
        if (context.timePeriod) {
            // timePeriod can be a string or an object - handle both
            periodName = typeof context.timePeriod === 'string' ? context.timePeriod : (context.timePeriod.period || context.timePeriod.periodKey || '');
        }
        
        // Season (already in context.season.name)
        if (context.season?.name) {
            seasonName = context.season.name;
        }
        
        // Weather: temp - condition (condition should already be normalized from compileContext)
        if (context.weather) {
            const w = context.weather;
            const temp = w.temperature !== undefined ? `${w.temperature}°C` : '';
            // Condition should already be normalized - use it directly
            const condition = w.condition || '';
            
            if (temp && condition) {
                weatherDisplay = `${temp} - ${condition}`;
            } else if (temp) {
                weatherDisplay = temp;
            } else if (condition) {
                weatherDisplay = condition;
            }
        }
    }
    
    // Determine contextual current task
    let currentPlan = '---';
    const toolsCalledCount = toolsCalledSoFar.length;
    const toolCallPercentage = maxToolCalls > 0 ? (toolsCalledCount / maxToolCalls) * 100 : 0;
    const remainingCalls = Math.max(0, maxToolCalls - toolsCalledCount);
    
    if (!phaseStatus.analysis) {
        currentPlan = 'Analyse the prompt and context';
    } else if (phaseStatus.analysis && !phaseStatus.planning) {
        const previousTools = toolsCalledSoFar.slice(0, -1);
        const hasCalledResearch = previousTools.some(name => 
            ['searchTagDatabase', 'searchTagsBatch', 'getTagDetails', 'searchKnowledgeMemories', 'web_search', 'webSearch', 'file_search'].includes(name)
        );
        
        if (hasCalledResearch) {
            currentPlan = 'Research and Planning Integrations';
        } else if (toolCallPercentage >= 75) {
            currentPlan = 'Generate Plan for Tanei Package (Tsubo)';
        } else if (publishedAnalysis && publishedAnalysis.existing_context && context) {
            // Use same logic as buildCategoryRequirementNotes to determine required categories
            const ctx = publishedAnalysis.existing_context;
            const requiredCategories = [];
            
            // Check what's enabled in dynamicConfig (same as system message builder)
            const hasWeather = dynamicConfig.weather && dynamicConfig.weather !== '--' && dynamicConfig.weather !== null && dynamicConfig.weather !== false;
            const hasTime = dynamicConfig.tod && dynamicConfig.tod !== '--' && dynamicConfig.tod !== null && dynamicConfig.tod !== false;
            const hasSeason = dynamicConfig.season && dynamicConfig.season !== '--' && dynamicConfig.season !== null && dynamicConfig.season !== false;
            const hasDirective = dynamicConfig.directive && dynamicConfig.directive !== null && dynamicConfig.directive !== false;
            
            // Check holiday requirement (only required on day of or day before, same as system message builder)
            const holiday = context.season?.holiday;
            const hasHoliday = dynamicConfig.disable_holiday !== true && holiday && holiday.primaryHoliday && holiday.primaryHoliday.daysUntil <= 1;
            
            // Build required categories based on what's found AND enabled
            // Weather category
            if (ctx.weather_condition && ctx.weather_condition.found && hasWeather) {
                requiredCategories.push('Weather');
            }
            // Time of Day category
            if (ctx.time && ctx.time.found && hasTime) {
                requiredCategories.push('Time of Day');
            }
            // Seasonal category
            if (ctx.season && ctx.season.found && hasSeason) {
                requiredCategories.push('Seasonal');
            }
            // Holiday category (only if required)
            if (ctx.holiday && ctx.holiday.found && hasHoliday) {
                requiredCategories.push('Holiday');
            }
            // Directive category
            if (hasDirective) {
                requiredCategories.push('Directive');
            }
            
            if (requiredCategories.length > 0) {
                currentPlan = `Planning integrations: ${requiredCategories.join(', ')}`;
            } else {
                currentPlan = 'Planning integrations';
            }
        } else {
            currentPlan = 'Planning integrations';
        }
    } else if (phaseStatus.planning && !phaseStatus.execution) {
        if (remainingCalls <= 2) {
            currentPlan = 'Finalise (LOW TIME LEFT)';
        } else {
            currentPlan = 'Create, Finalise and Validate Tanei Package';
        }
    } else if (phaseStatus.execution && !phaseStatus.validation) {
        if (remainingCalls <= 2) {
            currentPlan = 'Finalise (LOW TIME LEFT)';
        } else {
            currentPlan = 'Finalise and Validate Tanei Package';
        }
    } else {
        currentPlan = 'Finalising';
    }
    
    // Build progress bar steps
    const phases = [
        { name: 'Analysis', key: 'analysis' },
        { name: 'Plan', key: 'planning' },
        { name: 'Execute', key: 'execution' },
        { name: 'Verify', key: 'validation' }
    ];
    
    // Determine active phase
    let activePhase = 'analysis';
    if (!phaseStatus.analysis) {
        activePhase = 'analysis';
    } else if (!phaseStatus.planning) {
        activePhase = 'planning';
    } else if (!phaseStatus.execution) {
        activePhase = 'execution';
    } else if (!phaseStatus.validation) {
        activePhase = 'validation';
    } else {
        activePhase = 'validation';
    }
    
    const stepParts = phases.map((phase) => {
        const isComplete = phaseStatus[phase.key];
        const isActive = phase.key === activePhase && !isComplete;
        
        if (isComplete) {
            return 'DONE';
        } else if (isActive) {
            return phase.name;
        } else {
            return '';
        }
    });
    
    // Calculate dynamic padding based on longest values
    const callStr = `Call ${toolNumber}/${totalTools}`;
    const pageStr = `Page ${resultPage}/${totalResultPages}`;
    
    // Define minimum column widths
    const minCol1Width = 10;
    const minCol2Width = 4; // Max is "100%" = 4 chars (3 digits + %)
    const minCol3Width = 10;
    // Calculate minCol4Width dynamically based on max page description length
    // This ensures the column adapts as tool name mappings change
    const minCol4Width = Math.max(15, maxPageDescriptionLength);
    
    const minCtxCol1Width = 8;
    const minCtxCol2Width = 8;
    const minCtxCol3Width = 10;
    const minCtxCol4Width = 8;
    const minCtxCol5Width = 25;
    
    const minStepColWidth = 8;
    
    // Calculate actual content widths needed (based on what actually goes in each column)
    const col1ContentWidth = callStr.length; // Column 1 only contains callStr
    const col2ContentWidth = tokenUsagePercent.length; // Column 2 only contains tokenUsagePercent
    const col3ContentWidth = pageStr.length; // Column 3 only contains pageStr
    const col4ContentWidth = pageDescription.length; // Column 4 only contains pageDescription
    
    const ctxCol1ContentWidth = dateStr.length;
    const ctxCol2ContentWidth = timeStr.length;
    const ctxCol3ContentWidth = periodName.length;
    const ctxCol4ContentWidth = seasonName.length;
    const ctxCol5ContentWidth = weatherDisplay.length;
    
    const maxStepLength = Math.max(...stepParts.map(s => s.length), 'Analysis'.length, 'Plan'.length, 'Execute'.length, 'Verify'.length, 'DONE'.length);
    const maxPlanLength = Math.max(currentPlan.length, 'Planning integrations of time, weather, season, holiday'.length);
    
    // Calculate column widths: max(minimum width, actual content width)
    // This ensures columns are at least the minimum width and expand for longer content
    const col1Width = Math.max(minCol1Width, col1ContentWidth);
    const col2Width = Math.max(minCol2Width, col2ContentWidth);
    const col3Width = Math.max(minCol3Width, col3ContentWidth);
    const col4Width = Math.max(minCol4Width, col4ContentWidth);
    
    const ctxCol1Width = Math.max(minCtxCol1Width, ctxCol1ContentWidth);
    const ctxCol2Width = Math.max(minCtxCol2Width, ctxCol2ContentWidth);
    const ctxCol3Width = Math.max(minCtxCol3Width, ctxCol3ContentWidth);
    const ctxCol4Width = Math.max(minCtxCol4Width, ctxCol4ContentWidth);
    const ctxCol5Width = Math.max(minCtxCol5Width, ctxCol5ContentWidth);
    
    const stepColWidth = Math.max(minStepColWidth, maxStepLength);
    const planColWidth = maxPlanLength;
    
    // Calculate padding object to store all calculations before applying
    const padding = {
        line1: {
            col1: col1Width,
            col2: col2Width,
            col3: col3Width,
            col4: col4Width,
            // Line 1 format: "| ${col1} | ${col2} | ${col3} | ${col4} |"
            // Separators: "| " (2) + " | " (3) + " | " (3) + " | " (3) + " |" (2) = 13 chars
            totalWidth: col1Width + col2Width + col3Width + col4Width + 13
        }
    };
    
    // Only show lines 2 and 3 on page 1
    if (resultPage === 1) {
        const hasContextData = dateStr || timeStr || periodName || seasonName || weatherDisplay;
        
        if (hasContextData) {
            // Line 2: date | time | period name | season | temp - weather condition
            padding.line2 = {
                col1: ctxCol1Width,
                col2: ctxCol2Width,
                col3: ctxCol3Width,
                col4: ctxCol4Width,
                col5: ctxCol5Width,
                // Line 2 format: "| ${col1} | ${col2} | ${col3} | ${col4} | ${col5} |"
                // Separators: "| " (2) + " | " (3) * 4 + " |" (2) = 16 chars
                totalWidth: ctxCol1Width + ctxCol2Width + ctxCol3Width + ctxCol4Width + ctxCol5Width + 16
            };
        }
        
        // Line 3: step | step | step | step | current plan ->
        padding.line3 = {
            col1: stepColWidth,
            col2: stepColWidth,
            col3: stepColWidth,
            col4: stepColWidth,
            col5: planColWidth,
            // Line 3 format: "| ${col1} | ${col2} | ${col3} | ${col4} | ${col5} |"
            // Separators: "| " (2) + " | " (3) * 4 + " |" (2) = 16 chars
            totalWidth: stepColWidth + stepColWidth + stepColWidth + stepColWidth + planColWidth + 16
        };
        
        // Find maximum total width across all lines
        const lineWidths = [padding.line1.totalWidth];
        if (padding.line2) lineWidths.push(padding.line2.totalWidth);
        if (padding.line3) lineWidths.push(padding.line3.totalWidth);
        const maxTotalWidth = Math.max(...lineWidths);
        
        // Calculate additional padding needed for each line to match max width
        const line1ExtraPadding = maxTotalWidth - padding.line1.totalWidth;
        const line2ExtraPadding = padding.line2 ? maxTotalWidth - padding.line2.totalWidth : 0;
        const line3ExtraPadding = padding.line3 ? maxTotalWidth - padding.line3.totalWidth : 0;
        
        // Distribute extra padding to the last column of each line
        padding.line1.col4 += line1ExtraPadding;
        if (padding.line2) padding.line2.col5 += line2ExtraPadding;
        if (padding.line3) padding.line3.col5 += line3ExtraPadding;
        
        // Build line 1 with adjusted padding
        // Center pageStr in its column
        const pageStrPadding = Math.max(0, padding.line1.col3 - pageStr.length);
        const pageStrLeftPad = Math.floor(pageStrPadding / 2);
        const pageStrRightPad = pageStrPadding - pageStrLeftPad;
        const centeredPageStr = ' '.repeat(pageStrLeftPad) + pageStr + ' '.repeat(pageStrRightPad);
        
        const line1 = `| ${callStr.padStart(padding.line1.col1)} | ${tokenUsagePercent.padEnd(padding.line1.col2)} | ${centeredPageStr} | ${pageDescription.padEnd(padding.line1.col4)} |`;
        
        // Build line 2 with adjusted padding (if context data exists)
        let line2 = '';
        if (padding.line2) {
            line2 = `| ${dateStr.padEnd(padding.line2.col1)} | ${timeStr.padEnd(padding.line2.col2)} | ${periodName.padEnd(padding.line2.col3)} | ${seasonName.padEnd(padding.line2.col4)} | ${weatherDisplay.padEnd(padding.line2.col5)} |\n`;
        }
        
        // Center the stage names in their columns for line 3 (using adjusted widths)
        const line3ColWidths = [padding.line3.col1, padding.line3.col2, padding.line3.col3, padding.line3.col4];
        const centeredStepParts = stepParts.map((step, index) => {
            const colWidth = line3ColWidths[index];
            if (!step) return ' '.repeat(colWidth); // Empty step = full width of spaces
            const stepPadding = Math.max(0, colWidth - step.length);
            const leftPad = Math.floor(stepPadding / 2);
            const rightPad = stepPadding - leftPad;
            return ' '.repeat(leftPad) + step + ' '.repeat(rightPad);
        });
        
        // Build line 3 with adjusted padding
        const line3 = `| ${centeredStepParts[0]} | ${centeredStepParts[1]} | ${centeredStepParts[2]} | ${centeredStepParts[3]} | ${`${currentPlan} ->`.padEnd(padding.line3.col5)} |`;
        
        return `\n${line1}\n${line2}${line3}\n\n`;
    } else {
        // For pages after page 1, only show line 1
        // Center pageStr in its column
        const pageStrPadding = Math.max(0, padding.line1.col3 - pageStr.length);
        const pageStrLeftPad = Math.floor(pageStrPadding / 2);
        const pageStrRightPad = pageStrPadding - pageStrLeftPad;
        const centeredPageStr = ' '.repeat(pageStrLeftPad) + pageStr + ' '.repeat(pageStrRightPad);
        
        const line1 = `| ${callStr.padStart(padding.line1.col1)} | ${tokenUsagePercent.padEnd(padding.line1.col2)} | ${centeredPageStr} | ${pageDescription.padEnd(padding.line1.col4)} |`;
        return `\n${line1}\n\n`;
    }
}

    getAllToolDefinitions(dynamicConfig = {}) {
    const tools = [];
    const dialogsCount = dynamicConfig.dialogs_count;
    const dialogsEnabled = dialogsCount != null ? dialogsCount > 0 : true;
    
    // Check if tag wiki collection is configured
    const grokConfig = this.globalResources.getSecureConfig({ path: 'grok' });
    const useCollectionSearch = grokConfig?.tagWikiCollectionId;
    const useWebSearch = grokConfig?.useWebSearch === true;

    // Conditionally include web search tools
    if (useWebSearch) {
        // Use Grok's built-in web search tools
        tools.push(
            {
                type: "web_search",
                _accepted_stages: ['planning', 'execution'],
                enable_image_understanding: true
            },
            {
                type: "x_search",
                _accepted_stages: ['planning', 'execution'],
                enable_image_understanding: true
            }
        );
    } else {
        // Use local web search tools (existing implementation)
        tools.push(
            {
                type: "function",
                name: "webSearch",
                _accepted_stages: ['planning', 'execution'],
                description: "Web search for current events/research not in tag database. CRITICAL: Interpret vague terms ('current', 'today', 'now') using context data (date/time/weather/location) - replace vague terms with specifics. Returns titles, URLs, summaries, optional full content.",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Natural search query. REPLACE vague terms with context specifics - don't include raw context. Examples: 'current top anime' + Nov 2025 → 'top anime November 2025' (NOT 'top anime DATE: Nov 4'). 'activities for this weather' + cloudy → 'activities cool cloudy weather'. Keep queries natural."
                        },
                        numResults: {
                            type: "number",
                            description: "Results count (default: 5, max: 10)",
                            default: 5,
                            minimum: 1,
                            maximum: 10
                        },
                        includeContents: {
                            type: "boolean",
                            description: "Include full webpage contents (default: false)",
                            default: false
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for search"
                        }
                    },
                    required: ["query", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "fetchUrl",
                _accepted_stages: ['planning', 'execution'],
                description: "Fetch/extract content from URL. Use for webpages, APIs, text data. Returns extracted text, headers, metadata. Supports HTML/JSON/XML/text.",
                parameters: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL to fetch content from"
                        },
                        extractText: {
                            type: "boolean",
                            description: "Extract/clean HTML text (default: true)",
                            default: true
                        },
                        includeRawContent: {
                            type: "boolean",
                            description: "Include raw response body (default: false)",
                            default: false
                        },
                        maxContentLength: {
                            type: "number",
                            description: "Max content length chars (default: 50000, max: 200000)",
                            default: 50000,
                            minimum: 1000,
                            maximum: 200000
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for fetch"
                        }
                    },
                    required: ["url", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "fetchImage",
                _accepted_stages: ['planning', 'execution'],
                description: "Fetch image from URL as base64. Use to analyze/reference web images. Returns data, dimensions, format, metadata. Supports JPEG/PNG/WebP.",
                parameters: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL of the image to fetch"
                        },
                        maxSize: {
                            type: "number",
                            description: "Max file size MB (default: 10, max: 50)",
                            default: 10,
                            minimum: 1,
                            maximum: 50
                        },
                        includeBase64: {
                            type: "boolean",
                            description: "Include base64 image data (default: true)",
                            default: true
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for fetch"
                        }
                    },
                    required: ["url", "reason"]
                },
                strict: true
            }
        );
    }
    // Conditionally include tag lookup tools based on collection config
    if (useCollectionSearch) {
        // Use Grok collections-search-tool instead of local tag lookup tools
        tools.push({
            type: "file_search",
            _accepted_stages: ['planning', 'execution'],
            vector_store_ids: [this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })],
            max_num_results: 10
        });
    } else {
        // Use local tag lookup tools (existing implementation)
        tools.push(
            {
                type: "function",
                name: "searchTagsBatch",
                _accepted_stages: ['planning', 'execution'],
                description: "Search multiple tags with individual params per tag. Use for batch research. NOT for single tags - use getTagDetails. Returns structured results per tag in a table format with columns: Tag, Danbooru Count, E621 Count, Training Confidence, Category, Has Wiki?. Includes body previews for top results by default.",
                parameters: {
                    type: "object",
                    properties: {
                        tags: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Tag name to search for"
                                    },
                                    returnFields: {
                                        type: "array",
                                        items: {
                                            type: "string",
                                            enum: ["title", "body", "category", "usage", "linksTo", "linkedBy", "otherNames", "id", "counts"]
                                        },
                                        description: "Fields to return. Omit = title + usage only"
                                    },
                                    resolveLinks: {
                                        type: "boolean",
                                        description: "Resolve linked tags (default: false)",
                                        default: false
                                    },
                                    limit: {
                                        type: "number",
                                        description: "Max results (default: 30)",
                                        default: 30
                                    },
                                    category: {
                                        type: "number",
                                        description: "Filter by category ID (optional)"
                                    },
                                    minUseCount: {
                                        type: "number",
                                        description: "Minimum usage count filter (optional)"
                                    },
                                    includeGroups: {
                                        type: "boolean",
                                        description: "Include tag group results (default: true)",
                                        default: true
                                    },
                                    searchWikiBody: {
                                        type: "boolean",
                                        description: "Also search wiki body contents for matches (default: false). When enabled, searches tag wiki bodies in addition to tag names.",
                                        default: false
                                    },
                                    reason: {
                                        type: "string",
                                        description: "Brief reason for search"
                                    }
                                },
                                required: ["name", "reason"]
                            },
                            description: "Array of tag search specifications, each with its own parameters"
                        }
                    },
                    required: ["tags"]
                },
                strict: true
            },
            {
                type: "function",
                name: "getTagDetails",
                _accepted_stages: ['planning', 'execution'],
                description: "Get tag details with field filtering. Use for single tags or full info. Returns complete tag objects in a table format with columns: Tag, Danbooru Count, E621 Count, Training Confidence, Category, Has Wiki?. Includes body previews by default. NOT for bulk - use searchTagsBatch.",
                parameters: {
                    type: "object",
                    properties: {
                        tags: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Tag name to get details for"
                                    },
                                    returnFields: {
                                        type: "array",
                                        items: {
                                            type: "string",
                                            enum: ["title", "body", "category", "usage", "linksTo", "linkedBy", "otherNames", "id", "counts"]
                                        },
                                        description: "Fields to return. Omit = all fields"
                                    },
                                    reason: {
                                        type: "string",
                                        description: "Brief reason for retrieval"
                                    }
                                },
                                required: ["name", "reason"]
                            },
                            description: "Array of tag detail requests"
                        }
                    },
                    required: ["tags"]
                },
                strict: true
            },
            {
                type: "function",
                name: "resolveTagLinks",
                _accepted_stages: ['planning', 'execution'],
                description: "Explore tag relationships via linking system. Use to find related concepts or tags appearing together. Returns bidirectional link info.",
                parameters: {
                    type: "object",
                    properties: {
                        tagName: {
                            type: "string",
                            description: "Tag name to resolve links for"
                        },
                        depth: {
                            type: "number",
                            description: "Link depth levels (default: 1)",
                            default: 1
                        },
                        direction: {
                            type: "string",
                            enum: ["both", "to", "by"],
                            description: "Direction: 'both' (default), 'to' (links to tag), 'by' (links from tag)",
                            default: "both"
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for link resolution"
                        }
                    },
                    required: ["tagName", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "searchByDescription",
                _accepted_stages: ['planning', 'execution'],
                description: "Find tags by natural language description. Use when concept known but tag names unknown. Returns relevance-scored results in a table format with columns: Tag, Danbooru Count, E621 Count, Training Confidence, Category, Has Wiki?. Includes body previews for top keyword matches by default.",
                parameters: {
                    type: "object",
                    properties: {
                        description: {
                            type: "string",
                            description: "Text description to analyze for tag matching"
                        },
                        category: {
                            type: "number",
                            description: "Limit search to this category ID (optional)"
                        },
                        minUseCount: {
                            type: "number",
                            description: "Minimum usage count for tags to be included (optional)"
                        },
                        limit: {
                            type: "number",
                            description: "Max results (default: 30)",
                            default: 30
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for search"
                        }
                    },
                    required: ["description", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "getBodyChunk",
                _accepted_stages: ['planning', 'execution'],
                description: "Access paginated chunks of long tag descriptions. Use when getTagDetails returns truncated body. Returns tag body chunks.",
                parameters: {
                    type: "object",
                    properties: {
                        tagName: {
                            type: "string",
                            description: "Tag name to get body chunk for"
                        },
                        chunkIndex: {
                            type: "number",
                            description: "Chunk index (0-based, default: 0)",
                            default: 0
                        },
                        section: {
                            type: "string",
                            description: "Optional section anchor/title to jump directly to a heading"
                        },
                        bodySource: {
                            type: "string",
                            description: "Which body to read (danbooru, e621, summary/custom)",
                            enum: ["danbooru", "e621", "summary", "custom"]
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for retrieval"
                        }
                    },
                    required: ["tagName", "bodySource", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "getDatasetGroupContents",
                _accepted_stages: ['planning', 'execution'],
                description: "Get contents of a dataset tag group with fuzzy path matching. Returns tags in the group (ranked by usage) and the full hierarchical tree structure showing the progression path and all siblings at each level. Supports partial paths or just the ending element - will find the best matching group. Use to explore organized tag collections. Tags are returned as a simplified list by default (name and category only); set includeFullTable=true for full tag table with columns: Tag, Danbooru Count, E621 Count, Training Confidence, Category, Has Wiki?.",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            oneOf: [
                                {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Path to the group as an array (e.g., ['attire', 'sexual', 'lingerie']). Supports partial paths - can provide just the ending element like ['lingerie'] and it will find the best match."
                                },
                                {
                                    type: "string",
                                    description: "Path as a string with ' > ' or '/' separators (e.g., 'attire > sexual > lingerie' or 'attire/sexual/lingerie'). Supports partial paths."
                                }
                            ],
                            description: "Path to the group. Can be an array or string. Supports fuzzy matching - partial paths or just the ending element will find the best matching group. The final element must point to a tag array, not a group."
                        },
                        includeFullTable: {
                            type: "boolean",
                            description: "If true, include full tag table with columns: Tag, Danbooru Count, E621 Count, Training Confidence, Category, Has Wiki?. Default: false (returns simplified list with tag name and category only).",
                            default: false
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for requesting group contents"
                        }
                    },
                    required: ["path", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "searchTagDatabase",
                _accepted_stages: ['planning', 'execution'],
                description: "Search NovelAI API for model-specific tag recommendations. Returns tags with weight scores. DO NOT USE for general lookups - use local tag tools instead.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Tag or phrase to search" },
                        reason: {
                            type: "string",
                            description: "Brief reason for search"
                        }
                    },
                    required: ["query", "reason"]
                },
                strict: true
            },
        );
    }

    tools.push(
        {
            type: "function",
            name: "publishAnalysisResults",
            _accepted_stages: ['analysis'],
            description: "Publish analysis of prompt segments and images. After publishing, you'll receive update instructions.",
            parameters: {
                type: "object",
                properties: {
                    prompt_breakdown: {
                        type: "object",
                        properties: {
                            main_subject: { type: "string" },
                            scene_environment: { type: "string" },
                            actions_poses: { type: "array", items: { type: "string" } },
                            mood_atmosphere: { type: "string" },
                            style_elements: { type: "array", items: { type: "string" } }
                        }
                    },
                    image_analysis: {
                        type: "object",
                        properties: {
                            visual_elements: { type: "array", items: { type: "string" } },
                            time_visible: { type: "string" },
                            weather_visible: { type: "string" },
                            scene_type_visible: { type: "string", enum: ["indoor", "outdoor", "mixed", "unclear"] },
                            matches_prompt: { type: "boolean" },
                            differences: { type: "array", items: { type: "string" } }
                        }
                    },
                    existing_context: {
                        type: "object",
                        required: ["location"],
                        properties: {
                            time: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found"],
                                        properties: {
                                            found: { type: "boolean", const: false }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            value: { 
                                                type: "string", 
                                                enum: ["dawn", "sunrise", "morning", "daytime", "midday", "evening", "golden hour", "sunset", "dusk", "night", "midnight"]
                                            },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            season: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found"],
                                        properties: {
                                            found: { type: "boolean", const: false }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            value: { 
                                                type: "string", 
                                                enum: ["spring", "summer", "autumn", "winter"]
                                            },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            holiday: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found"],
                                        properties: {
                                            found: { type: "boolean", const: false }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            value: { type: "string" },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            location: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found", "scene_type"],
                                        properties: {
                                            found: { type: "boolean", const: false },
                                            scene_type: { 
                                                type: "string", 
                                                enum: ["mixed", "unknown"]
                                            }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "scene_type", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            scene_type: { 
                                                type: "string", 
                                                enum: ["indoor", "outdoor", "mixed", "unknown"]
                                            },
                                            value: { type: "string" },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            weather_condition: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found"],
                                        properties: {
                                            found: { type: "boolean", const: false }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            value: { type: "string" },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            sky: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found"],
                                        properties: {
                                            found: { type: "boolean", const: false }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            value: { type: "string" },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            lighting: {
                                anyOf: [
                                    {
                                        type: "object",
                                        required: ["found"],
                                        properties: {
                                            found: { type: "boolean", const: false }
                                        },
                                        additionalProperties: false
                                    },
                                    {
                                        type: "object",
                                        required: ["found", "intensity_level", "value", "segment_index"],
                                        properties: {
                                            found: { type: "boolean", const: true },
                                            intensity_level: { 
                                                type: "number",
                                                minimum: 0,
                                                maximum: 10
                                            },
                                            value: { type: "string" },
                                            segment_index: { 
                                                anyOf: [
                                                    { type: "number" },
                                                    { type: "array", items: { type: "number" } }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            },
                            character_details: {
                                type: "array",
                                items: {
                                    type: "object",
                                    required: ["character_index"],
                                    properties: {
                                        character_index: { type: "number", minimum: 0 },
                                        clothing: {
                                            anyOf: [
                                                {
                                                    type: "object",
                                                    required: ["found"],
                                                    properties: {
                                                        found: { type: "boolean", const: false }
                                                    },
                                                    additionalProperties: false
                                                },
                                                {
                                                    type: "object",
                                                    required: ["found", "items"],
                                                    properties: {
                                                        found: { type: "boolean", const: true },
                                                        items: {
                                                            type: "array",
                                                            items: {
                                                                type: "object",
                                                                required: ["value", "segment_index"],
                                                                properties: {
                                                                    value: { type: "string" },
                                                                    segment_index: { 
                                                                        anyOf: [
                                                                            { type: "number" },
                                                                            { type: "array", items: { type: "number" } }
                                                                        ]
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            ]
                                        },
                                        actions: {
                                            anyOf: [
                                                {
                                                    type: "object",
                                                    required: ["found"],
                                                    properties: {
                                                        found: { type: "boolean", const: false }
                                                    },
                                                    additionalProperties: false
                                                },
                                                {
                                                    type: "object",
                                                    required: ["found", "value", "segment_index"],
                                                    properties: {
                                                        found: { type: "boolean", const: true },
                                                        value: { type: "string" },
                                                        segment_index: { type: "number" }
                                                    }
                                                }
                                            ]
                                        },
                                        attributes: {
                                            anyOf: [
                                                {
                                                    type: "object",
                                                    required: ["found"],
                                                    properties: {
                                                        found: { type: "boolean", const: false }
                                                    },
                                                    additionalProperties: false
                                                },
                                                {
                                                    type: "object",
                                                    required: ["found", "value", "segment_index"],
                                                    properties: {
                                                        found: { type: "boolean", const: true },
                                                        value: { type: "string" },
                                                        segment_index: { type: "number" }
                                                    }
                                                }
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                required: ["existing_context"]
            },
            strict: true
        },
        {
        type: "function",
        name: "planTextReplacements",
            _accepted_stages: ['planning', 'execution'],
            description: "Plan Tsubo (text replacements) for your Tanei package BEFORE creating any actual Tanei. You MUST call this tool after publishAnalysisResults is accepted. Document which segments to update, what tags to use, and your integration approach. This is a REQUIRED planning step - execution tools will NOT be available until you call this. Do NOT create actual Tanei package yet - only plan your Tsubo. IMPORTANT: For research.completed, you MUST cite each research item with the tool call number and tool name (e.g., {topic: 'volumetric lighting', call_number: 3, tool_name: 'searchTagDatabase'}). For research.needed, you can optionally include the tool name you plan to use for tracking purposes.",
        parameters: {
            type: "object",
            properties: {
                planned_changes: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["category", "reason", "target_segments", "action"],
                        properties: {
                            category: {
                                type: "string",
                                enum: ["Weather", "Time of Day", "Seasonal", "Holiday", "Spelling", "Text Overlay", "Conflict Resolution", "Enhancement", "Lighting", "Atmosphere", "Action Verbs", "Directive"]
                            },
                            reason: { type: "string", maxLength: 200 },
                            target_segments: {
                                type: "array",
                                items: { type: "number" },
                                description: "Segment indices to update"
                            },
                            planned_modifications: {
                                type: "array",
                                items: { type: "string" },
                                description: "Tags/concepts to use"
                            },
                            emphasis_value: {
                                type: "number",
                                minimum: -5,
                                maximum: 8,
                                description: "Planned emphasis (system handles formatting)"
                            },
                            action: {
                                type: "string",
                                enum: ["replace", "append", "delete"]
                            }
                        }
                    }
                },
                research: {
                    type: "object",
                    properties: {
                        completed: {
                            type: "array",
                            items: {
                                type: "object",
                                required: ["topic", "call_number", "tool_name"],
                                properties: {
                                    topic: {
                                        type: "string",
                                        description: "The research topic or question that was investigated"
                                    },
                                    call_number: {
                                        type: "number",
                                        minimum: 1,
                                        description: "The tool call number (e.g., 1, 2, 3) when this research was performed"
                                    },
                                    tool_name: {
                                        type: "string",
                                        description: "The name of the tool that was called to perform this research (e.g., 'searchTagDatabase', 'webSearch', 'getTagDetails')"
                                    }
                                }
                            },
                            description: "Research already completed before returning the plan, with citations of which tool was called and when"
                        },
                        needed: {
                            type: "array",
                            items: {
                                type: "object",
                                required: ["topic"],
                                properties: {
                                    topic: {
                                        type: "string",
                                        description: "The research topic or question that still needs to be investigated"
                                    },
                                    tool_name: {
                                        type: "string",
                                        description: "Optional: The name of the tool planned to be called for this research (e.g., 'searchTagDatabase', 'webSearch', 'getTagDetails'). This is for planning and tracking purposes only - the tool is not required to be called."
                                    }
                                }
                            },
                            description: "Research still needed to be completed, optionally with planned tool name for tracking"
                        }
                    },
                    required: ["completed", "needed"]
                },
                conflicts_to_resolve: {
                    type: "array",
                    items: { type: "string" },
                    description: "Conflicts to resolve"
                }
            },
            required: ["planned_changes"]
        },
        strict: true
        },
            {
                type: "function",
            name: "saveKnowledgeMemory",
            _accepted_stages: ['planning', 'execution'],
            description: "Save/UPDATE global knowledge memory accessible to all future generations. Same name = UPDATE (refine existing). SAVE: (1) Rendering techniques, (2) Character-specific mods, (3) Character traits/patterns, (4) Scenario approaches, (5) Token/tag combos, (6) Tag preferences. CRITICAL: Self-contained - future AI won't have your context. Use descriptive names (e.g., 'miku_hatsune_hair_rendering'). Confidence: New=10%, refinement adds 0-25% (max 100%).",
                parameters: {
                    type: "object",
                    properties: {
                    name: {
                            type: "string",
                        description: "Unique memory name (use snake_case, e.g., 'water_droplet_physics_rendering'). Must be descriptive and global-scope appropriate."
                    },
                    description: {
                            type: "string",
                        description: "Clear description of what this memory contains and when to use it. Make it self-contained - future AI won't have your current context."
                    },
                    category: {
                            type: "string",
                        enum: ["technique", "style", "anatomy", "effect", "composition", "lighting", "color_theory", "perspective", "material", "clothing", "character_design", "environment", "character_specific", "scenario_specific", "token_optimization", "tag_preference", "tag_wiki"],
                        description: "Memory category for organization and discovery"
                    },
                    entities: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                id: {
                                        type: "string",
                                    description: "Unique entity ID within this memory (e.g., 'volumetric_fog_technique')"
                                    },
                                type: {
                                            type: "string",
                                    enum: ["concept", "technique", "tag_combination", "visual_element", "principle", "character_trait", "dialog_pattern", "token_preference", "tag_preference", "scenario_approach"],
                                    description: "Entity type"
                                },
                                name: {
                                        type: "string",
                                    description: "Human-readable entity name"
                                },
                                attributes: {
                                    type: "object",
                                    description: "Key-value attributes (e.g., {tags: ['volumetric lighting', 'atmosphere'], difficulty: 'moderate'})"
                                }
                            },
                            required: ["id", "type", "name"]
                        },
                        description: "Entities in the knowledge graph (concepts, techniques, etc.)"
                    },
                    relations: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                from: {
                                        type: "string",
                                    description: "Source entity ID"
                                    },
                                to: {
                                            type: "string",
                                    description: "Target entity ID"
                                        },
                                type: {
                                        type: "string",
                                    enum: ["enhances", "conflicts_with", "requires", "similar_to", "part_of", "enables"],
                                    description: "Relationship type"
                                },
                                weight: {
                                    type: "number",
                                    minimum: 0,
                                    maximum: 1,
                                    description: "Relationship strength (0-1, default 1.0)"
                                }
                            },
                            required: ["from", "to", "type"]
                        },
                        description: "Relationships between entities"
                    },
                    observations: {
                        type: "array",
                        items: {
                    type: "object",
                    properties: {
                                entity_id: {
                            type: "string",
                                    description: "Entity this observation is about"
                                },
                                content: {
                            type: "string",
                                    description: "Specific observation, finding, or best practice"
                                },
                                importance: {
                            type: "number",
                                    minimum: 0,
                                    maximum: 1,
                                    description: "Importance level (0-1, default 0.5)"
                                }
                            },
                            required: ["entity_id", "content"]
                        },
                        description: "Specific observations about entities"
                    },
                    confidence: {
                            type: "number",
                        minimum: 0,
                        maximum: 0.25,
                        description: "Confidence increase for updates (0-0.25). New memories start at 10%, each refinement adds up to 25% (max 100%)"
                        },
                        reason: {
                            type: "string",
                        description: "Brief reason for saving"
                        }
                    },
                required: ["name", "description", "category", "entities", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "analyzeTokenCount",
            _accepted_stages: ['execution'],
                description: "Analyze token counts and prompt effectiveness using NovelAI T5 tokenizer. Use for A/B testing prompt versions or validating efficiency. Returns token counts and optional breakdowns.",
                parameters: {
                    type: "object",
                    properties: {
                        texts: {
                            type: "array",
                            items: {
                                type: "string",
                                description: "Text string to analyze"
                            },
                            description: "Array of text strings to get token counts for",
                            minItems: 1,
                            maxItems: 10
                        },
                        includeBreakdown: {
                            type: "boolean",
                            description: "Include detailed breakdown (individual tokens/strengths). Default: false",
                            default: false
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for analysis"
                        },
                        show_tag_suggestions: {
                            type: "boolean",
                            description: "Whether to display tag suggestions in the prompt analysis. Only applies when includeBreakdown is true.",
                            default: false
                        }
                    },
                    required: ["texts", "reason"]
                },
                strict: true
            },
            {
                type: "function",
                name: "validateTextReplacement",
                _accepted_stages: ['execution'],
                description: (() => {
                    const dialogsCount = dynamicConfig.dialogs_count;
                    const dialogsEnabled = dialogsCount != null ? dialogsCount > 0 : true;
                    const baseDesc = "Validate Tanei package (containing Tsubo/text replacements) with token counting. System verifies Tanei → Tendai hydration. System auto-injects prompts. Returns validation results, applied replacements, token analysis. CRITICAL: Fix failures and retry. On failure: failureDetails with failuresByType, failures array, detailedMessage. Set terminateOnPass=true to auto-complete when all validations pass. When terminateOnPass=true, REQUIRED: ";
                    const dialogsPart = dialogsEnabled ? "dialogs, " : "";
                    return baseDesc + dialogsPart + "generatedImageName (3-100 chars), characterNames (if placeholders detected). Optional: insightMemory.";
                })(),
                parameters: {
                    type: "object",
                    properties: {
                        textReplacements: {
                            type: "object",
                            description: "Tanei package (containing Tsubo/text replacements) to validate and apply. System verifies Tanei → Tendai hydration (REQUIRED)",
                            properties: {
                                prompt: {
                                    type: "array",
                                    description: "Array of Tsubo (text replacements) for the main prompt in your Tanei package. Provide empty array when no edits are needed.",
                                    items: {
                                        allOf: [
                                            {
                                                type: "object",
                                                description: "Tsubo (text replacement) definition applied to the base prompt",
                                                properties: {
                                                    reason: {
                                                        type: "string",
                                                        description: "Plain-language explanation of why this replacement is needed (single sentence)."
                                                    },
                                                    reason_display: {
                                                        type: "string",
                                                        description: "2-5 word summary used in UI badges (e.g., 'Weather pass')."
                                                    },
                                                    segment_index: {
                                                        anyOf: [
                                                            { type: "number", minimum: -1 },
                                                            {
                                                                type: "array",
                                                                items: {
                                                                    type: "number",
                                                                    minimum: -1
                                                                },
                                                                description: "Array of segment indices to target multiple segments in a single replacement (for replace/delete only). For REPLACE: must be continuous (e.g., [0, 1, 2]). For DELETE: can be non-continuous (e.g., [0, 2, 5]). Each segment will be replaced/deleted with the same replace_text."
                                                            }
                                                        ],
                                                        description: "REQUIRED: 0-based index(es) of the comma-separated segment(s) in the **base prompt** to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). For APPEND: use -1 to append at end, or provide a segment index to append after that segment."
                                                    },
                                                    replace_text: {
                                                        anyOf: [
                                                            { type: "string" },
                                                            { type: "null" }
                                                        ],
                                                        description: "Text to insert or replace with. REQUIRED for replace/append, MUST be omitted for delete. Should be consistent with the surrounding prompt and not contradict existing tags."
                                                    },
                                                    action: {
                                                        anyOf: [
                                                            {
                                                                type: "string",
                                                                enum: ["replace", "append", "delete"]
                                                            },
                                                            { type: "null" }
                                                        ],
                                                        description: "Replacement action: replace (default), append, or delete.",
                                                        default: "replace"
                                                    },
                                                    count: {
                                                        anyOf: [
                                                            { type: "integer", minimum: 1 },
                                                            { type: "null" }
                                                        ],
                                                        description: "Delete mode only: number of occurrences to remove left-to-right (omit to remove all)."
                                                    },
                                                    is_critical: {
                                                        anyOf: [
                                                            { type: "boolean" },
                                                            { type: "null" }
                                                        ],
                                                        description: "true = must succeed before completion, false = optional best-effort replacement.",
                                                        default: true
                                                    },
                                                    alternative_text: {
                                                        anyOf: [
                                                            { type: "string" },
                                                            { type: "null" }
                                                        ],
                                                        description: "Optional safe text to append if the replacement fails (legacy field - prefer using segment_index correctly)."
                                                    },
                                                    replacement_category: {
                                                        type: "string",
                                                        enum: ["Weather", "Time of Day", "Seasonal", "Holiday", "Spelling", "Text Overlay", "Conflict Resolution", "Enhancement", "Lighting", "Atmosphere", "Action Verbs", "Directive"],
                                                        description: "REQUIRED: Category describing the intent of this Tsubo (text replacement). MUST be one of the enum values. When time/weather/season/holiday/directive features are enabled, you MUST include at least one Tsubo with the corresponding category ('Time of Day', 'Weather', 'Seasonal', 'Holiday', or 'Directive') in your Tanei package. Only 'Spelling' and 'Text Overlay' may edit content after ', Text:'."
                                                    },
                                                    segment_emphasis: {
                                                        anyOf: [
                                                            { type: "number", minimum: -5, maximum: 8 },
                                                            { type: "null" }
                                                        ],
                                                        description: "Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."
                                                    },
                                                    index: {
                                                        anyOf: [
                                                            { type: "integer" },
                                                            { type: "null" }
                                                        ],
                                                        description: "Current increment value for stateful replacements."
                                                    },
                                                    increment_data: {
                                                        anyOf: [
                                                            { type: "string", maxLength: 64 },
                                                            { type: "null" }
                                                        ],
                                                        description: "Serialized metadata used for incrementing logic (max 64 chars)."
                                                    },
                                                    references: {
                                                        description: "Optional research references supporting this replacement.",
                                                        anyOf: [
                                                            {
                                                                type: "array",
                                                                items: {
                                                                    type: "object",
                                                                    properties: {
                                                                        type: {
                                                                            type: "string",
                                                                            enum: ["web_search", "tag_search", "tag_description", "tokenizer", "memory_retrieval"],
                                                                            description: "Source type providing evidence."
                                                                        },
                                                                        query: {
                                                                            anyOf: [
                                                                                { type: "string" },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Search query or description used."
                                                                        },
                                                                        url: {
                                                                            anyOf: [
                                                                                { type: "string" },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Source URL when applicable (web_search)."
                                                                        },
                                                                        tags: {
                                                                            anyOf: [
                                                                                {
                                                                                    type: "array",
                                                                                    items: { type: "string" }
                                                                                },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Relevant tags discovered (tag_search/tag_description)."
                                                                        },
                                                                        description: {
                                                                            anyOf: [
                                                                                { type: "string" },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Summary of findings or tokenizer insights."
                                                                        }
                                                                    },
                                                                    required: ["type"]
                                                                }
                                                            },
                                                            { type: "null" }
                                                        ]
                                                    }
                                                },
                                                required: ["reason", "action", "reason_display", "replacement_category", "segment_index", "is_critical"]
                                            },
                                            {
                                                if: {
                                                    anyOf: [
                                                        {
                                                            properties: {
                                                                action: { const: "replace" }
                                                            }
                                                        },
                                                        {
                                                            properties: {
                                                                action: { const: "append" }
                                                            }
                                                        }
                                                    ]
                                                },
                                                then: {
                                                    required: ["replace_text"]
                                                }
                                            }
                                        ]
                                    }
                                },
                                uc: {
                                    type: "array",
                                    description: "Array of Tsubo (text replacements) for the negative prompt in your Tanei package. Provide empty array when no edits are needed.",
                                    items: {
                                        allOf: [
                                            {
                                                type: "object",
                                                description: "Tsubo (text replacement) definition applied to the negative prompt",
                                                properties: {
                                                    reason: {
                                                        type: "string",
                                                        description: "Plain-language explanation of why this replacement is needed (full sentence)."
                                                    },
                                                    reason_display: {
                                                        type: "string",
                                                        description: "2-5 word summary used in UI badges."
                                                    },
                                                    segment_index: {
                                                        anyOf: [
                                                            { type: "number", minimum: -1 },
                                                            {
                                                                type: "array",
                                                                items: {
                                                                    type: "number",
                                                                    minimum: -1
                                                                },
                                                                description: "Array of segment indices to target multiple segments in a single replacement (for replace/delete only). For REPLACE: must be continuous (e.g., [0, 1, 2]). For DELETE: can be non-continuous (e.g., [0, 2, 5]). Each segment will be replaced/deleted with the same replace_text."
                                                            }
                                                        ],
                                                        description: "REQUIRED: 0-based index(es) of the comma-separated segment(s) in the **negative prompt (UC)** to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). For APPEND: use -1 to append at end, or provide a segment index to append after that segment."
                                                    },
                                                    replace_text: {
                                                        anyOf: [
                                                            { type: "string" },
                                                            { type: "null" }
                                                        ],
                                                        description: "Text to insert or replace with in the negative prompt. REQUIRED for replace/append, MUST be omitted for delete. Should be consistent with the surrounding UC and not contradict existing safety tags."
                                                    },
                                                    action: {
                                                        anyOf: [
                                                            {
                                                                type: "string",
                                                                enum: ["replace", "append", "delete"]
                                                            },
                                                            { type: "null" }
                                                        ],
                                                        description: "Replacement action: replace (default), append, or delete.",
                                                        default: "replace"
                                                    },
                                                    count: {
                                                        anyOf: [
                                                            { type: "integer", minimum: 1 },
                                                            { type: "null" }
                                                        ],
                                                        description: "Delete mode only: number of occurrences to remove left-to-right (omit to remove all)."
                                                    },
                                                    is_critical: {
                                                        anyOf: [
                                                            { type: "boolean" },
                                                            { type: "null" }
                                                        ],
                                                        description: "true = must succeed before completion, false = optional best-effort replacement.",
                                                        default: true
                                                    },
                                                    alternative_text: {
                                                        anyOf: [
                                                            { type: "string" },
                                                            { type: "null" }
                                                        ],
                                                        description: "Optional safe text to append if the replacement fails (legacy field - prefer using segment_index correctly)."
                                                    },
                                                    replacement_category: {
                                                        type: "string",
                                                        enum: ["Weather", "Time of Day", "Seasonal", "Holiday", "Spelling", "Text Overlay", "Conflict Resolution", "Enhancement", "Lighting", "Atmosphere", "Action Verbs", "Directive"],
                                                        description: "REQUIRED: Category describing the intent of this Tsubo (text replacement). MUST be one of the enum values. When time/weather/season/holiday/directive features are enabled, you MUST include at least one Tsubo with the corresponding category ('Time of Day', 'Weather', 'Seasonal', 'Holiday', or 'Directive') in your Tanei package. Only 'Spelling' and 'Text Overlay' may edit content after ', Text:'."
                                                    },
                                                    segment_emphasis: {
                                                        anyOf: [
                                                            { type: "number", minimum: -5, maximum: 8 },
                                                            { type: "null" }
                                                        ],
                                                        description: "Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."
                                                    },
                                                    index: {
                                                        anyOf: [
                                                            { type: "integer" },
                                                            { type: "null" }
                                                        ],
                                                        description: "Current increment value for stateful replacements."
                                                    },
                                                    increment_data: {
                                                        anyOf: [
                                                            { type: "string", maxLength: 64 },
                                                            { type: "null" }
                                                        ],
                                                        description: "Serialized metadata used for incrementing logic (max 64 chars)."
                                                    },
                                                    references: {
                                                        description: "Optional research references supporting this replacement.",
                                                        anyOf: [
                                                            {
                                                                type: "array",
                                                                items: {
                                                                    type: "object",
                                                                    properties: {
                                                                        type: {
                                                                            type: "string",
                                                                            enum: ["web_search", "tag_search", "tag_description", "tokenizer", "memory_retrieval"],
                                                                            description: "Source type providing evidence."
                                                                        },
                                                                        query: {
                                                                            anyOf: [
                                                                                { type: "string" },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Search query or description used."
                                                                        },
                                                                        url: {
                                                                            anyOf: [
                                                                                { type: "string" },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Source URL when applicable (web_search)."
                                                                        },
                                                                        tags: {
                                                                            anyOf: [
                                                                                {
                                                                                    type: "array",
                                                                                    items: { type: "string" }
                                                                                },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Relevant tags discovered (tag_search/tag_description)."
                                                                        },
                                                                        description: {
                                                                            anyOf: [
                                                                                { type: "string" },
                                                                                { type: "null" }
                                                                            ],
                                                                            description: "Summary of findings or tokenizer insights."
                                                                        }
                                                                    },
                                                                    required: ["type"]
                                                                }
                                                            },
                                                            { type: "null" }
                                                        ]
                                                    }
                                                },
                                                required: ["reason", "action", "reason_display", "replacement_category", "segment_index", "is_critical"]
                                            },
                                            {
                                                if: {
                                                    anyOf: [
                                                        {
                                                            properties: {
                                                                action: { const: "replace" }
                                                            }
                                                        },
                                                        {
                                                            properties: {
                                                                action: { const: "append" }
                                                            }
                                                        }
                                                    ]
                                                },
                                                then: {
                                                    required: ["replace_text"]
                                                }
                                            }
                                        ]
                                    }
                                },
                                character_prompts: {
                                    type: "array",
                                    description: "Character-specific Tsubo (text replacement) sets in your Tanei package. Array order MUST match the server-provided character prompts.",
                                    items: {
                                        type: "object",
                                        properties: {
                                            prompt: {
                                                type: "array",
                                                description: "Array of Tsubo (text replacements) applied to this character's positive prompt.",
                                                items: {
                                                    allOf: [
                                                        {
                                                            type: "object",
                                                            description: "Tsubo (text replacement) definition applied to the character's positive prompt",
                                                            properties: {
                                                                reason: {
                                                                    type: "string",
                                                                    description: "Plain-language explanation of why this replacement is needed (full sentence)."
                                                                },
                                                                reason_display: {
                                                                    type: "string",
                                                                    description: "2-5 word summary used in UI badges."
                                                                },
                                                                segment_index: {
                                                                    anyOf: [
                                                                        { type: "number", minimum: -1 },
                                                                        {
                                                                            type: "array",
                                                                            items: {
                                                                                type: "number",
                                                                                minimum: -1
                                                                            },
                                                                            description: "Array of segment indices to target multiple segments in a single replacement (for replace/delete only). For REPLACE: must be continuous (e.g., [0, 1, 2]). For DELETE: can be non-continuous (e.g., [0, 2, 5]). Each segment will be replaced/deleted with the same replace_text."
                                                                        }
                                                                    ],
                                                                    description: "REQUIRED: 0-based index(es) of the comma-separated segment(s) in THIS character's positive prompt to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). For APPEND: use -1 to append at end, or provide a segment index to append after that segment."
                                                                },
                                                                replace_text: {
                                                                    anyOf: [
                                                                        { type: "string" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Text to insert or replace with in this character's positive prompt. REQUIRED for replace/append, MUST be omitted for delete. Should be consistent with the surrounding prompt and not contradict existing tags."
                                                                },
                                                                action: {
                                                                    anyOf: [
                                                                        {
                                                                            type: "string",
                                                                            enum: ["replace", "append", "delete"]
                                                                        },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Replacement action: replace (default), append, or delete.",
                                                                    default: "replace"
                                                                },
                                                                count: {
                                                                    anyOf: [
                                                                        { type: "integer", minimum: 1 },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Delete mode only: number of occurrences to remove left-to-right (omit to remove all)."
                                                                },
                                                                is_critical: {
                                                                    anyOf: [
                                                                        { type: "boolean" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "true = must succeed before completion, false = optional best-effort replacement.",
                                                                    default: true
                                                                },
                                                                alternative_text: {
                                                                    anyOf: [
                                                                        { type: "string" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Optional safe text to append if both select_text and fallback_select_text fail."
                                                                },
                                                                replacement_category: {
                                                                    type: "string",
                                                                    enum: ["Weather", "Time of Day", "Seasonal", "Holiday", "Spelling", "Text Overlay", "Conflict Resolution", "Enhancement", "Lighting", "Atmosphere", "Action Verbs", "Directive"],
                                                                    description: "REQUIRED: Category describing the intent of this Tsubo (text replacement). MUST be one of the enum values. When time/weather/season/holiday/directive features are enabled, you MUST include at least one Tsubo with the corresponding category ('Time of Day', 'Weather', 'Seasonal', 'Holiday', or 'Directive') in your Tanei package. Only 'Spelling' and 'Text Overlay' may edit content after ', Text:'."
                                                                },
                                                                segment_emphasis: {
                                                                    anyOf: [
                                                                        { type: "number", minimum: -5, maximum: 8 },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."
                                                                },
                                                                index: {
                                                                    anyOf: [
                                                                        { type: "integer" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Current increment value for stateful replacements."
                                                                },
                                                                increment_data: {
                                                                    anyOf: [
                                                                        { type: "string", maxLength: 64 },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Serialized metadata used for incrementing logic (max 64 chars)."
                                                                },
                                                                references: {
                                                                    description: "Optional research references supporting this replacement.",
                                                                    anyOf: [
                                                                        {
                                                                            type: "array",
                                                                            items: {
                                                                                type: "object",
                                                                                properties: {
                                                                                    type: {
                                                                                        type: "string",
                                                                                        enum: ["web_search", "tag_search", "tag_description", "tokenizer", "memory_retrieval"],
                                                                                        description: "Source type providing evidence."
                                                                                    },
                                                                                    query: {
                                                                                        anyOf: [
                                                                                            { type: "string" },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Search query or description used."
                                                                                    },
                                                                                    url: {
                                                                                        anyOf: [
                                                                                            { type: "string" },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Source URL when applicable (web_search)."
                                                                                    },
                                                                                    tags: {
                                                                                        anyOf: [
                                                                                            {
                                                                                                type: "array",
                                                                                                items: { type: "string" }
                                                                                            },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Relevant tags discovered (tag_search/tag_description)."
                                                                                    },
                                                                                    description: {
                                                                                        anyOf: [
                                                                                            { type: "string" },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Summary of findings or tokenizer insights."
                                                                                    }
                                                                                },
                                                                                required: ["type"]
                                                                            }
                                                                        },
                                                                        { type: "null" }
                                                                    ]
                                                                }
                                                            },
                                                            required: ["reason", "action", "reason_display", "replacement_category", "segment_index", "is_critical"]
                                                        },
                                                        {
                                                            if: {
                                                                anyOf: [
                                                                    {
                                                                        properties: {
                                                                            action: { const: "replace" }
                                                                        }
                                                                    },
                                                                    {
                                                                        properties: {
                                                                            action: { const: "append" }
                                                                        }
                                                                    }
                                                                ]
                                                            },
                                                            then: {
                                                                required: ["replace_text"]
                                                            }
                                                        }
                                                    ]
                                                }
                                            },
                                            uc: {
                                                type: "array",
                                                description: "Array of Tsubo (text replacements) applied to this character's negative prompt.",
                                                items: {
                                                    allOf: [
                                                        {
                                                            type: "object",
                                                            description: "Tsubo (text replacement) definition applied to the character's negative prompt",
                                                            properties: {
                                                                reason: {
                                                                    type: "string",
                                                                    description: "Plain-language explanation of why this replacement is needed (full sentence)."
                                                                },
                                                                reason_display: {
                                                                    type: "string",
                                                                    description: "2-5 word summary used in UI badges."
                                                                },
                                                                segment_index: {
                                                                    anyOf: [
                                                                        { type: "number", minimum: -1 },
                                                                        {
                                                                            type: "array",
                                                                            items: {
                                                                                type: "number",
                                                                                minimum: -1
                                                                            },
                                                                            description: "Array of segment indices to target multiple segments in a single replacement (for replace/delete only). For REPLACE: must be continuous (e.g., [0, 1, 2]). For DELETE: can be non-continuous (e.g., [0, 2, 5]). Each segment will be replaced/deleted with the same replace_text."
                                                                        }
                                                                    ],
                                                                    description: "REQUIRED: 0-based index(es) of the comma-separated segment(s) in THIS character's negative prompt (UC) to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). For APPEND: use -1 to append at end, or provide a segment index to append after that segment."
                                                                },
                                                                replace_text: {
                                                                    anyOf: [
                                                                        { type: "string" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Text to insert or replace with in this character's negative prompt. REQUIRED for replace/append, MUST be omitted for delete. Should be consistent with the surrounding UC and not contradict existing safety tags."
                                                                },
                                                                action: {
                                                                    anyOf: [
                                                                        {
                                                                            type: "string",
                                                                            enum: ["replace", "append", "delete"]
                                                                        },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Replacement action: replace (default), append, or delete.",
                                                                    default: "replace"
                                                                },
                                                                count: {
                                                                    anyOf: [
                                                                        { type: "integer", minimum: 1 },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Delete mode only: number of occurrences to remove left-to-right (omit to remove all)."
                                                                },
                                                                is_critical: {
                                                                    anyOf: [
                                                                        { type: "boolean" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "true = must succeed before completion, false = optional best-effort replacement.",
                                                                    default: true
                                                                },
                                                                alternative_text: {
                                                                    anyOf: [
                                                                        { type: "string" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Optional safe text to append if both select_text and fallback_select_text fail."
                                                                },
                                                                replacement_category: {
                                                                    type: "string",
                                                                    enum: ["Weather", "Time of Day", "Seasonal", "Holiday", "Spelling", "Text Overlay", "Conflict Resolution", "Enhancement", "Lighting", "Atmosphere", "Action Verbs", "Directive"],
                                                                    description: "REQUIRED: Category describing the intent of this Tsubo (text replacement). MUST be one of the enum values. When time/weather/season/holiday/directive features are enabled, you MUST include at least one Tsubo with the corresponding category ('Time of Day', 'Weather', 'Seasonal', 'Holiday', or 'Directive') in your Tanei package. Only 'Spelling' and 'Text Overlay' may edit content after ', Text:'."
                                                                },
                                                                segment_emphasis: {
                                                                    anyOf: [
                                                                        { type: "number", minimum: -5, maximum: 8 },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."
                                                                },
                                                                index: {
                                                                    anyOf: [
                                                                        { type: "integer" },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Current increment value for stateful replacements."
                                                                },
                                                                increment_data: {
                                                                    anyOf: [
                                                                        { type: "string", maxLength: 64 },
                                                                        { type: "null" }
                                                                    ],
                                                                    description: "Serialized metadata used for incrementing logic (max 64 chars)."
                                                                },
                                                                references: {
                                                                    description: "Optional research references supporting this replacement.",
                                                                    anyOf: [
                                                                        {
                                                                            type: "array",
                                                                            items: {
                                                                                type: "object",
                                                                                properties: {
                                                                                    type: {
                                                                                        type: "string",
                                                                                        enum: ["web_search", "tag_search", "tag_description", "tokenizer", "memory_retrieval"],
                                                                                        description: "Source type providing evidence."
                                                                                    },
                                                                                    query: {
                                                                                        anyOf: [
                                                                                            { type: "string" },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Search query or description used."
                                                                                    },
                                                                                    url: {
                                                                                        anyOf: [
                                                                                            { type: "string" },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Source URL when applicable (web_search)."
                                                                                    },
                                                                                    tags: {
                                                                                        anyOf: [
                                                                                            {
                                                                                                type: "array",
                                                                                                items: { type: "string" }
                                                                                            },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Relevant tags discovered (tag_search/tag_description)."
                                                                                    },
                                                                                    description: {
                                                                                        anyOf: [
                                                                                            { type: "string" },
                                                                                            { type: "null" }
                                                                                        ],
                                                                                        description: "Summary of findings or tokenizer insights."
                                                                                    }
                                                                                },
                                                                                required: ["type"]
                                                                            }
                                                                        },
                                                                        { type: "null" }
                                                                    ]
                                                                }
                                                            },
                                                            required: ["reason", "action", "reason_display", "replacement_category", "segment_index", "is_critical"]
                                                        },
                                                        {
                                                            if: {
                                                                anyOf: [
                                                                    {
                                                                        properties: {
                                                                            action: { const: "replace" }
                                                                        }
                                                                    },
                                                                    {
                                                                        properties: {
                                                                            action: { const: "append" }
                                                                        }
                                                                    }
                                                                ]
                                                            },
                                                            then: {
                                                                required: ["replace_text"]
                                                            }
                                                        }
                                                    ]
                                                }
                                            }
                                        },
                                        required: ["prompt"]
                                    }
                                }
                            },
                            required: ["prompt"]
                        },
                        ...(dialogsEnabled ? {
                            dialogs: {
                                type: "array",
                                minItems: dialogsCount != null && dialogsCount > 0 ? 0 : 3,
                                maxItems: dialogsCount != null && dialogsCount > 0 ? dialogsCount : 10,
                                items: {
                                    type: "object",
                                    properties: {
                                        type: {
                                            type: "string",
                                            enum: ["speech", "thought"],
                                            description: "Type: 'speech' (spoken) or 'thought' (internal)"
                                        },
                                        text: {
                                            type: "string",
                                            description: "Text (1-200 chars) in character's voice/tone"
                                        },
                                        top: {
                                            type: "number",
                                            minimum: 5,
                                            maximum: 95,
                                            description: "Top position % (5-95)"
                                        },
                                        left: {
                                            type: "number",
                                            minimum: 5,
                                            maximum: 95,
                                            description: "Left position % (5-95)"
                                        },
                                        alignment: {
                                            type: "string",
                                            enum: ["left", "right"],
                                            description: "Alignment: 'left' or 'right'"
                                        }
                                    },
                                    required: ["type", "text", "top", "left", "alignment"]
                                },
                                description: dialogsCount != null && dialogsCount > 0 ? `${dialogsCount} dialogs (speech/thoughts). Required when terminateOnPass=true (can be []). Each dialog needs all required fields.` : "3-10 dialogs (speech/thoughts). Required when terminateOnPass=true (can be []). Each dialog needs all required fields."
                            }
                        } : {}),
                        insightMemory: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Unique name (snake_case, e.g., 'water_droplet_physics_rendering'). Must be globally applicable, not context-specific."
                                    },
                                    description: {
                                        type: "string",
                                        description: "Self-contained description - future AI won't have your context"
                                    },
                                    category: {
                                        type: "string",
                                        enum: ["technique", "style", "anatomy", "effect", "composition", "lighting", "color_theory", "perspective", "material", "clothing", "character_design", "environment", "character_specific", "scenario_specific", "token_optimization", "tag_preference", "tag_wiki"],
                                        description: "Memory category for organization and discovery"
                                    },
                                    entities: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                id: {
                                                    type: "string",
                                                    description: "Unique entity ID within this memory (e.g., 'volumetric_fog_technique')"
                                                },
                                                type: {
                                                    type: "string",
                                                    enum: ["concept", "technique", "tag_combination", "visual_element", "principle", "character_trait", "dialog_pattern", "token_preference", "tag_preference", "scenario_approach"],
                                                    description: "Entity type"
                                                },
                                                name: {
                                                    type: "string",
                                                    description: "Human-readable entity name"
                                                },
                                                attributes: {
                                                    type: "object",
                                                    description: "Key-value attributes (e.g., {tags: ['volumetric lighting', 'atmosphere'], difficulty: 'moderate'})"
                                                }
                                            },
                                            required: ["id", "type", "name"]
                                        },
                                        description: "Entities (concepts, techniques, tag combinations)"
                                    },
                                    relations: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                from: {
                                                    type: "string",
                                                    description: "Source entity ID"
                                                },
                                                to: {
                                                    type: "string",
                                                    description: "Target entity ID"
                                                },
                                                type: {
                                                    type: "string",
                                                    enum: ["enhances", "conflicts_with", "requires", "similar_to", "part_of", "enables"],
                                                    description: "Relationship type"
                                                },
                                                weight: {
                                                    type: "number",
                                                    minimum: 0,
                                                    maximum: 1,
                                                    description: "Relationship strength (0-1, default 1.0)"
                                                }
                                            },
                                            required: ["from", "to", "type"]
                                        },
                                        description: "Relationships between entities (optional)"
                                    },
                                    observations: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                entity_id: {
                                                    type: "string",
                                                    description: "Entity this observation is about"
                                                },
                                                content: {
                                                    type: "string",
                                                    description: "Specific observation, finding, or best practice"
                                                },
                                                importance: {
                                                    type: "number",
                                                    minimum: 0,
                                                    maximum: 1,
                                                    description: "Importance level (0-1, default 0.5)"
                                                }
                                            },
                                            required: ["entity_id", "content"]
                                        },
                                        description: "Observations about entities (optional)"
                                    },
                                    confidence: {
                                        type: "number",
                                        minimum: 0,
                                        maximum: 0.25,
                                        description: "Confidence increase (0-0.25). New: 10%, each refinement: +0-25% (max 100%)"
                                    }
                                },
                                required: ["name", "description", "category", "entities"]
                            },
                            description: "Global knowledge memories (auto-saved on validation pass). ONLY timeless/reusable knowledge - NEVER context-specific (weather/time/character). Accessible to all future generations."
                        },
                        errors: {
                            type: "array",
                            items: { type: "string" },
                            description: "Optional: Array of error messages from directive processing (for client-side display)"
                        },
                        warnings: {
                            type: "array",
                            items: { type: "string" },
                            description: "Optional: Array of warning messages from directive processing (for client-side display)"
                        },
                        includeTokenAnalysis: {
                            type: "boolean",
                            description: "Include token counting (default: true)",
                            default: true
                        },
                        terminateOnPass: {
                            type: "boolean",
                            description: (() => {
                                const dialogsCount = dynamicConfig.dialogs_count;
                                const dialogsEnabled = dialogsCount != null ? dialogsCount > 0 : true;
                                const baseDesc = "Auto-complete when all validations pass. When true, REQUIRED: ";
                                const dialogsPart = dialogsEnabled ? "dialogs, " : "";
                                return baseDesc + dialogsPart + "generatedImageName, characterNames (if placeholders detected). Default: false";
                            })(),
                            default: false
                        },
                        verifyTokenCount: {
                            type: "boolean",
                            description: "If true, internally validates token count (<=200 tokens). Fails validation if not optimal. Default: false",
                            default: false
                        },
                        generatedImageName: {
                            type: "string",
                            minLength: 3,
                            maxLength: 100,
                            description: "Image name (3-100 chars). Proper caps format (e.g., 'Rainy Evening Contemplation'). Required when terminateOnPass=true."
                        },
                        characterNames: {
                            type: "array",
                            items: { type: "string" },
                            description: "Character names array. Replace placeholders ('Character #1', 'Girl 1', etc.) with contextually appropriate names. Order matches character_prompts. Required when terminateOnPass=true AND placeholders detected."
                        },
                        reason: {
                            type: "string",
                            description: "Brief reason for validation"
                        }
                    },
                    required: ["textReplacements", "reason"]
                },
                strict: true
            },
        {
            type: "function",
            name: "completeTooling",
            _accepted_stages: ['execution'],
            description: "This is a required function call that you MUST call when you have gathered all necessary information from tools and are ready to provide the final structured response. This signals that tool usage is complete and the system should expect your structured output.",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "Brief reason for completion"
                    }
                },
                required: ["reason"]
            },
            strict: true
        },
        {
            type: "function",
            name: "rejectChain",
            _accepted_stages: ['planning', 'execution'],
            description: "Reject chain update, request full regeneration. USE ONLY when: (1) Large prompt removal, (2) Core concept changed, (3) Structure incompatible. NOT for minor edits.",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "Brief reason for rejection"
                    },
                    changeAnalysis: {
                        type: "string",
                        description: "Analysis of changes making chain update inefficient (e.g., 'Subject changed, 60% tags removed')"
                    }
                },
                required: ["reason"]
            },
            strict: true
        },
        {
            type: "function",
            name: "retrieveKnowledgeMemory",
            _accepted_stages: ['planning', 'execution'],
            description: "Retrieve global memories by name (from available memories list). Returns entities, relations, observations, confidence (10-100%). Low confidence (<60%) needs refinement. Can batch multiple memories.",
            parameters: {
                type: "object",
                properties: {
                    names: {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        description: "Array of exact memory names to retrieve (from the available memories list). Can be a single name or multiple names."
                    },
                    reason: {
                        type: "string",
                        description: "Brief reason for retrieval"
                    }
                },
                required: ["names", "reason"]
            },
            strict: true
        },
        {
            type: "function",
            name: "searchKnowledgeMemories",
            _accepted_stages: ['planning', 'execution'],
            description: "Search memories by keyword/category when unsure what exists. Returns names, descriptions, AND full details (entities/relations/observations) - no separate retrieve needed.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query (searches memory names and descriptions)"
                    },
                    category: {
                        type: "string",
                        enum: ["technique", "style", "anatomy", "effect", "composition", "lighting", "color_theory", "perspective", "material", "clothing", "character_design", "environment", "character_specific", "scenario_specific", "token_optimization", "tag_preference", "tag_wiki"],
                        description: "Optional: Filter by category"
                    },
                    reason: {
                        type: "string",
                        description: "Brief reason for search"
                    }
                },
                required: ["query", "reason"]
            },
            strict: true
        }
    );

    return tools;
}

/**
 * Filters tools based on workflow step using _accepted_stages property
 * @param {Array} tools - All available tools
 * @param {string} workflowStep - Current workflow step: 'analysis' | 'planning' | 'execution'
 * @returns {Array} Filtered tools for the specified workflow step (with _accepted_stages stripped)
 */
    filterToolsByWorkflowStep(tools, workflowStep = 'execution') {
    if (!Array.isArray(tools)) {
        return [];
    }
    
    return tools
        .filter(tool => {
            // If tool has _accepted_stages, check if current workflow step is allowed
            if (tool._accepted_stages) {
                return tool._accepted_stages.includes(workflowStep);
            }
            // If no _accepted_stages property, allow the tool (backward compatibility)
            return true;
        })
        .map(tool => {
            // Strip _accepted_stages before passing to AI
            const { _accepted_stages, ...toolWithoutStages } = tool;
            return toolWithoutStages;
        });
}

/**
 * Builds a complete prompt by applying text replacements
 * @param {Object} promptData - Prompt data with base text and replacements
 * @returns {Object} Built prompt and replacement results
 */
    buildPromptWithReplacements(promptData) {
    let { basePrompt, negativePrompt, characterPrompts, textReplacements } = promptData;

    // Start with base prompts
    let resultPrompt = basePrompt || '';
    let resultNegativePrompt = negativePrompt || '';
    let resultCharacterPrompts = characterPrompts ? [...characterPrompts] : [];

    const replacementResults = {
        prompt: [],
        uc: [],
        character_prompts: []
    };

    // Apply text replacements if provided
    if (textReplacements) {
        // Apply to main prompt
        if (textReplacements.prompt) {
            for (const replacement of textReplacements.prompt) {
                const result = this.applySingleReplacement(resultPrompt, replacement);
                resultPrompt = result.newText;
                replacementResults.prompt.push(result);
            }
        }

        // Apply to negative prompt
        if (textReplacements.uc) {
            for (const replacement of textReplacements.uc) {
                const result = this.applySingleReplacement(resultNegativePrompt, replacement);
                resultNegativePrompt = result.newText;
                replacementResults.uc.push(result);
            }
        }

        // Apply to character prompts
        // Note: character_prompts structure is [{prompt: [replacements], uc: [replacements]}]
        if (textReplacements.character_prompts && resultCharacterPrompts.length > 0) {
            for (let i = 0; i < Math.min(textReplacements.character_prompts.length, resultCharacterPrompts.length); i++) {
                const charPrompt = resultCharacterPrompts[i];
                const charReplacements = textReplacements.character_prompts[i];
                
                let updatedPrompt = charPrompt.prompt || '';
                let updatedUc = charPrompt.uc || '';

                // Apply prompt replacements
                const promptReplacements = charReplacements.prompt || [];
                for (const replacement of promptReplacements) {
                    const promptResult = this.applySingleReplacement(updatedPrompt, replacement);
                    updatedPrompt = promptResult.newText;
                    replacementResults.character_prompts.push(promptResult);
                }

                // Apply uc replacements
                const ucReplacements = charReplacements.uc || [];
                for (const replacement of ucReplacements) {
                    const ucResult = this.applySingleReplacement(updatedUc, replacement);
                    updatedUc = ucResult.newText;
                    replacementResults.character_prompts.push(ucResult);
                }

                resultCharacterPrompts[i] = {
                    ...charPrompt,
                    prompt: updatedPrompt,
                    uc: updatedUc
                };
            }
        }
    }

    return {
        builtPrompt: resultPrompt,
        builtNegativePrompt: resultNegativePrompt,
        builtCharacterPrompts: resultCharacterPrompts,
        replacementResults
    };
}

/**
 * Applies a single text replacement
 * @param {string} text - Text to modify
 * @param {Object} replacement - Replacement specification
 * @returns {Object} Result of replacement application
 */
    applySingleReplacement(text, replacement) {
    const { select_text, replace_text, action: rawAction = 'replace', count } = replacement;
    // Normalize action to lowercase for consistency
    const action = typeof rawAction === 'string' ? rawAction.toLowerCase() : rawAction;

    let newText = text;
    let applied = false;
    let error = null;
    let selectTextsFound = [];

    try {
        if (action === 'append' && !select_text) {
            // Append to end
            newText = text + replace_text;
            applied = true;
        } else if (select_text) {
            // Handle array of select_text values
            const selectTexts = Array.isArray(select_text) ? select_text : [select_text];
            let anyApplied = false;

            for (const singleSelectText of selectTexts) {
                if (!singleSelectText) continue;

                const selectRegex = new RegExp(this.escapeRegExp(singleSelectText), 'g');
                const found = selectRegex.test(text);

                if (found) {
                    selectTextsFound.push(singleSelectText);
                }

                if (action === 'replace') {
                    newText = newText.replace(selectRegex, replace_text);
                    anyApplied = anyApplied || found;
                } else if (action === 'delete') {
                    if (count && count > 1) {
                        let occurrences = 0;
                        newText = newText.replace(selectRegex, (match) => {
                            occurrences++;
                            return occurrences <= count ? '' : match;
                        });
                        anyApplied = anyApplied || occurrences > 0;
                    } else {
                        newText = newText.replace(selectRegex, '');
                        anyApplied = anyApplied || found;
                    }
                } else if (action === 'append') {
                    newText = newText.replace(selectRegex, singleSelectText + replace_text);
                    anyApplied = anyApplied || found;
                }
            }

            applied = anyApplied;
        } else {
            error = 'Invalid replacement: missing select_text for non-append action';
        }
    } catch (err) {
        error = `Replacement failed: ${err.message}`;
    }

    return {
        originalText: text,
        newText,
        replacement,
        applied,
        error,
        selectTextFound: Array.isArray(select_text) 
            ? selectTextsFound.length > 0 
            : (select_text ? text.includes(select_text) : true)
    };
}

/**
 * Check if a string contains incorrectly nested emphasis groups
 * @param {string} str - String to check
 * @returns {Object|null} Object with issue details if incorrectly nested groups found, null otherwise
 */
    checkIncorrectlyNestedGroups(str) {
    if (!str || typeof str !== 'string') return null;
    
    // Pattern to match outer group: weight::...innerWeight::content::...::
    // This detects: outerWeight::content innerWeight::emphasized:: :: (incorrect nesting)
    // The inner group has a terminator :: which breaks the outer group
    // Pattern: outerWeight:: ... innerWeight::content:: ... ::
    const nestedGroupPattern = /(-?\d+(?:\.\d+)?)::.*?(-?\d+(?:\.\d+)?)::[^:]*?::\s*::/;
    const match = str.match(nestedGroupPattern);
    
    if (match) {
        const outerWeight = match[1];
        const innerWeight = match[2];
        return {
            hasIncorrectNesting: true,
            issue: `Incorrectly nested emphasis groups: outer group "${outerWeight}::" contains inner group "${innerWeight}::...::" with terminator. Inner group terminator breaks outer group. Use legacy emphasis ({{}} or [[]]) inside weight groups, or restart outer weight after inner group.`,
            outerWeight: outerWeight,
            innerWeight: innerWeight
        };
    }
    
    return null;
}

/**
 * Check if a string contains an incomplete emphasis group
 * @param {string} str - String to check
 * @returns {Object|null} Object with issue details if incomplete group found, null otherwise
 */
    checkIncompleteEmphasisGroup(str) {
    if (!str || typeof str !== 'string') return null;
    
    const trimmed = str.trim();
    
    // Pattern to match complete emphasis group: weight::content::
    const completeGroupPattern = /^-?\d+(?:\.\d+)?::.*::$/;
    
    // Pattern to find a complete group at the start: weight::content:: (may be followed by other text)
    const completeGroupAtStartPattern = /^(-?\d+(?:\.\d+)?)::([^:]*?)::/;
    
    // If the whole string is a complete group, it's valid
    if (completeGroupPattern.test(trimmed)) {
        return null;
    }
    
    // Check if it starts with a complete group (even if followed by other text)
    // Use a more robust pattern that handles content with spaces and commas
    const startsWithCompleteGroup = trimmed.match(/^(-?\d+(?:\.\d+)?)::([^:]+?)::/);
    if (startsWithCompleteGroup && startsWithCompleteGroup.index === 0) {
        // There's a complete group at the start
        const afterCompleteGroup = trimmed.substring(startsWithCompleteGroup[0].length);
        // If there's more content after, check if it contains incomplete groups
        if (afterCompleteGroup.trim()) {
            // Recursively check the remaining part for incomplete groups
            const remainingIssue = this.checkIncompleteEmphasisGroup(afterCompleteGroup.trim());
            if (remainingIssue) {
                return remainingIssue;
            }
        }
        return null; // The starting group is complete, and remaining content is valid
    }
    
    // Check if it starts with weight:: but doesn't end with ::
    const startsWithWeightPattern = /^(-?\d+(?:\.\d+)?)::/;
    if (startsWithWeightPattern.test(trimmed)) {
        const match = trimmed.match(startsWithWeightPattern);
        const weight = match[1];
        
        // Check if it ends with ::
        if (!trimmed.endsWith('::')) {
            return {
                hasIncomplete: true,
                issue: `Incomplete emphasis group: starts with "${weight}::" but missing end marker "::"`,
                weight: weight
            };
        }
        
        // If it ends with ::, check if there's content between
        const afterStart = trimmed.substring(match[0].length);
        if (afterStart === '::' || afterStart.trim() === '') {
            return {
                hasIncomplete: true,
                issue: `Incomplete emphasis group: "${weight}::" with no content before end marker`,
                weight: weight
            };
        }
    }
    
    // Check if it ends with :: but doesn't start with weight::
    if (trimmed.endsWith('::') && !startsWithWeightPattern.test(trimmed)) {
        // Check if it starts with just ::
        if (trimmed.startsWith('::')) {
            return {
                hasIncomplete: true,
                issue: `Incomplete emphasis group: starts with "::" but missing start weight (e.g., "2.4::")`
            };
        }
        
        // Check if there's a :: somewhere but not at the start with weight
        const firstColonIndex = trimmed.indexOf('::');
        if (firstColonIndex > 0) {
            const beforeColons = trimmed.substring(0, firstColonIndex).trim();
            // If before colons is not a number, it's incomplete
            if (!beforeColons.match(/^-?\d+(?:\.\d+)?$/)) {
                return {
                    hasIncomplete: true,
                    issue: `Incomplete emphasis group: has "::" but missing start weight (e.g., "2.4::") before it`
                };
            }
        }
    }
    
    // Check for partial group markers (has :: but not complete)
    // Only flag if there's a clear attempt at emphasis syntax (starts with number:: or ends with ::)
    const colonCount = (trimmed.match(/::/g) || []).length;
    if (colonCount > 0) {
        const hasWeightStart = trimmed.match(/^-?\d+(?:\.\d+)?::/);
        const hasEndMarker = trimmed.endsWith('::');
        
        // If it has :: markers and either starts with weight:: or ends with ::, but isn't complete
        if ((hasWeightStart || hasEndMarker) && !completeGroupPattern.test(trimmed)) {
            // This case should already be caught above, but double-check
            if (hasWeightStart && !hasEndMarker) {
                // Already caught above
                return null;
            }
            if (hasEndMarker && !hasWeightStart) {
                // Already caught above
                return null;
            }
        }
    }
    
    return null;
}

/**
 * Checks if "::" in select_text is part of a syntax element (emphasis group delimiter)
 * @param {string} selectText - The select_text to check
 * @returns {Object|null} Returns an object with issue description if detected, null otherwise
 */
    checkSyntaxElementDoubleColon(selectText) {
    if (!selectText || typeof selectText !== 'string') {
        return null;
    }
    
    const trimmed = selectText.trim();
    
    // Check if select_text is just "::" (with or without spaces) - this is invalid
    // because "::" appears in ALL emphasis groups like "1.5::text::, 2.0::word::"
    if (/^\s*::\s*$/.test(selectText)) {
        return {
            issue: `Cannot select syntax element "::" - "::" is the emphasis group delimiter and appears in ALL emphasis groups (e.g., "1.5::text::, 2.0::word::"). Select specific content instead.`
        };
    }
    
    // Pattern for valid emphasis groups: weight::content ::
    // Weight can be positive (1.5), negative (-2.0), or decimal (0.7)
    const validEmphasisGroupPattern = /^-?\d+(\.\d+)?::/;
    
    // Check if select_text starts with "::" but is NOT a valid emphasis group pattern
    // This catches cases like "::text" or "::something" without a weight prefix
    // Valid emphasis groups start with a number (weight), not just "::"
    if (trimmed.startsWith('::') && !validEmphasisGroupPattern.test(trimmed)) {
        return {
            issue: `Cannot select syntax element starting with "::" - "::" is the emphasis group delimiter. Select the entire group (e.g., "1.5::content ::") or content inside the group (without "::" markers).`
        };
    }
    
    return null;
}

/**
 * Validates text replacements for overlaps and invalid selectors
 * @param {Array} replacements - Array of replacements to validate
 * @param {string} text - Original text to validate against
 * @param {string} path - Path identifier automatically determined from textReplacements structure
 * @returns {Object} Validation results
 */
    validateTextReplacements(replacements, text, path = 'unknown') {
    const results = [];
    // Track selectors by action type: { select_text: { action: 'replace'|'append', index: number } }
    const usedSelectors = new Map();
    const failures = [];
    const warnings = [];

    for (let i = 0; i < replacements.length; i++) {
        const replacement = replacements[i];
        
        // Check if replacement is a valid object
        if (typeof replacement !== 'object' || replacement === null || Array.isArray(replacement)) {
            const invalidType = Array.isArray(replacement) ? 'array' : typeof replacement;
            results.push({
                index: i,
                path: path,
                replacement,
                status: 'fail',
                issues: [`Invalid replacement type: expected object, got ${invalidType}`],
                selectTextFound: false
            });
            failures.push({
                index: i,
                path: path,
                action: '(unknown)',
                select_text: undefined,
                replace_text: undefined,
                reason: `Invalid replacement: ${JSON.stringify(replacement)}`,
                issues: [`Invalid replacement type: expected object, got ${invalidType}`],
                failureType: 'OTHER',
                rawReplacement: replacement
            });
            continue;
        }
        
        const { select_text, segment_index, action: rawAction = 'replace', replace_text, reason } = replacement;
        // Normalize action to lowercase for consistency
        const action = typeof rawAction === 'string' ? rawAction.toLowerCase() : rawAction;

        let status = 'pass';
        let issues = [];

        // Skip ALL select_text validation if segment_index is missing (already caught by validateSegmentIndex)
        // Only validate select_text if segment_index was present (meaning Tendai Hydration should have worked)
        const hasSegmentIndex = segment_index !== null && segment_index !== undefined;
        
        if (!hasSegmentIndex) {
            // Skip all select_text validation - the missing segment_index error is already reported
            // Just record the failure and move on
            if (status === 'pass' && action !== 'append') {
                // This shouldn't happen if validateSegmentIndex is working, but just in case
                status = 'fail';
                issues.push(`Missing segment_index for ${action} action. segment_index is REQUIRED for ALL actions.`);
            }
        } else if (action !== 'append' && !select_text) {
            // segment_index was present but Tendai Hydration failed - segment_index doesn't correspond to valid text
            status = 'fail';
            const segIdx = Array.isArray(segment_index) ? `[${segment_index.join(', ')}]` : String(segment_index);
            issues.push(`segment_index ${segIdx} does not correspond to valid text in prompt.`);
        } else if (select_text) {
            // segment_index was present and Tendai hydration succeeded - validate the select_text
            const selectTexts = Array.isArray(select_text) ? select_text : [select_text];
            const missingTexts = [];

            // Check if each select_text exists in current text state
            // If Tendai hydration succeeded (select_text was set from segment_index), trust that segment_index is valid
            // Segments with nested emphasis groups may be parsed differently than they appear in original text,
            // so we rely on Tendai hydration validation rather than strict text matching
            // For APPEND actions, we still verify text exists since they need to find anchor points
            if (action === 'append') {
                selectTexts.forEach((singleSelectText) => {
                    if (!singleSelectText) return;
                    if (!text.includes(singleSelectText)) {
                        missingTexts.push(singleSelectText);
                    }
                });
            }
            // For DELETE and REPLACE: if Tendai hydration succeeded, segment_index was already validated - trust it
            
            // Continue with other validations for all actions
            selectTexts.forEach((singleSelectText) => {
                if (!singleSelectText) return;

                // 🚨 Check for protected content (artist: or style: tags)
                const lowerSelectText = singleSelectText.toLowerCase();
                if (lowerSelectText.includes('artist:')) {
                    status = 'fail';
                    issues.push(`FORBIDDEN: Cannot select or modify protected tags (artist:) - "${singleSelectText}"`);
                }

                // 🚨 Check for invalid selector values (emphasis group delimiters with "::")
                const syntaxElementCheck = this.checkSyntaxElementDoubleColon(singleSelectText);
                if (syntaxElementCheck) {
                    status = 'fail';
                    issues.push(`Invalid selector value: ${syntaxElementCheck.issue}`);
                }

                // Check for overlapping selectors with action-aware logic
                for (const [usedSelectorKey, usedInfo] of usedSelectors.entries()) {
                    const usedSelectTexts = Array.isArray(usedSelectorKey) ? usedSelectorKey : [usedSelectorKey];
                    
                    for (const usedSelectText of usedSelectTexts) {
                        if (!usedSelectText) continue;
                        
                        // Check if selectors overlap (one contains the other or they're equal)
                        const overlaps = usedSelectText === singleSelectText || 
                                        usedSelectText.includes(singleSelectText) || 
                                        singleSelectText.includes(usedSelectText);
                        
                        if (overlaps) {
                            // Multiple appends selecting the same value - allow with warning
                            if (action === 'append' && usedInfo.action === 'append') {
                                warnings.push({
                                    index: i,
                                    path: path,
                                    action: action,
                                    select_text: singleSelectText,
                                    replace_text: replace_text,
                                    reason: reason || '(not provided)',
                                    warning: `Multiple appends selecting the same value "${singleSelectText}" - will be merged and applied at once`
                                });
                                // Don't fail, just continue
                            }
                            // Multiple replaces overlapping - fail
                            else if (action === 'replace' && usedInfo.action === 'replace') {
                                status = 'fail';
                                issues.push(`Overlapping replace selector detected with "${usedSelectText}" (used in replacement ${usedInfo.index})`);
                            }
                            // Append after replace - allow with warning
                            else if (action === 'append' && usedInfo.action === 'replace') {
                                warnings.push({
                                    index: i,
                                    path: path,
                                    action: action,
                                    select_text: singleSelectText,
                                    replace_text: replace_text,
                                    reason: reason || '(not provided)',
                                    warning: `Append will be applied to text that was replaced in replacement ${usedInfo.index} - the replaced text will be appended to`
                                });
                                // Don't fail, just continue
                            }
                            // Replace overlapping with append - deconflict based on order
                            // APPEND uses select_text as anchor (inserts AFTER segment), REPLACE modifies the segment
                            else if (action === 'replace' && usedInfo.action === 'append') {
                                // REPLACE comes AFTER APPEND on same segment
                                // The Tendai hydration system will handle this by updating APPEND's select_text to match
                                // the replaced segment text, so APPEND still anchors correctly after REPLACE
                                warnings.push({
                                    index: i,
                                    path: path,
                                    action: action,
                                    select_text: singleSelectText,
                                    replace_text: replace_text,
                                    reason: reason || '(not provided)',
                                    warning: `REPLACE after APPEND on same segment "${usedSelectText}" - Tendei to Tendai Hydration will update APPEND anchor to replaced segment text`
                                });
                                // Allow this - Tendei to Tendai Hydration system handles deconfliction
                            }
                        }
                    }
                }
            });

            // Report missing texts
            if (missingTexts.length > 0) {
                status = 'fail';
                const segIdx = Array.isArray(segment_index) ? `[${segment_index.join(', ')}]` : String(segment_index);
                const missingList = missingTexts.length === 1 ? `"${missingTexts[0]}"` : missingTexts.map(t => `"${t}"`).join(', ');
                issues.push(`segment_index ${segIdx} does not correspond to valid text in prompt: ${missingList}`);
            }

            // Add all select_texts to usedSelectors (track action and index)
            if (selectTexts.length > 0) {
                const selectorKey = selectTexts.length === 1 ? selectTexts[0] : selectTexts;
                usedSelectors.set(selectorKey, { action: action, index: i });
            }
        }
        // Note: If action is 'append' and hasSegmentIndex but !select_text, that's OK (append doesn't need select_text)
        // Check for missing replace_text on replace/append actions (delete doesn't need replace_text)
        // replace_text must be present (not undefined/null) and non-empty for replace/append
        if ((action === 'replace' || action === 'append') && (replacement.replace_text === undefined || replacement.replace_text === null || replacement.replace_text === '')) {
            status = 'fail';
            issues.push(`Missing replace_text for ${action} action - replace_text is REQUIRED for replace/append actions`);
        }

        // Check for incorrectly provided replace_text on delete actions (should be omitted)
        if (action === 'delete' && replacement.replace_text !== undefined && replacement.replace_text !== null && replacement.replace_text !== '') {
            // This is a warning, not a failure - replace_text will be ignored
            warnings.push({
                index: i,
                path: path,
                action: action,
                select_text: select_text,
                replace_text: replace_text,
                reason: reason || '(not provided)',
                warning: `DELETE action should not have replace_text - replace_text will be ignored for delete actions`
            });
        }

        // 🚨 Check for incorrectly nested groups in select_text (only if segment_index was present)
        if (hasSegmentIndex && select_text) {
            const selectNested = this.checkIncorrectlyNestedGroups(select_text);
            if (selectNested) {
                status = 'fail';
                issues.push(`INCORRECTLY NESTED EMPHASIS GROUPS in select_text: ${selectNested.issue}`);
            }
        }

        // 🚨 Check for incorrectly nested groups in replace_text
        if (replace_text) {
            const replaceNested = this.checkIncorrectlyNestedGroups(replace_text);
            if (replaceNested) {
                status = 'fail';
                issues.push(`INCORRECTLY NESTED EMPHASIS GROUPS in replace_text: ${replaceNested.issue}`);
            }
        }

        // Note: select_text is generated by the Tendai hydration system from parsed segments
        // It doesn't need to be validated for complete emphasis groups - it can be any text from the segment

        // 🚨 Check for incomplete emphasis groups in replace_text
        if (replace_text) {
            const replaceIncomplete = this.checkIncompleteEmphasisGroup(replace_text);
            if (replaceIncomplete) {
                status = 'fail';
                issues.push(`INCOMPLETE EMPHASIS GROUP in replace_text: ${replaceIncomplete.issue}. Replacement must be a complete group (e.g., "2.4::content ::") or content without markers.`);
            }
        }

        const resultEntry = {
            index: i,
            path: path,
            // Removed: full replacement object - AI already has this from tool call
            status,
            issues,
            selectTextFound: select_text ? text.includes(select_text) : true,
            action: action,
            select_text: select_text || (action === 'append' ? undefined : null),
            replace_text: replace_text
        };
        
        results.push(resultEntry);
        
        // Build detailed failure entry
        if (status === 'fail') {
            failures.push({
                index: i,
                path: path,
                action: action,
                segment_index: segment_index !== null && segment_index !== undefined ? segment_index : null,
                select_text: select_text && select_text.length > 100 
                    ? select_text.substring(0, 100) + '...' 
                    : (select_text || (action === 'append' ? undefined : null)),
                replace_text: replace_text && replace_text.length > 100 
                    ? replace_text.substring(0, 100) + '...' 
                    : (replace_text || (action === 'delete' ? undefined : null)),
                reason: reason || '(not provided)',
                issues: issues,
                failureType: this.determineFailureType(issues)
            });
        }
    }

    const overallStatus = results.every(r => r.status === 'pass') ? 'pass' : 'fail';
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
    const passedCount = results.filter(r => r.status === 'pass').length;
    const failedCount = results.filter(r => r.status === 'fail').length;

    // Build detailed failure summary
    let failureDetails = null;
    if (overallStatus === 'fail') {
        const failuresByType = this.groupFailuresByType(failures);
        failureDetails = {
            failedCount: failedCount,
            passedCount: passedCount,
            totalCount: results.length,
            failuresByType: failuresByType,
            failures: failures.map(f => ({
                index: f.index,
                path: f.path,
                action: f.action,
                select_text: f.select_text && f.select_text.length > 50 ? f.select_text.substring(0, 50) + '...' : f.select_text,
                replace_text: f.replace_text,
                reason: f.reason,
                issues: f.issues,
                failureType: f.failureType
            })),
            detailedMessage: this.buildFailureMessage(failures, failuresByType)
        };
    }

    return {
        overallStatus,
        totalIssues,
        results,
        failures: failureDetails,
        warnings: warnings.length > 0 ? warnings : null,
        summary: `${passedCount}/${results.length} replacements passed validation` +
                 (overallStatus === 'fail' ? ` (${failedCount} failed)` : '') +
                 (warnings.length > 0 ? ` (${warnings.length} warnings)` : '')
    };
}

/**
 * Determine the primary failure type from issues
 */
    determineFailureType(issues) {
    if (issues.some(i => i.includes('Invalid replacement type'))) return 'INVALID_STRUCTURE';
    if (issues.some(i => i.includes('INCORRECTLY NESTED EMPHASIS GROUPS'))) return 'INCORRECTLY_NESTED_GROUPS';
    if (issues.some(i => i.includes('INCOMPLETE EMPHASIS GROUP'))) return 'INCOMPLETE_EMPHASIS_GROUP';
    if (issues.some(i => i.includes('not found'))) return 'TEXT_NOT_FOUND';
    if (issues.some(i => i.includes('FORBIDDEN'))) return 'PROTECTED_CONTENT';
    if (issues.some(i => i.includes('Overlapping'))) return 'OVERLAPPING_SELECTOR';
    if (issues.some(i => i.includes('Missing segment_index'))) return 'MISSING_SELECT_TEXT';
    if (issues.some(i => i.includes('Failed to hydrate Tenei text replacement (segment_index) to Tendai'))) return 'TENDAI_HYDRATION_ERROR';
    if (issues.some(i => i.includes('Missing replace_text'))) return 'MISSING_REPLACE_TEXT';
    return 'OTHER';
}

/**
 * Group failures by type for summary
 */
    groupFailuresByType(failures) {
    const grouped = {};
    for (const failure of failures) {
        const type = failure.failureType;
        if (!grouped[type]) {
            grouped[type] = [];
        }
        grouped[type].push(failure);
    }
    return grouped;
}

/**
 * Build a detailed failure message
 */
    buildFailureMessage(failures, failuresByType) {
    const messages = [];
    
    messages.push(`VALIDATION FAILED: ${failures.length} replacement(s) have issues:\n`);
    
    // Group by type and provide specific guidance
    if (failuresByType.INVALID_STRUCTURE) {
        messages.push(`\n🚨 INVALID STRUCTURE (${failuresByType.INVALID_STRUCTURE.length} failures):`);
        messages.push('   These are not valid replacement objects (wrong data type or structure).');
        failuresByType.INVALID_STRUCTURE.forEach(f => {
            const path = f.path || '--';
            messages.push(`   [${path}:${f.index}] ${f.reason}`);
            if (f.rawReplacement) {
                const rawStr = JSON.stringify(f.rawReplacement);
                const preview = rawStr.length > 100 ? rawStr.substring(0, 100) + '...' : rawStr;
                messages.push(`       Raw input: ${preview}`);
            }
        });
        messages.push('   → Fix: Ensure each replacement is a valid object (not string, array, null, or undefined)');
    }
    
    if (failuresByType.TEXT_NOT_FOUND) {
        messages.push(`\n📍 TEXT NOT FOUND (${failuresByType.TEXT_NOT_FOUND.length} failures):`);
        messages.push('   These Tsubo (text replacements) reference segment_index values that don\'t exist or map to text not in the current prompt.');
        failuresByType.TEXT_NOT_FOUND.forEach(f => {
            const path = f.path || '--';
            const segIdx = f.segment_index !== null && f.segment_index !== undefined ? `segment_index ${f.segment_index}` : 'segment_index (missing)';
            const selectPreview = f.select_text && f.select_text.length > 60 ? f.select_text.substring(0, 60) + '...' : (f?.select_text || '(could not hydrate Tanei to Tendai)');
            messages.push(`   [${path}:${f.index}] ${segIdx} → "${selectPreview}"`);
            messages.push(`       Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: For EACH of these, either (a) DROP the replacement, or (b) change it to an APPEND (use segment_index: -1 for append-to-end).');
        messages.push('   → Fix: Verify all segment_index values point to valid segments in the ORIGINAL prompts (0-based integers, or floats like 0.1 for inner items).');
    }
    
    if (failuresByType.PROTECTED_CONTENT) {
        messages.push(`\n🚫 PROTECTED CONTENT (${failuresByType.PROTECTED_CONTENT.length} failures):`);
        messages.push('   These Tsubo (text replacements) attempt to modify forbidden tags (artist:, style:).');
        failuresByType.PROTECTED_CONTENT.forEach(f => {
            const path = f.path || '--';
            const selectPreview = f.select_text && f.select_text.length > 60 ? f.select_text.substring(0, 60) + '...' : (f?.select_text || '(not provided)');
            messages.push(`   [${path}:${f.index}] "${selectPreview}"`);
            messages.push(`       Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Remove or modify replacements that touch protected content');
    }
    
    if (failuresByType.OVERLAPPING_SELECTOR) {
        messages.push(`\n⚠️ OVERLAPPING SELECTORS (${failuresByType.OVERLAPPING_SELECTOR.length} failures):`);
        messages.push('   These Tsubo (text replacements) overlap with each other (one contains another).');
        failuresByType.OVERLAPPING_SELECTOR.forEach(f => {
            const path = f.path || '--';
            const selectPreview = f.select_text && f.select_text.length > 60 ? f.select_text.substring(0, 60) + '...' : (f?.select_text || '(not provided)');
            messages.push(`   [${path}:${f.index}] "${selectPreview}"`);
            messages.push(`       Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Use non-overlapping, unique text segments for each replacement');
    }
    
    if (failuresByType.MISSING_SELECT_TEXT) {
        messages.push(`\n❌ MISSING SEGMENT_INDEX (${failuresByType.MISSING_SELECT_TEXT.length} failures):`);
        messages.push('   These Tsubo (text replacements) are missing the required segment_index field for replace/delete actions.');
        failuresByType.MISSING_SELECT_TEXT.forEach(f => {
            const path = f.path || '--';
            const segIdx = f.segment_index !== null && f.segment_index !== undefined ? `segment_index: ${f.segment_index}` : 'segment_index: (missing)';
            messages.push(`   [${path}:${f.index}] Action: ${f.action}, ${segIdx}, Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Add segment_index field for ALL actions (replace/delete/append). Use 0-based segment index (integer), or float like 0.1 for inner items, or -1 for append-to-end.');
    }
    
    if (failuresByType.HYDRATION_ERROR) {
        messages.push(`\n⚠️ TENDAI HYDRATION ERROR (${failuresByType.HYDRATION_ERROR.length} failures):`);
        messages.push('   These Tsubo have valid segment_index values but failed to hydrate from Tanei to Tendai.');
        messages.push('   This usually means the segment_index does not correspond to a valid segment in the prompt.');
        failuresByType.HYDRATION_ERROR.forEach(f => {
            const path = f.path || '--';
            const segIdx = f.segment_index !== null && f.segment_index !== undefined 
                ? (Array.isArray(f.segment_index) ? `[${f.segment_index.join(', ')}]` : String(f.segment_index))
                : '(missing)';
            messages.push(`   [${path}:${f.index}] Action: ${f.action}, segment_index: ${segIdx}, Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Verify segment_index values correspond to valid segments in the ORIGINAL prompts (0-based integers, or floats like 0.1 for inner items).');
    }
    
    if (failuresByType.MISSING_REPLACE_TEXT) {
        messages.push(`\n❌ MISSING REPLACE_TEXT (${failuresByType.MISSING_REPLACE_TEXT.length} failures):`);
        messages.push('   These Tsubo (text replacements) are missing the required replace_text field.');
        messages.push('   Note: replace_text is required for replace and append actions (delete actions don\'t need it).');
        failuresByType.MISSING_REPLACE_TEXT.forEach(f => {
            const path = f.path || '--';
            const segIdx = f.segment_index !== null && f.segment_index !== undefined 
                ? (Array.isArray(f.segment_index) ? `[${f.segment_index.join(', ')}]` : String(f.segment_index))
                : (f.action === 'append' ? '(append to end)' : '(not provided)');
            messages.push(`   [${path}:${f.index}] Action: ${f.action}, segment_index: ${segIdx}`);
            messages.push(`       Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Add replace_text field for replace/append actions (what text to use)');
    }
    
    if (failuresByType.INCORRECTLY_NESTED_GROUPS) {
        messages.push(`\n🚨 INCORRECTLY NESTED EMPHASIS GROUPS (${failuresByType.INCORRECTLY_NESTED_GROUPS.length} failures):`);
        messages.push('   These Tsubo (text replacements) have nested weight groups where the inner group has a terminator that breaks the outer group.');
        messages.push('   Example of incorrect pattern: "2.4::content 1.5::emphasized:: ::" (inner group terminator breaks outer)');
        failuresByType.INCORRECTLY_NESTED_GROUPS.forEach(f => {
            const path = f.path || '--';
            const selectPreview = f.select_text && f.select_text.length > 60 ? f.select_text.substring(0, 60) + '...' : (f?.select_text || '(not provided)');
            const replacePreview = f.replace_text && f.replace_text.length > 60 ? f.replace_text.substring(0, 60) + '...' : (f.replace_text || '(not provided)');
            messages.push(`   [${path}:${f.index}] select_text: "${selectPreview}"`);
            if (f.replace_text) {
                messages.push(`            replace_text: "${replacePreview}"`);
            }
            messages.push(`       Issues: ${f.issues.join('; ')}`);
            messages.push(`       Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Use legacy emphasis inside weight groups: "2.4::content {{emphasized}} rest ::" (no nested weight group)');
        messages.push('   → Fix: OR restart outer weight after inner: "2.4::content 1.5::emphasized 2.4::rest ::" (restart outer weight)');
        messages.push('   → Fix: Avoid nesting weight groups when possible - use legacy {{}} or [[]] instead');
    }
    
    if (failuresByType.INCOMPLETE_EMPHASIS_GROUP) {
        messages.push(`\n🚨 INCOMPLETE EMPHASIS GROUP (${failuresByType.INCOMPLETE_EMPHASIS_GROUP.length} failures):`);
        messages.push('   These Tsubo (text replacements) have incomplete emphasis groups (missing start or end markers).');
        messages.push('   Emphasis groups must be complete: "2.4::content ::" (with both start and end markers)');
        messages.push('   OR select/replace content inside the group (without markers).');
        failuresByType.INCOMPLETE_EMPHASIS_GROUP.forEach(f => {
            const path = f.path || '--';
            const selectPreview = f.select_text && f.select_text.length > 60 ? f.select_text.substring(0, 60) + '...' : (f?.select_text || '(not provided)');
            const replacePreview = f.replace_text && f.replace_text.length > 60 ? f.replace_text.substring(0, 60) + '...' : (f.replace_text || '(not provided)');
            messages.push(`   [${path}:${f.index}] select_text: "${selectPreview}"`);
            if (f.replace_text) {
                messages.push(`            replace_text: "${replacePreview}"`);
            }
            messages.push(`       Issues: ${f.issues.join('; ')}`);
            messages.push(`       Reason: ${f.reason || '(not provided)'}`);
        });
        messages.push('   → Fix: Select the ENTIRE group (e.g., "2.4::content ::") or select content INSIDE the group (without markers)');
        messages.push('   → Fix: Replacements must be complete groups (e.g., "2.4::new content ::") or content without markers');
    }
    
    if (failuresByType.OTHER) {
        messages.push(`\n⚠️ OTHER ISSUES (${failuresByType.OTHER.length} failures):`);
        failuresByType.OTHER.forEach(f => {
            const path = f.path || '--';
            messages.push(`   [${path}:${f.index}] ${f.issues.join(', ')}`);
            if (f.reason && !f.reason.startsWith('Invalid replacement:')) {
                messages.push(`       Reason: ${f.reason}`);
            } else if (f.reason && f.reason.startsWith('Invalid replacement:')) {
                // Show the raw malformed input
                messages.push(`       ${f.reason}`);
            }
            if (f.rawReplacement && typeof f.rawReplacement !== 'object') {
                messages.push(`       Raw input: ${JSON.stringify(f.rawReplacement)}`);
            }
        });
        messages.push('   → Fix: Ensure replacement is a valid object with proper structure');
    }
    
    return messages.join('\n');
}


/**
 * Handles publishAnalysisResults tool call - validates and stores analysis
 * @param {Object} params - Tool parameters with AI's analysis
 * @param {Object} buildOptions - Build options
 * @returns {Object} Validation results
 */
    handlePublishAnalysisResults(params, buildOptions = {}) {
    const { existing_context, prompt_breakdown, image_analysis, prompt_structure } = params;
    
    console.log('📊 Analysis results published');
    
    // Collect validation results
    const validationResults = {
        existing_context: { provided: !!existing_context, valid: false, error: null },
        location: { provided: false, valid: false, error: null },
        scene_type: { provided: false, valid: false, error: null, value: null },
        prompt_breakdown: { provided: !!prompt_breakdown, valid: true, error: null },
        image_analysis: { provided: !!image_analysis, valid: true, error: null },
        prompt_structure: { provided: !!prompt_structure, valid: true, error: null }
    };
    
    let firstError = null;
    let errorField = null;
    
    // Validate existing_context
    if (!existing_context) {
        validationResults.existing_context.error = 'Missing required field';
        if (!firstError) {
            firstError = 'Missing required field: existing_context';
            errorField = 'existing_context';
        }
    } else {
        validationResults.existing_context.valid = true;
        
        // Validate location
        if (!existing_context.location) {
            validationResults.location.error = 'Missing required field: existing_context.location (scene_type is critical for context filtering)';
            if (!firstError) {
                firstError = 'Missing required field: existing_context.location';
                errorField = 'location';
            }
        } else {
            validationResults.location.provided = true;
            
            // Validate scene_type
            if (!existing_context.location.scene_type) {
                validationResults.scene_type.error = 'Missing required field: existing_context.location.scene_type';
                if (!firstError) {
                    firstError = 'Missing required field: existing_context.location.scene_type';
                    errorField = 'scene_type';
                }
            } else {
                validationResults.scene_type.provided = true;
                validationResults.scene_type.value = existing_context.location.scene_type;
                
                // Validate scene_type enum
                const validSceneTypes = ['indoor', 'outdoor', 'mixed', 'unknown'];
                if (!validSceneTypes.includes(existing_context.location.scene_type)) {
                    validationResults.scene_type.error = `Invalid value: "${existing_context.location.scene_type}". Must be one of: ${validSceneTypes.join(', ')}`;
                    validationResults.scene_type.valid = false;
                    if (!firstError) {
                        firstError = `Invalid scene_type: ${existing_context.location.scene_type}. Must be one of: ${validSceneTypes.join(', ')}`;
                        errorField = 'scene_type';
                    }
                } else {
                    validationResults.scene_type.valid = true;
                    validationResults.location.valid = true;
                }
            }
        }
    }
    
    // If there are validation errors, return detailed markdown response
    if (firstError) {
        const errorMarkdown = [
            '## ❌ Validation Failed',
            '',
            `**Primary Error in ${errorField}:** ${firstError}`,
            '',
            '### Validation Status Table',
            '',
            '| Field | Provided | Status | Error |',
            '|-------|----------|--------|-------|'
        ];
        
        // Add rows for each field
        Object.entries(validationResults).forEach(([field, result]) => {
            const provided = result.provided ? '✅ Yes' : '❌ No';
            let status = '⚠️ Not validated';
            if (result.provided && result.valid !== undefined) {
                status = result.valid ? '✅ Valid' : '❌ Invalid';
            } else if (!result.provided && field !== 'prompt_breakdown' && field !== 'image_analysis' && field !== 'prompt_structure') {
                status = '❌ Missing';
            } else if (result.provided && (field === 'prompt_breakdown' || field === 'image_analysis' || field === 'prompt_structure')) {
                status = '✅ Provided (optional)';
            }
            
            const errorDisplay = result.error || 'None';
            const valueDisplay = result.value ? ` (value: "${result.value}")` : '';
            
            errorMarkdown.push(`| ${field}${valueDisplay} | ${provided} | ${status} | ${errorDisplay} |`);
        });
        
        errorMarkdown.push('');
        errorMarkdown.push('### Context Satisfied');
        errorMarkdown.push('');
        errorMarkdown.push('| Context Field | Status | Details |');
        errorMarkdown.push('|---------------|--------|---------|');
        
        const requiredFields = ['existing_context', 'location', 'scene_type'];
        const optionalFields = ['prompt_breakdown', 'image_analysis', 'prompt_structure'];
        
        requiredFields.forEach(field => {
            const result = validationResults[field];
            const status = result.valid ? '✅ **VALID**' : '❌ **FAILED**';
            const details = result.error || (result.valid ? 'Required field is valid' : 'Missing or invalid');
            errorMarkdown.push(`| ${field} | ${status} | ${details} |`);
        });
        
        optionalFields.forEach(field => {
            const result = validationResults[field];
            const status = result.provided ? '✅ **PROVIDED**' : '⚠️ **NOT PROVIDED**';
            const details = result.provided ? 'Optional field provided' : 'Optional field not provided (not required)';
            errorMarkdown.push(`| ${field} | ${status} | ${details} |`);
        });
        
        errorMarkdown.push('');
        errorMarkdown.push('### Error Details');
        errorMarkdown.push('');
        
        Object.entries(validationResults).forEach(([field, result]) => {
            if (result.error) {
                errorMarkdown.push(`**${field}:**`);
                errorMarkdown.push(`- ${result.error}`);
                errorMarkdown.push('');
            }
        });
        
        errorMarkdown.push('**Action Required:** Fix all validation errors and resubmit the analysis.');
        errorMarkdown.push('');
        
        return {
            error: firstError,
            validationPassed: false,
            markdown: errorMarkdown.join('\n'),
            validationDetails: validationResults
        };
    }
    
    const contextData = buildOptions?.contextData || null;
    const directive = buildOptions?.directive || null;
    const lockedReplacements = buildOptions?.locked_replacements || [];
    const userContentSections = buildOptions?.userContentSections ?? null;
    const directiveContentSections = buildOptions?.directiveContentSections ?? null;
    const topRelevantMemories = buildOptions?.topRelevantMemories || [];
    
    // Convert text sections from arrays to joined text strings
    const userContentText = userContentSections && Array.isArray(userContentSections) ? userContentSections.join('\n') : (userContentSections || null);
    const directiveContentText = directiveContentSections && Array.isArray(directiveContentSections) ? directiveContentSections.join('\n') : (directiveContentSections || null);
    
    const publishedAnalysisPayload = {
        existing_context,
        prompt_breakdown,
        image_analysis,
        prompt_structure
    };
    
    // Build task list message for next steps
    const taskListMessage = [
        '## ✅ Analysis Published Successfully',
        '',
        '**Your analysis has been accepted.** You will now receive update instructions based on your findings.',
        '',
        '## 📋 NEXT STEPS - STEP 2: PLANNING',
        '',
        '**Cross-reference**: See CORE TASK OVERVIEW (STEP 2) and Phase 7 for detailed planning guidance.',
        '',
        '### Your Tasks:',
        '1. **Review update instructions** - Context data and directives will be provided based on your analysis',
        '2. **Plan your Tsubo (text replacements)** - Document which segments to update, what tags to use, and integration approach for your Tanei package',
        '3. **Call `planTextReplacements` tool** - Fill out planned Tsubo, research tracking, and conflicts to resolve',
        '   - **Research.completed**: List all research you\'ve already done, citing the tool call number and tool name for each',
        '   - **Research.needed**: List research still needed, optionally including the tool name you plan to use',
        '   - **Do NOT create actual Tanei package yet** - this is a planning/sketchpad step',
        '   - **Optional**: Use `validateSegmentSyntax` during planning to check segment indices',
        '4. **After planning accepted** - Execution tools (`validateTextReplacement`, `completeTooling`) will become available',
        '',
        '**Available Tools Now:**',
        '- `planTextReplacements` (required for STEP 2)',
        '- All research tools (always available)',
        '',
        '**Scene Type Detected:** ' + existing_context.location.scene_type,
        '**Note**: Context data will be filtered based on scene_type (indoor/outdoor/mixed) to avoid conflicts.',
        '',
        '----------',
        '',
        ...(userContentText ? [
            userContentText,
            ''
        ] : []),
        ...(directiveContentText ? [
            directiveContentText,
            ''
        ] : []),
        // ...(topRelevantMemories && topRelevantMemories.length > 0 ? [
        //     '## 🧠 TOP RELEVANT MEMORIES',
        //     '',
        //     '| Name | Description | Category | Relevance |',
        //     '|------|-------------|----------|-----------|',
        //     ...topRelevantMemories.map(mem => {
        //         const name = mem.name || 'Unknown';
        //         // Use the pre-computed highlighted description if available, otherwise fallback
        //         let description = '';
        //         if (mem.highlightedDescription) {
        //             const snippet = mem.highlightedDescription;
        //             const isTruncated = mem.description && mem.description.length > snippet.length;
        //             description = isTruncated ? `**${snippet}**...` : `**${snippet}**`;
        //         } else if (mem.description) {
        //             // Fallback: use first 75 chars if highlightedDescription not available
        //             const snippet = mem.description.substring(0, 75);
        //             description = mem.description.length > 75 
        //                 ? `**${snippet}**...` 
        //                 : `**${snippet}**`;
        //         } else {
        //             description = 'N/A';
        //         }
        //         const category = mem.category || 'N/A';
        //         const relevance = mem.relevanceScore ? mem.relevanceScore.toFixed(1) : 'N/A';
        //         return `| ${name} | ${description} | ${category} | ${relevance} |`;
        //     }),
        //     ''
        // ] : [])
    ].join('\n');
    
    return {
        validationPassed: true,
        markdown: taskListMessage,
        scene_type: existing_context.location.scene_type,
        // Return full data block to be saved to compiled_prompt
        published_analysis: {
            ...publishedAnalysisPayload,
            timestamp: Date.now()
        }
    };
}

/**
 * Handles planTextReplacements tool call - validates planning data
 * @param {Object} params - Tool parameters with planning data
 * @param {Object} buildOptions - Build options
 * @returns {Object} Validation results
 */
    handlePlanTextReplacements(params, buildOptions = {}) {
    const { planned_changes, research, conflicts_to_resolve } = params;
    
    console.log('📋 Text replacement plan received');
    
    // Validate required fields
    if (!planned_changes || !Array.isArray(planned_changes) || planned_changes.length === 0) {
        const errorMarkdown = [
            '## ❌ Validation Failed',
            '',
            '**Error:** Missing or empty required field: `planned_changes`',
            '',
            '### Validation Summary',
            '',
            '| Field | Status | Details |',
            '|-------|--------|---------|',
            '| `planned_changes` | ❌ **FAILED** | Missing or empty array |',
            '| `research` | ⚠️ Not validated | Validation skipped due to missing planned_changes |',
            '| `conflicts_to_resolve` | ⚠️ Not validated | Validation skipped due to missing planned_changes |',
            '',
            '**Action Required:** Provide a non-empty `planned_changes` array with at least one planned change.',
            ''
        ].join('\n');
        
        return {
            error: 'Missing or empty required field: planned_changes',
            validationPassed: false,
            markdown: errorMarkdown
        };
    }
    
    // Validate each planned change and collect validation results
    const validCategories = ['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'];
    const validActions = ['replace', 'append', 'delete'];
    
    const validationResults = [];
    let firstError = null;
    let errorIndex = -1;
    
    for (let i = 0; i < planned_changes.length; i++) {
        const change = planned_changes[i];
        const result = {
            index: i,
            category: change.category || '',
            action: change.action || '',
            status: 'pending',
            errors: []
        };
        
        // Validate category
        if (!change.category || !validCategories.includes(change.category)) {
            const errorMsg = `Invalid category: "${change.category || 'missing'}". Must be one of: ${validCategories.join(', ')}`;
            result.errors.push(errorMsg);
            if (!firstError) {
                firstError = errorMsg;
                errorIndex = i;
            }
        }
        
        // Validate action
        if (!change.action || !validActions.includes(change.action)) {
            const errorMsg = `Invalid action: "${change.action || 'missing'}". Must be one of: ${validActions.join(', ')}`;
            result.errors.push(errorMsg);
            if (!firstError) {
                firstError = errorMsg;
                errorIndex = i;
            }
        }
        
        // Validate target_segments
        if (!change.target_segments || !Array.isArray(change.target_segments) || change.target_segments.length === 0) {
            const errorMsg = 'Missing or empty target_segments array';
            result.errors.push(errorMsg);
            if (!firstError) {
                firstError = errorMsg;
                errorIndex = i;
            }
        }
        
        // Validate reason
        if (!change.reason || typeof change.reason !== 'string') {
            const errorMsg = 'Missing or invalid reason (must be a string)';
            result.errors.push(errorMsg);
            if (!firstError) {
                firstError = errorMsg;
                errorIndex = i;
            }
        }
        
        // Validate emphasis_value
        if (change.emphasis_value !== undefined) {
            if (typeof change.emphasis_value !== 'number') {
                const errorMsg = `Invalid emphasis_value type: must be a number, got ${typeof change.emphasis_value}`;
                result.errors.push(errorMsg);
                if (!firstError && !result.errors.some(e => e.includes('reason'))) {
                    firstError = errorMsg;
                    errorIndex = i;
                }
            } else if (change.emphasis_value < -5 || change.emphasis_value > 8) {
                const errorMsg = `Invalid emphasis_value range: ${change.emphasis_value} (must be between -5 and 8)`;
                result.errors.push(errorMsg);
                if (!firstError && !result.errors.some(e => e.includes('reason'))) {
                    firstError = errorMsg;
                    errorIndex = i;
                }
            }
        }
        
        // Set status
        if (result.errors.length === 0) {
            result.status = '✅ PASSED';
        } else {
            result.status = '❌ FAILED';
        }
        
        validationResults.push(result);
    }
    
    // If there are validation errors, return detailed markdown response
    if (firstError) {
        const errorMarkdown = [
            '## ❌ Validation Failed',
            '',
            `**Primary Error in planned_changes[${errorIndex}]:** ${firstError}`,
            '',
            '### Validation Status Table',
            '',
            '| Index | Category | Action | Status | Errors |',
            '|-------|----------|--------|--------|--------|'
        ];
        
        validationResults.forEach(result => {
            const categoryDisplay = result.category || '(missing)';
            const actionDisplay = result.action || '(missing)';
            const errorsDisplay = result.errors.length > 0 
                ? result.errors.map(e => `• ${e}`).join('<br>')
                : 'None';
            
            errorMarkdown.push(`| ${result.index} | ${categoryDisplay} | ${actionDisplay} | ${result.status} | ${errorsDisplay} |`);
        });
        
        errorMarkdown.push('');
        errorMarkdown.push('### Context Satisfied');
        errorMarkdown.push('');
        errorMarkdown.push('| Context Field | Status | Details |');
        errorMarkdown.push('|---------------|--------|---------|');
        
        const passedCount = validationResults.filter(r => r.status === '✅ PASSED').length;
        const failedCount = validationResults.filter(r => r.status === '❌ FAILED').length;
        
        errorMarkdown.push(`| Planned Changes | ⚠️ **PARTIAL** | ${passedCount} passed, ${failedCount} failed out of ${planned_changes.length} total |`);
        const researchCompleted = research?.completed?.length || 0;
        const researchNeeded = research?.needed?.length || 0;
        const researchCompletedDetails = research?.completed?.map(r => 
            typeof r === 'string' ? r : `${r.topic} (Call ${r.call_number}: ${r.tool_name})`
        ).join('; ') || 'None';
        errorMarkdown.push(`| Research | ✅ **VALID** | ${researchCompleted} completed, ${researchNeeded} needed |`);
        if (researchCompleted > 0) {
            errorMarkdown.push(`| Research Details | | ${researchCompletedDetails} |`);
        }
        errorMarkdown.push(`| Conflicts to Resolve | ✅ **VALID** | ${(conflicts_to_resolve || []).length} conflict(s) provided |`);
        errorMarkdown.push('');
        errorMarkdown.push('### Error Details');
        errorMarkdown.push('');
        
        validationResults.forEach(result => {
            if (result.errors.length > 0) {
                errorMarkdown.push(`**planned_changes[${result.index}]:**`);
                result.errors.forEach(error => {
                    errorMarkdown.push(`- ${error}`);
                });
                errorMarkdown.push('');
            }
        });
        
        errorMarkdown.push('**Action Required:** Fix all validation errors and resubmit the plan.');
        errorMarkdown.push('');
        
        // Generate concise error message for backward compatibility
        const conciseError = `Invalid data in planned_changes[${errorIndex}]: ${firstError}`;
        
        return {
            error: conciseError,
            validationPassed: false,
            markdown: errorMarkdown.join('\n'),
            validationDetails: {
                totalChanges: planned_changes.length,
                passed: passedCount,
                failed: failedCount,
                results: validationResults
            }
        };
    }
    
    // Build task list message for next steps
    const taskListMessage = [
        '## ✅ Planning Accepted',
        '',
        '**Your replacement plan has been accepted.** All execution tools are now available.',
        '',
        '## 📋 NEXT STEPS - STEP 4: EXECUTION',
        '',
        '**Cross-reference**: See CORE TASK OVERVIEW (STEP 4-5) and Phase 6 for modification system guidance.',
        '',
        '### Your Tasks:',
        '1. **Complete research** (if needed) - Use research tools to verify tags and gather information',
        '   - When you complete research, update research.completed with the tool call number and tool name',
        '   - You can plan future research in research.needed with optional tool names for tracking',
        '2. **Build `text_replacements`** - Create actual replacements based on your plan',
        '   - Use `segment_index` (0-based) to target segments from segment lists',
        '   - Use integer indices (0, 1, 2...) for outer segments',
        '   - Use float indices (0.1, 0.2...) for inner items',
        '   - **Never guess indices** - only use indices shown in segment lists',
        '   - **Avoid overlaps** - each segment can only be modified once',
        '3. **Maintain locked/chain/adaptation** - If locked Tsubo exist in Tanei, keep intent and update `segment_index`',
        '4. **Call `validateTextReplacement`** - Validate your Tanei package with complete arrays (prompt, uc, character_prompts). System verifies Tanei → Tendai hydration',
        '   - Fix any validation errors and retry if needed',
        '5. **Return metadata** - Always return `generated_image_name` and `character_names` when placeholders exist',
        '6. **Call `completeTooling`** - When finished, signal completion',
        '',
        '**Available Tools Now:**',
        '- `validateTextReplacement` (required for STEP 5)',
        '- `completeTooling` (required when finished)',
        '- All research tools (always available)',
        '- All other execution tools',
        '',
        `**Planned Changes:** ${planned_changes.length} change(s) documented`,
        `**Research:** ${(research?.completed?.length || 0)} completed, ${(research?.needed?.length || 0)} needed`,
        ...(research?.completed && research.completed.length > 0 ? [
            '',
            '**Completed Research:**',
            ...research.completed.map(r => {
                if (typeof r === 'string') {
                    return `- ${r}`;
                }
                return `- ${r.topic} (Call ${r.call_number}: ${r.tool_name})`;
            })
        ] : []),
        ...(research?.needed && research.needed.length > 0 ? [
            '',
            '**Research Needed:**',
            ...research.needed.map(r => {
                if (typeof r === 'string') {
                    return `- ${r}`;
                }
                return r.tool_name ? `- ${r.topic} (planned: ${r.tool_name})` : `- ${r.topic}`;
            })
        ] : []),
        `**Conflicts to Resolve:** ${(conflicts_to_resolve || []).length} conflict(s)`,
        ''
    ].join('\n');
    
    return {
        validationPassed: true,
        markdown: taskListMessage,
        planned_changes_count: planned_changes.length,
        // Return full data block to be saved to compiled_prompt
        replacement_plan: {
            planned_changes,
            research: research || { completed: [], needed: [] },
            conflicts_to_resolve: conflicts_to_resolve || [],
            timestamp: Date.now()
        }
    };
}

/**
 * Handles validateSegmentSyntax tool call - basic syntax validation
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Build options
 * @returns {Object} Validation results
 */
    handleValidateSegmentSyntax(params, buildOptions = {}) {
    const { segment_indices, prompt_type, character_index, reason } = params;
    
    console.log(`🔍 Validating segment syntax for ${prompt_type}${character_index !== undefined ? ` (character ${character_index})` : ''}`);
    
    // Validate required fields
    if (!segment_indices || !Array.isArray(segment_indices) || segment_indices.length === 0) {
        return {
            error: 'Missing or empty required field: segment_indices',
            validationPassed: false
        };
    }
    
    if (!prompt_type || !['prompt', 'uc', 'character'].includes(prompt_type)) {
        return {
            error: `Invalid prompt_type: ${prompt_type}. Must be one of: prompt, uc, character`,
            validationPassed: false
        };
    }
    
    if (prompt_type === 'character' && character_index === undefined) {
        return {
            error: 'character_index is required when prompt_type is "character"',
            validationPassed: false
        };
    }
    
    // Get prompts from buildOptions to validate indices exist
    const prompts = buildOptions.basePrompt ? [buildOptions.basePrompt] : [];
    const ucPrompts = buildOptions.negativePrompt ? [buildOptions.negativePrompt] : [];
    const characterPrompts = buildOptions.characterPrompts || [];
    
    // Validate each segment index format
    const { parsePromptSegments } = require('../promptSegments');
    let targetPrompt = '';
    
    if (prompt_type === 'prompt') {
        targetPrompt = prompts[0] || '';
    } else if (prompt_type === 'uc') {
        targetPrompt = ucPrompts[0] || '';
    } else if (prompt_type === 'character') {
        targetPrompt = characterPrompts[character_index]?.prompt || '';
    }
    
    const segments = parsePromptSegments(targetPrompt);
    const maxIndex = segments.length - 1;
    
    const invalidIndices = [];
    for (const idx of segment_indices) {
        if (Array.isArray(idx)) {
            // Array of indices
            for (const i of idx) {
                if (typeof i !== 'number' || i < -1 || i > maxIndex) {
                    invalidIndices.push(`[${idx.join(', ')}]`);
                    break;
                }
            }
        } else {
            // Single index
            if (typeof idx !== 'number' || idx < -1 || idx > maxIndex) {
                invalidIndices.push(idx);
            }
        }
    }
    
    if (invalidIndices.length > 0) {
        return {
            validationPassed: false,
            error: `Invalid segment indices: ${invalidIndices.join(', ')}. Valid range: -1 to ${maxIndex}`,
            max_valid_index: maxIndex,
            invalid_indices: invalidIndices
        };
    }
    
    return {
        validationPassed: true,
        markdown: 'All segment indices are valid',
        validated_count: segment_indices.length,
        max_valid_index: maxIndex
    };
}

/**
 * Handles validateTextReplacement tool call - full validation with token counting
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Build options
 * @returns {Object} Validation and token analysis results
 */
    async handleValidateTextReplacement(params, buildOptions = {}) {
        const { textReplacements, dialogs, insightMemory, errors, warnings, includeTokenAnalysis = true, terminateOnPass = false, verifyTokenCount = false, reason, generatedImageName, characterNames } = params;
        
        // Get prompts from buildOptions (injected by the system, not from AI)
        const basePrompt = buildOptions.basePrompt || params.basePrompt;
        const negativePrompt = buildOptions.negativePrompt || params.negativePrompt;
        const characterPrompts = buildOptions.characterPrompts || params.characterPrompts;

        if (reason) {
            console.log(`  [REASON] ${reason}`);
        }
        
        if (!basePrompt) {
            return {
                error: 'basePrompt is required but was not provided in buildOptions or params',
                validationPassed: false,
                autoComplete: false
            };
        }

        console.log(`   📝 Using prompts from: ${buildOptions.basePrompt ? 'buildOptions (system-injected)' : 'params (AI-provided)'}`);

        try {
            const t5TokenizerService = this.globalResources.getT5Tokenizer();
            const { parsePromptSegments } = require('../promptSegments');


            // Validate segment_index is present for ALL actions (including append with -1) before Tendai hydration
            const validateSegmentIndex = (replacements, path) => {
                if (!Array.isArray(replacements)) return [];
                const errors = [];
                replacements.forEach((rep, idx) => {
                    if (!rep) return;
                    const action = (rep.action || 'replace').toLowerCase();
                    
                    // segment_index is REQUIRED for ALL actions
                    const segIdx = rep.segment_index;
                    if (segIdx === null || segIdx === undefined) {
                        errors.push({
                            index: idx,
                            path: path,
                            action: action,
                            segment_index: null,
                            reason: rep.reason || '(not provided)',
                            issues: [`Missing segment_index for ${action} action. segment_index is REQUIRED for all actions. Use -1 for append-to-end, or provide a valid segment index.`],
                            failureType: 'MISSING_SELECT_TEXT'
                        });
                    } else if (Array.isArray(segIdx)) {
                        if (segIdx.length === 0) {
                            errors.push({
                                index: idx,
                                path: path,
                                action: action,
                                segment_index: segIdx,
                                reason: rep.reason || '(not provided)',
                                issues: [`Empty segment_index array for ${action} action. Array must contain at least one index.`],
                                failureType: 'MISSING_SELECT_TEXT'
                            });
                        } else if (action === 'replace') {
                            // For REPLACE, array must be continuous
                            const isContinuous = (arr) => {
                                // Extract outer segment indices
                                let outerIndices;
                                try {
                                    const mapped = arr.map(item => {
                                        if (typeof item === 'number') return item;
                                        if (typeof item === 'string') {
                                            const match = item.match(/^(\d+)(?:\.(\d+))?$/);
                                            return match ? parseInt(match[1], 10) : null;
                                        }
                                        return null;
                                    });
                                    if (!Array.isArray(mapped)) {
                                        console.error(`[FILTER-DEBUG] Line 5870: arr.map() returned non-array:`, typeof mapped, mapped);
                                        throw new Error(`arr.map() returned ${typeof mapped} instead of array`);
                                    }
                                    outerIndices = mapped.filter(idx => idx !== null);
                                } catch (filterError) {
                                    console.error(`[FILTER-DEBUG] Line 5870: .filter() error:`, filterError.message);
                                    console.error(`  arr:`, typeof arr, Array.isArray(arr) ? `array[${arr.length}]` : arr);
                                    throw filterError;
                                }

                                if (outerIndices.length !== arr.length) return false; // Invalid format

                                // Sort and check if sequential
                                const sorted = [...outerIndices].sort((a, b) => a - b);
                                for (let i = 1; i < sorted.length; i++) {
                                    if (sorted[i] !== sorted[i - 1] + 1) {
                                        return false;
                                    }
                                }
                                return true;
                            };

                            if (!isContinuous(segIdx)) {
                                errors.push({
                                    index: idx,
                                    path: path,
                                    action: action,
                                    segment_index: segIdx,
                                    reason: rep.reason || '(not provided)',
                                    issues: [`REPLACE action with array segment_index must be continuous (e.g., [0, 1, 2], not [0, 2, 5]). For non-continuous segments, use separate replacements or DELETE action.`],
                                    failureType: 'MISSING_SELECT_TEXT'
                                });
                            }
                        }
                        // DELETE can have non-continuous arrays - no validation needed
                    }
                });
                return errors;
            };

            // Collect segment_index validation errors (ensure always an array)
            const promptSegmentErrors = validateSegmentIndex(textReplacements.prompt || [], 'prompt');
            const ucSegmentErrors = validateSegmentIndex(textReplacements.uc || [], 'uc');
            const segmentIndexErrors = [
                ...(Array.isArray(promptSegmentErrors) ? promptSegmentErrors : []),
                ...(Array.isArray(ucSegmentErrors) ? ucSegmentErrors : [])
            ];

            // Tendai: Hydrate Tanei to Tendai using promptSegments.js
            const { hydrateTextReplacements } = require('../promptSegments');
            const hydrationResult = hydrateTextReplacements(textReplacements, {
                basePrompt,
                negativePrompt,
                characterPrompts
            });
            if (hydrationResult) {
                Object.assign(textReplacements, hydrationResult.replacements);
                // Store Tanei hydration metadata for pressure tracking
                if (!textReplacements._hydrationMetadata) {
                    textReplacements._hydrationMetadata = {};
                }
                Object.assign(textReplacements._hydrationMetadata, hydrationResult.metadata);
            }

            // Validate segment_index for character prompts (Tendai hydration already done above)
            if (textReplacements.character_prompts && Array.isArray(textReplacements.character_prompts) && Array.isArray(characterPrompts)) {
                for (let i = 0; i < textReplacements.character_prompts.length; i++) {
                    const charReplacements = textReplacements.character_prompts[i];
                    const charPrompt = characterPrompts[i];
                    if (!charReplacements || !charPrompt) continue;

                    // Validate segment_index for character prompts
                    segmentIndexErrors.push(
                        ...validateSegmentIndex(charReplacements.prompt || [], `character_prompts[${i}].prompt`),
                        ...validateSegmentIndex(charReplacements.uc || [], `character_prompts[${i}].uc`)
                    );
                }
            }

            // Build prompts with replacements
            const buildResult = this.buildPromptWithReplacements({
                basePrompt,
                negativePrompt,
                characterPrompts,
                textReplacements
            });

            // Validate all replacements against their respective texts
            // Paths are automatically determined from the textReplacements structure
            const validationResults = {
                prompt: this.validateTextReplacements(textReplacements.prompt || [], basePrompt, 'prompt'),
                uc: this.validateTextReplacements(textReplacements.uc || [], negativePrompt, 'uc'),
                characterPrompts: []
            };
            
            // Validate character prompt replacements against their respective character prompts
            // Paths are automatically determined from the structure
            if (textReplacements.character_prompts && Array.isArray(textReplacements.character_prompts)) {
                for (let i = 0; i < textReplacements.character_prompts.length; i++) {
                    const charReplacements = textReplacements.character_prompts[i];
                    const charPrompt = characterPrompts[i];
                    
                    if (charPrompt) {
                        const promptValidation = this.validateTextReplacements(
                            charReplacements.prompt || [], 
                            charPrompt.prompt || '',
                            `character_prompts[${i}].prompt`
                        );
                        const ucValidation = this.validateTextReplacements(
                            charReplacements.uc || [], 
                            charPrompt.uc || '',
                            `character_prompts[${i}].uc`
                        );
                        
                        validationResults.characterPrompts.push({
                            index: i,
                            promptValidation,
                            ucValidation,
                            overallStatus: (promptValidation.overallStatus === 'pass' && ucValidation.overallStatus === 'pass') ? 'pass' : 'fail'
                        });
                    }
                }
            }
            
            // Verify required categories are present based on enabled features
            const categoryVerificationIssues = [];
            
            // Collect all replacement categories from all text replacements
            // NOTE: Required categories MUST have at least 1 item in the base prompt
            // They CAN also have items in UC, but the requirement is satisfied if there's at least 1 in the prompt
            const allCategories = new Set();
            const promptCategories = new Set();
            const ucCategories = new Set();
            
            const collectCategories = (replacements, targetSet) => {
                if (Array.isArray(replacements)) {
                    replacements.forEach(replacement => {
                        if (replacement && replacement.replacement_category) {
                            targetSet.add(replacement.replacement_category);
                            allCategories.add(replacement.replacement_category);
                        }
                    });
                }
            };
            
            collectCategories(textReplacements.prompt || [], promptCategories);
            collectCategories(textReplacements.uc || [], ucCategories);
            if (textReplacements.character_prompts && Array.isArray(textReplacements.character_prompts)) {
                textReplacements.character_prompts.forEach(charReplacement => {
                    collectCategories(charReplacement.prompt || [], promptCategories);
                    collectCategories(charReplacement.uc || [], ucCategories);
                });
            }
            
            // Use same logic as buildCategoryRequirementNotes to determine required categories
            // Get dynamicConfig and context from buildOptions (same structure as system message builder)
            const dynamicConfig = buildOptions.dynamicConfig || {};
            const context = buildOptions.context || {};
            
            // Check if publishedAnalysis exists (has existing_context structure) or use regular context
            const publishedAnalysis = buildOptions.publishedAnalysis || null;
            const ctx = publishedAnalysis?.existing_context || context;
            
            // Check what's enabled in dynamicConfig (same as system message builder)
            const hasWeather = dynamicConfig.weather && dynamicConfig.weather !== '--' && dynamicConfig.weather !== null && dynamicConfig.weather !== false;
            const hasTime = dynamicConfig.tod && dynamicConfig.tod !== '--' && dynamicConfig.tod !== null && dynamicConfig.tod !== false;
            const hasSeason = dynamicConfig.season && dynamicConfig.season !== '--' && dynamicConfig.season !== null && dynamicConfig.season !== false;
            const hasDirective = dynamicConfig.directive && dynamicConfig.directive !== null && dynamicConfig.directive !== false;
            
            // Check holiday requirement (only required on day of or day before, same as system message builder)
            const holiday = context.season?.holiday;
            const hasHoliday = dynamicConfig.disable_holiday !== true && holiday && holiday.primaryHoliday && holiday.primaryHoliday.daysUntil <= 1;
            
            // Helper function to check if a category exists in the PROMPT (case-insensitive with variations)
            // Required categories MUST have at least 1 item in the base prompt
            // They can also have items in UC, but the requirement is satisfied if there's at least 1 in the prompt
            const hasCategoryInPrompt = (categoryName, variations = []) => {
                // Check prompt categories specifically (base prompt + character prompts)
                return Array.from(promptCategories).some(cat => {
                    if (!cat) return false;
                    const normalized = (cat || '').toLowerCase().trim();
                    const normalizedCategory = categoryName.toLowerCase().trim();
                    // Check exact match
                    if (normalized === normalizedCategory) return true;
                    // Check variations
                    for (const variation of variations) {
                        if (normalized === variation.toLowerCase() || 
                            normalized.replace(/\s+/g, '') === variation.toLowerCase().replace(/\s+/g, '') ||
                            normalized.replace(/_/g, ' ') === variation.toLowerCase().replace(/_/g, ' ')) {
                            return true;
                        }
                    }
                    return false;
                });
            };
            
            // Weather category - required if weather is enabled AND weather data is found in context
            // MUST have at least 1 item in the base prompt (can also have items in UC, but prompt is required)
            // Check both publishedAnalysis.existing_context structure (ctx.weather_condition.found) and regular context structure
            const weatherFound = (ctx.weather_condition && ctx.weather_condition.found) || 
                                (context.weather && context.weather.weather_condition && context.weather.weather_condition.found) ||
                                (context.weather && context.weather.found);
            if (hasWeather && weatherFound) {
                if (!hasCategoryInPrompt('Weather')) {
                    categoryVerificationIssues.push('Weather is enabled and weather data is found but no "Weather" category replacement found in the base prompt. You MUST add `replacement_category: "Weather"` to at least one replacement in the prompt (can be an append action). You can also add it to UC, but at least one must be in the prompt. Example: { "action": "append", "replace_text": "...", "replacement_category": "Weather" }');
                }
            }
            
            // Time of Day category - required if time is enabled AND time data is found in context
            // MUST have at least 1 item in the base prompt (can also have items in UC, but prompt is required)
            const timeFound = (ctx.time && ctx.time.found) || (context.time && context.time.found) || (context.timePeriod);
            if (hasTime && timeFound) {
                if (!hasCategoryInPrompt('Time of Day', ['timeofday', 'time_of_day'])) {
                    categoryVerificationIssues.push('Time is enabled and time data is found but no "Time of Day" category replacement found in the base prompt. You MUST add `replacement_category: "Time of Day"` to at least one replacement in the prompt (can be an append action). You can also add it to UC, but at least one must be in the prompt. Example: { "action": "append", "replace_text": "...", "replacement_category": "Time of Day" }');
                }
            }
            
            // Seasonal category - required if season is enabled AND season data is found in context
            // MUST have at least 1 item in the base prompt (can also have items in UC, but prompt is required)
            const seasonFound = (ctx.season && ctx.season.found) || (context.season && context.season.found) || (context.season);
            if (hasSeason && seasonFound) {
                if (!hasCategoryInPrompt('Seasonal')) {
                    categoryVerificationIssues.push('Season is enabled and season data is found but no "Seasonal" category replacement found in the base prompt. You MUST add `replacement_category: "Seasonal"` to at least one replacement in the prompt (can be an append action). You can also add it to UC, but at least one must be in the prompt. Example: { "action": "append", "replace_text": "...", "replacement_category": "Seasonal" }');
                }
            }
            
            // Holiday category - only required on day of (daysUntil === 0) or day before (daysUntil === 1)
            // MUST have at least 1 item in the base prompt (can also have items in UC, but prompt is required)
            const holidayFound = (ctx.holiday && ctx.holiday.found) || (holiday && holiday.found) || (holiday);
            if (hasHoliday && holidayFound) {
                if (!hasCategoryInPrompt('Holiday')) {
                    categoryVerificationIssues.push('Holiday is enabled and holiday data is found (day of or day before) but no "Holiday" category replacement found in the base prompt. You MUST add `replacement_category: "Holiday"` to at least one replacement in the prompt (can be an append action). You can also add it to UC, but at least one must be in the prompt. Example: { "action": "append", "replace_text": "...", "replacement_category": "Holiday" }');
                }
            }
            
            // Directive category - required if directive is enabled
            // MUST have at least 1 item in the base prompt (can also have items in UC, but prompt is required)
            if (hasDirective) {
                if (!hasCategoryInPrompt('Directive')) {
                    categoryVerificationIssues.push('Directive is enabled but no "Directive" category replacement found in the base prompt. You MUST add `replacement_category: "Directive"` to at least one replacement in the prompt (can be an append action) to address the user directive. You can also add it to UC, but at least one must be in the prompt. Example: { "action": "append", "replace_text": "...", "replacement_category": "Directive" }');
                }
            }
            
            // Ensure characterPrompts is always an array (defensive check)
            if (!Array.isArray(validationResults.characterPrompts)) {
                validationResults.characterPrompts = [];
            }
            
            // Calculate overall status
            const allValidationsPass = validationResults.prompt.overallStatus === 'pass' &&
                                    validationResults.uc.overallStatus === 'pass' &&
                                    validationResults.characterPrompts.every(c => c.overallStatus === 'pass') &&
                                    categoryVerificationIssues.length === 0;
            
            // Merge all results for summary
            const allResults = [
                ...(validationResults.prompt.results || []),
                ...(validationResults.uc.results || []),
                ...(Array.isArray(validationResults.characterPrompts) ? validationResults.characterPrompts.flatMap(c => [
                    ...(c.promptValidation.results || []),
                    ...(c.ucValidation.results || [])
                ]) : [])
            ];
            
            const allFailures = [
                ...segmentIndexErrors, // Pre-hydration segment_index validation errors
                ...(validationResults.prompt.failures?.failures || []),
                ...(validationResults.uc.failures?.failures || []),
                ...(Array.isArray(validationResults.characterPrompts) ? validationResults.characterPrompts.flatMap(c => [
                    ...(c.promptValidation.failures?.failures || []),
                    ...(c.ucValidation.failures?.failures || [])
                ]) : [])
            ];

            // Add category verification failures
            if (categoryVerificationIssues.length > 0) {
                categoryVerificationIssues.forEach((issue, index) => {
                    allFailures.push({
                        index: null, // Special index for category verification failures
                        path: 'category_verification',
                        action: 'category_verification',
                        select_text: null,
                        replace_text: undefined,
                        reason: issue,
                        issues: [issue],
                        failureType: 'MISSING_REQUIRED_CATEGORY',
                        rawReplacement: null
                    });
                });
            }

            // Count TEXT_NOT_FOUND failures for guidance
            let textNotFoundFailures;
            try {
                if (!Array.isArray(allFailures)) {
                    console.error(`[FILTER-DEBUG] Line 6154: allFailures is not an array:`, typeof allFailures, allFailures);
                    throw new Error(`allFailures is ${typeof allFailures} instead of array`);
                }
                textNotFoundFailures = allFailures.filter(f => f.failureType === 'TEXT_NOT_FOUND');
            } catch (filterError) {
                console.error(`[FILTER-DEBUG] Line 6154: .filter() error:`, filterError.message);
                console.error(`  allFailures:`, typeof allFailures, Array.isArray(allFailures) ? `array[${allFailures.length}]` : allFailures);
                throw filterError;
            }
            const textNotFoundCount = textNotFoundFailures.length;

            // Calculate passed count (ensure it's never negative)
            const passedCount = Math.max(0, allResults.length - allFailures.length);
            
            // Ensure all failures have path property
            const failuresWithPath = allFailures.map(f => ({
                ...f,
                path: f.path || '--'
            }));
            
            const validationResult = {
                overallStatus: allValidationsPass ? 'pass' : 'fail',
                results: allResults,
                failures: failuresWithPath.length > 0 ? {
                    failedCount: failuresWithPath.length,
                    passedCount: passedCount,
                    totalCount: allResults.length,
                    failures: failuresWithPath,
                    detailedMessage: failuresWithPath.length > 0 
                        ? `VALIDATION FAILED: ${failuresWithPath.length} replacement(s) have issues:\n` + 
                        failuresWithPath.map((f, idx) => `[${idx}] ${f?.select_text || '(append)'}: ${f.issues.join(', ')}`).join('\n')
                        : '',
                    textNotFoundCount
                } : null,
                summary: allValidationsPass 
                    ? `${allResults.length}/${allResults.length} replacements passed validation`
                    : `${passedCount}/${allResults.length} replacements passed validation (${allFailures.length} failed)`
            };

            // Analyze token counts if requested
            let tokenAnalysis = null;
            if (includeTokenAnalysis) {
                const originalTokens = t5TokenizerService.getTokenData(basePrompt).length;
                const modifiedTokens = t5TokenizerService.getTokenData(buildResult.builtPrompt).length;

                tokenAnalysis = {
                    original: {
                        prompt: originalTokens,
                        total: originalTokens + (negativePrompt ? t5TokenizerService.getTokenData(negativePrompt).length : 0)
                    },
                    modified: {
                        prompt: modifiedTokens,
                        total: modifiedTokens + (buildResult.builtNegativePrompt ? t5TokenizerService.getTokenData(buildResult.builtNegativePrompt).length : 0)
                    },
                    difference: {
                        prompt: modifiedTokens - originalTokens,
                        total: (modifiedTokens + (buildResult.builtNegativePrompt ? t5TokenizerService.getTokenData(buildResult.builtNegativePrompt).length : 0)) -
                            (originalTokens + (negativePrompt ? t5TokenizerService.getTokenData(negativePrompt).length : 0))
                    }
                };
            }

            // Format as markdown
            let markdownContent = `# Text Replacement Validation\n`;
            const statusText = validationResult.overallStatus === 'pass' ? '[PASS]' : '[FAIL]';
            markdownContent += `**Status:** ${statusText} ${validationResult.overallStatus.toUpperCase()}\n`;
            markdownContent += `**Summary:** ${validationResult.summary}\n`;
            
            const replacementsApplied = (buildResult?.replacementResults?.prompt?.filter(r => r.applied).length || 0) +
                                    (buildResult?.replacementResults?.uc?.filter(r => r.applied).length || 0) +
                                    (buildResult?.replacementResults?.character_prompts?.filter(r => r.applied).length || 0);
            
            if (validationResult.failures) {
                const passedCount = Math.max(0, validationResult.failures.passedCount);
                markdownContent += `**Results:** ${passedCount} passed, ${validationResult.failures.failedCount} failed (${validationResult.failures.totalCount} total)\n`;
            }

            // Add warnings section if any warnings exist
            if (validationResult.warnings && validationResult.warnings.length > 0) {
                markdownContent += `## [WARN] Warnings (${validationResult.warnings.length})\n`;
                markdownContent += `These are non-critical issues that don't prevent validation from passing:\n`;
                markdownContent += `| Path | Index | Action | Segment Index | Warning |\n`;
                markdownContent += `|------|-------|--------|---------------|---------|\n`;
                validationResult.warnings.forEach(w => {
                    const path = w.path || '--';
                    const index = w.index !== null && w.index !== undefined ? w.index : '--';
                    const segmentDisplay = w.segment_index !== null && w.segment_index !== undefined
                        ? (Array.isArray(w.segment_index) ? `[${w.segment_index.join(', ')}]` : String(w.segment_index))
                        : (w.select_text && w.select_text.length > 40 ? w.select_text.substring(0, 40) + '...' : (w?.select_text || '(not provided)'));
                    markdownContent += `| ${path} | ${index} | ${w.action || 'unknown'} | ${segmentDisplay} | ${w.warning} |\n`;
                });
                markdownContent += `\n`;
            }

            if (tokenAnalysis) {
                markdownContent += `## Token Analysis\n`;
                markdownContent += `| Type | Original | Modified | Change |\n`;
                markdownContent += `|------|----------|----------|--------|\n`;
                markdownContent += `| Prompt | ${tokenAnalysis.original.prompt} | ${tokenAnalysis.modified.prompt} | ${tokenAnalysis.difference.prompt >= 0 ? '+' : ''}${tokenAnalysis.difference.prompt} |\n`;
                markdownContent += `| Total | ${tokenAnalysis.original.total} | ${tokenAnalysis.modified.total} | ${tokenAnalysis.difference.total >= 0 ? '+' : ''}${tokenAnalysis.difference.total} |\n`;
            }
            
            if (validationResult.failures && validationResult.failures.failures.length > 0) {
                markdownContent += `## Failures (${validationResult.failures.failedCount})\n`;
                
                // Group failures by type for better readability
                const failuresByType = {};
                validationResult.failures.failures.forEach(f => {
                    const failureType = f.failureType || 'OTHER';
                    if (!failuresByType[failureType]) {
                        failuresByType[failureType] = [];
                    }
                    failuresByType[failureType].push(f);
                });
                
                // Show summary by failure type
                if (Object.keys(failuresByType).length > 1) {
                    markdownContent += `**Failure Types:**\n`;
                    Object.entries(failuresByType).forEach(([type, failures]) => {
                        markdownContent += `- ${type}: ${failures.length}\n`;
                    });
                    markdownContent += `\n`;
                }
                
                markdownContent += `| Path | Index | Action | Segment Index | Issue |\n`;
                markdownContent += `|------|-------|--------|---------------|-------|\n`;
                validationResult.failures.failures.forEach(f => {
                    // Normalize action for display
                    const path = f.path || '--';
                    const index = f.index !== null && f.index !== undefined ? f.index : '--';
                    const action = (f.action || 'unknown').toLowerCase();
                    // Show segment_index if available, otherwise show select_text as fallback
                    let segmentDisplay = '--';
                    if (f.segment_index !== null && f.segment_index !== undefined) {
                        const segIdx = Array.isArray(f.segment_index) 
                            ? `[${f.segment_index.join(', ')}]`
                            : String(f.segment_index);
                        segmentDisplay = segIdx.length > 30 ? segIdx.substring(0, 30) + '...' : segIdx;
                    } else if (f.select_text && f.select_text !== '(missing)' && f.select_text !== null) {
                        segmentDisplay = f.select_text.length > 30 ? f.select_text.substring(0, 30) + '...' : f.select_text;
                    } else if (action === 'append') {
                        segmentDisplay = '(append to end)';
                    } else if (action === 'category_verification') {
                        segmentDisplay = '(category check)';
                    }
                    const issue = f.issues && f.issues.length > 0 ? f.issues[0] : 'Unknown issue';
                    markdownContent += `| ${path} | ${index} | ${action} | ${segmentDisplay} | ${issue.replace(/\|/g, '\\|')} |\n`;
                });
                markdownContent += `\n`;
            }
            
            if (replacementsApplied > 0) {
                markdownContent += `**Replacements Applied:** ${replacementsApplied}\n`;
            }

            // Build optimized response - remove redundant data that AI already has
            const result = {
                validation: {
                    overallStatus: validationResult.overallStatus,
                    summary: validationResult.summary,
                    // Only include failure details if validation failed
                    ...(validationResult.failures && {
                        failures: {
                            failedCount: validationResult.failures.failedCount,
                            passedCount: validationResult.failures.passedCount,
                            totalCount: validationResult.failures.totalCount,
                            // Only essential failure info - no rawReplacement duplicates
                            failures: validationResult.failures.failures,
                            detailedMessage: validationResult.failures.detailedMessage
                        }
                    }),
                    ...(validationResult.warnings && {
                        warnings: {
                            warningCount: validationResult.warnings.length,
                            warnings: validationResult.warnings
                        }
                    })
                },
                tokenAnalysis,
                markdown: markdownContent, // Add markdown formatted version
                overallStatus: validationResult.overallStatus,
                validationPassed: validationResult.overallStatus === 'pass',
                replacementsApplied,
                summary: validationResult.summary,
                ...(validationResult.failures && {
                    failureDetails: {
                        failedCount: validationResult.failures.failedCount,
                        passedCount: validationResult.failures.passedCount,
                        totalCount: validationResult.failures.totalCount,
                        detailedMessage: validationResult.failures.detailedMessage
                    },
                    failureMessage: validationResult.failures.detailedMessage
                })
            };

            // Log failure details if validation failed
            if (validationResult.overallStatus === 'fail') {
                console.error(`\n❌ VALIDATION FAILED:`);
                console.error(validationResult.failures.detailedMessage);
                console.error(`\n📊 Failure Summary: ${validationResult.failures.failedCount} failed, ${validationResult.failures.passedCount} passed\n`);
            }

            // If verifyTokenCount is true, call handleAnalyzeTokenCount internally
            if (verifyTokenCount && validationResult.overallStatus === 'pass') {
                // Collect all modified texts for token analysis
                const textsToAnalyze = [];
                if (buildResult.builtPrompt) textsToAnalyze.push(buildResult.builtPrompt);
                if (buildResult.builtNegativePrompt) textsToAnalyze.push(buildResult.builtNegativePrompt);
                
                // Add character prompts if present
                if (buildResult.builtCharacterPrompts && buildResult.builtCharacterPrompts.length > 0) {
                    buildResult.builtCharacterPrompts.forEach(char => {
                        if (char.prompt) textsToAnalyze.push(char.prompt);
                        if (char.uc) textsToAnalyze.push(char.uc);
                    });
                }
                
                // Call handleAnalyzeTokenCount
                const tokenCountResult = await this.handleAnalyzeTokenCount({
                    texts: textsToAnalyze,
                    includeBreakdown: false,
                    reason: "Verifying token optimization as part of validation"
                }, buildOptions);
                
                // Check if all results are within acceptable limits (<=450 tokens for medium pressure mode)
                const MEDIUM_PRESSURE_LIMIT = 450;
                const HARD_TOKEN_LIMIT = 512;
                
                const allAcceptable = tokenCountResult.results && tokenCountResult.results.every(
                    r => r.tokenCount <= MEDIUM_PRESSURE_LIMIT && r.tokenCount < HARD_TOKEN_LIMIT
                );
                
                if (!allAcceptable) {
                    // Token count verification failed - texts exceed medium pressure limit
                    const excessiveTexts = tokenCountResult.results.filter(
                        r => r.tokenCount > MEDIUM_PRESSURE_LIMIT || r.tokenCount >= HARD_TOKEN_LIMIT
                    );
                    return {
                        ...result,
                        validationPassed: false,
                        tokenVerificationFailed: true,
                        tokenCountResult: tokenCountResult,
                        nonOptimalTexts: excessiveTexts.map(r => {
                            // Get text from original array using index
                            const originalText = textsToAnalyze[r.index] || '';
                            return {
                                index: r.index,
                                text: originalText.substring(0, 50) + (originalText.length > 50 ? '...' : ''),
                                tokenCount: r.tokenCount,
                                recommendation: r.recommendation,
                                status: r.status,
                                exceedsLimit: r.tokenCount > MEDIUM_PRESSURE_LIMIT
                            };
                        }),
                        message: `Token count verification failed - ${excessiveTexts.length} of ${textsToAnalyze.length} texts exceed medium pressure limit (>450 tokens) or hard limit (>=512 tokens)`,
                        autoComplete: false
                    };
                }
                
                // Add token count result to response
                // Count how many are optimal vs acceptable
                const optimalTexts = tokenCountResult.results.filter(r => r.tokenCount <= 200);
                const acceptableTexts = tokenCountResult.results.filter(r => r.tokenCount > 200 && r.tokenCount <= MEDIUM_PRESSURE_LIMIT);
                
                let message = '';
                if (optimalTexts.length === textsToAnalyze.length) {
                    message = `All ${textsToAnalyze.length} modified texts are optimal (≤200 tokens)`;
                } else if (acceptableTexts.length > 0 && optimalTexts.length > 0) {
                    message = `${optimalTexts.length} texts are optimal (≤200 tokens), ${acceptableTexts.length} are acceptable (201-450 tokens)`;
                } else if (acceptableTexts.length === textsToAnalyze.length) {
                    message = `All ${textsToAnalyze.length} modified texts are acceptable (201-450 tokens)`;
                } else {
                    message = `All ${textsToAnalyze.length} modified texts are within acceptable limits (≤450 tokens)`;
                }
                
                result.tokenCountVerification = {
                    passed: true,
                    result: tokenCountResult,
                    message: message,
                    breakdown: {
                        optimal: optimalTexts.length,
                        acceptable: acceptableTexts.length,
                        total: textsToAnalyze.length
                    }
                };
            }

            // Auto-complete if terminateOnPass is true AND validation passed
            if (terminateOnPass && validationResult.overallStatus === 'pass') {
                console.log('✅ terminateOnPass=true and validation passed - attempting auto-complete');
                
                // Build final output
                const finalOutput = {
                    text_replacements: textReplacements,
                    dialogs: dialogs || [],
                    insight_memory: insightMemory || [],
                    errors: errors || [],
                    warnings: warnings || [],
                    generated_image_name: generatedImageName,
                    character_names: characterNames || null
                };
                
                // Validate finalOutput against the actual response schema before accepting auto-complete
                try {
                    // Get the actual schema used for dynamic generation responses
                    const expectedCharacterPrompts = characterPrompts?.length || 0;
                    // Get dialogs_count from dynamicConfig (same source used everywhere else)
                    const dialogsCount = buildOptions.dynamicConfig?.dialogs_count;
                    const responseSchema = createDynamicGenerationResponseSchema(expectedCharacterPrompts, characterPrompts, dialogsCount);
                    
                    // Validate using the real schema
                    responseSchema.parse(finalOutput);
                    
                    // Validation passed - accept auto-complete
                    result.autoComplete = true;
                    result.finalOutput = finalOutput;
                    console.log(`   ✅ Schema validation passed (using actual createDynamicGenerationResponseSchema)`);
                    console.log(`   📋 Final output includes: ${result.replacementsApplied} replacements, ${(dialogs || []).length} dialogs, ${(insightMemory || []).length} insights`);
                    
                } catch (schemaError) {
                    // Schema validation failed - this is a critical error when terminateOnPass is true
                    // Throw error to force restart rather than continuing with invalid data
                    console.error(`   ❌ Schema validation failed for terminateOnPass - CRITICAL: data is invalid, restarting request`);
                    console.error(`   📋 Validation errors:`, schemaError.errors || schemaError.message);
                    
                    // Format error message for clarity
                    const errorDetails = schemaError.errors || [{ message: schemaError.message }];
                    const errorMessages = errorDetails.map(e => {
                        const path = e.path && e.path.length > 0 ? ` at path: ${e.path.join('.')}` : '';
                        return `  - ${e.message}${path}`;
                    }).join('\n');
                    
                    throw new Error(
                        `Schema validation failed for terminateOnPass - output data is invalid and cannot be used. ` +
                        `The AI attempted to auto-complete but the data structure is incorrect.\n` +
                        `Validation errors:\n${errorMessages}\n` +
                        `Please fix the validation errors and retry.`
                    );
                }
            }

            return result;
        } catch (error) {
            // Log full error details including stack trace to identify exact location
            console.error('❌ ERROR in handleValidateTextReplacement:');
            console.error('   Message:', error.message);
            console.error('   Error Type:', error.constructor.name);
            console.error('   Stack Trace:');
            if (error.stack) {
                // Split stack into lines for better readability
                const stackLines = error.stack.split('\n');
                stackLines.forEach((line, idx) => {
                    console.error(`   [${idx}] ${line.trim()}`);
                });
            } else {
                console.error('   (No stack trace available)');
            }
            
            // Log all error properties
            console.error('   Error properties:');
            try {
                const errorKeys = Object.getOwnPropertyNames(error);
                errorKeys.forEach(key => {
                    try {
                        const value = error[key];
                        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
                            console.error(`     ${key}: ${value}`);
                        } else if (typeof value === 'object') {
                            console.error(`     ${key}: [object ${value.constructor.name}]`);
                        } else {
                            console.error(`     ${key}: ${typeof value}`);
                        }
                    } catch (e) {
                        console.error(`     ${key}: [error accessing property]`);
                    }
                });
            } catch (e) {
                console.error('   (Could not enumerate error properties)');
            }
            
            // Log context at time of error
            console.error('   Context at error time:');
            try {
                console.error('     buildOptions:', buildOptions ? `[object] keys: ${Object.keys(buildOptions || {}).join(', ') || 'none'}` : 'null/undefined');
                console.error('     textReplacements:', textReplacements ? `[object] keys: ${Object.keys(textReplacements || {}).join(', ') || 'none'}` : 'null/undefined');
                console.error('     basePrompt type:', typeof basePrompt, basePrompt ? `length: ${basePrompt.length}` : 'missing');
                console.error('     negativePrompt type:', typeof negativePrompt, negativePrompt ? `length: ${negativePrompt.length}` : 'missing');
            } catch (ctxError) {
                console.error('     (Could not log context)', ctxError.message);
            }
            
            return {
                error: 'Comprehensive text replacement validation failed',
                message: error.message,
                stack: error.stack, // Include stack trace in response for debugging
                validationPassed: false,
                autoComplete: false  // Never auto-complete on error
            };
        }
    }

    /**
     * Handles rejectChain tool call - AI rejects chain update mode
     * @param {Object} params - Tool parameters
     * @returns {Object} Rejection acknowledgment
     */
    handleRejectChain(params) {
        const { reason, changeAnalysis } = params;
        
        console.log(`🚫 AI rejected chain update mode: ${reason}`);
        if (changeAnalysis) {
            console.log(`   Analysis: ${changeAnalysis}`);
        }
        
        return {
            acknowledged: true,
            markdown: 'Chain update rejected. System will perform full regeneration.',
            willPerformFullRegeneration: true,
            reason: reason,
            changeAnalysis: changeAnalysis || 'Not provided'
        };
    }

    /**
     * Handles analyzeTokenCount tool call - simplified array of text strings
     * @param {Object} params - Tool parameters
     * @param {Object} buildOptions - Build options
     * @returns {Object} Token analysis results
     */
    async handleAnalyzeTokenCount(params, buildOptions = {}) {
        const { texts, includeBreakdown = false, reason, show_tag_suggestions = false } = params;

        if (reason) {
            console.log(`  [REASON] ${reason}`);
        }

        try {
            const t5TokenizerService = this.globalResources.getT5Tokenizer();
            const results = [];

            for (let i = 0; i < texts.length; i++) {
                const text = texts[i];
                console.log(`   📊 Analyzing text ${i + 1}/${texts.length}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

                // Get token data for this text
                const tokenData = t5TokenizerService.getTokenData(text);
                const tokenCount = tokenData.length;

                // Store prompt analysis data if breakdown is requested
                let promptAnalysis = null;
                if (includeBreakdown && text.trim()) {
                    try {
                        console.log(`   🔍 Running prompt analysis for text ${i + 1}...`);
                        const promptLogitAnalyzer = this.globalResources.getPromptLogitAnalyzer();
                        promptAnalysis = await promptLogitAnalyzer.analyzePrompt(text);
                    } catch (error) {
                        console.warn(`⚠️ Failed to analyze prompt ${i + 1}:`, error.message);
                    }
                }

                // Determine status and recommendation
                const status = tokenCount <= 200 ? 'optimal' : tokenCount <= 512 ? 'acceptable' : 'over_limit';
                const recommendation = tokenCount <= 200 ? 'Optimal' :
                                    tokenCount <= 400 ? 'Good' :
                                    tokenCount <= 512 ? 'Acceptable' :
                                    'Over limit';

                results.push({
                    index: i,
                    // Removed: full text - AI already has the texts it sent
                    tokenCount,
                    status,
                    recommendation,
                    promptAnalysis: includeBreakdown ? promptAnalysis : undefined
                    // Removed: efficiency - redundant (can be inferred from status)
                });
            }

            const totalTokens = results.reduce((sum, r) => sum + r.tokenCount, 0);
            const avgTokens = totalTokens / results.length;
            const optimalCount = results.filter(r => r.status === 'optimal').length;
            const acceptableCount = results.filter(r => r.status === 'acceptable').length;
            const overLimitCount = results.filter(r => r.status === 'over_limit').length;

            // Format as markdown table
            let markdownContent = `# Token Count Analysis\n`;
            markdownContent += `**Summary:** ${results.length} text(s) analyzed | Total: ${totalTokens} tokens | Avg: ${avgTokens.toFixed(1)} tokens\n`;
            markdownContent += `**Status:** ${optimalCount} optimal, ${acceptableCount} acceptable, ${overLimitCount} over limit\n`;
            
            if (results.length > 0) {
                markdownContent += `| Index | Tokens | Status | Recommendation |\n`;
                markdownContent += `|-------|--------|--------|----------------|\n`;
                results.forEach(r => {
                    const statusEmoji = r.status === 'optimal' ? '✅' : r.status === 'acceptable' ? '⚠️' : '❌';
                    markdownContent += `| ${r.index + 1} | ${r.tokenCount} | ${statusEmoji} ${r.status} | ${r.recommendation} |\n`;
                });
                
                // Add prompt analysis sections if requested
                if (includeBreakdown) {
                    results.forEach((r, idx) => {
                        if (r.promptAnalysis) {
                            const analysis = r.promptAnalysis;
                            markdownContent += `\n## Text ${r.index + 1} Analysis: "${texts[r.index]}"\n\n`;
                            markdownContent += `**Overall Effectiveness:** ${(analysis.overallEffectiveness * 100).toFixed(1)}%\n`;
                            markdownContent += `**Segments:** ${analysis.segmentCount} | **Total Tokens:** ${analysis.tokenCount}\n`;
                            markdownContent += `**Total Attention Mass:** ${analysis.totalAttentionMass}\n\n`;
                            
                            // Replicate the exact format from analyze_prompt.js
                            analysis.segments.forEach(seg => {
                                const score = (seg.effectivenessScore * 100).toFixed(0);
                                const sharePercent = (seg.attentionShare * 100).toFixed(1);
                                const tokenCount = seg.tokens.length;

                                // Status symbol
                                let statusSymbol = '✓'; // known good tags
                                if (seg.status === 'filler') statusSymbol = '▫'; // filler words
                                else if (seg.status === 'weak') statusSymbol = '✗';
                                else if (seg.status === 'average') statusSymbol = '○';
                                else if (!seg.tagSource) statusSymbol = '⚠'; // unknown but good token strength

                                // Tag info
                                let tagInfo = '';
                                if (seg.tagSource) {
                                    tagInfo = `${seg.tagSource}${seg.isNovelAITrained ? '+novelai' : ''}`;
                                    if (seg.tagCount) tagInfo += ` @ ${seg.tagCount}`;
                                } else if (seg.status === 'filler') {
                                    tagInfo = 'filler';
                                } else if (seg.suggestions && seg.suggestions.api && seg.suggestions.api.length > 0) {
                                    tagInfo = `partial`;
                                } else {
                                    tagInfo = 'unknown';
                                }

                                // Multiplier
                                const multiplier = seg.totalAttention !== 1.0 ? `x${seg.totalAttention}` : '';

                                markdownContent += `[${score}%] ${statusSymbol} ${seg.text} | ${tagInfo} | ${multiplier} | ${sharePercent}% ${tokenCount}t\n`;

                                // Show partial match suggestions if available and show_tag_suggestions is true
                                if (show_tag_suggestions && seg.suggestions && seg.suggestions.api && seg.suggestions.database) {
                                    // Show API suggestions first (up to 10)
                                    const api = seg.suggestions.api.slice(0, 10);
                                    if (api.length > 0) {
                                        markdownContent += `  NovelAI Search:\n`;
                                        api.forEach(m => {
                                            markdownContent += `    - ${m.tag} (${m.usage} uses, ${(m.matchPercent).toFixed(0)}% match)\n`;
                                        });
                                        if (seg.suggestions.api.length > 10) {
                                            markdownContent += `    ... ${seg.suggestions.api.length - 10} more\n`;
                                        }
                                    }

                                    // Show database suggestions second (up to 10)
                                    const dbSuggestions = seg.suggestions.database.slice(0, 10);
                                    if (dbSuggestions.length > 0) {
                                        markdownContent += `  Danbooru/e621 Search:\n`;
                                        dbSuggestions.forEach(m => {
                                            markdownContent += `    - ${m.tag} (${m.usage} uses, ${(m.matchPercent).toFixed(0)}% match) [${m.source}]\n`;
                                        });
                                        if (seg.suggestions.database.length > 10) {
                                            markdownContent += `    ... ${seg.suggestions.database.length - 10} more\n`;
                                        }
                                    }
                                }
                            });
                            
                            markdownContent += `\n`;
                        }
                    });
                }
            }


            return {
                analysisType: 'token_count_analysis',
                textCount: results.length,
                results, // Keep structured data for programmatic access
                markdown: markdownContent, // Add markdown formatted version
                summary: {
                    totalTokens,
                    averageTokens: avgTokens,
                    optimalTexts: optimalCount,
                    acceptableTexts: acceptableCount,
                    overLimitTexts: overLimitCount
                }
            };
        } catch (error) {
            return {
                error: 'Token analysis failed',
                message: error.message,
                analysisType: 'error'
            };
        }
    }

    /**
     * Handles webSearch tool call - searches the web using Exa AI
     * @param {Object} params - Tool parameters
     * @param {Object} buildOptions - Build options
     * @param {Object} toolContext - WebSocket context for progress updates
     * @returns {Object} Web search results
     */
    async handleWebSearch(params, buildOptions = {}, toolContext = {}) {
        const { query, numResults = 5, includeContents = false, reason } = params;

        if (reason) {
            console.log(` [REASON] ${reason}`);
        }
        
        // Use the reasoning ID passed from the main tool loop
        const webSearchReasoningId = toolContext.toolReasoningId;

        try {
            console.log(` 🌐 Searching web for: "${query}" (results: ${numResults}, contents: ${includeContents})`);

            // Check if Exa API key is configured
            const exaApiKey = this.globalResources.getApiKeyManager().getActiveApiKey('exa');
            if (!exaApiKey) {
                console.warn(`  ⚠️ Exa API key not configured! Unable to perform web search.`);
                return {
                    query: query,
                    message: "Web search API key is not configured. Add an Exa key to secure.config.json or set EXA_API_KEY.",
                    results: [],
                    error: "API_KEY_MISSING"
                };
            }

            // Prepare Exa API request
            const searchOptions = {
                query: query,
                numResults: Math.min(numResults, 10), // Cap at 10 results
                includeDomains: [],
                excludeDomains: [],
                startCrawlDate: null,
                endCrawlDate: null,
                startPublishedDate: null,
                endPublishedDate: null,
                useAutoprompt: false,
                type: "auto", // Let Exa choose between keyword and neural search
                category: null,
                contents: {
                    summary: true, // Request AI-generated summaries
                    text: includeContents // Include full text only if requested
                }
            };

            // Make request to Exa API
            const response = await fetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': exaApiKey
                },
                body: JSON.stringify(searchOptions)
            });

            if (!response.ok) {
                throw new Error(`Exa API request failed: ${response.status} ${response.statusText}`);
            }

            const exaData = await response.json();
            console.log(`  📊 Exa API returned ${exaData.results?.length || 0} results`);

            // Transform Exa results to our format
            const results = [];
            let summaryCount = 0;
            if (exaData.results && Array.isArray(exaData.results)) {
                for (const result of exaData.results) {
                    const transformedResult = {
                        title: result.title || '',
                        url: result.url || '',
                        publishedDate: result.publishedDate || null,
                        author: result.author || null,
                        text: result.text || '',
                        summary: result.summary || null,
                        image: result.image || null,
                        favicon: result.favicon || null
                    };
                    // Add content if requested and available
                    if (includeContents && result.text) {
                        transformedResult.content = result.text;
                    }

                    if (result.summary) {
                        summaryCount++;
                    }

                    results.push(transformedResult);
                }
            }
            
            console.log(`  ✨ ${summaryCount}/${results.length} results include AI-generated summaries`);

            const searchResult = {
                query: query,
                totalResults: results.length,
                results: results,
                searchType: exaData.searchType || 'auto',
                autopromptString: exaData.autopromptString || null,
                costDollars: exaData.costDollars || null
            };
            
            // Send completion update
            if (toolContext.ws && toolContext.handler) {
                const executionTime = Date.now() - (toolContext.startTime || Date.now());
                const completionReason = `✓ Found ${results.length} results (${executionTime}ms)`;
                toolContext.handler.sendToClient(toolContext.ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'tool_execution',
                    data: {
                        currentKey: toolContext.toolIndex,
                        totalKeys: toolContext.totalTools,
                        toolName: 'webSearch',
                        toolState: 'completed',
                        toolReasoningId: webSearchReasoningId,
                        reason: completionReason
                    },
                    timestamp: new Date().toISOString()
                });
            }
            
            return searchResult;

        } catch (error) {
            console.error(`  ❌ Web search failed:`, error.message);
            
            // Send error update
            if (toolContext.ws && toolContext.handler) {
                const executionTime = Date.now() - (toolContext.startTime || Date.now());
                toolContext.handler.sendToClient(toolContext.ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'tool_execution',
                    data: {
                        currentKey: toolContext.toolIndex,
                        totalKeys: toolContext.totalTools,
                        toolName: 'webSearch',
                        toolState: 'completed',
                        toolReasoningId: webSearchReasoningId,
                        reason: `✗ Search failed (${executionTime}ms)`
                    },
                    timestamp: new Date().toISOString()
                });
            }
            
            return {
                query: query,
                error: error.message,
                message: "Web search failed due to API error. Consider using tag database tools instead.",
                results: []
            };
        }
    }

    /**
     * Handles fetchUrl tool call - fetches and extracts content from a URL
     * @param {Object} params - Tool parameters
     * @param {Object} buildOptions - Build options
     * @param {Object} toolContext - WebSocket context for progress updates
     * @returns {Object} URL content and metadata
     */
    async handleFetchUrl(params, buildOptions = {}, toolContext = {}) {
    const { url, extractText = true, includeRawContent = false, maxContentLength = 50000, reason } = params;
    const startTime = Date.now();

    if (reason) {
        console.log(` [REASON] ${reason}`);
    }

    // Use the reasoning ID passed from the main tool loop
    const fetchUrlReasoningId = toolContext.toolReasoningId;

    try {
        console.log(` 🌐 Fetching URL: "${url}"`);

        // Validate URL
        let urlObj;
        try {
            urlObj = new URL(url);
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                throw new Error('Only HTTP and HTTPS protocols are supported');
            }
        } catch (urlError) {
            return {
                url: url,
                error: "Invalid URL format",
                message: `Failed to parse URL: ${urlError.message}`
            };
        }

        // Set timeout for fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        try {
            // Fetch the URL
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': this.globalResources.getConfig()?.userAgent || 'StaticForge/1.1a (https://staticforge.app)'
                },
                redirect: 'follow',
                size: Math.min(maxContentLength * 2, 400000) // Limit response size
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return {
                    url: url,
                    statusCode: response.status,
                    statusText: response.statusText,
                    error: `HTTP error ${response.status}`,
                    message: `Failed to fetch URL: ${response.status} ${response.statusText}`
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const contentLength = response.headers.get('content-length');
            
            console.log(`  📄 Content-Type: ${contentType}`);
            if (contentLength) {
                console.log(`  📊 Content-Length: ${contentLength} bytes`);
            }

            // Get response body
            let rawContent = await response.text();
            
            // Limit content length
            if (rawContent.length > maxContentLength) {
                console.log(`  ✂️ Truncating content from ${rawContent.length} to ${maxContentLength} characters`);
                rawContent = rawContent.substring(0, maxContentLength);
            }

            const result = {
                url: url,
                statusCode: response.status,
                contentType: contentType,
                contentLength: rawContent.length,
                headers: Object.fromEntries(response.headers.entries())
            };

            // Extract text based on content type
            if (extractText && contentType.includes('text/html')) {
                // Simple HTML text extraction (remove tags)
                let textContent = rawContent
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
                    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
                    .replace(/<[^>]+>/g, ' ') // Remove HTML tags
                    .replace(/&nbsp;/g, ' ') // Replace nbsp entities
                    .replace(/&amp;/g, '&') // Replace amp entities
                    .replace(/&lt;/g, '<') // Replace lt entities
                    .replace(/&gt;/g, '>') // Replace gt entities
                    .replace(/&quot;/g, '"') // Replace quot entities
                    .replace(/\s+/g, ' ') // Normalize whitespace
                    .trim();

                result.extractedText = textContent;
                console.log(`  📝 Extracted ${textContent.length} characters of text`);
            } else if (contentType.includes('application/json')) {
                try {
                    result.jsonData = JSON.parse(rawContent);
                    result.extractedText = rawContent;
                    console.log(`  📦 Parsed JSON data`);
                } catch (jsonError) {
                    result.extractedText = rawContent;
                    result.jsonParseError = jsonError.message;
                }
            } else {
                result.extractedText = rawContent;
            }

            if (includeRawContent) {
                result.rawContent = rawContent;
            }

            console.log(`  ✅ Successfully fetched URL`);
            
            // Send completion update
            if (toolContext.ws && toolContext.handler) {
                const executionTime = Date.now() - startTime;
                const contentSize = (result.contentLength / 1024).toFixed(1);
                const completionReason = `✓ Fetched ${contentSize}KB content (${executionTime}ms)`;
                toolContext.handler.sendToClient(toolContext.ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'tool_execution',
                    data: {
                        currentKey: toolContext.toolIndex,
                        totalKeys: toolContext.totalTools,
                        toolName: 'fetchUrl',
                        toolState: 'completed',
                        toolReasoningId: fetchUrlReasoningId,
                        reason: completionReason
                    },
                    timestamp: new Date().toISOString()
                });
            }
            
            return result;

        } finally {
            clearTimeout(timeoutId);
        }

    } catch (error) {
        console.error(`  ❌ URL fetch failed:`, error.message);
        
        // Send error update
        if (toolContext.ws && toolContext.handler) {
            const executionTime = Date.now() - startTime;
            toolContext.handler.sendToClient(toolContext.ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'tool_execution',
                data: {
                    currentKey: toolContext.toolIndex,
                    totalKeys: toolContext.totalTools,
                    toolName: 'fetchUrl',
                    toolState: 'completed',
                    toolReasoningId: fetchUrlReasoningId,
                    reason: `✗ Fetch failed (${executionTime}ms)`
                },
                timestamp: new Date().toISOString()
            });
        }
        
        if (error.name === 'AbortError') {
            return {
                url: url,
                error: "Request timeout",
                message: "Request timed out after 30 seconds"
            };
        }
        
        return {
            url: url,
            error: error.message,
            message: `Failed to fetch URL: ${error.message}`
        };
    }
}

/**
 * Handles fetchImage tool call - fetches an image from a URL and returns base64 data
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Build options
 * @param {Object} toolContext - WebSocket context for progress updates
 * @returns {Object} Image data and metadata
 */
    async handleFetchImage(params, buildOptions = {}, toolContext = {}) {
    const { url, maxSize = 10, includeBase64 = true, reason } = params;
    const startTime = Date.now();

    if (reason) {
        console.log(` [REASON] ${reason}`);
    }
    
    // Use the reasoning ID passed from the main tool loop
    const fetchImageReasoningId = toolContext.toolReasoningId;

    try {
        console.log(` 🖼️ Fetching image from URL: "${url}"`);

        // Validate URL
        let urlObj;
        try {
            urlObj = new URL(url);
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                throw new Error('Only HTTP and HTTPS protocols are supported');
            }
        } catch (urlError) {
            return {
                url: url,
                error: "Invalid URL format",
                message: `Failed to parse URL: ${urlError.message}`
            };
        }

        // Set timeout for fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for images

        try {
            // Fetch the image
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': this.globalResources.getConfig()?.userAgent || 'StaticForge/1.1a (https://staticforge.app)',
                    'Accept': 'image/*'
                },
                redirect: 'follow'
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return {
                    url: url,
                    statusCode: response.status,
                    statusText: response.statusText,
                    error: `HTTP error ${response.status}`,
                    message: `Failed to fetch image: ${response.status} ${response.statusText}`
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const contentLength = response.headers.get('content-length');
            
            // Validate content type
            if (!contentType.startsWith('image/')) {
                return {
                    url: url,
                    contentType: contentType,
                    error: "Not an image",
                    message: `URL does not point to an image (Content-Type: ${contentType})`
                };
            }

            console.log(`  📄 Content-Type: ${contentType}`);
            if (contentLength) {
                const sizeMB = parseInt(contentLength) / (1024 * 1024);
                console.log(`  📊 Content-Length: ${contentLength} bytes (${sizeMB.toFixed(2)} MB)`);
                
                // Check size limit
                if (sizeMB > maxSize) {
                    return {
                        url: url,
                        contentType: contentType,
                        fileSizeMB: sizeMB,
                        error: "File too large",
                        message: `Image size (${sizeMB.toFixed(2)} MB) exceeds maximum allowed (${maxSize} MB)`
                    };
                }
            }

            // Get image data as buffer
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const actualSizeMB = buffer.length / (1024 * 1024);
            
            // Check actual size
            if (actualSizeMB > maxSize) {
                return {
                    url: url,
                    contentType: contentType,
                    fileSizeMB: actualSizeMB,
                    error: "File too large",
                    message: `Image size (${actualSizeMB.toFixed(2)} MB) exceeds maximum allowed (${maxSize} MB)`
                };
            }

            console.log(`  📦 Downloaded ${buffer.length} bytes (${actualSizeMB.toFixed(2)} MB)`);

            // Use sharp to get image metadata and validate
            const sharp = require('sharp');
            const imageMetadata = await sharp(buffer).metadata();
            
            console.log(`  🖼️ Image: ${imageMetadata.width}x${imageMetadata.height} ${imageMetadata.format}`);

            const result = {
                url: url,
                statusCode: response.status,
                contentType: contentType,
                format: imageMetadata.format,
                width: imageMetadata.width,
                height: imageMetadata.height,
                channels: imageMetadata.channels,
                hasAlpha: imageMetadata.hasAlpha,
                fileSizeBytes: buffer.length,
                fileSizeMB: actualSizeMB
            };

            if (includeBase64) {
                const base64Data = buffer.toString('base64');
                result.base64 = base64Data;
                result.dataUrl = `data:${contentType};base64,${base64Data}`;
                console.log(`  ✅ Encoded to base64 (${base64Data.length} characters)`);
            }

            console.log(`  ✅ Successfully fetched image`);
            
            // Send completion update
            if (toolContext.ws && toolContext.handler) {
                const executionTime = Date.now() - startTime;
                const completionReason = `✓ Fetched image: ${result.width}x${result.height} (${executionTime}ms)`;
                toolContext.handler.sendToClient(toolContext.ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'tool_execution',
                    data: {
                        currentKey: toolContext.toolIndex,
                        totalKeys: toolContext.totalTools,
                        toolName: 'fetchImage',
                        toolState: 'completed',
                        toolReasoningId: fetchImageReasoningId,
                        reason: completionReason
                    },
                    timestamp: new Date().toISOString()
                });
            }
            
            return result;

        } finally {
            clearTimeout(timeoutId);
        }

    } catch (error) {
        console.error(`  ❌ Image fetch failed:`, error.message);
        
        // Send error update
        if (toolContext.ws && toolContext.handler) {
            const executionTime = Date.now() - startTime;
            toolContext.handler.sendToClient(toolContext.ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'tool_execution',
                data: {
                    currentKey: toolContext.toolIndex,
                    totalKeys: toolContext.totalTools,
                    toolName: 'fetchImage',
                    toolState: 'completed',
                    toolReasoningId: fetchImageReasoningId,
                    reason: `✗ Fetch failed (${executionTime}ms)`
                },
                timestamp: new Date().toISOString()
            });
        }
        
        if (error.name === 'AbortError') {
            return {
                url: url,
                error: "Request timeout",
                message: "Request timed out after 60 seconds"
            };
        }
        
        return {
            url: url,
            error: error.message,
            message: `Failed to fetch image: ${error.message}`
        };
    }
}

/**
 * Knowledge Memory Tool Handlers
 */

    handleSaveKnowledgeMemory(params) {
    try {
        const {
            name,
            description,
            category,
            entities = [],
            relations = [],
            observations = [],
            confidence = 0.25,
            reason
        } = params;

        console.log(`💾 Saving knowledge memory: ${name}`);
        console.log(`   Category: ${category}`);
        console.log(`   Entities: ${entities.length}, Relations: ${relations.length}, Observations: ${observations.length}`);
        console.log(`   Reason: ${reason}`);

        // Validate that entities are context-independent
        const contextKeywords = ['current', 'today', 'this', 'now', 'here', 'weather', 'time', 'date'];
        const nameContainsContext = contextKeywords.some(keyword => name.toLowerCase().includes(keyword));
        
        if (nameContainsContext) {
            const errorResult = {
                success: false,
                error: `Memory name contains context-specific keywords. Use timeless, globally applicable names.`,
                message: `REJECTED: Memory name "${name}" appears to be context-specific. Memories must be globally applicable and context-independent.`
            };
            
            // Format error as markdown
            let markdownContent = `# Memory Save Rejected\n`;
            markdownContent += `❌ **Error:** ${errorResult.error}\n`;
            markdownContent += `**Message:** ${errorResult.message}\n`;
            markdownContent += `**Reason:** Memory names must be timeless and globally applicable. Avoid context-specific keywords like: current, today, this, now, here, weather, time, date.\n`;
            
            return {
                ...errorResult,
                markdown: markdownContent
            };
        }

        // Calculate confidence based on refinement system
        // New memories start at 10%, updates can add up to 25% (capped at 100%)
        const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();
        const existingMemory = knowledgeMemoryDb.getKnowledgeMemory(name, false);
        let finalConfidence;
        
        if (existingMemory) {
            // Memory is being updated - add provided confidence (up to 0.25) to existing
            const cappedIncrease = Math.min(confidence, 0.25); // Cap at 25% increase
            finalConfidence = Math.min(existingMemory.confidence + cappedIncrease, 1.0);
            console.log(`   📈 Updating memory: ${(existingMemory.confidence * 100).toFixed(0)}% → ${(finalConfidence * 100).toFixed(0)}% (+${(cappedIncrease * 100).toFixed(0)}%)`);
        } else {
            // New memory - start at 10%
            finalConfidence = 0.1;
            console.log(`   ✨ Creating new memory: ${(finalConfidence * 100).toFixed(0)}%`);
        }
        
        // Save to database
        const memory = knowledgeMemoryDb.saveKnowledgeMemory(
            name,
            description,
            category,
            entities,
            relations,
            observations,
            finalConfidence
        );

        const result = {
            success: true,
            memory: {
                name: memory.name,
                category: memory.category,
                entity_count: entities.length,
                relation_count: relations.length,
                observation_count: observations.length,
                confidence: finalConfidence
            },
            message: `Successfully saved global knowledge memory "${name}" (${entities.length} entities, ${relations.length} relations, ${observations.length} observations, ${(finalConfidence * 100).toFixed(0)}% confidence). This memory is now available to all future generations.`
        };
        
        // Format as markdown
        const statusEmoji = existingMemory ? '📈' : '✨';
        const action = existingMemory ? 'Updated' : 'Created';
        let markdownContent = `# ${action} Knowledge Memory\n`;
        markdownContent += `${statusEmoji} **${action}:** ${name}\n`;
        markdownContent += `| Property | Value |\n`;
        markdownContent += `|----------|-------|\n`;
        markdownContent += `| Category | ${category || '-'} |\n`;
        markdownContent += `| Confidence | ${(finalConfidence * 100).toFixed(0)}% |\n`;
        markdownContent += `| Entities | ${entities.length} |\n`;
        markdownContent += `| Relations | ${relations.length} |\n`;
        markdownContent += `| Observations | ${observations.length} |\n`;
        markdownContent += `\n**Description:** ${description || '(no description)'}\n`;
        
        if (existingMemory) {
            markdownContent += `**Previous Confidence:** ${(existingMemory.confidence * 100).toFixed(0)}% → ${(finalConfidence * 100).toFixed(0)}%\n`;
        }
        
        markdownContent += `✅ This memory is now available to all future generations.\n`;
        
        return {
            ...result,
            markdown: markdownContent
        };
    } catch (error) {
        console.error('Error saving knowledge memory:', error);
        const errorResult = {
            success: false,
            error: error.message,
            message: `Failed to save memory: ${error.message}`
        };
        
        // Format error as markdown
        let markdownContent = `# Memory Save Failed\n`;
        markdownContent += `❌ **Error:** ${error.message}\n`;
        markdownContent += `**Message:** ${errorResult.message}\n`;
        
        return {
            ...errorResult,
            markdown: markdownContent
        };
    }
}

/**
 * Format memory data as markdown
 */
    formatMemoryAsMarkdown(memory) {
    let md = `## ${memory.name}\n`;
    md += `**Category:** ${memory.category} | **Confidence:** ${(memory.confidence * 100).toFixed(0)}% | **Used:** ${memory.usage_count}x\n`;
    md += `**Description:** ${memory.description}\n`;
    
    if (memory.entities && memory.entities.length > 0) {
        md += `### Entities (${memory.entities.length})\n`;
        memory.entities.forEach(e => {
            md += `- ${e.name} (${e.type}) [${e.id}]\n`;
        });
        md += `\n`;
    }
    
    if (memory.relations && memory.relations.length > 0) {
        md += `### Relations (${memory.relations.length})\n`;
        memory.relations.forEach(r => {
            md += `- ${r.from} → ${r.to} (${r.type})\n`;
        });
        md += `\n`;
    }
    
    if (memory.observations && memory.observations.length > 0) {
        md += `### Observations (${memory.observations.length})\n`;
        memory.observations.forEach(o => {
            md += `- [${o.entity_id}] ${o.content}\n`;
        });
        md += `\n`;
    }
    
    return md;
}

    handleRetrieveKnowledgeMemory(params) {
    try {
        const { names, reason } = params;

        // Ensure names is an array
        const memoryNames = Array.isArray(names) ? names : [names];

        console.log(`🧠 Retrieving ${memoryNames.length} knowledge memor${memoryNames.length === 1 ? 'y' : 'ies'}: ${memoryNames.join(', ')}`);
        console.log(`   Reason: ${reason}`);

        const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();
        const retrievedMemories = [];
        const notFoundMemories = [];

        // Retrieve each memory - optimize to only send essential data
        memoryNames.forEach(name => {
            const memory = knowledgeMemoryDb.getKnowledgeMemory(name);
            if (memory) {
                // Optimize entities: only send id, name, type (not full attributes)
                const optimizedEntities = memory.entities.map(e => ({
                    id: e.id,
                    name: e.name,
                    type: e.type
                    // Removed: full attributes object - AI can infer from context
                }));
                
                // Optimize relations: only send from, to, type (not weight)
                const optimizedRelations = memory.relations.map(r => ({
                    from: r.from,
                    to: r.to,
                    type: r.type
                    // Removed: weight - not essential for AI decision making
                }));
                
                // Optimize observations: only send entity_id and content (not importance)
                const optimizedObservations = memory.observations.map(o => ({
                    entity_id: o.entity_id,
                    content: o.content
                    // Removed: importance - not essential for AI decision making
                }));
                
                retrievedMemories.push({
                    name: memory.name,
                    description: memory.description,
                    category: memory.category,
                    confidence: memory.confidence,
                    entities: optimizedEntities,
                    relations: optimizedRelations,
                    observations: optimizedObservations,
                    usage_count: memory.usage_count
                });
                console.log(`   ✅ Retrieved "${name}": ${memory.entities.length} entities, ${memory.relations.length} relations, ${memory.observations.length} observations, ${(memory.confidence * 100).toFixed(0)}% confidence`);
            } else {
                notFoundMemories.push(name);
                console.log(`   ❌ Not found: "${name}"`);
            }
        });

        if (retrievedMemories.length === 0) {
            return {
                success: false,
                message: `None of the requested memories were found: ${notFoundMemories.join(', ')}. Use searchKnowledgeMemories to find available memories.`
            };
        }

        // Calculate totals
        const totalEntities = retrievedMemories.reduce((sum, m) => sum + m.entities.length, 0);
        const totalRelations = retrievedMemories.reduce((sum, m) => sum + m.relations.length, 0);
        const totalObservations = retrievedMemories.reduce((sum, m) => sum + m.observations.length, 0);

        const avgConfidence = retrievedMemories.reduce((sum, m) => sum + m.confidence, 0) / retrievedMemories.length;
        const message = retrievedMemories.length === 1
            ? `Successfully retrieved memory "${retrievedMemories[0].name}". It contains ${totalEntities} entities with ${totalRelations} relationships and ${totalObservations} observations. Confidence: ${(retrievedMemories[0].confidence * 100).toFixed(0)}%${retrievedMemories[0].confidence < 0.6 ? ' (LOW - consider refining)' : retrievedMemories[0].confidence < 0.8 ? ' (MEDIUM - room for improvement)' : ' (HIGH - well-refined)'}.`
            : `Successfully retrieved ${retrievedMemories.length} memories with ${totalEntities} total entities, ${totalRelations} relationships, and ${totalObservations} observations. Average confidence: ${(avgConfidence * 100).toFixed(0)}%.${notFoundMemories.length > 0 ? ` Note: ${notFoundMemories.length} memor${notFoundMemories.length === 1 ? 'y' : 'ies'} not found: ${notFoundMemories.join(', ')}` : ''}`;

        // Format as markdown
        let markdownContent = `# Knowledge Memories\n${message}\n`;
        retrievedMemories.forEach(memory => {
            markdownContent += this.formatMemoryAsMarkdown(memory);
        });

        return {
            success: true,
            memories: retrievedMemories, // Keep structured data for programmatic access
            markdown: markdownContent, // Add markdown formatted version
            count: retrievedMemories.length,
            not_found: notFoundMemories.length > 0 ? notFoundMemories : undefined,
            message: message
        };
    } catch (error) {
        console.error('Error retrieving knowledge memories:', error);
        return {
            success: false,
            error: error.message,
            message: `Failed to retrieve memories: ${error.message}`
        };
    }
}

    handleSearchKnowledgeMemories(params) {
    try {
        const { query, category, reason } = params;

        console.log(`🔍 Searching knowledge memories: "${query}"${category ? ` (category: ${category})` : ''}`);
        console.log(`   Reason: ${reason}`);

        const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();
        const results = knowledgeMemoryDb.searchKnowledgeMemories(query, category);

        console.log(`   ✅ Found ${results.length} matching memories`);

        // Results now include matching components (entities, observations, relations) for lower relevance
        // and full memory details for high relevance matches (relevance_score >= 20)
        const highRelevanceCount = results.filter(r => r.full_memory === true).length;
        const message = `Found ${results.length} matching memories${highRelevanceCount > 0 ? ` (${highRelevanceCount} with full details)` : ''}. ${highRelevanceCount < results.length ? 'Lower relevance matches show only matching components.' : ''}`;

        // Format as markdown table with additional info
        let markdownContent = `# Memory Search Results\n${message}\n`;
        if (results.length > 0) {
            markdownContent += `| Name | Description | Category | Usage | Confidence | Relevance | Details |\n`;
            markdownContent += `|------|-------------|----------|-------|------------|-----------|--------|\n`;
            results.forEach(r => {
                const desc = (r.description || '').substring(0, 50) + (r.description && r.description.length > 50 ? '...' : '');
                const relevance = r.relevance_score || 0;
                const details = r.full_memory 
                    ? 'Full memory' 
                    : `${(r.entities?.length || 0)} entities, ${(r.observations?.length || 0)} observations, ${(r.relations?.length || 0)} relations`;
                markdownContent += `| ${r.name} | ${desc} | ${r.category} | ${r.usage_count}x | ${(r.confidence * 100).toFixed(0)}% | ${relevance} | ${details} |\n`;
            });
        }

        return {
            success: true,
            results: results.map(r => ({
                name: r.name,
                description: r.description,
                category: r.category,
                usage_count: r.usage_count,
                confidence: r.confidence,
                relevance_score: r.relevance_score,
                full_memory: r.full_memory || false,
                entities: r.entities || [],
                observations: r.observations || [],
                relations: r.relations || []
            })),
            markdown: markdownContent,
            count: results.length,
            message: message
        };
    } catch (error) {
        console.error('Error searching knowledge memories:', error);
        return {
            success: false,
            error: error.message,
            message: `Failed to search memories: ${error.message}`
        };
    }
    }

    /**
     * Sanitizes tool call arguments by removing XML tags, control tokens, and function call wrappers
     * that may have leaked into parameter values
     * @param {string} args - Raw arguments string
     * @returns {string} - Sanitized arguments string
     */
    sanitizeToolCallArguments(args) {
    if (!args || typeof args !== 'string') {
        return args;
    }
    
    let sanitized = args;
    
    // Strategy 1: Try to extract valid JSON before any XML contamination
    // Look for the end of a valid JSON object/array before XML tags appear
    const xmlStartMatch = sanitized.search(/<\/?xai:function_call|<\|[^|]+\|>/i);
    if (xmlStartMatch > 0) {
        // Try to find the end of valid JSON before the XML
        // Look backwards from XML start to find matching braces/brackets
        let jsonEnd = xmlStartMatch;
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        // Find the last valid JSON position
        for (let i = xmlStartMatch - 1; i >= 0; i--) {
            const char = sanitized[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            
            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '}' || char === ']') {
                    depth++;
                } else if (char === '{' || char === '[') {
                    depth--;
                    if (depth === 0) {
                        jsonEnd = i;
                        break;
                    }
                }
            }
        }
        
        // If we found a valid JSON boundary, extract just that part
        if (jsonEnd > 0 && depth === 0) {
            sanitized = sanitized.substring(0, jsonEnd + 1);
        }
    }
    
    // Strategy 2: Remove any remaining XML tags and control tokens
    // (in case they're still present after extraction)
    sanitized = sanitized.replace(/<\/?xai:function_call[^>]*>/gi, '');
    sanitized = sanitized.replace(/<\|[^|]+\|>/g, '');
    sanitized = sanitized.replace(/<\/?parameter[^>]*>/gi, '');
    
    return sanitized.trim();
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

// Tool execution functions
    async executeTool(toolCall, attemptId, toolContext = {}) {
    // attemptId is required - it's used to fetch buildOptions from Kaze system
    if (!attemptId) {
        throw new Error('executeTool requires attemptId to fetch buildOptions from Kaze system');
    }
    
    // Fetch single buildOptions object from Kaze .set() (no fallback - must exist)
    const buildOptions = this.globalResources.getDataPlumbing().get(`${attemptId}:buildOptions`);
    if (!buildOptions) {
        throw new Error(`buildOptions not found in Kaze system for attemptId: ${attemptId}`);
    }
    
    // Ensure attemptId is set
    if (!buildOptions._attemptId) {
        buildOptions._attemptId = attemptId;
    }
    const name = toolCall.function?.name || toolCall.name;
    let args = toolCall.function?.arguments || toolCall.arguments;
    
    if (!args || args === 'undefined') {
        throw new Error(`Tool ${name} called with undefined or missing arguments`);
    }
    
    // Sanitize arguments to remove any XML tags or control tokens that leaked in
    args = this.sanitizeToolCallArguments(args);
    
    const parsedArgs = JSON.parse(args);

    // Summarized console output
    const toolSummary = `🔧 Tool: ${name}${parsedArgs.reason ? ` | ${parsedArgs.reason.substring(0, 80)}${parsedArgs.reason.length > 80 ? '...' : ''}` : ''}`;
    this.globalResources.getLogger().normal(toolSummary);
    
    // Detailed file logging
    const logRequestId = buildOptions._requestId || 'unknown';
    // Verbose console output
    if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
        console.log(`   Parameters:`, parsedArgs);
        console.log(`   Build Options:`, { model: buildOptions.model, temperature: buildOptions.temperature });
    }

    let result;
    const startTime = Date.now();

    try {
        switch (name) {
            case "searchTagDatabase":
                const model = buildOptions.model || 'nai-diffusion-4-5-full';
                this.globalResources.getLogger().detailed(`   🔍 Searching NovelAI API for: "${parsedArgs.query}" using model: ${model}`);
                // Pass ws, sessionId (null for tool calls), and requestId from buildOptions
                const rawResults = await this.globalResources.getSearchService().performTagSearch(
                    parsedArgs.query, 
                    model, 
                    toolContext.ws || null, 
                    null, // sessionId - not needed for tool calls
                    buildOptions._requestId || null
                );
                this.globalResources.getLogger().detailed(`   📊 Found ${rawResults.length} results`);
                
                // Optimize results - remove redundant model/searchModel metadata
                const optimizedResults = rawResults.map(tag => {
                    const optimized = {
                        name: tag.tag || tag.name,
                        count: tag.count,
                        confidence: tag.confidence
                    };
                    // Only include category if it's meaningful (not just "general")
                    if (tag.category && tag.category !== 'general') {
                        optimized.category = tag.category;
                    }
                    return optimized;
                });
                
                // Format as markdown table
                let markdownContent = `# Tag Search Results (${optimizedResults.length} found)\n`;
                if (optimizedResults.length > 0) {
                    markdownContent += `| Tag | Count | Confidence${optimizedResults.some(t => t.category) ? ' | Category' : ''} |\n`;
                    markdownContent += `|-----|-------|------------${optimizedResults.some(t => t.category) ? '|----------' : ''} |\n`;
                    optimizedResults.forEach(tag => {
                        const categoryCol = optimizedResults.some(t => t.category) ? ` | ${tag.category || '-'}` : '';
                        // Handle both decimal (0-1) and percentage (0-100) confidence values
                        const confidenceValue = tag.confidence > 1 ? tag.confidence : (tag.confidence * 100);
                        markdownContent += `| ${tag.name} | ${tag.count.toLocaleString()} | ${confidenceValue.toFixed(1)}%${categoryCol} |\n`;
                    });
                } else {
                    markdownContent += `No matching tags found.\n`;
                }
                
                // Return both structured data and markdown
                result = {
                    tags: optimizedResults, // Keep structured data for programmatic access
                    markdown: markdownContent, // Add markdown formatted version
                    count: optimizedResults.length
                };
                
                // Send completion update
                if (toolContext.ws && toolContext.handler) {
                    const completionReason = `✓ Found ${result.count} tags (${Date.now() - startTime}ms)`;
                    toolContext.handler.sendToClient(toolContext.ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'tool_execution',
                        data: {
                            currentKey: toolContext.toolIndex,
                            totalKeys: toolContext.totalTools,
                            toolName: 'searchTagDatabase',
                            toolState: 'completed',
                            toolReasoningId: toolContext.toolReasoningId,
                            reason: completionReason
                        },
                        timestamp: new Date().toISOString()
                    });
                }
                break;


            case "publishAnalysisResults":
                this.globalResources.getLogger().detailed(`   📊 Publishing analysis results`);
                result = await this.handlePublishAnalysisResults(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "planTextReplacements":
                this.globalResources.getLogger().detailed(`   📋 Planning text replacements`);
                result = await this.handlePlanTextReplacements(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "validateSegmentSyntax":
                this.globalResources.getLogger().detailed(`   🔍 Validating segment syntax`);
                result = await this.handleValidateSegmentSyntax(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "validateTextReplacement":
                this.globalResources.getLogger().detailed(`   ✅ Validating text replacement`);
                result = await this.handleValidateTextReplacement(parsedArgs, buildOptions);
                // Store ID from context for completion message
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "file_search":
                // File search is handled automatically by Grok
                // This case is just for logging/context
                this.globalResources.getLogger().detailed(`   📖 Searching tag wiki collection via file_search`);
                this.globalResources.getLogger().normal(`   📖 FILE_SEARCH: Query="${parsedArgs.query || 'N/A'}" | Collection ID: ${this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' }) || 'N/A'}`);
                result = {
                    status: "file_search_initiated",
                    message: "File search is being processed by Grok's knowledge base system. Results will be returned automatically.",
                    note: "The file_search tool uses Grok's built-in file_search functionality with vector_store_ids. The actual search results will be provided by Grok automatically.",
                    collection_id: this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })
                };
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "searchTagsBatch":
                // Check if collection search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })) {
                    throw new Error(`Tool ${name} is not available when using tag wiki collection. Use file_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   🔍 Searching tags batch`);
                const searchTagsStartTime = Date.now();
                result = await this.globalResources.getTagDatabase().handleSearchTagsBatch(parsedArgs, buildOptions, toolContext);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                
                // Send completion update
                if (toolContext.ws && toolContext.handler) {
                    const searchTagsExecutionTime = Date.now() - searchTagsStartTime;
                    const tagsCount = parsedArgs.tags ? parsedArgs.tags.length : 0;
                    const totalResults = result?.json ? Object.keys(result.json).reduce((sum, key) => {
                        const tagResults = result.json[key];
                        return sum + (Array.isArray(tagResults) ? tagResults.length : 0);
                    }, 0) : 0;
                    const completionReason = totalResults > 0
                        ? `✓ Found ${totalResults} result${totalResults !== 1 ? 's' : ''} for ${tagsCount} tag${tagsCount !== 1 ? 's' : ''} (${searchTagsExecutionTime}ms)`
                        : `✓ Searched ${tagsCount} tag${tagsCount !== 1 ? 's' : ''} (${searchTagsExecutionTime}ms)`;
                    toolContext.handler.sendToClient(toolContext.ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'tool_execution',
                        data: {
                            currentKey: toolContext.toolIndex,
                            totalKeys: toolContext.totalTools,
                            toolName: 'searchTagsBatch',
                            toolState: 'completed',
                            toolReasoningId: toolContext.toolReasoningId,
                            reason: completionReason
                        },
                        timestamp: new Date().toISOString()
                    });
                }
                break;

            case "getTagDetails":
                // Check if collection search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })) {
                    throw new Error(`Tool ${name} is not available when using tag wiki collection. Use file_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   📋 Getting tag details`);
                result = await this.globalResources.getTagDatabase().handleGetTagDetails(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "resolveTagLinks":
                // Check if collection search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })) {
                    throw new Error(`Tool ${name} is not available when using tag wiki collection. Use file_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   🔗 Resolving tag links`);
                result = await this.globalResources.getTagDatabase().handleResolveTagLinks(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "searchByDescription":
                // Check if collection search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })) {
                    throw new Error(`Tool ${name} is not available when using tag wiki collection. Use file_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   📝 Searching by description`);
                result = await this.globalResources.getTagDatabase().handleSearchByDescription(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "getBodyChunk":
                // Check if collection search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })) {
                    throw new Error(`Tool ${name} is not available when using tag wiki collection. Use file_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   📄 Getting body chunk`);
                result = await this.globalResources.getTagDatabase().handleGetBodyChunk(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "getDatasetGroupContents":
                // Check if collection search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.tagWikiCollectionId' })) {
                    throw new Error(`Tool ${name} is not available when using tag wiki collection. Use file_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   📂 Getting dataset group contents`);
                result = await this.globalResources.getTagDatabase().handleGetDatasetGroupContents(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "analyzeTokenCount":
                this.globalResources.getLogger().detailed(`   🔢 Analyzing token count`);
                result = await this.handleAnalyzeTokenCount(parsedArgs, buildOptions);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "web_search":
            case "x_search":
                // Cloud web search is handled automatically by Grok
                this.globalResources.getLogger().detailed(`   🌐 Cloud web search via ${name}`);
                this.globalResources.getLogger().normal(`   🌐 ${name.toUpperCase()}: Query="${parsedArgs.query || 'N/A'}" | Image understanding enabled`);
                result = {
                    status: `${name}_initiated`,
                    message: `${name} is being processed by Grok's cloud search system. Results will be returned automatically.`,
                    note: `The ${name} tool uses Grok's built-in cloud search functionality with image understanding enabled. The actual search results will be provided by Grok automatically.`
                };
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "webSearch":
                // Check if cloud web search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.useWebSearch' }) === true) {
                    throw new Error(`Tool ${name} is not available when using cloud web search. Use web_search or x_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   🌐 Performing web search`);
                result = await this.handleWebSearch(parsedArgs, buildOptions, toolContext);
                break;

            case "fetchUrl":
                // Check if cloud web search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.useWebSearch' }) === true) {
                    throw new Error(`Tool ${name} is not available when using cloud web search. Use web_search or x_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   🌐 Fetching URL content`);
                result = await this.handleFetchUrl(parsedArgs, buildOptions, toolContext);
                break;

            case "fetchImage":
                // Check if cloud web search is enabled - these tools should not be available
                if (this.globalResources.getSecureConfig({ path: 'grok.useWebSearch' }) === true) {
                    throw new Error(`Tool ${name} is not available when using cloud web search. Use web_search or x_search instead.`);
                }
                this.globalResources.getLogger().detailed(`   🖼️ Fetching image from URL`);
                result = await this.handleFetchImage(parsedArgs, buildOptions, toolContext);
                break;

            case "completeTooling":
                console.log(`   ✅ Tool usage complete: ${parsedArgs.reason || 'No reason provided'}`);
                // Completion message will be sent by the general completion handler
                result = {
                    status: "tooling_complete",
                    reason: parsedArgs.reason || "Tool usage complete",
                    markdown: "AI has signaled completion of tool usage and is ready to provide structured response"
                };
                break;

            case "rejectChain":
                console.log(`   🚫 Chain update rejected: ${parsedArgs.reason || 'No reason provided'}`);
                result = await this.handleRejectChain(parsedArgs);
                break;

            case "saveKnowledgeMemory":
                console.log(`   💾 Saving global knowledge memory: ${parsedArgs.name}`);
                result = await this.handleSaveKnowledgeMemory(parsedArgs);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "retrieveKnowledgeMemory":
                console.log(`   🧠 Retrieving knowledge memory: ${parsedArgs.name}`);
                result = await this.handleRetrieveKnowledgeMemory(parsedArgs);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "searchKnowledgeMemories":
                console.log(`   🔍 Searching knowledge memories: ${parsedArgs.query}`);
                result = await this.handleSearchKnowledgeMemories(parsedArgs);
                parsedArgs._reasoningId = toolContext.toolReasoningId;
                break;

            case "start":
                console.log(`   🏁 Processing start tool with quiz answers`);

                // Validate quiz answers directly (avoid circular dependency)
                const correctAnswers = {
                    taskListReference: "I should follow the task checklist step by step",
                    textSelectionRule: "I can only select text that exists VERBATIM in the ORIGINAL prompts shown in user content",
                    appendActionRule: "Append actions MUST have replace_text - it cannot be empty",
                    emphasisGroupRule: "Emphasis groups must be complete: weight::content :: (weight number, content, space before ::)",
                    validationErrorHandling: "If validation fails, I must FIX the issues and retry - cannot ignore failures",
                    directivePriority: "Directive has highest priority and ALL requests must be implemented",
                    toolUsageRule: "I should use tools for research and validation as needed"
                };

                const validationResults = {
                    allCorrect: true,
                    wrongAnswers: []
                };

                for (const [key, correctAnswer] of Object.entries(correctAnswers)) {
                    if (parsedArgs[key] !== correctAnswer) {
                        validationResults.allCorrect = false;
                        validationResults.wrongAnswers.push({
                            question: key,
                            selected: parsedArgs[key],
                            correct: correctAnswer
                        });
                    }
                }

                if (validationResults.allCorrect) {
                    result = {
                        success: true,
                        message: "All quiz answers correct. Ready to proceed with generation.",
                        ready: true,
                        validationPassed: true
                    };
                    console.log(`   ✅ All quiz answers correct - validation passed`);
                } else {
                    // Validation failed - throw error to force retry
                    const errorMessage = `Start tool validation failed: ${validationResults.wrongAnswers.length} wrong answers`;
                    console.log(`   ❌ ${errorMessage}`);
                    throw new Error(errorMessage);
                }
                break;

            default:
                throw new Error(`Unknown tool: ${name}`);
        }

        const executionTime = Date.now() - startTime;
        
        // Summarized console output
        this.globalResources.getLogger().normal(`   ✅ Completed (${executionTime}ms)`);
        
        // Verbose console output (removed duplicate logging)
        if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
            if (result && typeof result === 'object') {
                console.log(`   📋 Result summary: ${Object.keys(result).length} keys`);
                if (Array.isArray(result)) {
                    console.log(`   📋 Result type: Array with ${result.length} items`);
                }
            }
        }
        
        // Send completion message for synchronous tools (async tools, cloud tools, and rejectChain send their own)
        if (toolContext.ws && toolContext.handler && !['searchTagDatabase', 'searchTagsBatch', 'webSearch', 'fetchUrl', 'fetchImage', 'file_search', 'web_search', 'x_search'].includes(name)) {
            let completionReason = `✓ Completed in ${executionTime}ms`;
            
            // Add specific completion messages for different tools
            if (name === 'validateTextReplacement') {
                // Format: "X Passed Validation (Y Created)" or "X/Y Failed Validation"
                if (result && result.validation) {
                    const appliedCount = result.replacementsApplied || 0;
                    
                    if (result.validationPassed) {
                        // Use summary or failureDetails for counts
                        const passedCount = result.failureDetails 
                            ? result.failureDetails.passedCount 
                            : (result.replacementsApplied || 0);
                        completionReason = `${passedCount} Passed Validation (${appliedCount} Created)`;
                    } else {
                        // Include failure type breakdown in completion message
                        const failureTypes = [];
                        if (result.failureDetails) {
                            const failedCount = result.failureDetails.failedCount || 0;
                            const totalCount = result.failureDetails.totalCount || 0;
                            completionReason = `${totalCount - failedCount}/${totalCount} Passed Validation (${failedCount} Failed)`;
                            
                            // Try to get failure types from failures array if available
                            if (result.validation.failures && result.validation.failures.failures) {
                                const failureTypeCounts = {};
                                result.validation.failures.failures.forEach(f => {
                                    failureTypeCounts[f.failureType] = (failureTypeCounts[f.failureType] || 0) + 1;
                                });
                                if (failureTypeCounts.INVALID_STRUCTURE) failureTypes.push(`${failureTypeCounts.INVALID_STRUCTURE} Invalid`);
                                if (failureTypeCounts.TEXT_NOT_FOUND) failureTypes.push(`${failureTypeCounts.TEXT_NOT_FOUND} Not Found`);
                                if (failureTypeCounts.PROTECTED_CONTENT) failureTypes.push(`${failureTypeCounts.PROTECTED_CONTENT} Protected`);
                                if (failureTypeCounts.OVERLAPPING_SELECTOR) failureTypes.push(`${failureTypeCounts.OVERLAPPING_SELECTOR} Overlapping`);
                                if (failureTypeCounts.MISSING_SELECT_TEXT) failureTypes.push(`${failureTypeCounts.MISSING_SELECT_TEXT} Missing Select`);
                                if (failureTypeCounts.MISSING_REPLACE_TEXT) failureTypes.push(`${failureTypeCounts.MISSING_REPLACE_TEXT} Missing Replace`);
                                if (failureTypeCounts.OTHER) failureTypes.push(`${failureTypeCounts.OTHER} Other`);
                            }
                            const breakdown = failureTypes.length > 0 ? ` (${failureTypes.join(', ')})` : '';
                            completionReason = `${totalCount - failedCount}/${totalCount} Passed Validation (${failedCount} Failed)${breakdown}`;
                        }
                    }
                } else {
                    completionReason = result?.validationPassed ? `Validation Passed` : `Validation Failed`;
                }
            } else if (name === 'getTagDetails' && result?.title) {
                completionReason = `✓ Retrieved details for "${result.title}" (${executionTime}ms)`;
            } else if (name === 'publishAnalysisResults' && result) {
                const sceneType = result?.scene_type || 'unknown';
                completionReason = `✓ Analysis published: ${sceneType} scene (${executionTime}ms)`;
            } else if (name === 'analyzeTokenCount' && result?.summary) {
                // Format: "Optimal Efficiency (X Total Tokens)" or other efficiency levels
                const totalTokens = result.summary.totalTokens;
                const optimalCount = result.summary.optimalTexts || 0;
                const acceptableCount = result.summary.acceptableTexts || 0;
                const overLimitCount = result.summary.overLimitTexts || 0;
                const totalTexts = result.textCount || result.summary.totalTexts || 0;
                
                let efficiencyLevel = 'Optimal Efficiency';
                if (overLimitCount > 0) {
                    efficiencyLevel = 'Poor Efficiency';
                } else if (acceptableCount > optimalCount) {
                    efficiencyLevel = 'Acceptable Efficiency';
                } else if (optimalCount === totalTexts) {
                    efficiencyLevel = 'Optimal Efficiency';
                } else {
                    efficiencyLevel = 'Good Efficiency';
                }
                
                completionReason = `${efficiencyLevel} (${totalTokens} Total Tokens)`;
            } else if (name === 'completeTooling') {
                completionReason = result?.reason || 'Tool usage complete';
            } else if (Array.isArray(result)) {
                completionReason = `✓ Found ${result.length} results (${executionTime}ms)`;
            } else if (result && typeof result === 'object' && Object.keys(result).length > 0) {
                const resultCount = Object.keys(result).length;
                completionReason = `✓ Completed with ${resultCount} items (${executionTime}ms)`;
            }
            
            toolContext.handler.sendToClient(toolContext.ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'tool_execution',
                data: {
                    currentKey: toolContext.toolIndex,
                    totalKeys: toolContext.totalTools,
                    toolName: name,
                    toolState: 'completed',
                    toolReasoningId: toolContext.toolReasoningId || parsedArgs._reasoningId || null,
                    reason: completionReason
                },
                timestamp: new Date().toISOString()
            });
        }

        return result;

    } catch (error) {
        console.error(`❌ TOOL EXECUTION FAILED: ${name}`, error.message);
        throw error;
    }
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
        let nextIterationMessages = messages; // Messages to send in next iteration (starts with initial messages)
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

        // Helper function to determine workflow step based on phase status
        const determineWorkflowStep = () => {
            // Default to 'analysis' - require analysis first
            if (publishedAnalysis && replacementPlan) {
                // Only allow execution if we have BOTH publishedAnalysis AND replacementPlan
                return 'execution';
            } else if (publishedAnalysis) {
                // Have analysis but no plan yet - stay in planning
                return 'planning';
            } else {
                // No analysis yet - must do analysis first
                return 'analysis';
            }
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
            const workflowStep = determineWorkflowStep();
            let filteredTools = [];
            if (options._attemptId) {
                const buildOptions = getBuildOptions();
                if (buildOptions?.dynamicConfig) {
                    const allTools = this.getAllToolDefinitions(buildOptions.dynamicConfig);
                    filteredTools = this.filterToolsByWorkflowStep(allTools, workflowStep);
                    this.globalResources.getLogger().verbose(`🔧 Workflow step: ${workflowStep} - ${filteredTools.length} tools available`);
                } else if (!filteredTools.length && Array.isArray(options?.tools)) {
                    filteredTools = [...options.tools];
                }
            }
            
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
                // Let AI call tools freely without structured output constraints
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
                // No tools: use normal response_format
                responseFormat = zodResponseFormat(options?.responseSchema, "response");
            }
        } else {
            // Fallback to normal text if invalid schema type
            console.warn('⚠️ Invalid responseSchema type, falling back to normal text response');
            responseFormat = null;
            }
            
            let apiConfig = {
                model: options?.model || "grok-4-fast-reasoning", 
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
            this.globalResources.getLogger().detailed(`🎯 AI: ${apiConfig.model} | Iter ${iteration}/${initialMaxLoops} | ${apiConfig.input?.length || 0} msgs | ${apiConfig.tools ? apiConfig.tools.length : 0} tools${apiConfig.previous_response_id ? ' | stateful' : ''}`);
            
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
                const stream = await this.globalResources.getGrokClient().responses.create(apiConfig);
                let fullResponse = '';
                let lastChunk = null;
                let responseId = null;
                let completionObject = null;
                // Reset toolCalls for each retry attempt
                toolCalls = {};

                // Send initial streaming start signal
                if (options.ws && options.handler) {
                    options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                        phase: 'ai_streaming',
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
                                        phase: 'ai_streaming',
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
                                    phase: 'ai_streaming',
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
                    
                    // Log raw AI response before tool execution
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
                        
                        const header = this.formatToolResultHeader({
                            toolNumber: iteration,
                            totalTools: initialMaxLoops,
                            resultPage: toolResultMessages.length + 1,
                            totalResultPages: finalToolCalls.length,
                            totalTokens: currentTotalTokens,
                            maxTokens: 128000,
                            phaseStatus: phaseStatus,
                            toolName: toolCall.function.name,
                            toolsCalledSoFar: [...toolsCalledSoFar],
                            maxToolCalls: maxToolCalls,
                            publishedAnalysis: publishedAnalysis,
                            dynamicConfig: dynamicConfig,
                            context: context,
                            timestamp: new Date()
                        });

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
                    
                    // Detailed file logging - full AI response
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
                                console.warn('⚠️ Failed to parse streaming AI response as JSON:', parseError.message);
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
                        parsedResponse = response || { error: 'Empty response from AI' };
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
                        this.globalResources.getLogger().detailed(`💾 [Director AI Structured] Cumulative token usage: ${totalTokens} total (${inputTokens} input, ${outputTokens} output)`);
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
        console.error('❌ Error calling Director AI with structured output:', error);
        throw error;
    }
}

/**
 * Director-specific AI function using Chat Completions API
 * This is a duplicate created for the director system to avoid breaking the migrated system
 * Uses grok.chat.completions.create() instead of grok.responses.create()
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
                    // Let AI call tools freely without structured output constraints
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
                model: options?.model || "grok-4-fast-reasoning", 
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
            this.globalResources.getLogger().detailed(`🎯 Director AI (Completions): ${apiConfig.model} | Iter ${iteration}/${initialMaxLoops} | ${apiConfig.messages?.length || 0} msgs | ${apiConfig.tools ? apiConfig.tools.length : 0} tools`);
            
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
                    const stream = await this.globalResources.getGrokClient().chat.completions.create(apiConfig);
                    let fullResponse = '';
                    let toolCalls = [];
                    let toolCallsMap = {}; // Track partial tool calls during streaming

                    // Send initial streaming start signal
                    if (options.ws && options.handler) {
                        options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                            phase: 'ai_streaming',
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
                                            phase: 'ai_streaming',
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
                                        phase: 'ai_streaming',
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
                        
                        // Log raw AI response before tool execution
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
                        this.globalResources.getLogger().detailed(`✅ AI request completed in ${Math.round(duration/1000)}s`);
                        
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
                            this.globalResources.getLogger().detailed(`💾 [Director AI] Cumulative token usage: ${totalTokens} total (${inputTokens} input, ${outputTokens} output)`);
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
        console.error('❌ Error calling Director AI with completion:', error);
        throw error;
    }
    }
}

module.exports = GrokService;