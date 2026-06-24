// System tray icons: background boot, popovers, and tray indicator context menus.
// Extracted from public/scripts/app.js (L17082–18031, context menus L17568–18011).

const SYSTEM_TRAY_BOOT_STAGGER_MS = 70;

function prepareSystemTrayBackground() {
    if (window._systemTrayBackgroundPrepared) return;
    window._systemTrayBackgroundPrepared = true;

    const trayIconIds = [
        'imageGenerationIndicator',
        'subscriptionRenewalIndicator',
        'fixedCreditsIndicator',
        'searchIndexingIndicator',
        'desktopSaveTrayIndicator',
        'generationQuipsTrayIcon',
        'naxtBagTrayIcon',
        'phasewalkerTrayIcon',
        'workspaceTrayIcon',
        'serviceWorkerTrayIcon',
        'pingWarningIndicator',
        'modemTrayIcon'
    ];

    trayIconIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    // updateSubscriptionRenewalIndicator, updateFixedCreditsIndicator, updateImageGenerationIndicator: public/scripts/comp/trayIndicators.js
    setInterval(updateSubscriptionRenewalIndicator, 3600000);
    setInterval(updateFixedCreditsIndicator, 60000);
    setInterval(updateImageGenerationIndicator, 500);
}

async function startBackgroundTrayServices() {
    if (!window.isDesktop) return;

    updateFixedCreditsIndicator({ reveal: false });
    updateSubscriptionRenewalIndicator({ reveal: false });
    updateWorkspaceTrayIcon({ reveal: false });
    updateSearchIndexingIndicator();
    setupServiceWorkerTrayContextMenu();
    // initializeGenerationQuipsTray: public/scripts/comp/generationQuipsTray.js
    if (typeof initializeGenerationQuipsTray === 'function') {
        initializeGenerationQuipsTray();
    }
    // initializeNaxtBagTray: public/scripts/comp/naxtApplet.js
    if (typeof initializeNaxtBagTray === 'function') {
        initializeNaxtBagTray();
    }
    // initializePhasewalkerTray: public/scripts/comp/bracketGenerationApplet.js
    if (typeof initializePhasewalkerTray === 'function') {
        initializePhasewalkerTray();
    }
    updateImageGenerationIndicator({ reveal: false });

    if (window.wsClient) {
        if (typeof window.wsClient._updateServiceWorkerTrayIcon === 'function') {
            window.wsClient._updateServiceWorkerTrayIcon();
        }
        if (typeof window.wsClient._updateModemTrayIcon === 'function') {
            window.wsClient._updateModemTrayIcon();
        }
        if (typeof window.wsClient.updatePingWarningIcon === 'function') {
            window.wsClient.updatePingWarningIcon({ reveal: false });
        }
    }

    const revealPlan = [
        () => {
            updateFixedCreditsIndicator({ reveal: true });
            return 'fixedCreditsIndicator';
        },
        () => {
            updateSubscriptionRenewalIndicator({ reveal: true });
            return 'subscriptionRenewalIndicator';
        },
        () => {
            updateWorkspaceTrayIcon({ reveal: true });
            return 'workspaceTrayIcon';
        },
        () => {
            revealTrayIconById('searchIndexingIndicator');
            return 'searchIndexingIndicator';
        },
        () => {
            revealTrayIconById('serviceWorkerTrayIcon');
            return 'serviceWorkerTrayIcon';
        },
        () => {
            revealTrayIconById('modemTrayIcon');
            return 'modemTrayIcon';
        },
        () => {
            if (window.naxtApplet && typeof window.naxtApplet.updateBagTrayChrome === 'function') {
                window.naxtApplet.updateBagTrayChrome();
            }
            return 'naxtBagTrayIcon';
        },
        () => {
            if (window.bracketGenerationApplet && typeof window.bracketGenerationApplet.updateTrayChrome === 'function') {
                window.bracketGenerationApplet.updateTrayChrome();
            }
            return 'phasewalkerTrayIcon';
        },
        () => {
            if (window.wsClient && typeof window.wsClient.updatePingWarningIcon === 'function') {
                window.wsClient.updatePingWarningIcon({ reveal: true });
            }
            return 'pingWarningIndicator';
        },
        () => {
            updateImageGenerationIndicator({ reveal: true });
            return 'imageGenerationIndicator';
        }
    ];

    let delay = 0;
    await new Promise((resolve) => {
        revealPlan.forEach((revealFn) => {
            setTimeout(() => {
                const id = revealFn();
                const el = document.getElementById(id);
                if (el && !el.classList.contains('hidden')) {
                    revealTrayIconElement(el);
                }
            }, delay);
            delay += SYSTEM_TRAY_BOOT_STAGGER_MS;
        });

        setTimeout(async () => {
            await flushDeferredAccountTrayNotifications();
            flushDeferredNetworkTrayNotifications();
            window._systemTrayBootComplete = true;
            resolve();
        }, delay + SYSTEM_TRAY_BOOT_STAGGER_MS);
    });
}

function setupTrayIconPopovers() {
    if (!window.PopoverManager) return;

    const trayIcons = [
        'subscriptionRenewalIndicator',
        'fixedCreditsIndicator',
        'imageGenerationIndicator',
        'searchIndexingIndicator',
        'workspaceTrayIcon',
        'serviceWorkerTrayIcon',
        'modemTrayIcon',
        'pingWarningIndicator',
        'taskbarWebsocketIndicator'
    ];

    const trayIconElements = new Set();

    trayIcons.forEach(iconId => {
        const icon = document.getElementById(iconId);
        if (!icon) return;

        trayIconElements.add(icon);

        window.PopoverManager.attach(icon, {
            content: icon.title || '',
            hoverOnly: true,
            position: 'top',
            arrowPosition: 'bottom-right',
            onShow: (popover, element) => {
                const title = element.title || '';
                if (title) {
                    window.PopoverManager.updateContent(element, title);
                }
            }
        });
    });

    const trayParent = document.querySelector('.taskbar-tray-icons');
    if (!trayParent || window._trayIconTitleObserver) return;

    window._trayIconTitleObserver = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            if (mutation.type !== 'attributes' || mutation.attributeName !== 'title') continue;
            const icon = mutation.target;
            if (!trayIconElements.has(icon) || !icon.title) continue;
            window.PopoverManager.updateContent(icon, icon.title);
        }
    });

    window._trayIconTitleObserver.observe(trayParent, {
        subtree: true,
        attributes: true,
        attributeFilter: ['title']
    });
}

let activePopoverTimer = null;
let popoverInteractionListeners = null;

function startPopoverAutoHideTimer(indicator) {
    if (activePopoverTimer) {
        clearTimeout(activePopoverTimer);
        activePopoverTimer = null;
    }

    if (popoverInteractionListeners) {
        popoverInteractionListeners.cleanup();
        popoverInteractionListeners = null;
    }

    const isFocused = document.hasFocus() && !document.hidden;
    let hasInteracted = false;

    const startTimer = () => {
        if (activePopoverTimer) {
            clearTimeout(activePopoverTimer);
        }

        activePopoverTimer = setTimeout(() => {
            if (PopoverManager) {
                PopoverManager.hide(indicator);
            }
            activePopoverTimer = null;

            if (popoverInteractionListeners) {
                popoverInteractionListeners.cleanup();
                popoverInteractionListeners = null;
            }
        }, 15000);
    };

    if (isFocused) {
        const onMouseMove = () => {
            hasInteracted = true;
            startTimer();
            cleanupListeners();
        };

        const onTouchStart = () => {
            hasInteracted = true;
            startTimer();
            cleanupListeners();
        };

        const onFocus = () => {
            if (hasInteracted) {
                startTimer();
            }
        };

        const onVisibilityChange = () => {
            if (!document.hidden && hasInteracted) {
                startTimer();
            } else if (document.hidden) {
                if (activePopoverTimer) {
                    clearTimeout(activePopoverTimer);
                    activePopoverTimer = null;
                }
            }
        };

        const cleanupListeners = () => {
            document.removeEventListener('mousemove', onMouseMove, { passive: true });
            document.removeEventListener('touchstart', onTouchStart, { passive: true });
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };

        popoverInteractionListeners = {
            cleanup: cleanupListeners
        };

        document.addEventListener('mousemove', onMouseMove, { passive: true, once: true });
        document.addEventListener('touchstart', onTouchStart, { passive: true, once: true });
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);
    } else {
        const onFocus = () => {
            const onMouseMove = () => {
                hasInteracted = true;
                startTimer();
                cleanupListeners();
            };

            const onTouchStart = () => {
                hasInteracted = true;
                startTimer();
                cleanupListeners();
            };

            const onVisibilityChange = () => {
                if (document.hidden) {
                    if (activePopoverTimer) {
                        clearTimeout(activePopoverTimer);
                        activePopoverTimer = null;
                    }
                } else if (hasInteracted) {
                    startTimer();
                }
            };

            const cleanupListeners = () => {
                document.removeEventListener('mousemove', onMouseMove, { passive: true });
                document.removeEventListener('touchstart', onTouchStart, { passive: true });
                window.removeEventListener('focus', onFocus);
                document.removeEventListener('visibilitychange', onVisibilityChange);
            };

            popoverInteractionListeners = {
                cleanup: cleanupListeners
            };

            document.addEventListener('mousemove', onMouseMove, { passive: true, once: true });
            document.addEventListener('touchstart', onTouchStart, { passive: true, once: true });
            document.addEventListener('visibilitychange', onVisibilityChange);

            window.removeEventListener('focus', onFocus);
        };

        window.addEventListener('focus', onFocus);

        const onVisibilityChange = () => {
            if (!document.hidden) {
                onFocus();
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);

        popoverInteractionListeners = {
            cleanup: () => {
                window.removeEventListener('focus', onFocus);
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
        };
    }
}

function attachFixedCreditsTrayContextMenu(indicator) {
    if (!contextMenu || !indicator || indicator.dataset.contextMenu) return;

    const contextMenuId = 'fixedCreditsContextMenu';
    indicator.dataset.contextMenu = contextMenuId;

    contextMenu.attachToElement(indicator, {
        sections: [
            {
                type: 'custom',
                content: `
                        <div class="anlas-subscription-section" style="padding: 0 10px; gap: var(--spacing-xs);">
                            <div class="menu-item-row balance-list">
                                <i class="nai-anla"></i>
                                <div class="price-list-container">
                                    <div class="price-list-fixed">
                                        <span class="price-list-label hidden">Fixed</span> 
                                        <span id="contextAnlasBalanceFixedTray" class="price-list balanceFixed">-</span>
                                    </div>
                                    <i class="fas fa-circle" style="font-size: 0.35rem; padding-top: 0.15rem;"></i>
                                    <div class="price-list-paid">
                                        <span class="price-list-label hidden">Paid</span>
                                        <span id="contextAnlasBalancePaidTray" class="price-list balancePaid">-</span>
                                    </div>
                                </div>
                            </div>
                            <div class="menu-item-row balance-list">
                                <i class="nai-opus" style="font-size: 1.15rem; margin: calc(-1.15rem / 2) 0;"></i>
                                <div class="price-list-container">
                                    <span class="anlas-subscription-value" id="contextAnlasSubscriptionTierTray">Free</span>
                                    <i class="fas fa-circle hidden" id="contextAnlasSubscriptionDividerTray" style="font-size: 0.35rem; padding-top: 0.15rem;"></i>
                                    <span class="anlas-subscription-value" id="contextAnlasDaysTillExpireTray">
                                        <i class="fas fa-exclamation-triangle anlas-warning-icon hidden"></i>
                                        <span class="anlas-days-text">Loading...</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    `,
                loadfn: (section, target) => {
                    if (window.optionsData?.balance) {
                        const balance = window.optionsData.balance;
                        const fixedCredits = balance?.fixedTrainingStepsLeft || 0;
                        const purchasedCredits = balance?.purchasedTrainingSteps || 0;

                        const contextBalanceFixed = document.getElementById('contextAnlasBalanceFixedTray');
                        const contextBalancePaid = document.getElementById('contextAnlasBalancePaidTray');

                        if (contextBalanceFixed) {
                            contextBalanceFixed.textContent = fixedCredits;
                        }
                        if (contextBalancePaid) {
                            contextBalancePaid.textContent = purchasedCredits;
                        }
                    }

                    try {
                        const subscriptionTierElement = document.getElementById('contextAnlasSubscriptionTierTray');
                        const daysTillExpireElement = document.getElementById('contextAnlasDaysTillExpireTray');
                        const subscriptionDivider = document.getElementById('contextAnlasSubscriptionDividerTray');
                        const warningIcon = document.querySelector('#contextAnlasDaysTillExpireTray .anlas-warning-icon');
                        const daysText = document.querySelector('#contextAnlasDaysTillExpireTray .anlas-days-text');

                        if (subscriptionTierElement && daysTillExpireElement && warningIcon && daysText) {
                            const accountData = window.optionsData;

                            if (accountData?.user?.subscription?.tier !== undefined) {
                                const subscriptionTier = accountData.user.subscription.tier || 'Unknown';
                                subscriptionTierElement.textContent = subscriptionTier === 3 ? 'Opus' :
                                    subscriptionTier === 2 ? 'Scroll' :
                                        subscriptionTier === 1 ? 'Tablet' :
                                            subscriptionTier === 0 ? 'Free' : 'Unknown';

                                if (subscriptionDivider) {
                                    subscriptionDivider.classList.toggle('hidden', subscriptionTier < 0 || subscriptionTier === 'Unknown');
                                }
                                daysTillExpireElement.classList.toggle('hidden', subscriptionTier < 0 || subscriptionTier === 'Unknown');

                                let renewalData = null;
                                if (accountData.user.subscription.expiresAt) {
                                    renewalData = getSubscriptionRenewalDisplayData(accountData.user.subscription.expiresAt);
                                }

                                daysText.textContent = renewalData ? renewalData.timeRemaining : '0 days';

                                if (renewalData && renewalData.msUntilRenewal <= (7 * 24 * 60 * 60 * 1000) && renewalData.msUntilRenewal > 0) {
                                    warningIcon.classList.remove('hidden');
                                } else {
                                    warningIcon.classList.add('hidden');
                                }

                                if (renewalData && renewalData.msUntilRenewal > 0 && renewalData.msUntilRenewal <= (3 * 24 * 60 * 60 * 1000)) {
                                    daysTillExpireElement.style.color = 'var(--danger-color, #ff6b6b)';
                                } else if (renewalData && renewalData.msUntilRenewal > 0 && renewalData.msUntilRenewal <= (7 * 24 * 60 * 60 * 1000)) {
                                    daysTillExpireElement.style.color = 'var(--warning-color, #ffc107)';
                                } else {
                                    daysTillExpireElement.style.color = '';
                                }
                            } else {
                                subscriptionTierElement.textContent = 'No data';
                                daysText.textContent = 'No data';
                            }
                        }
                    } catch (error) {
                        console.error('Error updating subscription info in context menu:', error);
                    }
                }
            }
        ]
    });
}

function attachWorkspaceTrayContextMenu(icon) {
    if (!contextMenu || !icon) return;

    contextMenu.attachToElement(icon, {
        sections: [
            {
                type: 'list',
                title: (target) => {
                    const currentWorkspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
                    const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
                    const currentWorkspaceData = workspacesData[currentWorkspaceId];
                    return currentWorkspaceData?.name || 'Workspace';
                },
                items: [
                    {
                        icon: 'fas fa-solar-system',
                        text: 'Solar System',
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
                            if (typeof startMenuSubmenus !== 'undefined' && startMenuSubmenus?.planets) {
                                const planetsSubmenu = startMenuSubmenus.planets;
                                const planetsList = planetsSubmenu();
                                return planetsList.map(ws => {
                                    const item = {
                                        text: ws.text,
                                        action: ws.action
                                    };
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
                            if (subItem.action) {
                                if (typeof subItem.action === 'function') {
                                    subItem.action();
                                } else if (typeof subItem.action === 'string' && contextMenu) {
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

function attachSearchIndexingTrayContextMenu(indicator) {
    if (!contextMenu || !indicator) return;

    const getMenuConfig = () => ({
        sections: [
            {
                type: 'list',
                title: 'Search Index',
                items: [
                    {
                        icon: 'fas fa-pause',
                        text: 'Pause Indexing',
                        action: 'search-index-toggle-pause',
                        tooltip: 'Pause automatic indexing',
                        loadfn: (item, target) => {
                            const isPaused = target?.dataset?.indexingPaused === 'true';
                            item.icon = isPaused ? 'fas fa-play' : 'fas fa-pause';
                            item.text = isPaused ? 'Resume Indexing' : 'Pause Indexing';
                            item.tooltip = isPaused ? 'Resume automatic indexing' : 'Pause automatic indexing';
                        }
                    },
                    { separator: true },
                    {
                        icon: 'fas fa-memory',
                        text: 'Prepare Search Cache',
                        action: 'search-index-prepare-cache',
                        tooltip: 'Initialize search cache for current session'
                    },
                    {
                        icon: 'fas fa-eraser',
                        text: 'Clear Search Cache',
                        action: 'search-index-clear-cache',
                        tooltip: 'Clear search cache for current session'
                    },
                    { separator: true },
                    {
                        icon: 'fas fa-sync',
                        text: 'Start Indexing',
                        action: 'search-index-trigger',
                        tooltip: 'Trigger search index sync now'
                    },
                    {
                        icon: 'fas fa-broom',
                        text: 'Erase Index',
                        action: 'search-index-rebuild-all',
                        tooltip: 'Clear all search indexes and rebuild from scratch (takes a long time)',
                        className: 'text-warning'
                    }
                ]
            }
        ]
    });

    contextMenu.attachToElement(indicator, getMenuConfig());
    indicator._menuConfigFn = getMenuConfig;
}

function setupServiceWorkerTrayContextMenu() {
    const icon = document.getElementById('serviceWorkerTrayIcon');
    if (!icon || !contextMenu) return;

    contextMenu.attachToElement(icon, {
        sections: [
            {
                type: 'list',
                title: 'Storage Usage',
                items: [
                    {
                        disabled: true,
                        className: 'sw-storage-item sw-storage-total',
                        text: 'Total',
                        badge: '—'
                    },
                    {
                        disabled: true,
                        className: 'sw-storage-item sw-storage-used',
                        text: 'Used',
                        badge: '—'
                    },
                    {
                        disabled: true,
                        className: 'sw-storage-item sw-storage-static',
                        text: 'Static',
                        badge: '—'
                    },
                    {
                        disabled: true,
                        className: 'sw-storage-item sw-storage-dynamic',
                        text: 'Dynamic',
                        badge: '—'
                    },
                    {
                        disabled: true,
                        className: 'sw-storage-item sw-storage-internal',
                        text: 'Internal',
                        badge: '—'
                    },
                    {
                        disabled: true,
                        className: 'sw-storage-item sw-storage-images',
                        text: 'Images',
                        badge: '—'
                    }
                ],
                loadfn: async () => {
                    try {
                        const setStorageItem = (className, value) => {
                            const item = document.querySelector(`.${className}`);
                            if (!item) return;
                            const badge = item.querySelector('.context-menu-item-badge');
                            if (badge) badge.textContent = value ?? '—';
                        };

                        if (navigator.storage && navigator.storage.estimate) {
                            const est = await navigator.storage.estimate();
                            const usage = Number.isFinite(est.usage) ? est.usage : null;
                            const quota = Number.isFinite(est.quota) ? est.quota : null;
                            if (usage != null && quota != null && quota > 0) {
                                const pct = Math.round((usage / quota) * 100);
                                setStorageItem('sw-storage-total', `${formatBytes(usage)} / ${formatBytes(quota)}`);
                                setStorageItem('sw-storage-used', `${pct}%`);
                            } else if (usage != null) {
                                setStorageItem('sw-storage-total', `${formatBytes(usage)}`);
                                setStorageItem('sw-storage-used', '—');
                            } else {
                                setStorageItem('sw-storage-total', '—');
                                setStorageItem('sw-storage-used', '—');
                            }
                        }

                        if (window.serviceWorkerManager && typeof window.serviceWorkerManager.getCacheStats === 'function') {
                            const status = await window.serviceWorkerManager.getCacheStats();
                            const s = status || {};
                            setStorageItem('sw-storage-static', Number.isFinite(s.static) ? String(s.static) : '—');
                            setStorageItem('sw-storage-dynamic', Number.isFinite(s.dynamic) ? String(s.dynamic) : '—');
                            setStorageItem('sw-storage-internal', Number.isFinite(s.internal) ? String(s.internal) : '—');
                            setStorageItem('sw-storage-images', Number.isFinite(s.images) ? String(s.images) : '—');
                        }
                    } catch (error) {
                        console.error('Failed to update service worker tray stats:', error);
                    }
                }
            },
            {
                type: 'list',
                title: 'Updates',
                items: [
                    {
                        icon: 'fas fa-arrows-rotate',
                        text: 'Restart to Apply Updates',
                        action: 'sw-restart-apply-updates',
                        className: 'text-warning',
                        hidden: () => !(window.serviceWorkerManager && window.serviceWorkerManager.hasPendingUpdates())
                    },
                    {
                        icon: 'fa-regular fa-sync',
                        text: 'Check for Updates',
                        action: 'sw-check-updates'
                    },
                    {
                        icon: 'fa-regular fa-laptop-arrow-down',
                        text: 'Reinstall',
                        action: 'clear-cache'
                    }
                ]
            },
            {
                type: 'list',
                title: 'Clear Cache',
                items: [
                    {
                        icon: 'fas fa-broom',
                        text: 'Clear…',
                        openOnHover: false,
                        submenu: [
                            { icon: 'fas fa-broom', text: 'Static cache', action: 'sw-clear-cache-static' },
                            { icon: 'fas fa-broom', text: 'Dynamic cache', action: 'sw-clear-cache-dynamic' },
                            { icon: 'fas fa-broom', text: 'Internal cache', action: 'sw-clear-cache-internal' },
                            { icon: 'fas fa-broom', text: 'Image cache', action: 'sw-clear-cache-images' },
                            { separator: true },
                            { icon: 'fas fa-broom', text: 'All caches', action: 'sw-clear-cache-all', className: 'text-warning' }
                        ]
                    }
                ]
            }
        ]
    });
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
        val /= 1024;
        idx++;
    }
    const rounded = idx === 0 ? Math.round(val) : Math.round(val * 10) / 10;
    return `${rounded} ${units[idx]}`;
}

function wireTrayIndicatorContextMenus() {
    attachFixedCreditsTrayContextMenu(document.getElementById('fixedCreditsIndicator'));
    attachWorkspaceTrayContextMenu(document.getElementById('workspaceTrayIcon'));
    attachSearchIndexingTrayContextMenu(document.getElementById('searchIndexingIndicator'));
}

async function wireSystemTrayListeners() {
    if (window._systemTrayListenersWired) return;
    window._systemTrayListenersWired = true;

    await startBackgroundTrayServices();
    setupTrayIconPopovers();
    wireTrayIndicatorContextMenus();
}

window.prepareSystemTrayBackground = prepareSystemTrayBackground;
window.startBackgroundTrayServices = startBackgroundTrayServices;
window.setupTrayIconPopovers = setupTrayIconPopovers;
window.startPopoverAutoHideTimer = startPopoverAutoHideTimer;
window.setupServiceWorkerTrayContextMenu = setupServiceWorkerTrayContextMenu;
window.attachFixedCreditsTrayContextMenu = attachFixedCreditsTrayContextMenu;
window.attachWorkspaceTrayContextMenu = attachWorkspaceTrayContextMenu;
window.attachSearchIndexingTrayContextMenu = attachSearchIndexingTrayContextMenu;
window.wireSystemTrayListeners = wireSystemTrayListeners;

function bootSystemTrayBackground() {
    prepareSystemTrayBackground();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSystemTrayBackground);
} else {
    // app.js loads synchronously after this script in app.html — defer until tray helpers exist
    setTimeout(bootSystemTrayBackground, 0);
}
