/**
 * Account / entitlement startup gate (Task 1).
 *
 * Client flags for Tasks 2 & 3:
 *   accountDataDeferred {boolean} — user chose Continue without valid upstream account data
 *   optionsData.accountDataDeferred — mirrored on window.optionsData after defer
 *   optionsData.userDataValid, userDataError, accountStanding, banMessage, upstreamUnavailable — from server
 */

let accountDataDeferred = false;
let accountDataRestartPromptShown = false;
let subscriptionRenewalFailedShownThisSession = false;

function isAccountOptionsHealthy(options) {
    return !!(options && options.userDataValid === true);
}

function isAccountDataDeferred() {
    return accountDataDeferred === true;
}

function buildAccountDataUnavailableDetail(options) {
    const parts = [];
    if (options?.userDataError) {
        // escapeHtml: public/scripts/comp/utilities.js
        parts.push(`<p>${escapeHtml(options.userDataError)}</p>`);
    }
    if (options?.banMessage && options.banMessage !== options.userDataError) {
        parts.push(`<p>${escapeHtml(options.banMessage)}</p>`);
    }
    if (options?.accountStanding && options.accountStanding !== 'ok') {
        parts.push(`<p><strong>Standing:</strong> ${escapeHtml(options.accountStanding)}</p>`);
    }
    if (options?.upstreamUnavailable) {
        parts.push('<p>The upstream NovelAI API could not be reached or is not configured.</p>');
    }
    if (!parts.length) {
        parts.push('<p>Account subscription and entitlement data are missing or incomplete.</p>');
    }
    return parts.join('');
}

function setAccountDataUiVisibility(visible) {
    const show = visible !== false;
    document.querySelectorAll('.balanceDisplay').forEach((el) => {
        el.classList.toggle('hidden', !show);
    });
    const renewal = document.getElementById('subscriptionRenewalIndicator');
    const fixed = document.getElementById('fixedCreditsIndicator');
    if (renewal) {
        if (!show) renewal.classList.add('hidden');
    }
    if (fixed) {
        if (!show) fixed.classList.add('hidden');
    }
}

function applyAccountDataDeferredPresentation() {
    accountDataDeferred = true;
    if (window.optionsData) {
        window.optionsData.accountDataDeferred = true;
    }
    setAccountDataUiVisibility(false);
    // updateBalanceDisplay: public/scripts/comp/balanceDisplay.js
    updateBalanceDisplay({ deferred: true });
}

function applyRetriedAccountData(retryResult) {
    if (!retryResult || !window.optionsData) return;
    const fields = ['userDataValid', 'userDataError', 'accountStanding', 'banMessage', 'upstreamUnavailable', 'subscriptionRenewalFailed', 'accountSubscriptionLastRefreshAt', 'opusUsage'];
    fields.forEach((key) => {
        if (retryResult[key] !== undefined) {
            window.optionsData[key] = retryResult[key];
        }
    });
    if (retryResult.user) {
        window.optionsData.user = retryResult.user;
    }
    if (retryResult.balance) {
        window.optionsData.balance = retryResult.balance;
    }
    accountDataDeferred = false;
    window.optionsData.accountDataDeferred = false;
    setAccountDataUiVisibility(true);
    updateBalanceDisplay(retryResult.balance || window.optionsData.balance);
    // usageToolManager: public/scripts/comp/usageToolManager.js
    usageToolManager.updateUsage(retryResult.opusUsage);
    applyNovelAiStatusFromOptions(window.optionsData);
}

async function showAccountDataRetryProgressDialog() {
    const progressHtml = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px 0;">
            <i class="fas fa-spinner-third fa-spin" style="font-size:1.5rem;"></i>
            <span>Retrying account data from upstream API…</span>
        </div>
    `;
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    const dialogPromise = showConfirmationDialog(progressHtml, [], null, {
        title: 'Refreshing Account Data',
        icon: 'fas fa-user-clock',
        showCloseButton: false,
    });
    return dialogPromise;
}

async function retryAccountDataWithProgress() {
    if (!wsClient) {
        throw new Error('WebSocket client not initialized');
    }
    const progressPromise = showAccountDataRetryProgressDialog();
    try {
        const result = await wsClient.retryAccountData();
        return result;
    } finally {
        hideConfirmationDialog();
        if (progressPromise && typeof progressPromise.then === 'function') {
            progressPromise.then(() => {}).catch(() => {});
        }
    }
}

async function promptRestartClientDialog() {
    const confirmed = await showConfirmationDialog(
        'Valid account and entitlement data is now available. Restart the client to load subscription features and pricing.',
        [
            { text: 'Restart', value: 'restart', className: 'btn-primary' },
            { text: 'Later', value: false, className: 'btn-secondary' },
        ],
        null,
        { title: 'Restart Client', icon: 'fas fa-rotate-right' }
    );
    if (confirmed === 'restart') {
        // runClientRestartDirect: public/scripts/comp/modalUtils.js
        if (typeof runClientRestartDirect === 'function') {
            await runClientRestartDirect();
        } else {
            window.location.reload();
        }
    }
}

async function cancelClientStartup() {
    window.bypassConfirmation = true;
    // runClientShutdownSequence: public/scripts/comp/modalUtils.js
    if (typeof runClientShutdownSequence === 'function') {
        await runClientShutdownSequence(() => {
            window.close();
        });
        return;
    }
    try {
        window.close();
    } catch (_) { /* ignore */ }
    setTimeout(() => {
        try {
            location.href = 'about:blank';
        } catch (_) { /* ignore */ }
    }, 400);
}

async function promptAccountDataUnavailableDialog(options, clientAlreadyActive) {
    const message = 'Remote Generation Management server cannot obtain user account and entitlement data from the upstream API server.'
        + buildAccountDataUnavailableDetail(options);

    return showConfirmationDialog(message, [
        { text: 'Retry', value: 'retry', className: 'btn-primary' },
        { text: 'Continue', value: 'continue', className: 'btn-secondary' },
        { text: 'Cancel', value: 'cancel', className: 'btn-danger' },
    ], null, {
        title: 'Account Data Unavailable',
        icon: 'fas fa-user-slash',
        showCloseButton: false,
    });
}

async function confirmShutdownBeforeCancel() {
    const confirmed = await showConfirmationDialog(
        'Shut down the client?',
        [
            { text: 'Shutdown', value: true, className: 'btn-danger' },
            { text: 'Stay', value: false, className: 'btn-secondary' },
        ],
        null,
        { title: 'Confirm Shutdown', icon: 'fas fa-power-off' }
    );
    return confirmed === true;
}

/**
 * Blocks startup until account data is accepted, retried successfully, or user cancels.
 * @param {object} options - get_app_options payload
 * @returns {Promise<'ok'|'deferred'|'cancelled'>}
 */
async function resolveAccountDataStartupGate(options) {
    if (isAccountOptionsHealthy(options)) {
        accountDataDeferred = false;
        if (window.optionsData) {
            window.optionsData.accountDataDeferred = false;
        }
        setAccountDataUiVisibility(true);
        return 'ok';
    }

    const clientAlreadyActive = appDataLoaded === true;

    while (true) {
        const choice = await promptAccountDataUnavailableDialog(options, clientAlreadyActive);

        if (choice === 'retry') {
            try {
                const retryResult = await retryAccountDataWithProgress();
                if (retryResult && retryResult.userDataValid === true) {
                    applyRetriedAccountData(retryResult);
                    applyNovelAiStatusFromOptions(window.optionsData);
                    maybeShowSubscriptionRenewalFailedNotice(window.optionsData);
                    if (clientAlreadyActive) {
                        await promptRestartClientDialog();
                    }
                    return 'ok';
                }
                if (retryResult) {
                    options = { ...options, ...retryResult };
                    if (window.optionsData) {
                        ['userDataValid', 'userDataError', 'accountStanding', 'banMessage', 'upstreamUnavailable'].forEach((key) => {
                            if (retryResult[key] !== undefined) {
                                window.optionsData[key] = retryResult[key];
                            }
                        });
                        if (retryResult.user) {
                            window.optionsData.user = retryResult.user;
                        }
                        if (retryResult.balance) {
                            window.optionsData.balance = retryResult.balance;
                        }
                    }
                }
            } catch (error) {
                console.error('❌ Account data retry failed:', error);
                showGlassToast('error', 'Retry Failed', error.message || 'Could not refresh account data', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            continue;
        }

        if (choice === 'continue') {
            applyAccountDataDeferredPresentation();
            return 'deferred';
        }

        if (choice === 'cancel' || choice == null) {
            if (clientAlreadyActive) {
                const shutdown = await confirmShutdownBeforeCancel();
                if (!shutdown) {
                    continue;
                }
            }
            await cancelClientStartup();
            return 'cancelled';
        }
    }
}

/**
 * When deferred and server later reports valid account health, prompt restart once.
 * @param {object} health - accountHealth from ping or account_data_health_updated push
 * @param {object} [balance]
 */
async function promptSubscriptionRenewalFailedNotice() {
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    await showConfirmationDialog(
        '<p>Your NovelAI subscription is no longer active. An automatic renewal may have failed.</p>'
        + '<p>Visit <strong>novelai.net</strong> to renew your subscription or update billing for this API key.</p>',
        [{ text: 'OK', value: true, className: 'btn-primary' }],
        null,
        { title: 'Subscription Renewal Failed', icon: 'fas fa-credit-card' }
    );
}

/**
 * Show renewal-failure notice once per client session (startup or when flag becomes true mid-session).
 * @param {object} [options]
 */
function maybeShowSubscriptionRenewalFailedNotice(options) {
    if (subscriptionRenewalFailedShownThisSession) {
        return;
    }
    if (isAccountDataDeferred()) {
        return;
    }
    const source = options || window.optionsData;
    if (!source?.subscriptionRenewalFailed) {
        return;
    }
    subscriptionRenewalFailedShownThisSession = true;
    promptSubscriptionRenewalFailedNotice();
}

function applyAccountHealthFieldsToOptions(health, balance) {
    if (!health || !window.optionsData) {
        return;
    }
    const fields = ['userDataValid', 'userDataError', 'accountStanding', 'banMessage', 'upstreamUnavailable', 'subscriptionRenewalFailed', 'accountSubscriptionLastRefreshAt'];
    fields.forEach((key) => {
        if (health[key] !== undefined) {
            window.optionsData[key] = health[key];
        }
    });
    if (balance && !isAccountDataDeferred()) {
        window.optionsData.balance = balance;
    }
    // syncFixedCreditsIndicatorStanding: public/scripts/comp/trayIndicators.js
    if (typeof syncFixedCreditsIndicatorStanding === 'function') {
        syncFixedCreditsIndicatorStanding();
    }
    // dataMgmtDsapRefreshAccountIfPresent: public/scripts/comp/dataManagementDsapApplet.js
    if (typeof dataMgmtDsapRefreshAccountIfPresent === 'function') {
        dataMgmtDsapRefreshAccountIfPresent();
    }
}

function handleAccountHealthUpdate(health, balance) {
    if (!health || !window.optionsData) {
        return;
    }

    const wasValid = window.optionsData.userDataValid === true;
    const prevStanding = window.optionsData.accountStanding;
    const hadRenewalFailed = window.optionsData.subscriptionRenewalFailed === true;

    applyAccountHealthFieldsToOptions(health, balance);

    if (!hadRenewalFailed && health.subscriptionRenewalFailed === true) {
        maybeShowSubscriptionRenewalFailedNotice(window.optionsData);
    }

    if (appDataLoaded && health.accountStanding === 'banned' && prevStanding !== 'banned') {
        showGlassToast(
            'error',
            'Account Banned',
            health.banMessage || health.userDataError || 'Your NovelAI account is banned',
            false,
            8000,
            '<i class="fas fa-ban"></i>'
        );
    } else if (appDataLoaded && wasValid && health.userDataValid === false && !isAccountDataDeferred()) {
        if (health.accountStanding === 'restricted' && prevStanding !== 'restricted') {
            showGlassToast(
                'warning',
                'Account Restricted',
                health.banMessage || health.userDataError || 'Your NovelAI account access is restricted',
                false,
                8000,
                '<i class="fas fa-circle-exclamation"></i>'
            );
        } else if (health.userDataError) {
            showGlassToast(
                'warning',
                'Account Data Invalid',
                health.userDataError,
                false,
                6000,
                '<i class="fas fa-user-slash"></i>'
            );
        }
    }

    if (health.userDataValid !== true) {
        return;
    }
    if (!accountDataDeferred || accountDataRestartPromptShown) {
        return;
    }
    accountDataRestartPromptShown = true;
    promptRestartClientDialog().finally(() => {
        accountDataRestartPromptShown = false;
    });
}
