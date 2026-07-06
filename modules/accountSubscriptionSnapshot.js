/**
 * Persists NovelAI subscription snapshot across server restarts.
 * Detects active → inactive transitions (renewal failure) for client notice.
 *
 * State file: .cache/account_subscription_snapshot.json
 */

const fs = require('fs');
const path = require('path');

/** @type {string|null} */
let snapshotFile = null;

/** @type {{
 *   lastRefreshAt: string|null,
 *   subscription: object|null,
 *   renewalFailedPendingNotice: boolean,
 *   renewalFailedDetectedAt: string|null
 * }} */
let snapshotState = {
    lastRefreshAt: null,
    subscription: null,
    renewalFailedPendingNotice: false,
    renewalFailedDetectedAt: null,
};

/**
 * @param {object|null|undefined} subscription
 * @returns {{ active: boolean, isGracePeriod: boolean, tier: number|null, expiresAt: number|string|null }|null}
 */
function extractSubscriptionSnapshot(subscription) {
    if (!subscription || typeof subscription !== 'object') {
        return null;
    }
    return {
        active: subscription.active !== false,
        isGracePeriod: subscription.isGracePeriod === true,
        tier: typeof subscription.tier === 'number' && Number.isFinite(subscription.tier) ? subscription.tier : null,
        expiresAt: subscription.expiresAt != null ? subscription.expiresAt : null,
    };
}

/**
 * @param {{ active?: boolean, isGracePeriod?: boolean }|null|undefined} snap
 * @returns {boolean}
 */
function isSubscriptionActive(snap) {
    if (!snap) {
        return false;
    }
    if (snap.active) {
        return true;
    }
    if (snap.isGracePeriod) {
        return true;
    }
    return false;
}

function loadSnapshotFromDisk() {
    if (!snapshotFile) {
        return;
    }
    if (!fs.existsSync(snapshotFile)) {
        return;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
        if (parsed && typeof parsed === 'object') {
            snapshotState = {
                lastRefreshAt: parsed.lastRefreshAt || null,
                subscription: extractSubscriptionSnapshot(parsed.subscription) || parsed.subscription || null,
                renewalFailedPendingNotice: parsed.renewalFailedPendingNotice === true,
                renewalFailedDetectedAt: parsed.renewalFailedDetectedAt || null,
            };
        }
    } catch (error) {
        console.warn('⚠️ Failed to load account subscription snapshot:', error.message);
    }
}

function saveSnapshotToDisk() {
    if (!snapshotFile) {
        return;
    }
    try {
        const dir = path.dirname(snapshotFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(snapshotFile, JSON.stringify(snapshotState, null, 2), 'utf-8');
    } catch (error) {
        console.warn('⚠️ Failed to save account subscription snapshot:', error.message);
    }
}

/**
 * @param {import('./globalResources')} globalResources
 */
function initializeAccountSubscriptionSnapshot(globalResources) {
    snapshotFile = globalResources.getPath('accountSubscriptionSnapshot');
    loadSnapshotFromDisk();
}

/**
 * @param {object|null|undefined} subscription
 * @returns {{ renewalFailedDetected: boolean, renewalFailedPendingNotice: boolean, noticeChanged: boolean }}
 */
function recordSubscriptionRefresh(subscription) {
    const now = new Date().toISOString();
    const current = extractSubscriptionSnapshot(subscription);
    const previous = snapshotState.subscription;
    const prevNotice = snapshotState.renewalFailedPendingNotice === true;

    let renewalFailedDetected = false;

    if (previous && isSubscriptionActive(previous) && current && !isSubscriptionActive(current)
        && current.active === false && !current.isGracePeriod) {
        snapshotState.renewalFailedPendingNotice = true;
        snapshotState.renewalFailedDetectedAt = now;
        renewalFailedDetected = true;
        console.warn('⚠️ NovelAI subscription is no longer active (renewal may have failed)');
    }

    if (current && isSubscriptionActive(current) && snapshotState.renewalFailedPendingNotice) {
        snapshotState.renewalFailedPendingNotice = false;
        snapshotState.renewalFailedDetectedAt = null;
    }

    snapshotState.lastRefreshAt = now;
    if (current) {
        snapshotState.subscription = current;
    }

    saveSnapshotToDisk();

    const noticeChanged = prevNotice !== (snapshotState.renewalFailedPendingNotice === true);

    return {
        renewalFailedDetected,
        renewalFailedPendingNotice: snapshotState.renewalFailedPendingNotice === true,
        noticeChanged,
    };
}

/**
 * Client-visible subscription notice fields (get_app_options, ping, health push).
 * @returns {{ subscriptionRenewalFailed: boolean, accountSubscriptionLastRefreshAt: string|null }}
 */
function getAccountSubscriptionNoticeFields() {
    return {
        subscriptionRenewalFailed: snapshotState.renewalFailedPendingNotice === true,
        accountSubscriptionLastRefreshAt: snapshotState.lastRefreshAt || null,
    };
}

module.exports = {
    initializeAccountSubscriptionSnapshot,
    recordSubscriptionRefresh,
    getAccountSubscriptionNoticeFields,
    extractSubscriptionSnapshot,
    isSubscriptionActive,
};
