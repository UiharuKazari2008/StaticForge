#!/usr/bin/env node
// Pure ring geometry of the planet switcher (public/scripts/comp/planetSwitcher.js).
// Run: node scripts/test-planet-switcher-ring.js
const assert = require('assert');
const { PlanetRingMath, PLANET_SWITCHER_TIMING } = require('../public/scripts/comp/planetSwitcher.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
}

test('timings match the spec', () => {
    assert.strictEqual(PLANET_SWITCHER_TIMING.holderIn, 4500);
    assert.strictEqual(PLANET_SWITCHER_TIMING.windowsScale, 2500);
    assert.strictEqual(PLANET_SWITCHER_TIMING.windowsFade, 2000);
    assert.strictEqual(PLANET_SWITCHER_TIMING.desktopScale, 3000);
    assert.strictEqual(PLANET_SWITCHER_TIMING.desktopFade, 2950);
    assert.strictEqual(PLANET_SWITCHER_TIMING.starsIn, 2000);
    assert.strictEqual(PLANET_SWITCHER_TIMING.zoomIn, 1500);
    assert.strictEqual(PLANET_SWITCHER_TIMING.reveal, 1500);
});

test('few planets form an arc, many form a full ring', () => {
    assert.strictEqual(PlanetRingMath.step(1), 0);
    assert.strictEqual(PlanetRingMath.isFullRing(1), false);
    assert.strictEqual(PlanetRingMath.isFullRing(2), false);
    assert.ok(near(PlanetRingMath.step(2), PlanetRingMath.MAX_STEP));
    assert.strictEqual(PlanetRingMath.isFullRing(5), false);
    assert.strictEqual(PlanetRingMath.isFullRing(6), true);
    assert.ok(near(PlanetRingMath.step(8), PlanetRingMath.TAU / 8));
});

test('two planets never sit on top of each other', () => {
    const a = PlanetRingMath.place(0, 2, PlanetRingMath.angleFor(0, 2), 400, 60);
    const b = PlanetRingMath.place(1, 2, PlanetRingMath.angleFor(0, 2), 400, 60);
    assert.ok(Math.abs(a.x - b.x) > 300, `expected spread, got ${a.x} vs ${b.x}`);
    assert.ok(b.depth > -0.5, 'second planet stays visible in front of the camera');
});

test('the selected index lands at the front, centred', () => {
    for (const count of [1, 2, 3, 5, 6, 9, 14]) {
        for (let k = 0; k < count; k++) {
            const angle = PlanetRingMath.angleFor(k, count);
            const pos = PlanetRingMath.place(k, count, angle, 500, 60);
            assert.ok(near(pos.x, 0, 1e-6), `count ${count} index ${k} x=${pos.x}`);
            assert.ok(near(pos.y, 0, 1e-6), `count ${count} index ${k} y=${pos.y}`);
            assert.ok(near(pos.scale, 1, 1e-6));
            assert.ok(near(pos.opacity, 1, 1e-6));
            assert.strictEqual(pos.z, 200);
        }
    }
});

test('neighbours sit left and right of the front planet', () => {
    const count = 8;
    const angle = PlanetRingMath.angleFor(3, count);
    const left = PlanetRingMath.place(2, count, angle, 500, 60);
    const right = PlanetRingMath.place(4, count, angle, 500, 60);
    assert.ok(left.x < -100 && right.x > 100);
    assert.ok(near(left.x, -right.x, 1e-6));
    assert.ok(left.scale < 1 && left.scale > 0.42);
});

test('navigation wraps on a full ring and clamps on an arc', () => {
    assert.strictEqual(PlanetRingMath.nextIndex(7, 1, 8), 0);
    assert.strictEqual(PlanetRingMath.nextIndex(0, -1, 8), 7);
    assert.strictEqual(PlanetRingMath.nextIndex(2, 1, 3), 2);
    assert.strictEqual(PlanetRingMath.nextIndex(0, -1, 3), 0);
    assert.strictEqual(PlanetRingMath.nextIndex(0, 1, 1), 0);
});

test('full ring rotation takes the short way round', () => {
    const count = 10;
    const from = PlanetRingMath.angleFor(0, count);
    const to = PlanetRingMath.angleFor(9, count);
    const d = PlanetRingMath.delta(from, to, count);
    assert.ok(near(d, PlanetRingMath.step(count)), `expected one step back, got ${d}`);
    const arcFrom = PlanetRingMath.angleFor(0, 3);
    const arcTo = PlanetRingMath.angleFor(2, 3);
    assert.ok(near(PlanetRingMath.delta(arcFrom, arcTo, 3), arcTo - arcFrom));
});

test('ease in/out is monotonic and hits its ends', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
        const v = PlanetRingMath.easeInOut(i / 20);
        assert.ok(v >= prev);
        prev = v;
    }
    assert.strictEqual(PlanetRingMath.easeInOut(0), 0);
    assert.strictEqual(PlanetRingMath.easeInOut(1), 1);
});

console.log(`\n${passed} planet switcher ring tests passed`);
