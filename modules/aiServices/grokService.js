const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const promptManager = require('../promptManager');
const { addChatMessage, updateConversationData } = require('../chatDatabase');
const memoryManager = require('../memoryManager');
const streamingEventProcessor = require('../streamingEventProcessor');
const { zodResponseFormat } = require("openai/helpers/zod");
const { z } = require('zod');
const jaison = require('jaison');

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
        temperature: sessionData.temperature || 0.8,
        model: sessionData.model || "grok-2",
        thoughtLevel: sessionData.thought_level || "minimal",
        chatId: sessionData.id,
        sessionData: sessionData,
        personaSettings: personaSettings
    };
}

async function establishPersona(chat, personaImage, userPrompt, viewerAvatar) {
    try {
        const messages = [...chat.messages];
        
        // Get persona establishment prompt from prompt manager
        const personaPrompt = promptManager.getPersonaEstablishmentPrompt('characterChat', userPrompt);
        
        // Add the persona establishment message
        const content = [
            {
                type: "text",
                text: personaPrompt
            },
            {
                type: "image_url",
                image_url: {
                    url: `data:${personaImage.mimeType};base64,${personaImage.base64}`,
                    detail: "high"
                }
            }
        ];

        // Add viewer avatar if provided
        if (viewerAvatar) {
            content.push({
                type: "text",
                text: "\n\nThis is my beloved, who I am speaking to:"
            });
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:${viewerAvatar.mimeType};base64,${viewerAvatar.base64}`,
                    detail: "high"
                }
            });
        }

        messages.push({
            role: "user",
            content: content
        });

        // Configure API call based on model
        const apiConfig = {
            model: chat.model || "grok-2",
            messages: messages,
            max_completion_tokens: 8000,
            response_format: { type: "json_object" },
            store: true // Store responses for 30-day retention
        };

        // Add model-specific parameters
        const supportedModels = ["grok-3-mini", "grok-4-fast-reasoning", "grok-4"];
        if (supportedModels.includes(chat.model)) {
            // Grok reasoning models support temperature
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        } else {
            // Default models support temperature
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        }

        const completion = await grok.chat.completions.create(apiConfig);

        const response = completion.choices[0].message.content;
        const responseId = completion.id; // Store the response ID for conversation state
        
        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: response,
            responseId: responseId
        });

        // Update the chat object
        chat.messages = messages;

        return response;
    } catch (error) {
        console.error("Error establishing persona:", error);
        throw new Error("The AI could not establish the persona. Please check the console for details.");
    }
}

async function continueConversation(chat, message) {
    try {
        const messages = [...chat.messages];
        
        // Get the previous response ID from the last assistant message
        let previousResponseId = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant" && messages[i].responseId) {
                previousResponseId = messages[i].responseId;
                break;
            }
        }
        
        // Add user message
        messages.push({
            role: "user",
            content: message
        });

        // Configure API call based on model
        const apiConfig = {
            model: chat.model || "grok-4-fast-reasoning",
            messages: messages,
            max_completion_tokens: 8000,
            response_format: { type: "json_object" },
            store: true // Store responses for 30-day retention
        };

        // Add model-specific parameters
        const supportedModels = ["grok-3-mini", "grok-4-fast-reasoning", "grok-4"];
        if (supportedModels.includes(chat.model)) {
            // Grok reasoning models support temperature
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        } else {
            // Default models support temperature
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        }

        const completion = await grok.chat.completions.create(apiConfig);

        const response = completion.choices[0].message.content;
        const responseId = completion.id; // Store the response ID for conversation state
        
        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: response,
            responseId: responseId
        });

        // Update the chat object
        chat.messages = messages;

        // Store conversation data and response ID in database
        if (chat.chatId) {
            
            // Store the assistant response with response ID and conversation data
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                temperature: chat.temperature,
                thoughtLevel: chat.thoughtLevel,
                lastUpdated: Date.now()
            });
            
            addChatMessage(chat.chatId, 'assistant', response, null, responseId, conversationData, previousResponseId);
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(response);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
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
        
        // Get the previous response ID from the last assistant message
        let previousResponseId = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant" && messages[i].responseId) {
                previousResponseId = messages[i].responseId;
                break;
            }
        }

        // Configure API call based on model
        const apiConfig = {
            model: chat.model || "grok-4-fast-reasoning",
            messages: messages,
            max_completion_tokens: 8000,
            timeout: 120000,
            response_format: { type: "json_object" },
            store: true // Store responses for 30-day retention
        };

        const completion = await grok.chat.completions.create(apiConfig);

        const response = completion.choices[0].message.content;
        const responseId = completion.id; // Store the response ID for conversation state
        
        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: response,
            responseId: responseId
        });

        // Update the chat object
        chat.messages = messages;

        // Store conversation data and response ID in database
        if (chat.chatId) {
            
            // Store the assistant response with response ID and conversation data
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                temperature: chat.temperature,
                thoughtLevel: chat.thoughtLevel,
                lastUpdated: Date.now()
            });
            
            addChatMessage(chat.chatId, 'assistant', response, null, responseId, conversationData, previousResponseId);
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(response);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
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
        
        // Add the persona establishment message
        const content = [
            {
                type: "text",
                text: personaPrompt
            },
            {
                type: "image_url",
                image_url: {
                    url: `data:${personaImage.mimeType};base64,${personaImage.base64}`,
                    detail: "high"
                }
            }
        ];

        // Add viewer avatar if provided
        if (viewerAvatar) {
            content.push({
                type: "text",
                text: "\n\nThis is my beloved, who I am speaking to:"
            });
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:${viewerAvatar.mimeType};base64,${viewerAvatar.base64}`,
                    detail: "high"
                }
            });
        }

        messages.push({
            role: "user",
            content: content
        });

        // Configure API call based on model
        const apiConfig = {
            model: chat.model || "grok-2",
            messages: messages,
            max_completion_tokens: 8000,
            response_format: { type: "json_object" },
            stream: true,
            store: true // Store responses for 30-day retention
        };

        // Add model-specific parameters
        const supportedModels = ["grok-3-mini", "grok-4-fast-reasoning", "grok-4"];
        if (supportedModels.includes(chat.model)) {
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        } else {
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        }

        const completion = await grok.chat.completions.create(apiConfig);

        let fullResponse = '';
        let responseId = null;
        
        for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullResponse += content;
                
                // Process events from streaming response
                if (onStreamUpdate) {
                    const events = streamingEventProcessor.extractEventsFromStream(content, fullResponse);
                    const processedEvents = streamingEventProcessor.processEvents(events);
                    onStreamUpdate(content, fullResponse, processedEvents);
                }
            }
            
            // Capture response ID from first chunk
            if (!responseId && chunk.id) {
                responseId = chunk.id;
            }
        }

        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: fullResponse
        });

        // Update the chat object
        chat.messages = messages;

        // Store conversation data and response ID in database
        if (chat.chatId) {
            
            // Store the assistant response with response ID and conversation data
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                temperature: chat.temperature,
                thoughtLevel: chat.thoughtLevel,
                lastUpdated: Date.now()
            });
            
            addChatMessage(chat.chatId, 'assistant', fullResponse, null, responseId, conversationData, previousResponseId);
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(fullResponse);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
        }

        return fullResponse;
    } catch (error) {
        console.error("Error establishing persona with streaming:", error);
        throw new Error("The AI could not establish the persona. Please check the console for details.");
    }
}

async function continueConversationStreaming(chat, message, onStreamUpdate) {
    try {
        const messages = [...chat.messages];
        
        // Get the previous response ID from the last assistant message
        let previousResponseId = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant" && messages[i].responseId) {
                previousResponseId = messages[i].responseId;
                break;
            }
        }
        
        // Add user message
        messages.push({
            role: "user",
            content: message
        });

        // Configure API call based on model
        const apiConfig = {
            model: chat.model || "grok-2",
            messages: messages,
            max_completion_tokens: 8000,
            response_format: { type: "json_object" },
            stream: true,
            store: true // Store responses for 30-day retention
        };

        // Add model-specific parameters
        const supportedModels = ["grok-3-mini", "grok-4-fast-reasoning", "grok-4"];
        if (supportedModels.includes(chat.model)) {
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        } else {
            if (chat.temperature !== undefined) {
                apiConfig.temperature = chat.temperature;
            }
        }

        const completion = await grok.chat.completions.create(apiConfig);

        let fullResponse = '';
        let responseId = null;
        
        for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullResponse += content;
                
                // Process events from streaming response
                if (onStreamUpdate) {
                    const events = streamingEventProcessor.extractEventsFromStream(content, fullResponse);
                    const processedEvents = streamingEventProcessor.processEvents(events);
                    onStreamUpdate(content, fullResponse, processedEvents);
                }
            }
            
            // Capture response ID from first chunk
            if (!responseId && chunk.id) {
                responseId = chunk.id;
            }
        }

        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: fullResponse
        });

        // Update the chat object
        chat.messages = messages;

        // Store conversation data and response ID in database
        if (chat.chatId) {
            
            // Store the assistant response with response ID and conversation data
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                temperature: chat.temperature,
                thoughtLevel: chat.thoughtLevel,
                lastUpdated: Date.now()
            });
            
            addChatMessage(chat.chatId, 'assistant', fullResponse, null, responseId, conversationData, previousResponseId);
            
            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(fullResponse);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });
            
            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
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
        const messages = [...chat.messages];

        // Get the previous response ID from the last assistant message
        let previousResponseId = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant" && messages[i].responseId) {
                previousResponseId = messages[i].responseId;
                break;
            }
        }

        // Configure API call based on model
        const apiConfig = {
            model: chat.model || "grok-4-fast-reasoning",
            messages: messages,
            max_completion_tokens: 8000,
            timeout: 120000,
            response_format: { type: "json_object" },
            stream: true,
            store: true // Store responses for 30-day retention
        };

        const completion = await grok.chat.completions.create(apiConfig);

        let fullResponse = '';
        let responseId = null;

        for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullResponse += content;

                // Process events from streaming response
                if (onStreamUpdate) {
                    onStreamUpdate(content, fullResponse);
                }
            }

            // Capture response ID from first chunk
            if (!responseId && chunk.id) {
                responseId = chunk.id;
            }
        }

        // Add the response to chat history
        messages.push({
            role: "assistant",
            content: fullResponse,
            responseId: responseId
        });

        // Update the chat object
        chat.messages = messages;

        // Store conversation data and response ID in database
        if (chat.chatId) {

            // Store the assistant response with response ID and conversation data
            const conversationData = JSON.stringify({
                messages: messages,
                model: chat.model,
                temperature: chat.temperature,
                thoughtLevel: chat.thoughtLevel,
                lastUpdated: Date.now()
            });

            addChatMessage(chat.chatId, 'assistant', fullResponse, null, responseId, conversationData, previousResponseId);

            // Extract and store memories
            const memories = memoryManager.extractMemoriesFromResponse(fullResponse);
            memories.forEach(memory => {
                memoryManager.addCharacterMemory(chat.chatId, memory);
            });

            // Update conversation summary
            const summary = memoryManager.generateConversationSummary(messages);
            memoryManager.updateConversationSummary(chat.chatId, summary);
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
async function callDirectorAIWithStructuredOutput(messages, model, reasoningEffort = 'low', timeout = 60000, dryrun = false, enableLiveSearch = false, onStreamUpdate = null, responseSchema = null) {
    try {
        let currentMessages = [...messages];
        let maxLoops = 5; // Prevent infinite loops

        while (maxLoops > 0) {
        // Determine response format based on responseSchema parameter
        let responseFormat = null;
        
        if (responseSchema === null || responseSchema === undefined) {
            // No schema provided - use normal text response
            responseFormat = null;
        } else if (typeof responseSchema === 'string') {
            // String format provided (e.g., "json_object")
            responseFormat = { type: responseSchema };
        } else if (typeof responseSchema === 'object' && responseSchema._def) {
            // Zod schema provided - use structured output
            responseFormat = zodResponseFormat(responseSchema, "response");
        } else {
            // Fallback to normal text if invalid schema type
            console.warn('⚠️ Invalid responseSchema type, falling back to normal text response');
            responseFormat = null;
        }
        
        let apiConfig = {
            model: model || "grok-4",
            messages: currentMessages,
            max_completion_tokens: 8000,
            timeout: timeout,
            store: true,
            stream: true, // Always use streaming
            tools: directorTools,
            tool_choice: "auto"
        };
        
        // Only add response_format if we have one
        if (responseFormat) {
            apiConfig.response_format = responseFormat;
        }
        
        // Add reasoning effort for supported models
        if (reasoningEffort === 'high' && model !== 'grok-4') {
            apiConfig.reasoning_effort = 'high';
        }

        // Add live search parameters if enabled
        if (enableLiveSearch) {
            apiConfig.search_parameters = {
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
            console.log('🔍 Live search enabled for director AI call');
        }

        console.log(`🎯 Calling Director AI with model: ${model}, reasoning: ${apiConfig.reasoning_effort || 'none'}, timeout: ${timeout}ms`);

        // Retry streaming up to 3 times before giving up
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            try {
                console.log(`🎯 Attempting streaming response (attempt ${retryCount + 1}/${maxRetries})...`);
                const streamStartTime = Date.now();
                const stream = await grok.chat.completions.create(apiConfig);
                let fullResponse = '';
                let lastChunk = null;

                // Real-time JSON parsing using jaison (AI-optimized JSON parser)
                console.log('\n🔄 STARTING LIVE AI-OPTIMIZED JSON PARSING WITH JAISON');
                console.log('='.repeat(70));

                let jsonAccumulator = '';
                let seenKeys = new Set();

                // Process streaming chunks with live output
                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    if (content) {
                        fullResponse += content;
                        lastChunk = chunk;
                        jsonAccumulator += content;

                        // Send streaming update to UI if callback provided
                        if (onStreamUpdate) {
                            onStreamUpdate(content, fullResponse);
                        }

                        // Try to extract and display individual key-value pairs as they become available
                        extractLiveKeyValuePairs(jsonAccumulator, seenKeys);
                    }
                }

                // Final comprehensive parsing of complete response
                console.log('\\n🏁 FINAL PARSING ATTEMPT...');
                if (jsonAccumulator.trim()) {
                    try {
                        const parsed = jaison(jsonAccumulator);
                        if (parsed && typeof parsed === 'object') {
                            console.log('🏗️  COMPLETE OBJECT RECEIVED');
                            extractPairsFromJaisonObject(parsed, '', seenKeys);
                        }
                    } catch (error) {
                        console.warn('⚠️ Jaison parsing failed:', error.message);
                        // Fallback to regular JSON.parse
                        try {
                            const parsed = JSON.parse(jsonAccumulator);
                            extractPairsFromJaisonObject(parsed, '', seenKeys);
                        } catch (fallbackError) {
                            console.warn('⚠️ Fallback JSON parsing also failed:', fallbackError.message);
                        }
                    }
                }

                console.log(`\\n✅ LIVE AI-OPTIMIZED JSON PARSING COMPLETED - Total unique elements: ${seenKeys.size}`);
                console.log('='.repeat(70));

                // Simple and robust live key-value extraction
                function extractLiveKeyValuePairs(jsonStr, seenKeys) {
                    // Only process if we have meaningful data
                    if (jsonStr.length < 20) return;

                    // Look for complete key-value pairs using simple regex patterns
                    const patterns = [
                        // String values: "key": "value" followed by , } or ]
                        /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"(\s*[,\]\}])/g,
                        // Number values: "key": 123 followed by , } or ]
                        /"([^"]+)"\s*:\s*([0-9]+(?:\.[0-9]+)?)(\s*[,\]\}])/g,
                        // Boolean/null: "key": true/false/null followed by , } or ]
                        /"([^"]+)"\s*:\s*(true|false|null)(\s*[,\]\}])/g
                    ];

                    for (const pattern of patterns) {
                        let match;
                        pattern.lastIndex = 0; // Reset regex

                        while ((match = pattern.exec(jsonStr)) !== null) {
                            const key = match[1];
                            const value = match[2];
                            const terminator = match[3];

                            // Only process if we have a proper terminator (indicating complete value)
                            if (terminator && terminator.trim()) {
                                const pairKey = `root.${key}`;

                                if (!seenKeys.has(pairKey)) {
                                    seenKeys.add(pairKey);

                                    // Format and display the value
                                    let displayValue;
                                    if (typeof value === 'string' && value.length > 80) {
                                        displayValue = value.substring(0, 80) + '...';
                                    } else {
                                        displayValue = value;
                                    }

                                    // Display based on value type
                                    if (pattern.source.includes('"((?:[^"\\\\]|\\\\.)*)"')) {
                                        // String value
                                        console.log(`📊 ${key} = "${displayValue}"`);
                                    } else {
                                        // Number, boolean, or null
                                        console.log(`📊 ${key} = ${displayValue}`);
                                    }
                                }
                            }
                        }
                    }

                    // Look for object/array starts (simpler detection)
                    const structPatterns = [
                        /"([^"]+)"\s*:\s*\{/g,  // Object start
                        /"([^"]+)"\s*:\s*\[/g   // Array start
                    ];

                    for (const pattern of structPatterns) {
                        let match;
                        pattern.lastIndex = 0;

                        while ((match = pattern.exec(jsonStr)) !== null) {
                            const key = match[1];
                            const structKey = `root.${key}_struct`;

                            if (!seenKeys.has(structKey)) {
                                seenKeys.add(structKey);

                                if (pattern.source.includes('\\{')) {
                                    console.log(`🏗️  ${key} = {object}`);
                                } else {
                                    console.log(`📋 ${key} = [array]`);
                                }
                            }
                        }
                    }
                }

                // Helper function to show live values
                function showLiveValue(path, key, value, seenKeys) {
                    const fullKey = `${path}.${key}`;
                    if (!seenKeys.has(fullKey)) {
                        seenKeys.add(fullKey);

                        // Parse the value
                        let parsedValue;
                        if (value.startsWith('"') && value.endsWith('"')) {
                            parsedValue = value.slice(1, -1);
                        } else {
                            parsedValue = value;
                        }

                        const indent = '\t'.repeat(Math.max(0, path.split('.').length - 1));
                        const displayValue = typeof parsedValue === 'string' && parsedValue.length > 100
                            ? parsedValue.substring(0, 100) + '...'
                            : parsedValue;

                        if (typeof parsedValue === 'string') {
                            console.log(`${indent}📊 ${key} = "${displayValue}"`);
                        } else {
                            console.log(`${indent}📊 ${key} = ${displayValue}`);
                        }
                    }
                }

                // Helper function for jaison object extraction
                function extractPairsFromJaisonObject(obj, path, seenKeys) {
                    for (const [key, value] of Object.entries(obj)) {
                        const fullPath = path ? `${path}.${key}` : key;
                        const pairKey = `${fullPath}:${JSON.stringify(value)}`;

                        if (!seenKeys.has(pairKey)) {
                            seenKeys.add(pairKey);

                            // Format value for display
                            let displayValue;
                            if (typeof value === 'string' && value.length > 100) {
                                displayValue = value.substring(0, 100) + '...';
                            } else {
                                displayValue = JSON.stringify(value);
                            }

                            console.log(`📊 ${fullPath}: ${key} = ${displayValue}`);

                            // Recursively extract nested objects
                            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                                extractPairsFromJaisonObject(value, fullPath, seenKeys);
                            } else if (Array.isArray(value)) {
                                console.log(`📊 ${fullPath}: ${key}[] = ${value.length} items`);
                            }
                        }
                    }
                }


                // Get the response message for tool calling
                const responseMessage = lastChunk?.choices[0]?.message || {};

                // Check for tool calls first
                if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                    console.log(`🔧 Processing ${responseMessage.tool_calls.length} tool call(s)`);
                    currentMessages.push(responseMessage);

                    for (const toolCall of responseMessage.tool_calls) {
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
                    // No tool calls - this should be the final structured response
                    const response = fullResponse || responseMessage.content || '';
                    const citations = responseMessage?.citations || [];
                    console.log(`📚 Found ${citations.length} citations in response`);
                    console.log(`📚 Citations: ${citations}`);
                    console.log(`📚 Response: ${fullResponse}`);
                    console.log(`📚 Response: ${JSON.stringify(responseMessage, null, 2)}`);

                    let parsedResponse;
                    if (typeof response === 'string' && response.trim()) {
                        // Handle different response types based on responseSchema
                        if (responseSchema === null || responseSchema === undefined) {
                            // Normal text response - return as is
                            parsedResponse = response;
                            console.log('✅ Normal text response received');
                        } else if (typeof responseSchema === 'string') {
                            // String format response (e.g., "json_object") - parse as JSON
                            try {
                                const rawJson = JSON.parse(response);
                                parsedResponse = { ...rawJson, citations: citations };
                                console.log('✅ JSON response parsed successfully');
                            } catch (parseError) {
                                console.warn('⚠️ Failed to parse JSON response:', parseError.message);
                                parsedResponse = { error: 'Invalid JSON response from AI', content: response, citations: citations };
                            }
                        } else if (typeof responseSchema === 'object' && responseSchema._def) {
                            // Zod schema response - validate with schema
                            try {
                                const rawJson = JSON.parse(response);
                                const validatedResponse = responseSchema.parse(rawJson);
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
                    const isStructured = responseSchema !== null && responseSchema !== undefined;
                    
                    return {
                        content: parsedResponse,
                        message: parsedResponse,
                        rawContent: response,
                        citations: citations,
                        isStructured: isStructured
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


