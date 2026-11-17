'use strict';

/**
 * The credits line of the Android app's background notification (#890): free and paid Anlas and
 * the subscription's days left, all strings ({ free, paid, daysLeft }; daysLeft '' when unknown).
 *
 *   GET /android/background-notification (web_server.js) answers with it from a fresh balance read.
 *   ActiveSync's background links get it pushed instead (as_credits, modules/activeSync.js
 *   pushCredits) from the server's last balance, once after their hello and whenever it changes,
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

/** The values from what the server already holds (no NovelAI call): its last balance and subscription. */
function currentCredits(globalResources, now = Date.now()) {
    if (!globalResources) return null;
    const balance = typeof globalResources.getAccountBalance === 'function' ? globalResources.getAccountBalance() : null;
    const accountData = typeof globalResources.getAccountData === 'function' ? globalResources.getAccountData() : globalResources.accountData;
    const expiresAt = accountData && accountData.subscription ? accountData.subscription.expiresAt : null;
    return creditsValues(balance, expiresAt, now);
}

module.exports = { creditsValues, currentCredits };
