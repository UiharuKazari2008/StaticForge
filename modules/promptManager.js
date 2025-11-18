/**
 * Prompt Manager
 * Handles all prompt logic and persona establishment
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getImageMetadata } = require('./metadataDatabase');
const { getChatMessages } = require('./chatDatabase');
const memoryManager = require('./memoryManager');

class PromptManager {
    constructor() {
        this.imagesDir = path.resolve(__dirname, '../images');
        this.securePromptsDir = path.resolve(__dirname, '../securePrompts');
        this.promptTemplates = new Map();
        this.loadPromptTemplates();
    }

    /**
     * Load prompt templates from JSON files
     */
    loadPromptTemplates() {
        try {
            // Load v3 templates (array format)
            const grokPromptPathV3 = path.join(this.securePromptsDir, 'grok_system_prompt_v3.json');
            
            // Load Grok template (prefer v3, then v2, then v1)
            if (fs.existsSync(grokPromptPathV3)) {
                const grokTemplate = JSON.parse(fs.readFileSync(grokPromptPathV3, 'utf8'));
                if (grokTemplate.characterChat) {
                    this.promptTemplates.set('characterChat', grokTemplate.characterChat);
                    logger.bootSubStep('Loaded prompt template from Grok v3');
                }
            }
        } catch (error) {
            console.error('❌ Error loading prompt templates:', error.message);
        }
    }

    /**
     * Replace placeholders in template with actual values
     */
    replacePlaceholders(template, placeholders) {
        // Handle array format (v3) - join array elements with newlines
        if (Array.isArray(template)) {
            let result = template.join('\n');
            
            for (const [key, value] of Object.entries(placeholders)) {
                const placeholder = `{{${key}}}`;
                result = result.replace(new RegExp(placeholder, 'g'), value || '');
            }
            
            return result;
        }
        
        // Handle string format (v1, v2)
        let result = template;
        
        for (const [key, value] of Object.entries(placeholders)) {
            const placeholder = `{{${key}}}`;
            result = result.replace(new RegExp(placeholder, 'g'), value || '');
        }
        
        return result;
    }

    /**
     * Get system prompt for a specific prompt type
     */
    getSystemPrompt(promptType, placeholders) {
        const template = this.promptTemplates.get(promptType);
        if (!template) {
            throw new Error(`No prompt template found for type: ${promptType}`);
        }
        
        return this.replacePlaceholders(template.system_prompt, placeholders);
    }

    /**
     * Get persona establishment prompt
     */
    getPersonaEstablishmentPrompt(promptType, userPrompt) {
        const template = this.promptTemplates.get(promptType);
        if (!template) {
            throw new Error(`No prompt template found for type: ${promptType}`);
        }
        
        return this.replacePlaceholders(template.persona_establishment, { user_prompt: userPrompt });
    }

    /**
     * Get verbosity instruction
     */
    getVerbosityInstruction(promptType, verbosity) {
        const template = this.promptTemplates.get(promptType);
        if (!template || !template.verbosity_instructions) {
            return "Adjust your response length and level of detail naturally.";
        }
        
        return template.verbosity_instructions[verbosity] || template.verbosity_instructions['auto'];
    }

    /**
     * Get persona image and prompt for a chat session
     */
    async getPersonaData(filename) {
        const imagePath = path.join(this.imagesDir, filename);
        let personaImage = null;
        let userPrompt = '';

        if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            const mimeType = path.extname(filename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
            
            personaImage = {
                base64: base64Image,
                mimeType: mimeType
            };
            
            // Get the prompt data for this image
            const metadata = await getImageMetadata(filename, this.imagesDir);
            if (metadata) {
                // Check if metadata is a string that needs parsing
                if (typeof metadata.metadata === 'string') {
                    try {
                        metadata.metadata = JSON.parse(metadata.metadata);
                    } catch (e) {
                        console.warn('Failed to parse metadata.metadata as JSON:', e);
                        metadata.metadata = {};
                    }
                }
                
                // Extract prompt from metadata
                if (metadata.metadata && metadata.metadata.input_prompt) {
                    userPrompt = metadata.metadata.input_prompt;
                } else if (metadata.metadata && metadata.metadata.prompt) {
                    userPrompt = metadata.metadata.prompt;
                }
                
                // Add character prompts if available
                if (metadata.metadata && metadata.metadata.characterPrompts && Array.isArray(metadata.metadata.characterPrompts) && metadata.metadata.characterPrompts.length > 0) {
                    userPrompt += ', ' + metadata.metadata.characterPrompts.join(', ');
                } else if (metadata.metadata && metadata.metadata.allCharacterPrompts && Array.isArray(metadata.metadata.allCharacterPrompts) && metadata.metadata.allCharacterPrompts.length > 0) {
                    userPrompt += ', ' + metadata.metadata.allCharacterPrompts.join(', ');
                }
            }
        }

        return { personaImage, userPrompt };
    }

    /**
     * Get viewer avatar from persona settings
     */
    getViewerAvatar(personaSettings) {
        if (personaSettings.profile_photo_base64) {
            return {
                base64: personaSettings.profile_photo_base64,
                mimeType: 'image/jpeg'
            };
        }
        return null;
    }

    /**
     * Check if persona needs to be established
     */
    needsPersonaEstablishment(chatId) {
        const { getChatMessageCount } = require('./chatDatabase');
        const messageCount = getChatMessageCount(chatId);
        return messageCount <= 1; // Only establish persona for first message
    }

    /**
     * Get conversation context for prompt
     */
    getConversationContext(chatId) {
        const { getChatMessages } = require('./chatDatabase');
        try {
            const messages = getChatMessages(chatId, 20, 0);
            return messages.reverse().map(msg => ({
                message_type: msg.message_type,
                content: msg.content,
                created_at: msg.created_at
            }));
        } catch (error) {
            console.error('Error loading conversation context:', error);
            return [];
        }
    }

    /**
     * Prepare persona establishment data
     */
    async preparePersonaData(chatId, filename) {
        const { personaImage, userPrompt } = await this.getPersonaData(filename);
        const { getPersonaSettings } = require('./chatDatabase');
        const personaSettings = getPersonaSettings();
        const viewerAvatar = this.getViewerAvatar(personaSettings);
        const dynamicContext = await this.getDynamicContextFromMetadata(filename);
        
        return {
            personaImage,
            userPrompt,
            viewerAvatar,
            personaSettings,
            dynamicContext
        };
    }

    /**
     * Prepare conversation context for prompt (for future sharding/recovery)
     */
    prepareConversationContext(chatId, serviceName) {
        // Map service names to their corresponding service files
        // Memory functions are now centralized in memoryManager
        
        try {
            const messages = getChatMessages(chatId, 20, 0);
            const conversationHistory = messages.reverse().map(msg => ({
                message_type: msg.message_type,
                content: msg.content,
                created_at: msg.created_at
            }));
            
            const characterMemories = memoryManager.getCharacterMemories(chatId).map(m => m.content);
            
            return {
                conversationHistory: conversationHistory.length > 0 ? `- **Recent Conversation Context:** You remember your recent exchanges and the emotional journey you've shared together.` : '',
                characterMemories: characterMemories.length > 0 ? `- **Your Core Memories:** ${characterMemories.join(', ')}` : ''
            };
        } catch (error) {
            console.error('Error preparing conversation context:', error);
            return {
                conversationHistory: '',
                characterMemories: ''
            };
        }
    }

    /**
     * Get complete system prompt with all placeholders filled
     */
    async getCompleteSystemPrompt(promptType, sessionData, personaSettings, filename) {
        const verbosityInstruction = this.getVerbosityInstruction(promptType, sessionData.verbosity_level);
        
        // Get dynamic context from image metadata
        const dynamicContext = await this.getDynamicContextFromMetadata(filename);
        const currentTime = dynamicContext?.time ? `${dynamicContext.time.dayOfWeekName}, ${dynamicContext.time.monthName} ${dynamicContext.time.dayOfMonth}, ${dynamicContext.time.year} at ${dynamicContext.time.hour % 12 || 12}:${String(dynamicContext.time.minute).padStart(2, '0')} ${dynamicContext.time.am_pm}` : 'this moment';
        const currentTimeOfDay = dynamicContext?.timePeriod || 'daytime';
        const currentWeather = dynamicContext?.weather?.condition || 'pleasant weather';
        const currentTemperature = dynamicContext?.weather?.temperature ? `${dynamicContext.weather.temperature}°C` : 'comfortable temperature';
        const currentLocation = dynamicContext?.location ? (dynamicContext.location.city ? `${dynamicContext.location.city}${dynamicContext.location.country ? ', ' + dynamicContext.location.country : ''}` : 'your current location') : 'where you are';
        const currentSeason = dynamicContext?.season || 'the current season';
        
        const placeholders = {
            user_name: personaSettings.user_name || 'User',
            viewer_background: personaSettings.backstory ? `Here is what you know about them: ${personaSettings.backstory}` : 'They adore you completely and support you in all things.',
            viewer_desires: '', // This would be filled from session data if available
            character_memories: '', // Will be maintained through conversation state
            conversation_history: '', // Will be maintained through conversation state
            verbosity_instruction: verbosityInstruction,
            story_context: sessionData.story_context ? `\n\n**Story So Far:**\n${sessionData.story_context}\n` : '',
            current_time: currentTime,
            time_of_day: currentTimeOfDay,
            current_weather: currentWeather,
            current_temperature: currentTemperature,
            current_location: currentLocation,
            current_season: currentSeason
        };
        
        return this.getSystemPrompt(promptType, placeholders);
    }

    /**
     * Get dynamic generation context from image metadata
     * Context includes: location, time, weather, season, timePeriod, etc.
     */
    async getDynamicContextFromMetadata(filename) {
        const metadata = await getImageMetadata(filename, this.imagesDir);
        
        if (!metadata || !metadata.dynamic_generation) {
            return null;
        }
        
        const context = metadata.dynamic_generation.compiled_prompt?.context;
        if (!context) return null;
        
        return context; // Return full context object
    }

    /**
     * Format dynamic context for system prompt
     */
    formatDynamicContextForPrompt(dynamicContext) {
        if (!dynamicContext) return '';
        
        const parts = [];
        
        // Format time from time object
        if (dynamicContext.time) {
            const t = dynamicContext.time;
            const timeStr = `${t.dayOfWeekName}, ${t.monthName} ${t.dayOfMonth}, ${t.year} at ${t.hour % 12 || 12}:${String(t.minute).padStart(2, '0')} ${t.am_pm}`;
            parts.push(`- Date & Time: ${timeStr}`);
        }
        
        // Format weather from weather object
        if (dynamicContext.weather) {
            const w = dynamicContext.weather;
            let weatherStr = `${w.temperature}°C, ${w.condition}`;
            if (w.humidity) weatherStr += `, ${w.humidity}% humidity`;
            if (w.windSpeed) weatherStr += `, wind ${w.windSpeed} m/s`;
            if (w.feelsLike && w.feelsLike !== w.temperature) weatherStr += ` (feels like ${w.feelsLike}°C)`;
            if (w.precipitation > 0) weatherStr += `, ${w.precipitation}mm precipitation`;
            parts.push(`- Weather: ${weatherStr}`);
        }
        
        // Format season
        if (dynamicContext.season?.name) {
            parts.push(`- Season: ${dynamicContext.season.name}`);
        }
        
        // Format time period
        if (dynamicContext.timePeriod) {
            parts.push(`- Time of Day: ${dynamicContext.timePeriod}`);
        }
        
        // Format holiday info
        if (dynamicContext.season?.holiday?.primaryHoliday?.name) {
            parts.push(`- Holiday: ${dynamicContext.season.holiday.primaryHoliday.name}`);
        }
        
        return parts.length > 0 ? parts.join('\n') : '';
    }

    /**
     * Get limbo state prompt
     */
    getLimboPrompt() {
        const template = this.promptTemplates.get('characterChat');
        if (!template || !template.limbo_state) {
            throw new Error('No limbo_state template found');
        }
        
        return this.replacePlaceholders(template.limbo_state, {});
    }

    /**
     * Get introspective questions
     */
    getIntrospectiveQuestions() {
        const template = this.promptTemplates.get('characterChat');
        if (!template || !template.introspective_questions) {
            throw new Error('No introspective_questions template found');
        }
        
        return template.introspective_questions;
    }

    /**
     * Get soul implantation prompt
     */
    getSoulImplantationPrompt(responses, sessionData, personaSettings) {
        const template = this.promptTemplates.get('characterChat');
        if (!template || !template.soul_implantation) {
            throw new Error('No soul_implantation template found');
        }
        
        const responseSummary = responses.map((r, i) => 
            `Question ${i + 1}: ${r.answer}`
        ).join('\n\n');
        
        const placeholders = {
            introspective_summary: responseSummary,
            story_context: sessionData.story_context ? `Story Context: ${sessionData.story_context}` : '',
            dynamic_context: '' // Will be fetched from metadata when needed
        };
        
        return this.replacePlaceholders(template.soul_implantation, placeholders);
    }

    /**
     * Validate and sanitize user input JSON array
     */
    prepareUserInputMessage(messageArray) {
        // Validate and sanitize the message array
        if (!Array.isArray(messageArray)) {
            messageArray = [{ type: 'speech', content: String(messageArray) }];
        }
        
        return messageArray.map(msg => ({
            type: msg.type || 'speech',
            content: String(msg.content || ''),
            timestamp: msg.timestamp || Date.now()
        }));
    }
}

// Create singleton instance
const promptManager = new PromptManager();

module.exports = promptManager;
