#!/usr/bin/env node
// Unit test for public/scripts/comp/windowGeometry.js: work-area fractions round-trip across
// resolutions, fixed-size re-centring, maximize/fullscreen remnant detection, legacy entry
// detection, and the viewport re-layout gate.
// Run: node scripts/test-window-geometry.js
const assert = require('assert');
const G = require('../public/scripts/comp/windowGeometry.js');

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

// 1920x1080 desktop with a 32px caption and 35px taskbar
const waBig = { left: 0, top: 32, width: 1920, height: 1013 };
// 1280x720 laptop with no caption
const waSmall = { left: 0, top: 0, width: 1280, height: 685 };

// ---- edges from a rect ----
const rect = { left: 192, top: 134, width: 960, height: 506.5 };
const edges = G.computeWindowEdges(rect, waBig);
near(edges.left, 0.1, 1e-4); near(edges.top, 0.1007, 1e-4); near(edges.right, 0.6, 1e-4); near(edges.bottom, 0.6007, 1e-4);
assert.strictEqual(G.computeWindowEdges({ left: 0, top: 0, width: 0, height: 10 }, waBig), null, 'zero width rejected');
assert.strictEqual(G.computeWindowEdges(rect, { left: 0, top: 0, width: 0, height: 10 }), null, 'bad work area rejected');
const hanging = G.computeWindowEdges({ left: -200, top: 1000, width: 400, height: 300 }, waBig);
assert.ok(hanging.left < 0 && hanging.bottom > 1, 'partial overflow keeps its sign');
const far = G.computeWindowEdges({ left: -9000, top: 0, width: 100, height: 100 }, waBig);
assert.strictEqual(far.left, -1, 'fractions clamp to a sane range');

// ---- round trip on the same work area is exact ----
const back = G.edgesToRect(edges, waBig);
near(back.left, rect.left, 0.2); near(back.top, rect.top, 0.2); near(back.width, rect.width, 0.2); near(back.height, rect.height, 0.2);

// ---- different resolution keeps the relative place and size ----
const small = G.edgesToRect(edges, waSmall);
near(small.left, 0.1 * 1280); near(small.top, edges.top * 685); near(small.width, 0.5 * 1280); near(small.height, (edges.bottom - edges.top) * 685);

// ---- fixed-size windows keep their pixels and sit on the same centre ----
const fixed = G.edgesToRect(edges, waSmall, { fixedSize: { width: 300, height: 200 } });
const c = G.edgesCenter(edges);
near(fixed.width, 300); near(fixed.height, 200);
near(fixed.left + 150, c.x * 1280); near(fixed.top + 100, c.y * 685);
assert.deepStrictEqual(G.edgesToRect(edges, waSmall, { fixedSize: { width: 0, height: 10 } }).width, small.width, 'invalid fixed size falls back to scaling');

// ---- remnant detection ----
assert.strictEqual(G.isRemnantGeometry(edges), false);
const maximizedLike = G.computeWindowEdges({ left: 0, top: 29, width: 1920, height: 1016 }, waBig);
assert.strictEqual(G.isRemnantGeometry(maximizedLike), true, 'a maximized rect is a remnant');
const tallOnly = G.computeWindowEdges({ left: 0, top: 32, width: 900, height: 1013 }, waBig);
assert.strictEqual(G.isRemnantGeometry(tallOnly), false, 'full height alone is a legitimate window');
assert.strictEqual(G.isRemnantGeometry(maximizedLike, 1.01), false, 'threshold is configurable');

// ---- entry detection ----
assert.strictEqual(G.isEdgesEntry({ edges }), true);
assert.strictEqual(G.isEdgesEntry({ topLeft: { index: 1, x: 0.5, y: 0.5 } }), false, 'legacy quadrant entry');
assert.strictEqual(G.isEdgesEntry({ edges: { left: 0.5, top: 0.1, right: 0.4, bottom: 0.9 } }), false, 'inverted edges rejected');
assert.strictEqual(G.isEdgesEntry(null), false);

// ---- viewport gate ----
assert.strictEqual(G.shouldRelayoutViewport({ hidden: false, innerWidth: 1920, innerHeight: 1112, outerWidth: 1936, outerHeight: 1180 }), true);
assert.strictEqual(G.shouldRelayoutViewport({ hidden: true, innerWidth: 1920, innerHeight: 1112 }), false, 'hidden tab');
assert.strictEqual(G.shouldRelayoutViewport({ hidden: false, innerWidth: 1920, innerHeight: 1112, outerWidth: 0, outerHeight: 0 }), false, 'minimised browser');
assert.strictEqual(G.shouldRelayoutViewport({ hidden: false, innerWidth: 300, innerHeight: 1112 }), false, 'too narrow');
assert.strictEqual(G.shouldRelayoutViewport({ hidden: false, innerWidth: 1920, innerHeight: 200 }), false, 'too short');
assert.strictEqual(G.shouldRelayoutViewport({ hidden: false, innerWidth: NaN, innerHeight: 1112 }), false);
assert.strictEqual(G.shouldRelayoutViewport(null), false);

console.log('✅ test-window-geometry: all assertions passed');
