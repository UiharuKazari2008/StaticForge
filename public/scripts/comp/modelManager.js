/**
 * Model Manager - Handles fetching and managing AI model lists
 */

class ModelManager {
    constructor() {
        this.models = {
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
            await this.fetchGrokModels();
            
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
     * Fetch models from Grok API
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
        this.models.all = [...this.models.grok].sort((a, b) => {
            // Sort by name
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Format model ID to display name
     */
    formatModelName(modelId) {
        const nameMap = {
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
        const reasoningModels = [];
        return reasoningModels.includes(modelId);
    }

    /**
     * Get service badge HTML
     */
    getServiceBadge(service) {
        const badges = {
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
        return this.getFallbackGrokModels();
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
