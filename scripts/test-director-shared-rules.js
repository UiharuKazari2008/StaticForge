'use strict';
// Wren standing orders carry the shared Enshutsuka rulebook and modes, not the identity line.
const assert = require('assert');
const { projectPrompt, claudeProjectPrompt, wrenRules, WREN_COVERED_SENTENCES } = require('../modules/cursorDirector')._test;
const { MCP_INSTRUCTIONS, ENSHUTSUKA_MODES, ENSHUTSUKA_GROK_PROJECT_PREAMBLE } = require('../modules/mcpInstructions');
const p = projectPrompt();
assert.ok(p.includes('## Shared Dreamscape rules (from Enshutsuka)'), 'heading');
// The rulebook minus the sentences wrenRules() already says (#433).
const shared = p.slice(p.indexOf('## Shared Dreamscape rules'));
WREN_COVERED_SENTENCES.forEach((sentence) => {
    assert.ok(MCP_INSTRUCTIONS.includes(`${sentence} `), `covered sentence still in MCP_INSTRUCTIONS (update the list): ${sentence.slice(0, 60)}`);
    assert.ok(!shared.includes(sentence), `covered sentence stripped: ${sentence.slice(0, 60)}`);
});
const sentences = MCP_INSTRUCTIONS.split(/(?<=\.) (?=[A-Za-z])/);
sentences.filter((sentence) => !WREN_COVERED_SENTENCES.includes(sentence)).forEach((sentence) => {
    assert.ok(shared.includes(sentence), `kept sentence: ${sentence.slice(0, 60)}`);
});
['lookup_character_age {character} is the sole validated character database', 'Do not trust Wikipedia, Fandom', 'Absolute prompts only', 'Do not send preciseReferences back on apply']
    .forEach((line) => assert.ok(p.includes(line), `kept: ${line}`));
// Claude CLI cuts MCP initialize instructions at 2048 characters: its rule file carries the rulebook too.
assert.strictEqual(claudeProjectPrompt(), p, 'Claude engines get the same rule file');
assert.ok(p.length < wrenRules().length + MCP_INSTRUCTIONS.length, 'smaller than both in full');
assert.ok(p.includes('V5 Medium is brand new and needs testing'), 'V5 Medium line');
assert.ok(p.includes('"V5 Medium effort testing"'), 'memory name');
assert.ok(p.includes('delete_memory {name}'), 'delete_memory is a known tool');
assert.ok(p.includes('list_memories {limit, offset}'), 'list_memories is a known tool');
assert.ok(typeof ENSHUTSUKA_MODES === 'string' && p.includes(ENSHUTSUKA_MODES), 'modes');
assert.ok(/analyse/.test(p) && /create —/.test(p) && /efficiency —/.test(p), 'modes words');
assert.ok(!p.includes('You are Enshutsuka'), 'no identity line');
assert.ok(!p.includes('This grok.com project is MCP-only'), 'no grok.com project-files rule');
assert.ok(ENSHUTSUKA_GROK_PROJECT_PREAMBLE.includes(ENSHUTSUKA_MODES), 'preamble keeps modes');
console.log('ok director shared rules');
process.exit(0);
