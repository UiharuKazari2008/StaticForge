'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cursorUsage = require('../modules/cursorUsage');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const { redactApplicationRequestPath, ApplicationAuthManager } = require('../modules/applicationAuthManager');
const { initializeApplicationAuthDatabase, getDb } = require('../modules/applicationAuthDatabase');

function testPlanAndCost() {
    const summary = cursorUsage._test.summarize({
        billingCycleEnd: Date.now() + (3 * 86400000),
        planUsage: {
            totalPercentUsed: 46.4,
            autoPercentUsed: 10,
            apiPercentUsed: 70,
            totalSpend: 23222,
            includedSpend: 23222,
            bonusSpend: 0,
            limit: 40000
        },
        spendLimitUsage: {
            individualUsed: 150,
            individualLimit: 10000
        }
    }, Date.now(), {
        planInfo: { planName: 'Ultra', includedAmountCents: 40000 }
    });
    assert.strictEqual(summary.plan, 'Ultra');
    assert.strictEqual(summary.label, '46%');
    assert.strictEqual(summary.costCents, 23372);
    assert.strictEqual(summary.costLabel, '$233.72');
    assert.ok(summary.costTitle.includes('Included $232.22'));
    assert.ok(summary.costTitle.includes('On-demand $1.50'));

    assert.strictEqual(cursorUsage._test.formatPlanName('pro_plus'), 'Pro+');
    assert.strictEqual(cursorUsage._test.formatPlanName('free'), 'Free');
    const empty = cursorUsage.publicAccountUsage(null);
    assert.strictEqual(empty.plan, '—');
    assert.strictEqual(empty.costLabel, '—');
}

function testIdentityMatch() {
    const { identitiesMatch, credentialBytesDiffer, tokenSubject } = cursorAccountAuthStore._test;
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user_123' })).toString('base64url');
    const token = `${header}.${body}.sig`;
    assert.strictEqual(tokenSubject(token), 'user_123');
    assert.strictEqual(identitiesMatch(
        { sub: 'user_123', email: 'a@b.co' },
        { sub: 'user_123', email: 'other@b.co' }
    ), true);
    assert.strictEqual(identitiesMatch(
        { sub: '', email: 'A@b.co' },
        { sub: '', email: 'a@b.co' }
    ), true);
    assert.strictEqual(identitiesMatch(
        { sub: 'user_a', email: 'a@b.co' },
        { sub: 'user_b', email: 'a@b.co' }
    ), false);
    assert.strictEqual(identitiesMatch(
        { sub: 'user_a', email: '' },
        { sub: 'user_b', email: '' }
    ), false);
    assert.strictEqual(credentialBytesDiffer(
        { token: 'new', refresh: 'r' },
        { token: 'old', refresh: 'r' }
    ), true);
    assert.strictEqual(credentialBytesDiffer(
        { token: 'same', refresh: 'r' },
        { token: 'same', refresh: 'r' }
    ), false);
}

async function testRequestLog() {
    assert.strictEqual(
        redactApplicationRequestPath('/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/mcp?token=secret'),
        '/{id}/mcp'
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-app-req-log-'));
    const ok = await initializeApplicationAuthDatabase(tmp);
    assert.ok(ok, 'application auth db should initialize');
    const manager = new ApplicationAuthManager({});
    await manager.recordApplicationRequest({
        applicationKeyId: 'key-1',
        appName: 'Studio',
        httpMethod: 'POST',
        path: '/gallery?auth=nope',
        statusCode: 200,
        source: 'http',
        ip: '127.0.0.1',
        userAgent: 'Test/1.0'
    });
    const page = await manager.listApplicationRequests({ page: 1, perPage: 25 });
    assert.strictEqual(page.pagination.totalCount, 1);
    assert.strictEqual(page.requests[0].appName, 'Studio');
    assert.strictEqual(page.requests[0].path, '/gallery');
    assert.strictEqual(page.requests[0].statusCode, 200);
    if (typeof getDb().close === 'function') await getDb().close();
    fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
    testPlanAndCost();
    testIdentityMatch();
    await testRequestLog();
    console.log('test-director-accounts-and-app-log: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
