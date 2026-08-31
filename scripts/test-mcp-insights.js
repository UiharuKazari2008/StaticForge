const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { compareImageFiles, evaluateThemeRows, splitPromptTags } = require('../modules/mcpInsights');
const { summarizeArgs, summarizeResult, isGenerateTool, resetActivityLog, getRecent, recordActivity } = require('../modules/mcpActivity');

assert.ok(isGenerateTool('generate_image', {}));
assert.ok(isGenerateTool('advanced_tools', { name: 'upscale_image' }));
assert.ok(!isGenerateTool('get_generated_image', {}));

assert.deepStrictEqual(splitPromptTags('1girl, asuka langley, sunset'), ['1girl', 'asuka langley', 'sunset']);

const theme = evaluateThemeRows([
    { metadata: { prompt: '1girl, asuka langley, classroom', forge_data: { characterNames: ['asuka langley'] } } },
    { metadata: { prompt: '1girl, asuka langley, bedroom', forge_data: { characterNames: ['asuka langley'] } } },
    { metadata: { prompt: '1girl, asuka langley, rooftop', forge_data: { characterNames: ['asuka langley'] } } },
    { metadata: { prompt: '1girl, rei ayanami, outdoor', forge_data: { characterNames: ['rei ayanami'] } } }
]);
assert.strictEqual(theme.sample, 4);
assert.ok(theme.overusedCharacters.some((row) => row.value === 'asuka langley'));
assert.ok(theme.suggestions.kinks);

const summarized = summarizeArgs({
    prompt: 'x'.repeat(400),
    imageData: 'HUGE',
    filenames: ['a.png', 'b.png']
});
assert.strictEqual(summarized.imageData, '[omitted]');
assert.ok(summarized.prompt.endsWith('…'));
assert.deepStrictEqual(summarized.filenames, ['a.png', 'b.png']);

const resultSummary = summarizeResult({
    content: [{ type: 'text', text: JSON.stringify({ success: true, filename: 'out.png' }) }],
    isError: false
});
assert.strictEqual(resultSummary.filename, 'out.png');
assert.strictEqual(resultSummary.success, true);

resetActivityLog();
recordActivity(null, { tool: 'delete_images', argsSummary: { filenames: ['a.png'] }, resultSummary: { success: true }, success: true });
assert.strictEqual(getRecent().length, 1);

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-diff-'));
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toFile(a);
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 20, b: 30 } } }).png().toFile(b);
    const diff = await compareImageFiles(a, b);
    assert.ok(diff.changedPercent > 50);
    assert.strictEqual(diff.image.mimeType, 'image/webp');
    assert.ok(diff.image.bytes.length > 20);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-mcp-insights: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
