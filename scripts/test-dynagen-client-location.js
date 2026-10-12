'use strict';
// location=CLIENT from a LAN/loopback client must fall back to configured
// coordinates so weather resolves on every model (Director V5 report).
const assert = require('assert');
const dg = require('../modules/dynamicGenerationHandlers');
assert.strictEqual(dg.isPrivateOrLocalIP('192.168.100.8'), true);
assert.strictEqual(dg.isPrivateOrLocalIP('::ffff:10.0.0.4'), true);
assert.strictEqual(dg.isPrivateOrLocalIP('127.0.0.1'), true);
assert.strictEqual(dg.isPrivateOrLocalIP('172.20.1.1'), true);
assert.strictEqual(dg.isPrivateOrLocalIP(null), true);
assert.strictEqual(dg.isPrivateOrLocalIP('8.8.8.8'), false);
assert.strictEqual(dg.isPrivateOrLocalIP('172.32.0.1'), false);
const gr = { getSecureConfig: ({ path }) => (path === 'location' ? { latitude: 38.5845, longitude: -76.8941 } : null), getConfig: () => null, getWeatherCache: (() => { const m = new Map(); return () => m; })(), getLogger: () => new Proxy({}, { get: () => () => {} }) };
async function main() {
    const resolved = await dg.resolveDynamicContext(gr, { tod: true, weather: true, season: true, location: 'CLIENT' }, '192.168.100.8');
    assert.ok(resolved.location, 'location resolved');
    assert.strictEqual(resolved.location.latitude, 38.5845);
    if (process.env.DG_LIVE_WEATHER === '1') assert.ok(resolved.weather && resolved.weather.condition, 'weather resolved');
    assert.ok(resolved.time && resolved.season);
    console.log('test-dynagen-client-location: ok', JSON.stringify({ weather: resolved.weather, loc: resolved.location }));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
