const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const promptManager = require('../promptManager');
const { addChatMessage, updateConversationData } = require('../chatDatabase');
const memoryManager = require('../memoryManager');
const streamingEventProcessor = require('../streamingEventProcessor');

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

// Memory management is now handled by the centralized memoryManager

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
        const supportedModels = ["grok-3-mini", "grok-4"];
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
            model: chat.model || "grok-2",
            messages: messages,
            max_completion_tokens: 8000,
            response_format: { type: "json_object" },
            store: true // Store responses for 30-day retention
        };

        // Add model-specific parameters
        const supportedModels = ["grok-3-mini", "grok-4"];
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
            model: chat.model || "grok-2",
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
        const supportedModels = ["grok-3-mini", "grok-4"];
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
        const supportedModels = ["grok-3-mini", "grok-4"];
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
            model: chat.model || "grok-2",
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

module.exports = {
    createPersonaChatSession,
    establishPersona,
    continueConversation,
    continueConversationWithContext,
    establishPersonaStreaming,
    continueConversationStreaming,
    continueConversationWithContextStreaming
};
