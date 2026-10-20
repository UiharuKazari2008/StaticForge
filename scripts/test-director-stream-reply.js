'use strict';

// #350: a full assistant message replaces a lossy partial instead of appending,
// and the saved Description is the CLI result once. The Director chat renders
// assistant row.text in place (public/scripts/comp/director.js patchTraceRow).

const assert = require('assert');
const { consumeStreamLine, settleDirectorResult } = require('../modules/cursorDirector')._test;

function assistant(text) {
    return JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text }] }
    });
}

function resultLine(text) {
    return JSON.stringify({ type: 'result', result: text });
}

function assistantTexts(state) {
    return (state.rows || []).filter((row) => row && row.type === 'assistant').map((row) => row.text);
}

const full = '{"expanders":[{"prefix":"dg_weather","value":"rain"}]}';
const lossy = '},prefix":"dg_weather"';

const streamed = { text: '', rows: [], live: null };
consumeStreamLine(assistant('Hel'), streamed);
consumeStreamLine(assistant('Hello'), streamed);
assert.strictEqual(streamed.live.text, 'Hello', 'cumulative partials still grow in place');
consumeStreamLine(assistant('!'), streamed);
assert.strictEqual(streamed.live.text, 'Hello!', 'a shorter delta is still appended');

const lossyState = { text: '', rows: [], live: null };
consumeStreamLine(assistant(lossy), lossyState);
consumeStreamLine(assistant(full), lossyState);
assert.strictEqual(lossyState.text, full, 'a longer non-prefix replaces the lossy partial');
assert.strictEqual(lossyState.live.text, full);
consumeStreamLine(resultLine(full), lossyState);
assert.strictEqual(lossyState.text, full, 'Description equals the CLI result');
assert.deepStrictEqual(assistantTexts(lossyState), [full], 'the chat shows the reply once');

const doubled = {
    text: lossy + full,
    rows: [{ type: 'assistant', text: lossy + full }],
    live: null
};
settleDirectorResult(doubled, full);
assert.strictEqual(doubled.text, full);
assert.deepStrictEqual(assistantTexts(doubled), [full]);

const { clipToolPayload, TOOL_PAYLOAD_MAX, consumeClaudeStreamLine } = require('../modules/cursorDirector')._test;
assert.ok(TOOL_PAYLOAD_MAX > 4000);
const longPrompt = 'x'.repeat(6000);
assert.strictEqual(clipToolPayload(longPrompt).length, 6000, 'payloads over 4000 chars are stored in full');
assert.ok(clipToolPayload('y'.repeat(TOOL_PAYLOAD_MAX + 50)).endsWith('…'));
const toolState = { text: '', rows: [], live: null, keepToolBodies: true };
consumeStreamLine(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'apply_studio_changes', input: { prompt: longPrompt } }] }
}), toolState);
const toolRow = (toolState.rows || []).find((row) => row && row.type === 'tool');
assert.ok(toolRow, 'tool row captured');
assert.ok(String(toolRow.args).includes(longPrompt), 'Director session stores the full apply_studio_changes payload');
const claudeState = { text: '', rows: [], live: null, openTools: new Map(), keepToolBodies: true };
consumeClaudeStreamLine(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__dreamscape__save_memory', input: { observations: [longPrompt] } }] }
}), claudeState);
assert.ok(String(claudeState.rows[0].args).includes(longPrompt), 'Claude/MiniMax tool args are not truncated at 4000');

const replayState = { text: '', rows: [], live: null };
consumeStreamLine(JSON.stringify({
    type: 'assistant',
    message: {
        content: [{
            type: 'tool_use',
            name: 'apply_studio_changes',
            input: {
                params: { steps: 14 },
                change: { characterPrompts: { item: { index: 0, action: 'replace', prompt: 'alice' } } }
            }
        }]
    }
}), replayState);
const replayRow = (replayState.rows || []).find((row) => row && row.type === 'tool');
assert.ok(Array.isArray(replayRow && replayRow.replay && replayRow.replay.characters), 'replay unwraps MiniMax characterPrompts');
assert.strictEqual(replayRow.replay.characters[0].prompt, 'alice');

console.log('test-director-stream-reply: ok');
