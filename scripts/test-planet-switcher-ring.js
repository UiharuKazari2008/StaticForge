#!/usr/bin/env node
// Pure ring geometry of the planet switcher (public/scripts/comp/planetSwitcher.js).
// Run: node scripts/test-planet-switcher-ring.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PlanetRingMath, PLANET_SWITCHER_TIMING, PLANET_SWITCHER_BGM } = require('../public/scripts/comp/planetSwitcher.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
}

test('bgm is a quiet looping opus under SFX', () => {
    assert.strictEqual(PLANET_SWITCHER_BGM.url, '/sounds/planet/innerlight.opus');
    assert.ok(PLANET_SWITCHER_BGM.gain > 0 && PLANET_SWITCHER_BGM.gain < 0.7);
    assert.ok(PLANET_SWITCHER_BGM.gainActive > PLANET_SWITCHER_BGM.gain);
    assert.ok(!('fadeIn' in PLANET_SWITCHER_BGM));
    assert.ok(
        PLANET_SWITCHER_BGM.fadeTravel > PLANET_SWITCHER_TIMING.zoomIn + PLANET_SWITCHER_TIMING.reveal,
        'travel fade outlasts the zoom + reveal'
    );
    const server = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
    assert.ok(server.includes("itemRel === 'sounds/vista'"), 'Vista WAVs stay out of the SW scan');
    assert.ok(!server.includes("itemRel === 'sounds' || itemRel.startsWith('sounds/')"), 'planet BGM is scanned');
});

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

test('the selected index lands at the front, centred and lowest on the tilted ring', () => {
    for (const count of [1, 2, 3, 5, 6, 9, 14]) {
        for (let k = 0; k < count; k++) {
            const angle = PlanetRingMath.angleFor(k, count);
            const pos = PlanetRingMath.place(k, count, angle, 500, 60);
            assert.ok(near(pos.x, 0, 1e-6), `count ${count} index ${k} x=${pos.x}`);
            assert.ok(near(pos.y, 60, 1e-6), `count ${count} index ${k} y=${pos.y}`);
            assert.ok(near(pos.scale, 1, 1e-6));
            assert.ok(near(pos.opacity, 1, 1e-6));
            assert.strictEqual(pos.z, 200);
        }
    }
});

test('neighbours sit left and right of the front planet, the back row sits higher and smaller', () => {
    const count = 8;
    const angle = PlanetRingMath.angleFor(3, count);
    const left = PlanetRingMath.place(2, count, angle, 500, 60);
    const right = PlanetRingMath.place(4, count, angle, 500, 60);
    const back = PlanetRingMath.place(7, count, angle, 500, 60);
    assert.ok(left.x < -100 && right.x > 100);
    assert.ok(near(left.x, -right.x, 1e-6));
    assert.ok(left.scale < 1 && left.scale > PlanetRingMath.MIN_SCALE);
    assert.ok(near(back.y, -60, 1e-6), 'back planet at the top of the ellipse');
    assert.ok(near(back.scale, PlanetRingMath.MIN_SCALE, 1e-6));
    assert.ok(back.opacity >= PlanetRingMath.MIN_OPACITY && back.z < 100);
});

test('the ring widens with the planet count and shrinks planets only past the viewport cap', () => {
    const few = PlanetRingMath.radii(3, 180, 900);
    const many = PlanetRingMath.radii(12, 180, 900);
    const tooMany = PlanetRingMath.radii(40, 180, 900);
    assert.ok(many.radiusX > few.radiusX, 'wider ring for more planets');
    assert.strictEqual(few.sizeScale, 1);
    assert.strictEqual(many.sizeScale, 1);
    assert.strictEqual(tooMany.radiusX, 900, 'capped at the viewport');
    assert.ok(tooMany.sizeScale < 1 && tooMany.sizeScale >= 0.55);
    assert.ok(near(many.radiusY, many.radiusX * 0.32, 1e-9), 'tilted ellipse');
    // neighbours of the front planet keep clear water between them
    const pos = PlanetRingMath.place(1, 12, PlanetRingMath.angleFor(0, 12), many.radiusX, many.radiusY);
    assert.ok(pos.x - (pos.scale * 180) / 2 > 90 + 10, `gap ${pos.x - (pos.scale * 180) / 2 - 90}`);
});

test('slides alternate favourites and recent, unique by url', () => {
    const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05];
    let n = 0;
    const random = () => seq[n++ % seq.length];
    const recent = [{ url: 'r1' }, { url: 'r2' }, { url: 'r3' }, { url: 'r4' }];
    const favorites = [{ url: 'f1' }, { url: 'f2' }, { url: 'f3' }];
    const mixed = PlanetRingMath.mixSlides(recent, favorites, 12, random);
    const urls = mixed.map((s) => s.url);
    assert.strictEqual(urls.length, 7);
    assert.ok(urls[0].startsWith('f'), 'starts with a favourite');
    for (let i = 1; i < 6; i++) assert.notStrictEqual(urls[i][0], urls[i - 1][0], `alternates at ${i}: ${urls.join(',')}`);
    assert.strictEqual(urls[6][0], 'r', 'leftover recent at the end');
    const deduped = PlanetRingMath.mixSlides([{ url: 'shared' }, { url: 'r1' }], [{ url: 'shared' }], 12, random).map((s) => s.url);
    assert.strictEqual(new Set(deduped).size, deduped.length, 'no duplicates');
    assert.strictEqual(deduped.length, 2);
    assert.strictEqual(PlanetRingMath.mixSlides([{ url: 'a' }, { url: 'b' }], [], 1).length, 1);
    assert.deepStrictEqual(PlanetRingMath.mixSlides([], [], 5), []);
    // same generation batch (same trailing seed) counts as one picture
    const batch = [{ url: '/previews/1_generated_1889546393.webp' }, { url: '/previews/2_generated_1889546393.webp' }, { url: '/previews/3_generated_71550537.webp' }];
    assert.strictEqual(PlanetRingMath.mixSlides(batch, [], 12).length, 2);
    assert.deepStrictEqual(PlanetRingMath.spread([1, 2, 3, 4, 5, 6, 7, 8], 4), [1, 3, 5, 7]);
    assert.deepStrictEqual(PlanetRingMath.spread([1, 2], 4), [1, 2]);
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
