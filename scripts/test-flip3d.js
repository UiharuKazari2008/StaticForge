#!/usr/bin/env node
// Windows Flip 3D (public/scripts/comp/flip3d.js): the stack against the Vista VM capture, the
// slot cycling and the no-WebGL fallback; and the window pictures it shares with the taskbar
// previews (windowCapture.js): the CSS rule index's selector handling.
// Run: node scripts/test-flip3d.js
'use strict';

const assert = require('assert');

global.window = global;
require('../public/scripts/comp/windowCapture.js');
require('../public/scripts/comp/flip3d.js');
const f = global.flip3d;
const T = f._test;
const C = global.windowCapture._test;

// ---- the stack: the VM's Flip 3D at 1920x1200 (2026-10-22 capture, ~/.cache/vista-vm/flip3d) ----
// the front window (Computer, 900x600) and the fourth and fifth (Bing 1000x700, Garden 1463x934),
// corners read off the screenshot; the fitted camera must land within ~25 px of each
const cam = T.camera(1920, 1200);
const shot = (slot, w, h) => T.corners(T.slotPose(cam, slot), w, h).map((p) => T.project(cam, p).map(Math.round));
const near = (got, want, label) => {
    const d = Math.hypot(got[0] - want[0], got[1] - want[1]);
    assert.ok(d < 25, `${label}: ${got} vs the VM's ${want} (${d.toFixed(1)} px off)`);
};
let c = shot(0, 900, 600);
near(c[0], [962, 667], 'front top-left');
near(c[1], [1426, 638], 'front top-right');
near(c[2], [970, 1028], 'front bottom-left');
near(c[3], [1427, 960], 'front bottom-right');
c = shot(3, 1000, 700);
near(c[0], [505, 380], 'slot 3 top-left');
near(c[1], [933, 383], 'slot 3 top-right');
c = shot(4, 1463, 934);
near(c[0], [402, 264], 'slot 4 top-left');
near(c[2], [435, 615], 'slot 4 bottom-left');
// the right edge is further away than the left (turned about Y), the top nearer than the bottom
c = shot(0, 900, 600);
assert.ok(c[3][1] - c[1][1] < c[2][1] - c[0][1], 'the right edge is shorter');
// the camera scales with the screen height
const small = T.camera(1280, 800);
assert.strictEqual(small.cx, 640);
assert.ok(Math.abs(small.f - 1305.19 * (800 / 1200)) < 1e-9);

// a window where it is: the flat pose projects onto its own rectangle
const rect = { left: 87, top: 335, width: 1055, height: 785 };
c = T.corners(T.flatPose(cam, rect), rect.width, rect.height).map((p) => T.project(cam, p));
assert.deepStrictEqual(c.map((p) => p.map((v) => Math.round(v))), [[87, 335], [1142, 335], [87, 1120], [1142, 1120]]);
// the rim widens the quad by its size on every side
c = T.corners(T.flatPose(cam, rect), rect.width, rect.height, 2).map((p) => T.project(cam, p));
assert.deepStrictEqual(c[0].map(Math.round), [85, 333]);
assert.deepStrictEqual(c[3].map(Math.round), [1144, 1122]);

// ---- cycling: card i at rotation r ----
assert.deepStrictEqual(T.cardSlots(0, 0, 4), [[0, 1]]);
assert.deepStrictEqual(T.cardSlots(3, 0, 4), [[3, 1]], 'the desktop card at the back');
assert.deepStrictEqual(T.cardSlots(2, 1, 4), [[1, 1]], 'a step brings each card up a slot');
// half a step: the front card leaves towards you and arrives behind, both half see-through
const half = T.cardSlots(0, 0.5, 4);
assert.strictEqual(half.length, 2);
assert.deepStrictEqual(half[0], [-0.5, 0.5]);
assert.deepStrictEqual(half[1], [3.5, 0.5]);
assert.deepStrictEqual(T.cardSlots(0, -1, 4), [[1, 1]], 'a step back');
assert.deepStrictEqual(T.cardSlots(0, 4, 4), [[0, 1]], 'a full turn');
assert.deepStrictEqual(T.cardSlots(0, 0.3, 1), [[0, 1]], 'one card does not cycle');
assert.strictEqual(T.ease(0), 0);
assert.strictEqual(T.ease(1), 1);
assert.strictEqual(T.ease(0.5), 0.5);

// ---- hit testing ----
const quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
assert.ok(T.insideQuad(quad, 5, 5));
assert.ok(!T.insideQuad(quad, 11, 5));

// ---- windowCapture.js: the CSS rule index ----
assert.deepStrictEqual(C.splitSelectors('a .b, body .m:where(:not(#x:not(.w), #y, [d="1,2"])) > .c, d'),
    ['a .b', 'body .m:where(:not(#x:not(.w), #y, [d="1,2"])) > .c', 'd'], 'commas inside :not() and [attr] stay');
assert.strictEqual(C.stateOnly('.btn:hover'), true, 'a hover look never shows in a picture');
assert.strictEqual(C.stateOnly('.list:focus-within .row'), true);
assert.strictEqual(C.stateOnly('.btn:not(:hover)'), false, 'not hovered is every picture');
assert.strictEqual(C.stateOnly('.btn:disabled'), false);
assert.strictEqual(C.rightmostKey('body.desktop-mode .modal:where(:not(#a, #b)) > .modal-window-controls'), '.modal-window-controls');
assert.strictEqual(C.rightmostKey('.modal:where(.a):where(:not(#m:not(.w), #p))'), '.modal', 'ids inside :not() are not keys');
assert.strictEqual(C.rightmostKey('div#foo.bar'), '#foo');
assert.strictEqual(C.rightmostKey('ul > li'), 'li');
assert.strictEqual(C.rightmostKey(':is(.a, .b)'), '*');
assert.strictEqual(C.rightmostKey('.w-1\\/2'), '*', 'escapes go to the catch-all');
assert.strictEqual(C.testSelector('.a::before'), '.a');
assert.strictEqual(C.testSelector('.a:hover > '), '.a >*', 'a dangling combinator gets a target');
assert.strictEqual(C.absolutize('src: url("../webfonts/fa.woff2") format("woff2")', 'http://h/dist/fa/css/all.css'),
    'src: url("/dist/fa/webfonts/fa.woff2") format("woff2")', 'url()s are relative to their sheet');
assert.strictEqual(C.absolutize('url(/a.png) url(data:x)', 'http://h/css/x.css'), 'url(/a.png) url(data:x)');
assert.strictEqual(C.flattenImageSets('a{background:image-set("a.png" 1x, "b.png" 2x)}'), 'a{background:url("a.png")}');
assert.strictEqual(C.flattenImageSets('b{x:-webkit-image-set(url(c.png) 1x, url(d.png) 2x) y}'), 'b{x:url("c.png") y}');
assert.strictEqual(C.weightClass('400'), 'n');
assert.strictEqual(C.weightClass('600'), 's');
assert.strictEqual(C.weightClass('bold'), 'b');
assert.strictEqual(C.weightClass('300'), 'l');

// ---- no DOM / no WebGL: open() says so, and the callers fall back to the window switcher ----
assert.strictEqual(f.open('sticky'), false);
assert.strictEqual(f.isOpen(), false);
assert.strictEqual(f.supported(), false);

console.log('flip3d: ok');
