/** Balance display + submenu toggles (Phase 2 batch 13). */
let focusCoverEnabled = false;
try {
    const savedFocusCoverState = localStorage.getItem('focusCoverEnabled');
    if (savedFocusCoverState !== null) {
        focusCoverEnabled = savedFocusCoverState === 'true';
    }
} catch (e) { /* ignore */ }
// Setup event listeners — peeled subsystems wire via comp init steps (Phase 2 batch 8+):
// wireManualModalChromeListeners, wireGenerateButtonContextMenus → manualModalManager.js (step 47)
// wireManualGenerationParamsListeners → manualGenerationParams.js (step 47.4)
// wireManualResolutionDimensionListeners, wireManualDropdownSetup → manualDropdownManager.js (step 47.5)
// wireUploadClipboardListeners → referenceManager.js (step 40)
// wireSeedListeners, wireInlinePresetListeners → presetManager.js (step 461)
function toggleSubMenu() {
    const menu = document.querySelectorAll('.sub-menu-toggle');
    if (menu) {
        menu.forEach(menu => {
            menu.classList.toggle('hidden');
        });
    }
}

function closeSubMenu() {
    const menu = document.querySelectorAll('.sub-menu-toggle');
    if (menu) {
        menu.forEach(menu => {
            menu.classList.add('hidden');
        });
    }
}

// Store previous balance to detect changes
let previousBalance = null;

// Update balance display
function updateBalanceDisplay(balance) {
    const balanceDisplay = document.querySelectorAll('.balanceDisplay');
    const balanceAmount = document.querySelectorAll('.balanceAmount');

    const balanceFixed = document.querySelectorAll('.balanceFixed');
    const balancePaid = document.querySelectorAll('.balancePaid');

    if (!balanceDisplay || !balanceAmount) return;

    const balanceIcon = balanceDisplay[0].querySelector('i');
    // set*IfChanged: public/scripts/utils/domWrite.js (this runs on every server ping; most pings change nothing)

    // isAccountDataDeferred: public/scripts/comp/accountDataBootstrap.js
    if (balance?.deferred === true || (typeof isAccountDataDeferred === 'function' && isAccountDataDeferred())) {
        balanceAmount.forEach((amount) => {
            setTextIfChanged(amount, '---');
        });
        if (balanceFixed) {
            balanceFixed.forEach((fixed) => {
                setTextIfChanged(fixed, '---');
            });
        }
        if (balancePaid) {
            balancePaid.forEach((paid) => {
                setTextIfChanged(paid, '---');
            });
        }
        balanceDisplay.forEach((display) => {
            setAttrIfChanged(display, 'title', 'Account data unavailable');
            setClassIfChanged(display, 'low-credits', false);
        });
        if (balanceIcon) {
            setClassNameIfChanged(balanceIcon, 'fas fa-user-slash');
        }
        return;
    }

    const totalCredits = balance?.totalCredits || 0;
    const fixedCredits = balance?.fixedTrainingStepsLeft || 0;
    const purchasedCredits = balance?.purchasedTrainingSteps || 0;

    // Check for balance changes
    if (previousBalance !== null && PopoverManager) {
        const oldFixed = previousBalance.fixedTrainingStepsLeft || 0;
        const oldPaid = previousBalance.purchasedTrainingSteps || 0;
        const oldTotal = previousBalance.totalCredits || 0;

        // Detect balance change (increase or decrease) — only when total credits changed
        if (totalCredits !== oldTotal) {
            const fixedChange = fixedCredits - oldFixed;
            const paidChange = purchasedCredits - oldPaid;

            const changes = [];
            if (fixedChange !== 0 || paidChange !== 0) {
                if (fixedChange > 0) changes.push(`+${fixedChange} free`);
                else if (fixedChange < 0) changes.push(`${fixedChange} free`);
                if (paidChange > 0) changes.push(`+${paidChange} paid`);
                else if (paidChange < 0) changes.push(`${paidChange} paid`);
            }

            const message = changes.length > 0
                ? `<i class="nai-anla"></i> ${changes.join(', ')}`
                : '';

            // On desktop the server receipt notifications drive the credits tray popover; skip the
            // generic client-side balance toast so it can't override the receipt popup.
            if (message && !window.isDesktop) {
                showGlassToast(
                    'info',
                    'Balance Updated',
                    message,
                    false,
                    10000,
                    '<i class="fas fa-sync-alt"></i>'
                );
            }
        }
    }

    // Update previous balance
    previousBalance = {
        fixedTrainingStepsLeft: fixedCredits,
        purchasedTrainingSteps: purchasedCredits,
        totalCredits: totalCredits
    };

    // Update amount
    balanceAmount.forEach(amount => {
        setTextIfChanged(amount, totalCredits);
    });

    if (balanceFixed) {
        balanceFixed.forEach(fixed => {
            setTextIfChanged(fixed, fixedCredits);
        });
    }
    if (balancePaid) {
        balancePaid.forEach(paid => {
            setTextIfChanged(paid, purchasedCredits);
        });
    }

    // Update tooltip with detailed breakdown
    const tooltip = `Free Credits: ${fixedCredits}\nPaid Credits: ${purchasedCredits}`;
    balanceDisplay.forEach(display => {
        setAttrIfChanged(display, 'title', tooltip);
        setClassIfChanged(display, 'low-credits', false);
    });

    if (totalCredits !== -1) {
        currentBalance = totalCredits;
    }

    if (totalCredits === -1) {
        setClassNameIfChanged(balanceIcon, 'nai-anla');
        balanceAmount.forEach(amount => {
            setTextIfChanged(amount, 'Error');
        });
        balanceDisplay.forEach(display => {
            setClassIfChanged(display, 'low-credits', true);
        });
    } else if (totalCredits === 0) {
        // No credits - show dollar sign and warning styling
        setClassNameIfChanged(balanceIcon, 'nai-anla');
        balanceDisplay.forEach(display => {
            setClassIfChanged(display, 'low-credits', true);
        });
    } else if (fixedCredits === 0) {
        // No free credits - show dollar sign
        setClassNameIfChanged(balanceIcon, 'nai-anla');
    } else if (totalCredits < 5000) {
        // Low credits - show warning triangle and orange styling
        setClassNameIfChanged(balanceIcon, 'fas fa-exclamation-triangle');
        balanceDisplay.forEach(display => {
            setClassIfChanged(display, 'low-credits', true);
        });
    } else {
        // Normal credits - show coin icon
        setClassNameIfChanged(balanceIcon, 'nai-anla');
    }

    // Update fixed credits indicator
    updateFixedCreditsIndicator();
}

