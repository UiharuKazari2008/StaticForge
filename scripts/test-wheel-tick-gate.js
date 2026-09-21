const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/utils/wheelTickGate.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

const createWheelTickGate = vm.runInContext('createWheelTickGate', ctx);
const guardWheelTick = vm.runInContext('guardWheelTick', ctx);
const WHEEL_TICK_MS = vm.runInContext('WHEEL_TICK_MS', ctx);

assert.strictEqual(WHEEL_TICK_MS, 400);

const gate = createWheelTickGate(400);
assert.strictEqual(gate(1000), true, 'first tick allowed');
assert.strictEqual(gate(1399), false, 'within 400ms ignored');
assert.strictEqual(gate(1400), true, 'exactly 400ms later allowed');
assert.strictEqual(gate(1400), false, 'same timestamp after success ignored');
assert.strictEqual(gate(1800), true, 'next window allowed');

const custom = createWheelTickGate(100);
assert.strictEqual(custom(0), true);
assert.strictEqual(custom(99), false);
assert.strictEqual(custom(100), true);

const fallback = createWheelTickGate(0);
assert.strictEqual(fallback(0), true);
assert.strictEqual(fallback(399), false);
assert.strictEqual(fallback(400), true);

const invalid = createWheelTickGate(-12);
assert.strictEqual(invalid(10), true);
assert.strictEqual(invalid(409), false);
assert.strictEqual(invalid(410), true);

let prevented = false;
let stopped = false;
const ev = {
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
};
const owned = createWheelTickGate(400);
assert.strictEqual(guardWheelTick(ev, owned, { stop: true }), true);
assert.ok(prevented, 'owned wheel preventDefault');
assert.ok(stopped, 'owned wheel stopPropagation');
prevented = false;
stopped = false;
assert.strictEqual(guardWheelTick(ev, owned, { stop: true }), false, 'gated tick still preventDefault');
assert.ok(prevented, 'ignored tick still preventDefault');
assert.ok(stopped, 'ignored tick still stopPropagation');

console.log('test-wheel-tick-gate: ok');
