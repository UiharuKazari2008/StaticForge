#!/usr/bin/env node
/**
 * The Android app's background notification credits (#890, modules/backgroundNotificationCredits.js):
 * GET /android/background-notification answers from the server's last balance (no NovelAI call per
 * request) and asks upstream only while the server holds none; as_credits uses the same values.
 *   node scripts/test-background-notification-credits.js
 */
'use strict';

const assert = require('assert');
const c = require('../modules/backgroundNotificationCredits');

(async () => {
    const now = Date.UTC(2026, 10, 17, 12, 0, 0);
    const expiresAt = Math.floor((now + 10.5 * 86400000) / 1000);
    assert.deepStrictEqual(c.creditsValues({ fixedTrainingStepsLeft: 8000, purchasedTrainingSteps: 120 }, expiresAt, now), { free: '8000', paid: '120', daysLeft: '11' });
    assert.deepStrictEqual(c.creditsValues(null, '', now), { free: '0', paid: '0', daysLeft: '' });
    assert.strictEqual(c.creditsValues({}, Math.floor((now - 86400000) / 1000), now).daysLeft, '0', 'expired: 0 days');

    let accountData = { ok: true, subscription: { expiresAt, trainingStepsLeft: { fixedTrainingStepsLeft: 500, purchasedTrainingSteps: 7 } } };
    const gr = {
        getAccountData: () => ({ ...accountData }),
        getAccountBalance: () => {
            const t = (accountData.subscription && accountData.subscription.trainingStepsLeft) || {};
            return { fixedTrainingStepsLeft: t.fixedTrainingStepsLeft || 0, purchasedTrainingSteps: t.purchasedTrainingSteps || 0 };
        }
    };
    let fetched = 0;
    const fetchBalance = async () => { fetched += 1; return { ok: true, fixedTrainingStepsLeft: 1, purchasedTrainingSteps: 2, subscription: { expiresAt } }; };

    assert.strictEqual(c.hasCachedCredits(gr), true);
    let v = await c.notificationCredits(gr, fetchBalance, now);
    assert.deepStrictEqual(v, { free: '500', paid: '7', daysLeft: '11' }, 'from the cached balance');
    assert.strictEqual(fetched, 0, 'no NovelAI call while the server holds a balance');
    assert.deepStrictEqual(c.currentCredits(gr, now), v, 'as_credits reads the same values');

    // nothing held yet (early boot): the live read
    accountData = { ok: false };
    assert.strictEqual(c.hasCachedCredits(gr), false);
    v = await c.notificationCredits(gr, fetchBalance, now);
    assert.deepStrictEqual(v, { free: '1', paid: '2', daysLeft: '11' });
    assert.strictEqual(fetched, 1);
    // a failed live read: zeros, the expiry from what the server has
    accountData = { ok: false, subscription: { expiresAt } };
    v = await c.notificationCredits(gr, async () => ({ ok: false, subscription: null }), now);
    assert.deepStrictEqual(v, { free: '0', paid: '0', daysLeft: '11' });

    console.log('background notification credits: ok');
})().catch((e) => { console.error(e); process.exit(1); });
