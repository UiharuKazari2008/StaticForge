/** System tray account / indexing indicators (Phase 2 batch 13). */
let showSubscriptionExpirationToast = false;
let showFixedTrainingStepsToast = false;

function isDesktopTrayBootPending() {
    return !!(window.isDesktop && !window._systemTrayBootComplete);
}
window.isDesktopTrayBootPending = isDesktopTrayBootPending;

function isSystemTrayBootComplete() {
    return !window.isDesktop || window._systemTrayBootComplete === true;
}

function shouldDeferTrayNotifications() {
    return isDesktopTrayBootPending();
}

function revealTrayIconElement(el, animate = true) {
    if (!el) return;
    el.classList.remove('hidden');
    if (animate) {
        el.classList.remove('tray-boot-in');
        void el.offsetWidth;
        el.classList.add('tray-boot-in');
    }
}

function revealTrayIconById(id, animate = true) {
    revealTrayIconElement(document.getElementById(id), animate);
}

async function checkSubscriptionExpiration(options = {}) {
    if (!window.optionsData?.user?.subscription?.expiresAt) return;

    const renewalData = getSubscriptionRenewalDisplayData(window.optionsData.user.subscription.expiresAt);
    const subTier = window.optionsData.user.subscription.tier;
    const subName = subTier === 3 ? 'Opus' : subTier === 2 ? 'Scroll' : subTier === 1 ? 'Tablet' : 'Enterprise';

    if (renewalData.msUntilRenewal <= (7 * 24 * 60 * 60 * 1000) && renewalData.msUntilRenewal > 0) {
        if (!options.forceDisplay && shouldDeferTrayNotifications()) {
            return;
        }
        if (!showSubscriptionExpirationToast) {
            const message = `Your NovelAI ${subName} subscription will renew in ${renewalData.timeRemaining}! (${renewalData.renewalDateTimeStr})`;
            showGlassToast('warning', 'NovelAI Subscription Status', message, false, 15000);
            showSubscriptionExpirationToast = true;
        }
    }
}

async function checkFixedTrainingSteps(options = {}) {
    if (!window.optionsData?.balance || !window.optionsData?.user?.subscription?.expiresAt) {
        console.error('No balance data available');
        return;
    }

    const fixedSteps = window.optionsData.balance.fixedTrainingStepsLeft || 0;
    const renewalData = getSubscriptionRenewalDisplayData(window.optionsData.user.subscription.expiresAt);
    const daysUntilRenewal = Math.max(1, renewalData.daysUntilRenewal);
    const usePerDay = parseInt((fixedSteps / daysUntilRenewal).toFixed(0));
    const usePerHour = Math.max(1, parseInt((fixedSteps / Math.max(1, renewalData.hoursUntilRenewal)).toFixed(0)));
    const pacingSuggestion = renewalData.hoursUntilRenewal < 96
        ? `${usePerHour} Anlas per hour`
        : `${usePerDay} Anlas per day`;
    if (fixedSteps > 500 && daysUntilRenewal <= 15 && daysUntilRenewal > 0) {
        if (!options.forceDisplay && shouldDeferTrayNotifications()) {
            return;
        }
        if (!showFixedTrainingStepsToast) {
            showGlassToast('info', 'Account Fixed Anlas Expiring',
                `You have <i class="nai-anla"></i> ${fixedSteps} Fixed Anlas remaining that will expire.<br/>
                Consider burning <i class="nai-anla"></i> ${pacingSuggestion} over the next ${renewalData.timeRemaining}.`, false, 300000, '<i class="nai-anla"></i>');
            showFixedTrainingStepsToast = true;
        }
    } else {
        // Reset so the toast can fire again when account state re-enters the warning window.
        showFixedTrainingStepsToast = false;
    }
}

async function flushDeferredAccountTrayNotifications() {
    await checkSubscriptionExpiration({ forceDisplay: true });
    await checkFixedTrainingSteps({ forceDisplay: true });
    // usageToolManager: public/scripts/comp/usageToolManager.js
    usageToolManager.notifyExtendedUsage({ forceDisplay: true });
}

function flushDeferredNetworkTrayNotifications() {
    if (!window.wsClient || typeof window.wsClient.flushDeferredPingTrayNotification !== 'function') return;
    window.wsClient.flushDeferredPingTrayNotification();
}

function getSubscriptionRenewalDisplayData(expiresAtUnix) {
    const expiresAt = new Date(expiresAtUnix * 1000);
    const now = new Date();
    const msUntilRenewal = expiresAt - now;
    const hourMs = 1000 * 60 * 60;
    const dayMs = 1000 * 60 * 60 * 24;

    // Use ceiling so users are warned before a period fully elapses.
    const hoursUntilRenewal = Math.ceil(msUntilRenewal / hourMs);
    const daysUntilRenewal = Math.ceil(msUntilRenewal / dayMs);

    // Calendar-day delta in local timezone avoids "2 days" when renewal date is tomorrow locally.
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfRenewalDay = new Date(expiresAt.getFullYear(), expiresAt.getMonth(), expiresAt.getDate());
    const calendarDaysUntilRenewal = Math.max(0, Math.round((startOfRenewalDay - startOfToday) / dayMs));

    const useHours = hoursUntilRenewal < 96;
    const timeRemainingValue = useHours ? hoursUntilRenewal : calendarDaysUntilRenewal;
    const timeRemainingUnit = useHours ? 'hour' : 'day';
    const timeRemaining = `${timeRemainingValue} ${timeRemainingUnit}${timeRemainingValue !== 1 ? 's' : ''}`;
    const renewalDateTimeStr = expiresAt.toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    return {
        msUntilRenewal,
        hoursUntilRenewal,
        daysUntilRenewal,
        calendarDaysUntilRenewal,
        timeRemaining,
        renewalDateTimeStr
    };
}

function isUserSubscriptionDataReady() {
    if (typeof isAccountDataDeferred === 'function' && isAccountDataDeferred()) {
        return false;
    }
    const user = window.optionsData?.user;
    if (!user || user.error) {
        return false;
    }
    if (window.optionsData?.userDataValid === false) {
        return false;
    }
    const subscription = user.subscription;
    return subscription != null && typeof subscription === 'object';
}

async function updateSubscriptionNotifications() {
    await checkSubscriptionExpiration();
    await checkFixedTrainingSteps();
    // usageToolManager: public/scripts/comp/usageToolManager.js
    usageToolManager.notifyExtendedUsage();

    // Update subscription renewal indicator
    updateSubscriptionRenewalIndicator();
}

/**
 * Test function to show a popover on the fixedCreditsIndicator
 * Call this from the browser console: testCreditsIndicatorPopover()
 */
function testCreditsIndicatorPopover() {
    if (!window.PopoverManager) {
        console.error('PopoverManager not available');
        return;
    }

    const indicator = document.getElementById('fixedCreditsIndicator');
    if (!indicator) {
        console.error('fixedCreditsIndicator not found');
        return;
    }

    // Test with mock generation receipt
    const balance = window.optionsData?.balance;
    const fixedCredits = balance?.fixedTrainingStepsLeft || 250;
    const totalCredits = balance?.totalCredits || 350;

    console.log('Testing credits indicator popover with generation receipt');
    const popoverMessage1 = `<i class="nai-anla"></i> -5 fixed<br>Free: ${fixedCredits}<br>Total: ${totalCredits}`;
    showPopover(indicator, 'success', 'Generation Complete', popoverMessage1, false, false, '<i class="fas fa-sparkles"></i>', null, {
        position: 'top',
        arrowPosition: 'bottom-right'
    });
    startPopoverAutoHideTimer(indicator);

    // Also test balance change after a delay
    setTimeout(() => {
        console.log('Testing credits indicator popover with balance change');
        const messageParts = ['-5 free', `Free: 250`, `Paid: 100`, `Total: 350`];
        const popoverMessage2 = `<i class="nai-anla"></i> -5 free<br>Free: 250<br>Paid: 100<br>Total: 350`;
        showPopover(indicator, 'info', 'Balance Updated', popoverMessage2, false, false, '<i class="fas fa-sync-alt"></i>', null, {
            position: 'top',
            arrowPosition: 'bottom-right'
        });
        startPopoverAutoHideTimer(indicator);
    }, 4000);
}

function updateSubscriptionRenewalIndicator(options = {}) {
    if (typeof isAccountDataDeferred === 'function' && isAccountDataDeferred()) {
        return;
    }
    const indicator = document.getElementById('subscriptionRenewalIndicator');
    if (!indicator) return;

    if (!window.optionsData?.user?.subscription?.expiresAt) {
        indicator.classList.add('hidden');
        return;
    }

    const renewalData = getSubscriptionRenewalDisplayData(window.optionsData.user.subscription.expiresAt);
    const shouldWarn = renewalData.msUntilRenewal <= (7 * 24 * 60 * 60 * 1000) && renewalData.msUntilRenewal > 0;
    const reveal = options.reveal !== false && !isDesktopTrayBootPending();

    if (shouldWarn) {
        indicator.title = `Subscription renews in ${renewalData.timeRemaining} (${renewalData.renewalDateTimeStr})`;
        indicator.classList.remove('warning', 'critical');
        if (renewalData.hoursUntilRenewal <= 24 || renewalData.calendarDaysUntilRenewal <= 1) {
            indicator.classList.add('critical');
        } else if (renewalData.hoursUntilRenewal <= 72 || renewalData.calendarDaysUntilRenewal <= 3) {
            indicator.classList.add('warning');
        }
        if (reveal) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    } else {
        indicator.classList.add('hidden');
    }
}

function updateFixedCreditsIndicator(options = {}) {
    if (typeof isAccountDataDeferred === 'function' && isAccountDataDeferred()) {
        const indicator = document.getElementById('fixedCreditsIndicator');
        if (indicator) indicator.classList.add('hidden');
        return;
    }
    const indicator = document.getElementById('fixedCreditsIndicator');
    if (!indicator) return;

    const reveal = options.reveal !== false && !isDesktopTrayBootPending();

    // Ensure icon is always nai-anla
    const iconElement = indicator.querySelector('i');
    if (iconElement) {
        iconElement.className = 'nai-anla';
    }

    if (!window.optionsData?.balance) {
        indicator.classList.remove('low-credits', 'no-credits', 'expiring-credits');
        indicator.title = 'Loading balance...';
        if (reveal) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
        return;
    }

    // Get fixed credits
    const fixedCredits = window.optionsData.balance.fixedTrainingStepsLeft || 0;
    const totalCredits = window.optionsData.balance.totalCredits || 0;

    // Get subscription expiration info
    let renewalData = null;
    if (window.optionsData?.user?.subscription?.expiresAt) {
        renewalData = getSubscriptionRenewalDisplayData(window.optionsData.user.subscription.expiresAt);
    }

    // Remove all state classes
    indicator.classList.remove('low-credits', 'no-credits', 'expiring-credits');

    // Determine state and set classes
    if (fixedCredits === 0) {
        // 0 credits - all requests are paid
        indicator.classList.add('no-credits');
        indicator.title = `No free credits remaining - all requests are paid (Total: ${totalCredits})`;
    } else if (fixedCredits < 250) {
        // Less than 250 credits
        indicator.classList.add('low-credits');
        indicator.title = `Low free credits: ${fixedCredits} remaining (Total: ${totalCredits})`;
    } else if (fixedCredits >= 250 && renewalData !== null && renewalData.msUntilRenewal > 0 && renewalData.msUntilRenewal <= (7 * 24 * 60 * 60 * 1000)) {
        // More than 250 credits but subscription expiring soon
        indicator.classList.add('expiring-credits');
        indicator.title = `${fixedCredits} free credits remaining, subscription expires in ${renewalData.timeRemaining} (${renewalData.renewalDateTimeStr})`;
    } else {
        // Normal state - no special classes
        indicator.title = `Free credits: ${fixedCredits} (Total: ${totalCredits})`;
    }

    // syncFixedCreditsIndicatorStanding: public/scripts/comp/novelAiAccountStatus.js
    syncFixedCreditsIndicatorStanding();

    if (reveal) {
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
    }
}

function updateWorkspaceTrayIcon(options = {}) {
    const icon = document.getElementById('workspaceTrayIcon');
    if (!icon) return;

    const reveal = options.reveal !== false && (options.reveal === true || !isDesktopTrayBootPending());

    const activeWorkspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
    const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
    const activeWorkspaceData = workspacesData[activeWorkspaceId];

    if (activeWorkspaceData?.color) {
        icon.title = `Workspace: ${activeWorkspaceData.name || 'Unknown'}`;
    } else {
        icon.title = 'Workspace';
    }

    // Attach context menu
    if (contextMenu) {
        contextMenu.attachToElement(icon, {
            sections: [
                {
                    type: 'list',
                    title: (target) => {
                        // Get current active workspace name dynamically
                        const currentWorkspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
                        const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
                        const currentWorkspaceData = workspacesData[currentWorkspaceId];
                        return currentWorkspaceData?.name || 'Workspace';
                    },
                    items: [
                        {
                            icon: 'fas fa-database',
                            text: 'Data Management',
                            action: 'workspace-manage'
                        },
                        {
                            icon: 'fas fa-paint-roller',
                            text: 'Personalize',
                            action: 'open-desktop-settings'
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-planet-ringed',
                            text: 'Planets',
                            optionsfn: (target) => {
                                // Get planets submenu items (copy of planets submenu from start menu)
                                if (typeof startMenuSubmenus !== 'undefined' && startMenuSubmenus?.planets) {
                                    const planetsSubmenu = startMenuSubmenus.planets;
                                    const planetsList = planetsSubmenu();
                                    return planetsList.map(ws => {
                                        const item = {
                                            text: ws.text,
                                            action: ws.action
                                        };
                                        // Add color indicator using custom content
                                        if (ws.color) {
                                            item.content = () => {
                                                const container = document.createElement('div');
                                                container.style.display = 'flex';
                                                container.style.alignItems = 'center';
                                                container.style.gap = '8px';
                                                const colorDot = document.createElement('div');
                                                colorDot.className = 'workspace-color-indicator';
                                                colorDot.style.width = '12px';
                                                colorDot.style.height = '12px';
                                                colorDot.style.borderRadius = '50%';
                                                colorDot.style.backgroundColor = ws.color;
                                                colorDot.style.flexShrink = '0';
                                                const textSpan = document.createElement('span');
                                                textSpan.textContent = ws.text;
                                                container.appendChild(colorDot);
                                                container.appendChild(textSpan);
                                                return container;
                                            };
                                        }
                                        return item;
                                    });
                                }
                                return [];
                            },
                            handlerfn: (subItem, target) => {
                                // Handle workspace switching from planets submenu
                                // The action from startMenuSubmenus.planets is a function that calls setActiveWorkspace
                                if (subItem.action) {
                                    if (typeof subItem.action === 'function') {
                                        subItem.action();
                                    } else if (typeof subItem.action === 'string' && contextMenu) {
                                        // If it's a string action, use the context menu's executeAction
                                        contextMenu.executeAction(subItem.action, target, subItem);
                                    }
                                }
                            }
                        }
                    ]
                }
            ]
        });
    }

    if (reveal) {
        icon.classList.remove('hidden');
    } else {
        icon.classList.add('hidden');
    }
}

function updateSearchIndexingIndicator() {
    const indicator = document.getElementById('searchIndexingIndicator');
    if (!indicator) return;

    // attachSearchIndexingTrayContextMenu: public/scripts/comp/systemTrayManager.js
    if (typeof attachSearchIndexingTrayContextMenu === 'function') {
        attachSearchIndexingTrayContextMenu(indicator);
    }
}

function updateImageGenerationIndicator(options = {}) {
    const indicator = document.getElementById('imageGenerationIndicator');
    if (!indicator) return;

    const reveal = options.reveal !== false && !isDesktopTrayBootPending();
    const isManualGenerating = typeof isGenerating !== 'undefined' && isGenerating;
    const isSpellbookGenerating = window.spellbookModalManager?.isGenerating || false;
    const isAnyGenerating = isManualGenerating || isSpellbookGenerating;

    if (isAnyGenerating && reveal) {
        indicator.classList.remove('hidden');
        indicator.classList.add('active');
    } else {
        indicator.classList.remove('active');
        indicator.classList.add('hidden');
    }
}

let replicationTraySnapshot = null;

function updateReplicationTrayIndicator(snapshot) {
    const indicator = document.getElementById('replicationTrayIndicator');
    if (!indicator) return;

    if (!snapshot || !snapshot.active) {
        replicationTraySnapshot = null;
        indicator.classList.remove('active');
        indicator.classList.add('hidden');
        indicator.title = 'Replication';
        return;
    }

    replicationTraySnapshot = { ...snapshot };
    const phase = snapshot.phase || snapshot.operation || 'active';
    const current = Number(snapshot.current) || 0;
    const total = Number(snapshot.total) || 0;
    const path = snapshot.path ? ` — ${snapshot.path}` : '';
    const progress = total > 0 ? ` (${current}/${total})` : '';
    indicator.title = `Replication: ${phase}${progress}${path}`;
    indicator.classList.remove('hidden');
    indicator.classList.add('active');
}

function wireReplicationTrayIndicator() {
    const indicator = document.getElementById('replicationTrayIndicator');
    if (!indicator || indicator.dataset.replicationTrayWired === '1') return;
    indicator.dataset.replicationTrayWired = '1';
    indicator.addEventListener('click', () => {
        const url = replicationTraySnapshot?.active
            ? 'dsap://data.dreamscape.jp/replication/progress'
            : 'dsap://data.dreamscape.jp/replication';
        // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
        if (typeof openDsapInGrimoire === 'function') {
            openDsapInGrimoire(url);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireReplicationTrayIndicator);
} else {
    setTimeout(wireReplicationTrayIndicator, 0);
}

