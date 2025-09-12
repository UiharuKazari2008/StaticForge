/**
 * Model Manager - Handles fetching and managing AI model lists
 */

class ModelManager {
    constructor() {
        this.models = {
            openai: [],
            grok: [],
            all: []
        };
        this.isLoading = false;
        this.lastFetch = null;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get all available models, fetching from APIs if needed
     */
    async getAvailableModels() {
        // Return cached data if still fresh
        if (this.lastFetch && (Date.now() - this.lastFetch) < this.cacheTimeout) {
            return this.models.all;
        }

        if (this.isLoading) {
            // Wait for current fetch to complete
            while (this.isLoading) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return this.models.all;
        }

        this.isLoading = true;
        try {
            await Promise.all([
                this.fetchOpenAIModels(),
                this.fetchGrokModels()
            ]);
            
            this.combineModels();
            this.lastFetch = Date.now();
            return this.models.all;
        } catch (error) {
            console.error('Error fetching models:', error);
            // Return fallback models if API calls fail
            return this.getFallbackModels();
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Fetch models from OpenAI API
     */
    async fetchOpenAIModels() {
        try {
            const response = await window.wsClient.getOpenAIModels();
            
            if (response.success && response.models && Array.isArray(response.models)) {
                this.models.openai = response.models.map(model => ({
                    id: model.id,
                    name: this.formatModelName(model.id),
                    provider: 'openai',
                    model: model.id,
                    service: 'OpenAI',
                    isReasoning: this.isReasoningModel(model.id),
                    capabilities: model.capabilities || {},
                    created: model.created
                }));
            } else {
                console.warn('❌ OpenAI response invalid:', response);
            }
        } catch (error) {
            console.warn('Failed to fetch OpenAI models:', error);
            // Use fallback OpenAI models
            this.models.openai = this.getFallbackOpenAIModels();
        }
    }

    /**
     * Fetch models from Google API
     */
    async fetchGrokModels() {
        try {
            const response = await window.wsClient.getGrokModels();
            
            if (response.success && response.models && Array.isArray(response.models)) {
                this.models.grok = response.models.map(model => ({
                    id: model.name,
                    name: this.formatModelName(model.name),
                    provider: 'grok',
                    model: model.name,
                    service: 'Grok',
                    isReasoning: this.isReasoningModel(model.name),
                    capabilities: model.supportedGenerationMethods || {},
                    created: model.createTime
                }));
            } else {
                console.warn('❌ Grok response invalid:', response);
            }
        } catch (error) {
            console.warn('Failed to fetch Grok models:', error);
            // Use fallback Grok models
            this.models.grok = this.getFallbackGrokModels();
        }
    }

    /**
     * Combine models from all services
     */
    combineModels() {
        this.models.all = [
            ...this.models.openai,
            ...this.models.grok
        ].sort((a, b) => {
            // Sort by service first, then by name
            if (a.service !== b.service) {
                return a.service.localeCompare(b.service);
            }
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Format model ID to display name
     */
    formatModelName(modelId) {
        const nameMap = {
            // OpenAI models
            'gpt-4o': 'GPT-4o',
            'gpt-4o-mini': 'GPT-4o Mini',
            'gpt-4-turbo': 'GPT-4 Turbo',
            'gpt-4': 'GPT-4',
            'gpt-3.5-turbo': 'GPT-3.5 Turbo',
            'gpt-5-nano': 'GPT-5 Nano',
            'gpt-5': 'GPT-5',
            'o1-preview': 'O1 Preview',
            'o1-mini': 'O1 Mini',
            'o4-high': 'O4 High',
            'gpt-o4': 'GPT O4',
            
            // Grok models
            'grok-2': 'Grok-2',
            'grok-2-1212': 'Grok-2-1212',
            'grok-2-vision-1212': 'Grok-2-Vision-1212'
        };

        return nameMap[modelId] || modelId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Check if a model is a reasoning model
     */
    isReasoningModel(modelId) {
        const reasoningModels = [
            'gpt-5-nano',
            'gpt-5',
            'o1-preview',
            'o1-mini',
            'o4-high',
            'gpt-o4'
        ];
        return reasoningModels.includes(modelId);
    }

    /**
     * Get service badge HTML
     */
    getServiceBadge(service) {
        const badges = {
            'OpenAI': '<span class="model-service-badge openai">OpenAI</span>',
            'Google': '<span class="model-service-badge google">Google</span>'
        };
        return badges[service] || `<span class="model-service-badge">${service}</span>`;
    }

    /**
     * Get brain icon HTML for reasoning models
     */
    getBrainIcon() {
        return '<i class="fas fa-brain model-reasoning-icon"></i>';
    }

    /**
     * Render model option HTML
     */
    renderModelOption(model) {
        const brainIcon = model.isReasoning ? this.getBrainIcon() : '';
        const serviceBadge = this.getServiceBadge(model.service);
        
        return `
            <div class="custom-dropdown-option model-option" data-value="${model.id}">
                <div class="model-option-content">
                    <div class="model-option-left">
                        <span class="model-name">${model.name}</span>
                        ${brainIcon}
                    </div>
                    <div class="model-option-right">
                        ${serviceBadge}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Get fallback models if API calls fail
     */
    getFallbackModels() {
        return [
            ...this.getFallbackOpenAIModels(),
            ...this.getFallbackGoogleModels()
        ];
    }

    getFallbackOpenAIModels() {
        return [
            {
                id: 'gpt-4o',
                name: 'GPT-4o',
                provider: 'openai',
                model: 'gpt-4o',
                service: 'OpenAI',
                isReasoning: false
            },
            {
                id: 'gpt-4o-mini',
                name: 'GPT-4o Mini',
                provider: 'openai',
                model: 'gpt-4o-mini',
                service: 'OpenAI',
                isReasoning: false
            },
            {
                id: 'gpt-5-nano',
                name: 'GPT-5 Nano',
                provider: 'openai',
                model: 'gpt-5-nano',
                service: 'OpenAI',
                isReasoning: true
            },
            {
                id: 'gpt-5',
                name: 'GPT-5',
                provider: 'openai',
                model: 'gpt-5',
                service: 'OpenAI',
                isReasoning: true
            },
            {
                id: 'o4-high',
                name: 'O4 High',
                provider: 'openai',
                model: 'o4-high',
                service: 'OpenAI',
                isReasoning: true
            },
            {
                id: 'gpt-o4',
                name: 'GPT O4',
                provider: 'openai',
                model: 'gpt-o4',
                service: 'OpenAI',
                isReasoning: true
            }
        ];
    }

    getFallbackGrokModels() {
        return [
            {
                id: 'grok-2',
                name: 'Grok-2',
                provider: 'grok',
                model: 'grok-2',
                service: 'Grok',
                isReasoning: false
            },
            {
                id: 'grok-2-1212',
                name: 'Grok-2-1212',
                provider: 'grok',
                model: 'grok-2-1212',
                service: 'Grok',
                isReasoning: false
            },
            {
                id: 'grok-2-vision-1212',
                name: 'Grok-2-Vision-1212',
                provider: 'grok',
                model: 'grok-2-vision-1212',
                service: 'Grok',
                isReasoning: false
            }
        ];
    }
}

// Global instance
window.modelManager = new ModelManager();
