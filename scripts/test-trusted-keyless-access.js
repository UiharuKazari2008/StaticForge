'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { initializeApplicationAuthDatabase, getDb } = require('../modules/applicationAuthDatabase');
const {
    ApplicationAuthManager,
    parseTrustedAccessOptions
} = require('../modules/applicationAuthManager');
const { resolveMcpKeyless } = require('../modules/auth');
const { renderConsentPage, oauthTrustedKeyOptions } = require('../modules/mcpOAuthRoutes');
const { ipInCidrs } = require('../modules/clientAddress');

function resources(manager) {
    return {
        getApplicationAuthManager: () => manager,
        getConfig: () => ['127.0.0.0/8', '::1']
    };
}

function mcpReq({ peer, xff, ua, body, authorization }) {
    const headers = { 'user-agent': ua };
    if (xff != null) headers['x-forwarded-for'] = xff;
    if (authorization) headers.authorization = authorization;
    return {
        headers,
        socket: { remoteAddress: peer },
        body: body || { method: 'tools/call', params: { name: 'generate_image' } }
    };
}

async function main() {
    assert.strictEqual(ipInCidrs('203.0.113.5', ['203.0.113.5/32']), true);
    assert.strictEqual(ipInCidrs('203.0.113.6', ['203.0.113.5/32']), false);
    assert.strictEqual(ipInCidrs('2001:db8::1', ['2001:db8::1/128']), true);
    assert.strictEqual(ipInCidrs('2001:db8:0:0:0:0:0:1', ['2001:db8::1/128']), true);
    assert.strictEqual(ipInCidrs('2001:db8::2', ['2001:db8::1/128']), false);
    assert.strictEqual(ipInCidrs('127.0.0.2', ['127.0.0.1/32', '::1/128']), false);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-trusted-access-'));
    const ok = await initializeApplicationAuthDatabase(tmp);
    assert.ok(ok, 'application auth db should initialize');
    const manager = new ApplicationAuthManager({});
    const gr = resources(manager);
    const ua = 'GrokBot/1.0 (personal)';

    const created = await manager.createApplicationKey({
        appName: 'Grok Bot',
        userAgent: ua,
        scopes: ['generation', 'gallery'],
        userType: 'admin',
        allowKeyless: true,
        persistent: false,
        trustedCidrs: ['203.0.113.5/32', '2001:db8::1/128']
    });
    const rawKey = created.key;
    assert.strictEqual(created.summary.allowKeyless, true);
    assert.deepStrictEqual(created.summary.trustedCidrs, ['203.0.113.5/32', '2001:db8::1/128']);
    assert.strictEqual(created.summary.userType, 'admin');
    assert.strictEqual(created.summary.allowDelete, true);
    assert.strictEqual(created.summary.readOnly, false);

    const readonlyApp = await manager.createApplicationKey({
        appName: 'Readonly Bot',
        userAgent: 'ReadonlyBot/1.0',
        scopes: ['gallery'],
        userType: 'readonly',
        allowKeyless: true,
        trustedCidrs: []
    });

    const locked = await manager.createApplicationKey({
        appName: 'Keyed Only',
        userAgent: ua,
        scopes: ['generation'],
        userType: 'admin',
        allowKeyless: false,
        trustedCidrs: ['203.0.113.5/32']
    });

    const logs = [];
    const orig = console.log;
    console.log = (...args) => {
        logs.push(args.join(' '));
    };

    try {
        console.log('direct loopback keyless uses the app actor and is not a default admin upgrade');
        const loopback = await resolveMcpKeyless(mcpReq({ peer: '127.0.0.1', ua }), gr);
        assert.ok(loopback, '127.0.0.1 is implied when allowKeyless is on');
        assert.strictEqual(loopback.applicationKeyId, created.summary.id);
        assert.strictEqual(loopback.authMethod, 'trusted_keyless');
        assert.deepStrictEqual(loopback.applicationScopes, ['generation', 'gallery']);
        assert.strictEqual(loopback.userType, 'admin');
        assert.strictEqual(loopback.readOnly, false);
        assert.strictEqual(loopback.allowDelete, true);
        assert.ok(!JSON.stringify(loopback).includes(rawKey));

        const v6Loop = await resolveMcpKeyless(mcpReq({ peer: '::1', ua: 'ReadonlyBot/1.0' }), gr);
        assert.ok(v6Loop);
        assert.strictEqual(v6Loop.userType, 'readonly');
        assert.strictEqual(v6Loop.readOnly, true);
        assert.strictEqual(v6Loop.allowDelete, false);
        assert.notStrictEqual(v6Loop.userType, 'admin');

        console.log('neighbor of implied /32 is not keyless');
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({ peer: '127.0.0.2', ua }), gr),
            null
        );

        console.log('spoofed XFF does not become loopback');
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '203.0.113.50',
                xff: '127.0.0.1',
                ua
            }), gr),
            null
        );
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '192.168.200.121',
                xff: '127.0.0.1',
                ua
            }), gr),
            null
        );

        console.log('untrusted proxy without XFF is not trusted access');
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({ peer: '10.9.8.7', ua }), gr),
            null
        );

        console.log('UA mismatch falls through');
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '192.168.200.121',
                xff: '203.0.113.5',
                ua: 'GrokBot/1.0 (other)'
            }), gr),
            null
        );

        console.log('CIDR /32 and v6 edges');
        const v4 = await resolveMcpKeyless(mcpReq({
            peer: '192.168.200.121',
            xff: '198.51.100.1, 203.0.113.5',
            ua
        }), gr);
        assert.ok(v4);
        assert.strictEqual(v4.applicationKeyId, created.summary.id);
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '192.168.200.121',
                xff: '203.0.113.6',
                ua
            }), gr),
            null
        );
        const v6 = await resolveMcpKeyless(mcpReq({
            peer: '192.168.200.121',
            xff: '2001:db8::1',
            ua
        }), gr);
        assert.ok(v6);
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '192.168.200.121',
                xff: '2001:db8::2',
                ua
            }), gr),
            null
        );

        console.log('allowKeyless off falls through even when UA and CIDR match');
        await getDb().run('UPDATE application_keys SET allow_keyless = 0 WHERE id = ?', [created.summary.id]);
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '192.168.200.121',
                xff: '203.0.113.5',
                ua
            }), gr),
            null
        );
        await getDb().run('UPDATE application_keys SET allow_keyless = 1 WHERE id = ?', [created.summary.id]);
        assert.notStrictEqual(locked.summary.id, created.summary.id);

        console.log('a presented bearer does not switch to keyless');
        assert.strictEqual(
            await resolveMcpKeyless(mcpReq({
                peer: '127.0.0.1',
                ua,
                authorization: 'Bearer sfapp_not-a-real-key'
            }), gr),
            null
        );

        console.log('missing user_type does not become admin');
        await getDb().run(`UPDATE application_keys SET user_type = '' WHERE id = ?`, [created.summary.id]);
        const demoted = await resolveMcpKeyless(mcpReq({ peer: '127.0.0.1', ua }), gr);
        assert.ok(demoted);
        assert.strictEqual(demoted.userType, 'readonly');
        assert.strictEqual(demoted.allowDelete, false);
        await getDb().run(`UPDATE application_keys SET user_type = 'admin' WHERE id = ?`, [created.summary.id]);

        const auditLine = logs.find((line) => line.includes('🔑 keyless'));
        assert.ok(auditLine, 'keyless requests are audited');
        assert.ok(auditLine.includes(`app=${created.summary.id}`));
        assert.ok(auditLine.includes(ua));
        assert.ok(auditLine.includes('127.0.0.1'));
        assert.ok(auditLine.includes('packet=tools/call'));
        assert.ok(auditLine.includes('tool=generate_image'));
        assert.ok(!auditLine.includes(rawKey));
        assert.ok(!logs.join('\n').includes(rawKey));
    } finally {
        console.log = orig;
    }

    console.log('persistent key survives the refresh/expiry job and stays revocable');
    const persistent = await manager.createApplicationKey({
        appName: 'Persistent Grok',
        userAgent: 'PersistentGrok/1.0',
        scopes: ['generation'],
        userType: 'admin',
        persistent: true,
        allowKeyless: false
    });
    const expiring = await manager.createApplicationKey({
        appName: 'Expiring',
        userAgent: 'Expiring/1.0',
        scopes: ['generation'],
        userType: 'admin',
        expiresAt: Date.now() + 86400000
    });
    const past = Math.floor(Date.now() / 1000) - 10;
    await getDb().run(
        'UPDATE application_keys SET expires_at = ?, refresh_before_at = ? WHERE id = ?',
        [past, past, persistent.summary.id]
    );
    await getDb().run(
        'UPDATE application_keys SET expires_at = ?, refresh_before_at = ? WHERE id = ?',
        [past, past, expiring.summary.id]
    );
    const job = await manager.runKeyRefreshExpiryJob();
    assert.ok(job.skippedPersistent >= 1);
    assert.ok(job.expired >= 1);
    const still = await manager.validateApplicationKey(persistent.key, 'PersistentGrok/1.0', {
        clientIp: '203.0.113.5'
    });
    assert.strictEqual(still.valid, true);
    assert.strictEqual(still.persistent, true);
    const listedAfterUse = await manager.listApplicationKeys({ includeExpired: true });
    const usedRow = listedAfterUse.find((row) => row.id === persistent.summary.id);
    assert.strictEqual(usedRow.lastUsedIp, '203.0.113.5');
    assert.ok(usedRow.lastUsedAt);
    const dead = await manager.validateApplicationKey(expiring.key, 'Expiring/1.0');
    assert.strictEqual(dead.valid, false);
    const refreshed = await manager.refreshApplicationKey(persistent.key, 'PersistentGrok/1.0');
    assert.strictEqual(refreshed.valid, false);
    assert.strictEqual(refreshed.code, 'PERSISTENT_NO_REFRESH');
    const afterRefresh = await manager.validateApplicationKey(persistent.key, 'PersistentGrok/1.0');
    assert.strictEqual(afterRefresh.valid, true);
    const revoked = await manager.revokeApplicationKey(persistent.summary.id);
    assert.strictEqual(revoked.success, true);
    const afterRevoke = await manager.validateApplicationKey(persistent.key, 'PersistentGrok/1.0');
    assert.strictEqual(afterRevoke.valid, false);

    console.log('OAuth token-creation offers the same options, admin only');
    const adminHtml = renderConsentPage({
        clientName: 'Grok Connector',
        clientId: 'mcp_grok',
        redirectUri: 'https://example.test/cb',
        scope: 'generation',
        step: 'pick',
        csrf: 'csrf',
        formAction: '/oauth/authorize',
        adminApproval: true,
        keys: [],
        generatedName: 'MCP Grok'
    });
    assert.ok(adminHtml.includes('Allow Keyless Requests (See Trusted Access)'));
    assert.ok(adminHtml.includes('Persistent Key'));
    assert.ok(adminHtml.includes('name="allow_keyless"'));
    assert.ok(adminHtml.includes('name="persistent"'));
    assert.ok(adminHtml.includes('name="trusted_cidrs"'));

    const readonlyHtml = renderConsentPage({
        clientName: 'Grok Connector',
        clientId: 'mcp_grok',
        redirectUri: 'https://example.test/cb',
        scope: 'generation',
        step: 'pick',
        csrf: 'csrf',
        formAction: '/oauth/authorize',
        adminApproval: false,
        keys: [],
        generatedName: 'MCP Grok'
    });
    assert.ok(!readonlyHtml.includes('name="allow_keyless"'));
    assert.ok(!readonlyHtml.includes('name="trusted_cidrs"'));

    const adminOpts = oauthTrustedKeyOptions({
        allow_keyless: '1',
        persistent: '1',
        trusted_cidrs: '203.0.113.9/32, 2001:db8:abcd::/64'
    }, 'admin');
    assert.strictEqual(adminOpts.allowKeyless, true);
    assert.strictEqual(adminOpts.persistent, true);
    assert.deepStrictEqual(adminOpts.trustedCidrs, ['203.0.113.9/32', '2001:db8:abcd::/64']);
    const ignored = oauthTrustedKeyOptions({
        allow_keyless: '1',
        persistent: '1',
        trusted_cidrs: '203.0.113.9/32'
    }, 'readonly');
    assert.deepStrictEqual(ignored, { allowKeyless: false, persistent: false, trustedCidrs: [] });
    assert.throws(() => parseTrustedAccessOptions({ trusted_cidrs: 'not-a-cidr' }, { admin: true }));

    const oauthApp = await manager.createApplicationKey({
        appName: 'OAuth Grok',
        userAgent: 'mcp-oauth-consent',
        scopes: ['generation'],
        userType: 'admin',
        allowKeyless: adminOpts.allowKeyless,
        persistent: adminOpts.persistent,
        trustedCidrs: adminOpts.trustedCidrs
    });
    assert.strictEqual(oauthApp.summary.allowKeyless, true);
    assert.strictEqual(oauthApp.summary.persistent, true);
    assert.deepStrictEqual(oauthApp.summary.trustedCidrs, ['203.0.113.9/32', '2001:db8:abcd::/64']);
    assert.strictEqual(oauthApp.summary.isPerpetual, true);

    if (typeof getDb().close === 'function') await getDb().close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-trusted-keyless-access: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
