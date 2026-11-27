#!/usr/bin/env node
'use strict';
/**
 * Yukimi's own phone (the Fold) vs the agents' test phone (the A53), Nov 26 2026 (rule fold-off-limits):
 * the Fold is refused unless purpose final-install (granted, no ask), a Fleet approval window, or purpose approval (asked);
 * the device gate refuses it without an allowed lease, read-only included; the A53 is granted at once and never asks.
 *   node scripts/test-fold-off-limits.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const store = require('../modules/agentCoord/store');
const dq = require('../modules/agentCoord/deviceQueue');
const consent = require('../modules/deviceConsent');
store.setSetting('deviceConsent', { readOnly: 'allow' });

let n = 0;
function t(name, fn) { fn(); n += 1; console.log(`ok - ${name}`); }
const FOLD = { name: 'Galaxy Z Fold7', model: 'SM-F966U' };
const A53 = { name: 'A53', model: 'SM-A536U1' };

store.upsertAgent({ id: 'agent-a', kind: 'claude', name: 'A' });
store.upsertAgent({ id: 'agent-b', kind: 'claude', name: 'B' });

t('the A53 is granted at once and never asks Yukimi', () => {
    const r = dq.request('agent-a', 'a53', { why: 'test' });
    assert.strictEqual(r.granted, true, JSON.stringify(r));
    assert.ok(!r.consent);
    assert.strictEqual(consent.check(A53, { kind: 'screenshot' }).ok, true);
    dq.release('agent-a', 'a53');
});

t('the Fold without a purpose is refused for anything she can see, hear or feel', () => {
    assert.throws(() => dq.request('agent-a', 'fold', { why: 'look' }), /Yukimi's own phone/);
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'input tap 10 10' }).code, 'DEVICE_OFF_LIMITS');
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'am start -n x/.Main' }).code, 'DEVICE_OFF_LIMITS');
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'settings put global x 1' }).code, 'DEVICE_OFF_LIMITS');
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'reboot' }).code, 'DEVICE_OFF_LIMITS');
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'pm install -r x.apk' }).code, 'DEVICE_OFF_LIMITS');
    assert.strictEqual(consent.check(FOLD, { kind: 'packages-write' }).code, 'DEVICE_OFF_LIMITS');
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'getprop x; input tap 1 1' }).code, 'DEVICE_OFF_LIMITS');
});

t('Yukimi, Nov 27: the Fold is open with no lease and no ask for what she cannot perceive, whatever readOnly says', () => {
    for (const ro of ['allow', 'ask']) {
        store.setSetting('deviceConsent', { readOnly: ro });
        assert.strictEqual(consent.check(FOLD, { kind: 'packages-read' }).ok, true, ro);
        assert.strictEqual(consent.check(FOLD, { kind: 'screenshot' }).ok, true, ro);
        assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'getprop ro.build.version.release' }).ok, true, ro);
        assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'logcat -d -t 100' }).ok, true, ro);
    }
    store.setSetting('deviceConsent', { readOnly: 'allow' });
});

t('final-install: granted at once, no ask, and the gate lets it through', () => {
    const r = dq.request('agent-a', 'fold', { why: 'install release 16', purpose: 'final-install' });
    assert.strictEqual(r.granted, true, JSON.stringify(r));
    assert.strictEqual(r.lease.consent, 'allowed');
    // the holder's own call (#1305 S3: an allowed lease is its holder's alone)
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'pm install -r x.apk' }, { agentId: 'agent-a' }).ok, true);
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'pm install -r x.apk' }, { agentId: 'agent-b' }).ok, false);
    dq.release('agent-a', 'fold');
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'pm install -r x.apk' }, { agentId: 'agent-a' }).code, 'DEVICE_OFF_LIMITS');
});

t('purpose approval asks her on the phone (pending), nothing runs until she allows', () => {
    const r = dq.request('agent-b', 'fold', { why: 'she asked for a look', purpose: 'approval' });
    assert.strictEqual(r.consent, 'pending', JSON.stringify(r));
    assert.strictEqual(consent.check(FOLD, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'agent-b' }).code, 'DEVICE_PENDING');
    assert.strictEqual(consent.check(FOLD, { kind: 'screenshot' }).ok, true); // not perceivable: open even while pending
    dq.release('agent-b', 'fold');
});

t('a Fleet approval window (she approved / named it a priority) grants without asking, until it ends', () => {
    store.setSetting('foldApproval', { until: Date.now() + 60000, why: 'priority now', by: 'Yukimi' });
    const r = dq.request('agent-b', 'fold', { why: 'priority fix' });
    assert.strictEqual(r.granted, true, JSON.stringify(r));
    dq.release('agent-b', 'fold');
    store.setSetting('foldApproval', { until: Date.now() - 1 });
    assert.throws(() => dq.request('agent-b', 'fold', { why: 'again' }), /Yukimi's own phone/);
});

store.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} tests passed`);
