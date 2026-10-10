#!/usr/bin/env node
// Wren and every MCP client must compile requests into absolute tags, never relative wording.
'use strict';
const assert = require('assert');
const { MCP_INSTRUCTIONS } = require('../modules/mcpInstructions');
const wren = require("../modules/cursorDirector")._test.projectPrompt();
for (const s of [MCP_INSTRUCTIONS, wren]) {
  assert.ok(s.includes('Absolute prompts only'), 'rule present');
  assert.ok(s.includes('three times larger') && s.includes('same as last') && s.includes('bigger than before'), 'relative phrases named');
  assert.ok(s.includes('Bad: 2::belly three times larger::') && s.includes('Good: 1.6::huge belly'), 'bad-to-good example');
}
console.log('PASS absolute-prompt rule reaches MCP instructions and Wren projectPrompt');
process.exit(0);
