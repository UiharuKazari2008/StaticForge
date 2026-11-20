#!/usr/bin/env node
'use strict';
// #922 (docs/client-certificates.md): Key Manager's client CA. The DER written by hand is read back by Node's own
// X.509 parser (and openssl when the machine has it); enrolment, certificate sign-in by signed challenge, replay,
// renewal and supersede, revocation, the CRL, and the push that ends a revoked client's sessions and sockets.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const der = require('../modules/clientCertDer');
const cc = require('../modules/clientCertificates');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'client-cert-test-'));
const sqlite = new DatabaseSync(':memory:');
const db = {
    exec: async (sql) => { sqlite.exec(sql); },
    run: async (sql, p = []) => sqlite.prepare(sql).run(...p),
    get: async (sql, p = []) => sqlite.prepare(sql).get(...p),
    all: async (sql, p = []) => sqlite.prepare(sql).all(...p)
};
let clock = Date.now();
const service = cc.createService({ db, caDir: tmp, now: () => clock, settings: () => ({ validityDays: 90, renewDays: 30 }) });
const DAY = 86400000;

/** A request the way a client builds it: its own key, an (ignored) subject, signed by that key. */
function makeCsr(pair, { tamper = false, curve = null } = {}) {
    const e = der._enc;
    const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
    const info = e.seq(e.int(0), e.name([[der.OID.cn, 'client']]), spki, Buffer.from([0xa0, 0x00]));
    const signature = crypto.sign('sha256', info, { key: pair.privateKey, dsaEncoding: 'der' });
    if (tamper) signature[signature.length - 1] ^= 0xff;
    return der.pem('CERTIFICATE REQUEST', e.seq(info, e.ALG_ECDSA_SHA256, e.bits(signature)));
}
const newPair = (curve = 'prime256v1') => crypto.generateKeyPairSync('ec', { namedCurve: curve });
const signIn = (pair, serial, nonce) => crypto.sign('sha256', cc.authMessage(nonce, serial), { key: pair.privateKey, dsaEncoding: 'der' }).toString('base64');
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || `threw ${e.message}`; } };
const hasOpenssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); return true; } catch (_) { return false; } })();

(async () => {
    // ---- the CA ----
    const ca = service.ensureCa();
    const keyPath = path.join(tmp, 'dreamscape-client-ca.key');
    assert.strictEqual(fs.statSync(keyPath).mode & 0o777, 0o600, 'the CA key is private to its owner');
    assert.ok(ca.x509.ca, 'CA:TRUE');
    assert.strictEqual(ca.x509.subject, 'CN=Dreamscape Client CA\nO=Dreamscape');
    assert.ok(ca.x509.verify(ca.publicKey), 'self-signed');
    assert.ok(new Date(ca.x509.validTo).getTime() - clock > 19 * 365 * DAY);
    // a second service on the same folder reads the same CA instead of making another
    assert.strictEqual(cc.createService({ db, caDir: tmp }).caPem(), service.caPem());
    // half a CA is refused, never patched
    const half = fs.mkdtempSync(path.join(os.tmpdir(), 'client-cert-half-'));
    fs.writeFileSync(path.join(half, 'dreamscape-client-ca.crt'), service.caPem());
    assert.throws(() => cc.createService({ db, caDir: half }).ensureCa(), /incomplete/);

    // ---- requests ----
    const phoneKey = newPair();
    assert.strictEqual(await code(service.enrol({ csr: 'nonsense!', deviceId: 'a'.repeat(32), deviceName: 'x', kind: 'android' })), 'BAD_CSR');
    assert.strictEqual(await code(service.enrol({ csr: makeCsr(phoneKey, { tamper: true }), deviceId: 'a'.repeat(32), deviceName: 'x', kind: 'android' })), 'BAD_CSR', 'proof of possession');
    assert.strictEqual(await code(service.enrol({ csr: makeCsr(newPair('secp384r1')), deviceId: 'a'.repeat(32), deviceName: 'x', kind: 'android' })), 'BAD_CSR', 'P-256 only');
    assert.strictEqual(await code(service.enrol({ csr: makeCsr(phoneKey), deviceId: 'NOT-HEX', deviceName: 'x', kind: 'android' })), 'BAD_DEVICE');
    assert.strictEqual(await code(service.enrol({ csr: makeCsr(phoneKey), deviceId: 'a'.repeat(32), deviceName: 'x', kind: 'toaster' })), 'BAD_DEVICE');
    assert.strictEqual((await service.list()).length, 0, 'a refused request leaves no record');

    // ---- enrolment ----
    const deviceId = 'f40910c077e218f55a6020767818c5f8';
    const first = await service.enrol({ csr: makeCsr(phoneKey), deviceId, deviceName: "Yukimi's Fold7\u0007", kind: 'android', keyStore: 'StrongBox', userType: 'admin', ip: '192.168.1.5', sessionId: 'sid-pin' });
    const a = first.answer;
    assert.strictEqual(first.revoked.length, 0);
    assert.match(a.serial, /^[1-7][0-9a-f]{31}$/);
    const x = new crypto.X509Certificate(a.certificate);
    assert.ok(x.verify(ca.publicKey), 'signed by the CA');
    assert.ok(x.checkIssued(ca.x509), 'issuer name and key identifier match the CA');
    assert.strictEqual(x.serialNumber.toLowerCase(), a.serial);
    assert.strictEqual(x.subject, `CN=Yukimi's Fold7\nOU=android\nO=Dreamscape\nserialNumber=${deviceId}`);
    assert.strictEqual(x.subjectAltName, `URI:urn:dreamscape:device:android:${deviceId}`);
    assert.strictEqual(x.ca, false);
    assert.deepStrictEqual(x.keyUsage, ['1.3.6.1.5.5.7.3.2'], 'extendedKeyUsage clientAuth');
    assert.ok(x.publicKey.equals(phoneKey.publicKey), 'the key in the certificate is the client\'s');
    assert.strictEqual(new Date(x.validTo).getTime(), Math.floor(a.notAfter / 1000) * 1000);
    assert.strictEqual(a.notAfter - a.renewAfter, 30 * DAY);
    assert.strictEqual(a.ca, service.caPem());
    assert.strictEqual(await service.sessionSerial('sid-pin'), a.serial, 'the session that enrolled is tied to the certificate');
    if (hasOpenssl) {
        const certFile = path.join(tmp, 'c.pem');
        fs.writeFileSync(certFile, a.certificate);
        const out = execFileSync('openssl', ['verify', '-CAfile', path.join(tmp, 'dreamscape-client-ca.crt'), '-purpose', 'sslclient', certFile], { stdio: 'pipe' }).toString();
        assert.match(out, /OK/, 'openssl accepts the chain');
    }

    // ---- certificate sign-in ----
    let ch = service.challenge();
    assert.strictEqual(ch.expiresAt - ch.serverTime, 60000);
    let auth = await service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(phoneKey, a.serial, ch.nonce), ip: '10.0.0.9' });
    assert.strictEqual(auth.record.userType, 'admin');
    assert.strictEqual(auth.record.keyStore, 'strongbox');
    assert.strictEqual(auth.renew, false);
    assert.strictEqual(auth.record.lastUsedIp, '10.0.0.9');
    // the same answer again: the nonce is spent
    assert.strictEqual(await code(service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(phoneKey, a.serial, ch.nonce) })), 'BAD_NONCE', 'replay');
    assert.strictEqual(await code(service.authenticate({ certificate: a.certificate, nonce: 'made-up', signature: 'AAAA' })), 'BAD_NONCE');
    // a timed-out nonce
    ch = service.challenge(); clock += 61000;
    assert.strictEqual(await code(service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(phoneKey, a.serial, ch.nonce) })), 'BAD_NONCE');
    // someone else's key
    ch = service.challenge();
    assert.strictEqual(await code(service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(newPair(), a.serial, ch.nonce) })), 'BAD_SIGNATURE');
    // a signature over another nonce
    ch = service.challenge();
    assert.strictEqual(await code(service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(phoneKey, a.serial, 'other') })), 'BAD_SIGNATURE');
    // a certificate from another CA with the same serial and subject
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-cert-other-'));
    const other = cc.createService({ db: { ...db, run: async () => ({}) }, caDir: otherDir, now: () => clock });
    const forged = (await other.enrol({ csr: makeCsr(phoneKey), deviceId, deviceName: 'Fold', kind: 'android' })).answer;
    ch = service.challenge();
    assert.strictEqual(await code(service.authenticate({ certificate: forged.certificate, nonce: ch.nonce, signature: signIn(phoneKey, forged.serial, ch.nonce) })), 'CERT_UNKNOWN');
    ch = service.challenge();
    assert.strictEqual(await code(service.authenticate({ certificate: 'junk', nonce: ch.nonce, signature: 'AAAA' })), 'CERT_UNKNOWN');

    // ---- renewal: the old certificate lives until the new one signs in ----
    clock += 61 * DAY;
    ch = service.challenge();
    auth = await service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(phoneKey, a.serial, ch.nonce) });
    assert.strictEqual(auth.renew, true, 'inside the last 30 days');
    await service.bindSession('sid-cert', a.serial);
    const key2 = newPair();
    const renewed = (await service.renew({ serial: a.serial, csr: makeCsr(key2), ip: '10.0.0.9', sessionId: 'sid-cert' })).answer;
    assert.notStrictEqual(renewed.serial, a.serial);
    assert.strictEqual((await service.get(renewed.serial)).deviceName, "Yukimi's Fold7", 'identity carried over');
    assert.strictEqual((await service.get(a.serial)).status, 'issued', 'still valid: the answer may have been lost');
    assert.strictEqual(await code(service.renew({ serial: a.serial, csr: makeCsr(newPair()) })), 'TOO_MANY', 'one renewal per device per 10 minutes');
    assert.strictEqual(await service.sessionSerial('sid-cert'), renewed.serial, 'the renewing session moves to the new certificate');
    ch = service.challenge();
    auth = await service.authenticate({ certificate: renewed.certificate, nonce: ch.nonce, signature: signIn(key2, renewed.serial, ch.nonce) });
    assert.strictEqual(auth.revoked.length, 1);
    assert.strictEqual(auth.revoked[0].record.serial, a.serial);
    assert.strictEqual(auth.revoked[0].record.revokeReason, 'superseded');
    assert.deepStrictEqual(auth.revoked[0].sessions, ['sid-pin'], 'sessions still on the old certificate end; the renewing one moved');
    ch = service.challenge();
    const old = await service.authenticate({ certificate: a.certificate, nonce: ch.nonce, signature: signIn(phoneKey, a.serial, ch.nonce) }).catch((e) => e);
    assert.strictEqual(old.code, 'CERT_REVOKED');
    assert.strictEqual(old.extra.reason, 'superseded');

    // ---- enrolling again replaces the live certificate at once ----
    const laptopKey = newPair();
    const laptop = (await service.enrol({ csr: makeCsr(laptopKey), deviceId: 'abcdef0123456789', deviceName: 'DreamOS laptop', kind: 'dreamos', keyStore: 'file', userType: 'readonly', sessionId: 'sid-laptop' })).answer;
    assert.strictEqual(laptop.userType, 'readonly');
    const key3 = newPair();
    const again = await service.enrol({ csr: makeCsr(key3), deviceId, deviceName: 'Fold7', kind: 'android', userType: 'admin', sessionId: 'sid-pin2' });
    assert.strictEqual(again.revoked.length, 1);
    assert.strictEqual(again.revoked[0].record.serial, renewed.serial);
    assert.deepStrictEqual(again.revoked[0].sessions, ['sid-cert']);
    assert.strictEqual((await service.get(laptop.serial)).status, 'issued', 'another device is untouched');

    // ---- revocation and the CRL ----
    const before = await service.crlNumber();
    await service.bindSession('sid-laptop-cert', laptop.serial);
    const rev = await service.revoke(laptop.serial, 'key_compromise', 'administrator');
    assert.deepStrictEqual(rev.sessions.sort(), ['sid-laptop', 'sid-laptop-cert']);
    assert.strictEqual(rev.crlNumber, before + 1);
    assert.strictEqual(await service.sessionSerial('sid-laptop'), null);
    assert.strictEqual(await code(service.revoke(laptop.serial, 'revoked')), 'ALREADY_REVOKED');
    assert.strictEqual(await code(service.revoke('00ff', 'revoked')), 'CERT_UNKNOWN');
    assert.strictEqual(await code(service.renew({ serial: laptop.serial, csr: makeCsr(newPair()) })), 'RENEW_NEEDS_CERT_SESSION');
    ch = service.challenge();
    assert.strictEqual(await code(service.authenticate({ certificate: laptop.certificate, nonce: ch.nonce, signature: signIn(laptopKey, laptop.serial, ch.nonce) })), 'CERT_REVOKED');

    const crl = await service.crl();
    assert.strictEqual(crl.number, before + 1);
    assert.strictEqual(crl.json.revoked.length, 3);
    const parsed = der.parseCrl(crl.der);
    assert.strictEqual(parsed.number, crl.number);
    assert.ok(crypto.verify('sha256', parsed.tbs, { key: ca.publicKey, dsaEncoding: 'der' }, parsed.signature), 'the CRL is signed by the CA');
    assert.deepStrictEqual(parsed.revoked.map((r) => [r.serial, r.reason]).sort(), [[a.serial, 'superseded'], [laptop.serial, 'key_compromise'], [renewed.serial, 'superseded']].sort());
    assert.strictEqual(parsed.nextUpdate - parsed.thisUpdate, 7 * DAY);
    assert.strictEqual((await service.crl()).der, crl.der, 'unchanged CRL is not rebuilt');
    if (hasOpenssl) {
        const crlFile = path.join(tmp, 'crl.der');
        fs.writeFileSync(crlFile, crl.der);
        const text = execFileSync('openssl', ['crl', '-inform', 'der', '-in', crlFile, '-CAfile', path.join(tmp, 'dreamscape-client-ca.crt'), '-noout', '-text'], { stdio: 'pipe' }).toString();
        assert.match(text, /Key Compromise/);
        assert.match(text, new RegExp(laptop.serial, 'i'));
    }
    // an empty CRL is well-formed too
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-cert-empty-'));
    const emptyDb = new DatabaseSync(':memory:');
    const empty = cc.createService({ caDir: emptyDir, db: { exec: async (s) => emptyDb.exec(s), run: async (s, p = []) => emptyDb.prepare(s).run(...p), get: async (s, p = []) => emptyDb.prepare(s).get(...p), all: async (s, p = []) => emptyDb.prepare(s).all(...p) } });
    assert.deepStrictEqual(der.parseCrl((await empty.crl()).der).revoked, []);

    // ---- expiry ----
    const live3 = again.answer;
    clock += 91 * DAY;
    ch = service.challenge();
    assert.strictEqual(await code(service.authenticate({ certificate: live3.certificate, nonce: ch.nonce, signature: signIn(key3, live3.serial, ch.nonce) })), 'CERT_EXPIRED');
    assert.strictEqual((await service.get(live3.serial)).status, 'expired');
    assert.strictEqual((await service.crl()).json.revoked.length, 0, 'expired certificates leave the CRL');

    // ---- the push: a revoked client's sockets are told, its sessions destroyed, its sockets closed ----
    const sock = (sessionId) => ({ sent: [], closed: null, _dsSessionId: sessionId, send(m) { this.sent.push(JSON.parse(m)); }, close(c, r) { this.closed = [c, r]; } });
    const mine = sock(); const bystander = sock(); const carrier = sock('sid-x');
    const destroyed = [];
    const broadcasts = [];
    const vs = require('../modules/ws/virtualSocket');
    const realForEach = vs.forEachMiniport;
    vs.forEachMiniport = (fn) => fn(carrier);
    const globalResources = {
        getWebSocketServer: () => ({
            clients: new Map([[mine, { sessionId: 'sid-x', authenticated: true, userType: 'admin' }], [bystander, { sessionId: 'sid-y', authenticated: true, userType: 'admin' }]]),
            broadcast: (m, filter) => broadcasts.push([m, filter])
        }),
        getSessionStore: () => ({ destroy: (sid, cb) => { destroyed.push(sid); cb(); } })
    };
    const key4 = newPair();
    const tablet = (await service.enrol({ csr: makeCsr(key4), deviceId: '0123456789abcdef0123', deviceName: 'Tablet', kind: 'android', sessionId: 'sid-x' })).answer;
    await service.bindSession('sid-y', laptop.serial); // another certificate's session stays
    const result = await cc.revokeAndTell(globalResources, tablet.serial, 'cessation', 'test', service);
    vs.forEachMiniport = realForEach;
    assert.deepStrictEqual(destroyed, ['sid-x']);
    assert.strictEqual(mine.sent[0].type, 'client_cert_revoked');
    assert.deepStrictEqual(mine.sent[0].data, { serial: tablet.serial, reason: 'cessation', at: result.record.revokedAt });
    assert.strictEqual(carrier.sent[0].type, 'client_cert_revoked', 'the Miniport carrier is told natively');
    assert.strictEqual(bystander.sent.length, 0);
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepStrictEqual(mine.closed, [4004, 'Certificate revoked']);
    assert.deepStrictEqual(carrier.closed, [1008, 'Authentication required']);
    assert.strictEqual(bystander.closed, null);
    const kinds = broadcasts.map(([m]) => m.type);
    assert.deepStrictEqual(kinds, ['client_cert_changed', 'client_cert_crl']);
    const crlPush = broadcasts[1];
    assert.strictEqual(crlPush[0].data.added[0].serial, tablet.serial);
    assert.strictEqual(crlPush[1]({ sessionId: 'sid-y' }), true, 'sessions opened by a certificate hear about the CRL');
    assert.strictEqual(crlPush[1]({ sessionId: 'someone-else' }), false);
    assert.strictEqual(broadcasts[0][1]({ authenticated: true, userType: 'readonly' }), false, 'Key Manager refresh is for administrators');

    // ---- log off is a lock on a certificate session; only the Nightshade client's Sign Out signs out (7a) ----
    const key5 = newPair();
    const desk = (await service.enrol({ csr: makeCsr(key5), deviceId: 'dd0910c077e218f55a6020767818c5f8', deviceName: 'DreamOS desk', kind: 'dreamos', sessionId: 'sid-enrolled' })).answer;
    const certReq = (session) => ({ session: { authenticated: true, ...session } });
    const opened = certReq({ id: 'sid-opened', authMethod: 'client_cert', clientCertSerial: desk.serial.toUpperCase() });
    assert.strictEqual(await cc.sessionCertificate(opened, null, service), desk.serial, 'a session the certificate opened');
    assert.strictEqual(await cc.sessionCertificate(certReq({ id: 'sid-enrolled' }), null, service), desk.serial, 'the sign-in that enrolled it');
    assert.strictEqual(await cc.sessionCertificate(certReq({ id: 'sid-browser' }), null, service), null, 'a browser session');
    assert.strictEqual(await cc.sessionCertificate({ session: { id: 'sid-enrolled' } }, null, service), null, 'not signed in');
    const brokenDb = { sessionSerial: async () => { throw new Error('database not open'); } };
    assert.strictEqual(await cc.sessionCertificate(certReq({ id: 'sid-enrolled' }), null, brokenDb), null, 'no database: nothing bound');
    assert.deepStrictEqual(await cc.logoutPlan(opened, { intent: 'logoff', keepSiteAccess: true }, null, service), { action: 'keep', serial: desk.serial });
    assert.deepStrictEqual(await cc.logoutPlan(certReq({ id: 'sid-enrolled' }), undefined, null, service), { action: 'keep', serial: desk.serial }, 'a stray logout with no data keeps it too');
    assert.deepStrictEqual(await cc.logoutPlan(certReq({ id: 'sid-browser' }), { intent: 'logoff' }, null, service), { action: 'logout', serial: null }, 'a browser still signs out');
    assert.deepStrictEqual(await cc.logoutPlan(certReq({ id: 'sid-browser' }), { intent: cc.SIGN_OUT_INTENT }, null, service), { action: 'signout', serial: null });
    assert.deepStrictEqual(await cc.logoutPlan(opened, { intent: cc.SIGN_OUT_INTENT }, null, service), { action: 'signout', serial: desk.serial });
    destroyed.length = 0;
    const out = await cc.signOutDevice({ getSessionStore: () => ({ destroy: (sid, cb) => { destroyed.push(sid); cb(); } }) }, desk.serial, service);
    assert.strictEqual(out.record.revokeReason, 'cessation', 'Sign Out retires the certificate');
    assert.deepStrictEqual(destroyed, ['sid-enrolled'], 'and ends its sessions');
    assert.strictEqual(await service.sessionSerial('sid-enrolled'), null);
    assert.strictEqual(await cc.signOutDevice({}, desk.serial, service), null, 'signing out twice is not an error');

    // ---- the routes mount before Key Manager's database is open (boot order): nothing is touched until a request ----
    const routes = {};
    const fakeApp = { get: (p) => { routes[`GET ${p}`] = true; }, post: (p) => { routes[`POST ${p}`] = true; } };
    assert.doesNotThrow(() => cc.mount(fakeApp, (req, res, next) => next(), { getConfig: () => ({}) }), 'mounting needs no database yet');
    assert.deepStrictEqual(Object.keys(routes).sort(), [
        'GET /api/client-cert/ca', 'GET /api/client-cert/crl', 'GET /api/client-cert/crl.json', 'GET /api/client-cert/mine',
        'POST /api/client-cert/auth', 'POST /api/client-cert/challenge', 'POST /api/client-cert/enrol', 'POST /api/client-cert/renew'
    ]);

    // ---- who may enrol ----
    const ps = cc._util.personSession;
    assert.strictEqual(ps({ authMethod: 'session', session: { authenticated: true } }), true);
    assert.strictEqual(ps({ authMethod: 'application_key', session: { authenticated: true } }), false);
    assert.strictEqual(ps({ authMethod: 'session', session: { authenticated: true, authMethod: 'approved_ip', approvedIpId: 3 } }), false);
    assert.strictEqual(ps({ authMethod: 'session', session: { authenticated: true, authMethod: 'client_cert' } }), false);
    assert.strictEqual(ps({ authMethod: 'session', session: {} }), false);

    for (const d of [tmp, half, otherDir, emptyDir]) fs.rmSync(d, { recursive: true, force: true });
    console.log('test-client-certificates: ok');
})().catch((e) => { console.error(e); process.exit(1); });
