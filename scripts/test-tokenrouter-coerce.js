'use strict';
const assert = require('assert');
const { _test } = require('../modules/tokenRouterBridge');
const { coerceToSchema, StreamTranslator, toolNames, toAnthropicMessage } = _test;
const studio = { type: 'object', properties: {
    autoGenerate: { type: 'boolean' },
    change: { type: 'object', properties: {
        v: { type: 'integer' }, overwrite: { type: 'boolean' }, prompt: { type: 'string' },
        characters: { type: 'array', items: { type: 'object', properties: { prompt: { type: 'string' }, enabled: { type: 'boolean' } } } },
        params: { type: 'object', properties: { steps: { type: 'integer' }, guidance: { type: 'number' }, seed: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, model: { type: 'string' } } }
    }, additionalProperties: true }
} };
const mem = { type: 'object', properties: { name: { type: 'string' }, observations: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, importance: { type: 'number' } } } } } };
// MiniMax shapes seen live on dirc_3ab5f3c0bfcf3dfd 2026-10-19
let out = coerceToSchema({ autoGenerate: 'true', change: { v: '1', overwrite: 'true', prompt: '1.15::a, 14::', characters: '', params: { steps: '14', guidance: '6.5', seed: 'null', model: 'V5_MEDIUM' }, extraKey: '7' } }, studio);
assert.deepStrictEqual(out, { autoGenerate: true, change: { v: 1, overwrite: true, prompt: '1.15::a, 14::', characters: [], params: { steps: 14, guidance: 6.5, seed: null, model: 'V5_MEDIUM' }, extraKey: '7' } });
out = coerceToSchema({ name: 'x', observations: { item: [{ content: '0.5', importance: '0.5' }] } }, mem);
assert.deepStrictEqual(out, { name: 'x', observations: [{ content: '0.5', importance: 0.5 }] });
out = coerceToSchema({ change: { characters: { item: { prompt: 'a', enabled: 'false' } } } }, studio);
assert.deepStrictEqual(out.change.characters, [{ prompt: 'a', enabled: false }]);
// already typed input (DeepSeek) is untouched; unparseable strings stay
const typed = { autoGenerate: true, change: { v: 1, params: { steps: 28, guidance: 'high' } } };
assert.deepStrictEqual(coerceToSchema(typed, studio), typed);
// integer schema does not accept a fraction string
assert.strictEqual(coerceToSchema({ change: { v: '1.5' } }, studio).change.v, '1.5');
// end to end through the stream translator
const tools = [{ name: 'mcp__dreamscape__apply_studio_changes', input_schema: studio }];
const names = toolNames(tools);
const tr = new StreamTranslator('minimax/minimax-m3.1-flash', names);
tr.push ? null : null;
const feed = (delta) => (tr.handleChunk || tr.chunk || tr.push).call(tr, { choices: [{ delta }] });
feed({ tool_calls: [{ index: 0, id: 'c1', function: { name: names.up(tools[0].name), arguments: '{"autoGenerate":"true","change":{"params":{"steps":"14"}}}' } }] });
const ev = tr.finish();
const delta = ev.find((e) => e[0] === 'content_block_delta' && e[1].delta.type === 'input_json_delta');
assert.deepStrictEqual(JSON.parse(delta[1].delta.partial_json), { autoGenerate: true, change: { params: { steps: 14 } } });
const msg = toAnthropicMessage({ choices: [{ message: { tool_calls: [{ id: 'c2', function: { name: names.up(tools[0].name), arguments: '{"change":{"overwrite":"false"}}' } }] } }] }, 'm', names);
assert.strictEqual(msg.content.find((b) => b.type === 'tool_use').input.change.overwrite, false);
console.log('test-tokenrouter-coerce: ok');
// reasoning repeat (fix 3)
{
    const r = new StreamTranslator('minimax/minimax-m3.1-flash', toolNames([]));
    const thought = 'Let me start with get_session_state view live. Then memories.';
    const out = [];
    const take = (ev) => ev.filter((e) => e[0] === 'content_block_delta' && e[1].delta.type === 'thinking_delta').forEach((e) => out.push(e[1].delta.thinking));
    take(r.chunk({ choices: [{ delta: { reasoning_content: thought.slice(0, 30) } }] }));
    take(r.chunk({ choices: [{ delta: { reasoning_content: thought.slice(30) } }] }));
    take(r.chunk({ choices: [{ delta: { reasoning_content: thought } }] }));
    assert.strictEqual(out.join(''), thought);
    take(r.chunk({ choices: [{ delta: { reasoning_content: thought + ' More.' } }] }));
    assert.strictEqual(out.join(''), thought + ' More.');
    take(r.chunk({ choices: [{ delta: { reasoning_content: 'ok' } }] }));
    take(r.chunk({ choices: [{ delta: { reasoning_content: 'ok' } }] }));
    assert.strictEqual(out.join(''), thought + ' More.okok');
    assert.strictEqual(_test.undoubledReasoning(thought + thought), thought);
    assert.strictEqual(_test.undoubledReasoning('abab'), 'abab');
    const m2 = toAnthropicMessage({ choices: [{ message: { reasoning_content: thought + thought, content: 'hi' } }] }, 'm', toolNames([]));
    assert.strictEqual(m2.content[0].thinking, thought);
}
// fix 2: jail env carries MAX_MCP_OUTPUT_TOKENS
assert.ok(/MAX_MCP_OUTPUT_TOKENS: '60000'/.test(require('fs').readFileSync(require('path').join(__dirname, '../modules/cursorDirector.js'), 'utf8')));
console.log('test-tokenrouter-coerce: reasoning + env ok');
