'use strict';
// Wren Claude engine: model resolve, stream-json rows, tool names, jail binds.
const assert = require('assert');
const d = require('../modules/cursorDirector')._test;

assert.strictEqual(d.sanitizeEngine('Claude'), 'claude');
assert.strictEqual(d.sanitizeEngine('bogus'), 'cursor');

const NEW = [2, 1, 300];
const OLD = [2, 1, 197];
assert.deepStrictEqual(d.resolveClaudeRun({ model: 'claude-opus-5-5', effort: 'high', fast: true }, NEW),
    { model: 'claude-opus-5-5', effort: 'high', fast: true });
assert.deepStrictEqual(d.resolveClaudeRun({ model: 'claude-sonnet-5-5', effort: 'none', fast: true }, NEW),
    { model: 'claude-sonnet-5-5', effort: 'medium', fast: false });
assert.deepStrictEqual(d.resolveClaudeRun({ model: 'claude-haiku-5-5', effort: 'max' }, NEW),
    { model: 'claude-haiku-5-5', effort: null, fast: false });
assert.strictEqual(d.resolveClaudeRun({ model: 'grok-4.7' }, NEW).model, 'claude-opus-5-5');

// An older CLI cannot run the 5.5 / 5.1 ids: they drop out and Opus 5 is the default.
assert.strictEqual(d.resolveClaudeRun({ model: 'claude-opus-5-5' }, OLD).model, 'claude-opus-5');
const oldCatalog = d.publicClaudeCatalog(OLD);
assert.ok(!oldCatalog.some((m) => m.id.endsWith('-5-5') || m.id === 'claude-fable-5-1'));
assert.strictEqual(oldCatalog.find((m) => m.default).id, 'claude-opus-5');
assert.strictEqual(d.publicClaudeCatalog(NEW).find((m) => m.default).id, 'claude-opus-5-5');

const catalog = d.publicClaudeCatalog(NEW);
assert.ok(catalog.length >= 4 && catalog.every((m) => m.provider === 'Anthropic'));
const opus = catalog.find((m) => m.id === 'claude-opus-5-5');
assert.ok(opus.efforts.every((e) => e.fast === true));
assert.ok(catalog.find((m) => m.id === 'claude-sonnet-5-5').efforts.every((e) => e.fast === false));

assert.strictEqual(d.claudeToolName('mcp__dreamscape__apply_studio_changes'), 'apply_studio_changes');
assert.strictEqual(d.claudeToolName('Bash'), 'Shell');
assert.strictEqual(d.claudeToolName('Read'), 'Read');

const state = { rows: [] };
const line = (o) => d.consumeClaudeStreamLine(JSON.stringify(o), state);
line({ type: 'system', subtype: 'init', session_id: 'abc' });
line({ type: 'assistant', message: { usage: { input_tokens: 1000 }, content: [
    { type: 'thinking', thinking: 'plan' },
    { type: 'tool_use', id: 't1', name: 'mcp__dreamscape__apply_studio_changes', input: { prompt: '1girl' } },
    { type: 'tool_use', id: 't2', name: 'mcp__dreamscape__apply_studio_changes', input: { uc: 'bad' } }
] } });
line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'ok2' }] }] } });
line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok1', is_error: true }] } });
line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
line({ type: 'result', is_error: false, result: 'Done.', session_id: 'abc' });
assert.strictEqual(state.claudeSessionId, 'abc');
const tools = state.rows.filter((r) => r.type === 'tool');
assert.strictEqual(tools.length, 2);
assert.strictEqual(tools[0].name, 'apply_studio_changes');
assert.ok(tools[0].replay && tools[0].replay.prompt === '1girl');
assert.strictEqual(tools[0].result, 'Error: ok1');
assert.strictEqual(tools[1].result, 'ok2');
assert.ok(tools.every((r) => r._closed));
assert.strictEqual(state.rows[0].type, 'thinking');
assert.strictEqual(state.rows.filter((r) => r.type === 'assistant').length, 1);
assert.strictEqual(state.text, 'Done.');
assert.ok(state.finished && !state.error && state.context);

const failed = { rows: [] };
d.consumeClaudeStreamLine(JSON.stringify({ type: 'result', is_error: true, result: 'usage limit' }), failed);
assert.strictEqual(failed.error, 'usage limit');

assert.strictEqual(d.chatAgentSession({ cursorId: 'c', claudeSessionId: 'k', inflight: { engine: 'claude' } }), 'k');
assert.strictEqual(d.chatAgentSession({ cursorId: 'c', claudeSessionId: 'k', inflight: {} }), 'c');

if (require('../modules/cursorDirector').findClaude()) {
    const jail = { bin: 'bwrap', args: ['--bind', 'a', 'b', '--chdir', '/workspace', '--clearenv'], agent: '/opt/cursor-agent/x', root: '/r' };
    try {
        const cj = d.claudeJail(jail);
        const at = cj.args.indexOf('--chdir');
        assert.ok(cj.args.indexOf('/opt/claude-code') > 0 && cj.args.indexOf('/opt/claude-code') < at);
        assert.ok(cj.args.includes('/opt/claude-auth/token'));
        assert.ok(cj.claude.startsWith('/opt/claude-code/'));
        assert.strictEqual(jail.args.length, 6, 'cursor jail args untouched');
    } catch (err) {
        if (err.code !== 'CLAUDE_TOKEN_MISSING') throw err;
    }
}
console.log('wren claude engine: ok');
