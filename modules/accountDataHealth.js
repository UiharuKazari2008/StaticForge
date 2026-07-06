/**
 * NovelAI account / entitlement health evaluation for /user/data responses.
 *
 * Shared contract (Task 1 — consumed by Tasks 2 & 3 via get_app_options, retry_account_data, ping):
 *   userDataValid      {boolean}  true when subscription tier and entitlements are usable
 *   userDataError      {string|null}  human-readable reason when invalid
 *   accountStanding    {string}   'ok' | 'banned' | 'restricted' | 'incomplete' | 'unavailable'
 *   banMessage         {string|null}  ban/suspension detail when accountStanding is banned/restricted
 *   upstreamUnavailable {boolean}  true when upstream could not be reached or API key is missing/locked
 */

const UPSTREAM_UNAVAILABLE_REASONS = new Set([
    'missing_api_key',
    'service_locked',
    'no_callback',
]);

const NETWORK_ERROR_MARKERS = ['ETIMEDOUT', 'ENETUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'timeout', 'network'];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRetryableNetworkMessage(value) {
    if (!value) return false;
    const text = String(value).toLowerCase();
    return NETWORK_ERROR_MARKERS.some((marker) => text.includes(marker.toLowerCase()));
}

/**
 * @param {object|null|undefined} data
 * @returns {{ accountStanding: string, banMessage: string|null }|null}
 */
function detectBanFromPayload(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    if (data.banned === true || data.isBanned === true) {
        return {
            accountStanding: 'banned',
            banMessage: data.banMessage || data.banReason || 'Account is banned',
        };
    }

    const information = data.information;
    if (information && typeof information === 'object') {
        if (information.banned === true || information.isBanned === true) {
            return {
                accountStanding: 'banned',
                banMessage: information.banMessage || information.banReason || 'Account is banned',
            };
        }
        const infoStanding = information.accountStanding;
        if (infoStanding != null) {
            const normalized = String(infoStanding).toLowerCase();
            if (normalized === 'banned' || normalized === 'suspended') {
                return {
                    accountStanding: 'banned',
                    banMessage: information.banMessage || information.banReason || String(infoStanding),
                };
            }
            if (normalized === 'restricted') {
                return {
                    accountStanding: 'restricted',
                    banMessage: information.banMessage || information.banReason || 'Account access is restricted',
                };
            }
        }
    }

    if (data.accountStanding != null) {
        const normalized = String(data.accountStanding).toLowerCase();
        if (normalized === 'banned' || normalized === 'suspended') {
            return {
                accountStanding: 'banned',
                banMessage: data.banMessage || data.banReason || String(data.accountStanding),
            };
        }
        if (normalized === 'restricted') {
            return {
                accountStanding: 'restricted',
                banMessage: data.banMessage || data.banReason || 'Account access is restricted',
            };
        }
    }

    const subscription = data.subscription;
    if (subscription && typeof subscription === 'object') {
        if (subscription.banned === true || subscription.isBanned === true) {
            return {
                accountStanding: 'banned',
                banMessage: subscription.banMessage || subscription.banReason || 'Account is banned',
            };
        }
        const subStanding = subscription.accountStanding;
        if (subStanding != null) {
            const normalized = String(subStanding).toLowerCase();
            if (normalized === 'banned' || normalized === 'suspended') {
                return {
                    accountStanding: 'banned',
                    banMessage: subscription.banMessage || subscription.banReason || String(subStanding),
                };
            }
            if (normalized === 'restricted') {
                return {
                    accountStanding: 'restricted',
                    banMessage: subscription.banMessage || subscription.banReason || 'Account access is restricted',
                };
            }
        }
    }

    return null;
}

/**
 * @param {string|null|undefined} error
 * @param {number|null|undefined} statusCode
 * @returns {{ accountStanding: string, banMessage: string|null }|null}
 */
function detectBanFromError(error, statusCode) {
    if (!error) {
        if (statusCode === 403) {
            return { accountStanding: 'restricted', banMessage: 'Access forbidden (HTTP 403)' };
        }
        return null;
    }

    const text = String(error);
    const lower = text.toLowerCase();
    if (lower.includes('ban') || lower.includes('suspend') || lower.includes('disabled')) {
        return { accountStanding: 'banned', banMessage: text };
    }
    if (statusCode === 403) {
        return { accountStanding: 'restricted', banMessage: text };
    }
    return null;
}

/**
 * Valid user object: upstream fetch succeeded, subscription present with numeric tier, not banned.
 * @param {object|null|undefined} userData - Raw getUserData() result (includes ok wrapper fields)
 * @returns {{
 *   userDataValid: boolean,
 *   userDataError: string|null,
 *   accountStanding: string,
 *   banMessage: string|null,
 *   upstreamUnavailable: boolean
 * }}
 */
function evaluateAccountDataHealth(userData) {
    const emptyHealth = {
        userDataValid: false,
        userDataError: 'No account data',
        accountStanding: 'unavailable',
        banMessage: null,
        upstreamUnavailable: true,
    };

    if (!userData || typeof userData !== 'object') {
        return emptyHealth;
    }

    const reason = userData.reason || null;
    const errorText = userData.error || null;
    const statusCode = userData.statusCode;

    if (userData.ok !== true) {
        const banInfo = detectBanFromError(errorText, statusCode);
        const upstreamUnavailable = UPSTREAM_UNAVAILABLE_REASONS.has(reason)
            || (statusCode != null && statusCode >= 500)
            || isRetryableNetworkMessage(errorText);

        let userDataError = errorText || reason || 'Failed to fetch account data from NovelAI';
        if (reason === 'missing_api_key') {
            userDataError = 'No NovelAI API key configured';
        } else if (reason === 'service_locked') {
            userDataError = 'NovelAI API access is temporarily locked';
        }

        return {
            userDataValid: false,
            userDataError,
            accountStanding: banInfo ? banInfo.accountStanding : 'unavailable',
            banMessage: banInfo ? banInfo.banMessage : null,
            upstreamUnavailable,
        };
    }

    const banFromPayload = detectBanFromPayload(userData);
    if (banFromPayload) {
        return {
            userDataValid: false,
            userDataError: banFromPayload.banMessage || 'Account is not permitted to use NovelAI services',
            accountStanding: banFromPayload.accountStanding,
            banMessage: banFromPayload.banMessage,
            upstreamUnavailable: false,
        };
    }

    const subscription = userData.subscription;
    if (!subscription || typeof subscription !== 'object') {
        return {
            userDataValid: false,
            userDataError: 'Upstream response is missing subscription data',
            accountStanding: 'incomplete',
            banMessage: null,
            upstreamUnavailable: false,
        };
    }

    const tier = subscription.tier;
    if (typeof tier !== 'number' || !Number.isFinite(tier) || tier < 0 || tier > 3) {
        return {
            userDataValid: false,
            userDataError: 'Upstream subscription is missing a valid tier',
            accountStanding: 'incomplete',
            banMessage: null,
            upstreamUnavailable: false,
        };
    }

    if (subscription.active === false && !subscription.isGracePeriod) {
        return {
            userDataValid: false,
            userDataError: 'NovelAI subscription is not active',
            accountStanding: 'restricted',
            banMessage: null,
            upstreamUnavailable: false,
        };
    }

    return {
        userDataValid: true,
        userDataError: null,
        accountStanding: 'ok',
        banMessage: null,
        upstreamUnavailable: false,
    };
}

/**
 * @param {object} health - evaluateAccountDataHealth() result
 * @returns {object}
 */
function getAccountHealthPublicFields(health) {
    return {
        userDataValid: !!health.userDataValid,
        userDataError: health.userDataError || null,
        accountStanding: health.accountStanding || 'unavailable',
        banMessage: health.banMessage || null,
        upstreamUnavailable: !!health.upstreamUnavailable,
    };
}

/**
 * Re-evaluate health after /user/subscription balance sync (refreshBalance).
 * @param {object|null|undefined} accountData - Stored server accountData
 * @param {{ ok?: boolean, reason?: string, error?: string|null, subscription?: object|null }} balanceResult
 * @returns {ReturnType<typeof evaluateAccountDataHealth>}
 */
function evaluateAccountHealthAfterBalanceSync(accountData, balanceResult) {
    if (balanceResult && balanceResult.ok === true) {
        const base = accountData && typeof accountData === 'object' ? accountData : {};
        const subscription = {
            ...(base.subscription || {}),
            ...(balanceResult.subscription && typeof balanceResult.subscription === 'object'
                ? balanceResult.subscription
                : {}),
        };
        if (base.subscription?.trainingStepsLeft) {
            subscription.trainingStepsLeft = base.subscription.trainingStepsLeft;
        }
        return evaluateAccountDataHealth({
            ...base,
            ok: true,
            subscription,
        });
    }

    if (balanceResult && balanceResult.ok === false) {
        const reason = balanceResult.reason || null;
        const hasTier = accountData?.subscription && typeof accountData.subscription.tier === 'number';
        if (hasTier && accountData.ok !== false) {
            const health = evaluateAccountDataHealth({ ...accountData, ok: true });
            if (reason === 'missing_api_key' || reason === 'service_locked') {
                return {
                    ...health,
                    upstreamUnavailable: true,
                    userDataError: reason === 'missing_api_key'
                        ? 'No NovelAI API key configured'
                        : 'NovelAI API access is temporarily locked',
                };
            }
            return health;
        }
        return evaluateAccountDataHealth({
            ok: false,
            reason: reason || 'balance_fetch_failed',
            error: balanceResult.error || null,
        });
    }

    return evaluateAccountDataHealth(accountData || { ok: false });
}

module.exports = {
    evaluateAccountDataHealth,
    getAccountHealthPublicFields,
    evaluateAccountHealthAfterBalanceSync,
};
