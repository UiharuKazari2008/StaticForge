'use strict';

// #347: Grok dynagen system message and tool loop are gone.
// Context, weather, holiday, expiration, and legacy Tendai reads stay.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const handlers = require('../modules/dynamicGenerationHandlers');
const GrokService = require('../modules/aiServices/grokService');
const wren = require('../modules/dynagenWren');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

assert.equal(fs.existsSync(path.join(ROOT, 'modules/systemMessageBuilder.js')), false);
assert.equal(fs.existsSync(path.join(ROOT, 'modules/dynamicGenerationSchema.js')), false);
assert.equal(handlers.generateDynamicGenerationSystemMessage_Modular, undefined);

const handlerSource = read('modules/dynamicGenerationHandlers.js');
assert.equal(handlerSource.includes('systemMessageBuilder'), false);
assert.equal(handlerSource.includes('generateDynamicGenerationSystemMessage_Modular'), false);
assert.equal(handlerSource.includes('getAllToolDefinitions'), false);
assert.ok(handlerSource.includes('async function resolveDynamicContext'));
assert.ok(handlerSource.includes('function calculateDynamicExpiration'));
assert.ok(handlerSource.includes('function compileWeatherHistoryReport'));
assert.ok(handlerSource.includes('function detectSeasonalHolidays'));

const grokSource = read('modules/aiServices/grokService.js');
assert.equal(grokSource.includes('getAllToolDefinitions'), false);
assert.equal(grokSource.includes('handleValidateTextReplacement'), false);
assert.equal(grokSource.includes('dynamicGenerationSchema'), false);
assert.ok(grokSource.includes('async callDirectorAIWithStructuredOutput'));
assert.ok(grokSource.includes('Grok dynagen tool loop was removed (#347)'));

const grok = new GrokService({});
assert.equal(grok.getAllToolDefinitions, undefined);
assert.equal(typeof grok.callDirectorAIWithStructuredOutput, 'function');
assert.equal(typeof grok.callDirectorAIWithCompletion, 'function');

function logger() {
    return { verbose() {}, detailed() {}, warn() {}, normal() {}, error() {}, shouldLog() { return false; } };
}

const gr = {
    getLogger: logger,
    getGrokService() { throw new Error('Grok dynagen was called'); },
    getConfig() { return {}; },
    getSecureConfig() { return null; }
};

(async () => {
    await assert.rejects(() => grok.executeTool(), /Grok dynagen tool loop was removed/);

    const core = await handlers.processDynamicGenerationCore(gr, { directive: 'nope' }, { marker: true }, 'prompt', 'uc');
    assert.equal(core.success, true);
    assert.equal(core.noop, true);
    assert.equal(core.processed, false);
    assert.deepEqual(core.text_replacements, { prompt: [], uc: [], character_prompts: [] });
    assert.equal(core.context.marker, true);

    const legacyPrompt = '1girl, standing in a garden, blue sky';
    const legacy = {
        source: 'director',
        prompt: '1girl, standing in a snowy street, blue sky',
        uc: 'lowres',
        text_replacements: {
            prompt: [{ action: 'replace', select_text: 'garden', replace_text: 'snowy street' }],
            uc: [],
            character_prompts: []
        }
    };
    assert.equal(wren._test.isLegacyTendai(legacy), true);
    assert.equal(wren._test.staleReason(legacy, {}, {}, {}, Date.now()), 'pre-v1.1 Tendai stamp');
    const applied = handlers.applyDynamicReplacements(gr, legacyPrompt, legacy.text_replacements, 'prompt');
    assert.equal(applied.success, true);
    assert.equal(applied.result, legacy.prompt);

    const inspector = read('public/scripts/comp/imagePromptInspector.js');
    const compileApplet = read('public/scripts/comp/compileToPromptsApplet.js');
    const rows = read('public/scripts/comp/textReplacementManager.js');
    assert.ok(inspector.includes('createTendaiReplacementRow(replacement, globalIndex, { mode: \'view\' })'));
    assert.ok(inspector.includes('compiled_prompt'));
    assert.ok(compileApplet.includes('createTendaiReplacementRow'));
    assert.ok(rows.includes('function createTendaiReplacementRow'));

    const expires = handlers.calculateDynamicExpiration(gr, {}, 15 * 60 * 1000);
    assert.ok(expires > Date.now());

    const resolved = await handlers.resolveDynamicContext(gr, {
        tod: true,
        weather: false,
        season: true,
        location: '139.6917_35.6895'
    });
    assert.ok(resolved.time && Number.isInteger(resolved.time.hour));
    assert.ok(resolved.timeOfDay && resolved.timeOfDay.name);
    assert.equal(resolved.weather, null);
    assert.ok(resolved.season && resolved.season.name);
    assert.equal(resolved.location.latitude, 35.6895);
    assert.ok(resolved.location.timezone);

    assert.equal(typeof wren.resolveDynagenWithWren, 'function');
    console.log('dynagen grok removal ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
