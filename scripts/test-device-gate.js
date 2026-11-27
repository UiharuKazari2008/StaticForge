#!/usr/bin/env node
'use strict';
// Consent gate on the agent-facing phone tools (Yozora #1284): device_shell, device_screenshot and device_packages reach a
// phone only after modules/deviceConsent.js says yes; DreamOS computers are not gated; an unloadable gate fails closed.
// No real device is touched: activeSync is stubbed, the settings store lives in a temp folder.
//   node scripts/test-device-gate.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-gate-'));
const gr = { getPath: () => tmp, getWebSocketServer: () => null };
const activeSync = require('../modules/activeSync');
const adbMod = require('../modules/deviceAdb');

const phone = { deviceId: 'phone1', name: 'Fold', model: 'SM-F966', online: true, platform: 'android' };
const pc = { deviceId: 'pc1', name: 'Ruiko', model: 'DreamOS', online: true, platform: 'cafeready' };
const phoneCalls = [];
let listCalls = 0;
activeSync.list = () => { listCalls++; return { devices: [phone, pc] }; };
activeSync.deviceOnline = () => true;
activeSync.serverCall = async (g, ws, id, op, args) => { phoneCalls.push({ id, op, args }); return { output: 'hi', packages: [{ package: 'a.b', label: 'AB' }], ok: true }; };

// DreamOS computer functions are stubbed in place so none of them is reached for real
const host = require('../modules/cafeReadyHost');
const hostCalls = [];
host.agentShell = async () => { hostCalls.push('shell'); return { success: true, via: 'host' }; };
host.agentPackages = async () => { hostCalls.push('packages'); return { success: true, via: 'host' }; };
host.agentScreenshot = async () => { hostCalls.push('screenshot'); return { meta: { success: true }, images: [] }; };

const asked = [];
let verdict = { ok: true };
const consent = { check: (dev, action, caller) => { asked.push({ dev, action, caller }); return typeof verdict === 'function' ? verdict(dev, action) : verdict; } };
adbMod._setConsentForTests(() => consent);

const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

const reset = () => { phoneCalls.length = 0; asked.length = 0; hostCalls.length = 0; logs.length = 0; };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// settings the underlying calls need (commands on; screenshots off so the screenshot path ends before any adb)
adbMod.settings(gr, 'phone1', { features: { commands: true, install: true, screenshots: false } });

test('allowed shell passes through to the phone call', async () => {
    reset(); verdict = { ok: true, lease: { until: 1 } };
    const r = await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.device, 'Fold');
    assert.deepStrictEqual(phoneCalls.map((c) => c.op), ['device.adbShell']);
    assert.deepStrictEqual(asked[0].action, { kind: 'shell', command: 'id' });
    assert.deepStrictEqual(asked[0].dev, { deviceId: 'phone1', name: 'Fold', model: 'SM-F966' });
});
test('allowed packages: read lists, write manages', async () => {
    reset(); verdict = { ok: true };
    const a = await adbMod.agentPackages(gr, { device: 'Fold' });
    assert.strictEqual(a.success, true); assert.strictEqual(a.count, 1);
    assert.strictEqual(asked[0].action.kind, 'packages-read');
    for (const action of ['open', 'uninstall', 'disable', 'enable', 'stop', 'clear']) {
        asked.length = 0;
        const b = await adbMod.agentPackages(gr, { device: 'Fold', package: 'a.b', action });
        assert.strictEqual(b.success, true, action);
        assert.strictEqual(asked[0].action.kind, 'packages-write', action);
    }
    assert.deepStrictEqual(phoneCalls.map((c) => c.op), ['apps.packages', ...Array(6).fill('apps.manage')]);
});
test('allowed screenshot passes the gate (ends at the screenshots switch, no phone call)', async () => {
    reset(); verdict = { ok: true };
    const r = await adbMod.agentScreenshot(gr, { device: 'Fold' });
    assert.strictEqual(r.meta.code, 'SCREENSHOTS_OFF');
    assert.deepStrictEqual(asked.map((a) => a.action), [{ kind: 'screenshot' }]);
    assert.strictEqual(phoneCalls.length, 0);
});
for (const code of ['DEVICE_NOT_GRANTED', 'DEVICE_PENDING', 'DEVICE_DENIED']) {
    test(`refusal ${code}: shape of all three functions, phone never contacted`, async () => {
        reset(); adbMod._setConsentForTests(() => consent);
        verdict = { ok: false, code, error: `no ${code}`, holder: 'agent-x', hint: 'tap allow' };
        const s = await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
        assert.deepStrictEqual(s, { success: false, code, error: `no ${code}`, holder: 'agent-x', hint: 'tap allow', device: 'Fold' });
        const p = await adbMod.agentPackages(gr, { device: 'Fold', action: 'uninstall', package: 'a.b' });
        assert.deepStrictEqual(p, { success: false, code, error: `no ${code}`, holder: 'agent-x', hint: 'tap allow', device: 'Fold' });
        const p2 = await adbMod.agentPackages(gr, { device: 'Fold' });
        assert.strictEqual(p2.code, code);
        const h = await adbMod.agentScreenshot(gr, { device: 'Fold' });
        assert.deepStrictEqual(h, { meta: { success: false, code, error: `no ${code}`, holder: 'agent-x', hint: 'tap allow', device: { deviceId: 'phone1', name: 'Fold' } }, images: [] });
        assert.strictEqual(phoneCalls.length, 0);
        assert.deepStrictEqual(asked.map((a) => a.action.kind), ['shell', 'packages-write', 'packages-read', 'screenshot']);
    });
}
test('refusal log: one short line, at most once per 30 s per device and code', async () => {
    reset(); adbMod._setConsentForTests(() => consent);
    verdict = { ok: false, code: 'DEVICE_DENIED', error: 'x' };
    await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    assert.deepStrictEqual(logs, ['[device-gate] refused Fold shell DEVICE_DENIED']);
    verdict = { ok: false, code: 'DEVICE_PENDING', error: 'x' };
    await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    assert.strictEqual(logs.length, 2);
});
test('a refusal without fields gets safe defaults', async () => {
    reset(); verdict = { ok: false };
    const r = await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    assert.strictEqual(r.code, 'DEVICE_NOT_GRANTED'); assert.strictEqual(r.success, false); assert.ok(r.error);
    verdict = undefined;
    assert.strictEqual((await adbMod.agentShell(gr, { device: 'Fold', command: 'id' })).code, 'DEVICE_NOT_GRANTED');
    assert.strictEqual(phoneCalls.length, 0);
});
// #1305 S3: the gate has an agent identity. deviceAdb hands the caller the tool's server side knows ({ agentId?, sessionId?, human? }) to
// consent.check as its third argument, from all three agent functions; deviceConsent.check then lets only the lease holder through.
const adbSource = fs.readFileSync(path.join(__dirname, '..', 'modules', 'deviceAdb.js'), 'utf8');
const passesCaller = /consent\.check\(\{[^}]*\}, action, caller\)/.test(adbSource);
test('S3: the caller reaches consent.check from device_shell, device_packages and device_screenshot (skipped until deviceAdb passes it)', async () => {
    if (!passesCaller) { realLog('     (skipped: modules/deviceAdb.js does not pass the caller yet)'); return; }
    reset(); verdict = { ok: true };
    const who = { agentId: 'claude-aaaaaaaa', sessionId: 'aaaaaaaa-0000-4000-8000-000000000001' };
    await adbMod.agentShell(gr, { device: 'Fold', command: 'id' }, who);
    await adbMod.agentPackages(gr, { device: 'Fold' }, who);
    await adbMod.agentPackages(gr, { device: 'Fold', package: 'a.b', action: 'uninstall' }, who);
    await adbMod.agentScreenshot(gr, { device: 'Fold' }, who);
    assert.deepStrictEqual(asked.map((a) => a.action.kind), ['shell', 'packages-read', 'packages-write', 'screenshot']);
    asked.forEach((a) => assert.deepStrictEqual(a.caller, who));
    asked.length = 0;
    await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    assert.strictEqual(asked[0].caller, undefined, 'no caller given: none invented (the consent check then fails closed)');
});
test('S3: a DEVICE_CALLER_UNKNOWN refusal has the usual shape and the phone is not contacted', async () => {
    reset(); verdict = { ok: false, code: 'DEVICE_CALLER_UNKNOWN', error: 'this call does not say which agent makes it', holder: { agentId: 'other' }, hint: 'pass your agent id' };
    const s = await adbMod.agentShell(gr, { device: 'Fold', command: 'input tap 1 1' });
    assert.deepStrictEqual(s, { success: false, code: 'DEVICE_CALLER_UNKNOWN', error: 'this call does not say which agent makes it', holder: { agentId: 'other' }, hint: 'pass your agent id', device: 'Fold' });
    assert.strictEqual(phoneCalls.length, 0);
});
test('a DreamOS computer is not gated', async () => {
    reset(); verdict = { ok: false, code: 'DEVICE_DENIED', error: 'x' };
    assert.strictEqual((await adbMod.agentShell(gr, { device: 'Ruiko', command: 'id' })).via, 'host');
    assert.strictEqual((await adbMod.agentPackages(gr, { device: 'Ruiko' })).via, 'host');
    assert.strictEqual((await adbMod.agentScreenshot(gr, { device: 'Ruiko' })).meta.success, true);
    assert.deepStrictEqual(hostCalls, ['shell', 'packages', 'screenshot']);
    assert.strictEqual(asked.length, 0);
});
test('gate unavailable (cannot load, throws, no check) fails closed', async () => {
    for (const loader of [() => { throw new Error('Cannot find module'); }, () => ({}), () => null, () => ({ check() { throw new Error('boom'); } }), () => ({ check: async () => { throw new Error('async boom'); } })]) {
        reset(); adbMod._setConsentForTests(loader);
        const s = await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
        assert.strictEqual(s.success, false); assert.strictEqual(s.code, 'DEVICE_GATE_UNAVAILABLE'); assert.strictEqual(s.device, 'Fold');
        assert.strictEqual((await adbMod.agentPackages(gr, { device: 'Fold' })).code, 'DEVICE_GATE_UNAVAILABLE');
        const h = await adbMod.agentScreenshot(gr, { device: 'Fold' });
        assert.strictEqual(h.meta.code, 'DEVICE_GATE_UNAVAILABLE'); assert.deepStrictEqual(h.images, []);
        assert.strictEqual(phoneCalls.length, 0);
    }
    adbMod._setConsentForTests(() => consent);
});
test('default loader fails closed while modules/deviceConsent.js does not exist (skipped once it does: no real consent state is touched)', async () => {
    if (fs.existsSync(path.join(__dirname, '..', 'modules', 'deviceConsent.js'))) return;
    adbMod._setConsentForTests();
    reset();
    const r = await adbMod.agentShell(gr, { device: 'Fold', command: 'id' });
    assert.strictEqual(r.code, 'DEVICE_GATE_UNAVAILABLE');
    assert.strictEqual(phoneCalls.length, 0);
    adbMod._setConsentForTests(() => consent);
});
test('unknown device: choose-device answers are untouched and ask nothing', async () => {
    reset(); verdict = { ok: true };
    assert.strictEqual((await adbMod.agentShell(gr, { device: 'nope', command: 'id' })).code, 'CHOOSE_DEVICE');
    assert.strictEqual(asked.length, 0);
});

(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); realLog(`ok   ${name}`); } catch (err) { failed++; realLog(`FAIL ${name}\n${err.stack}`); }
    }
    console.log = realLog;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* temp */ }
    adbMod.resetForTests();
    realLog(failed ? `${failed} failed` : `all ${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
