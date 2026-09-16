const assert = require('assert');
const {
    buildPromptApplicationContext,
    buildExpanderSegments,
    buildPresetSegments,
    mapProcessedToRaw
} = require('../modules/promptApplicationContext');

function testExpanderSegments() {
    const resolvedText = "masterpiece, 1girl, cat ears, detailed background";
    const seeds = [
        { key: "ears", value: "cat ears", pattern: "!ears", source: "prompt" },
        { key: "girl", value: "1girl", pattern: "!girl", source: "prompt" }
    ];

    const segments = buildExpanderSegments(resolvedText, seeds, "prompt");
    assert.strictEqual(segments.length, 2, "Should find 2 non-overlapping expander segments");
    assert.strictEqual(segments[0].key, "girl");
    assert.strictEqual(segments[0].resolvedStart, 13);
    assert.strictEqual(segments[1].key, "ears");
    assert.strictEqual(segments[1].resolvedStart, 20);
}

function testPresetSegments() {
    const resolvedText = "masterpiece, best quality, ultra-detailed";
    const controls = [
        { text: "masterpiece", action: "quality_preset" },
        { text: "best quality", action: "quality_preset" },
        { text: "masterpiece, best quality", action: "compound_preset" }
    ];

    const segments = buildPresetSegments(resolvedText, controls);
    assert.strictEqual(segments.length, 2, "Earlier segments should exclude overlapping range");
    assert.strictEqual(segments[0].text, "masterpiece");
    assert.strictEqual(segments[1].text, "best quality");
}

function testFullApplicationContextAndMapping() {
    const baseline = {
        rawPrompt: "!girl, masterpiece",
        promptForAI: "1girl, masterpiece",
        rawNegativePrompt: "lowres",
        ucForAI: "lowres",
        text_replacements_seed: [
            { key: "girl", value: "1girl", pattern: "!girl", source: "prompt" }
        ],
        appliedPresetControls: {
            prompt: [],
            uc: [],
            character_prompts: [],
            character_uc: []
        }
    };

    const ctx = buildPromptApplicationContext(baseline);
    assert.ok(ctx.streams.prompt, "Prompt stream should be built");

    // Unchanged prompt mapping
    const mappedUnchanged = mapProcessedToRaw(
        ctx,
        { prompt: "1girl, masterpiece", uc: "lowres" },
        { prompt: "1girl, masterpiece", uc: "lowres" }
    );
    assert.strictEqual(mappedUnchanged.prompt, "!girl, masterpiece");
}

function runAll() {
    testExpanderSegments();
    testPresetSegments();
    testFullApplicationContextAndMapping();
    console.log("test-prompt-application-context: ok");
}

runAll();
