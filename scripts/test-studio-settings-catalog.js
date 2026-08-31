const assert = require('assert');
const {
    buildStudioSettingsCatalog,
    applyCatalogToListedTool,
    PRESET_RULE
} = require('../modules/studioSettingsCatalog');

const fakeResources = {
    getPromptConfig: () => ({
        quality_presets: {
            v5: 'very aesthetic, masterpiece, no text'
        },
        uc_presets: {
            v5: [
                'lowres, human focus tags',
                'lowres, light tags',
                'lowres, heavy tags'
            ]
        },
        nsfw_presets: {
            0: { remove: { uc: ['nsfw'] } },
            3: { add: { base: 'nsfw, nude' } }
        },
        datasets: [{
            value: '__quality__',
            isQualityPreset: true,
            sub_toggles: [{
                id: 'no_text',
                name: 'No text',
                value: 'no text',
                default_enabled: true
            }]
        }]
    })
};

const catalog = buildStudioSettingsCatalog(fakeResources, 'v5');
assert.ok(catalog.rule.includes('append_'));
assert.ok(catalog.rule.includes('turn that preset off'));
assert.ok(catalog.quality.subToggles.some((row) => row.id === 'no_text' && row.defaultEnabled));
assert.deepStrictEqual(catalog.quality.forModel[0].value, 'very aesthetic, masterpiece, no text');
assert.strictEqual(catalog.uc.forModel[0].id, 0);
assert.strictEqual(catalog.uc.forModel[1].name, 'Human Focus');
assert.strictEqual(catalog.uc.forModel[1].value, 'lowres, human focus tags');
assert.strictEqual(catalog.uc.forModel[3].name, 'Heavy');
assert.strictEqual(catalog.nsfw.levels.find((row) => row.id === 3).name, 'Nude');
assert.ok(catalog.nsfw.levels.find((row) => row.id === 3).add.includes('nsfw, nude'));
assert.ok(catalog.samplers.some((row) => row.value === 'k_euler_ancestral'));
assert.ok(catalog.resolutions.some((row) => row.value === 'normal_portrait' && row.width === 832));
assert.ok(catalog.nsfw.levels.some((row) => row.id === 3));

const listed = applyCatalogToListedTool({
    name: 'generate_image',
    description: 'Generate',
    inputSchema: {
        type: 'object',
        properties: {
            sampler: { type: 'string' },
            append_quality: { type: 'boolean' },
            append_uc: { type: 'number' },
            dataset_config: { type: 'object' },
            params: { type: 'object', properties: { append_uc: { type: 'number' } } }
        }
    }
}, catalog);
assert.ok(listed.description.includes(PRESET_RULE));
assert.ok(listed.inputSchema.properties.sampler.enum.includes('k_euler_ancestral'));
assert.ok(listed.inputSchema.properties.append_quality.description.includes('very aesthetic, masterpiece, no text'));
assert.ok(listed.inputSchema.properties.append_uc.description.includes('lowres, heavy tags'));
assert.ok(listed.inputSchema.properties.append_uc.description.includes('Do not also paste'));
assert.ok(listed.inputSchema.properties.params.properties.append_uc.description.includes('Human Focus'));
assert.ok(listed.inputSchema.properties.dataset_config.properties.nsfw.description.includes('Nude'));
assert.ok(listed.inputSchema.properties.dataset_config.properties.nsfw.description.includes('nsfw, nude'));
assert.ok(listed.inputSchema.properties.dataset_config.description.includes('no_text'));

const empty = buildStudioSettingsCatalog(null);
assert.ok(Array.isArray(empty.samplers));
assert.deepStrictEqual(empty.quality.byModel, {});

console.log('test-studio-settings-catalog: ok');
