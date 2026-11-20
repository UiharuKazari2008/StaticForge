#!/usr/bin/env node
/**
 * modules/networkShares.js (DreamOS #910): who sees which computers in Network and what each user may do in a share.
 * No server, no database: ActiveSync's list is faked.   node scripts/test-network-shares.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const activeSyncPath = require.resolve(path.join(__dirname, '..', 'modules', 'activeSync'));
let devices = [];
const calls = [];
require.cache[activeSyncPath] = {
    id: activeSyncPath, filename: activeSyncPath, loaded: true,
    exports: {
        list: () => ({ devices, computers: [] }),
        serverCall: async (gr, server, deviceId, op, args, opts) => { calls.push({ deviceId, op, args, opts }); return { entries: [] }; }
    }
};
const ns = require(path.join(__dirname, '..', 'modules', 'networkShares'));

let n = 0;
const test = async (name, fn) => { await fn(); n += 1; console.log(`ok ${n} - ${name}`); };

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const wizard = (people) => ({ name: 'Pictures', comment: 'Holiday', limit: 2, available: true, people, permissions: [{ account: 'everyone', allow: ['full', 'change', 'read'], deny: [] }] });
const machine = (id, name, sharing, online = true) => ({ deviceId: id, name, platform: 'cafeready', online, status: { host: { sharing: ns.sanitizeSharing(sharing) } } });
const phone = { deviceId: 'd'.repeat(32), name: 'Galaxy', platform: 'android', online: true, status: {} };

// a page socket: on machine A (its Miniport carrier), or a plain browser tab
const carrierA = { _dsMiniport: true, _dsDevice: A };
const wsOnA = { virtual: true, carrier: carrierA };
const wsBrowser = {};
const sent = [];
function server(pages) {
    return { clients: new Map(pages), sendToClient: (ws, packet) => sent.push({ ws, packet }) };
}
const admin = (extra) => Object.assign({ authenticated: true, userType: 'admin', sessionId: 's-admin' }, extra);
const guest = (extra) => Object.assign({ authenticated: true, userType: 'readonly', sessionId: 's-guest' }, extra);

(async () => {
    await test('access: the wizard people list against the share permissions', () => {
        const s = wizard([{ account: 'administrator', level: 'owner' }, { account: 'guest', level: 'reader' }]);
        assert.strictEqual(ns.access(s, 'administrator'), 'full');
        assert.strictEqual(ns.access(s, 'guest'), 'read');
        assert.strictEqual(ns.access(wizard([{ account: 'everyone', level: 'contributor' }]), 'guest'), 'change');
        // admin is no bypass: not on the list = no access
        assert.strictEqual(ns.access(wizard([{ account: 'guest', level: 'coowner' }]), 'administrator'), 'none');
    });

    await test('access: Advanced Sharing (no people) is Everyone Read by default, denies win', () => {
        const adv = { people: [], permissions: [{ account: 'everyone', allow: ['read'], deny: [] }] };
        assert.strictEqual(ns.access(adv, 'administrator'), 'read');
        const d = { people: [], permissions: [{ account: 'everyone', allow: ['full'], deny: [] }, { account: 'guest', allow: [], deny: ['change'] }] };
        assert.strictEqual(ns.access(d, 'administrator'), 'full');
        assert.strictEqual(ns.access(d, 'guest'), 'read');
        assert.strictEqual(ns.access({ people: [], permissions: [{ account: 'everyone', allow: ['full'], deny: ['read'] }] }, 'guest'), 'none');
        assert.strictEqual(ns.access({ people: [], permissions: [] }, 'guest'), 'none');
    });

    await test('sanitize: unknown accounts, levels and rights are dropped; no paths survive', () => {
        const s = ns.sanitizeSharing({ discovery: true, fileSharing: true, shares: [{ name: 'X', path: '/data/x', drive: 'uuid', people: [{ account: 'root', level: 'owner' }, { account: 'guest', level: 'god' }, { account: 'guest', level: 'reader' }], permissions: [{ account: 'everyone', allow: ['read', 'own'] }] }] });
        assert.deepStrictEqual(s.shares[0].people, [{ account: 'guest', level: 'reader' }]);
        assert.deepStrictEqual(s.shares[0].permissions, [{ account: 'everyone', allow: ['read'], deny: [] }]);
        assert.strictEqual(s.shares[0].path, undefined);
        assert.strictEqual(s.shares[0].drive, undefined);
        assert.strictEqual(ns.sanitizeSharing({}).discovery, true, 'Vista: discovery on by default');
        assert.strictEqual(ns.sanitizeSharing({}).fileSharing, false, 'Vista: file sharing off by default');
    });

    const share = wizard([{ account: 'administrator', level: 'owner' }, { account: 'guest', level: 'reader' }]);
    devices = [
        machine(A, 'MACBOOK', { discovery: true, fileSharing: true, shares: [share] }),
        machine(B, 'DREAMOS-VM', { discovery: true, fileSharing: false, shares: [share] }),
        machine(C, 'HIDDEN', { discovery: false, fileSharing: true, shares: [share] }),
        phone
    ];

    await test('Network: never this machine, never a phone, never a machine with discovery off; empty shares still listed', () => {
        const srv = server([]);
        const onA = ns.computersFor({}, srv, admin(), wsOnA);
        assert.strictEqual(onA.self, A);
        assert.deepStrictEqual(onA.computers.map((c) => c.name), ['DREAMOS-VM']);
        // B lists, with no shares while its File sharing is off (Yukimi: every computer shows, shares or not)
        assert.deepStrictEqual(onA.computers[0].shares, []);
        const browser = ns.computersFor({}, srv, admin(), wsBrowser);
        assert.deepStrictEqual(browser.computers.map((c) => c.name), ['DREAMOS-VM', 'MACBOOK']);
        assert.deepStrictEqual(browser.computers.find((c) => c.name === 'MACBOOK').shares, [{ name: 'Pictures', comment: 'Holiday', access: 'full' }]);
        assert.strictEqual(ns.computersFor({}, srv, guest(), wsBrowser).computers.find((c) => c.name === 'MACBOOK').shares[0].access, 'read');
        assert.deepStrictEqual(ns.computersFor({}, srv, { authenticated: false }, wsBrowser).computers, []);
    });

    await test('Network: a machine with discovery off sees nobody', () => {
        const carrierC = { _dsMiniport: true, _dsDevice: C };
        const v = ns.computersFor({}, server([]), admin(), { virtual: true, carrier: carrierC });
        assert.strictEqual(v.discovery, false);
        assert.deepStrictEqual(v.computers, []);
    });

    await test('net_computers_updated goes only to watchers whose list changed', () => {
        const pageA = admin();
        const pageB = guest();
        const srv = server([[wsOnA, pageA], [wsBrowser, pageB]]);
        ns.watch({}, srv, pageA, wsOnA);
        ns.watch({}, srv, pageB, wsBrowser);
        sent.length = 0;
        ns.peersChanged({}, srv);
        assert.strictEqual(sent.length, 0, 'nothing changed');
        devices = devices.concat(machine('e'.repeat(32), 'NEWPC', { discovery: true, fileSharing: false, shares: [] }));
        ns.peersChanged({}, srv);
        assert.strictEqual(sent.length, 2);
        assert.ok(sent.every((x) => x.packet.type === 'net_computers_updated'));
        sent.length = 0;
        // a change only A's page reads? no: a share access change for the guest reaches the guest only
        devices = devices.map((d) => (d.deviceId === A ? machine(A, 'MACBOOK', { discovery: true, fileSharing: true, shares: [wizard([{ account: 'administrator', level: 'owner' }, { account: 'guest', level: 'contributor' }])] }) : d));
        ns.peersChanged({}, srv);
        assert.deepStrictEqual(sent.map((x) => x.ws), [wsBrowser]);
    });

    await test('share calls: checked here, then relayed with the account; Reader cannot write', async () => {
        ns.resetForTests();
        calls.length = 0;
        const srv = server([]);
        await ns.shareCall({}, srv, admin(), wsBrowser, { deviceId: A, share: 'pictures', op: 'list', path: '/2026' });
        assert.deepStrictEqual(calls[0].args, { root: 'share', share: 'Pictures', account: 'administrator', path: '/2026' });
        assert.strictEqual(calls[0].op, 'storage.list');
        await assert.rejects(ns.shareCall({}, srv, guest({ sessionId: 'g1' }), wsBrowser, { deviceId: B, share: 'Pictures', op: 'list' }), { code: 'SHARING_OFF' });
        await assert.rejects(ns.shareCall({}, srv, admin(), wsBrowser, { deviceId: A, share: 'Nope', op: 'list' }), { code: 'NO_SUCH_SHARE' });
        await assert.rejects(ns.shareCall({}, srv, admin(), wsOnA, { deviceId: A, share: 'Pictures', op: 'list' }), { code: 'NOT_FOUND' });
        await assert.rejects(ns.shareCall({}, srv, admin(), wsBrowser, { deviceId: C, share: 'Pictures', op: 'list' }), { code: 'NOT_FOUND' });
        await assert.rejects(ns.shareCall({}, srv, admin(), wsBrowser, { deviceId: A, share: 'Pictures', op: 'format' }), { code: 'BAD_OP' });
        // the guest is a Contributor now (last test): mkdir passes; a Reader share refuses it
        devices = devices.map((d) => (d.deviceId === A ? machine(A, 'MACBOOK', { discovery: true, fileSharing: true, shares: [wizard([{ account: 'administrator', level: 'owner' }, { account: 'guest', level: 'reader' }])] }) : d));
        await assert.rejects(ns.shareCall({}, srv, guest({ sessionId: 'g2' }), wsBrowser, { deviceId: A, share: 'Pictures', op: 'mkdir', path: '/x' }), { code: 'ACCESS_DENIED' });
        await ns.shareCall({}, srv, guest({ sessionId: 'g2' }), wsBrowser, { deviceId: A, share: 'Pictures', op: 'list', path: '/' });
    });

    await test('Limit the number of simultaneous users', async () => {
        ns.resetForTests();
        const srv = server([]);
        // limit 2 (the wizard() share): two sessions in, the third refused, the first again fine
        await ns.shareCall({}, srv, admin({ sessionId: 'u1' }), wsBrowser, { deviceId: A, share: 'Pictures', op: 'list' });
        await ns.shareCall({}, srv, admin({ sessionId: 'u2' }), wsBrowser, { deviceId: A, share: 'Pictures', op: 'list' });
        await assert.rejects(ns.shareCall({}, srv, admin({ sessionId: 'u3' }), wsBrowser, { deviceId: A, share: 'Pictures', op: 'list' }), { code: 'TOO_MANY_USERS' });
        await ns.shareCall({}, srv, admin({ sessionId: 'u1' }), wsBrowser, { deviceId: A, share: 'Pictures', op: 'list' });
    });

    await test('HTTP: /share/<share>/<path> splits and checks', () => {
        ns.resetForTests();
        const c = ns.shareAccessForHttp({ getWebSocketServer: () => server([]) }, { userType: 'readonly', sessionId: 'h1', ip: '10.0.0.2' }, A, '/Pictures/2026/a.jpg', false);
        assert.strictEqual(c.inner, '/2026/a.jpg');
        assert.strictEqual(c.account, 'guest');
        assert.throws(() => ns.shareAccessForHttp({ getWebSocketServer: () => server([]) }, { userType: 'readonly', sessionId: 'h1' }, A, '/Pictures/x', true), { code: 'ACCESS_DENIED' });
    });

    console.log(`# ${n} tests passed`);
})().catch((err) => { console.error(err); process.exit(1); });
