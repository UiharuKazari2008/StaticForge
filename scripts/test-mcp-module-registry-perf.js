'use strict';
/**
 * Identity + timing for getEffectiveToolsForScopes Set optimization.
 * Compares the pre-Set algorithm (inline) against the live implementation.
 * Credit: grok.menma
 */
const assert = require('assert');
const {
    MODULE_DEFS,
    TOOL_TO_MODULES,
    scopesContainModule,
    parseModuleScopesFromScopes,
    getEffectiveToolsForScopes
} = require('../modules/mcpModuleRegistry');

/** Pre-optimization algorithm (must stay byte-logic identical to the old body). */
function getEffectiveToolsForScopesOld(scopes, allTools) {
    if (!Array.isArray(scopes)) return [];
    if (scopes.includes('universal')) return allTools.slice();

    const { submodules } = parseModuleScopesFromScopes(scopes);
    const allowed = new Set();

    for (const toolName of allTools) {
        const toolModules = TOOL_TO_MODULES[toolName];
        if (!toolModules || !toolModules.length) {
            allowed.add(toolName);
            continue;
        }
        for (const moduleId of toolModules) {
            const def = MODULE_DEFS[moduleId];
            if (!def) continue;
            if (!scopesContainModule(scopes, def.scope)) continue;
            if (submodules.has(moduleId)) {
                const requestedSubs = submodules.get(moduleId);
                const subToolsAllowed = requestedSubs.some((sub) => {
                    const subTools = def.submodules && def.submodules[sub];
                    return subTools && subTools.includes(toolName);
                });
                if (subToolsAllowed) allowed.add(toolName);
            } else {
                allowed.add(toolName);
            }
        }
    }
    return Array.from(allowed);
}

const allTools = Object.keys(TOOL_TO_MODULES);
// Plus a few non-module-controlled names (should always pass through when not universal-gated)
const extendedTools = allTools.concat(['not_a_module_tool_xyz', 'another_free_tool']);

const scopeCombos = [
    null,
    undefined,
    'not-an-array',
    [],
    ['universal'],
    ['universal', 'sfapp_dovecote'],
    ['gallery'],
    ['gallery', 'notes', 'wiki'],
    ['sfapp_dovecote'],
    ['sfapp_dovecote:read'],
    ['sfapp_dovecote:notify'],
    ['sfapp_dovecote', 'sfapp_dovecote:read'],
    ['SFAPP_DOVECOTE'], // case: must NOT match sfapp_dovecote
    ['sfapp_cake_pantry'],
    ['sfapp_cake_pantry:deliver'],
    ['generation', 'sfapp_cake_pantry:deliver', 42, null, '', 'wiki:ignored'],
    // many scopes to stress the linear scan vs Set
    Array.from({ length: 200 }, (_, i) => `noise_scope_${i}`).concat(['sfapp_dovecote:read', 'gallery']),
];

function sorted(arr) {
    return arr.slice().sort();
}

let compared = 0;
for (const scopes of scopeCombos) {
    const oldR = getEffectiveToolsForScopesOld(scopes, extendedTools);
    const newR = getEffectiveToolsForScopes(scopes, extendedTools);
    assert.deepStrictEqual(
        sorted(newR),
        sorted(oldR),
        `mismatch for scopes=${JSON.stringify(scopes)}`
    );
    compared++;
}

// scopesContainModule itself unchanged (exported API)
assert.strictEqual(scopesContainModule(['sfapp_dovecote:read'], 'sfapp_dovecote'), true);
assert.strictEqual(scopesContainModule(['sfapp_dovecote'], 'sfapp_dovecote'), true);
assert.strictEqual(scopesContainModule(['SFAPP_DOVECOTE'], 'sfapp_dovecote'), false);
assert.strictEqual(scopesContainModule(['other'], 'sfapp_dovecote'), false);
assert.strictEqual(scopesContainModule(null, 'sfapp_dovecote'), false);
assert.strictEqual(scopesContainModule(['x', 1, 'sfapp_dovecote:z'], 'sfapp_dovecote'), true);

// Timing: large scopes × all tools, many repeats
const fatScopes = Array.from({ length: 500 }, (_, i) => `noise_${i}`).concat([
    'sfapp_dovecote:read',
    'gallery',
    'notes',
    'sfapp_cake_pantry:deliver'
]);
const rounds = 40;
let t0 = process.hrtime.bigint();
for (let i = 0; i < rounds; i++) getEffectiveToolsForScopesOld(fatScopes, extendedTools);
const oldMs = Number(process.hrtime.bigint() - t0) / 1e6;
t0 = process.hrtime.bigint();
for (let i = 0; i < rounds; i++) getEffectiveToolsForScopes(fatScopes, extendedTools);
const newMs = Number(process.hrtime.bigint() - t0) / 1e6;

console.log(`Compared ${compared} scope combos: identity OK`);
console.log(`Timing over ${rounds} rounds × ${extendedTools.length} tools × ${fatScopes.length} scopes:`);
console.log(`  old (scopesContainModule scan): ${oldMs.toFixed(2)} ms`);
console.log(`  new (Set once):                 ${newMs.toFixed(2)} ms`);
assert.ok(newMs <= oldMs * 1.5 || newMs < 50, `new should not be much slower (old=${oldMs}, new=${newMs})`);
console.log('PASS: test-mcp-module-registry-perf');
