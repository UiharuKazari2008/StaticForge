#!/usr/bin/env node
// Wheel gesture lock (Yozora #466): the scroller that takes the first wheel event of a gesture
// keeps every event until the wheel settles; another scroller under the pointer forwards to it,
// the owner swallows at its edge instead of chaining, and after the settle gap the next gesture
// picks its owner afresh. Also: customScrollbar.js feeds the lock and shows the owner's bar.
// Run: node scripts/test-wheel-scroll-lock.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createWheelLock, DEFAULT_SETTLE_MS } = require(path.join(ROOT, 'public/scripts/comp/wheelScrollLock.js'));

const page = { name: 'studio' };   // the outer scroller (Studio's form section)
const panel = { name: 'director' }; // the nested one (the Director panel)
const can = { canScroll: true, canScrollInDirection: true, innermost: true };
const edge = { canScroll: true, canScrollInDirection: false, innermost: true };

// 1. a gesture that starts on the page keeps the page even when the panel slides under the pointer
{
    const lock = createWheelLock({ settleMs: 100 });
    const changes = [];
    lock.onChange((o) => changes.push(o ? o.name : null));
    assert.deepStrictEqual(lock.decide(page, 0, can), { action: 'scroll', owner: page }, 'page takes the first event');
    assert.deepStrictEqual(lock.decide(panel, 40, can), { action: 'forward', owner: page }, 'the panel forwards to the page while the gesture is live');
    assert.deepStrictEqual(lock.decide(page, 80, edge), { action: 'swallow', owner: page }, 'the page at its top swallows instead of chaining');
    assert.strictEqual(lock.owner(150), page, 'still live within the gap');
    assert.strictEqual(lock.owner(260), null, 'settled after the gap');
    assert.deepStrictEqual(changes, ['studio', null], 'owner changes were announced');
}

// 2. a gesture that starts inside the panel never spills into the page until it settles
{
    const lock = createWheelLock({ settleMs: 100 });
    assert.deepStrictEqual(lock.decide(panel, 0, can), { action: 'scroll', owner: panel });
    assert.deepStrictEqual(lock.decide(panel, 30, edge), { action: 'swallow', owner: panel }, 'at the panel edge: eaten, not chained');
    assert.deepStrictEqual(lock.decide(page, 60, can), { action: 'forward', owner: panel }, 'the page under the pointer forwards to the panel');
    assert.deepStrictEqual(lock.decide(page, 300, can), { action: 'scroll', owner: page }, 'after the gap the page can own a new gesture');
}

// 3. no owner: an innermost scroller at its edge passes (the outer one or the page decides)
{
    const lock = createWheelLock({ settleMs: 100 });
    assert.deepStrictEqual(lock.decide(panel, 0, edge), { action: 'pass', owner: null });
    assert.deepStrictEqual(lock.decide(panel, 0, { canScroll: false, canScrollInDirection: false, innermost: true }), { action: 'pass', owner: null });
    assert.deepStrictEqual(lock.decide(page, 0, { ...can, innermost: false }), { action: 'pass', owner: null }, 'an outer scroller under an inner one passes');
    assert.deepStrictEqual(lock.decide(page, 1, can), { action: 'scroll', owner: page }, 'then the outer one takes it as innermost');
    lock.release();
    assert.strictEqual(lock.owner(2), null, 'release drops the owner');
}

assert.strictEqual(DEFAULT_SETTLE_MS, 180, 'the default settle gap');

// customScrollbar.js uses it and shows the owner's bar
const cs = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/customScrollbar.js'), 'utf8');
assert.ok(cs.includes('wheelScrollLock.createWheelLock()') && cs.includes("verdict.action === 'forward'") && cs.includes("verdict.action === 'swallow'"), 'the overlay scroller feeds the lock');
assert.ok(cs.includes("host.classList.add('wheel-owner')") && cs.includes('_armWheelSettle()'), 'owner host gets .wheel-owner until the gesture settles');
const css = fs.readFileSync(path.join(ROOT, 'public/css/custom-scrollbar.css'), 'utf8');
assert.ok(css.includes('.has-custom-scrollbar.wheel-owner .custom-scrollbar,\n.form-section-scroll.wheel-owner .custom-scrollbar {\n    opacity: 1;'), 'the locked scroller shows its bar');
const html = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
assert.ok(html.includes('<script src="scripts/comp/wheelScrollLock.js"></script>\n    <script src="scripts/comp/customScrollbar.js"></script>'), 'the lock loads before the overlay scroller');

// the light prompt box audit (#466): the near-neutral ring and the generic token edge were bumped
const eh = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/emphasisHighlight.js'), 'utf8');
assert.ok(eh.includes('const ringA = Math.max(neutral ? 0.72 : 0.55, c.borderA);'), 'near-neutral weight ring at 0.72 on the light box');
const vgc = fs.readFileSync(path.join(ROOT, 'public/css/vista-glass-controls.css'), 'utf8');
assert.ok(vgc.includes('.emphasis-highlight {\n    /* 0.22 read at 1.5:1 against the pastel fills on the white box (#466 audit) */\n    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.32);'), 'generic token edge at 0.32');
console.log('test-wheel-scroll-lock: ok');
