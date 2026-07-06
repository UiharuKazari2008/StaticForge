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

    // isAccountDataDeferred: public/scripts/comp/accountDataBootstrap.js
    if (balance?.deferred === true || (typeof isAccountDataDeferred === 'function' && isAccountDataDeferred())) {
        balanceAmount.forEach((amount) => {
            amount.textContent = '---';
        });
        if (balanceFixed) {
            balanceFixed.forEach((fixed) => {
                fixed.textContent = '---';
            });
        }
        if (balancePaid) {
            balancePaid.forEach((paid) => {
                paid.textContent = '---';
            });
        }
        balanceDisplay.forEach((display) => {
            display.title = 'Account data unavailable';
            display.classList.remove('low-credits');
        });
        if (balanceIcon) {
            balanceIcon.className = 'fas fa-user-slash';
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
        amount.textContent = totalCredits;
    });

    if (balanceFixed) {
        balanceFixed.forEach(fixed => {
            fixed.textContent = fixedCredits;
        });
    }
    if (balancePaid) {
        balancePaid.forEach(paid => {
            paid.textContent = purchasedCredits;
        });
    }

    // Update tooltip with detailed breakdown
    const tooltip = `Free Credits: ${fixedCredits}\nPaid Credits: ${purchasedCredits}`;
    balanceDisplay.forEach(display => {
        display.title = tooltip;
        display.classList.remove('low-credits');
    });

    if (totalCredits !== -1) {
        currentBalance = totalCredits;
    }

    if (totalCredits === -1) {
        balanceIcon.className = 'nai-anla';
        balanceAmount.forEach(amount => {
            amount.textContent = 'Error';
        });
        balanceDisplay.forEach(display => {
            display.classList.add('low-credits');
        });
    } else if (totalCredits === 0) {
        // No credits - show dollar sign and warning styling
        balanceIcon.className = 'nai-anla';
        balanceDisplay.forEach(display => {
            display.classList.add('low-credits');
        });
    } else if (fixedCredits === 0) {
        // No free credits - show dollar sign
        balanceIcon.className = 'nai-anla';
    } else if (totalCredits < 5000) {
        // Low credits - show warning triangle and orange styling
        balanceIcon.className = 'fas fa-exclamation-triangle';
        balanceDisplay.forEach(display => {
            display.classList.add('low-credits');
        });
    } else {
        // Normal credits - show coin icon
        balanceIcon.className = 'nai-anla';
    }

    // Update fixed credits indicator
    updateFixedCreditsIndicator();
}

