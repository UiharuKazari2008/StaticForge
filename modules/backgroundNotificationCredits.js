'use strict';

/**
 * The credits line of the Android app's background notification (#890): free and paid Anlas and
 * the subscription's days left, all strings ({ free, paid, daysLeft }; daysLeft '' when unknown).
 *
 *   GET /android/background-notification (web_server.js) answers with it from the server's last
 *   balance (refreshBalance keeps it current); NovelAI is asked only while the server has none yet.
 *   ActiveSync's background links get it pushed instead (as_credits, modules/activeSync.js
 *   pushCredits) from the same values, once after their hello and whenever it changes,
 *   so the app no longer asks every 15 minutes while its link is up.
 */

const DAY_MS = 86400000;

/**
 * balance: { fixedTrainingStepsLeft, purchasedTrainingSteps } (null: nothing known, both 0).
 * expiresAt: the subscription's end in Unix seconds (null / '' when unknown).
 */
function creditsValues(balance, expiresAt, now = Date.now()) {
    const b = balance && typeof balance === 'object' ? balance : {};
    let daysLeft = '';
    if (expiresAt != null && expiresAt !== '') {
        const sec = Number(expiresAt);
        if (Number.isFinite(sec)) {
            const d = Math.ceil((sec * 1000 - now) / DAY_MS);
            daysLeft = String(d > 0 ? d : 0);
        }
    }
    return {
        free: String(b.fixedTrainingStepsLeft || 0),
        paid: String(b.purchasedTrainingSteps || 0),
        daysLeft
    };
}

function accountDataOf(globalResources) {
    if (!globalResources) return null;
    return typeof globalResources.getAccountData === 'function' ? globalResources.getAccountData() : globalResources.accountData;
}

/** The values from what the server already holds (no NovelAI call): its last balance and subscription. */
function currentCredits(globalResources, now = Date.now()) {
    if (!globalResources) return null;
    const balance = typeof globalResources.getAccountBalance === 'function' ? globalResources.getAccountBalance() : null;
    const accountData = accountDataOf(globalResources);
    const expiresAt = accountData && accountData.subscription ? accountData.subscription.expiresAt : null;
    return creditsValues(balance, expiresAt, now);
}

/** The server holds a balance (a subscription read with its training steps), so no NovelAI call is needed. */
function hasCachedCredits(globalResources) {
    const accountData = accountDataOf(globalResources);
    const sub = accountData && accountData.subscription;
    return !!(sub && typeof sub === 'object' && sub.trainingStepsLeft && typeof sub.trainingStepsLeft === 'object');
}

/**
 * GET /android/background-notification's values: the server's last balance (#890: no NovelAI call per
 * request; refreshBalance keeps it current), or fetchBalance() (the live read, getBalance) while the
 * server has none yet.
 */
async function notificationCredits(globalResources, fetchBalance, now = Date.now()) {
    if (hasCachedCredits(globalResources) || typeof fetchBalance !== 'function') return currentCredits(globalResources, now);
    const balance = await fetchBalance();
    let expiresAt = balance && balance.subscription && balance.subscription.expiresAt;
    if (expiresAt == null) {
        const accountData = accountDataOf(globalResources);
        expiresAt = accountData && accountData.subscription && accountData.subscription.expiresAt;
    }
    return creditsValues(balance && balance.ok ? balance : null, expiresAt, now);
}

module.exports = { creditsValues, currentCredits, hasCachedCredits, notificationCredits };
