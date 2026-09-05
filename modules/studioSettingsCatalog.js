/**
 * Live Studio generation settings for MCP / agent session.
 * Quality and UC strings come from prompt.config (per model) so Grok can
 * enable append_quality / append_uc instead of pasting the same tags.
 */

const UC_PRESET_LEVEL_LABELS = ['None', 'Human Focus', 'Light', 'Heavy', 'Curated', 'Furry Focus'];

const NSFW_LEVEL_LABELS = {
    3: 'Nude',
    2: 'Skimpy',
    1: 'Allow',
    0: 'Neutral',
    '-1': 'Remove',
    '-2': 'Clense'
};

const PRESET_TABLE_MODEL_FALLBACKS = {
    v5: ['v4_5', 'v4_5_cur', 'v4'],
    v5_cur: ['v4_5_cur', 'v4_5', 'v4_cur', 'v4'],
    v4_5: ['v4_5_cur', 'v4'],
    v4_5_cur: ['v4_5', 'v4_cur'],
    v4: ['v4_cur', 'v4_5'],
    v4_cur: ['v4', 'v4_5_cur']
};

const SAMPLERS = [
    { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
    { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
    { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
    { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
    { value: 'k_euler', label: 'Euler' },
    { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' }
];

const NOISE_SCHEDULERS = [
    { value: 'karras', label: 'Karras' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'polyexponential', label: 'Polyexponential' }
];

const RESOLUTIONS = [
    { value: 'small_portrait', label: 'Small Portrait', width: 512, height: 768 },
    { value: 'small_landscape', label: 'Small Landscape', width: 768, height: 512 },
    { value: 'small_square', label: 'Small Square', width: 640, height: 640 },
    { value: 'normal_portrait', label: 'Normal Portrait', width: 832, height: 1216 },
    { value: 'normal_landscape', label: 'Normal Landscape', width: 1216, height: 832 },
    { value: 'normal_square', label: 'Normal Square', width: 1024, height: 1024 },
    { value: 'normal_wallpaper_portrait', label: 'Normal Wallpaper Portrait', width: 576, height: 1024 },
    { value: 'normal_wallpaper_landscape', label: 'Normal Wallpaper Widescreen', width: 1024, height: 576 },
    { value: 'large_portrait', label: 'Large Portrait', width: 1024, height: 1536 },
    { value: 'large_landscape', label: 'Large Landscape', width: 1536, height: 1024 },
    { value: 'large_square', label: 'Large Square', width: 1472, height: 1472 },
    { value: 'xlarge_portrait', label: 'Max Portrait', width: 1408, height: 2112 },
    { value: 'xlarge_landscape', label: 'Max Landscape', width: 2112, height: 1408 },
    { value: 'xlarge_square', label: 'Max Square', width: 1728, height: 1728 },
    { value: 'wallpaper_portrait', label: 'Wallpaper Portrait', width: 1088, height: 1920 },
    { value: 'wallpaper_landscape', label: 'Wallpaper Widescreen', width: 1920, height: 1088 }
];

const PRESET_RULE = 'Prefer the matching append_* flag over pasting that preset text. If you need to change a tag inside a preset, turn that preset off (append_quality false / append_uc 0) and put the edited string in prompt or uc. Never leave the preset on and also paste a variant — the server prepends the live value and you would duplicate or fight it. No-text is the Quality sub-toggle dataset_config.settings.__quality__.no_text (default on); disable it for in-image text instead of pasting "no text" or turning quality off.';

function resolvePresetModelKey(table, modelKey) {
    if (!table || !modelKey) return null;
    const key = String(modelKey).toLowerCase();
    if (table[key] != null) return key;
    const fallbacks = PRESET_TABLE_MODEL_FALLBACKS[key] || [];
    for (let i = 0; i < fallbacks.length; i++) {
        if (table[fallbacks[i]] != null) return fallbacks[i];
    }
    return null;
}

function listQualityForModel(table, modelKey) {
    const resolved = resolvePresetModelKey(table, modelKey);
    if (!resolved) return null;
    const raw = table[resolved];
    if (typeof raw === 'string') {
        return [{ id: true, name: 'Quality', value: raw, modelKey: resolved }];
    }
    if (Array.isArray(raw) && typeof raw[0] === 'string') {
        return raw.map((value, index) => ({
            id: index + 1,
            name: `Quality ${index + 1}`,
            value: String(value || ''),
            modelKey: resolved
        }));
    }
    if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object') {
        return raw.map((item) => ({
            id: item.id != null ? item.id : true,
            name: item.name || 'Quality',
            value: String(item.value || ''),
            match: Array.isArray(item.match) ? item.match : undefined,
            modelKey: resolved
        }));
    }
    return null;
}

function listUcForModel(table, modelKey) {
    const resolved = resolvePresetModelKey(table, modelKey);
    const levels = [{ id: 0, name: 'None', value: '', modelKey: resolved || modelKey }];
    if (!resolved) return levels;
    const raw = table[resolved];
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
    list.forEach((text, index) => {
        levels.push({
            id: index + 1,
            name: UC_PRESET_LEVEL_LABELS[index + 1] || `Level ${index + 1}`,
            value: String(text || ''),
            modelKey: resolved
        });
    });
    return levels;
}

function compactNsfwAdd(add) {
    if (!add || typeof add !== 'object') return undefined;
    const parts = [];
    ['base_prefix', 'base', 'uc_prefix', 'uc', 'chara_base_prefix', 'chara_base', 'chara_uc_prefix', 'chara_uc'].forEach((key) => {
        if (add[key]) parts.push(`${key}=${add[key]}`);
    });
    return parts.length ? parts.join('; ') : undefined;
}

function summarizeNsfw(nsfwPresets) {
    if (!nsfwPresets || typeof nsfwPresets !== 'object') return [];
    return Object.keys(nsfwPresets).sort((a, b) => Number(a) - Number(b)).map((id) => {
        const row = nsfwPresets[id] || {};
        const add = row.add || {};
        const remove = row.remove;
        return {
            id: Number(id),
            name: NSFW_LEVEL_LABELS[id] || NSFW_LEVEL_LABELS[String(id)] || `Level ${id}`,
            add: compactNsfwAdd(add),
            ucPrefix: add.uc_prefix || undefined,
            remove: Array.isArray(remove) ? remove : (remove && typeof remove === 'object' ? remove : undefined)
        };
    });
}

function readPromptConfig(globalResources) {
    if (!globalResources || typeof globalResources.getPromptConfig !== 'function') return {};
    try {
        return globalResources.getPromptConfig({ clone: true }) || {};
    } catch (_err) {
        return {};
    }
}

function listQualitySubToggles(promptConfig) {
    const datasets = promptConfig && promptConfig.datasets;
    if (!Array.isArray(datasets)) return [];
    const quality = datasets.find((row) => row && (row.isQualityPreset || row.value === '__quality__'));
    if (!quality) return [];
    return (quality.sub_toggles || []).map((st) => ({
        id: st.id,
        name: st.name,
        value: st.value,
        defaultEnabled: !!st.default_enabled,
        models: Array.isArray(st.models) ? st.models : undefined,
        param: `dataset_config.settings.${quality.value || '__quality__'}.${st.id}`
    }));
}

function buildStudioSettingsCatalog(globalResources, modelHint) {
    const promptConfig = readPromptConfig(globalResources);
    const qualityTable = promptConfig.quality_presets || {};
    const ucTable = promptConfig.uc_presets || {};
    const models = [...new Set([
        ...Object.keys(qualityTable),
        ...Object.keys(ucTable)
    ])].sort();
    const qualityByModel = {};
    const ucByModel = {};
    models.forEach((model) => {
        const quality = listQualityForModel(qualityTable, model);
        if (quality) qualityByModel[model] = quality;
        ucByModel[model] = listUcForModel(ucTable, model);
    });
    const model = modelHint ? String(modelHint).toLowerCase() : null;
    return {
        rule: PRESET_RULE,
        model: model || undefined,
        models,
        samplers: SAMPLERS,
        noiseScheduler: NOISE_SCHEDULERS,
        resolutions: RESOLUTIONS,
        quality: {
            param: 'append_quality',
            type: 'boolean',
            byModel: qualityByModel,
            forModel: model ? (qualityByModel[resolvePresetModelKey(qualityTable, model) || model] || qualityByModel[model] || null) : undefined,
            subToggles: listQualitySubToggles(promptConfig)
        },
        uc: {
            param: 'append_uc',
            type: 'number',
            none: 0,
            labels: UC_PRESET_LEVEL_LABELS,
            byModel: ucByModel,
            forModel: model ? (ucByModel[resolvePresetModelKey(ucTable, model) || model] || ucByModel[model] || null) : undefined
        },
        nsfw: {
            param: 'dataset_config.nsfw',
            type: 'number',
            labels: NSFW_LEVEL_LABELS,
            rule: 'Set dataset_config.nsfw. Do not also paste that level\'s add/remove tags into prompt or uc.',
            levels: summarizeNsfw(promptConfig.nsfw_presets)
        },
        transparency: {
            param: 'append_transparency',
            type: 'boolean',
            value: 'transparent background'
        }
    };
}

function slimStudioSettingsCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object') return catalog;
    const quality = catalog.quality && typeof catalog.quality === 'object' ? { ...catalog.quality } : {};
    delete quality.byModel;
    quality.catalog = 'slim';
    quality.next = 'Full per-model strings: get_studio_state.settings or tools/list';
    const uc = catalog.uc && typeof catalog.uc === 'object' ? { ...catalog.uc } : {};
    delete uc.byModel;
    uc.catalog = 'slim';
    uc.next = 'Full per-model strings: get_studio_state.settings or tools/list';
    const nsfw = catalog.nsfw && typeof catalog.nsfw === 'object' ? { ...catalog.nsfw } : {};
    if (Array.isArray(nsfw.levels)) {
        nsfw.levels = nsfw.levels.map((row) => ({ id: row.id, name: row.name }));
    }
    nsfw.catalog = 'slim';
    return {
        rule: catalog.rule,
        model: catalog.model,
        models: catalog.models,
        samplers: catalog.samplers,
        noiseScheduler: catalog.noiseScheduler,
        resolutions: catalog.resolutions,
        quality,
        uc,
        nsfw,
        transparency: catalog.transparency
    };
}

function formatQualityDescription(catalog) {
    const lines = [
        'If true, server prepends the live quality string for the generate model. Do not also put that text in prompt.',
        PRESET_RULE
    ];
    const byModel = catalog && catalog.quality && catalog.quality.byModel;
    if (byModel) {
        Object.keys(byModel).sort().forEach((model) => {
            const items = byModel[model] || [];
            const text = items.map((item) => `${item.name}: ${item.value}`).join(' | ');
            if (text) lines.push(`${model}: ${text}`);
        });
    }
    return lines.join(' ');
}

function formatUcDescription(catalog) {
    const lines = [
        '0 = None (off). 1–N enable that UC preset for the generate model; server prepends the live string. Do not also paste those tags into uc.',
        PRESET_RULE
    ];
    const byModel = catalog && catalog.uc && catalog.uc.byModel;
    if (byModel) {
        Object.keys(byModel).sort().forEach((model) => {
            const items = (byModel[model] || []).filter((item) => item.id !== 0);
            const text = items.map((item) => `${item.id} ${item.name}: ${item.value}`).join(' | ');
            if (text) lines.push(`${model}: ${text}`);
        });
    }
    return lines.join(' ');
}

function formatNsfwDescription(catalog) {
    const lines = [
        'dataset_config.nsfw level. Studio: 3 Nude, 2 Skimpy, 1 Allow, 0 Neutral, -1 Remove, -2 Clense. Set the level; do not also paste that level\'s add/remove strings into prompt or uc.'
    ];
    const levels = catalog && catalog.nsfw && catalog.nsfw.levels;
    if (Array.isArray(levels) && levels.length) {
        levels.forEach((row) => {
            const bits = [`${row.id} ${row.name}`];
            if (row.add) bits.push(`add: ${row.add}`);
            if (row.remove) bits.push(`remove: ${typeof row.remove === 'string' ? row.remove : JSON.stringify(row.remove)}`);
            lines.push(bits.join(' — '));
        });
    }
    return lines.join(' ');
}

function formatTransparencyDescription(catalog) {
    const value = catalog && catalog.transparency && catalog.transparency.value
        ? catalog.transparency.value
        : 'transparent background';
    return `If true, server prepends "${value}". Do not also add that tag in prompt.`;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function patchParamSchema(props, catalog) {
    if (!props || typeof props !== 'object') return;
    if (props.sampler) {
        props.sampler.enum = SAMPLERS.map((row) => row.value);
        props.sampler.description = `Sampler. Values: ${SAMPLERS.map((row) => `${row.value} (${row.label})`).join(', ')}`;
    }
    if (props.noiseScheduler) {
        props.noiseScheduler.enum = NOISE_SCHEDULERS.map((row) => row.value);
        props.noiseScheduler.description = `Noise schedule. Values: ${NOISE_SCHEDULERS.map((row) => `${row.value} (${row.label})`).join(', ')}`;
    }
    if (props.resolution) {
        props.resolution.enum = RESOLUTIONS.map((row) => row.value).concat(['custom']);
        props.resolution.description = `Named size (omit width/height) or custom plus width and height. ${RESOLUTIONS.map((row) => `${row.value}=${row.width}x${row.height}`).join(', ')}`;
    }
    if (props.model && catalog && Array.isArray(catalog.models) && catalog.models.length) {
        props.model.enum = catalog.models;
        props.model.description = `Model id. Known: ${catalog.models.join(', ')}`;
    }
    if (props.steps) props.steps.description = 'Sampler steps (typical 23–28)';
    if (props.guidance) props.guidance.description = 'CFG / prompt guidance (typical 5)';
    if (props.rescale) props.rescale.description = 'CFG rescale 0–1';
    if (props.seed) props.seed.description = 'Specific seed, or "last" / seedLock true to reuse the last used seed';
    if (props.seedLock) props.seedLock.description = 'true locks last used seed (Studio sprout). false rolls a new variation';
    if (props.variety) props.variety.description = 'Variety+ (model-dependent)';
    if (props.upscale) props.upscale.description = 'Request 2x upscale after generate';
    if (props.strength) props.strength.description = 'img2img strength 0–1 (only in a strength-capable mode)';
    if (props.noise) props.noise.description = 'img2img noise 0–1';
    if (props.n) props.n.description = 'Print count 1–8. generate_image / generate_preset: server copies (filenames[] when n>1). apply_studio_changes: Studio prints input (used with autoGenerate).';
    if (props.append_quality) {
        props.append_quality.description = formatQualityDescription(catalog);
    }
    if (props.append_uc) {
        props.append_uc.description = formatUcDescription(catalog);
    }
    if (props.append_transparency) {
        props.append_transparency.description = formatTransparencyDescription(catalog);
    }
    if (props.nsfw) {
        props.nsfw.description = formatNsfwDescription(catalog);
        const ids = ((catalog && catalog.nsfw && catalog.nsfw.levels) || []).map((row) => row.id);
        if (ids.length) props.nsfw.enum = ids;
    }
    if (props.dataset_config) {
        if (!props.dataset_config.properties) props.dataset_config.properties = {};
        if (!props.dataset_config.properties.nsfw) props.dataset_config.properties.nsfw = { type: 'number' };
        const nsfwDesc = formatNsfwDescription(catalog);
        const qualitySubs = catalog && catalog.quality && catalog.quality.subToggles;
        let settingsHint = 'dataset_config.settings.__quality__.no_text: default on; set enabled false for in-image text. Keep append_quality on.';
        if (Array.isArray(qualitySubs) && qualitySubs.length) {
            settingsHint = qualitySubs.map((st) => `${st.param} (${st.name}=${st.value}${st.defaultEnabled ? ', default on' : ''})`).join('; ');
        }
        props.dataset_config.description = `${nsfwDesc} Quality sub-toggles: ${settingsHint}`;
        props.dataset_config.properties.nsfw.description = nsfwDesc;
        const ids = ((catalog && catalog.nsfw && catalog.nsfw.levels) || []).map((row) => row.id);
        if (ids.length) props.dataset_config.properties.nsfw.enum = ids;
    }
    if (props.params && props.params.properties) {
        patchParamSchema(props.params.properties, catalog);
    }
    if (props.overrideParams && props.overrideParams.properties) {
        patchParamSchema(props.overrideParams.properties, catalog);
    }
}

function applyCatalogToListedTool(tool, catalog) {
    if (!tool || !tool.inputSchema) return tool;
    if (tool.name !== 'generate_image' && tool.name !== 'apply_studio_changes' && tool.name !== 'generate_preset' && tool.name !== 'expand_image') {
        return tool;
    }
    const listed = {
        name: tool.name,
        description: tool.description,
        inputSchema: cloneJson(tool.inputSchema)
    };
    if (tool.scope) listed.scope = tool.scope;
    patchParamSchema(listed.inputSchema.properties, catalog);
    if (tool.name === 'generate_image' || tool.name === 'apply_studio_changes') {
        listed.description = `${tool.description} ${PRESET_RULE} Live quality/UC strings are on this schema (append_quality / append_uc) and on get_studio_state.settings.`;
    }
    return listed;
}

module.exports = {
    UC_PRESET_LEVEL_LABELS,
    NSFW_LEVEL_LABELS,
    SAMPLERS,
    NOISE_SCHEDULERS,
    RESOLUTIONS,
    PRESET_RULE,
    buildStudioSettingsCatalog,
    slimStudioSettingsCatalog,
    applyCatalogToListedTool,
    formatQualityDescription,
    formatUcDescription,
    formatNsfwDescription
};
