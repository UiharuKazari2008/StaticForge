#!/usr/bin/env node
'use strict';
process.env.DEVICE_QUEUE_TEST_PHONES = '1'; // these tests model the phones; the server refuses physical phones to agents

/**
 * Device consent notices (Yozora #1284, P3): modules/deviceConsentNotices.js and the device_consent_answer handler.
 * Temp DBs only (AGENT_COORD_DB and NOTIFICATION_INBOX_DB are set), so nothing reaches a real phone or the real inbox.
 *
 *   node scripts/test-device-consent-notices.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-consent-'));
process.env.NOTIFICATION_INBOX_DB = path.join(tmp, 'inbox.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');

const activeSync = require('../modules/activeSync');
const phoneStatus = require('../modules/phoneStatus');
const inbox = require('../modules/notificationInbox');
const sent = [];
const toPhones = [];
activeSync.sendInboxNotice = (g, ws, notice) => { toPhones.push(notice); return 1; };
activeSync.sendInboxCleared = () => 1;
phoneStatus.touch = () => {};
inbox.bind({ getConfig: () => ({}), getWebSocketServer: () => ({ broadcast: (m) => sent.push(m) }) });
// what the module ASKS the inbox for (alert true / false per id), whatever the inbox then does with a new row
const asked = [];
const realPublish = inbox.publish;
inbox.publish = (n) => { asked.push([n.id, n.alert === true]); return realPublish(n); };
const askedLoud = () => asked.filter((x) => x[1]).length;
const cn = require('../modules/deviceConsentNotices');

// a stubbed modules/deviceConsent.js (P1 writes the real one): answers recorded, the file need not exist
const answers = [];
const ends = [];
let nextEnd = { ok: true };
const lanesAsk = {}; // lease id -> 'test' for the stub's askLane
const lanesDev = {}; // device -> 'test' for the stub's laneOfDevice
const patches = [];
let nextResult = { ok: true };
const stubPath = path.resolve(__dirname, '../modules/deviceConsent.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
    if (parent && /296-deviceConsentHandler\.js$/.test(parent.filename || '') && /deviceConsent$/.test(req)) return stubPath;
    return origResolve.call(this, req, parent, ...rest);
};
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports: { endHold: (device, by, opts) => { ends.push([device, by, opts]); return nextEnd; }, answer: (id, a, by, opts) => { answers.push([id, a, by, opts]); return nextResult; }, askLane: (id) => lanesAsk[id] || 'admin', laneOfDevice: (d) => lanesDev[d] || 'admin', settings: () => ({ timeoutSec: 60, onTimeout: 'wait', readOnly: 'ask', consentDevices: ['a53', 'fold'] }), setSettings: (p) => { patches.push(p); if (p.onTimeout === 'bogus') throw new Error('onTimeout must be wait, deny, allow'); return Object.assign({ timeoutSec: 60, onTimeout: 'wait', readOnly: 'ask', consentDevices: ['a53', 'fold'] }, p); } } };

const loud = () => sent.filter((m) => m && m.type === 'inbox_updated' && m.data.reason === 'new' && m.data.notice.alert).length;
const mark = () => { sent.length = 0; toPhones.length = 0; asked.length = 0; };
const mine = () => inbox.list('admin').filter((n) => /^device-(ask|hold):/.test(n.id));
const ask = (over = {}) => Object.assign({ leaseId: 'L1', device: 'a53', label: 'A53 phone', agentId: 'ag1', agentName: 'Claude 3', why: 'testing the bar', minutes: 20, requestedAt: Date.now(), consentSince: Date.now() }, over);
const hold = (over = {}) => Object.assign({ leaseId: 'L2', device: 'fold', label: 'Fold', agentId: 'ag2', agentName: 'Claude 4', why: 'build check', startedAt: Date.now(), endsAt: Date.now() + 30 * 60000 }, over);

let failed = 0;
async function test(name, f) {
    try { inbox._test.reset(); cn._reset(); for (const x of ['', '-wal', '-shm']) fs.rmSync(process.env.NOTIFICATION_INBOX_DB + x, { force: true }); mark(); answers.length = 0; ends.length = 0; nextEnd = { ok: true }; nextResult = { ok: true }; for (const k of Object.keys(lanesAsk)) delete lanesAsk[k]; for (const k of Object.keys(lanesDev)) delete lanesDev[k]; await f(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 6).join('\n     ')}`); }
}

(async () => {
    await test('ask: loud, buttons, data, life 12 h', () => {
        const r = cn.sync({ asks: [ask()], holds: [] }, {}, {});
        assert.deepStrictEqual(r.published, ['device-ask:L1']);
        assert.strictEqual(loud(), 1);
        const n = mine()[0];
        assert.strictEqual(n.title, 'Claude 3 wants the A53 phone');
        assert.strictEqual(n.text, 'For up to 20 min. Why: testing the bar.'); // #1305 P7: duration first, no 'Allow it?'
        assert.strictEqual(n.cls, 'notification'); // #1305: 'Other notifications', never 'fleet' (Alarm4)
        assert.strictEqual(n.app, 'claudedesk');
        assert.strictEqual(n.data.kind, 'device-ask');
        assert.strictEqual(n.data.leaseId, 'L1');
        assert.strictEqual(n.data.answerType, 'device_consent_answer');
        assert.strictEqual(n.data.page, 'devices');
        assert.deepStrictEqual(n.data.buttons, [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }]);
        const life = n.expiresAt - Date.now();
        assert.ok(life > 11.9 * 3600000 && life <= 12 * 3600000, `life ${life}`);
    });

    await test('a repeat sync never sounds twice; quiet re-publish is silent and still shown', () => {
        cn.sync({ asks: [ask()], holds: [] }, {}, {});
        assert.strictEqual(loud(), 1);
        mark();
        cn.sync({ asks: [ask()], holds: [] }, {}, {});
        cn.sync({ asks: [ask()], holds: [] }, {}, { quiet: new Set(['L1']) });
        assert.strictEqual(loud(), 0);
        assert.strictEqual(mine().length, 1);
        assert.notStrictEqual(mine()[0].state, 'cleared');
    });

    await test('another agent asking a minute later sounds on its own', () => {
        const t0 = Date.now();
        cn.sync({ asks: [ask()], holds: [] }, {}, { now: t0 });
        mark();
        cn.sync({ asks: [ask(), ask({ leaseId: 'L9', agentId: 'ag9', device: 'fold' })], holds: [] }, {}, { now: t0 + 61000 });
        assert.strictEqual(loud(), 1);
        assert.strictEqual(mine().length, 2);
    });

    await test('#1305: no repeat - the same agent asking again for the same phone within 15 min is shown, not sounded', () => {
        const t0 = Date.now();
        cn.sync({ asks: [ask()], holds: [] }, {}, { now: t0 });
        assert.strictEqual(loud(), 1);
        cn.sync({ asks: [], holds: [] }, {}, { now: t0 + 1000 }); // denied, the ask comes down
        mark();
        cn.sync({ asks: [ask({ leaseId: 'L5' })], holds: [] }, {}, { now: t0 + 5 * 60000 });
        assert.deepStrictEqual(asked, [['device-ask:L5', false]], 'published silent');
        assert.strictEqual(loud(), 0, 'the new row stays silent');
        assert.deepStrictEqual(mine().map((n) => n.id), ['device-ask:L5']);
        assert.strictEqual(toPhones.length, 1, 'the phone still gets it');
        assert.deepStrictEqual(mine()[0].data.buttons.map((b) => b.id), ['allow', 'deny']);
        mark();
        cn.sync({ asks: [ask({ leaseId: 'L6' })], holds: [] }, {}, { now: t0 + 16 * 60000 });
        assert.deepStrictEqual(asked, [['device-ask:L6', true]], 'after 15 min it may sound again');
    });

    await test('#1305: a burst of asks (two agents at once) is one sound', () => {
        const t0 = Date.now();
        cn.sync({ asks: [ask(), ask({ leaseId: 'L8', agentId: 'ag8', device: 'fold' })], holds: [] }, {}, { now: t0 });
        assert.strictEqual(askedLoud(), 1);
        assert.strictEqual(loud(), 1);
        assert.strictEqual(mine().length, 2);
    });

    await test('clear on removal (asks and holds), others stay', () => {
        cn.sync({ asks: [ask(), ask({ leaseId: 'L3' })], holds: [hold()] }, {}, {});
        assert.strictEqual(mine().length, 3);
        inbox.publish({ user: 'admin', id: 'other:1', title: 'unrelated', cls: 'fleet' });
        const r = cn.sync({ asks: [ask({ leaseId: 'L3' })], holds: [] }, {}, {});
        assert.deepStrictEqual(r.cleared.sort(), ['device-ask:L1', 'device-hold:fold']);
        assert.deepStrictEqual(mine().map((n) => n.id), ['device-ask:L3']);
        assert.ok(inbox.list('admin').some((n) => n.id === 'other:1'));
        cn.sync({ asks: [], holds: [] }, {}, {});
        assert.strictEqual(mine().length, 0);
        assert.ok(inbox.list('admin').some((n) => n.id === 'other:1'));
    });

    await test('hold: silent, one per device, lives until endsAt + 5 min', () => {
        const h = hold();
        cn.sync({ asks: [], holds: [h] }, {}, {});
        // #1305: the in-use notice never asks for a sound (the inbox's new-row rule decides the rest)
        assert.strictEqual(askedLoud(), 0, 'the in-use notice is published silent');
        assert.strictEqual(loud(), 0, 'and the inbox keeps a new row silent when alert is false');
        mark();
        cn.sync({ asks: [], holds: [h] }, {}, {});
        assert.strictEqual(loud(), 0);
        const n = mine()[0];
        assert.strictEqual(n.id, 'device-hold:fold');
        assert.strictEqual(n.title, 'Fold is in use by Claude 4');
        assert.ok(/^build check\. Until \d\d:\d\d\.$/.test(n.text), n.text); // #1305 P7: no trailing 'End takes the phone back now.'
        assert.deepStrictEqual({ kind: n.data.kind, device: n.data.device, leaseId: n.data.leaseId }, { kind: 'device-hold', device: 'fold', leaseId: 'L2' });
        assert.strictEqual(n.expiresAt, h.endsAt + 5 * 60000);
        // the device changes hands: still one row, new text, still silent
        cn.sync({ asks: [], holds: [hold({ leaseId: 'L7', agentName: 'Claude 5' })] }, {}, {});
        assert.strictEqual(mine().length, 1);
        assert.strictEqual(mine()[0].title, 'Fold is in use by Claude 5');
        assert.strictEqual(loud(), 0);
    });

    await test('#1305 S5: two holds on a device in a row (the first cleared) are one sound at most - none', () => {
        cn.sync({ asks: [], holds: [hold()] }, {}, {});
        cn.sync({ asks: [], holds: [] }, {}, {}); // ended: cleared
        assert.strictEqual(mine().length, 0);
        mark();
        cn.sync({ asks: [], holds: [hold({ leaseId: 'L7', agentName: 'Claude 5' })] }, {}, {});
        assert.deepStrictEqual(mine().map((n) => [n.id, n.state]), [['device-hold:fold', 'new']], 'shown again');
        assert.strictEqual(loud(), 0, 'the page is told: no sound');
        assert.ok(toPhones.length === 1 && toPhones[0].alert === false, 'the phone is told: no sound');
    });

    await test('#1305 S9: the ask is not swallowed by a quiet Other notifications class', () => {
        inbox.setQuiet('admin', ['notification']);
        try {
            cn.sync({ asks: [ask()], holds: [hold()] }, {}, {});
            const a = mine().find((n) => n.id === 'device-ask:L1');
            assert.strictEqual(a.state, 'new', 'the question is waiting');
            assert.ok(toPhones.some((n) => n.id === 'device-ask:L1'), 'and pushed to the phone');
            assert.strictEqual(mine().find((n) => n.id === 'device-hold:fold').state, 'new', 'the hold carries answerType too');
        } finally { inbox.setQuiet('admin', []); }
    });

    await test('#1305 test lane: a lane-test ask / hold lands under user test only, never in the household list', () => {
        const mineT = () => inbox.list('test').filter((n) => /^device-(ask|hold):/.test(n.id));
        const r = cn.sync({ asks: [ask({ leaseId: 'T1', lane: 'test' })], holds: [hold({ leaseId: 'T2', device: 'emu1', lane: 'test' })] }, {}, {});
        assert.deepStrictEqual(r.published.sort(), ['device-ask:T1', 'device-hold:emu1']);
        assert.deepStrictEqual(mineT().map((n) => n.id).sort(), ['device-ask:T1', 'device-hold:emu1']);
        assert.strictEqual(mine().length, 0, 'the household sees nothing of it');
        assert.deepStrictEqual(mineT().find((n) => n.id === 'device-ask:T1').data.answerType, 'device_consent_answer');
        assert.ok(toPhones.every((n) => n.user === 'test'), 'only the test lane is pushed to');
        // the same ids on both lanes at once: one row each, in its own queue
        cn.sync({ asks: [ask({ leaseId: 'T1', lane: 'test' }), ask({ leaseId: 'T1' })], holds: [] }, {}, {});
        assert.deepStrictEqual(mine().map((n) => n.id), ['device-ask:T1']);
        assert.strictEqual(mineT().filter((n) => n.id === 'device-ask:T1').length, 1);
    });

    await test('#1305 test lane: clearing is per lane (an admin row and a test row never clear each other)', () => {
        const mineT = () => inbox.list('test').filter((n) => /^device-(ask|hold):/.test(n.id));
        const both = { asks: [ask({ leaseId: 'A1' }), ask({ leaseId: 'T1', lane: 'test', agentId: 'ag7', device: 'emu1' })], holds: [hold(), hold({ leaseId: 'T2', device: 'emu1', lane: 'test' })] };
        cn.sync(both, {}, {});
        assert.deepStrictEqual(mine().map((n) => n.id).sort(), ['device-ask:A1', 'device-hold:fold']);
        assert.deepStrictEqual(mineT().map((n) => n.id).sort(), ['device-ask:T1', 'device-hold:emu1']);
        // the test lane's ask and hold end: only its rows come down
        let r = cn.sync({ asks: [both.asks[0]], holds: [both.holds[0]] }, {}, {});
        assert.deepStrictEqual(r.cleared.sort(), ['device-ask:T1', 'device-hold:emu1']);
        assert.strictEqual(mineT().length, 0);
        assert.deepStrictEqual(mine().map((n) => n.id).sort(), ['device-ask:A1', 'device-hold:fold'], 'the household rows stay');
        // and the other way round (new leases: a cleared lease published again would stay cleared, as the inbox keeps it)
        const both2 = { asks: [ask({ leaseId: 'A2' }), ask({ leaseId: 'T3', lane: 'test', agentId: 'ag7', device: 'emu1' })], holds: [hold({ leaseId: 'L12' }), hold({ leaseId: 'T4', device: 'emu1', lane: 'test' })] };
        cn.sync(both2, {}, {});
        r = cn.sync({ asks: [both2.asks[1]], holds: [both2.holds[1]] }, {}, {});
        assert.deepStrictEqual(r.cleared.sort(), ['device-ask:A2', 'device-hold:fold']);
        assert.strictEqual(mine().length, 0);
        assert.deepStrictEqual(mineT().map((n) => n.id).sort(), ['device-ask:T3', 'device-hold:emu1'], 'the test rows stay');
        // an answered test ask comes down through clearAsk (the handler)
        assert.strictEqual(cn.clearAsk('T3'), true);
        assert.deepStrictEqual(mineT().map((n) => n.id), ['device-hold:emu1']);
        cn.sync({ asks: [], holds: [] }, {}, {});
        assert.strictEqual(mineT().length, 0);
    });

    await test('#1305 test lane: the one-sound gate is shared across lanes', () => {
        const t0 = Date.now();
        cn.sync({ asks: [ask({ leaseId: 'A1' }), ask({ leaseId: 'T1', lane: 'test', agentId: 'ag7', device: 'emu1' })], holds: [] }, {}, { now: t0 });
        assert.strictEqual(askedLoud(), 1, 'a burst across the two lanes is one sound');
    });

    await test('a hold long over is not published', () => {
        const r = cn.sync({ asks: [], holds: [hold({ endsAt: Date.now() - 10 * 60000 })] }, {}, {});
        assert.deepStrictEqual(r.published, []);
        assert.strictEqual(mine().length, 0);
    });

    await test('bad input never throws', () => {
        cn.sync(null, null, null);
        cn.sync({ asks: [null, {}, 5], holds: [null, {}] }, {}, { quiet: 'x' });
        assert.strictEqual(mine().length, 0);
    });

    // ---- the handler ----
    const registry = require('../modules/ws/wsPacketRegistry');
    const replies = [];
    const errors = [];
    require('../modules/ws/handlers/296-deviceConsentHandler').registerPackets({
        sendToClient: (ws, m) => replies.push(m),
        sendError: (ws, msg, code) => errors.push(code),
        globalResources: {}
    });
    const entry = registry.getWsPacketEntry('device_consent_answer');
    const call = async (message, clientInfo) => { replies.length = 0; errors.length = 0; await entry.handler({ ws: {}, message: Object.assign({ type: 'device_consent_answer', requestId: 'r1' }, message), clientInfo }); };

    await test('handler registered, destructive', () => {
        assert.ok(entry);
        assert.strictEqual(entry.meta.destructive, true);
    });

    await test('handler: allow through the notice id, notice cleared at once', async () => {
        cn.sync({ asks: [ask()], holds: [hold()] }, {}, {});
        await call({ id: 'device-ask:L1', answer: 'allow' }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(answers.map((a) => a.slice(0, 2)), [['L1', 'allow']]);
        assert.ok(/^household:/.test(answers[0][2]));
        assert.deepStrictEqual(replies[0].data, { ok: true });
        assert.strictEqual(replies[0].type, 'device_consent_answer_response');
        assert.strictEqual(replies[0].requestId, 'r1');
        assert.deepStrictEqual(mine().map((n) => n.id), ['device-hold:fold']);
    });

    await test('the in-use notice carries an End button (a call to action) and the app link sends it', async () => {
        cn.sync({ asks: [], holds: [hold()] }, {}, {});
        const n = mine().find((x) => x.id === 'device-hold:fold');
        assert.ok(n && n.data && n.data.answerType === 'device_consent_answer');
        assert.deepStrictEqual(n.data.buttons, [{ id: 'end', label: 'End' }]);
        assert.deepStrictEqual(n.actions, [{ id: 'end', label: 'End' }]);
        ends.length = 0;
        await call({ data: { id: 'device-hold:fold', answer: 'end' } }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(ends.map((e) => e[0]), ['fold']);
        assert.ok(/^household:/.test(ends[0][1]));
        assert.deepStrictEqual(replies[0].data, { ok: true });
        assert.strictEqual(mine().filter((x) => x.id === 'device-hold:fold').length, 0, 'its notice is cleared');
        nextEnd = { ok: false, error: 'Nobody holds that device any more' };
        await call({ id: 'device-hold:fold', answer: 'end' }, { userType: 'admin', clientId: 'c1' });
        assert.strictEqual(replies[0].data.ok, false);
        nextEnd = { ok: true };
        await call({ id: 'device-hold:fold', answer: 'allow' }, { userType: 'admin', clientId: 'c1' });
        assert.strictEqual(replies[0].data.ok, false, 'only End answers a hold');
    });

    await test('handler: bare lease id, deny, fields in data (the app link)', async () => {
        cn.sync({ asks: [ask()], holds: [] }, {}, {});
        await call({ data: { id: 'L1', answer: 'deny' } }, { userType: 'dev_admin', clientId: 'c1' });
        assert.deepStrictEqual(answers.map((a) => a.slice(0, 2)), [['L1', 'deny']]);
        assert.strictEqual(mine().length, 0);
    });

    await test('handler: a refused answer reports the error and still clears', async () => {
        cn.sync({ asks: [ask()], holds: [] }, {}, {});
        nextResult = { ok: false, error: 'already answered' };
        await call({ id: 'L1', answer: 'allow' }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(replies[0].data, { ok: false, error: 'already answered' });
        assert.strictEqual(mine().length, 0);
    });

    await test('handler: bad answer, non-admin and the test lane are refused', async () => {
        cn.sync({ asks: [ask()], holds: [] }, {}, {});
        await call({ id: 'L1', answer: 'maybe' }, { userType: 'admin', clientId: 'c1' });
        assert.strictEqual(replies[0].data.ok, false);
        await call({ id: 'L1', answer: 'allow' }, { userType: 'guest', clientId: 'c2' });
        assert.deepStrictEqual(errors, ['INSUFFICIENT_PERMISSIONS']);
        const testDevices = require('../modules/testDevices');
        const orig = testDevices.isTestInfo;
        testDevices.isTestInfo = () => true;
        try { await call({ id: 'L1', answer: 'allow' }, { userType: 'admin', clientId: 'tst' }); } finally { testDevices.isTestInfo = orig; }
        assert.strictEqual(replies[0].data.ok, false);
        assert.strictEqual(replies[0].data.error, 'test device');
        assert.deepStrictEqual(answers, []);
        assert.strictEqual(mine().length, 1);
    });

    const callS = async (type, message, clientInfo) => { replies.length = 0; errors.length = 0; patches.length = 0; await registry.getWsPacketEntry(type).handler({ ws: {}, message: Object.assign({ type, requestId: 'r2' }, message), clientInfo }); };
    const ADMIN = { userType: 'admin', clientId: 'c1' };
    const bridge = require('../modules/agentClientBridge');
    const asTest = async (fn) => { const td = require('../modules/testDevices'); const orig = td.isTestInfo; td.isTestInfo = () => true; try { await fn(); } finally { td.isTestInfo = orig; } };
    const mineOn = (user) => inbox.list(user).filter((n) => /^device-(ask|hold):/.test(n.id));

    await test('#1305 S1 lane: a test client answers a test-lane ask (accepted, its notice cleared); a household ask stays refused for it', async () => {
        cn.sync({ asks: [ask({ leaseId: 'T1', lane: 'test', device: 'emulator-5554' }), ask({ leaseId: 'L1' })], holds: [] }, {}, {});
        assert.strictEqual(mineOn('test').length, 1);
        assert.strictEqual(mineOn('admin').length, 1);
        lanesAsk.T1 = 'test';
        await asTest(async () => {
            await call({ id: 'device-ask:T1', answer: 'allow' }, { userType: 'admin', clientId: 'tst' });
            assert.deepStrictEqual(replies[0].data, { ok: true });
            assert.deepStrictEqual(answers.map((a) => [a[0], a[1], a[3]]), [['T1', 'allow', { clientLane: 'test' }]]);
            assert.strictEqual(mineOn('test').length, 0, 'the test-lane notice came down');
            assert.strictEqual(mineOn('admin').length, 1, 'the household notice is untouched');
            answers.length = 0;
            await call({ id: 'L1', answer: 'allow' }, { userType: 'admin', clientId: 'tst' });
            assert.deepStrictEqual(replies[0].data, { ok: false, error: 'test device' });
            assert.deepStrictEqual(answers, [], 'a test client never answers a household ask');
            assert.strictEqual(mineOn('admin').length, 1, 'the question is still open');
        });
    });

    await test('#1305 S1 lane: an admin client answers a test-lane ask too', async () => {
        cn.sync({ asks: [ask({ leaseId: 'T1', lane: 'test', device: 'emulator-5554' })], holds: [] }, {}, {});
        lanesAsk.T1 = 'test';
        await call({ id: 'T1', answer: 'deny' }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(replies[0].data, { ok: true });
        assert.deepStrictEqual(answers.map((a) => [a[0], a[1], a[3]]), [['T1', 'deny', { clientLane: 'admin' }]]);
        assert.strictEqual(mineOn('test').length, 0);
    });

    await test('#1305 S1 lane: End on a test-lane hold from a test client; a household hold refused for it', async () => {
        cn.sync({ asks: [], holds: [hold({ leaseId: 11, device: 'emulator-5554', lane: 'test' }), hold({ leaseId: 12 })] }, {}, {});
        lanesDev['emulator-5554'] = 'test';
        await asTest(async () => {
            await call({ id: 'device-hold:emulator-5554', answer: 'end' }, { userType: 'admin', clientId: 'tst' });
            assert.deepStrictEqual(replies[0].data, { ok: true });
            assert.deepStrictEqual(ends.map((e) => [e[0], e[2]]), [['emulator-5554', { leaseId: '11', clientLane: 'test' }]]);
            assert.strictEqual(mineOn('test').length, 0);
            ends.length = 0;
            await call({ id: 'device-hold:fold', answer: 'end' }, { userType: 'admin', clientId: 'tst' });
            assert.deepStrictEqual(replies[0].data, { ok: false, error: 'test device' });
            assert.deepStrictEqual(ends, []);
            assert.strictEqual(mineOn('admin').length, 1, 'the household hold stays');
        });
    });

    await test('#1305 S2: End carries the lease its notice was about: a stale End reaches the server with the OLD lease id, never a newer one', async () => {
        cn.sync({ asks: [], holds: [hold({ leaseId: 21 })] }, {}, {});
        cn.sync({ asks: [], holds: [] }, {}, {}); // A released: its notice is cleared (the row stays, with leaseId 21)
        cn.sync({ asks: [ask({ leaseId: 22, device: 'fold' })], holds: [] }, {}, {}); // B pending
        await call({ id: 'device-hold:fold', answer: 'end' }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(ends.map((e) => [e[0], e[2].leaseId]), [['fold', '21']], 'the stale lease, so the server refuses it');
        assert.strictEqual(mineOn('admin').filter((x) => x.id === 'device-ask:22').length, 1, "B's ask untouched");
    });

    await test('#1305 S2: End with no notice at all, or a packet lease id that is not the notice\'s, ends nothing: That hold is over', async () => {
        await call({ id: 'device-hold:fold', answer: 'end' }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(replies[0].data, { ok: false, error: 'That hold is over' });
        assert.deepStrictEqual(ends, []);
        cn.sync({ asks: [], holds: [hold({ leaseId: 31 })] }, {}, {});
        await call({ id: 'device-hold:fold', answer: 'end', leaseId: 30 }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(replies[0].data, { ok: false, error: 'That hold is over' });
        assert.deepStrictEqual(ends, [], 'the client saw lease 30, the hold now is 31');
        assert.strictEqual(mineOn('admin').length, 1, 'the notice of the new hold stays');
        await call({ data: { id: 'device-hold:fold', answer: 'end', leaseId: 31 } }, { userType: 'admin', clientId: 'c1' });
        assert.deepStrictEqual(replies[0].data, { ok: true });
        assert.deepStrictEqual(ends.map((e) => e[2].leaseId), ['31']);
    });

    const markDriven = (id) => { const info = { userType: 'admin', clientId: id }; bridge._test.noteAgentDriven(info, 'run_client_js'); return info; };

    await test('#1305 S4: a client an agent ran script on is refused for answers, End and settings sets (logged); a person\'s client and settings get are not', async () => {
        cn.sync({ asks: [ask()], holds: [hold()] }, {}, {});
        const warns = [];
        const w = console.warn;
        console.warn = (...a) => { warns.push(a.join(' ')); };
        try {
            const info = markDriven('agentdrv1');
            await call({ id: 'device-ask:L1', answer: 'allow' }, info);
            assert.deepStrictEqual(replies[0].data, { ok: false, error: 'An agent cannot answer for Yukimi' });
            await call({ id: 'device-hold:fold', answer: 'end' }, info);
            assert.deepStrictEqual(replies[0].data, { ok: false, error: 'An agent cannot answer for Yukimi' });
            assert.deepStrictEqual(answers, []);
            assert.deepStrictEqual(ends, []);
            assert.strictEqual(mine().length, 2, 'both notices still there');
            assert.strictEqual(warns.filter((x) => /refused an answer from an agent-driven client agentdrv1/.test(x)).length, 2, warns.join('|'));
            await callS('device_consent_settings_set', { patch: { onTimeout: 'allow' } }, info);
            assert.deepStrictEqual(replies[0].data, { ok: false, error: 'An agent cannot answer for Yukimi' });
            assert.deepStrictEqual(patches, [], 'an agent cannot set onTimeout allow');
            assert.ok(warns.some((x) => /refused a settings change from an agent-driven client agentdrv1/.test(x)));
            await callS('device_consent_settings_get', {}, info);
            assert.strictEqual(replies[0].data.ok, true, 'reading the settings is fine');
            // a different client (a person's tab) answers as before
            await call({ id: 'device-ask:L1', answer: 'allow' }, { userType: 'admin', clientId: 'person1' });
            assert.deepStrictEqual(replies[0].data, { ok: true });
            // the marking is by client id too: the same tab after a reload (a new socket info) is still an agent's for 120 s
            await call({ id: 'device-hold:fold', answer: 'end' }, { userType: 'admin', clientId: 'agentdrv1' });
            assert.strictEqual(replies[0].data.error, 'An agent cannot answer for Yukimi');
            // 120 s on, it is a person's again
            bridge._test.agentDrivenAt.set('agentdrv1', Date.now() - 121000);
            await call({ id: 'device-hold:fold', answer: 'end' }, { userType: 'admin', clientId: 'agentdrv1' });
            assert.deepStrictEqual(replies[0].data, { ok: true });
        } finally { console.warn = w; }
    });

    await test('#1305 S4: the bridge marks a client only when an agent ran script on it (run_client_js, inspect_elements), for 120 s', async () => {
        const WebSocket = require('ws');
        const info = { clientId: 'brdg00000001', authenticated: true };
        const ws = { readyState: WebSocket.OPEN };
        const sentTo = [];
        const gr = { getWebSocketServer: () => ({ clients: new Map([[ws, info]]), sendToClient: (w2, m) => sentTo.push(m) }) };
        assert.strictEqual(bridge.isAgentDrivenClient(info), false);
        for (const cmd of ['get_state', 'get_windows', 'apply_studio', 'open_image', 'client_restart']) {
            bridge.sendClientCommand(gr, 'brdg00000001', cmd, {}, 50).catch(() => {});
            assert.strictEqual(bridge.isAgentDrivenClient(info), false, `${cmd} is no script`);
        }
        bridge.sendClientCommand(gr, 'brdg00000001', 'run_client_js', { script: '1' }, 50).catch(() => {});
        assert.strictEqual(bridge.isAgentDrivenClient(info), true);
        assert.strictEqual(bridge.isAgentDrivenClient(info, Date.now() + 119000), true);
        assert.strictEqual(bridge.isAgentDrivenClient(info, Date.now() + 121000), false);
        assert.strictEqual(bridge.isAgentDrivenClient({ clientId: 'brdg00000001' }), true, 'by client id, across a reload');
        const info2 = { clientId: 'brdg00000002', authenticated: true };
        gr.getWebSocketServer = () => ({ clients: new Map([[ws, info2]]), sendToClient: () => {} });
        bridge.sendClientCommand(gr, 'brdg00000002', 'inspect_elements', { selectors: [] }, 50).catch(() => {});
        assert.strictEqual(bridge.isAgentDrivenClient(info2), true);
        assert.strictEqual(bridge.isAgentDrivenClient(null), false);
        assert.strictEqual(bridge.isAgentDrivenClient({ clientId: 'someone-else' }), false);
        await new Promise((r) => setTimeout(r, 120)); // the 50 ms command timeouts settle
    });

    // ---- the settings packets ----

    await test('settings packets registered: get plain, set destructive', () => {
        assert.ok(registry.getWsPacketEntry('device_consent_settings_get'));
        assert.notStrictEqual(registry.getWsPacketEntry('device_consent_settings_get').meta.destructive, true);
        assert.strictEqual(registry.getWsPacketEntry('device_consent_settings_set').meta.destructive, true);
    });

    await test('settings get: the settings in force', async () => {
        await callS('device_consent_settings_get', {}, ADMIN);
        assert.strictEqual(replies[0].type, 'device_consent_settings_get_response');
        assert.strictEqual(replies[0].requestId, 'r2');
        assert.strictEqual(replies[0].data.ok, true);
        assert.deepStrictEqual(replies[0].data.settings.consentDevices, ['a53', 'fold']);
    });

    await test('settings set: patch goes through, the settings come back (also in data)', async () => {
        await callS('device_consent_settings_set', { patch: { onTimeout: 'deny', timeoutSec: 90 } }, ADMIN);
        assert.deepStrictEqual(patches, [{ onTimeout: 'deny', timeoutSec: 90 }]);
        assert.strictEqual(replies[0].data.ok, true);
        assert.strictEqual(replies[0].data.settings.onTimeout, 'deny');
        await callS('device_consent_settings_set', { data: { patch: { readOnly: 'allow' } } }, { userType: 'dev_admin', clientId: 'c1' });
        assert.deepStrictEqual(patches, [{ readOnly: 'allow' }]);
    });

    await test('settings set: bad patch, out-of-range wait and an invalid field report an error and save nothing', async () => {
        for (const message of [{}, { patch: 'x' }, { patch: [] }, { patch: { timeoutSec: 5 } }, { patch: { timeoutSec: 601 } }, { patch: { timeoutSec: 'abc' } }]) {
            await callS('device_consent_settings_set', message, ADMIN);
            assert.strictEqual(replies[0].data.ok, false, JSON.stringify(message));
            assert.ok(replies[0].data.error);
            assert.deepStrictEqual(patches, []);
        }
        await callS('device_consent_settings_set', { patch: { onTimeout: 'bogus' } }, ADMIN);
        assert.strictEqual(replies[0].data.ok, false);
        assert.ok(/onTimeout/.test(replies[0].data.error));
    });

    await test('settings packets: non-admin and the test lane are refused', async () => {
        for (const type of ['device_consent_settings_get', 'device_consent_settings_set']) {
            await callS(type, { patch: { readOnly: 'allow' } }, { userType: 'guest', clientId: 'c2' });
            assert.deepStrictEqual(errors, ['INSUFFICIENT_PERMISSIONS']);
            assert.strictEqual(replies.length, 0);
            const testDevices = require('../modules/testDevices');
            const orig = testDevices.isTestInfo;
            testDevices.isTestInfo = () => true;
            try { await callS(type, { patch: { readOnly: 'allow' } }, ADMIN); } finally { testDevices.isTestInfo = orig; }
            assert.strictEqual(replies[0].data.ok, false);
            assert.strictEqual(replies[0].data.error, 'test device');
            assert.deepStrictEqual(patches, []);
        }
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `${failed} FAILED` : 'all passed');
    process.exit(failed ? 1 : 0);
})();
