const crypto = require('crypto');
const { applyStageConditionalPromptBlocks } = require('./promptStageBlocks');

class TextReplacements {
    constructor(globalResources = null) {
        this.globalResources = globalResources;
    }

    /**
     * Normalizes legacy period keys to new period key names
     * @param {string} periodKey - The period key to normalize
     * @returns {string} - Normalized period key
     */
    normalizePeriodKey(periodKey) {
        if (!periodKey || typeof periodKey !== 'string') {
            return periodKey;
        }
        
        const normalized = periodKey.toLowerCase().trim();
        
        // Legacy to new mappings
        const legacyMappings = {
            'earlymorning': 'morning',
            'early_morning': 'morning',
            'earlyevening': 'evening', // Keep as evening, not night
            'early_evening': 'evening',
            // 'evening' is now a valid period name (used for cloudy afternoon golden hour), don't map to 'night'
            'lateevening': 'night',
            'late_evening': 'night'
        };
        
        return legacyMappings[normalized] || normalized;
    }

    // Generate UUID for presets
    generateUUID() {
        return crypto.randomUUID();
    }

    // Utility function for random selection
    getReplacementValue(value) {
        return Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : value;
    }

    // Helper function to resolve preset or preset group by UUID
    resolvePresetOrGroup(uuid) {
        const currentPromptConfig = this.globalResources ? this.globalResources.getPromptConfig() : null;
        if (!currentPromptConfig) return null;
        
        // First check if it's a preset group
        if (currentPromptConfig.preset_group) {
            const foundGroup = Object.values(currentPromptConfig.preset_group).find(group => group.uuid === uuid);
            if (foundGroup && foundGroup.presets && foundGroup.presets.length > 0) {
                // Randomly select a preset from the group
                const randomIndex = Math.floor(Math.random() * foundGroup.presets.length);
                const selectedPresetUuid = foundGroup.presets[randomIndex];
                
                // Find the actual preset by UUID
                const foundPreset = Object.entries(currentPromptConfig.presets).find(([key, preset]) => preset.uuid === selectedPresetUuid);
                if (foundPreset) {
                    return { preset: foundPreset[1], presetName: foundPreset[0], isFromGroup: true, groupName: foundGroup.name };
                }
            }
        }
        
        // If not a group or group resolution failed, check regular presets
        const foundPreset = Object.entries(currentPromptConfig.presets).find(([key, preset]) => preset.uuid === uuid);
        if (foundPreset) {
            return { preset: foundPreset[1], presetName: foundPreset[0], isFromGroup: false };
        }
        
        return null;
    }

    // Handle incrementing index for queries ending with #
    getIncrementingIndex(key, presetName, locked = false, allValuesLength = null) {
        const currentPromptConfig = this.globalResources.getPromptConfig({ clone: true }) || {presets: {} };

        // For presets, store index in preset data
        if (presetName && currentPromptConfig.presets && currentPromptConfig.presets[presetName]) {
            const preset = currentPromptConfig.presets[presetName];

            // Initialize incrementing indices if not exists
            if (!preset.incrementing_indices) {
                preset.incrementing_indices = {};
            }

            // Get current index, default to 0
            const currentIndex = preset.incrementing_indices[key] || 0;

            // Only increment if not locked
            if (!locked) {
                // Use provided length for bracketed incrementing, otherwise calculate from key
                const length = allValuesLength !== null ? allValuesLength : this.getArrayLengthForKey(key, currentPromptConfig);
                const newIndex = (currentIndex + 1) % length;
                this.globalResources.modifyConfig('promptConfig').assign(['presets', presetName, 'incrementing_indices', key], newIndex);
            }

            return currentIndex;
        }

        // For non-presets, use a global incrementing state (in-memory only)
        if (!global.incrementingIndices) {
            global.incrementingIndices = {};
        }

        if (!global.incrementingIndices[key]) {
            global.incrementingIndices[key] = 0;
        }

        const currentIndex = global.incrementingIndices[key];

        // Only increment if not locked
        if (!locked) {
            // Use provided length for bracketed incrementing, otherwise calculate from key
            const length = allValuesLength !== null ? allValuesLength : this.getArrayLengthForKey(key, currentPromptConfig);
            global.incrementingIndices[key] = (currentIndex + 1) % length;
        }

        return currentIndex;
    }

    /**
     * Sticky variant key for !PREFIX~#: same random row stays until invalidated or merging keys change.
     * global.incrementingTildePickByPattern / preset.incrementing_tilde_pick — see modules/textReplacements.js
     */
    ensureStickyTildePickKey(patternMatch, matchingKeys, presetName) {
        if (!matchingKeys.length) throw new Error('ensureStickyTildePickKey: empty matchingKeys');

        let chosenKey = null;
        const cfg = this.globalResources ? this.globalResources.getPromptConfig({ clone: true }) : null;
        if (presetName && cfg?.presets?.[presetName]?.incrementing_tilde_pick) {
            chosenKey = cfg.presets[presetName].incrementing_tilde_pick[patternMatch];
        }
        if (!chosenKey && global.incrementingTildePickByPattern) {
            chosenKey = global.incrementingTildePickByPattern[patternMatch];
        }
        if (!chosenKey || !matchingKeys.includes(chosenKey)) {
            chosenKey = matchingKeys[Math.floor(Math.random() * matchingKeys.length)];
            if (presetName && this.globalResources) {
                this.globalResources.modifyConfig('promptConfig').assign(
                    ['presets', presetName, 'incrementing_tilde_pick', patternMatch],
                    chosenKey
                );
            } else {
                if (!global.incrementingTildePickByPattern) {
                    global.incrementingTildePickByPattern = {};
                }
                global.incrementingTildePickByPattern[patternMatch] = chosenKey;
            }
        }
        return chosenKey;
    }

    // Helper function to get array length for a key
    getArrayLengthForKey(key, config) {
        const value = config.text_replacements[key];
        if (Array.isArray(value)) {
            return value.length;
        }
        return 1; // Single values have length 1
    }

    // Helper function to determine if a replacement should be applied to the current stage
    shouldApplyReplacement(replacement, currentStage) {
        if (!replacement.stages) {
            // No stage configuration means apply to all stages
            return true;
        }
        
        if (Array.isArray(replacement.stages)) {
            // Specific stages array
            return replacement.stages.includes(currentStage);
        }
        
        if (typeof replacement.stages === 'object') {
            // Range configuration
            const { start, end } = replacement.stages;
            
            if (start !== undefined && end !== undefined) {
                return currentStage >= start && currentStage <= end;
            } else if (start !== undefined) {
                return currentStage >= start;
            } else if (end !== undefined) {
                return currentStage <= end;
            }
        }
        
        // Default to applying if no valid stage configuration
        return true;
    }

    // Text replacement functions
    applyTextReplacements(text, presetName, model = null, periodKey = null, lockedReplacements = null, stageData = null) {
        const _currentPromptConfig = this.globalResources ? this.globalResources.getPromptConfig() : null;
        if (!_currentPromptConfig) return { text: text || '', replacements: [] };
        let textReplacements = { ..._currentPromptConfig?.text_replacements };
        if (!text || !textReplacements) return { text: text || '', replacements: [] };

        // Normalize legacy period keys
        if (periodKey) {
            periodKey = this.normalizePeriodKey(periodKey);
        }

        const replacements = [];
        // Mutable copy so duplicate placeholders (same !key~) consume distinct locks in order
        const lockPool = (lockedReplacements && lockedReplacements.length > 0)
            ? lockedReplacements.slice()
            : null;

        const takeTildePoolLock = (matchingKeys, name, suffix) => {
            if (!lockPool?.length) return null;
            const expectedPat = `!${name}${suffix}`;
            const i = lockPool.findIndex(lr =>
                matchingKeys.includes(lr.key) && lr.pattern === expectedPat
            );
            if (i === -1) return null;
            return lockPool.splice(i, 1)[0];
        };

        const stageDataForBlocks = stageData || { stageIndex: 0, pipelineStageGeneration: false };
        // Slash-delimited blocks first: avoids !PRESET_NAME eating "!PRESET_NAME/..." and matches the rule that "/" in the token means not a plain expander
        let result = applyStageConditionalPromptBlocks(text, stageDataForBlocks);

        // Handle disable syntax !/content/ - remove content from text and trim
        result = result.replace(/(\s*)!\/([^\/]+)\/(\s*)/g, (match, beforeSpace, content, afterSpace) => {
            // Remove the entire match and trim surrounding whitespace
            return '';
        });

        // Not when followed by "/" — "!PRESET_NAME/foo/..." is slash-syntax, not the preset placeholder
        result = result.replace(/!PRESET_NAME(?!\/)/g, presetName != null && presetName !== '' ? presetName : '');

        // Internal NAX expanders: !NAX_FAV_CHARA / !NAX_TRY_ARTIST (server preset registry in naxTagsDatabase.js)
        const naxDb = this.globalResources && this.globalResources.getNaxTagsDatabase
            ? this.globalResources.getNaxTagsDatabase()
            : null;
        if (naxDb) {
            result = result.replace(/!NAX_(FAV|TRY)_([a-zA-Z0-9_]+)(?=[,\s|\[\]{}:]|$)/g, (match, kind, keyPart) => {
                const resolved = naxDb.resolveNaxInternalExpander(keyPart, kind, model);
                if (!resolved) return '';
                replacements.push({
                    key: `NAX_${kind}_${resolved.presetId}`,
                    value: resolved.formatted,
                    presetName: presetName,
                    index: null,
                    type: 'nax_internal',
                    pattern: match,
                    can_lock: false,
                    locked: false
                });
                return resolved.formatted;
            });
        }

        // Track which body replacement configs apply to current stage (for metadata preservation)
        const currentStageBodyReplacements = new Map();
        
        // Merge request body replacements with prompt.config.json replacements
        if (stageData && stageData.text_replacements && Array.isArray(stageData.text_replacements)) {
            const currentStage = stageData.stageIndex || 0;
            const filteredReplacements = stageData.text_replacements.filter(replacement => 
                this.shouldApplyReplacement(replacement, currentStage)
            );
            
            // Store metadata about which body replacements apply to this stage
            filteredReplacements.forEach(replacement => {
                if (!currentStageBodyReplacements.has(replacement.name)) {
                    currentStageBodyReplacements.set(replacement.name, []);
                }
                currentStageBodyReplacements.get(replacement.name).push({
                    stages: replacement.stages,
                    value: replacement.value,
                    extend: replacement.extend,
                    persist: replacement.persist // Track if value should persist across applicable stages
                });
            });
            
            // Create a temporary merged config
            const mergedConfig = { ...textReplacements };
            
            // Group replacements by name to handle duplicates
            const groupedReplacements = {};
            filteredReplacements.forEach(replacement => {
                if (!groupedReplacements[replacement.name]) {
                    groupedReplacements[replacement.name] = [];
                }
                groupedReplacements[replacement.name].push(replacement);
            });
            
            // Process each group of replacements
            Object.entries(groupedReplacements).forEach(([name, replacements]) => {
                if (replacements.length === 1) {
                    // Single replacement - use existing logic
                    const replacement = replacements[0];
                    if (replacement.extend) {
                        // Extend mode: append to existing array or convert string to array
                        const existingValue = mergedConfig[replacement.name];
                        if (Array.isArray(existingValue)) {
                            mergedConfig[replacement.name] = [...existingValue, ...(Array.isArray(replacement.value) ? replacement.value : [replacement.value])];
                        } else if (existingValue !== undefined) {
                            mergedConfig[replacement.name] = [existingValue, ...(Array.isArray(replacement.value) ? replacement.value : [replacement.value])];
                        } else {
                            mergedConfig[replacement.name] = replacement.value;
                        }
                    } else {
                        // Replace mode: override existing or add new
                        mergedConfig[replacement.name] = replacement.value;
                    }
                } else {
                    // Multiple replacements with the same name - auto-merge them
                    const existingValue = mergedConfig[name];
                    const allValues = [];
                    let hasArrayValue = false;
                    
                    // Collect all values from replacements
                    replacements.forEach(replacement => {
                        if (Array.isArray(replacement.value)) {
                            hasArrayValue = true;
                            allValues.push(...replacement.value);
                        } else {
                            allValues.push(replacement.value);
                        }
                    });
                    
                    // Check if existing value from prompt.config.json needs to be included
                    const shouldIncludeExisting = replacements.some(r => r.extend);
                    if (shouldIncludeExisting && existingValue !== undefined) {
                        if (Array.isArray(existingValue)) {
                            hasArrayValue = true;
                            allValues.unshift(...existingValue);
                        } else {
                            allValues.unshift(existingValue);
                        }
                    }
                    
                    // Merge based on value types
                    if (hasArrayValue) {
                        // If any value is an array (random select), combine all into array
                        mergedConfig[name] = allValues;
                    } else {
                        // All are single strings - merge with ", "
                        mergedConfig[name] = allValues.join(', ');
                    }
                }
            });
            
            // Use the merged config for replacements
            textReplacements = mergedConfig;
        }

        // Handle incrementing queries ending with # (processed after bracketed syntax)
        result = result.replace(/!([a-zA-Z0-9_]+)#/g, (match, key) => {
            // Check if this replacement is locked
            const lockedReplacement = lockedReplacements?.find(lr => lr.key === key && lr.type === 'incrementing');
            const isLocked = !!lockedReplacement;

            let currentIndex;
            if (isLocked && lockedReplacement.index !== undefined) {
                // Use the locked index, don't increment
                currentIndex = lockedReplacement.index;
            } else {
                // Get incrementing index (will only increment if not locked)
                currentIndex = this.getIncrementingIndex(key, presetName, isLocked);
            }

            const replacementValue = textReplacements[key];

            if (!replacementValue) {
                throw new Error(`No replacement found for incrementing key: ${key}`);
            }

            let selectedValue;
            let arrayLength = 1;

            if (Array.isArray(replacementValue)) {
                arrayLength = replacementValue.length;
                selectedValue = replacementValue[currentIndex % arrayLength];
            } else {
                selectedValue = replacementValue;
            }

            // Calculate next index (only increment if not locked)
            const nextIndex = isLocked ?
                currentIndex : // Don't increment if locked
                (currentIndex + 1) % arrayLength;

            replacements.push({
                key: key,
                value: selectedValue,
                presetName: presetName,
                index: currentIndex,
                type: 'incrementing',
                pattern: `!${key}#`,
                next_index: nextIndex,
                locked: isLocked,
                can_lock: true
            });

            return selectedValue;
        });

        // Handle bracketed syntax: !KEY[subkey1 subkey2]_~+ expands to !KEY_subkey1_~+ and !KEY_subkey2_~+
        result = result.replace(/!([a-zA-Z0-9_]*)\[([^\]]+)\](_*)(~\+|~)?(#)?/g, (match, baseKey, bracketContent, underscores, suffix, hasHash) => {
            const subKeys = bracketContent.trim().split(/\s+/).filter(s => s.length > 0);
            if (subKeys.length === 0) {
                throw new Error(`Empty bracket content in: ${match}`);
            }

            // Create expanded keys: baseKey + cleaned subKey for each subKey
            // When baseKey is empty, treat subKeys as prefixes to search for
            const expandedKeys = subKeys.map(subKey => {
                // Clean the subKey by trimming underscores
                const cleanSubKey = subKey.replace(/^_+|_+$/g, '');
                return baseKey ? `${baseKey}_${cleanSubKey}` : cleanSubKey;
            });

            // Handle incrementing behavior when # is present
            if (hasHash) {
                // For incrementing, we need to track index across the entire bracketed set
                const isLocked = lockedReplacements?.some(lr => lr.pattern === match);
                const lockedIndex = lockedReplacements?.find(lr => lr.pattern === match)?.index;

                let currentIndex;
                if (isLocked && lockedIndex !== undefined) {
                    currentIndex = lockedIndex;
                } else {
                    // Get incrementing index for the entire bracketed pattern
                    // First calculate allValues to get the length
                    const tempAllValues = [];
                    expandedKeys.forEach(expandedKey => {
                        const matchingKeys = Object.keys(textReplacements).filter(k =>
                            baseKey ? (k === expandedKey) : k.startsWith(expandedKey)
                        );

                        matchingKeys.forEach(key => {
                            const replacementValue = textReplacements[key];
                            if (Array.isArray(replacementValue)) {
                                tempAllValues.push(...replacementValue);
                            } else {
                                tempAllValues.push(replacementValue);
                            }
                        });
                    });
                    currentIndex = this.getIncrementingIndex(match, presetName, isLocked, tempAllValues.length);
                }

                // For incrementing, we cycle through all possible values from the expanded keys
                const allValues = [];
                expandedKeys.forEach(expandedKey => {
                    const matchingKeys = Object.keys(textReplacements).filter(k =>
                        baseKey ? (k === expandedKey) : k.startsWith(expandedKey)
                    );

                    matchingKeys.forEach(key => {
                        const replacementValue = textReplacements[key];
                        if (Array.isArray(replacementValue)) {
                            allValues.push(...replacementValue);
                        } else {
                            allValues.push(replacementValue);
                        }
                    });
                });

                if (allValues.length === 0) {
                    throw new Error(`No values found for incrementing bracketed pattern: ${match}`);
                }

                const selectedValue = allValues[currentIndex % allValues.length];
                const nextIndex = isLocked ? currentIndex : (currentIndex + 1) % allValues.length;

                replacements.push({
                    key: match, // Use the full pattern as key for incrementing
                    value: selectedValue,
                    presetName: presetName,
                    index: currentIndex,
                    type: 'bracketed_incrementing',
                    pattern: match,
                    next_index: nextIndex,
                    locked: isLocked,
                    can_lock: true
                });

                return selectedValue;
            }

            if (!suffix) {
                // No suffix - pick one expanded key/prefix randomly and find a matching key
                const selectedPrefix = expandedKeys[Math.floor(Math.random() * expandedKeys.length)];
                const matchingKeys = Object.keys(textReplacements).filter(k =>
                    baseKey ? (k === selectedPrefix) : k.startsWith(selectedPrefix)
                );

                if (matchingKeys.length === 0) {
                    throw new Error(`No ${baseKey ? 'exact' : 'prefix'} matches found for: ${selectedPrefix}`);
                }

                const selectedKey = matchingKeys[Math.floor(Math.random() * matchingKeys.length)];
                const replacementValue = textReplacements[selectedKey];
                const resolvedValue = this.getReplacementValue(replacementValue);

                replacements.push({
                    key: selectedKey,
                    value: resolvedValue,
                    presetName: presetName,
                    index: Array.isArray(replacementValue) ? replacementValue.indexOf(resolvedValue) : 0,
                    type: baseKey ? 'bracketed_expanded' : 'bracketed_prefix',
                    pattern: `!${baseKey}[${bracketContent}]`,
                    can_lock: true
                });

                return resolvedValue;
            }

            if (suffix === '~') {
                // Pick one expanded key/prefix and find a matching key
                const selectedPrefix = expandedKeys[Math.floor(Math.random() * expandedKeys.length)];
                const matchingKeys = Object.keys(textReplacements).filter(k =>
                    baseKey ? (k === selectedPrefix) : k.startsWith(selectedPrefix)
                );

                if (matchingKeys.length === 0) {
                    throw new Error(`No ${baseKey ? 'exact' : 'prefix'} matches found for: ${selectedPrefix}`);
                }

                const selectedKey = matchingKeys[Math.floor(Math.random() * matchingKeys.length)];
                const replacementValue = textReplacements[selectedKey];
                const resolvedValue = this.getReplacementValue(replacementValue);

                replacements.push({
                    key: selectedKey,
                    value: resolvedValue,
                    presetName: presetName,
                    index: Array.isArray(replacementValue) ? replacementValue.indexOf(resolvedValue) : 0,
                    type: baseKey ? 'bracketed_expanded_pick' : 'bracketed_prefix_pick',
                    pattern: `!${baseKey}[${bracketContent}]~`,
                    can_lock: true
                });

                return resolvedValue;
            }

            if (suffix === '~+') {
                // Combine all expanded keys/prefixes and apply ~+ logic (maintain seeding)
                const combinedPool = [];

                expandedKeys.forEach(expandedKey => {
                    const matchingKeys = Object.keys(textReplacements).filter(k =>
                        baseKey ? (k === expandedKey) : k.startsWith(expandedKey)
                    );

                    matchingKeys.forEach(key => {
                        const replacementValue = textReplacements[key];
                        if (Array.isArray(replacementValue)) {
                            replacementValue.forEach((item, index) => {
                                combinedPool.push({
                                    key: key,
                                    index: index,
                                    value: item,
                                    expandedKey: expandedKey
                                });
                            });
                        } else {
                            combinedPool.push({
                                key: key,
                                index: 0,
                                value: replacementValue,
                                expandedKey: expandedKey
                            });
                        }
                    });
                });

                if (combinedPool.length === 0) {
                    throw new Error(`No items found for bracketed combined replacement: ${match}`);
                }

                // Select one item from the combined pool (maintains seeding across all expanded keys)
                let selectedItem;
                let consumedBracketCombineLock = false;
                if (lockPool?.length) {
                    for (let pi = 0; pi < combinedPool.length; pi++) {
                        const cand = combinedPool[pi];
                        const li = lockPool.findIndex(lr => lr.key === cand.key && lr.index === cand.index);
                        if (li !== -1) {
                            lockPool.splice(li, 1);
                            selectedItem = cand;
                            consumedBracketCombineLock = true;
                            break;
                        }
                    }
                }

                if (!selectedItem) {
                    selectedItem = combinedPool[Math.floor(Math.random() * combinedPool.length)];
                }

                const isLocked = consumedBracketCombineLock;
                replacements.push({
                    key: selectedItem.key,
                    value: selectedItem.value,
                    presetName: presetName,
                    index: selectedItem.index,
                    type: baseKey ? 'bracketed_expanded_combine' : 'bracketed_prefix_combine',
                    pattern: `!${baseKey}[${bracketContent}]~+`,
                    expandedKeys: expandedKeys,
                    locked: isLocked,
                    can_lock: true
                });

                return selectedItem.value;
            }

            return match; // Should not reach here
        });

        // Combined pool with sequential advance (!NAME~+#): same pool as ~+, cycles like !KEY#
        result = result.replace(/!([a-zA-Z0-9_]+)~\+#/g, (match, name) => {
            const matchingKeys = Object.keys(textReplacements).filter(key =>
                key.startsWith(name) || key === name
            );
            if (matchingKeys.length === 0) throw new Error(`No text replacements found starting with: ${name}`);

            const combinedPool = [];
            matchingKeys.forEach(key => {
                const replacementValue = textReplacements[key];
                if (Array.isArray(replacementValue)) {
                    replacementValue.forEach((item, index) => {
                        combinedPool.push({ key, index, value: item });
                    });
                } else {
                    combinedPool.push({ key, index: 0, value: replacementValue });
                }
            });

            if (combinedPool.length === 0) throw new Error(`No items found for combined incrementing replacement: ${name}`);

            const itemLocked = combinedPool.find(item =>
                lockedReplacements?.some(lr => lr.key === item.key && lr.index === item.index)
            );
            const patternLocked = lockedReplacements?.find(lr => lr.pattern === match);

            let currentIndex;
            let isLocked;
            let selectedItem;

            if (itemLocked) {
                selectedItem = itemLocked;
                currentIndex = combinedPool.indexOf(itemLocked);
                isLocked = true;
            } else if (
                patternLocked &&
                patternLocked.pool_index !== undefined &&
                patternLocked.pool_index !== null
            ) {
                currentIndex = patternLocked.pool_index % combinedPool.length;
                selectedItem = combinedPool[currentIndex];
                isLocked = true;
            } else {
                const freezePoolIndex = !!patternLocked;
                currentIndex = this.getIncrementingIndex(match, presetName, freezePoolIndex, combinedPool.length);
                selectedItem = combinedPool[currentIndex % combinedPool.length];
                isLocked = freezePoolIndex;
            }

            const nextIndex = isLocked ? currentIndex : (currentIndex + 1) % combinedPool.length;

            replacements.push({
                key: selectedItem.key,
                value: selectedItem.value,
                presetName: presetName,
                index: selectedItem.index,
                type: 'combine_incrementing',
                pattern: match,
                pool_index: currentIndex % combinedPool.length,
                next_index: nextIndex,
                locked: isLocked,
                can_lock: true
            });

            return selectedItem.value;
        });

        // PREFIX pick + sequential within chosen row (!NAME~#): sticky key like ~ scope, then # on that key
        result = result.replace(/!([a-zA-Z0-9_]+)~#/g, (match, name) => {
            const matchingKeys = Object.keys(textReplacements).filter(key =>
                key.startsWith(name) || key === name
            );
            if (matchingKeys.length === 0) throw new Error(`No text replacements found starting with: ${name}`);

            let selectedKey;
            let selectedValue;
            let replacementIndex = null;
            const patternLocked = lockedReplacements?.find(lr => lr.pattern === match);

            if (lockedReplacements) {
                const lockedMatch = lockedReplacements.find(lr => lr.key === name || matchingKeys.includes(lr.key));
                if (lockedMatch && matchingKeys.includes(lockedMatch.key)) {
                    selectedKey = lockedMatch.key;
                    const replacementValue = textReplacements[selectedKey];
                    if (replacementValue) {
                        if (Array.isArray(replacementValue)) {
                            selectedValue = replacementValue[lockedMatch.index] || replacementValue[0];
                            replacementIndex = lockedMatch.index;
                        } else {
                            selectedValue = replacementValue;
                            replacementIndex = 0;
                        }
                    }
                }
            }

            if (!selectedKey) {
                selectedKey = this.ensureStickyTildePickKey(match, matchingKeys, presetName);
                const replacementValue = textReplacements[selectedKey];
                const arrayLen = Array.isArray(replacementValue) ? replacementValue.length : 1;
                let slot;
                if (patternLocked && patternLocked.pool_index !== undefined && patternLocked.pool_index !== null) {
                    slot = patternLocked.pool_index % arrayLen;
                } else {
                    slot = this.getIncrementingIndex(`${match}::${selectedKey}`, presetName, !!patternLocked, arrayLen);
                }
                if (Array.isArray(replacementValue)) {
                    selectedValue = replacementValue[slot % arrayLen];
                    replacementIndex = slot % arrayLen;
                } else {
                    selectedValue = replacementValue;
                    replacementIndex = 0;
                }
            }

            const arrayLenForNext = Array.isArray(textReplacements[selectedKey])
                ? textReplacements[selectedKey].length
                : 1;
            const isLocked = !!(
                patternLocked ||
                (lockedReplacements && lockedReplacements.some(lr => lr.key === selectedKey && lr.index === replacementIndex))
            );
            const nextIndex = isLocked ? replacementIndex : (replacementIndex + 1) % arrayLenForNext;

            replacements.push({
                key: selectedKey,
                value: selectedValue,
                presetName: presetName,
                index: replacementIndex,
                type: 'pick_incrementing',
                pattern: match,
                next_index: nextIndex,
                locked: isLocked,
                can_lock: true
            });

            return selectedValue;
        });

        // Handle PICK replacements (using ~ and ~+ suffixes)
        result = result.replace(/!([a-zA-Z0-9_]+)(~\+|~)/g, (match, name, suffix) => {
            const matchingKeys = Object.keys(textReplacements).filter(key =>
                key.startsWith(name) || key === name
            );
            if (matchingKeys.length === 0) throw new Error(`No text replacements found starting with: ${name}`);

            if (suffix === '~+') {
                // Combine all items into a fair pool, then pick one (like ~ but from combined pool)
                const combinedPool = [];
                matchingKeys.forEach(key => {
                    const replacementValue = textReplacements[key];
                    if (Array.isArray(replacementValue)) {
                        replacementValue.forEach((item, index) => {
                            combinedPool.push({
                                key: key,
                                index: index,
                                value: item
                            });
                        });
                    } else {
                        combinedPool.push({
                            key: key,
                            index: 0,
                            value: replacementValue
                        });
                    }
                });

                if (combinedPool.length === 0) throw new Error(`No items found for combined replacement: ${name}`);

                // Select one item from the combined pool (respecting locked preferences)
                let selectedItem;
                let consumedCombineLock = false;
                if (lockPool?.length) {
                    for (let pi = 0; pi < combinedPool.length; pi++) {
                        const cand = combinedPool[pi];
                        const li = lockPool.findIndex(lr => lr.key === cand.key && lr.index === cand.index);
                        if (li !== -1) {
                            lockPool.splice(li, 1);
                            selectedItem = cand;
                            consumedCombineLock = true;
                            break;
                        }
                    }
                }

                // If no locked match, pick random
                if (!selectedItem) {
                    selectedItem = combinedPool[Math.floor(Math.random() * combinedPool.length)];
                }

                // Track only the selected item
                const isLocked = consumedCombineLock;
                replacements.push({
                    key: selectedItem.key,
                    value: selectedItem.value,
                    presetName: presetName,
                    index: selectedItem.index,
                    type: 'combine',
                    pattern: `!${name}~+`, // Store original pattern for display
                    locked: isLocked, // Mirror locked state from input
                    can_lock: true
                });

                return selectedItem.value;
            } else {
                // Regular ~ behavior - pick one value (use locked replacement if available)
                let selectedKey, selectedValue, replacementIndex = null;

                const lockedMatch = takeTildePoolLock(matchingKeys, name, '~');
                if (lockedMatch) {
                    selectedKey = lockedMatch.key;
                    const replacementValue = textReplacements[selectedKey];
                    if (replacementValue) {
                        if (Array.isArray(replacementValue)) {
                            selectedValue = replacementValue[lockedMatch.index] || replacementValue[0];
                            replacementIndex = lockedMatch.index;
                        } else {
                            selectedValue = replacementValue;
                            replacementIndex = 0;
                        }
                        console.log(`🔒 Using locked replacement: ${selectedKey}[${replacementIndex}] = ${selectedValue}`);
                    }
                }

                // If no locked replacement found, use random selection
                if (!selectedKey) {
                    const selectedKeyIndex = Math.floor(Math.random() * matchingKeys.length);
                    selectedKey = matchingKeys[selectedKeyIndex];
                    const replacementValue = textReplacements[selectedKey];
                    selectedValue = this.getReplacementValue(replacementValue);

                    // Track the replacement details
                    if (Array.isArray(replacementValue)) {
                        // Find which index was selected
                        const originalValue = this.getReplacementValue(replacementValue);
                        replacementIndex = replacementValue.indexOf(originalValue);
                        if (replacementIndex === -1) replacementIndex = 0; // fallback
                    } else {
                        replacementIndex = 0;
                    }
                }

                replacements.push({
                    key: selectedKey,
                    value: selectedValue,
                    presetName: presetName,
                    index: replacementIndex,
                    type: 'pick',
                    pattern: `!${name}~`, // Store original pattern for display
                    locked: !!lockedMatch,
                    can_lock: true
                });

                return selectedValue;
            }
        });

        // Handle regular replacements with word boundary approach
        const foundKeys = new Set();
        let match;
        const keyPattern = /!([a-zA-Z0-9_]+)(?=[,\s|\[\]{}:]|$)/g;
        while ((match = keyPattern.exec(text)) !== null) {
            foundKeys.add(match[1]);
        }

        for (const baseKey of foundKeys) {
            // Use word boundary or end of string to ensure we match the exact key
            const pattern = new RegExp(`!${baseKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\b|$)`, 'g');

            // Check for replacements in priority order: Period+Model > Period > Model > Base
            let replacementValue = null;
            let actualKey = baseKey;
            if (periodKey && model && textReplacements[`${baseKey}_${periodKey.toUpperCase()}_${model.toUpperCase()}`]) {
                replacementValue = textReplacements[`${baseKey}_${periodKey.toUpperCase()}_${model.toUpperCase()}`];
                actualKey = `${baseKey}_${periodKey.toUpperCase()}_${model.toUpperCase()}`;
            }
            // Check for periodKey-specific replacement
            else if (periodKey && textReplacements[`${baseKey}_${periodKey.toUpperCase()}`]) {
                replacementValue = textReplacements[`${baseKey}_${periodKey.toUpperCase()}`];
                actualKey = `${baseKey}_${periodKey.toUpperCase()}`;
            }
            // Then check for model-specific replacement
            else if (model && textReplacements[`${baseKey}_${model.toUpperCase()}`]) {
                replacementValue = textReplacements[`${baseKey}_${model.toUpperCase()}`];
                actualKey = `${baseKey}_${model.toUpperCase()}`;
            }
            // Finally fall back to base replacement
            else if (textReplacements[baseKey]) {
                replacementValue = textReplacements[baseKey];
                actualKey = baseKey;
            }

            if (replacementValue !== null) {
                let selectedValue;
                let replacementIndex = null;
                let isLocked = false;
                
                // Check if this replacement is locked
                if (lockedReplacements && lockedReplacements.length > 0) {
                    const lockedReplacement = lockedReplacements.find(lr => lr.key === actualKey);
                    if (lockedReplacement && Array.isArray(replacementValue) && lockedReplacement.index !== null) {
                        // Use the locked index to select the value
                        replacementIndex = lockedReplacement.index;
                        selectedValue = replacementValue[replacementIndex];
                        isLocked = true;
                    } else if (lockedReplacement && !Array.isArray(replacementValue)) {
                        // For non-array values, use the locked value directly
                        selectedValue = lockedReplacement.value;
                        replacementIndex = 0;
                        isLocked = true;
                    }
                }
                
                // If not locked or no locked replacement found, use random selection
                if (!isLocked) {
                    selectedValue = this.getReplacementValue(replacementValue);
                    if (Array.isArray(replacementValue)) {
                        // Find which index was selected
                        replacementIndex = replacementValue.indexOf(selectedValue);
                        if (replacementIndex === -1) replacementIndex = 0; // fallback
                    }
                }

            replacements.push({
                key: actualKey,
                value: selectedValue,
                presetName: presetName,
                index: replacementIndex,
                type: 'regular',
                pattern: `!${baseKey}`,
                can_lock: replacementIndex !== null, // Regular replacements can be locked if they have an index (from arrays)
                locked: isLocked
            });

                result = result.replace(pattern, selectedValue);
            } else {
                // Remove unresolved placeholders (e.g., stage-specific keys that don't apply here)
                result = result.replace(pattern, '');
            }
        }

        const remainingReplacements = result.match(/![^~\s]+~/g);
        if (remainingReplacements?.length > 0) {
            throw new Error(`Invalid text replacement: ${remainingReplacements.join(', ')}`);
        }

        // Enrich replacements with body replacement metadata for stage-aware locking
        const enrichedReplacements = replacements.map(replacement => {
            const bodyReplacementInfo = currentStageBodyReplacements.get(replacement.key);
            if (bodyReplacementInfo && bodyReplacementInfo.length > 0) {
                // This replacement came from a body replacement with stage configuration
                // Use the first matching config (in case of multiple merged replacements)
                const config = bodyReplacementInfo[0];
                return {
                    ...replacement,
                    body_replacement_stages: config.stages,
                    body_replacement_persist: config.persist
                };
            }
            return replacement;
        });

        return { text: result, replacements: enrichedReplacements };
    }

    // Get all possible options for a text replacement pattern
    getTextReplacementOptions(pattern, presetName, model = null, periodKey = null) {
        // Normalize legacy period keys
        if (periodKey) {
            periodKey = this.normalizePeriodKey(periodKey);
        }
        if (!this.globalResources) return [];
        const currentPromptConfig = this.globalResources.getPromptConfig();
        if (!currentPromptConfig || !currentPromptConfig.text_replacements) return [];

        const optionsMap = new Map(); // Use Map for deduplication with composite key

        // Handle bracketed patterns first (most specific)
        const bracketMatch = pattern.match(/^!([a-zA-Z0-9_]*)\[([^\]]+)\](_*)(~\+|~)?(#)?/);
        if (bracketMatch) {
            const baseKey = bracketMatch[1];
            const bracketContent = bracketMatch[2];
            const underscores = bracketMatch[3];
            const suffix = bracketMatch[4];
            const hasHash = bracketMatch[5];

            const subKeys = bracketContent.trim().split(/\s+/).filter(s => s.length > 0);

            const expandedKeys = subKeys.map(subKey => {
                const cleanSubKey = subKey.replace(/^_+|_+$/g, '');
                return baseKey ? `${baseKey}_${cleanSubKey}` : cleanSubKey;
            });

            if (suffix === '~+') {
                // For bracketed ~+, combine all values from all expanded keys into a single pool
                expandedKeys.forEach(expandedKey => {
                    const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(k =>
                        baseKey ? (k === expandedKey) : k.startsWith(expandedKey)
                    );

                    matchingKeys.forEach(key => {
                        const replacementValue = currentPromptConfig.text_replacements[key];
                        if (Array.isArray(replacementValue)) {
                            replacementValue.forEach((value, index) => {
                                const compositeKey = `${value}|${key}|${index}`;
                                optionsMap.set(compositeKey, {value, key, index});
                            });
                        } else {
                            const compositeKey = `${replacementValue}|${key}`;
                            optionsMap.set(compositeKey, {value: replacementValue, key}); // No index for single values
                        }
                    });
                });
            } else {
                // For other bracketed patterns, collect values from expanded keys
                expandedKeys.forEach(expandedKey => {
                    const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(k =>
                        baseKey ? (k === expandedKey) : k.startsWith(expandedKey)
                    );

                    matchingKeys.forEach(key => {
                        const replacementValue = currentPromptConfig.text_replacements[key];
                        if (Array.isArray(replacementValue)) {
                            replacementValue.forEach((value, index) => {
                                const compositeKey = `${value}|${key}|${index}`;
                                optionsMap.set(compositeKey, {value, key, index});
                            });
                        } else {
                            const compositeKey = `${replacementValue}|${key}`;
                            optionsMap.set(compositeKey, {value: replacementValue, key}); // No index for single values
                        }
                    });
                });
            }
            return Array.from(optionsMap.values());
        }

        // Handle ~+# (same option list as ~+)
        if (pattern.endsWith('~+#')) {
            const baseKey = pattern.slice(1, -3);

            const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key =>
                key.startsWith(baseKey) || key === baseKey
            );

            matchingKeys.forEach(key => {
                const replacementValue = currentPromptConfig.text_replacements[key];
                if (Array.isArray(replacementValue)) {
                    replacementValue.forEach((value, index) => {
                        const compositeKey = `${value}|${key}|${index}`;
                        optionsMap.set(compositeKey, { value, key, index });
                    });
                } else {
                    const compositeKey = `${replacementValue}|${key}`;
                    optionsMap.set(compositeKey, { value: replacementValue, key });
                }
            });
            return Array.from(optionsMap.values());
        }

        // Handle ~# (same option list as ~)
        if (pattern.endsWith('~#')) {
            const baseKey = pattern.slice(1, -2);

            const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key =>
                key.startsWith(baseKey) || key === baseKey
            );

            matchingKeys.forEach(key => {
                const replacementValue = currentPromptConfig.text_replacements[key];
                if (Array.isArray(replacementValue)) {
                    replacementValue.forEach((value, index) => {
                        const compositeKey = `${value}|${key}|${index}`;
                        optionsMap.set(compositeKey, { value, key, index });
                    });
                } else {
                    const compositeKey = `${replacementValue}|${key}`;
                    optionsMap.set(compositeKey, { value: replacementValue, key });
                }
            });
            return Array.from(optionsMap.values());
        }

        // Handle ~ and ~+ patterns
        if (pattern.endsWith('~+')) {
            // Extract the base key (remove ! and ~+)
            const baseKey = pattern.slice(1, -2); // Remove ! and ~+

            // For ~+, combine all values from all matching keys into a single pool
            // ~+ does NOT use priority-based key resolution, it directly matches prefixes
            const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key =>
                key.startsWith(baseKey) || key === baseKey
            );

            matchingKeys.forEach(key => {
                const replacementValue = currentPromptConfig.text_replacements[key];
                if (Array.isArray(replacementValue)) {
                    replacementValue.forEach((value, index) => {
                        const compositeKey = `${value}|${key}|${index}`;
                        optionsMap.set(compositeKey, {value, key, index});
                    });
                } else {
                    const compositeKey = `${replacementValue}|${key}`;
                    optionsMap.set(compositeKey, {value: replacementValue, key}); // No index for single values
                }
            });
            return Array.from(optionsMap.values());
        } else if (pattern.endsWith('~')) {
            // Extract the base key (remove ! and ~)
            const baseKey = pattern.slice(1, -1); // Remove ! and ~

            // For ~, collect all values from all matching keys
            // ~ does NOT use priority-based key resolution, it directly matches prefixes
            const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key =>
                key.startsWith(baseKey) || key === baseKey
            );

            matchingKeys.forEach(key => {
                const replacementValue = currentPromptConfig.text_replacements[key];
                if (Array.isArray(replacementValue)) {
                    replacementValue.forEach((value, index) => {
                        const compositeKey = `${value}|${key}|${index}`;
                        optionsMap.set(compositeKey, {value, key, index});
                    });
                } else {
                    const compositeKey = `${replacementValue}|${key}`;
                    optionsMap.set(compositeKey, {value: replacementValue, key}); // No index for single values
                }
            });
            return Array.from(optionsMap.values());
        }

        // Handle regular patterns and incrementing patterns
        const keyMatch = pattern.match(/^!([a-zA-Z0-9_]+)(#)?/);
        if (!keyMatch) return [];

        const baseKey = keyMatch[1];
        const isIncrementing = keyMatch[2] === '#';

        // Check priority order: Period+Model > Period > Model > Base
        let replacementValue = null;
        let actualKey = baseKey;
        if (periodKey && model && currentPromptConfig.text_replacements[`${baseKey}_${periodKey.toUpperCase()}_${model.toUpperCase()}`]) {
            replacementValue = currentPromptConfig.text_replacements[`${baseKey}_${periodKey.toUpperCase()}_${model.toUpperCase()}`];
            actualKey = `${baseKey}_${periodKey.toUpperCase()}_${model.toUpperCase()}`;
        }
        // Check for periodKey-specific replacement
        else if (periodKey && currentPromptConfig.text_replacements[`${baseKey}_${periodKey.toUpperCase()}`]) {
            replacementValue = currentPromptConfig.text_replacements[`${baseKey}_${periodKey.toUpperCase()}`];
            actualKey = `${baseKey}_${periodKey.toUpperCase()}`;
        }
        // Then check for model-specific replacement
        else if (model && currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]) {
            replacementValue = currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`];
            actualKey = `${baseKey}_${model.toUpperCase()}`;
        }
        // Finally fall back to base replacement
        else if (currentPromptConfig.text_replacements[baseKey]) {
            replacementValue = currentPromptConfig.text_replacements[baseKey];
            actualKey = baseKey;
        }

        if (replacementValue) {
            if (Array.isArray(replacementValue)) {
                replacementValue.forEach((value, index) => {
                    const compositeKey = `${value}|${actualKey}|${index}`;
                    optionsMap.set(compositeKey, {value, key: actualKey, index});
                });
            } else {
                const compositeKey = `${replacementValue}|${actualKey}`;
                optionsMap.set(compositeKey, {value: replacementValue, key: actualKey}); // No index for single values
            }
        }

        return Array.from(optionsMap.values());
    }
}

module.exports = TextReplacements;