'use strict';
// mcp.rateLimits: group defaults, per-key overrides by app name or key id, built-in defaults for Yukimi's agents.
const assert = require('assert');
const { rateLimitSpec, consumeRateGroup, resetRateGroupHits, MCP_RATE_GROUP_LIMITS } = require('../modules/mcpRateLimiter');

const outside = { applicationKeyId: 'k-outside', appName: 'Someone' };
const claude = { applicationKeyId: 'k-claude', appName: 'claude-code-test' };
const wren = { applicationKeyId: 'k-wren', appName: 'DreamscapeDirector' };

assert.strictEqual(rateLimitSpec('generate', outside, {}).max, MCP_RATE_GROUP_LIMITS.generate.max);
assert.strictEqual(rateLimitSpec('generate', claude, {}).max, 120);
assert.strictEqual(rateLimitSpec('generate', wren, {}).max, 120);
assert.strictEqual(rateLimitSpec('studio', claude, {}).max, MCP_RATE_GROUP_LIMITS.studio.max, 'other groups keep their default');

const cfg = {
    groups: { generate: { max: 40 } },
    keys: { 'k-outside': { generate: { max: 5, windowMs: 60000 } }, 'claude-code-test': { generate: { max: 0 } } }
};
assert.strictEqual(rateLimitSpec('generate', { applicationKeyId: 'k-other', appName: 'Other' }, cfg).max, 40);
const out = rateLimitSpec('generate', outside, cfg);
assert.strictEqual(out.max, 5);
assert.strictEqual(out.windowMs, 60000);
assert.strictEqual(rateLimitSpec('generate', claude, cfg).max, 0, 'config beats the built-in default');
assert.strictEqual(rateLimitSpec('generate', wren, cfg).max, 120);
assert.strictEqual(rateLimitSpec('generate', outside, { keys: { 'k-outside': { generate: { max: 'lots' } } } }).max, MCP_RATE_GROUP_LIMITS.generate.max, 'junk is ignored');

resetRateGroupHits();
const spec = rateLimitSpec('generate', outside, cfg);
for (let i = 0; i < 5; i++) assert.ok(consumeRateGroup('mcp-key:k-outside', 'generate', 1000, spec).ok);
assert.strictEqual(consumeRateGroup('mcp-key:k-outside', 'generate', 1000, spec).ok, false);
assert.ok(consumeRateGroup('mcp-key:k-outside', 'generate', 1000 + 60001, spec).ok, 'window from the override');
assert.ok(consumeRateGroup('mcp-key:k-claude', 'generate', 1000, rateLimitSpec('generate', claude, cfg)).unlimited);
console.log('test-mcp-rate-limits: ok');
