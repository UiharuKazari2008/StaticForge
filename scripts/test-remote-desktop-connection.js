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
assert.strictEqual(uri({ protocol: 'ssh', host: '[2001:db8::5]', port: 2222 }), 'ssh://[2001:db8::5]:2222/');
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

// guacd dials from Komaki: its loopback, link-local, unspecified and multicast are refused; the LAN is not
for (const host of ['127.0.0.1', '127.8.0.1', 'localhost', 'LOCALHOST.', 'a.localhost', '169.254.169.254',
    '0.0.0.0', '[::1]', '::', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1', '255.255.255.255']) {
    assert.throws(() => bridge.quickConnectUri({ protocol: 'rdp', host: host }),
        (err) => err.status === 403 && err.code === 'blocked', host);
}
for (const host of ['192.168.100.243', '10.0.0.5', 'Ruiko.nyti.ne.jp', '2001:db8::5', '172.16.0.1']) {
    assert.ok(!bridge.remoteNameBlocked(host), host);
}

// The Guacamole frame proxy passes reads, the token check and tunnels, nothing else
const allowed = bridge.guacProxyAllowed;
assert.ok(allowed('GET', '/'));
assert.ok(allowed('GET', '/api/session/data/mysql/connectionGroups/ROOT/tree'));
assert.ok(allowed('POST', '/api/tokens'));
assert.ok(allowed('POST', '/tunnel'));
assert.ok(allowed('PUT', '/api/session/tunnels/abc/streams/0/f.txt'));
assert.ok(!allowed('POST', '/api/session/ext/quickconnect/create'));
assert.ok(!allowed('GET', '/api/session/ext/quickconnect/create'));
assert.ok(!allowed('POST', '/api/session/%65xt/quickconnect/create'));
assert.ok(!allowed('POST', '/api/session/EXT/quickconnect/create'));
assert.ok(!allowed('POST', '/api/session;x=1/ext/quickconnect/create'));
assert.ok(!allowed('POST', '/api/session/tunnels/../ext/quickconnect/create'));
assert.ok(!allowed('POST', '/api//session/ext/quickconnect/create'));
assert.ok(!allowed('POST', '/api/session/data/mysql/connections'));
assert.ok(!allowed('PUT', '/api/session/data/mysql/self/password'));
assert.ok(!allowed('DELETE', '/api/tokens/abc'));
assert.ok(!allowed('GET', '/api/%zz'));

console.log('remote desktop connection: ok');
