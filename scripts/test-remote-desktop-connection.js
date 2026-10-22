#!/usr/bin/env node
/**
 * Remote Desktop Connection: the Computer box parser (remoteDesktopConnection.js) and the
 * quickconnect URI the server builds from the chosen protocol and credentials
 * (modules/guacRemoteBridge.js quickConnectUri).
 */
const assert = require('assert');
const rdc = require('../public/scripts/comp/desktop-apps/remoteDesktopConnection.js');
const bridge = require('../modules/guacRemoteBridge');

const parse = rdc._test.parseComputer;
assert.deepStrictEqual(parse('Ruiko.nyti.ne.jp'), { host: 'Ruiko.nyti.ne.jp', port: 0, protocol: '' });
assert.deepStrictEqual(parse('host:22'), { host: 'host', port: 22, protocol: 'ssh' });
assert.deepStrictEqual(parse('host:3389'), { host: 'host', port: 3389, protocol: 'rdp' });
assert.deepStrictEqual(parse('10.0.0.1:5903'), { host: '10.0.0.1', port: 5903, protocol: 'vnc' });
assert.deepStrictEqual(parse('host:8080'), { host: 'host', port: 8080, protocol: '' });
assert.deepStrictEqual(parse('rdp://h:4000'), { host: 'h', port: 4000, protocol: 'rdp' });
assert.deepStrictEqual(parse('SSH://h/'), { host: 'h', port: 0, protocol: 'ssh' });
assert.deepStrictEqual(parse('[fe80::1]:3389'), { host: 'fe80::1', port: 3389, protocol: 'rdp' });
assert.deepStrictEqual(parse('fe80::1'), { host: 'fe80::1', port: 0, protocol: '' });
assert.ok(parse('').error.startsWith('The computer name field is blank'));
assert.ok(parse('bad host').error);
assert.ok(parse('h:99999').error);
assert.ok(parse('h:0').error);

const uri = (body) => bridge.quickConnectUri(body).uri;
assert.strictEqual(uri({ protocol: 'rdp', host: 'Ruiko.nyti.ne.jp', username: 'DOM\\yk', password: 'p@ss:/' }),
    'rdp://yk:p%40ss%3A%2F@Ruiko.nyti.ne.jp/?ignore-cert=true&security=any&domain=DOM');
assert.strictEqual(uri({ protocol: 'ssh', host: '[fe80::1]', port: 2222 }), 'ssh://[fe80::1]:2222/');
assert.strictEqual(uri({ protocol: 'vnc', host: '10.0.0.5', port: 5903, password: 'x' }), 'vnc://:x@10.0.0.5:5903/');
assert.strictEqual(bridge.quickConnectUri({ protocol: 'vnc', host: '10.0.0.5', port: 5903 }).name, '10.0.0.5:5903');
for (const [body, code] of [
    [{ protocol: 'ftp', host: 'a' }, 'protocol'],
    [{ protocol: 'rdp', host: 'a b' }, 'invalid'],
    [{ protocol: 'rdp', host: 'a/b@c' }, 'invalid'],
    [{ protocol: 'rdp', host: 'a', port: 70000 }, 'invalid'],
    [{ protocol: 'rdp', host: '' }, 'blank']
]) {
    assert.throws(() => bridge.quickConnectUri(body), (err) => err.status === 400 && err.code === code);
}

console.log('remote desktop connection: ok');
