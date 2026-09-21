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

const utilSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/utilities.js'), 'utf8');
const utilCtx = {
    console,
    document: {
        readyState: 'complete',
        addEventListener() {},
        createElement() { return { textContent: '' }; },
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    },
    window: {},
    showGlassToast() {}
};
utilCtx.window = utilCtx;
vm.createContext(utilCtx);
vm.runInContext(src, utilCtx);
vm.runInContext(utilSrc, utilCtx);

const stepLegalCustomResolution = vm.runInContext('stepLegalCustomResolution', utilCtx);
const CUSTOM_RESOLUTION_AREA = vm.runInContext('CUSTOM_RESOLUTION_AREA', utilCtx);
const LEGAL_CUSTOM_RESOLUTIONS = vm.runInContext('LEGAL_CUSTOM_RESOLUTIONS', utilCtx);
const SAMPLER_MAP = vm.runInContext('SAMPLER_MAP', utilCtx);
const createGateInUtil = vm.runInContext('createWheelTickGate', utilCtx);

const list = LEGAL_CUSTOM_RESOLUTIONS.normal;
const lastLegal = list[list.length - 1];
const firstLegal = list[0];
const ratioGate = createGateInUtil(400);
let dims = { width: 1024, height: 1024 };
const before = `${dims.width}x${dims.height}`;
assert.strictEqual(ratioGate(5000), true);
dims = stepLegalCustomResolution(dims.width, dims.height, CUSTOM_RESOLUTION_AREA.normal, 1);
const afterOne = `${dims.width}x${dims.height}`;
assert.notStrictEqual(afterOne, before, 'one allowed tick must move');
assert.strictEqual(ratioGate(5100), false);
assert.strictEqual(`${dims.width}x${dims.height}`, afterOne, 'blocked tick must not have been applied');
assert.strictEqual(ratioGate(5400), true);
dims = stepLegalCustomResolution(dims.width, dims.height, CUSTOM_RESOLUTION_AREA.normal, 1);
assert.notStrictEqual(`${dims.width}x${dims.height}`, afterOne, 'tick after 400ms moves again');

const extremeGate = createGateInUtil(400);
let extreme = { width: lastLegal.width, height: lastLegal.height };
let moved = 0;
for (let i = 0; i < 20; i++) {
    if (!extremeGate(20000 + i * 10)) continue;
    const next = stepLegalCustomResolution(extreme.width, extreme.height, CUSTOM_RESOLUTION_AREA.normal, 1);
    if (next.width !== extreme.width || next.height !== extreme.height) moved += 1;
    extreme = next;
}
assert.strictEqual(moved, 0, 'rapid fling at landscape extreme stays clamped');
assert.strictEqual(extreme.width, lastLegal.width);
assert.strictEqual(extreme.height, lastLegal.height);

const portraitGate = createGateInUtil(400);
extreme = { width: firstLegal.width, height: firstLegal.height };
moved = 0;
for (let i = 0; i < 20; i++) {
    if (!portraitGate(30000 + i * 10)) continue;
    const next = stepLegalCustomResolution(extreme.width, extreme.height, CUSTOM_RESOLUTION_AREA.normal, -1);
    if (next.width !== extreme.width || next.height !== extreme.height) moved += 1;
    extreme = next;
}
assert.strictEqual(moved, 0, 'rapid fling at portrait extreme stays clamped');
assert.strictEqual(extreme.width, firstLegal.width);
assert.strictEqual(extreme.height, firstLegal.height);

function cycleSampler(current, deltaY) {
    const idx = SAMPLER_MAP.findIndex((s) => s.meta === current);
    const i = idx < 0 ? 0 : idx;
    const dir = deltaY > 0 ? 1 : -1;
    let next = i + dir;
    if (next < 0) next = SAMPLER_MAP.length - 1;
    if (next >= SAMPLER_MAP.length) next = 0;
    return SAMPLER_MAP[next].meta;
}
const samplerGate = createGateInUtil(400);
assert.strictEqual(SAMPLER_MAP.length > 1, true);
assert.strictEqual(samplerGate(1), true);
let sampler = cycleSampler('k_euler_ancestral', 1);
assert.notStrictEqual(sampler, 'k_euler_ancestral');
assert.strictEqual(samplerGate(2), false);
assert.strictEqual(cycleSampler(SAMPLER_MAP[SAMPLER_MAP.length - 1].meta, 1), SAMPLER_MAP[0].meta);
assert.strictEqual(cycleSampler(SAMPLER_MAP[0].meta, -1), SAMPLER_MAP[SAMPLER_MAP.length - 1].meta);

console.log('test-wheel-tick-gate: ok');
