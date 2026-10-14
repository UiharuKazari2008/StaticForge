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
            runpod: 'RUNPOD_API_KEY',
            tokenrouter: 'TOKENROUTER_API_KEY'
        };
        // Env fallback for a service's paired second credential (SERVICE_METADATA.secondary).
        this.SECONDARY_ENV_FALLBACKS = {
            tokenrouter: 'TOKENROUTER_MANAGEMENT_KEY'
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
                label: 'RunPod',
                description: 'GPU Pod start/stop and ESRGAN upscaling workers',
                icon: 'fas fa-robot',
                requiresRestart: false
            },
            tokenrouter: {
                label: 'TokenRouter',
                description: 'Director and Rentan TokenRouter engine (Kimi K3 and other routed models)',
                icon: 'fas fa-route',
                requiresRestart: false,
                // Stored on the same key entry: a management key belongs to the account its API key is in.
                secondary: {
                    field: 'managementKey',
                    label: 'Management key',
                    optional: true,
                    hint: 'Optional Personal Management Key from the same TokenRouter account. It shows the balance (top-up plus vouchers) on the Director badge and cannot make model requests.'
                }
            }
        };
        this.restartHandlers = new Map();

        // Tripwire / circuit-breaker: block outbound calls after repeated admin-fixable
        // API errors (bad request / auth) until an admin unlocks or swaps the key.
        this.TRIPWIRE_SERVICES = new Set(['novelai', 'grok']);
        this.TRIPWIRE_STATUSES = new Set([400, 401, 402, 403]);
        this.TRIPWIRE_THRESHOLD = 3; // consecutive qualifying failures before locking
        this.serviceLocks = new Map(); // service -> lock record
        this.lockChangeHandler = null; // set by globalResources for logging + admin broadcast

        this.migrateTokenRouterManagementKeys();
    }

    // #409 briefly kept TokenRouter management keys as their own service. They belong on
    // the TokenRouter key entry of the same account, so move them there (by index; a
    // single API key takes the selected management key) and drop the old service.
    migrateTokenRouterManagementKeys() {
        let legacy;
        try {
            legacy = this.globalResources.getSecureConfig({ path: 'tokenrouter_management' });
        } catch (_) {
            return;
        }
        if (!legacy) return;
        const extra = Array.isArray(legacy.keys) ? legacy.keys.filter((k) => k && k.apiKey) : [];
        const selected = (this.globalResources.getConfig({ path: 'selectedApiKeys' }) || {}).tokenrouter_management;
        try {
            const saved = this.globalResources.modifyConfig('secureConfig', (cfg) => {
                const keys = cfg.tokenrouter && Array.isArray(cfg.tokenrouter.keys) ? cfg.tokenrouter.keys : [];
                if (keys.length === 1 && extra.length) {
                    const pick = extra[Number.isInteger(selected) && extra[selected] ? selected : 0];
                    if (!keys[0].managementKey) keys[0].managementKey = String(pick.apiKey).trim();
                } else {
                    keys.forEach((key, i) => {
                        if (extra[i] && !key.managementKey) key.managementKey = String(extra[i].apiKey).trim();
                    });
                }
                delete cfg.tokenrouter_management;
                return cfg;
            });
            if (saved && typeof saved.catch === 'function') {
                saved.catch((error) => console.warn(`TokenRouter management key migration not saved: ${error.message}`));
            }
            console.log('✓ Moved TokenRouter management key(s) onto the TokenRouter key entry');
        } catch (error) {
            console.warn(`TokenRouter management key migration skipped: ${error.message}`);
        }
    }

    // --- Tripwire / circuit-breaker -------------------------------------------------

    setLockChangeHandler(handler) {
        this.lockChangeHandler = typeof handler === 'function' ? handler : null;
    }

    isTripwireService(service) {
        return this.TRIPWIRE_SERVICES.has(service);
    }

    _getLockRecord(service) {
        if (!this.serviceLocks.has(service)) {
            this.serviceLocks.set(service, {
                service,
                locked: false,
                failureCount: 0,
                threshold: this.TRIPWIRE_THRESHOLD,
                lastStatus: null,
                lastMessage: null,
                lockedAt: null,
                updatedAt: null
            });
        }
        return this.serviceLocks.get(service);
    }

    isServiceLocked(service) {
        if (!this.isTripwireService(service)) {
            return false;
        }
        return this._getLockRecord(service).locked === true;
    }

    getServiceLock(service) {
        if (!this.isTripwireService(service)) {
            return null;
        }
        return { ...this._getLockRecord(service) };
    }

    _emitLockChange(service, prevLocked) {
        const rec = this._getLockRecord(service);
        if (this.lockChangeHandler && prevLocked !== rec.locked) {
            try {
                this.lockChangeHandler(service, { ...rec });
            } catch (error) {
                console.error('❌ Tripwire lock-change handler error:', error.message);
            }
        }
    }

    // Derive an HTTP status code from an error object, response object, or string.
    deriveStatusCode(source) {
        if (source == null) {
            return null;
        }
        const direct = source.status ?? source.statusCode ?? (typeof source.code === 'number' ? source.code : undefined);
        if (Number.isFinite(Number(direct))) {
            return Number(direct);
        }
        const message = typeof source === 'string' ? source : (source.message || '');
        const match = message.match(/\b(400|401|402|403)\b/);
        return match ? Number(match[1]) : null;
    }

    recordApiSuccess(service) {
        if (!this.isTripwireService(service)) {
            return;
        }
        const rec = this._getLockRecord(service);
        if (rec.failureCount !== 0 || rec.lastStatus !== null) {
            rec.failureCount = 0;
            rec.lastStatus = null;
            rec.lastMessage = null;
            rec.updatedAt = Date.now();
        }
    }

    // Record a failure keyed by HTTP status. Only admin-fixable statuses (400/401/402/403)
    // count toward the tripwire; transient errors (429/5xx/network) are ignored so we do
    // not lock the service for issues an admin cannot fix.
    recordApiFailure(service, statusCode, message) {
        if (!this.isTripwireService(service)) {
            return this.getServiceLock(service);
        }
        const status = this.deriveStatusCode({ statusCode, message });
        if (status === null || !this.TRIPWIRE_STATUSES.has(status)) {
            return this.getServiceLock(service);
        }
        const rec = this._getLockRecord(service);
        const prevLocked = rec.locked;
        rec.failureCount += 1;
        rec.lastStatus = status;
        rec.lastMessage = message || null;
        rec.updatedAt = Date.now();
        if (!rec.locked && rec.failureCount >= this.TRIPWIRE_THRESHOLD) {
            rec.locked = true;
            rec.lockedAt = Date.now();
        }
        this._emitLockChange(service, prevLocked);
        return { ...rec };
    }

    unlockService(service) {
        if (!this.isTripwireService(service)) {
            return false;
        }
        const rec = this._getLockRecord(service);
        const prevLocked = rec.locked;
        rec.locked = false;
        rec.failureCount = 0;
        rec.lastStatus = null;
        rec.lastMessage = null;
        rec.lockedAt = null;
        rec.updatedAt = Date.now();
        this._emitLockChange(service, prevLocked);
        return true;
    }

    // ------------------------------------------------------------------------------

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

    // The selected key entry's paired second credential (SERVICE_METADATA.secondary), else its env fallback.
    getActiveSecondaryKey(service) {
        const field = this.SERVICE_METADATA[service]?.secondary?.field;
        if (!field) return null;
        const selected = this.getServiceKeys(service)[this.getSelectedIndex(service)];
        if (selected && selected[field]) return String(selected[field]).trim();
        const envVar = this.SECONDARY_ENV_FALLBACKS[service];
        return envVar && process.env[envVar] ? String(process.env[envVar]).trim() : null;
    }

    // Cached check result for a stored credential (modules/apiKeyHealth.js). Never starts a check.
    keyStatus(service, slot, secret) {
        try {
            return require('./apiKeyHealth').statusFor(service, slot, secret);
        } catch (_) {
            return { state: 'unchecked' };
        }
    }

    noteKeysChanged(service) {
        try {
            require('./apiKeyHealth').noteKeysChanged(this.globalResources, service);
        } catch (error) {
            console.warn(`API key status check not started: ${error.message}`);
        }
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

            const field = meta.secondary?.field;
            return {
                id: service,
                label: meta.label,
                description: meta.description,
                icon: meta.icon,
                requiresRestart: meta.requiresRestart || this.restartHandlers.has(service),
                secondary: meta.secondary ? { field, label: meta.secondary.label, optional: meta.secondary.optional === true, hint: meta.secondary.hint || '' } : null,
                selectedIndex,
                selectedName: selectedKey?.name || (keys.length ? `Key ${selectedIndex + 1}` : null),
                selectedFingerprint: selectedKey ? this.maskKey(selectedKey.apiKey) : null,
                missingKeys: keys.length === 0,
                // modules/apiKeyHealth.js — false for google and grok: no probe, no status dot.
                statusCheck: require('./apiKeyHealth').checksService(service),
                lock: this.getServiceLock(service),
                keys: keys.map((key, index) => {
                    const row = {
                        index,
                        name: key.name || `Key ${index + 1}`,
                        fingerprint: this.maskKey(key.apiKey),
                        status: this.keyStatus(service, 'apiKey', key.apiKey)
                    };
                    if (field) {
                        row.secondaryFingerprint = key[field] ? this.maskKey(key[field]) : null;
                        row.secondaryStatus = this.keyStatus(service, field, key[field]);
                    }
                    return row;
                })
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
            // Swapping the active key is an admin correction — clear any tripwire lock.
            this.unlockService(change.service);
            const handler = this.restartHandlers.get(change.service);
            if (handler) {
                await handler(change.service, change.index);
                restartedServices.push(change.service);
            }
        }

        return { updated: changed, restartedServices };
    }

    // extras: { secondaryKey } for a service with a paired second credential (SERVICE_METADATA.secondary).
    addApiKey(service, name, apiKey, extras) {
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
        const field = meta.secondary?.field;
        const secondary = typeof extras?.secondaryKey === 'string' ? extras.secondaryKey.trim() : '';
        if (field && secondary) newKey[field] = secondary;
        
        this.globalResources.modifyConfig('secureConfig').append([service, 'keys'], newKey);
        this.noteKeysChanged(service);

        const updatedKeys = this.getServiceKeys(service);
        const newIndex = updatedKeys.length - 1;
        return {
            success: true,
            index: newIndex,
            key: {
                index: newIndex,
                name: newKey.name,
                fingerprint: this.maskKey(newKey.apiKey),
                secondaryFingerprint: field && newKey[field] ? this.maskKey(newKey[field]) : null
            }
        };
    }

    // extras: { secondaryKey } replaces the paired credential, { clearSecondary: true } removes it.
    updateApiKey(service, index, name, apiKey, extras) {
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
        const field = meta.secondary?.field;
        const secondary = field && typeof extras?.secondaryKey === 'string' ? extras.secondaryKey.trim() : '';
        const clearSecondary = !!(field && extras?.clearSecondary === true && !secondary);

        if (!trimmedName && !trimmedKey && !secondary && !clearSecondary) {
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
        if (field) {
            const kept = clearSecondary ? '' : (secondary || existing[field] || '');
            if (kept) nextKey[field] = kept;
        }

        this.globalResources.modifyConfig('secureConfig').replace([service, 'keys'], idx, nextKey);
        this.noteKeysChanged(service);

        // Editing the active key is an admin correction — clear any tripwire lock.
        if (this.getSelectedIndex(service) === idx) {
            this.unlockService(service);
        }

        return {
            success: true,
            index: idx,
            key: {
                index: idx,
                name: nextKey.name,
                fingerprint: this.maskKey(nextKey.apiKey),
                secondaryFingerprint: field && nextKey[field] ? this.maskKey(nextKey[field]) : null
            }
        };
    }

    // Removes one stored key. The active index follows the same entry when a later key is removed.
    async removeApiKey(service, index) {
        if (!service) {
            throw new Error('Service is required');
        }

        const meta = this.SERVICE_METADATA[service];
        if (!meta) {
            throw new Error(`Unknown service "${service}"`);
        }

        const keys = this.getServiceKeys(service);
        const idx = Number(index);
        if (!Array.isArray(keys) || !Number.isInteger(idx) || idx < 0 || idx >= keys.length) {
            throw new Error(`Invalid key index for ${meta.label}`);
        }

        const removedName = keys[idx].name || `Key ${idx + 1}`;
        const selected = this.getSelectedIndex(service);
        const wasActive = selected === idx;
        const remaining = keys.length - 1;
        let nextIndex = selected;
        if (remaining === 0) nextIndex = null;
        else if (selected > idx) nextIndex = selected - 1;
        else if (selected === idx) nextIndex = Math.min(idx, remaining - 1);
        else if (selected >= keys.length) nextIndex = remaining - 1;

        this.globalResources.modifyConfig('secureConfig').delete([service, 'keys'], idx);
        if (nextIndex === null) {
            this.globalResources.modifyConfig('config').delete(['selectedApiKeys', service]);
        } else if (nextIndex !== selected) {
            this.globalResources.modifyConfig('config').assign(['selectedApiKeys', service], nextIndex);
        }

        if (wasActive) {
            this.unlockService(service);
            const handler = this.restartHandlers.get(service);
            if (handler && nextIndex !== null) await handler(service, nextIndex);
        }
        this.noteKeysChanged(service);

        return { success: true, index: idx, name: removedName, selectedIndex: nextIndex };
    }

}

module.exports = ApiKeyManager;

