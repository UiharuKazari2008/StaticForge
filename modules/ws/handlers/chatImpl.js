// Chat WebSocket implementations (migrated from websocketHandlers.js)
const fs = require('fs');
const path = require('path');

function chatStreamingEnabled(handler) {
    return !!handler.globalResources.getConfig()?.chat_streaming_enabled;
}

async function handleCreateChatSession(handler, ws, message, clientInfo, wsServer) {
    try {
        // Handle both message.data and direct message properties
        const data = message.data || message;
        console.log('📝 Creating chat session with data:', JSON.stringify(data, null, 2));
        const { filename, characterName, textContextInfo, textViewerInfo, storyContext, verbosityLevel, model: clientModel } = data;

        if (!filename) {
            handler.sendError(ws, 'Filename is required', null, message.requestId);
            return;
        }

        // Get persona settings for defaults
        const personaSettings = await handler.globalResources.getChatDatabase().getPersonaSettings();
        const sessionData = {
            chat_name: characterName || null,
            filename: filename,
            provider: 'grok',
            model: clientModel || handler.globalResources.getGrokService().getDefaultGrokModel(),
            character_name: characterName || null,
            text_context_info: textContextInfo || null,
            text_viewer_info: textViewerInfo || null,
            story_context: storyContext || null,
            verbosity_level: verbosityLevel || personaSettings.default_verbosity || 3
        };

        const chatId = await handler.globalResources.getChatDatabase().createChatSession(sessionData);

        if (!chatId) {
            handler.sendError(ws, 'Failed to create chat session', null, message.requestId);
            return;
        }

        // Send initial response
        handler.sendToClient(ws, {
            type: 'create_chat_session_response',
            requestId: message.requestId,
            data: {
                success: true,
                chatId: chatId,
                message: 'Chat session created successfully'
            },
            timestamp: new Date().toISOString()
        });

        // Automatically start the first generation to establish persona
        try {
            console.log('🎭 Starting initial persona establishment for chat session:', chatId);

            // Get persona settings
            const personaSettings = await handler.globalResources.getChatDatabase().getPersonaSettings();

            // Get the character image for this chat session
            const imagePath = path.join(handler.globalResources.getPath("images"), data.filename);
            let personaImage = null;
            let userPrompt = '';

            console.log('🖼️ Looking for image at:', imagePath);
            console.log('📁 Images directory:', handler.globalResources.getPath("images"));
            console.log('📄 Filename:', data.filename);

            if (fs.existsSync(imagePath)) {
                console.log('✅ Image file exists, loading...');
                const imageBuffer = fs.readFileSync(imagePath);
                const base64Image = imageBuffer.toString('base64');
                const mimeType = path.extname(data.filename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

                personaImage = {
                    base64: base64Image,
                    mimeType: mimeType
                };

                console.log('🖼️ Image loaded, size:', imageBuffer.length, 'bytes');

                // Get the prompt data for this image
                const metadata = await handler.globalResources.getMetadataDatabase().getImageMetadata(data.filename, handler.globalResources.getPath("images"));
                console.log('📋 Metadata retrieved:', metadata ? 'Yes' : 'No');
                if (metadata) {
                    // Check if metadata is a string that needs parsing
                    if (typeof metadata.metadata === 'string') {
                        try {
                            const parsedMetadata = JSON.parse(metadata.metadata);
                        } catch (e) {
                            console.log('📋 Failed to parse metadata.metadata as JSON:', e.message);
                        }
                    }
                }

                // The prompt data is always in metadata.metadata (from extractNovelAIMetadata)
                if (metadata && metadata.metadata && metadata.metadata.input_prompt) {
                    userPrompt = metadata.metadata.input_prompt;
                    console.log('📝 Using metadata.metadata.input_prompt');
                } else if (metadata && metadata.metadata && metadata.metadata.prompt) {
                    userPrompt = metadata.metadata.prompt;
                    console.log('📝 Using metadata.metadata.prompt');
                }

                // Add character prompts if available (they're in metadata.metadata)
                if (metadata && metadata.metadata && metadata.metadata.characterPrompts && Array.isArray(metadata.metadata.characterPrompts) && metadata.metadata.characterPrompts.length > 0) {
                    userPrompt += ', ' + metadata.metadata.characterPrompts.join(', ');
                    console.log('👥 Added metadata.metadata.characterPrompts:', metadata.metadata.characterPrompts.length, 'items');
                } else if (metadata && metadata.metadata && metadata.metadata.allCharacterPrompts && Array.isArray(metadata.metadata.allCharacterPrompts) && metadata.metadata.allCharacterPrompts.length > 0) {
                    userPrompt += ', ' + metadata.metadata.allCharacterPrompts.join(', ');
                    console.log('👥 Added metadata.metadata.allCharacterPrompts:', metadata.metadata.allCharacterPrompts.length, 'items');
                }
                console.log('🔍 Final user prompt:', userPrompt);
            } else {
                console.log('❌ Image file does not exist at:', imagePath);
                // Try to get metadata anyway in case the image is in a different location
                const metadata = await handler.globalResources.getMetadataDatabase().getImageMetadata(data.filename, handler.globalResources.getPath("images"));
                if (metadata) {
                    console.log('📋 Found metadata despite missing image file');

                    // The prompt data is always in metadata.metadata
                    if (metadata.metadata && metadata.metadata.input_prompt) {
                        userPrompt = metadata.metadata.input_prompt;
                    } else if (metadata.metadata && metadata.metadata.prompt) {
                        userPrompt = metadata.metadata.prompt;
                    }

                    // Character prompts are also in metadata.metadata
                    if (metadata.metadata && metadata.metadata.characterPrompts && Array.isArray(metadata.metadata.characterPrompts) && metadata.metadata.characterPrompts.length > 0) {
                        userPrompt += ', ' + metadata.metadata.characterPrompts.join(', ');
                    } else if (metadata.metadata && metadata.metadata.allCharacterPrompts && Array.isArray(metadata.metadata.allCharacterPrompts) && metadata.metadata.allCharacterPrompts.length > 0) {
                        userPrompt += ', ' + metadata.metadata.allCharacterPrompts.join(', ');
                    }
                    console.log('🔍 User prompt from metadata only:', userPrompt);
                }
            }

            // Get viewer avatar if available
            let viewerAvatar = null;
            if (personaSettings.profile_photo_base64) {
                viewerAvatar = {
                    base64: personaSettings.profile_photo_base64,
                    mimeType: 'image/jpeg'
                };
            }

            // Ensure we have some prompt data
            if (!userPrompt) {
                userPrompt = 'A character from an AI-generated image';
                console.log('⚠️ No prompt data found, using fallback prompt');
            }

            // Load system prompt with story context and dynamic context
            const session = await handler.globalResources.getChatDatabase().getChatSession(chatId);
            const systemPrompt = await handler.globalResources.getPromptManager().getCompleteSystemPrompt(
                'characterChat',
                session,
                personaSettings,
                data.filename
            );

            let aiResponse;
            console.log('🤖 Using Grok service for initial persona establishment');
            const sessionData = {
                id: chatId,
                provider: 'grok',
                model: (session && session.model) || handler.globalResources.getGrokService().getDefaultGrokModel(),
                verbosity_level: verbosityLevel || 3
            };
            const chat = await handler.globalResources.getGrokService().createPersonaChatSession(sessionData, personaSettings, systemPrompt);

            // Establish persona with image
            if (personaImage) {
                console.log('🎭 Establishing Grok persona with image');
                console.log('🖼️ Persona image size:', personaImage.base64.length, 'characters');
                console.log('📝 User prompt length:', userPrompt.length);
                console.log('👤 Viewer avatar:', viewerAvatar ? 'Yes' : 'No');

                // Establish persona using streaming if enabled
                if (chatStreamingEnabled(handler)) {
                    console.log('📡 Streaming enabled for Grok persona establishment');
                    // Send initial streaming message (no requestId for streaming events)
                    handler.sendToClient(ws, {
                        type: 'chat_streaming_start',
                        chatId: chatId,
                        message: 'Establishing persona...'
                    });

                    aiResponse = await handler.globalResources.getGrokService().establishPersonaStreaming(chat, personaImage, userPrompt, viewerAvatar, (chunk, fullResponse, extractedEvents) => {
                        // Send streaming update with extracted events (no requestId for streaming events)
                        handler.sendToClient(ws, {
                            type: 'chat_streaming_update',
                            chatId: chatId,
                            events: extractedEvents || [], // Send structured events, not raw JSON
                            fullResponse: fullResponse // Keep for final parsing if needed
                        });
                    });
                } else {
                    console.log('📡 Streaming disabled for Grok persona establishment');
                    aiResponse = await handler.globalResources.getGrokService().establishPersona(chat, personaImage, userPrompt, viewerAvatar);
                }

                // Persona establishment creates an initial character introduction response
                // Parse and send it to the client instead of a generic greeting
                console.log('✅ Persona established, parsing initial response');
                console.log(`🧵 Persona establishment response_id: ${chat.lastResponseId || 'not set'}`);

                // Use the persona establishment response as the initial message
                // Don't send "> START SEQUENCE" - the persona response IS the initial greeting
            } else {
                console.log('❌ No persona image available, skipping persona establishment');
                // Only send greeting if persona establishment was skipped
                if (chatStreamingEnabled(handler)) {
                    console.log('📡 Streaming enabled for Grok initial response');
                    // Send streaming start for initial message
                    handler.sendToClient(ws, {
                        type: 'chat_streaming_start',
                        requestId: message.requestId,
                        chatId: chatId,
                        message: 'Generating initial response...'
                    });

                    aiResponse = await handler.globalResources.getGrokService().continueConversationStreaming(chat, '> START SEQUENCE', (chunk, fullResponse) => {
                        // Send streaming update
                        handler.sendToClient(ws, {
                            type: 'chat_streaming_update',
                            requestId: message.requestId,
                            chatId: chatId,
                            chunk: chunk,
                            fullResponse: fullResponse
                        });
                    });
                } else {
                    aiResponse = await handler.globalResources.getGrokService().continueConversation(chat, '> START SEQUENCE');
                }
            }

            // Extract usage data and content from response
            const usageData = aiResponse?.usage || null;
            const responseContent = aiResponse?.content || aiResponse || '';

            console.log('📝 Initial AI response received, length:', responseContent.length);

            // Send streaming complete message only if streaming was enabled
            // Don't include requestId here - create_chat_session request was already resolved
            if (chatStreamingEnabled(handler)) {
                handler.sendToClient(ws, {
                    type: 'chat_streaming_complete',
                    chatId: chatId,
                    finalResponse: responseContent,
                    usage: usageData || null
                });
            }

            // Parse the AI response - now expecting event-based format
            let parsedResponse;
            try {
                // Clean the response - remove markdown code blocks if present
                let cleanResponse = (typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)).trim();
                if (cleanResponse.startsWith('```json')) {
                    cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleanResponse.startsWith('```')) {
                    cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }

                // Try to extract JSON from mixed responses
                let jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    cleanResponse = jsonMatch[0];
                } else {
                    // Check if it's multiple comma-separated objects (malformed JSON)
                    // Pattern: { ... }, { ... }, { ... } (no array brackets)
                    const commaSeparatedObjects = cleanResponse.match(/\{[\s\S]*?\}(?=\s*,|\s*$)/g);
                    if (commaSeparatedObjects && commaSeparatedObjects.length > 1) {
                        // Wrap in array brackets and fix trailing commas
                        cleanResponse = '[' + commaSeparatedObjects.join(',') + ']';
                        // Remove any trailing commas before closing bracket
                        cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                    } else {
                        // If no array found, try to extract a single object
                        jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            cleanResponse = jsonMatch[0];
                        }
                    }
                }

                // Remove trailing commas before closing brackets/braces
                cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');

                let parsed;
                try {
                    parsed = JSON.parse(cleanResponse);
                } catch (parseErr) {
                    // If parsing fails, try to fix common issues
                    // Remove any remaining trailing commas
                    cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');
                    // Try wrapping multiple objects in array if still failing
                    if (!cleanResponse.startsWith('[') && cleanResponse.includes('},')) {
                        cleanResponse = '[' + cleanResponse + ']';
                        cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                    }
                    parsed = JSON.parse(cleanResponse);
                }

                // Convert to array if it's a single object
                const events = Array.isArray(parsed) ? parsed : [parsed];

                // Validate that it's an array of events
                if (!Array.isArray(events)) {
                    throw new Error('Invalid response structure: expected array of events');
                }

                // Convert events to old format for compatibility
                const environmentEvents = events.filter(e => e.type === 'environment').map(e => e.content);
                const locationEvents = events.filter(e => e.type === 'location').map(e => e.content);

                // Extract scene data from environment and location events
                let sceneData = 'A cozy, intimate setting'; // Default fallback
                if (environmentEvents.length > 0) {
                    sceneData = environmentEvents.join(' ');
                } else if (locationEvents.length > 0) {
                    sceneData = locationEvents.join(' ');
                }

                parsedResponse = {
                    actions: events.filter(e => e.type === 'actions').map(e => e.content),
                    sfx: events.filter(e => e.type === 'sfx').map(e => e.content),
                    speechdirect: events.filter(e => e.type === 'speechdirect').map(e => e.content),
                    speech: events.filter(e => e.type === 'speech').map(e => e.content),
                    reply: events.filter(e => e.type === 'speechdirect' || e.type === 'reply').map(e => e.content),
                    innerspeech: events.filter(e => e.type === 'innerspeech').map(e => e.content),
                    emotion: events.filter(e => e.type === 'emotion').map(e => e.content),
                    environment: environmentEvents,
                    memory: events.filter(e => e.type === 'memory').map(e => e.content),
                    currplan: events.filter(e => e.type === 'currplan').map(e => e.content),
                    futureplans: events.filter(e => e.type === 'futureplans').map(e => e.content),
                    trustlevel: events.filter(e => e.type === 'trustlevel').map(e => e.content),
                    inventory: events.filter(e => e.type === 'inventory').map(e => e.content),
                    sensory: events.filter(e => e.type === 'sensory').map(e => e.content),
                    offlinemessage: events.filter(e => e.type === 'offlinemessage').map(e => e.content),
                    timeofday: events.filter(e => e.type === 'timeofday').map(e => e.content),
                    location: locationEvents,
                    myname: events.filter(e => e.type === 'myname').map(e => e.content),
                    appendMemory: [],
                    scene: sceneData,
                    appendMind: []
                };

            } catch (parseError) {
                console.warn('⚠️ Failed to parse AI response as JSON, using fallback:', parseError.message);
                // Fallback response structure
                parsedResponse = {
                    actions: [],
                    sfx: [],
                    reply: [responseContent || 'Hello! I\'m here and ready to chat with you.'],
                    speech: [],
                    innerspeech: [],
                    emotion: [],
                    environment: [],
                    memory: [],
                    currplan: [],
                    futureplans: [],
                    trustlevel: [],
                    inventory: [],
                    sensory: [],
                    offlinemessage: [],
                    timeofday: [],
                    location: [],
                    myname: [],
                    appendMemory: [],
                    scene: 'A cozy, intimate setting',
                    appendMind: []
                };
            }

            // Note: establishPersona already stores the message in the database
            // Only store again if this is NOT from persona establishment (e.g., if no persona was established)
            // The parsed response is already stored by establishPersona, we just need to send it to the client

            // Extract usage data if not already extracted
            const responseUsageData = usageData || aiResponse?.usage || null;

            // Send the AI response to the client
            handler.sendToClient(ws, {
                type: 'chat_message_response',
                data: {
                    success: true,
                    chatId: chatId,
                    response: parsedResponse,
                    rawResponse: responseContent,
                    streaming: chatStreamingEnabled(handler),
                    usage: responseUsageData || null
                },
                timestamp: new Date().toISOString()
            });

            console.log('✅ Initial persona establishment completed for chat session:', chatId);

        } catch (initialGenError) {
            console.error('❌ Error during initial persona establishment:', initialGenError);
            // Don't fail the chat creation, just log the error
            // The user can still send messages manually
        }
    } catch (error) {
        console.error('❌ Error creating chat session:', error);
        handler.sendError(ws, 'Failed to create chat session', error.message, message.requestId);
    }
}

async function handleGetChatSessions(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { filename } = data;
        let sessions;

        if (filename) {
            sessions = await handler.globalResources.getChatDatabase().getChatSessionsByFilename(filename);
        } else {
            sessions = await handler.globalResources.getChatDatabase().getAllChatSessions();
        }

        handler.sendToClient(ws, {
            type: 'get_chat_sessions_response',
            requestId: message.requestId,
            data: {
                success: true,
                sessions: sessions
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting chat sessions:', error);
        handler.sendError(ws, 'Failed to get chat sessions', error.message, message.requestId);
    }
}

async function handleGetChatSession(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { chatId } = data;

        if (!chatId) {
            handler.sendError(ws, 'Chat ID is required', null, message.requestId);
            return;
        }

        const session = await handler.globalResources.getChatDatabase().getChatSession(chatId);

        if (!session) {
            handler.sendError(ws, 'Chat session not found', null, message.requestId);
            return;
        }

        handler.sendToClient(ws, {
            type: 'get_chat_session_response',
            requestId: message.requestId,
            data: {
                success: true,
                session: session
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting chat session:', error);
        handler.sendError(ws, 'Failed to get chat session', error.message, message.requestId);
    }
}

async function handleDeleteChatSession(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { chatId } = data;

        if (!chatId) {
            handler.sendError(ws, 'Chat ID is required', null, message.requestId);
            return;
        }

        const success = await handler.globalResources.getChatDatabase().deleteChatSession(chatId);

        // Clean up AI service cache for this chat
        if (success) {
            handler.globalResources.getAiServiceManager().forceCleanupService(chatId);
        }

        handler.sendToClient(ws, {
            type: 'delete_chat_session_response',
            requestId: message.requestId,
            data: {
                success: success,
                message: success ? 'Chat session deleted successfully' : 'Failed to delete chat session'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error deleting chat session:', error);
        handler.sendError(ws, 'Failed to delete chat session', error.message, message.requestId);
    }
}

async function handleRestartChatSession(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { chatId } = data;

        if (!chatId) {
            handler.sendError(ws, 'Chat ID is required', null, message.requestId);
            return;
        }

        const success = await handler.globalResources.getChatDatabase().restartChatSession(chatId);

        // Clean up AI service cache for this chat
        if (success) {
            handler.globalResources.getAiServiceManager().forceCleanupService(chatId);
        }

        handler.sendToClient(ws, {
            type: 'restart_chat_session_response',
            requestId: message.requestId,
            data: {
                success: success,
                message: success ? 'Chat session restarted successfully' : 'Failed to restart chat session'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error restarting chat session:', error);
        handler.sendError(ws, 'Failed to restart chat session', error.message, message.requestId);
    }
}

async function handleUpdateChatContext(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { chatId, textContextInfo, textViewerInfo, storyContext, verbosityLevel, characterName } = data;

        if (!chatId) {
            handler.sendError(ws, 'Chat ID is required', null, message.requestId);
            return;
        }

        const updates = {};
        if (textContextInfo !== undefined) updates.text_context_info = textContextInfo;
        if (textViewerInfo !== undefined) updates.text_viewer_info = textViewerInfo;
        if (storyContext !== undefined) updates.story_context = storyContext;
        if (verbosityLevel !== undefined) updates.verbosity_level = verbosityLevel;
        if (characterName !== undefined) {
            updates.character_name = characterName;
            updates.chat_name = characterName;
        }

        if (Object.keys(updates).length === 0) {
            handler.sendError(ws, 'No context fields to update', null, message.requestId);
            return;
        }

        const success = await handler.globalResources.getChatDatabase().updateChatSession(chatId, updates);

        handler.sendToClient(ws, {
            type: 'update_chat_context_response',
            requestId: message.requestId,
            data: {
                success: success,
                message: success ? 'Chat context updated successfully' : 'Failed to update chat context'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error updating chat context:', error);
        handler.sendError(ws, 'Failed to update chat context', error.message, message.requestId);
    }
}

async function handleSendChatMessage(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { chatId, message: userMessage } = data;

        if (!chatId || !userMessage) {
            handler.sendError(ws, 'Chat ID and message are required', null, message.requestId);
            return;
        }

        // Get chat session from database
        const session = await handler.globalResources.getChatDatabase().getChatSession(chatId);
        if (!session) {
            handler.sendError(ws, 'Chat session not found', null, message.requestId);
            return;
        }

        // Start keep-alive for long-running chat requests
        handler.startKeepAliveInterval(ws, message.requestId, 15000); // Every 15 seconds for chat

        // Prepare persona data using prompt manager
        const personaData = await handler.globalResources.getPromptManager().preparePersonaData(chatId, session.filename);

        // Use unified AI service manager
        let aiResponse;
        try {
            // Establish persona if needed (only for first message)
            if (await handler.globalResources.getPromptManager().needsPersonaEstablishment(chatId)) {
                await handler.globalResources.getAiServiceManager().establishPersonaIfNeeded(
                    chatId,
                    personaData.personaImage,
                    personaData.userPrompt,
                    personaData.viewerAvatar
                );
            }

            if (chatStreamingEnabled(handler)) {
                console.log(`📡 Streaming enabled for ${session.provider}`);
                // Send initial streaming message
                handler.sendToClient(ws, {
                    type: 'chat_streaming_start',
                    requestId: message.requestId,
                    chatId: chatId,
                    message: 'Generating response...'
                });

                // Use streaming for conversation
                aiResponse = await handler.globalResources.getAiServiceManager().continueConversation(chatId, userMessage, (chunk, fullResponse, extractedEvents) => {
                    // Send streaming update with extracted events (not raw JSON)
                    handler.sendToClient(ws, {
                        type: 'chat_streaming_update',
                        requestId: message.requestId,
                        chatId: chatId,
                        events: extractedEvents || [], // Send structured events, not raw JSON
                        fullResponse: fullResponse // Keep for final parsing if needed
                    });
                });
            } else {
                console.log(`📡 Streaming disabled for ${session.provider}`);
                // Use regular non-streaming approach
                aiResponse = await handler.globalResources.getAiServiceManager().continueConversation(chatId, userMessage);
            }

            // Extract usage data and content from response
            const usageData = aiResponse?.usage || null;
            const responseContent = aiResponse?.content || aiResponse || '';

            console.log('📝 AI response received, length:', responseContent.length);

            // Send streaming complete message only if streaming was enabled
            if (chatStreamingEnabled(handler)) {
                handler.sendToClient(ws, {
                    type: 'chat_streaming_complete',
                    requestId: message.requestId,
                    chatId: chatId,
                    finalResponse: responseContent,
                    usage: usageData || null
                });
            } else {
                // Parse AI response for non-streaming mode
                let parsedResponse;
                try {
                    // Clean the response - remove markdown code blocks if present
                    let cleanResponse = (typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)).trim();
                    if (cleanResponse.startsWith('```json')) {
                        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (cleanResponse.startsWith('```')) {
                        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }

                    // Try to extract JSON from mixed responses
                    let jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        cleanResponse = jsonMatch[0];
                    } else {
                        // Check if it's multiple comma-separated objects (malformed JSON)
                        const commaSeparatedObjects = cleanResponse.match(/\{[\s\S]*?\}(?=\s*,|\s*$)/g);
                        if (commaSeparatedObjects && commaSeparatedObjects.length > 1) {
                            cleanResponse = '[' + commaSeparatedObjects.join(',') + ']';
                            cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                        } else {
                            jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                cleanResponse = jsonMatch[0];
                            }
                        }
                    }

                    // Remove trailing commas before closing brackets/braces
                    cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');

                    let parsed;
                    try {
                        parsed = JSON.parse(cleanResponse);
                    } catch (parseErr) {
                        cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');
                        if (!cleanResponse.startsWith('[') && cleanResponse.includes('},')) {
                            cleanResponse = '[' + cleanResponse + ']';
                            cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                        }
                        parsed = JSON.parse(cleanResponse);
                    }

                    // Convert to array if it's a single object
                    const events = Array.isArray(parsed) ? parsed : [parsed];

                    // Extract environment and location events
                    const environmentEvents = events.filter(e => e.type === 'environment').map(e => e.content);
                    const locationEvents = events.filter(e => e.type === 'location').map(e => e.content);

                    // Extract scene data
                    let sceneData = 'A cozy, intimate setting';
                    if (environmentEvents.length > 0) {
                        sceneData = environmentEvents.join(' ');
                    } else if (locationEvents.length > 0) {
                        sceneData = locationEvents.join(' ');
                    }

                    parsedResponse = {
                        actions: events.filter(e => e.type === 'actions').map(e => e.content),
                        sfx: events.filter(e => e.type === 'sfx').map(e => e.content),
                        speechdirect: events.filter(e => e.type === 'speechdirect').map(e => e.content),
                        speech: events.filter(e => e.type === 'speech').map(e => e.content),
                        reply: events.filter(e => e.type === 'speechdirect' || e.type === 'reply').map(e => e.content),
                        innerspeech: events.filter(e => e.type === 'innerspeech').map(e => e.content),
                        emotion: events.filter(e => e.type === 'emotion').map(e => e.content),
                        environment: environmentEvents,
                        memory: events.filter(e => e.type === 'memory').map(e => e.content),
                        currplan: events.filter(e => e.type === 'currplan').map(e => e.content),
                        futureplans: events.filter(e => e.type === 'futureplans').map(e => e.content),
                        trustlevel: events.filter(e => e.type === 'trustlevel').map(e => e.content),
                        inventory: events.filter(e => e.type === 'inventory').map(e => e.content),
                        sensory: events.filter(e => e.type === 'sensory').map(e => e.content),
                        offlinemessage: events.filter(e => e.type === 'offlinemessage').map(e => e.content),
                        timeofday: events.filter(e => e.type === 'timeofday').map(e => e.content),
                        location: locationEvents,
                        myname: events.filter(e => e.type === 'myname').map(e => e.content),
                        appendMemory: [],
                        scene: sceneData,
                        appendMind: []
                    };

                } catch (parseError) {
                    console.warn('⚠️ Failed to parse AI response as JSON, using fallback:', parseError.message);
                    parsedResponse = {
                        actions: [],
                        sfx: [],
                        speechdirect: [],
                        speech: [],
                        reply: [responseContent || 'I apologize, but I could not generate a response.'],
                        innerspeech: [],
                        emotion: [],
                        environment: [],
                        memory: [],
                        currplan: [],
                        futureplans: [],
                        trustlevel: [],
                        inventory: [],
                        sensory: [],
                        offlinemessage: [],
                        timeofday: [],
                        location: [],
                        myname: [],
                        appendMemory: [],
                        scene: 'A cozy, intimate setting',
                        appendMind: []
                    };
                }

                // Send the AI response to the client (non-streaming mode sends immediately)
                handler.sendToClient(ws, {
                    type: 'chat_message_response',
                    requestId: message.requestId,
                    data: {
                        success: true,
                        chatId: chatId,
                        response: parsedResponse,
                        rawResponse: responseContent,
                        streaming: false,
                        usage: usageData || null
                    },
                    timestamp: new Date().toISOString()
                });
            }

            // Stop keep-alive when complete
            handler.stopKeepAliveInterval(message.requestId);

        } catch (aiError) {
            console.error('❌ AI service error:', aiError);

            // Stop keep-alive on error
            handler.stopKeepAliveInterval(message.requestId);

            // Add error message to database
            const errorResponse = {
                actions: [],
                sfx: [],
                reply: ['I apologize, but I encountered an error processing your message.'],
                appendMemory: [],
                scene: '',
                appendMind: []
            };

            await handler.globalResources.getChatDatabase().addChatMessage(chatId, 'assistant', 'Error: ' + aiError.message, JSON.stringify(errorResponse));

            handler.sendToClient(ws, {
                type: 'chat_message_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    chatId: chatId,
                    error: aiError.message,
                    response: errorResponse
                },
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        // Stop keep-alive on error
        handler.stopKeepAliveInterval(message.requestId);

        console.error('❌ Error sending chat message:', error);
        handler.sendError(ws, 'Failed to send chat message', error.message, message.requestId);
    }
}

async function handleGetChatMessages(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { chatId, limit = 50, offset = 0 } = data;

        if (!chatId) {
            handler.sendError(ws, 'Chat ID is required', null, message.requestId);
            return;
        }

        const rawMessages = await handler.globalResources.getChatDatabase().getChatMessages(chatId, limit, offset);
        const totalCount = await handler.globalResources.getChatDatabase().getChatMessageCount(chatId);

        // Messages are already stored as individual event objects, no transformation needed
        const messages = rawMessages;

        handler.sendToClient(ws, {
            type: 'get_chat_messages_response',
            requestId: message.requestId,
            data: {
                success: true,
                messages: messages,
                totalCount: totalCount,
                hasMore: (offset + limit) < totalCount
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting chat messages:', error);
        handler.sendError(ws, 'Failed to get chat messages', error.message, message.requestId);
    }
}

async function handleDeleteChatMessage(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { messageId } = data;

        if (!messageId) {
            handler.sendError(ws, 'Message ID is required', null, message.requestId);
            return;
        }

        const success = await handler.globalResources.getChatDatabase().deleteChatMessage(messageId);

        if (success) {
            handler.sendToClient(ws, {
                type: 'delete_chat_message_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Message deleted successfully'
                },
                timestamp: new Date().toISOString()
            });
        } else {
            handler.sendError(ws, 'Failed to delete message', null, message.requestId);
        }
    } catch (error) {
        console.error('❌ Error deleting chat message:', error);
        handler.sendError(ws, 'Failed to delete chat message', error.message, message.requestId);
    }
}

module.exports = {
    handleCreateChatSession,
    handleGetChatSessions,
    handleGetChatSession,
    handleDeleteChatSession,
    handleRestartChatSession,
    handleUpdateChatContext,
    handleSendChatMessage,
    handleGetChatMessages,
    handleDeleteChatMessage
};
