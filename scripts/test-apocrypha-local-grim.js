'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeIp,
    parseHopToken,
    ipInCidrs,
    parseCidr,
    resolveClientAddress,
    normalizeApocryphaAccessConfig,
    shouldShowGrim,
    applyGrimCacheHeaders,
    resetUntrustedXffWarnings,
    resetCidrCompileState,
    DEFAULT_APOCRYPHA_ACCESS,
    MAX_XFF_CHARS
} = require('../modules/clientAddress');
const {
    handleApocryphaRequest,
    parseApocryphaRelPath,
    renderApocrypha
} = require('../modules/apocryphaSite');

const PROXY = '10.0.0.1';
const HOP = '10.0.0.2';
const LAN = '192.168.100.20';
const LAN_CIDR = '192.168.100.0/24';
const PUBLIC = '203.0.113.9';

const HOST_CFG = {
    trustedProxies: ['127.0.0.0/8', '::1', PROXY, HOP],
    localCidrs: ['127.0.0.0/8', '::1', LAN_CIDR],
    localGrim: true
};

function req({ peer, xff, ip, session } = {}) {
    const headers = {};
    if (xff !== undefined) headers['x-forwarded-for'] = xff;
    return {
        socket: { remoteAddress: peer },
        headers,
        ip,
        session: session || {}
    };
}

function resolve(peer, extra) {
    return resolveClientAddress(req({ peer, ...extra }), extra && extra.cfg ? extra.cfg : HOST_CFG);
}

function mockRes() {
    const headers = {};
    return {
        headers,
        statusCode: 200,
        body: '',
        status(code) {
            this.statusCode = code;
            return this;
        },
        type() {
            return this;
        },
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
            return this;
        },
        send(html) {
            this.body = html;
            return this;
        }
    };
}

function resources(apocrypha) {
    return {
        getConfig({ path: keyPath }) {
            return keyPath === 'apocrypha' ? apocrypha : undefined;
        }
    };
}

test('normalize IPv4-mapped IPv6 and hop tokens', () => {
    assert.equal(normalizeIp('::ffff:192.168.100.20'), LAN);
    assert.equal(normalizeIp('::ffff:c0a8:6414'), LAN);
    assert.equal(normalizeIp('127.0.0.1'), '127.0.0.1');
    assert.equal(normalizeIp('::1'), '::1');
    assert.equal(parseHopToken('[2001:db8::1]:443'), '2001:db8::1');
    assert.equal(parseHopToken('203.0.113.9:8080'), PUBLIC);
    assert.equal(parseHopToken('2001:db8::1'), '2001:db8::1');
    assert.equal(parseHopToken('garbage'), null);
    assert.equal(parseHopToken('999.1.1.1'), null);
});

test('real CIDR match, not string prefixes', () => {
    assert.equal(ipInCidrs('192.168.100.20', [LAN_CIDR]), true);
    assert.equal(ipInCidrs('192.168.101.20', [LAN_CIDR]), false);
    assert.equal(ipInCidrs('172.32.0.1', ['172.16.0.0/12']), false);
    assert.equal(ipInCidrs('172.16.0.1', ['172.16.0.0/12']), true);
    assert.equal(ipInCidrs('11.0.0.1', ['10.0.0.0/8']), false);
    assert.equal(ipInCidrs('fe80::1', ['fe80::/10']), true);
    assert.equal(ipInCidrs('fec0::1', ['fe80::/10']), false);
});

test('public client through trusted proxy is not local', () => {
    const got = resolve(PROXY, { xff: PUBLIC });
    assert.equal(got.client, PUBLIC);
    assert.equal(got.local, false);
});

test('spoof through proxy: rightmost untrusted wins', () => {
    assert.equal(resolve(PROXY, { xff: '192.168.100.5, 203.0.113.9' }).local, false);
    assert.equal(resolve(PROXY, { xff: '192.168.100.5, 203.0.113.9' }).client, PUBLIC);
    assert.equal(resolve(PROXY, { xff: '127.0.0.1, 203.0.113.9' }).local, false);
    assert.equal(resolve(PROXY, { xff: '127.0.0.1, 203.0.113.9' }).client, PUBLIC);
});

test('spoof direct from public peer: XFF ignored', () => {
    const got = resolve(PUBLIC, { xff: '192.168.100.5' });
    assert.equal(got.client, PUBLIC);
    assert.equal(got.local, false);
    assert.equal(got.reason, 'direct-peer');
});

test('LAN direct and IPv4-mapped form', () => {
    const v4 = resolve(LAN);
    assert.equal(v4.client, LAN);
    assert.equal(v4.local, true);
    const mapped = resolve('::ffff:192.168.100.20');
    assert.equal(mapped.client, LAN);
    assert.equal(mapped.local, true);
});

test('LAN via trusted proxy', () => {
    const got = resolve(PROXY, { xff: LAN });
    assert.equal(got.client, LAN);
    assert.equal(got.local, true);
});

test('untrusted private peer with XFF is not local (guard)', () => {
    resetUntrustedXffWarnings();
    const cfg = {
        trustedProxies: [PROXY],
        localCidrs: ['192.168.0.0/16'],
        localGrim: true
    };
    const got = resolveClientAddress(
        req({ peer: '192.168.255.1', xff: PUBLIC }),
        cfg
    );
    assert.equal(got.local, false);
    assert.equal(got.reason, 'untrusted-private-xff');
});

test('malformed XFF via trusted proxy is not local', () => {
    assert.equal(resolve(PROXY, { xff: 'garbage' }).local, false);
    assert.equal(resolve(PROXY, { xff: '999.1.1.1' }).local, false);
    assert.equal(resolve(PROXY, { xff: ',,' }).local, false);
    assert.equal(resolve(PROXY, { xff: 'unknown' }).local, false);
    assert.equal(resolve(PROXY, { xff: 'x'.repeat(MAX_XFF_CHARS + 8) }).local, false);
    assert.equal(resolve(PROXY, { xff: ['198.51.100.7', 'not-an-ip'] }).local, false);
});

test('multiple trusted hops: first non-trusted from the right', () => {
    const got = resolve(PROXY, { xff: '198.51.100.7, 10.0.0.2' });
    assert.equal(got.client, '198.51.100.7');
    assert.equal(got.local, false);
});

test('IPv6: ::1 local by default; fe80 and fd00 only when configured', () => {
    const defaults = DEFAULT_APOCRYPHA_ACCESS;
    assert.equal(resolveClientAddress(req({ peer: '::1' }), defaults).local, true);
    assert.equal(resolveClientAddress(req({ peer: 'fe80::1' }), defaults).local, false);
    assert.equal(resolveClientAddress(req({ peer: 'fd12::1' }), defaults).local, false);
    assert.equal(resolveClientAddress(req({ peer: 'fe80::1' }), {
        trustedProxies: defaults.trustedProxies,
        localCidrs: ['fe80::/10']
    }).local, true);
    assert.equal(resolveClientAddress(req({ peer: 'fd12::1' }), {
        trustedProxies: defaults.trustedProxies,
        localCidrs: ['fd00::/8']
    }).local, true);
    assert.equal(resolveClientAddress(req({ peer: 'fc12::1' }), {
        trustedProxies: defaults.trustedProxies,
        localCidrs: ['fd00::/8']
    }).local, false);
});

test('loopback peer: no XFF is local; XFF public is not', () => {
    const direct = resolveClientAddress(req({ peer: '127.0.0.1' }), DEFAULT_APOCRYPHA_ACCESS);
    assert.equal(direct.local, true);
    assert.equal(direct.client, '127.0.0.1');
    const mapped = resolveClientAddress(req({ peer: '::ffff:127.0.0.1' }), DEFAULT_APOCRYPHA_ACCESS);
    assert.equal(mapped.local, true);
    const viaXff = resolveClientAddress(
        req({ peer: '127.0.0.1', xff: PUBLIC }),
        DEFAULT_APOCRYPHA_ACCESS
    );
    assert.equal(viaXff.local, false);
    assert.equal(viaXff.client, PUBLIC);
});

test('never use req.ip when the socket peer is public', () => {
    const got = resolveClientAddress(
        req({ peer: PUBLIC, ip: LAN }),
        HOST_CFG
    );
    assert.equal(got.client, PUBLIC);
    assert.equal(got.local, false);
});

test('localGrim false is session-only', () => {
    assert.equal(shouldShowGrim({ loggedInSession: false, local: true, localGrim: false }), false);
    assert.equal(shouldShowGrim({ loggedInSession: true, local: false, localGrim: false }), true);
    assert.equal(shouldShowGrim({ loggedInSession: false, local: true, localGrim: true }), true);
});

test('missing keys use loopback defaults; garbage localGrim fails closed', () => {
    const empty = normalizeApocryphaAccessConfig(undefined);
    assert.deepEqual(empty.trustedProxies, ['127.0.0.0/8', '::1']);
    assert.deepEqual(empty.localCidrs, ['127.0.0.0/8', '::1']);
    assert.equal(empty.localGrim, true);
    const bad = normalizeApocryphaAccessConfig({
        trustedProxies: '10.0.0.1',
        localCidrs: null,
        localGrim: 'yes'
    });
    assert.deepEqual(bad.trustedProxies, []);
    assert.deepEqual(bad.localCidrs, []);
    assert.equal(bad.localGrim, false);
});

test('archive path parser', () => {
    assert.equal(parseApocryphaRelPath('/archive/monday-digest-2026-09-22').issueSlug, 'monday-digest-2026-09-22');
    assert.equal(parseApocryphaRelPath('/archive/monday-digest-2026-09-22/').issueSlug, 'monday-digest-2026-09-22');
    assert.equal(parseApocryphaRelPath('/').issueSlug, '');
    assert.equal(parseApocryphaRelPath('/archive/').issueSlug, '');
});

test('route: grim response headers; public has no grim markers; logged-in still sees grim', () => {
    const publicRes = mockRes();
    handleApocryphaRequest(req({ peer: PUBLIC }), publicRes, {
        globalResources: resources(HOST_CFG)
    });
    assert.equal(publicRes.statusCode, 200);
    assert.equal(publicRes.headers['cache-control'], undefined);
    assert.match(publicRes.body, /class="wrap-public"/);
    assert.doesNotMatch(publicRes.body, /class="grim-wrapper"/);
    assert.doesNotMatch(publicRes.body, /GRIM \/ LOGGED-IN/);
    assert.doesNotMatch(publicRes.body, /UNOFFICIAL \/ SPICY KEEPERS/);

    const localRes = mockRes();
    handleApocryphaRequest(req({ peer: LAN }), localRes, {
        globalResources: resources(HOST_CFG)
    });
    assert.equal(localRes.headers['cache-control'], 'private, no-store');
    assert.equal(localRes.headers.vary, 'Cookie, X-Forwarded-For');
    assert.match(localRes.body, /class="grim-wrapper"/);
    assert.match(localRes.body, /GRIM \/ LOGGED-IN/);

    const loginRes = mockRes();
    handleApocryphaRequest(req({ peer: PUBLIC, session: { authenticated: true } }), loginRes, {
        globalResources: resources(HOST_CFG)
    });
    assert.equal(loginRes.headers['cache-control'], 'private, no-store');
    assert.equal(loginRes.headers.vary, 'Cookie, X-Forwarded-For');
    assert.match(loginRes.body, /class="grim-wrapper"/);

    const archive404 = mockRes();
    handleApocryphaRequest(req({ peer: LAN }), archive404, {
        globalResources: resources(HOST_CFG),
        issueSlug: 'no-such-issue-for-local-grim-test',
        loadArchivedIssue: () => null
    });
    assert.equal(archive404.statusCode, 404);
    assert.equal(archive404.headers['cache-control'], undefined);
    assert.doesNotMatch(archive404.body, /class="grim-wrapper"/);

    const archiveGrim = mockRes();
    handleApocryphaRequest(req({ peer: LAN }), archiveGrim, {
        globalResources: resources(HOST_CFG),
        issueSlug: 'fixture-day',
        loadArchivedIssue: () => ({ issueLabel: 'FIXTURE', grimImages: [] }),
        renderApocrypha: ({ isGrimoire, issueSlug }) => {
            assert.equal(issueSlug, 'fixture-day');
            return renderApocrypha({ title: 'Apocrypha — MWF digest', isGrimoire, issueSlug: '' });
        }
    });
    assert.equal(archiveGrim.statusCode, 200);
    assert.equal(archiveGrim.headers['cache-control'], 'private, no-store');
    assert.match(archiveGrim.body, /class="grim-wrapper"/);
});

test('applyGrimCacheHeaders writes both required fields', () => {
    const res = mockRes();
    applyGrimCacheHeaders(res);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers.vary, 'Cookie, X-Forwarded-For');
});

test('invalid CIDR entries are ignored and never match or crash', () => {
    resetCidrCompileState();
    const x = '192.168.100.0';
    const rejected = [
        x + '/',
        x + '/ ',
        x + '/-0',
        x + '/+24',
        x + '/0x18',
        x + '/1e1',
        x + '/33',
        '::1/129',
        '0.0.0.0/0',
        '::/0',
        'garbage',
        '',
        24,
        null,
        { cidr: '8.8.8.8/32' }
    ];
    for (const entry of rejected) {
        assert.equal(parseCidr(entry), null, 'parseCidr must reject ' + String(entry));
    }
    assert.doesNotThrow(() => {
        ipInCidrs('8.8.8.8', rejected);
        ipInCidrs('192.168.100.20', rejected);
    });
    assert.equal(ipInCidrs('8.8.8.8', rejected), false);
    assert.equal(ipInCidrs('192.168.100.20', rejected), false);
    assert.equal(ipInCidrs('::1', rejected), false);

    const cfg = { trustedProxies: rejected, localCidrs: rejected, localGrim: true };
    const publicDirect = resolveClientAddress(req({ peer: '8.8.8.8' }), cfg);
    assert.equal(publicDirect.local, false);
    assert.equal(publicDirect.trustedPeer, false);

    const lanWouldHaveMatchedOldSlash = resolveClientAddress(
        req({ peer: '192.168.100.20' }),
        { trustedProxies: [], localCidrs: [x + '/', x + '/ '], localGrim: true }
    );
    assert.equal(lanWouldHaveMatchedOldSlash.local, false);

    assert.equal(ipInCidrs('192.168.100.20', ['192.168.100.0/24']), true);
    assert.equal(ipInCidrs('192.168.255.1', ['192.168.255.1']), true);
    assert.equal(ipInCidrs('::1', ['::1']), true);
    assert.equal(ipInCidrs('fd12::1', ['fd00::/8']), true);
    assert.equal(ipInCidrs('192.168.100.20', ['::ffff:192.168.100.0/24']), true);

    const absent = normalizeApocryphaAccessConfig({});
    assert.deepEqual(absent.trustedProxies, ['127.0.0.0/8', '::1']);
    assert.deepEqual(absent.localCidrs, ['127.0.0.0/8', '::1']);
    assert.equal(resolveClientAddress(req({ peer: '127.0.0.1' }), absent).local, true);

    const allInvalid = normalizeApocryphaAccessConfig({
        trustedProxies: rejected,
        localCidrs: rejected
    });
    assert.deepEqual(allInvalid.trustedProxies, rejected);
    assert.deepEqual(allInvalid.localCidrs, rejected);
    assert.equal(resolveClientAddress(req({ peer: '127.0.0.1' }), allInvalid).local, false);
    assert.equal(resolveClientAddress(req({ peer: '8.8.8.8' }), allInvalid).local, false);
});

test('invalid CIDR warning is once per distinct entry', () => {
    resetCidrCompileState();
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => {
        warns.push(args.map(String).join(' '));
    };
    try {
        ipInCidrs('8.8.8.8', ['garbage']);
        ipInCidrs('1.1.1.1', ['garbage']);
        ipInCidrs('8.8.8.8', ['garbage', '8.8.8.8/33']);
        const garbage = warns.filter((line) => line.includes('garbage'));
        const slash33 = warns.filter((line) => line.includes('8.8.8.8/33'));
        assert.equal(garbage.length, 1);
        assert.equal(slash33.length, 1);
    } finally {
        console.warn = orig;
    }
});
