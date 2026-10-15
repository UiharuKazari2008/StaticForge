// System tray icons: background boot, tray notifications, and tray indicator context menus.
// Extracted from public/scripts/app.js (L17082–18031, context menus L17568–18011).

const SYSTEM_TRAY_BOOT_STAGGER_MS = 70;

function prepareSystemTrayBackground() {
    if (window._systemTrayBackgroundPrepared) return;
    window._systemTrayBackgroundPrepared = true;
    if (!isDesktop) return;

    const trayIconIds = [
        'imageGenerationIndicator',
        'mcpActivityIndicator',
        'mcpPhysicsIndicator',
        'replicationTrayIndicator',
        'walletTrayIcon',
        'searchIndexingIndicator',
        'desktopSaveTrayIndicator',
        'generationQuipsTrayIcon',
        'naxtBagTrayIcon',
        'phasewalkerTrayIcon',
        'directorTrayIcon',
        'dovecoteTrayIcon',
        'workspaceTrayIcon',
        'serviceWorkerTrayIcon',
        'pingWarningIndicator',
        'volumeTrayIcon',
        'modemTrayIcon'
    ];

    trayIconIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    // The wallet tray icon repaints and polls on its own (walletTray.init: public/scripts/comp/walletTray.js).
    // Mail is pushed (dovecote_mailbox_updated -> doveOnMailboxUpdated in desktop-apps/dovecote.js).
}

async function startBackgroundTrayServices() {
    if (!window.isDesktop) return;

    // walletTray.init: public/scripts/comp/walletTray.js (NovelAI credits / renewal and RunPod live there)
    if (window.walletTray) window.walletTray.init();
    updateWorkspaceTrayIcon({ reveal: false });
    updateSearchIndexingIndicator();
    setupServiceWorkerTrayContextMenu();
    // initializeRunpodTray: public/scripts/comp/runpodTray.js
    initializeRunpodTray();
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
    // initializeDirectorTray: public/scripts/comp/director.js
    initializeDirectorTray();
    // initializeDovecoteTray: public/scripts/comp/desktop-apps/dovecote.js
    initializeDovecoteTray();
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
            if (window.walletTray) window.walletTray.update({ reveal: true });
            return 'walletTrayIcon';
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
            revealTrayIconById('volumeTrayIcon');
            return 'volumeTrayIcon';
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
            // Director.updateTrayChrome: public/scripts/comp/director.js
            if (window.directorInstance) {
                window.directorInstance.updateTrayChrome();
            }
            return 'directorTrayIcon';
        },
        () => {
            // doveRefreshTrayUnread: public/scripts/comp/desktop-apps/dovecote.js — stays hidden
            // at 0 unread (conditional reveal).
            doveRefreshTrayUnread({ reveal: true });
            return 'dovecoteTrayIcon';
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
            // Mark boot complete before flushing network notifications so deferred
            // popups (high-latency) no longer treat themselves as boot-pending.
            window._systemTrayBootComplete = true;
            flushDeferredNetworkTrayNotifications();
            // updateWorkspaceTrayIcon: public/scripts/comp/trayIndicators.js
            updateWorkspaceTrayIcon();
            resolve();
        }, delay + SYSTEM_TRAY_BOOT_STAGGER_MS);
    });
}

let activePopoverTimer = null;
let popoverInteractionListeners = null;

const TRAY_POPOVER_FALLBACK_MAX_MS = 15000;

function startPopoverAutoHideTimer(indicator, maxMs = TRAY_POPOVER_FALLBACK_MAX_MS) {
    if (activePopoverTimer) {
        clearTimeout(activePopoverTimer);
        activePopoverTimer = null;
    }

    if (popoverInteractionListeners) {
        popoverInteractionListeners.cleanup();
        popoverInteractionListeners = null;
    }

    const popoverData = window.PopoverManager?.activePopovers?.get(indicator);
    if (!popoverData?.popover?.classList.contains('show')) return;

    // PopoverManager schedules hideTimeout for tray notifications; only backfill when missing.
    if (popoverData.hideTimeout || popoverData.maxShowTimeout) {
        return;
    }

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
        }, maxMs);
    };

    startTimer();

    const onVisibilityChange = () => {
        if (document.hidden) {
            if (activePopoverTimer) {
                clearTimeout(activePopoverTimer);
                activePopoverTimer = null;
            }
        } else if (popoverData.popover?.classList.contains('show')) {
            startTimer();
        }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    popoverInteractionListeners = {
        cleanup: () => {
            if (activePopoverTimer) {
                clearTimeout(activePopoverTimer);
                activePopoverTimer = null;
            }
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }
    };
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
                        tooltip: 'Pause automatic search tag indexing',
                        loadfn: (item, target) => {
                            const isPaused = target?.dataset?.indexingPaused === 'true'
                                && target?.dataset?.searchSyncStatus === 'paused';
                            item.icon = isPaused ? 'fas fa-play' : 'fas fa-pause';
                            item.text = isPaused ? 'Resume Search Indexing' : 'Pause Search Indexing';
                            item.tooltip = isPaused ? 'Resume automatic search tag indexing' : 'Pause automatic search tag indexing';
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
                        text: 'Start Search Sync',
                        action: 'search-index-trigger',
                        tooltip: 'Trigger search tag index sync now'
                    },
                    {
                        icon: 'fas fa-broom',
                        text: 'Erase Search Index',
                        action: 'search-index-rebuild-all',
                        tooltip: 'Clear all search indexes and rebuild from scratch (takes a long time)',
                        className: 'text-warning'
                    }
                ]
            },
            {
                type: 'list',
                title: 'Prompt FTS Index',
                items: [
                    {
                        icon: 'fas fa-play',
                        text: 'Start Prompt FTS',
                        action: 'prompt-index-start',
                        tooltip: 'Start background prompt FTS backfill',
                        loadfn: (item, target) => {
                            const running = target?.dataset?.promptFtsRunning === 'true';
                            const paused = target?.dataset?.promptFtsPaused === 'true';
                            const pending = parseInt(target?.dataset?.promptFtsPending || '0', 10) || 0;
                            item.disabled = running || (pending === 0 && !paused);
                        }
                    },
                    {
                        icon: 'fas fa-pause',
                        text: 'Pause Prompt FTS',
                        action: 'prompt-index-pause',
                        tooltip: 'Pause prompt FTS backfill',
                        loadfn: (item, target) => {
                            item.disabled = target?.dataset?.promptFtsRunning !== 'true';
                        }
                    },
                    {
                        icon: 'fas fa-play',
                        text: 'Resume Prompt FTS',
                        action: 'prompt-index-resume',
                        tooltip: 'Resume prompt FTS backfill',
                        loadfn: (item, target) => {
                            item.disabled = target?.dataset?.promptFtsPaused !== 'true';
                        }
                    },
                    {
                        icon: 'fas fa-stop',
                        text: 'Cancel Prompt FTS',
                        action: 'prompt-index-cancel',
                        tooltip: 'Cancel prompt FTS backfill',
                        className: 'text-warning',
                        loadfn: (item, target) => {
                            const active = target?.dataset?.promptFtsRunning === 'true'
                                || target?.dataset?.promptFtsPaused === 'true';
                            item.disabled = !active;
                        }
                    },
                    { separator: true },
                    {
                        icon: 'fas fa-wrench',
                        text: 'Reconcile FTS Flags',
                        action: 'prompt-index-reconcile',
                        tooltip: 'Fix prompt FTS flag drift without full reindex'
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
                        // Vista's Windows Update tray menu: the page first (cplUpdate.js)
                        icon: 'fas fa-shield-halved',
                        text: 'Open MeletonFX Update',
                        action: 'sw-open-update',
                        hidden: () => typeof window.cplUpdate === 'undefined'
                    },
                    {
                        icon: 'fas fa-cloud-arrow-down',
                        text: 'Restart to Install Updates',
                        action: 'sw-restart-apply-updates',
                        className: 'text-warning',
                        hidden: () => !(window.serviceWorkerManager
                            && typeof window.serviceWorkerManager.hasPendingUpdates === 'function'
                            && window.serviceWorkerManager.hasPendingUpdates())
                    },
                    {
                        icon: 'fa-regular fa-sync',
                        text: 'Check for updates',
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
    attachWorkspaceTrayContextMenu(document.getElementById('workspaceTrayIcon'));
    attachSearchIndexingTrayContextMenu(document.getElementById('searchIndexingIndicator'));
}

async function wireSystemTrayListeners() {
    if (window._systemTrayListenersWired) return;
    window._systemTrayListenersWired = true;

    await startBackgroundTrayServices();
    wireTrayIndicatorContextMenus();
    // updateDevWarningsTrayIcon: public/scripts/comp/modalKeyboardRegistry.js
    updateDevWarningsTrayIcon();
}

window.prepareSystemTrayBackground = prepareSystemTrayBackground;
window.startBackgroundTrayServices = startBackgroundTrayServices;
window.startPopoverAutoHideTimer = startPopoverAutoHideTimer;
window.setupServiceWorkerTrayContextMenu = setupServiceWorkerTrayContextMenu;
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
