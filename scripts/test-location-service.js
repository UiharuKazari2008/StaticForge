#!/usr/bin/env node
'use strict';
// Location service checks (Yozora #907): node scripts/test-location-service.js
const assert = require('assert');
const os = require('os');
const path = require('path');
process.env.LOCATION_GEO_FILE = path.join(os.tmpdir(), `loc-geo-${process.pid}.json`);
const loc = require('../modules/locationService');

const cfg = { traffic: { home: { address: '123 Main St, Waldorf, MD', lat: 38.62, lon: -76.93 } } };
const gr = {
    getConfig: ({ path: p }) => cfg[p],
    modifyConfig: () => ({ assign: (keys, v) => { cfg[keys[0]] = v; } }),
    getApiKeyManager: () => ({ getServiceKeys: () => [{ apiKey: 'k' }], getSelectedIndex: () => 0 }),
    getWebSocketServer: () => ({ broadcast: () => {} })
};
loc.bind(gr);
let calls = 0;
const GOOGLE = {
    status: 'OK',
    results: [{
        formatted_address: '3000 Crain Hwy, Waldorf, MD 20601, USA',
        types: ['street_address'],
        geometry: { location: { lat: 38.6401234, lng: -76.9123456 } },
        address_components: [
            { long_name: '3000', short_name: '3000', types: ['street_number'] },
            { long_name: 'Crain Highway', short_name: 'Crain Hwy', types: ['route'] },
            { long_name: 'Waldorf', short_name: 'Waldorf', types: ['locality'] },
            { long_name: 'Charles County', short_name: 'Charles County', types: ['administrative_area_level_2'] },
            { long_name: 'Maryland', short_name: 'MD', types: ['administrative_area_level_1'] },
            { long_name: 'United States', short_name: 'US', types: ['country'] },
            { long_name: '20601', short_name: '20601', types: ['postal_code'] }]
    }]
};
loc._test.setFetch(async () => { calls += 1; return { ok: true, json: async () => GOOGLE }; });

(async () => {
    // a typed place as candidates, at its own specificity
    let r = await loc.resolve('3000 crain hwy waldorf');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].specificity, 'exact');
    assert.strictEqual(r[0].label, '3000 Crain Hwy, Waldorf, MD 20601');
    // cut down to the finest asked: city, no street, a rounded point
    r = await loc.resolve('3000 crain hwy waldorf', { max: 'city' });
    assert.strictEqual(r[0].specificity, 'city');
    assert.strictEqual(r[0].label, 'Waldorf, MD');
    assert.ok(!r[0].components.street && !r[0].components.number);
    assert.strictEqual(r[0].lat, 38.64);
    // the second ask came from the cache
    assert.strictEqual(calls, 1, 'one provider call for both');
    r = await loc.resolve('3000 crain hwy waldorf', { max: 'county' });
    assert.strictEqual(r[0].label, 'Charles County, MD');
    // coarser than min is left out
    GOOGLE.results[0].types = ['administrative_area_level_1'];
    r = await loc.resolve('maryland', { min: 'approximate' });
    assert.strictEqual(r.length, 0, 'a state is too coarse for approximate');
    GOOGLE.results[0].types = ['street_address'];
    // reverse: cut to the asked specificity, cached per grid cell
    calls = 0;
    const v1 = await loc.reverse(38.6401, -76.9123, { specificity: 'city' });
    const v2 = await loc.reverse(38.6421, -76.9143, { specificity: 'city' });
    assert.strictEqual(v1.label, 'Waldorf, MD');
    assert.strictEqual(v2.label, 'Waldorf, MD');
    assert.strictEqual(calls, 1, 'one call per city cell');
    // Home / Work: Traffic's stands in until saved here
    let p = loc.getPlaces();
    assert.strictEqual(p.home.from, 'legacy');
    assert.strictEqual(p.work, null);
    // an address-only Traffic place: looked up once, then stands in from the cache
    cfg.traffic.work = { address: '123 Main St, Waldorf, MD' };
    assert.strictEqual(loc.getPlaces().work, null, 'not known until looked up');
    await new Promise((r) => setTimeout(r, 20));
    p = loc.getPlaces();
    assert.ok(p.work && p.work.from === 'legacy' && Number.isFinite(p.work.lat), 'address-only work stands in after the lookup');
    delete cfg.traffic.work;
    p = await loc.savePlaces({ work: { label: 'Office', lat: 38.9, lon: -77.03, specificity: 'exact' } });
    assert.strictEqual(p.work.label, 'Office');
    assert.ok(!p.work.from);
    assert.strictEqual(p.home.from, 'legacy');
    console.log('location service: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
