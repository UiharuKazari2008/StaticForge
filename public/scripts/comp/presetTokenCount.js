/**
 * Client token bar helpers — reads server preset_token_counts from optionsData.
 * public/scripts/comp/presetTokenCount.js
 */

let qwenPresetTokenCountCache = null;

function countPresetValue(tokenizer, text, withSeparator = false) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return 0;
    return tokenizer.countTokens(withSeparator && !trimmed.endsWith(', ') ? `${trimmed}, ` : trimmed);
}

function buildQwenPresetTokenCountMap(tokenizer) {
    const source = window.optionsData || {};
    const cache = { datasets: [], quality: {}, uc: {}, nsfw: {}, expanders: {} };
    cache.datasets = (source.datasets || []).map((dataset) => ({
        type: dataset.type || 'dataset',
        value: dataset.value,
        tokens: (dataset.skipPromptValue || dataset.isQualityPreset || dataset.isTransparencyPreset)
            ? 0
            : countPresetValue(tokenizer, dataset.value, true),
        sub_toggles: (dataset.sub_toggles || []).map((toggle) => ({
            id: toggle.id,
            tokens: countPresetValue(tokenizer, toggle.value, true)
        }))
    }));
    Object.entries(source.quality_presets || {}).forEach(([key, presets]) => {
        if (typeof presets === 'string') {
            cache.quality[key] = { tokens: countPresetValue(tokenizer, presets, true) };
        } else if (Array.isArray(presets)) {
            cache.quality[key] = presets.map((preset) => typeof preset === 'string'
                ? { tokens: countPresetValue(tokenizer, preset, true) }
                : {
                    id: preset.id,
                    name: preset.name,
                    match: preset.match,
                    tokens: countPresetValue(tokenizer, preset.value, true)
                });
        }
    });
    Object.entries(source.uc_presets || {}).forEach(([key, presets]) => {
        cache.uc[key] = (presets || []).map((preset, index) => typeof preset === 'string'
            ? { level: index + 1, tokens: countPresetValue(tokenizer, preset, true) }
            : {
                level: index + 1,
                id: preset.id,
                name: preset.name,
                match: preset.match,
                tokens: countPresetValue(tokenizer, preset.value, true)
            });
    });
    Object.entries(source.nsfw_presets || {}).forEach(([key, preset]) => {
        const prompt = [preset.add?.base_prefix, preset.add?.base].filter(Boolean).join(', ');
        const uc = [preset.add?.uc_prefix, preset.add?.uc].filter(Boolean).join(', ');
        cache.nsfw[key] = {
            prompt: countPresetValue(tokenizer, prompt, true),
            uc: countPresetValue(tokenizer, uc, true)
        };
    });
    Object.entries(source.textReplacements || {}).forEach(([key, value]) => {
        cache.expanders[key] = Array.isArray(value)
            ? value.map((entry) => countPresetValue(tokenizer, String(entry)))
            : countPresetValue(tokenizer, value);
    });
    return cache;
}

function getPresetTokenCountMap() {
    const tokenizer = getPromptTokenizer();
    if (getForgeModelFeatures()?.tokenizer !== 'qwen' || !tokenizer) {
        return window.optionsData?.preset_token_counts || null;
    }
    if (!qwenPresetTokenCountCache || qwenPresetTokenCountCache.tokenizer !== tokenizer || qwenPresetTokenCountCache.source !== window.optionsData) {
        qwenPresetTokenCountCache = {
            tokenizer,
            source: window.optionsData,
            counts: buildQwenPresetTokenCountMap(tokenizer)
        };
    }
    return qwenPresetTokenCountCache.counts;
}

function getModelKeyForTokenCount() {
    const model = typeof manualSelectedModel !== 'undefined' ? manualSelectedModel : null;
    if (!model) return null;
    return String(model).toLowerCase();
}

function countTokensForText(text) {
    const tokenizer = getPromptTokenizer();
    if (!text || !tokenizer) return 0;
    // stripManagedEmphasisDelimitersForCounting: public/scripts/comp/emphasisGroupIdCodec.js
    const forCount = typeof stripManagedEmphasisDelimitersForCounting === 'function'
        ? stripManagedEmphasisDelimitersForCounting(text)
        : text;
    return tokenizer.countTokens(forCount);
}

function maxFromExpanderEntry(entry) {
    if (entry === undefined || entry === null) return 0;
    if (typeof entry === 'number') return entry;
    if (Array.isArray(entry)) {
        let max = 0;
        for (let i = 0; i < entry.length; i++) {
            if (entry[i] > max) max = entry[i];
        }
        return max;
    }
    return 0;
}

function countFromExpanderMap(expanders, key, index) {
    if (!expanders || key === undefined || key === null) return 0;
    const entry = expanders[key];
    if (entry === undefined) return 0;
    if (typeof entry === 'number') return entry;
    if (Array.isArray(entry)) {
        if (index !== undefined && index !== null && entry[index] !== undefined) {
            return entry[index];
        }
        return maxFromExpanderEntry(entry);
    }
    return 0;
}

function resolveExpanderStorageKey(baseKey, periodKey, model) {
    const expanders = getPresetTokenCountMap()?.expanders;
    if (!expanders || !baseKey) return baseKey;

    const period = periodKey ? String(periodKey).toUpperCase() : null;
    const modelUp = model ? String(model).toUpperCase() : null;

    if (period && modelUp && expanders[`${baseKey}_${period}_${modelUp}`] !== undefined) {
        return `${baseKey}_${period}_${modelUp}`;
    }
    if (period && expanders[`${baseKey}_${period}`] !== undefined) {
        return `${baseKey}_${period}`;
    }
    if (modelUp && expanders[`${baseKey}_${modelUp}`] !== undefined) {
        return `${baseKey}_${modelUp}`;
    }
    if (expanders[baseKey] !== undefined) {
        return baseKey;
    }
    return baseKey;
}

function matchingExpanderKeys(prefix, expanders) {
    if (!expanders || !prefix) return [];
    const keys = Object.keys(expanders);
    return keys.filter((k) => k === prefix || k.startsWith(`${prefix}_`));
}

function maxTokensAcrossExpanderKeys(expanders, keys) {
    let max = 0;
    for (let i = 0; i < keys.length; i++) {
        const m = maxFromExpanderEntry(expanders[keys[i]]);
        if (m > max) max = m;
    }
    return max;
}

function findLockedSeedForPattern(lockedSeeds, pattern, key, index) {
    if (!lockedSeeds || !Array.isArray(lockedSeeds)) return null;
    for (let i = 0; i < lockedSeeds.length; i++) {
        const seed = lockedSeeds[i];
        if (!seed) continue;
        if (pattern && seed.pattern === pattern) return seed;
        if (key && seed.key === key && (index === undefined || seed.index === index)) return seed;
    }
    return null;
}

function resolvedTokensForExpanderMatch(matchText, expanders, lockedSeeds, periodKey, model) {
    const placeholder = countTokensForText(matchText);
    if (!expanders) return { resolved: 0, placeholder };

    const lockedByPattern = findLockedSeedForPattern(lockedSeeds, matchText, null, null);
    if (lockedByPattern && lockedByPattern.value) {
        return { resolved: countTokensForText(lockedByPattern.value), placeholder };
    }

    // Bracket: !BASE[sub1 sub2]suffix
    const bracketMatch = matchText.match(/^!([a-zA-Z0-9_]*)\[([^\]]+)\](_*)(~\+#|~\+|~#|~)?(#)?$/);
    if (bracketMatch) {
        const baseKey = bracketMatch[1];
        const subs = bracketMatch[2].trim().split(/\s+/).filter(Boolean);
        const suffix = bracketMatch[4] || '';
        const expandedKeys = subs.map((sub) => {
            const clean = sub.replace(/^_+|_+$/g, '');
            return baseKey ? `${baseKey}_${clean}` : clean;
        });
        const poolKeys = [];
        expandedKeys.forEach((ek) => {
            matchingExpanderKeys(ek, expanders).forEach((k) => {
                if (!poolKeys.includes(k)) poolKeys.push(k);
            });
        });
        let resolved = maxTokensAcrossExpanderKeys(expanders, poolKeys.length ? poolKeys : expandedKeys);
        if (suffix === '~#' || suffix === '~+#' || bracketMatch[5] === '#') {
            const seed = findLockedSeedForPattern(lockedSeeds, matchText, null, null);
            if (seed) {
                resolved = countTokensForText(seed.value);
            }
        }
        return { resolved, placeholder };
    }

    // Combined increment: !NAME~+#
    const combineInc = matchText.match(/^!([a-zA-Z0-9_]+)~\+#$/);
    if (combineInc) {
        const name = combineInc[1];
        const seed = findLockedSeedForPattern(lockedSeeds, matchText, null, null);
        if (seed && seed.value) {
            return { resolved: countTokensForText(seed.value), placeholder };
        }
        const keys = matchingExpanderKeys(name, expanders);
        return { resolved: maxTokensAcrossExpanderKeys(expanders, keys), placeholder };
    }

    // Pick increment: !NAME~#
    const pickInc = matchText.match(/^!([a-zA-Z0-9_]+)~#$/);
    if (pickInc) {
        const name = pickInc[1];
        const seed = findLockedSeedForPattern(lockedSeeds, matchText, null, null);
        if (seed) {
            const storageKey = seed.key || name;
            const idx = seed.index;
            return {
                resolved: countFromExpanderMap(expanders, storageKey, idx) || countTokensForText(seed.value),
                placeholder
            };
        }
        const keys = matchingExpanderKeys(name, expanders);
        return { resolved: maxTokensAcrossExpanderKeys(expanders, keys), placeholder };
    }

    // Increment: !KEY#
    const incMatch = matchText.match(/^!([a-zA-Z0-9_]+)#$/);
    if (incMatch) {
        const key = incMatch[1];
        const seed = findLockedSeedForPattern(lockedSeeds, matchText, key, null);
        if (seed) {
            return {
                resolved: countFromExpanderMap(expanders, seed.key || key, seed.index) || countTokensForText(seed.value),
                placeholder
            };
        }
        const storageKey = resolveExpanderStorageKey(key, periodKey, model);
        return { resolved: maxFromExpanderEntry(expanders[storageKey]), placeholder };
    }

    // Tilde combine: !NAME~+
    const tildePlus = matchText.match(/^!([a-zA-Z0-9_]+)~\+$/);
    if (tildePlus) {
        const name = tildePlus[1];
        const keys = matchingExpanderKeys(name, expanders);
        const seed = findLockedSeedForPattern(lockedSeeds, matchText, null, null);
        if (seed && seed.key) {
            return {
                resolved: countFromExpanderMap(expanders, seed.key, seed.index) || countTokensForText(seed.value),
                placeholder
            };
        }
        return { resolved: maxTokensAcrossExpanderKeys(expanders, keys), placeholder };
    }

    // Tilde pick: !NAME~
    const tildePick = matchText.match(/^!([a-zA-Z0-9_]+)~$/);
    if (tildePick) {
        const name = tildePick[1];
        const keys = matchingExpanderKeys(name, expanders);
        const seed = findLockedSeedForPattern(lockedSeeds, `!${name}~`, name, null)
            || findLockedSeedForPattern(lockedSeeds, matchText, null, null);
        if (seed && seed.key) {
            return {
                resolved: countFromExpanderMap(expanders, seed.key, seed.index) || countTokensForText(seed.value),
                placeholder
            };
        }
        return { resolved: maxTokensAcrossExpanderKeys(expanders, keys), placeholder };
    }

    // Plain !KEY
    const plain = matchText.match(/^!([a-zA-Z0-9_]+)$/);
    if (plain) {
        const baseKey = plain[1];
        const storageKey = resolveExpanderStorageKey(baseKey, periodKey, model);
        const seed = findLockedSeedForPattern(lockedSeeds, `!${baseKey}`, storageKey, null)
            || findLockedSeedForPattern(lockedSeeds, null, storageKey, null);
        if (seed) {
            return {
                resolved: countFromExpanderMap(expanders, seed.key || storageKey, seed.index) || countTokensForText(seed.value),
                placeholder
            };
        }
        return { resolved: maxFromExpanderEntry(expanders[storageKey]), placeholder };
    }

    return { resolved: placeholder, placeholder };
}

function scanExpanderMatches(text) {
    const matches = [];
    if (!text) return matches;
    const patterns = [
        /![a-zA-Z0-9_]*\[[^\]]+\](?:_*)(?:~\+#|~\+|~#|~)?#?/g,
        /![a-zA-Z0-9_]+~\+#/g,
        /![a-zA-Z0-9_]+~\+/g,
        /![a-zA-Z0-9_]+~#/g,
        /![a-zA-Z0-9_]+~/g,
        /![a-zA-Z0-9_]+#/g,
        /![a-zA-Z0-9_]+(?=[,\s|\[\]{}:]|$)/g
    ];
    const seen = new Set();
    patterns.forEach((re) => {
        let m;
        const r = new RegExp(re.source, re.flags);
        while ((m = r.exec(text)) !== null) {
            const token = m[0];
            if (!seen.has(token)) {
                seen.add(token);
                matches.push(token);
            }
        }
    });
    return matches;
}

function getExpanderTokenDeltaForText(text, lockedSeeds, periodKey, model) {
    const map = getPresetTokenCountMap();
    const expanders = map?.expanders;
    if (!expanders || !text) return 0;

    const stripped = typeof stripPromptBlocksForEffectivePrompt === 'function'
        ? stripPromptBlocksForEffectivePrompt(text, { stageIndex: 0, pipelineStageGeneration: false })
        : text;

    const matches = scanExpanderMatches(stripped);
    let delta = 0;
    matches.forEach((matchText) => {
        const { resolved, placeholder } = resolvedTokensForExpanderMatch(matchText, expanders, lockedSeeds, periodKey, model);
        const d = resolved - placeholder;
        if (d > 0) delta += d;
    });
    return delta;
}

function selectQualityTokensForModel(qualityEntry, combinedPromptLower) {
    if (!qualityEntry) return 0;
    if (typeof qualityEntry.tokens === 'number') return qualityEntry.tokens;
    if (Array.isArray(qualityEntry)) {
        for (let i = 0; i < qualityEntry.length; i++) {
            const item = qualityEntry[i];
            if (item.match && Array.isArray(item.match)) {
                for (let j = 0; j < item.match.length; j++) {
                    if (combinedPromptLower.includes(String(item.match[j]).toLowerCase())) {
                        return item.tokens || 0;
                    }
                }
            }
        }
        return qualityEntry[0]?.tokens || 0;
    }
    return 0;
}

function getActivePresetTokenDelta(combinedPromptText) {
    const result = { prompt: 0, uc: 0 };
    const map = getPresetTokenCountMap();
    if (!map) return result;

    const modelKey = getModelKeyForTokenCount();
    const combinedLower = (combinedPromptText || '').toLowerCase();

    const datasets = typeof selectedDatasets !== 'undefined' ? selectedDatasets : (window.selectedDatasets || []);
    const datasetSettings = window.datasetSettings || {};
    const isV3 = modelKey === 'v3' || modelKey === 'v3_furry';

    const addDatasetSubToggleTokens = (dsValue, includeParentTokens) => {
        const entry = map.datasets.find((d) => d.value === dsValue);
        if (!entry) return;
        if (includeParentTokens) result.prompt += entry.tokens || 0;
        const settings = datasetSettings[dsValue];
        if (settings && Array.isArray(entry.sub_toggles)) {
            entry.sub_toggles.forEach((st) => {
                const setting = settings[st.id];
                if (setting && setting.enabled) {
                    let tokens = st.tokens || 0;
                    if (typeof applyBiasToText === 'function' && setting.bias !== undefined && setting.bias !== 1.0) {
                        const raw = window.optionsData?.datasets?.find((d) => d.value === dsValue)
                            ?.sub_toggles?.find((t) => t.id === st.id)?.value;
                        if (raw) tokens = countTokensForText(applyBiasToText(raw, setting.bias) + ', ');
                    }
                    result.prompt += tokens;
                }
            });
        }
    };

    if (!isV3 && Array.isArray(map.datasets) && Array.isArray(datasets)) {
        datasets.forEach((dsValue) => addDatasetSubToggleTokens(dsValue, true));
        if (typeof appendQuality !== 'undefined' ? appendQuality : true) {
            addDatasetSubToggleTokens('__quality__', false);
        }
        if (typeof appendTransparency !== 'undefined' && appendTransparency) {
            addDatasetSubToggleTokens('__transparency__', false);
        }
    }

    const appendQ = typeof appendQuality !== 'undefined' ? appendQuality : true;
    if (appendQ && modelKey && map.quality[modelKey]) {
        let tokens = selectQualityTokensForModel(map.quality[modelKey], combinedLower);
        if (typeof qualityPresetBias !== 'undefined' && qualityPresetBias !== 1.0 && typeof applyBiasToText === 'function') {
            const raw = window.optionsData?.quality_presets?.[modelKey];
            if (typeof raw === 'string') {
                tokens = countTokensForText(applyBiasToText(raw, qualityPresetBias) + ', ');
            }
        }
        result.prompt += tokens;
    }

    const ucLevel = typeof selectedUcPreset !== 'undefined' ? selectedUcPreset : 0;
    if (ucLevel > 0 && modelKey && map.uc[modelKey]) {
        const levels = map.uc[modelKey];
        const entry = levels.find((l) => l.level === ucLevel) || levels[ucLevel - 1];
        if (entry) result.uc += entry.tokens || 0;
    }

    const nsfwVal = typeof selectedNsfwValue !== 'undefined' ? selectedNsfwValue : 0;
    if (nsfwVal !== 0 && nsfwVal !== undefined) {
        const nsfwEntry = map.nsfw[String(nsfwVal)];
        if (nsfwEntry) {
            if (nsfwEntry.prompt) {
                let p = nsfwEntry.prompt;
                if (typeof nsfwBias !== 'undefined' && nsfwBias !== 1.0 && typeof applyBiasToText === 'function') {
                    const add = window.optionsData?.nsfw_presets?.[String(nsfwVal)]?.add;
                    const raw = [add?.base_prefix, add?.base].filter(Boolean).join(', ');
                    if (raw) p = countTokensForText(applyBiasToText(raw, nsfwBias) + ', ');
                }
                result.prompt += p;
            }
            if (nsfwEntry.uc) {
                let u = nsfwEntry.uc;
                if (typeof nsfwBias !== 'undefined' && nsfwBias !== 1.0 && typeof applyBiasToText === 'function') {
                    const add = window.optionsData?.nsfw_presets?.[String(nsfwVal)]?.add;
                    const raw = [add?.uc_prefix, add?.uc].filter(Boolean).join(', ');
                    if (raw) u = countTokensForText(applyBiasToText(raw, nsfwBias) + ', ');
                }
                result.uc += u;
            }
        }
    }

    return result;
}

function getNonEditableTokenTotals(promptTexts, ucTexts, periodKey, model) {
    const lockedSeeds = window.lastGenerationTextReplacements || window.lockedTextReplacements || [];
    const combinedPrompt = (promptTexts || []).join(', ');
    const preset = getActivePresetTokenDelta(combinedPrompt);

    let expanderPrompt = 0;
    let expanderUc = 0;
    (promptTexts || []).forEach((t) => {
        expanderPrompt += getExpanderTokenDeltaForText(t, lockedSeeds, periodKey, model);
    });
    (ucTexts || []).forEach((t) => {
        expanderUc += getExpanderTokenDeltaForText(t, lockedSeeds, periodKey, model);
    });

    const rentan = computeRentanTokenDelta();

    return {
        prompt: preset.prompt + expanderPrompt + rentan.prompt,
        uc: preset.uc + expanderUc + rentan.uc
    };
}

function computeRentanTokenDelta() {
    const result = { prompt: 0, uc: 0 };
    const tr = window.dynamicGenerationData?.compiled_prompt?.text_replacements;
    if (!tr || !getPromptTokenizer()) return result;

    const sumArr = (arr) => {
        if (!Array.isArray(arr)) return 0;
        let n = 0;
        arr.forEach((item) => {
            if (item && item.replace_text) {
                n += countTokensForText(item.replace_text);
            }
        });
        return n;
    };

    result.prompt += sumArr(tr.prompt);
    result.uc += sumArr(tr.uc);
    if (Array.isArray(tr.character_prompts)) {
        tr.character_prompts.forEach((char) => {
            if (char) {
                result.prompt += sumArr(char.prompt);
                result.uc += sumArr(char.uc);
            }
        });
    }
    return result;
}

function formatTokenCountLabel(displayTotal, nonEditableTokens) {
    const ne = nonEditableTokens || 0;
    if (displayTotal < 2) {
        if (ne > 0) {
            return `${ne} N.E.T.`;
        }
        return `No tokens`;
    }
    if (ne > 0) {
        return `${displayTotal} tokens (+${ne})`;
    }
    return `${displayTotal} tokens`;
}

function refreshTokenBarCounts() {
    if (window.promptTextareaToolbar && typeof window.promptTextareaToolbar.updateAllTokenCounts === 'function') {
        window.promptTextareaToolbar.updateAllTokenCounts();
    }
}
