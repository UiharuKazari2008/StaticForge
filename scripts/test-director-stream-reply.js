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

console.log('test-director-stream-reply: ok');
