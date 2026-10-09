'use strict';

/** Webapp polls GET /user/subscription about every 60s (Frost, b0f9d00). */
const SUBSCRIPTION_USAGE_POLL_MS = 60 * 1000;

function normalizeOpusUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const percent = Number(usage.percent);
    const timeUntilNextPercent = Number(usage.timeUntilNextPercent);
    if (!Number.isFinite(percent) || !Number.isFinite(timeUntilNextPercent)) return null;
    return {
        percent,
        isNegative: usage.isNegative === true,
        timeUntilNextPercent
    };
}

function getOpusUsageFromAccountData(accountData) {
    return normalizeOpusUsage(accountData?.subscription?.usage);
}

/**
 * Usage object from a getBalance() result (GET /user/subscription body on .subscription).
 * @param {{ ok?: boolean, subscription?: object }|null|undefined} balanceResult
 * @returns {ReturnType<typeof normalizeOpusUsage>}
 */
function takePolledUsage(balanceResult) {
    if (!balanceResult || balanceResult.ok !== true) return null;
    return normalizeOpusUsage(balanceResult.subscription && balanceResult.subscription.usage);
}

/**
 * Live gauge reads the polled /user/subscription usage.
 * The /user/data snapshot is the first paint when no poll has landed yet.
 * Image counts are not an input.
 * @param {object|null|undefined} accountData
 * @param {object|null|undefined} liveUsage
 */
function resolveOpusUsageForGauge(accountData, liveUsage) {
    const live = normalizeOpusUsage(liveUsage);
    if (live) return live;
    return getOpusUsageFromAccountData(accountData);
}

module.exports = {
    SUBSCRIPTION_USAGE_POLL_MS,
    getOpusUsageFromAccountData,
    normalizeOpusUsage,
    takePolledUsage,
    resolveOpusUsageForGauge
};
