#!/usr/bin/env node
/**
 * Smoke tests for modules/nekoEnumResolve.js
 * Run: node scripts/test-neko-enum-resolve.js
 */
'use strict';

const assert = require('assert');
const { resolveNekoEnumValue } = require('../modules/nekoEnumResolve');

// NekoAI-JS src/constants.ts string enums (no reverse map)
const Sampler = {
    EULER: 'k_euler',
    EULER_ANC: 'k_euler_ancestral',
    DPM2S_ANC: 'k_dpmpp_2s_ancestral',
    DPM2M: 'k_dpmpp_2m',
    DPMSDE: 'k_dpmpp_sde',
    DPM2MSDE: 'k_dpmpp_2m_sde',
    DDIM: 'ddim_v3'
};

const Noise = {
    NATIVE: 'native',
    KARRAS: 'karras',
    EXPONENTIAL: 'exponential',
    POLYEXPONENTIAL: 'polyexponential'
};

assert.strictEqual(
    Sampler['k_dpmpp_2s_ancestral'.toUpperCase()],
    undefined,
    'old toUpperCase key lookup must miss MCP meta'
);

assert.strictEqual(
    resolveNekoEnumValue(Sampler, 'k_dpmpp_2s_ancestral', Sampler.EULER_ANC, 'sampler'),
    Sampler.DPM2S_ANC,
    'MCP meta k_dpmpp_2s_ancestral → Sampler.DPM2S_ANC value'
);
assert.strictEqual(
    resolveNekoEnumValue(Sampler, 'k_dpmpp_2s_ancestral', Sampler.EULER_ANC, 'sampler'),
    'k_dpmpp_2s_ancestral'
);
assert.notStrictEqual(
    resolveNekoEnumValue(Sampler, 'k_dpmpp_2s_ancestral', Sampler.EULER_ANC, 'sampler'),
    Sampler.EULER
);
assert.notStrictEqual(
    resolveNekoEnumValue(Sampler, 'k_dpmpp_2s_ancestral', Sampler.EULER_ANC, 'sampler'),
    Sampler.EULER_ANC
);

assert.strictEqual(
    resolveNekoEnumValue(Sampler, 'DPM2S_ANC', Sampler.EULER_ANC, 'sampler'),
    Sampler.DPM2S_ANC,
    'Studio request key DPM2S_ANC'
);
assert.strictEqual(
    resolveNekoEnumValue(Sampler, 'dpm2s_anc', Sampler.EULER_ANC, 'sampler'),
    Sampler.DPM2S_ANC,
    'case-insensitive enum key'
);
assert.strictEqual(
    resolveNekoEnumValue(Sampler, 'K_DPMPP_2S_ANCESTRAL', Sampler.EULER_ANC, 'sampler'),
    Sampler.DPM2S_ANC,
    'uppercased meta still matches enum value'
);

['k_euler', 'k_euler_ancestral', 'k_dpmpp_sde', 'k_dpmpp_2m', 'k_dpmpp_2m_sde', 'ddim_v3'].forEach((meta) => {
    const resolved = resolveNekoEnumValue(Sampler, meta, Sampler.EULER_ANC, 'sampler');
    assert.strictEqual(resolved, meta, `meta ${meta} resolves to itself`);
    assert.ok(Object.values(Sampler).includes(resolved));
});

assert.strictEqual(
    resolveNekoEnumValue(Sampler, undefined, Sampler.EULER_ANC, 'sampler'),
    Sampler.EULER_ANC
);
assert.strictEqual(
    resolveNekoEnumValue(Sampler, '', Sampler.EULER_ANC, 'sampler'),
    Sampler.EULER_ANC
);

assert.throws(
    () => resolveNekoEnumValue(Sampler, 'not_a_sampler', Sampler.EULER_ANC, 'sampler'),
    /Unknown sampler: not_a_sampler/
);

assert.strictEqual(
    Noise['karras'.toUpperCase()],
    Noise.KARRAS,
    'Noise meta karras happens to match KARRAS key'
);
assert.strictEqual(
    resolveNekoEnumValue(Noise, 'karras', Noise.KARRAS, 'noise_schedule'),
    Noise.KARRAS
);
assert.strictEqual(
    resolveNekoEnumValue(Noise, 'KARRAS', Noise.KARRAS, 'noise_schedule'),
    'karras'
);
assert.strictEqual(
    resolveNekoEnumValue(Noise, 'polyexponential', Noise.KARRAS, 'noise_schedule'),
    Noise.POLYEXPONENTIAL
);
assert.strictEqual(
    resolveNekoEnumValue(Noise, undefined, Noise.KARRAS, 'noise_schedule'),
    Noise.KARRAS
);
assert.throws(
    () => resolveNekoEnumValue(Noise, 'linear', Noise.KARRAS, 'noise_schedule'),
    /Unknown noise_schedule: linear/
);

console.log('ok: nekoEnumResolve sampler/noise');
