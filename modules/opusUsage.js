'use strict';

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

module.exports = {
    getOpusUsageFromAccountData,
    normalizeOpusUsage
};
