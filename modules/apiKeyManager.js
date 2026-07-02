class ApiKeyManager {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this.ENV_FALLBACKS = {
            novelai: 'NOVELAI_API_KEY',
            grok: 'GROK_API_KEY',
            openai: 'OPENAI_API_KEY',
            google: 'GOOGLE_API_KEY',
            openweather: 'OPENWEATHER_API_KEY',
            exa: 'EXA_API_KEY',
            runpod: 'RUNPOD_API_KEY'
        };
        this.SERVICE_METADATA = {
            novelai: {
                label: 'NovelAI',
                description: 'Core image generation, upscaling, and vibe encoding',
                icon: 'nai-anla',
                requiresRestart: true
            },
            grok: {
                label: 'Grok (xAI)',
                description: 'Director + persona chat orchestration',
                icon: 'xai-icon',
                requiresRestart: true
            },
            openai: {
                label: 'OpenAI',
                description: 'Reserved for OpenAI-based workflows',
                icon: 'ri-openai-line',
                requiresRestart: false
            },
            google: {
                label: 'Google',
                description: 'Google / Gemini model integrations',
                icon: 'ri-google-fill',
                requiresRestart: false
            },
            openweather: {
                label: 'OpenWeather',
                description: 'Static weather lookups and context seeds',
                icon: 'fas fa-cloud-sun',
                requiresRestart: false
            },
            exa: {
                label: 'Exa Search',
                description: 'Web search enrichment for Grok tools',
                icon: 'fas fa-magnifying-glass',
                requiresRestart: false
            },
            runpod: {
                label: 'RunPod ESRGAN',
                description: 'External ESRGAN upscaling workers',
                icon: 'fas fa-robot',
                requiresRestart: false
            }
        };
        this.restartHandlers = new Map();
    }

    maskKey(key) {
        if (!key || typeof key !== 'string') {
            return null;
        }

        if (key.length <= 4) {
            return '••••';
        }

        return `••••${key.slice(-4)}`;
    }

    getServiceKeys(service) {
        const node = this.globalResources.getSecureConfig({ path: service });
        if (!node) {
            return [];
        }

        if (Array.isArray(node.keys)) {
            return node.keys;
        }

        return [];
    }

    getSelectedIndex(service) {
        const selectedApiKeys = this.globalResources.getConfig({ path: 'selectedApiKeys' }) || {};
        const idx = selectedApiKeys[service];
        if (Number.isInteger(idx) && idx >= 0) {
            return idx;
        }
        return 0;
    }

    getActiveApiKey(service) {
        if (!service) return null;

        const keys = this.getServiceKeys(service);
        const idx = this.getSelectedIndex(service);
        const selected = keys[idx];
        if (selected && selected.apiKey) {
            return selected.apiKey;
        }

        const envVar = this.ENV_FALLBACKS[service];
        if (envVar && process.env[envVar]) {
            return process.env[envVar];
        }

        return null;
    }

    registerRestartHandler(service, handler) {
        if (!service || typeof handler !== 'function') {
            return;
        }
        this.restartHandlers.set(service, handler);
    }

    listServiceSummaries() {
        return Object.entries(this.SERVICE_METADATA).map(([service, meta]) => {
            const keys = this.getServiceKeys(service);
            const selectedIndex = this.getSelectedIndex(service);
            const selectedKey = keys[selectedIndex];

            return {
                id: service,
                label: meta.label,
                description: meta.description,
                icon: meta.icon,
                requiresRestart: meta.requiresRestart || this.restartHandlers.has(service),
                selectedIndex,
                selectedName: selectedKey?.name || (keys.length ? `Key ${selectedIndex + 1}` : null),
                selectedFingerprint: selectedKey ? this.maskKey(selectedKey.apiKey) : null,
                missingKeys: keys.length === 0,
                keys: keys.map((key, index) => ({
                    index,
                    name: key.name || `Key ${index + 1}`,
                    fingerprint: this.maskKey(key.apiKey)
                }))
            };
        });
    }

    setSelectedIndexInMemory(service, index) {
        const meta = this.SERVICE_METADATA[service];
        if (!meta) {
            throw new Error(`Unknown service "${service}"`);
        }

        const keys = this.getServiceKeys(service);
        if (!Array.isArray(keys) || keys.length === 0) {
            throw new Error(`No API keys configured for ${meta.label}. Update secure.config.json first.`);
        }

        if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
            throw new Error(`Invalid selection for ${meta.label}`);
        }

        const selectedApiKeys = this.globalResources.getConfig({ path: 'selectedApiKeys' }) || {};
        if (selectedApiKeys[service] === index) {
            return false;
        }

        configCache.selectedApiKeys[service] = index;
        return true;
    }

    async applySelectionUpdates(updateList) {
        if (!Array.isArray(updateList) || updateList.length === 0) {
            throw new Error('No updates provided');
        }

        const normalized = new Map();
        updateList.forEach(update => {
            if (!update || typeof update.service !== 'string') return;
            normalized.set(update.service, Number(update.index));
        });

        if (normalized.size === 0) {
            throw new Error('No valid updates provided');
        }

        const selectedApiKeys = this.globalResources.getConfig({ path: 'selectedApiKeys' }) || {};

        const changed = [];
        normalized.forEach((index, service) => {
            const meta = this.SERVICE_METADATA[service];
            if (!meta) {
                return; // Skip unknown services
            }

            const keys = this.getServiceKeys(service);
            if (!Array.isArray(keys) || keys.length === 0) {
                return; // Skip services with no keys
            }

            if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
                return; // Skip invalid indices
            }

            // Check if this would be a change
            if (selectedApiKeys[service] !== index) {
                changed.push({ service, index });
            }
        });

        if (changed.length === 0) {
            return { updated: [], restartedServices: [] };
        }

        for (const change of changed) {
            this.globalResources.modifyConfig('config').assign(['selectedApiKeys', change.service], change.index);
        }

        const restartedServices = [];
        for (const change of changed) {
            const handler = this.restartHandlers.get(change.service);
            if (handler) {
                await handler(change.service, change.index);
                restartedServices.push(change.service);
            }
        }

        return { updated: changed, restartedServices };
    }

    addApiKey(service, name, apiKey) {
        if (!service || !name || !apiKey) {
            throw new Error('Service, name, and API key are required');
        }

        const meta = this.SERVICE_METADATA[service];
        if (!meta) {
            throw new Error(`Unknown service "${service}"`);
        }

        const serviceKeys = this.globalResources.getSecureConfig({ path: [service, 'keys'] }) || [];
        
        if (serviceKeys.some(k => k.name === name)) {
            throw new Error(`A Service Key / Contract with the name "${name}" already exists for ${meta.label}`);
        }

        const newKey = {
            name: name.trim(),
            apiKey: apiKey.trim()
        };
        
        this.globalResources.modifyConfig('secureConfig').append([service, 'keys'], newKey);

        const updatedKeys = this.getServiceKeys(service);
        const newIndex = updatedKeys.length - 1;
        return {
            success: true,
            index: newIndex,
            key: {
                index: newIndex,
                name: newKey.name,
                fingerprint: this.maskKey(newKey.apiKey)
            }
        };
    }

    updateApiKey(service, index, name, apiKey) {
        if (!service) {
            throw new Error('Service is required');
        }

        const meta = this.SERVICE_METADATA[service];
        if (!meta) {
            throw new Error(`Unknown service "${service}"`);
        }

        const keys = this.getServiceKeys(service);
        if (!Array.isArray(keys) || keys.length === 0) {
            throw new Error(`No API keys configured for ${meta.label}`);
        }

        const idx = Number(index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= keys.length) {
            throw new Error(`Invalid key index for ${meta.label}`);
        }

        const existing = keys[idx];
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';

        if (!trimmedName && !trimmedKey) {
            throw new Error('Provide a new name and/or key value to update');
        }

        const nextName = trimmedName || existing.name || `Key ${idx + 1}`;
        if (keys.some((k, i) => i !== idx && k.name === nextName)) {
            throw new Error(`A Service Key / Contract with the name "${nextName}" already exists for ${meta.label}`);
        }

        const nextKey = {
            name: nextName,
            apiKey: trimmedKey || existing.apiKey
        };

        this.globalResources.modifyConfig('secureConfig').replace([service, 'keys'], idx, nextKey);

        return {
            success: true,
            index: idx,
            key: {
                index: idx,
                name: nextKey.name,
                fingerprint: this.maskKey(nextKey.apiKey)
            }
        };
    }

}

module.exports = ApiKeyManager;

