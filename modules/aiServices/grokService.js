const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const promptManager = require('../promptManager');
const { addChatMessage } = require('../chatDatabase');
const memoryManager = require('../memoryManager');
const streamingEventProcessor = require('../streamingEventProcessor');
const { zodResponseFormat } = require("openai/helpers/zod");
const { z } = require('zod');
const clarinet = require('clarinet');
const sharp = require('sharp');
const config = require('../../config.json');

// Load secure config
let secureConfig = {};
try {
    secureConfig = require('../../secure.config.json');
} catch (error) {
    console.warn('⚠️ secure.config.json not found, using environment variables');
}

const API_KEY = secureConfig.grok?.apiKey || process.env.GROK_API_KEY;

if (!API_KEY) {
    console.warn('⚠️ Grok API key not found in secure.config.json or environment variables');
}

const grok = API_KEY ? new OpenAI({ 
    apiKey: API_KEY,
    baseURL: 'https://api.x.ai/v1'
}) : null;

// Zod schema for chat event responses
const ChatEventSchema = z.object({
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

const ChatResponseSchema = z.object({
    events: z.array(ChatEventSchema)
});

/**
 * Ensures all events have unique sequential timestamps
 * Auto-increments any duplicate timestamps
 */
function ensureUniqueTimestamps(events) {
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

const getVerbosityInstruction = (level) => {
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
function createPersonaChatSession(sessionData, personaSettings, systemPrompt) {
    if (!grok) {
        throw new Error('Grok not initialized - check API key');
    }
    
    // Load conversation context and memories
    const conversationContext = promptManager.prepareConversationContext(sessionData.id, 'grok');
    const characterMemories = memoryManager.getCharacterMemories(sessionData.id);
    const conversationSummary = memoryManager.getConversationSummary(sessionData.id);
    
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
async function compressImage(base64String, mimeType, maxDimension = 1024, quality = 85) {
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

async function establishPersona(chat, personaImage, userPrompt, viewerAvatar) {
    try {
        const messages = [...chat.messages];
        
        // Get persona establishment prompt from prompt manager
        const personaPrompt = promptManager.getPersonaEstablishmentPrompt('characterChat', userPrompt);
        
        // Compress persona image to reduce API request size
        const compressedPersona = await compressImage(personaImage.base64, personaImage.mimeType);
        
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
            const compressedAvatar = await compressImage(viewerAvatar.base64, viewerAvatar.mimeType);
            
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
            response_format: zodResponseFormat(ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"],
            store: true
        };
        
        // Calculate and log total request size for debugging
        const requestPayload = JSON.stringify(apiConfig);
        const requestSizeMB = (requestPayload.length / (1024 * 1024)).toFixed(2);
        console.log(`📏 [establishPersona] Total request size: ${requestSizeMB} MB`);

        const completion = await grok.responses.create(apiConfig);

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
            validated.events.forEach(event => {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                addChatMessage(
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
            });
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const { updateChatSession } = require('../chatDatabase');
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Update token usage tracking for chat session
            if (completion?.usage) {
                const { updateChatSession } = require('../chatDatabase');
                const totalTokens = completion.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completion.usage)
                };
                updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API] Token usage: ${totalTokens} total tokens`);
            }
        }

        return response;
    } catch (error) {
        console.error("Error establishing persona:", error);
        throw new Error("The AI could not establish the persona. Please check the console for details.");
    }
}

async function continueConversation(chat, message) {
    try {
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const { getConversationData } = require('../chatDatabase');
            const conversationData = getConversationData(chat.chatId);
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
            response_format: zodResponseFormat(ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id: ${previousResponseId}`);
        }

        const completion = await grok.responses.create(apiConfig);

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
            validated.events.forEach(event => {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                addChatMessage(
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
            });
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const { updateChatSession } = require('../chatDatabase');
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(response);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary (use chat.messages for context)
            const summary = memoryManager.generateConversationSummary(chat.messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completion?.usage) {
                const { updateChatSession } = require('../chatDatabase');
                const totalTokens = completion.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completion.usage)
                };
                updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API continue] Token usage: ${totalTokens} total tokens`);
            }
        }

        return response;
    } catch (error) {
        console.error("Error continuing conversation:", error);
        throw new Error("The AI could not generate a response. Please check the console for details.");
    }
}

// New function that expects complete conversation context (no separate message parameter)
async function continueConversationWithContext(chat) {
    try {
        const messages = [...chat.messages];
        
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const { getConversationData } = require('../chatDatabase');
            const conversationData = getConversationData(chat.chatId);
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
            timeout: 120000,
            response_format: zodResponseFormat(ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id (context): ${previousResponseId}`);
        }

        const completion = await grok.responses.create(apiConfig);

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
            validated.events.forEach(event => {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                addChatMessage(
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
            });
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const { updateChatSession } = require('../chatDatabase');
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(response);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completion?.usage) {
                const { updateChatSession } = require('../chatDatabase');
                const totalTokens = completion.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completion.usage)
                };
                updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API context] Token usage: ${totalTokens} total tokens`);
            }
        }

        return response;
    } catch (error) {
        console.error("Error continuing conversation with context:", error);
        throw new Error("The AI could not generate a response. Please check the console for details.");
    }
}

// Streaming versions for real-time updates
async function establishPersonaStreaming(chat, personaImage, userPrompt, viewerAvatar, onStreamUpdate) {
    try {
        const messages = [...chat.messages];
        
        // For persona establishment, there's no previous response ID
        const previousResponseId = null;
        
        // Get persona establishment prompt from prompt manager
        const personaPrompt = promptManager.getPersonaEstablishmentPrompt('characterChat', userPrompt);
        
        // Compress persona image to reduce API request size
        const compressedPersona = await compressImage(personaImage.base64, personaImage.mimeType);
        
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
            const compressedAvatar = await compressImage(viewerAvatar.base64, viewerAvatar.mimeType);
            
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
            response_format: zodResponseFormat(ChatResponseSchema, "response"),
            include: ["reasoning.encrypted_content"],
            stream: true,
            store: true
        };
        
        // Calculate and log total request size for debugging
        const requestPayload = JSON.stringify(apiConfig);
        const requestSizeMB = (requestPayload.length / (1024 * 1024)).toFixed(2);
        console.log(`📏 [establishPersonaStreaming] Total request size: ${requestSizeMB} MB`);

        const completion = await grok.responses.create(apiConfig);

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
            // DEBUG: Log full chunk structure (limit to avoid spam)
            if (chunk.type === 'response.completed' || chunk.type === 'response.output_item.done') {
                console.log('🔍 [Responses Streaming] Chunk:', JSON.stringify(chunk, null, 2));
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

        // DEBUG: Log streaming completion info
        console.log('🔍 [Responses Streaming] Full response length:', fullResponse.length);
        console.log('🔍 [Responses Streaming] Response ID:', responseId);
        console.log('🔍 [Responses Streaming] Last chunk keys:', lastChunk ? Object.keys(lastChunk) : 'null');

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
            validated.events.forEach(event => {
                // Build event metadata
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                addChatMessage(
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
            });
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const { updateChatSession } = require('../chatDatabase');
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(fullResponse);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completionObject?.usage) {
                const { updateChatSession } = require('../chatDatabase');
                const totalTokens = completionObject.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completionObject.usage)
                };
                updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses Streaming] Token usage: ${totalTokens} total tokens`);
            }
        }

        return fullResponse;
    } catch (error) {
        console.error("Error establishing persona with streaming:", error);
        throw new Error("The AI could not establish the persona. Please check the console for details.");
    }
}

async function continueConversationStreaming(chat, message, onStreamUpdate) {
    try {
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const { getConversationData } = require('../chatDatabase');
            const conversationData = getConversationData(chat.chatId);
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
            response_format: zodResponseFormat(ChatResponseSchema, "response"),
            stream: true,
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id (streaming): ${previousResponseId}`);
        }

        const completion = await grok.responses.create(apiConfig);

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
            validated.events.forEach(event => {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                addChatMessage(
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
            });
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const { updateChatSession } = require('../chatDatabase');
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(fullResponse);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary (use chat.messages for context)
            const summary = memoryManager.generateConversationSummary(chat.messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completionObject?.usage) {
                const { updateChatSession } = require('../chatDatabase');
                const totalTokens = completionObject.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completionObject.usage)
                };
                updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API Streaming continue] Token usage: ${totalTokens} total tokens`);
            }
        }

        return fullResponse;
    } catch (error) {
        console.error("Error continuing conversation with streaming:", error);
        throw new Error("The AI could not generate a response. Please check the console for details.");
    }
}

// New streaming function that expects complete conversation context (no separate message parameter)
async function continueConversationWithContextStreaming(chat, onStreamUpdate) {
    try {
        // Get the previous response ID from chat object or database
        let previousResponseId = chat.lastResponseId || null;
        let responseOutput = null;
        let lastMessageCreatedAt = null;
        
        // If not in chat object, try to get from database
        if (!previousResponseId && chat.chatId) {
            const { getConversationData } = require('../chatDatabase');
            const conversationData = getConversationData(chat.chatId);
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
            response_format: zodResponseFormat(ChatResponseSchema, "response"),
            stream: true,
            include: ["reasoning.encrypted_content"] // Request encrypted thinking content
        };
        
        // Use previous_response_id only if we're not using response.output (i.e., message is fresh)
        if (previousResponseId && !isMessageOld) {
            apiConfig.previous_response_id = previousResponseId;
            console.log(`🔄 Using Responses API with previous_response_id (context streaming): ${previousResponseId}`);
        }

        const completion = await grok.responses.create(apiConfig);

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
            validated.events.forEach(event => {
                const metadata = {};
                if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
                if (event.weight !== undefined) metadata.weight = event.weight;
                if (event.intensity !== undefined) metadata.intensity = event.intensity;
                
                addChatMessage(
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
            });
            
            // Check for myname event and update chat session name
            const mynameEvent = validated.events.find(event => event.type === 'myname');
            if (mynameEvent && mynameEvent.content && mynameEvent.content.trim()) {
                const { updateChatSession } = require('../chatDatabase');
                const characterName = mynameEvent.content.trim();
                console.log(`📝 Updating chat session name from myname event: "${characterName}"`);
                updateChatSession(chat.chatId, { 
                    chat_name: characterName,
                    character_name: characterName
                });
            }

            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(fullResponse);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });

            // Update conversation summary (use chat.messages for context)
            const summary = memoryManager.generateConversationSummary(chat.messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
            
            // Update token usage tracking for chat session
            if (completionObject?.usage) {
                const { updateChatSession } = require('../chatDatabase');
                const totalTokens = completionObject.usage.total_tokens || 0;
                const usageData = {
                    total_tokens: totalTokens,
                    last_response_usage: JSON.stringify(completionObject.usage)
                };
                updateChatSession(chat.chatId, usageData);
                console.log(`💾 [Responses API Streaming context] Token usage: ${totalTokens} total tokens`);
            }
        }

        return fullResponse;
    } catch (error) {
        console.error("Error continuing conversation with context streaming:", error);
        throw new Error("The AI could not generate a response. Please check the console for details.");
    }
}

// Define tools for director AI
const directorTools = [
    {
        type: "function",
        function: {
            name: "anime_tag_search",
            description: "Search for anime tags and verify if they are high weight based on counts",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Tag or phrase to search" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "furry_tag_search",
            description: "Search for furry tags and verify if they are high weight based on counts",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Tag or phrase to search" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "novelai_tag_search",
            description: "Search NovelAI API for tag suggestions and verify if they are high weight based on confidence scores",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Tag or phrase to search" },
                    model: { type: "string", description: "NovelAI model to use (e.g., 'nai-diffusion-4-5-full')" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the web for character identification or tag verification",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" }
                },
                required: ["query"]
            }
        }
    }
];

// Import SearchService for NovelAI tag search
const { SearchService } = require('../textReplacements');
const AnimeTagSearch = require('../animeTagSearch');
const FurryTagSearch = require('../furryTagSearch');

// Tool execution functions
async function executeTool(toolCall) {
    const { name, arguments: args } = toolCall;
    const parsedArgs = JSON.parse(args);

    console.log(`🔧 TOOL EXECUTION STARTED: ${name}`);
    console.log(`   Parameters:`, parsedArgs);

    let result;
    const startTime = Date.now();

    try {
        switch (name) {
            case "anime_tag_search":
                console.log(`   🔍 Searching anime tags for: "${parsedArgs.query}"`);
                const animeSearch = new AnimeTagSearch();
                result = animeSearch.searchTags(parsedArgs.query);
                console.log(`   📊 Anime search returned ${result.length} results`);
                break;

            case "furry_tag_search":
                console.log(`   🔍 Searching furry tags for: "${parsedArgs.query}"`);
                const furrySearch = new FurryTagSearch();
                result = furrySearch.searchTags(parsedArgs.query);
                console.log(`   📊 Furry search returned ${result.length} results`);
                break;

            case "novelai_tag_search":
                const model = parsedArgs.model || 'nai-diffusion-4-5-full';
                console.log(`   🔍 Searching NovelAI API for: "${parsedArgs.query}" using model: ${model}`);
                const searchService = new SearchService();
                result = await searchService.performTagSearch(parsedArgs.query, model);
                console.log(`   📊 NovelAI API search returned ${result.length} results`);
                break;

            default:
                throw new Error(`Unknown tool: ${name}`);
        }

        const executionTime = Date.now() - startTime;
        console.log(`✅ TOOL EXECUTION COMPLETED: ${name} (${executionTime}ms)`);

        if (result && typeof result === 'object') {
            console.log(`   📋 Result summary: ${Object.keys(result).length} keys`);
            if (Array.isArray(result)) {
                console.log(`   📋 Result type: Array with ${result.length} items`);
            }
        }

        return result;

    } catch (error) {
        console.error(`❌ TOOL EXECUTION FAILED: ${name}`, error.message);
        throw error;
    }
}

// Modified callDirectorAIWithStructuredOutput with tool calling loop
async function callDirectorAIWithStructuredOutput(messages, options = {}, onStreamUpdate = null) {
    try {
        let currentMessages = [...messages];
        let maxLoops = options?.toolLoops || 5; // Prevent infinite loops

        while (maxLoops > 0) {
        // Determine response format based on responseSchema parameter
        let responseFormat = null;
        
        if (options?.responseSchema === null || options?.responseSchema === undefined) {
            // No schema provided - use normal text response
            responseFormat = null;
        } else if (typeof options?.responseSchema === 'string') {
            // String format provided (e.g., "json_object")
            responseFormat = { type: options?.responseSchema };
        } else if (typeof options?.responseSchema === 'object' && options?.responseSchema._def) {
            // Zod schema provided - use structured output
            responseFormat = zodResponseFormat(options?.responseSchema, "response");
        } else {
            // Fallback to normal text if invalid schema type
            console.warn('⚠️ Invalid responseSchema type, falling back to normal text response');
            responseFormat = null;
        }
        
        let apiConfig = {
            model: options?.model || "grok-4-fast-reasoning",
            input: currentMessages,
            max_output_tokens: options?.max_completion_tokens || options?.max_output_tokens || 8000,
            timeout: options?.timeout || 60000,
            store: options?.store || true,
            stream: options?.stream || config?.chat_streaming_enabled || false, // Always use streaming
            tools: options?.tools || undefined,
            tool_choice: options?.tool_choice || !!options?.tools ? "auto" : undefined
        };
        
        // Add temperature if provided (0-2, default is 1.0)
        if (options?.temperature !== undefined) {
            apiConfig.temperature = options.temperature;
            console.log(`🌡️ Using custom temperature: ${options.temperature}`);
        }
        
        // Add previous_response_id for stateful conversation on retries
        if (options?.previous_response_id) {
            apiConfig.previous_response_id = options.previous_response_id;
            console.log(`🔗 Using previous_response_id for stateful conversation: ${options.previous_response_id}`);
        }
        
        // Add response_format (zodResponseFormat already wraps it correctly for Responses API)
        if (responseFormat) {
            apiConfig.response_format = responseFormat;
        }
        
        // Add reasoning effort for supported models
        if (options?.reasoningEffort === 'high' && apiConfig.model === 'grok-4-fast-reasoning') {
            apiConfig.reasoning_effort = 'high';
        }

        // Add live search - NOTE: Using search_parameters instead of new agentic tools
        // because agentic tools don't support structured output (response_format) yet
        // Dynamic generation REQUIRES structured output with Zod schemas
        // When xAI adds structured output support to agentic tools, migrate to:
        // tools: [{ "type": "web_search" }, { "type": "x_search" }]
        if (options?.liveSearch) {
            apiConfig.search_parameters = options?.search_parameters || {
                mode: "auto", // Enable live search
                return_citations: true,
                sources: [
                    { 
                        "type": "web",
                        "safe_search": false
                    },
                    { 
                        "type": "x"
                    },
                ],
                max_search_results: 25
            };
            console.log('🔍 [Responses API] Live search enabled');
        }

        // Add tokenizer collection if optimize is enabled
        if (options?.enableOptimize && secureConfig.grok?.tokenizerCollectionId) {
            apiConfig.knowledge_base = {
                collection_ids: [secureConfig.grok.tokenizerCollectionId]
            };
            console.log('⚡ Token optimization enabled - using collection:', secureConfig.grok.tokenizerCollectionId);
        }

        console.log(`🎯 Calling Director AI with model: ${apiConfig.model}, reasoning: ${apiConfig.reasoning_effort || 'none'}, timeout: ${apiConfig.timeout}ms`);

        // Initialize progress tracking variables (moved outside retry loop)
        const totalKeys = options?.totalKeys || 0; // 0 means no key tracking needed
        let currentKeyIndex = 0;
        let startedKeys = new Set();

        // Retry streaming up to 3 times before giving up
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            try {
                console.log(`🎯 [Responses API] Attempting streaming response (attempt ${retryCount + 1}/${maxRetries})...`);
                const streamStartTime = Date.now();
                const stream = await grok.responses.create(apiConfig);
                let fullResponse = '';
                let lastChunk = null;
                let responseId = null;
                let completionObject = null;

                // Send initial streaming start signal
                if (options.ws && options.handler) {
                    options.handler.sendGenerationProgress(options.ws, options.requestId || 'streaming', {
                        phase: 'ai_streaming',
                        currentKey: totalKeys > 0 ? 0 : undefined,
                        totalKeys: totalKeys > 0 ? totalKeys : undefined
                    });
                }

                // Real-time JSON parsing using clarinet (streaming SAX parser)
                console.log('\n🔄 STARTING LIVE STREAMING JSON PARSING WITH CLARINET');
                console.log('='.repeat(70));

                // Check if key filtering is enabled
                const extractKeys = options?.extractKeys;
                if (extractKeys) {
                    const patterns = Array.isArray(extractKeys) ? extractKeys : [extractKeys];
                    console.log(`🔍 KEY FILTERING ENABLED - Extracting only: ${patterns.join(', ')}`);
                } else {
                    console.log('🔍 KEY FILTERING DISABLED - Extracting all keys');
                }

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
                            console.log(`🏗️  LIVE: ${fullPath} = {object}`);
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

                        // Format and display the value
                        let displayValue;
                        if (typeof value === 'string' && value.length > 80) {
                            displayValue = value.substring(0, 80) + '...';
                        } else {
                            displayValue = value;
                        }

                        if (typeof value === 'string') {
                            console.log(`📊 LIVE: ${fullPath} = "${displayValue}"`);
                        } else {
                            console.log(`📊 LIVE: ${fullPath} = ${displayValue}`);
                        }

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
                        console.log(`📋 LIVE: ${fullPath} = [array]`);
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
                    console.log(`\\n🏁 COMPLETE JSON OBJECT RECEIVED`);
                    console.log(`📊 Total unique elements extracted: ${seenKeys.size}`);
                });

                jsonParser.on('error', (error) => {
                    console.warn('⚠️ Clarinet parsing error (JSON may be incomplete):', error.message);
                    // Clarinet handles incomplete JSON gracefully - continues parsing valid portions
                });

                // Process streaming chunks with live output - Responses API format
                for await (const chunk of stream) {
                    // Handle different chunk types from Responses API
                    if (chunk.type === 'response.created' || chunk.type === 'response.in_progress') {
                        // Initial response object - capture ID
                        if (chunk.response?.id) {
                            responseId = chunk.response.id;
                            console.log('🔍 [Responses API] Response ID:', responseId);
                        }
                    } else if (chunk.type === 'response.output_item.done' && chunk.item) {
                        // Complete output item - capture for later processing
                        lastChunk = chunk;
                    } else if (chunk.type === 'response.output_text.delta') {
                        // Text delta chunks - this is the actual content
                        const content = chunk.delta || '';
                        if (content) {
                            fullResponse += content;

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
                            console.log('🏁 [Responses API] Response completed:', responseId);
                        }
                    }
                }

                // Signal end of stream to clarinet
                jsonParser.end();

                console.log(`\\n✅ LIVE STREAMING JSON PARSING COMPLETED - Total unique elements: ${seenKeys.size}`);
                console.log('='.repeat(70));


                // Extract response data from completionObject (Responses API format)
                // Check for tool calls in the completion object output
                let toolCalls = null;
                if (completionObject?.output) {
                    for (const outputItem of completionObject.output) {
                        if (outputItem.type === 'message' && outputItem.tool_calls) {
                            toolCalls = outputItem.tool_calls;
                            break;
                        }
                    }
                }

                // Check for tool calls first
                if (toolCalls && toolCalls.length > 0) {
                    console.log(`🔧 [Responses API] Processing ${toolCalls.length} tool call(s)`);
                    // Add tool call message to conversation
                    currentMessages.push({
                        role: "assistant",
                        tool_calls: toolCalls
                    });

                    for (const toolCall of toolCalls) {
                        console.log(`🔧 EXECUTING TOOL: ${toolCall.function.name}`);
                        console.log(`   Tool ID: ${toolCall.id}`);
                        console.log(`   Arguments: ${toolCall.function.arguments}`);

                        const toolStartTime = Date.now();
                        const toolResult = await executeTool(toolCall);
                        const toolDuration = Date.now() - toolStartTime;

                        console.log(`✅ TOOL RESULT (${toolDuration}ms):`);
                        console.log(`   Tool: ${toolCall.function.name}`);
                        console.log(`   Result:`, JSON.stringify(toolResult, null, 2));

                        currentMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolCall.function.name,
                            content: JSON.stringify(toolResult)
                        });

                        console.log(`📝 Added tool result to conversation (${toolResult ? Object.keys(toolResult).length : 0} keys)`);
                    }
                        // Continue to next iteration for final response
                        break;
                } else {
                    // No tool calls - extract final response from completionObject
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
                    
                    console.log(`📚 [Responses API] Found ${citations.length} citations in response`);
                    if (citations.length > 0) {
                        console.log(`📚 Citations:`, JSON.stringify(citations, null, 2));
                    }
                    console.log(`📚 Response from completionObject: ${response.length} characters`);

                    let parsedResponse;
                    if (typeof response === 'string' && response.trim()) {
                        // Handle different response types based on responseSchema
                        if (options?.responseSchema === null || options?.responseSchema === undefined) {
                            // Normal text response - return as is
                            parsedResponse = response;
                            console.log('✅ Normal text response received');
                        } else if (typeof options?.responseSchema === 'string') {
                            // String format response (e.g., "json_object") - parse as JSON
                            try {
                                const rawJson = JSON.parse(response);
                                parsedResponse = { ...rawJson, citations: citations };
                                console.log('✅ JSON response parsed successfully');
                            } catch (parseError) {
                                console.warn('⚠️ Failed to parse JSON response:', parseError.message);
                                parsedResponse = { error: 'Invalid JSON response from AI', content: response, citations: citations };
                            }
                        } else if (typeof options?.responseSchema === 'object' && options?.responseSchema._def) {
                            // Zod schema response - validate with schema
                            try {
                                const rawJson = JSON.parse(response);
                                const validatedResponse = options?.responseSchema.parse(rawJson);
                                parsedResponse = { ...validatedResponse, citations: citations };
                                console.log('✅ Zod schema validation passed');
                            } catch (parseError) {
                                const rawJson = JSON.parse(response);
                                if (parseError.name === 'ZodError') {
                                    console.warn('⚠️ Zod schema validation failed:', parseError.errors);
                                    parsedResponse = { error: 'Zod schema validation failed', details: parseError.errors, ...rawJson, citations: citations };
                                } else {
                                    console.warn('⚠️ Failed to parse streaming AI response as JSON:', parseError.message);
                                    parsedResponse = { error: 'Invalid JSON response from AI', ...rawJson, citations: citations };
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
                    console.log(`✅ Streaming completed: ${fullResponse.length} characters received in ${Math.round(streamDuration/1000)}s`);

                    // Determine if response is structured based on responseSchema type
                    const isStructured = options?.responseSchema !== null && options?.responseSchema !== undefined;
                    
                    return {
                        content: parsedResponse,
                        message: parsedResponse,
                        rawContent: response,
                        citations: citations,
                        isStructured: isStructured,
                        responseId: responseId
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

        maxLoops--;
        }

        throw new Error("Max tool calling loops reached");
    } catch (error) {
        console.error('❌ Error calling Director AI with structured output:', error);
        throw error;
    }
}

module.exports = {
    createPersonaChatSession,
    establishPersona,
    continueConversation,
    continueConversationWithContext,
    establishPersonaStreaming,
    continueConversationStreaming,
    continueConversationWithContextStreaming,
    callDirectorAIWithStructuredOutput
};


