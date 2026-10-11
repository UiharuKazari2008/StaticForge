'use strict';

// consumeClaudeStreamLine turns `claude -p --output-format stream-json` lines
// into the same {rows, live, text, error, finished, context} shape xiDirector's
// publish()/saveTrace() already consume from the Cursor parser.

const assert = require('assert');
const xiDirector = require('../modules/xiDirector');

function freshState() {
    return { text: '', tool: '', error: null, finished: false, rows: [], live: null, context: null };
}

function feed(state, events) {
    const { consumeClaudeStreamLine } = xiDirector._test;
    events.forEach((evt) => consumeClaudeStreamLine(JSON.stringify(evt), state));
}

function main() {
    // Init event captures the session id for --resume on the next turn.
    const state = freshState();
    feed(state, [{ type: 'system', subtype: 'init', session_id: 'sess-123' }]);
    assert.strictEqual(state.sessionId, 'sess-123');
    assert.strictEqual(state.rows.length, 0);

    // Text content accumulates onto state.text and becomes an assistant row.
    feed(state, [{
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Looking at the file now.' }] }
    }]);
    assert.strictEqual(state.text, 'Looking at the file now.');
    assert.strictEqual(state.rows.length, 1);
    assert.strictEqual(state.rows[0].type, 'assistant');

    // Tool use opens a row keyed by tool_use_id; the matching tool_result (in a
    // later `user` event) fills it in and closes it.
    feed(state, [{
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: 'a.js' } }] }
    }]);
    const toolRow = state.rows.find((row) => row.type === 'tool' && row.name === 'Read');
    assert.ok(toolRow);
    assert.strictEqual(toolRow._closed, false);
    assert.ok(toolRow.args.includes('a.js'));

    feed(state, [{
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'file contents here', is_error: false }] }
    }]);
    assert.strictEqual(toolRow._closed, true);
    assert.strictEqual(toolRow.result, 'file contents here');

    // An error tool_result is prefixed, not silently swallowed.
    feed(state, [{
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'call-2', name: 'Bash', input: { command: 'false' } }] }
    }, {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call-2', content: 'command failed', is_error: true }] }
    }]);
    const failedRow = state.rows.find((row) => row.name === 'Bash');
    assert.ok(failedRow.result.startsWith('Error:'));

    // Terminal result event finishes the run; is_error surfaces as state.error.
    feed(state, [{ type: 'result', subtype: 'success', is_error: false, result: 'Done.' }]);
    assert.strictEqual(state.finished, true);
    assert.strictEqual(state.error, null);

    const errState = freshState();
    feed(errState, [{ type: 'result', subtype: 'error', is_error: true, result: 'Claude hit a wall' }]);
    assert.strictEqual(errState.finished, true);
    assert.strictEqual(errState.error, 'Claude hit a wall');

    // A tool_result with no matching open tool (e.g. truncated log) is ignored,
    // not a crash.
    const orphanState = freshState();
    feed(orphanState, [{
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'no-such-call', content: 'x' }] }
    }]);
    assert.strictEqual(orphanState.rows.length, 0);

    // Malformed JSON is dropped silently, not thrown.
    const { consumeClaudeStreamLine } = xiDirector._test;
    assert.doesNotThrow(() => consumeClaudeStreamLine('not json {{{', freshState()));

    console.log('xi claude stream parser tests passed');
}

main();
