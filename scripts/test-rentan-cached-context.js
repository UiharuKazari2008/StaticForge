'use strict';
// A cached Rentan scene inside its expiry, with cache on, reuses its own context: no context
// compile (sun table, weather, clothing, expiry) on every print. Expired, cache off, or a
// refresh request compiles again.
const assert = require('assert');
const handlers = require('../modules/dynamicGenerationHandlers');
let compiles = 0;
handlers.compileContext = async () => {
    compiles++;
    return { time: { hour: 4, minute: 0 }, expirationMetadata: { timePeriod: 'night', weatherCondition: 'clear', hasWeatherPhenomenon: false, cloudCoverage: 0, temperature: 5 } };
};
handlers.calculateDynamicExpiration = () => Date.now() + 60 * 60 * 1000;
const director = require('../modules/cursorDirector');
let turns = 0;
director.rentanRoute = () => ({ server: true, agent: { engine: 'server', model: 'stub' } });
director.runDynagenTurn = async () => {
    turns++;
    return { change: { expanders: [{ prefix: 'dg_time', value: 'night sky, moonlight' }], summary: 'night', applied: { tod: 'night' } }, sessionId: null };
};
const { resolveDynagenWithWren } = require('../modules/dynagenWren');
const gr = { getConfig: () => null, getSecureConfig: () => null, getLogger: () => new Proxy({}, { get: () => () => {} }) };

function body(dg) {
    return { workspace: 'test', prompt: '1girl, standing, !dg_time', text_replacements: [], dynamic_generation: { enabled: true, tod: true, ...dg } };
}

async function main() {
    const first = body({});
    await resolveDynagenWithWren(gr, first, null, null, null, null);
    assert.strictEqual(turns, 1, 'first print resolves');
    assert.strictEqual(compiles, 1, 'first print compiles context');
    const cp = first.dynamic_generation.compiled_prompt;
    assert.ok(cp && cp.wren_input_hash && cp.expiresAt > Date.now(), 'scene stamped');

    const again = body({ compiled_prompt: cp });
    again.prompt = first.prompt;
    again.text_replacements = first.text_replacements;
    await resolveDynagenWithWren(gr, again, null, null, null, null);
    assert.strictEqual(turns, 1, 'valid cache: no Rentan turn');
    assert.strictEqual(compiles, 1, 'valid cache: no context compile');
    assert.strictEqual(again._dynagenContext, cp.context, 'cached context reused');

    const off = body({ compiled_prompt: cp, use_cache_responses: false });
    off.prompt = first.prompt;
    off.text_replacements = first.text_replacements;
    await resolveDynagenWithWren(gr, off, null, null, null, null);
    assert.strictEqual(compiles, 2, 'cache off compiles');
    assert.strictEqual(turns, 2, 'cache off resolves');

    const expired = body({ compiled_prompt: { ...cp, expiresAt: Date.now() - 1 } });
    expired.prompt = first.prompt;
    expired.text_replacements = first.text_replacements;
    await resolveDynagenWithWren(gr, expired, null, null, null, null);
    assert.strictEqual(compiles, 3, 'expired scene compiles a fresh context');
    assert.strictEqual(turns, 2, 'expired but unchanged context keeps the scene');
    console.log('test-rentan-cached-context: ok');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
