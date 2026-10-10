'use strict';
// Wren standing orders carry the shared Enshutsuka rulebook and modes, not the identity line.
const assert = require('assert');
const { projectPrompt } = require('../modules/cursorDirector')._test;
const { MCP_INSTRUCTIONS, ENSHUTSUKA_MODES, ENSHUTSUKA_GROK_PROJECT_PREAMBLE } = require('../modules/mcpInstructions');
const p = projectPrompt();
assert.ok(p.includes('## Shared Dreamscape rules (from Enshutsuka)'), 'heading');
assert.ok(p.includes(MCP_INSTRUCTIONS), 'full rulebook');
assert.ok(p.includes('V5 Medium is brand new and needs testing'), 'V5 Medium line');
assert.ok(p.includes('"V5 Medium effort testing"'), 'memory name');
assert.ok(typeof ENSHUTSUKA_MODES === 'string' && p.includes(ENSHUTSUKA_MODES), 'modes');
assert.ok(/analyse/.test(p) && /create —/.test(p) && /efficiency —/.test(p), 'modes words');
assert.ok(!p.includes('You are Enshutsuka'), 'no identity line');
assert.ok(!p.includes('This grok.com project is MCP-only'), 'no grok.com project-files rule');
assert.ok(ENSHUTSUKA_GROK_PROJECT_PREAMBLE.includes(ENSHUTSUKA_MODES), 'preamble keeps modes');
console.log('ok director shared rules');
process.exit(0);
