'use strict';

const assert = require('assert');
const {
    SUBSCRIPTION_USAGE_POLL_MS,
    normalizeOpusUsage,
    takePolledUsage,
    resolveOpusUsageForGauge,
    getOpusUsageFromAccountData
} = require('../modules/opusUsage');

assert.strictEqual(SUBSCRIPTION_USAGE_POLL_MS, 60 * 1000);

const live = {
    percent: 42,
    isNegative: false,
    timeUntilNextPercent: 7888
};

assert.deepStrictEqual(normalizeOpusUsage(live), live);
assert.strictEqual(normalizeOpusUsage({ percent: 1 }), null);
assert.strictEqual(normalizeOpusUsage(null), null);

const balance = {
    ok: true,
    subscription: {
        tier: 3,
        active: true,
        usage: {
            percent: '55',
            isNegative: false,
            timeUntilNextPercent: 1200
        }
    }
};
assert.deepStrictEqual(takePolledUsage(balance), {
    percent: 55,
    isNegative: false,
    timeUntilNextPercent: 1200
});
assert.strictEqual(takePolledUsage({ ok: false, subscription: { usage: live } }), null);
assert.strictEqual(takePolledUsage({ ok: true, subscription: { tier: 3 } }), null);

const loginSnapshot = {
    subscription: {
        usage: { percent: 10, isNegative: false, timeUntilNextPercent: 5000 }
    }
};

// First paint: /user/data snapshot until a subscription poll lands.
assert.deepStrictEqual(resolveOpusUsageForGauge(loginSnapshot, null), {
    percent: 10,
    isNegative: false,
    timeUntilNextPercent: 5000
});

// Live gauge uses the polled .usage, including after a later /user/data refresh.
const imageCount = 480;
assert.strictEqual(typeof imageCount, 'number');
assert.deepStrictEqual(resolveOpusUsageForGauge(loginSnapshot, live), live);
assert.deepStrictEqual(
    resolveOpusUsageForGauge(
        { subscription: { usage: { percent: 99, isNegative: true, timeUntilNextPercent: 1 } } },
        takePolledUsage(balance)
    ),
    { percent: 55, isNegative: false, timeUntilNextPercent: 1200 }
);

assert.deepStrictEqual(getOpusUsageFromAccountData(loginSnapshot), {
    percent: 10,
    isNegative: false,
    timeUntilNextPercent: 5000
});

console.log('test-subscription-usage-poll: ok');
