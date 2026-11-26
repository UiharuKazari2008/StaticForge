#!/usr/bin/env node
'use strict';
// XM Radio's per-slot SiriusXM accounts (Yozora #1252 S2): N virtual radios, N sessions. No SiriusXM network: fetch is
// stubbed; the recorder service is run for real over its socket, in a temp folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const EventEmitter = require('events');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmslots-'));
const account = path.join(dir, 'xmradio-account.json');
process.env.XMRADIO_ACCOUNT_FILE = account;

const future = (ms) => new Date(Date.now() + ms).toISOString();
const DAY = 24 * 3600 * 1000;
const slot1File = {
    deviceId: 'dev-one', grant: 'grant-slot1', grantExpiresAt: future(20 * DAY), refreshGrant: 'rg-slot1', refreshGrantExpiresAt: future(150 * DAY),
    identityId: 'id-one', identityGrant: 'idg-slot1', handle: 'yukimi@example.com', signedInAt: 1000
};
fs.writeFileSync(account, JSON.stringify(slot1File));
const accountBefore = fs.readFileSync(account, 'utf8');

// ---- the stubbed SiriusXM
const calls = [];
let devices = 0;
const REFUSED = { 'tok-idg-two': new Set(['bbbbbbbbbbbbbbbbbbbbbbbb']) }; // slot 2's account is not entitled to channel B
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
let hash2 = 'EHASH-TWO-1';
global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const bearer = String((opts.headers && opts.headers.Authorization) || '').replace(/^Bearer /, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method, path: u.pathname, bearer, body });
    const out = (status, json) => ({ status, text: async () => (json === undefined ? '' : JSON.stringify(json)) });
    const p = u.pathname;
    if (p === '/device/v2/devices') { devices++; return out(200, { deviceId: `dev-${devices}`, grant: `grant-new${devices}`, grantExpiresAt: future(30 * DAY), refreshGrant: `rg-new${devices}`, refreshGrantExpiresAt: future(180 * DAY) }); }
    if (p === '/session/v1/sessions/anonymous') return out(200, { accessToken: `anon-${bearer}`, accessTokenExpiresAt: future(3 * 3600000), entitlementHash: '' });
    if (p === '/identity/v1/identities/authenticate/password') {
        if (body.password !== 'right-pw') return out(401, { code: 'bad' });
        return out(200, { identityId: `id-${body.handle}`, grant: body.handle === 'two@example.com' ? 'idg-two' : `idg-${body.handle}` });
    }
    if (p === '/session/v1/sessions/authenticated') {
        const hash = bearer === 'idg-two' ? hash2 : `EHASH-${bearer}`;
        return out(200, { accessToken: `tok-${bearer}`, accessTokenExpiresAt: future(3 * 3600000), entitlementHash: hash });
    }
    if (p === '/playback/play/v1/tuneSource') {
        if ((REFUSED[bearer] || new Set()).has(body.id)) return out(403, { code: 'playback.not-entitled' });
        return out(200, { streams: [{ urls: [{ url: `https://live-akc-prod-device.streaming.siriusxm.com/v1/${bearer}/${body.id}/master.m3u8` }] }] });
    }
    if (p.startsWith('/playback/key/v1/')) return out(200, { key: '00112233445566778899aabbccddeeff', usedBearer: bearer });
    return out(404, {});
};

const xm = require('../modules/xmRadio');
const { maskHandle } = xm._test;

const tokensOnWire = () => calls.filter((c) => c.path === '/playback/play/v1/tuneSource').map((c) => c.bearer);

(async () => {
    let changes = 0;
    xm.onSlots(() => { changes++; });

    // slot 1 resolves to the existing account; slots 2..4 are "Not set up", with no device of their own yet
    let list = xm.slots();
    assert.strictEqual(list.length, 4, 'the default is four slots');
    assert.deepStrictEqual(list.map((s) => s.name), ['Lizumi-Recorder-1', 'Lizumi-Recorder-2', 'Lizumi-Recorder-3', 'Lizumi-Recorder-4']);
    assert.strictEqual(list[0].signedIn, true);
    assert.strictEqual(list[0].handle, maskHandle('yukimi@example.com'));
    assert.strictEqual(list[0].since, 1000);
    assert.strictEqual(list[1].signedIn, false);
    assert.strictEqual(list[1].handle, '');
    assert.strictEqual(devices, 0, 'an empty slot registers no device');
    assert.strictEqual(await xm.accessTokens().then((a) => a.length), 1, 'only slot 1 is signed in');
    assert.strictEqual(devices, 0, 'asking for tokens does not register devices for empty slots');
    assert.strictEqual(await xm._test.slotSet().token(3), null, 'an empty slot has no token');
    assert.strictEqual(devices, 0);

    // slot 1 tunes with the radio's own token, exactly as before
    let t = await xm.tuneUpstream(A);
    assert.ok(t.url.includes('/tok-idg-slot1/'), 'no slot: the radio account');
    t = await xm.tuneUpstream(A, { slot: 1 });
    assert.ok(t.url.includes('/tok-idg-slot1/'));
    assert.ok(t.url.startsWith('https://'));

    // a bad password signs nothing in and says why on the slot
    await assert.rejects(xm.slotSignIn(2, 'two@example.com', 'wrong-pw'), /not right/);
    list = xm.slots();
    assert.strictEqual(list[1].signedIn, false);
    assert.ok(/not right/.test(list[1].lastError) && list[1].lastErrorAt > 0, 'the console sees the last error');
    assert.strictEqual(devices, 1, 'the failed try registered the slot\'s device');

    // slot 2 signs in on its OWN device with its own session
    const entry = await xm.slotSignIn(2, 'two@example.com', 'right-pw');
    assert.strictEqual(entry.slot, 2);
    assert.strictEqual(entry.signedIn, true);
    assert.strictEqual(devices, 1, 'the same device, not a second registration');
    assert.strictEqual(entry.lastError, '', 'a good sign-in clears the error');
    assert.strictEqual(fs.readFileSync(account, 'utf8'), accountBefore, 'the radio account file is untouched');
    const slotsFile = JSON.parse(fs.readFileSync(path.join(dir, 'xmradio-slots.json'), 'utf8'));
    assert.strictEqual(slotsFile.count, 4);
    assert.deepStrictEqual(slotsFile.accounts.map((a) => a.slot), [2, 3, 4], 'slots 2..4 are in the file, 3 and 4 empty');
    assert.strictEqual((fs.statSync(path.join(dir, 'xmradio-slots.json')).mode & 0o777), 0o600);
    assert.strictEqual(slotsFile.accounts[0].grant, 'grant-new1');
    assert.strictEqual(slotsFile.accounts[0].identityGrant, 'idg-two');
    assert.ok(!fs.readFileSync(path.join(dir, 'xmradio-slots.json'), 'utf8').includes('right-pw'), 'the password is never kept');
    assert.ok(changes > 0, 'a slot change is announced');

    // the device registration came from slot 2's own call, and slot 2's session used slot 2's grant
    const reg = calls.filter((c) => c.path === '/device/v2/devices');
    assert.strictEqual(reg.length, 1);
    assert.ok(calls.some((c) => c.path === '/session/v1/sessions/authenticated' && c.bearer === 'idg-two'));

    // tuning with slot 2 uses slot 2's token (and its key call too), not the radio's
    t = await xm.tuneUpstream(A, { slot: 2 });
    assert.ok(t.url.includes('/tok-idg-two/'), 'slot 2 tunes with its own token');
    assert.deepStrictEqual(tokensOnWire().slice(-1), ['tok-idg-two']);
    await xm.keyBytes('https://api.edge-gateway.siriusxm.com/playback/key/v1/efc21546-0b86-4b4c-ac8a-17981f0534cf', { slot: 2 });
    assert.strictEqual(calls[calls.length - 1].bearer, 'tok-idg-two');
    await xm.keyBytes('https://api.edge-gateway.siriusxm.com/playback/key/v1/efc21546-0b86-4b4c-ac8a-17981f0534cf');
    assert.strictEqual(calls[calls.length - 1].bearer, 'tok-idg-slot1', 'no slot: the radio account');
    // slot 3 is empty: tuning on it asks for a sign-in and calls nothing
    const n = calls.length;
    await assert.rejects(xm.tuneUpstream(A, { slot: 3 }), (e) => e.code === 'XMRADIO_SIGNED_OUT');
    assert.strictEqual(calls.length, n);

    // tokens for the recorder: one per signed-in slot, each with its slot
    const toks = await xm.accessTokens();
    assert.deepStrictEqual(toks.map((a) => a.slot), [1, 2]);
    assert.strictEqual(toks[0].token, 'tok-idg-slot1');
    assert.strictEqual(toks[1].token, 'tok-idg-two');
    assert.strictEqual(toks[1].entitlementHash, 'EHASH-TWO-1');
    assert.ok(toks.every((a) => a.exp > Date.now()));
    assert.strictEqual((await xm.accessToken()).token, 'tok-idg-slot1', 'accessToken is still the radio account');

    // slots() never leaks a grant, a token or a password
    list = xm.slots();
    const text = JSON.stringify(list);
    for (const secret of ['grant-', 'idg-', 'tok-', 'rg-', 'right-pw', 'anon-', 'two@example.com']) assert.ok(!text.includes(secret), `slots() leaks ${secret}`);
    assert.deepStrictEqual(Object.keys(list[1]).sort(), ['entitlementHash', 'handle', 'lastError', 'lastErrorAt', 'name', 'refused', 'signedIn', 'since', 'slot', 'tokenExp']);
    assert.strictEqual(list[1].handle, maskHandle('two@example.com'));
    assert.strictEqual(list[1].entitlementHash, 'EHASH-TW');
    assert.ok(list[1].tokenExp > Date.now());
    assert.strictEqual(list[1].since > 0, true);

    // entitlement: a tuneSource refusal is learned for that slot's account only
    assert.strictEqual(xm.slotCanPlay(2, B), true, 'nothing refused yet');
    await assert.rejects(xm.tuneUpstream(B, { slot: 2 }), (e) => e.code === 'XMRADIO_NOT_SUBSCRIBED');
    assert.strictEqual(xm.slotCanPlay(2, B), false, 'slot 2 learned its refusal');
    assert.strictEqual(xm.slotCanPlay(2, A), true);
    assert.strictEqual(xm.slotCanPlay(1, B), true, 'another account is not affected');
    assert.strictEqual(xm.slotCanPlay(3, A), false, 'a slot nobody signed in on can play nothing');
    assert.strictEqual(xm.slots()[1].refused, 1);
    const ent = JSON.parse(fs.readFileSync(path.join(dir, 'xmradio-slot-entitlement.json'), 'utf8'));
    assert.deepStrictEqual(ent[2], { hash: 'EHASH-TWO-1', refused: [B] });
    // the lineup's "not in plan" mark stays the radio account's: slot 2's refusal did not touch it
    // a new entitlementHash (the plan changed) starts the refusals again
    xm._test.slotSet().noteHash(2, 'EHASH-TWO-2');
    assert.strictEqual(xm.slotCanPlay(2, B), true);
    assert.strictEqual(xm.slots()[1].refused, 0);

    // the recorder: a second recording on a slot that already streams is refused (not slot 1); the slot's token reaches
    // the pump's tune and key calls
    const pumpMod = require('../modules/xmRadioPump');
    const pumps = [];
    pumpMod.createPump = (o) => {
        const e = new EventEmitter();
        e.opts = o;
        e.start = () => {};
        e.stop = async () => {};
        pumps.push(e);
        return e;
    };
    const channels = { [A]: { name: 'A', number: 1 }, [B]: { name: 'B', number: 2 }, cccccccccccccccccccccccc: { name: 'C', number: 3 } };
    const recorder = require('../modules/xmRadioRecorder');
    const rxm = Object.assign({}, xm, { channelById: (id) => channels[id] || null, nowPlayingCuts: () => [], watch: () => {}, onLook: () => {}, imageUrlFor: () => '' });
    recorder.init(rxm, null, { resumeMs: 1e9 });
    const r2 = await recorder.start({ channelId: A, kind: 'manual', mode: 'long', slot: 2 });
    assert.strictEqual(r2.slot, 2);
    assert.strictEqual(recorder._test.recs.get(r2.rid).meta.slot, 2);
    await pumps[0].opts.tune(A);
    assert.strictEqual(tokensOnWire().slice(-1)[0], 'tok-idg-two', 'the pump of a slot 2 recording tunes with slot 2');
    await pumps[0].opts.keyBytes('https://api.edge-gateway.siriusxm.com/playback/key/v1/efc21546-0b86-4b4c-ac8a-17981f0534cf');
    assert.strictEqual(calls[calls.length - 1].bearer, 'tok-idg-two');
    await assert.rejects(recorder.start({ channelId: 'cccccccccccccccccccccccc', kind: 'manual', mode: 'long', slot: 2 }), (e) => e.code === 'XMRADIO_SLOT_BUSY');
    // the same channel on the same slot is the one recording, as before
    assert.strictEqual((await recorder.start({ channelId: A, kind: 'manual', mode: 'long', slot: 2 })).rid, r2.rid);
    // an empty slot cannot start
    await assert.rejects(recorder.start({ channelId: 'cccccccccccccccccccccccc', kind: 'manual', mode: 'long', slot: 3 }), (e) => e.code === 'XMRADIO_SIGNED_OUT');
    await assert.rejects(recorder.start({ channelId: A, kind: 'manual', slot: 9 }), (e) => e.code === 'XMRADIO_SLOT');
    // slot 1 keeps today's behaviour: several recordings on the one account
    const s1a = await recorder.start({ channelId: B, kind: 'manual', mode: 'long' });
    const s1b = await recorder.start({ channelId: 'cccccccccccccccccccccccc', kind: 'manual', mode: 'long' });
    assert.strictEqual(s1a.slot, 1);
    assert.strictEqual(s1b.slot, 1);
    await pumps[1].opts.tune(B);
    assert.strictEqual(tokensOnWire().slice(-1)[0], 'tok-idg-slot1');
    for (const r of [r2, s1a, s1b]) await recorder.stop(r.rid);

    // sign-out: the slot's sign-in goes, its device stays, the token is gone
    const out = xm.slotSignOut(2);
    assert.strictEqual(out.signedIn, false);
    assert.strictEqual(out.handle, '');
    assert.strictEqual(await xm._test.slotSet().token(2), null);
    assert.strictEqual(xm._test.slotSet()._entry(2).grant, 'grant-new1', 'the device is kept');
    assert.deepStrictEqual((await xm.accessTokens()).map((a) => a.slot), [1]);
    // signing in again reuses the device
    await xm.slotSignIn(2, 'two@example.com', 'right-pw');
    assert.strictEqual(devices, 1, 'no second device for the same slot');

    // the count is a setting: 1..8, kept; slots above it are hidden and not pushed
    assert.strictEqual(xm.setSlotCount(6), 6);
    assert.strictEqual(xm.slots().length, 6);
    assert.strictEqual(xm.setSlotCount(1), 1);
    assert.deepStrictEqual((await xm.accessTokens()).map((a) => a.slot), [1]);
    assert.strictEqual(xm.setSlotCount(4), 4);
    assert.strictEqual(xm.slots()[1].signedIn, true, 'slot 2 kept its account while hidden');
    assert.throws(() => xm.setSlotCount(0), /1 to 8/);
    assert.throws(() => xm.setSlotCount(9), /1 to 8/);
    // a new process reads the same file
    xm.reloadAccount();
    assert.strictEqual(xm.slots()[1].signedIn, true);
    assert.strictEqual(xm.slotCount(), 4);

    // the one-time browser page can name a slot
    assert.ok(xm.signInPageStart({ slot: 3 }).url.includes('/xmradio-signin/'));
    assert.strictEqual(xm.account().browserSignIn, null, 'a slot 3 page is not the radio account');
    assert.throws(() => xm.signInPageStart({ slot: 12 }), /no slot/);
    xm.signInPageCancel();

    await recorderService();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('xmradio slots: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// ---- the recorder service itself, over its socket: one token per slot, kept per slot, no slot = slot 1
async function recorderService() {
    const sdir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmslotsvc-'));
    const sAccount = path.join(sdir, 'xmradio-account.json');
    const sock = path.join(sdir, 'xmradio-recorder.sock');
    const authFile = path.join(sdir, 'xmradio-recorder-auth.json');
    fs.writeFileSync(sAccount, '{}');
    // the file from before the slots: one bare entry is slot 1
    fs.writeFileSync(authFile, JSON.stringify({ token: 'legacy', exp: Date.now() + 3 * 3600000, entitlementHash: 'LEGACYHASH' }));

    const run = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, '../services/xmradio-recorder/server.js')], { env: { ...process.env, XMRADIO_ACCOUNT_FILE: sAccount }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`the service did not listen: ${log}`)); }, 15000);
        const onData = (d) => { log += d; if (/listening on/.test(log)) { clearTimeout(timer); resolve(child); } };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', () => clearTimeout(timer));
    });
    const ask = (op, args) => new Promise((resolve, reject) => {
        const s = net.createConnection(sock);
        let buf = '';
        s.setEncoding('utf8');
        s.on('connect', () => s.write(`${JSON.stringify({ id: 1, op, args })}\n`));
        s.on('data', (d) => {
            buf += d;
            for (const line of buf.split('\n')) {
                if (!line) continue;
                let m;
                try { m = JSON.parse(line); } catch (_) { continue; }
                if (m.id === 1) { s.destroy(); m.ok ? resolve(m.result) : reject(new Error(m.error.message)); }
            }
        });
        s.on('error', reject);
    });
    const stopIt = (child) => new Promise((ok) => { child.on('exit', ok); child.kill('SIGTERM'); });

    let child = await run();
    try {
        let held = await ask('slots', {});
        assert.deepStrictEqual(held.map((h) => h.slot), [1], 'the old bare file is slot 1');
        assert.strictEqual(held[0].entitlementHash, 'LEGACYHA');
        // an op auth with no slot sets slot 1; with a slot, that slot
        assert.strictEqual(await ask('auth', { token: 'one-new', exp: Date.now() + 2 * 3600000, entitlementHash: 'H1' }), true);
        assert.strictEqual(await ask('auth', { slot: 2, token: 'two-tok', exp: Date.now() + 2 * 3600000, entitlementHash: 'H2' }), true);
        assert.strictEqual(await ask('auth', { slot: 3, token: 'three-tok', exp: Date.now() + 2 * 3600000 }), true);
        held = await ask('slots', {});
        assert.deepStrictEqual(held.map((h) => h.slot), [1, 2, 3]);
        assert.ok(!JSON.stringify(held).includes('tok'), 'the slots op never returns a token');
        let kept = JSON.parse(fs.readFileSync(authFile, 'utf8'));
        assert.strictEqual(kept[1].token, 'one-new', 'no slot is slot 1');
        assert.strictEqual(kept[2].token, 'two-tok');
        assert.strictEqual(kept[3].token, 'three-tok');
        assert.strictEqual((fs.statSync(authFile).mode & 0o777), 0o600);
        // a signed-out slot is dropped, here and in the file
        await ask('auth', { slot: 3, clear: true });
        assert.deepStrictEqual((await ask('slots', {})).map((h) => h.slot), [1, 2]);
        assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(authFile, 'utf8'))), ['1', '2']);
        // the service never opens a SiriusXM session of its own: a slot it holds no token for has none
        await assert.rejects(ask('start', { channelId: 'nope', slot: 2 }), /No such channel/);
        // a restart keeps every slot's token (valid ones)
        await stopIt(child);
        child = await run();
        held = await ask('slots', {});
        assert.deepStrictEqual(held.map((h) => h.slot), [1, 2], 'a restart resumes with each slot\'s token');
    } finally {
        await stopIt(child);
        fs.rmSync(sdir, { recursive: true, force: true });
    }
}
