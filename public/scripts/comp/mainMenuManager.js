/**
 * Main Menu Manager (Phase 1 — app.js refactor)
 *
 * Window list buttons, main menu bar context menus, and contextMenuAction routing.
 * Extracted from public/scripts/app.js; originals remain until manifest removal.
 *
 * Globals used at runtime (defined in app.js and siblings):
 * contextMenu, workspaces, activeWorkspace, wsClient, focusCoverEnabled, etc.
 */

function setupWindowManagementButtons() {
    if (!contextMenu) return;

    const menuConfig = buildWindowManagementButtonMenuConfig();
    const galleryButton = document.getElementById('windowListGalleryBtn');
    const editorButton = document.getElementById('windowListEditorBtn');

    [galleryButton, editorButton].forEach((button) => {
        if (!button) return;

        contextMenu.attachToElement(button, menuConfig);
        button.addEventListener('click', (e) => {
            e.preventDefault();
            contextMenu.attachToElement(button, buildWindowManagementButtonMenuConfig());
            triggerContextMenuFromButton(button);
        });
    });

    updateWindowManagementButtonsState();
    document.addEventListener('taskbarWindowsUpdated', updateWindowManagementButtonsState);
}

// Main Menu Bar Context Menu Configuration
function setupMainMenuContextMenus() {
    if (!contextMenu) return;

    // Create workspace submenu options function
    function getWorkspaceOptions(target) {
        const workspaceOptions = [];

        // Sort workspaces by their sort order - same as main dropdown
        const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));

        // Generate workspace options
        sortedWorkspaces.forEach((workspace, index) => {
            const workspaceId = workspace.id || workspace;
            const workspaceName = workspace.name || workspaceId;
            const workspaceColor = workspace.color || '#6366f1';
            // Use the same activeWorkspace variable as the main dropdown
            const isActive = workspaceId === activeWorkspace;

            workspaceOptions.push({
                content: `
                    <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                        <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                        <span class="context-menu-item-text">${workspaceName}</span>
                        ${isActive ? '<i class="fas fa-check" style="margin-left: auto; color: var(--success-color);"></i>' : ''}
                    </div>
                `,
                action: `switch-workspace-${workspaceId}`,
                disabled: isActive,
                workspaceId: workspaceId
            });
        });

        return workspaceOptions;
    }

    // Create workspace submenu handler function
    function handleWorkspaceAction(subItem, target) {
        const action = subItem.action;
        if (action && action.startsWith('switch-workspace-')) {
            const workspaceId = action.replace('switch-workspace-', '');

            // Try to switch workspace using available methods
            if (wsClient && wsClient.isConnected()) {
                // Use WebSocket to switch workspace
                setActiveWorkspace(workspaceId)
                    .catch(error => {
                        console.error('Error switching workspace:', error);
                        showGlassToast('error', 'Workspace Switch Failed', 'Failed to switch workspace: ' + error.message, false, 5000, '<i class="fas fa-plane-slash"></i>');
                    });
            }
        }
    }

    // Create jump points submenu options function
    function getJumpPointsOptions(target) {
        // Get current array length (filtered or all)
        const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
        if (effectiveLength === 0) return [];

        // Only return options if cache is ready and length matches
        if (cachedJumpPoints && cachedJumpPointsLength === effectiveLength) {
            return cachedJumpPoints.map(point => ({
                icon: 'fas fa-image',
                text: point.label,
                action: `jump-to-index-${point.index}`
            }));
        }

        // Cache not ready - return empty array (submenu will be disabled)
        return [];
    }

    // Create jump points submenu handler function
    function handleJumpPointsAction(subItem, target) {
        const action = subItem.action;
        if (action && action.startsWith('jump-to-index-')) {
            const index = parseInt(action.replace('jump-to-index-', ''), 10);
            if (!isNaN(index)) {
                displayGalleryFromStartIndex(index, true);
            }
        }
    }

    // Pagination state for date jump options (stored in closure to persist across menu opens)
    let dateJumpPaginationState = {
        currentBatch: 0,
        itemsPerBatch: 10,
        totalItems: 0,
        pendingAction: null // Tracks pending pagination action (load-more-dates-top/bottom)
    };

    // Create date-based submenu options function
    function getDateJumpOptions(target) {
        const dateOptions = [];

        try {
            // Get current array (filtered or all)
            const sourceImages = window.filteredImageIndices && window.originalAllImages && window.originalAllImages.length > 0
                ? window.originalAllImages
                : (allImages || []);

            if (sourceImages.length === 0) return [];

            // Get all date groups (from cache or build on the fly)
            let allDateGroups = [];

            // Only use cached date groups - no fallback
            if (cachedDateGroups && cachedDateGroups.length > 0) {
                // Map cached indices to filtered indices if in search mode
                cachedDateGroups.forEach((week, weekIndex) => {
                    const startDate = week.startDate;
                    const endDate = week.endDate;

                    // Get first index, mapping to filtered index if needed
                    let firstIndex = Math.min(...week.indices);
                    if (window.filteredImageIndices) {
                        // Find the filtered position for this original index
                        const filteredPos = window.filteredImageIndices.indexOf(firstIndex);
                        if (filteredPos === -1) return; // Skip if not in filtered results
                        firstIndex = filteredPos;
                    }

                    let label;
                    if (week.dates.length === 1) {
                        // Single day
                        label = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    } else {
                        // Date range
                        const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        label = `${startStr} - ${endStr}`;
                    }

                    allDateGroups.push({
                        label: label,
                        index: firstIndex
                    });
                });
            }

            // If no date groups available, return empty (submenu will be disabled)
            if (allDateGroups.length === 0) return [];

            // Check if we need to handle pagination (check pendingAction in state)
            const pendingAction = dateJumpPaginationState.pendingAction;
            if (pendingAction === 'load-more-dates-top') {
                dateJumpPaginationState.currentBatch = Math.max(0, dateJumpPaginationState.currentBatch - 1);
                dateJumpPaginationState.pendingAction = null; // Clear after processing
            } else if (pendingAction === 'load-more-dates-bottom') {
                dateJumpPaginationState.currentBatch = dateJumpPaginationState.currentBatch + 1;
                dateJumpPaginationState.pendingAction = null; // Clear after processing
            } else if (!pendingAction) {
                // Reset to first batch when opening fresh (no pending action)
                dateJumpPaginationState.currentBatch = 0;
            }

            dateJumpPaginationState.totalItems = allDateGroups.length;
            const itemsPerBatch = dateJumpPaginationState.itemsPerBatch;
            const startIndex = dateJumpPaginationState.currentBatch * itemsPerBatch;
            const endIndex = Math.min(startIndex + itemsPerBatch, allDateGroups.length);
            const hasMoreTop = dateJumpPaginationState.currentBatch > 0;
            const hasMoreBottom = endIndex < allDateGroups.length;

            // Add "Load more" at top if applicable
            if (hasMoreTop) {
                dateOptions.push({
                    icon: 'fas fa-chevron-up',
                    text: 'Load more',
                    action: 'load-more-dates-top',
                    keepMenuOpen: true, // Keep menu open when clicked
                    noIndicator: true // Don't show indicator dot
                });
            }

            // Add current batch of date options
            for (let i = startIndex; i < endIndex; i++) {
                const group = allDateGroups[i];
                dateOptions.push({
                    icon: 'fas fa-calendar-days',
                    text: group.label,
                    action: `jump-to-date-${group.index}`
                });
            }

            // Add "Load more" at bottom if applicable
            if (hasMoreBottom) {
                dateOptions.push({
                    icon: 'fas fa-chevron-down',
                    text: 'Load more',
                    action: 'load-more-dates-bottom',
                    keepMenuOpen: true, // Keep menu open when clicked
                    noIndicator: true // Don't show indicator dot
                });
            }

        } catch (error) {
            console.error('Error generating date jump options:', error);
        }

        return dateOptions;
    }

    // Create date-based submenu handler function
    function handleDateJumpAction(subItem, target) {
        const action = subItem.action;
        if (action === 'load-more-dates-top' || action === 'load-more-dates-bottom') {
            // Set pending action - this will be processed when optionsfn is called during refresh
            dateJumpPaginationState.pendingAction = action;
        } else if (action && action.startsWith('jump-to-date-')) {
            const index = parseInt(action.replace('jump-to-date-', ''), 10);
            if (!isNaN(index)) {
                displayGalleryFromStartIndex(index, true);
            }
        }
    }

    // Create the shared context menu configuration
    const contextMenuConfig = {
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fa-regular fa-chevron-double-up',
                        text: 'Jump to Top',
                        action: 'jump-to-top'
                    },
                    {
                        icon: (target) => {
                            const sortBtn = document.getElementById('sortOrderToggleBtn');
                            const isDesc = sortBtn && sortBtn.dataset.state === 'desc';
                            return isDesc ? 'fa-regular fa-sort-amount-down' : 'fa-regular fa-sort-amount-up';
                        },
                        tooltip: (target) => {
                            const sortBtn = document.getElementById('sortOrderToggleBtn');
                            const isDesc = sortBtn && sortBtn.dataset.state === 'desc';
                            return isDesc ? 'Sort: Newest First (Click to change)' : 'Sort: Oldest First (Click to change)';
                        },
                        hidden: () => {
                            if (document.body.classList.contains('desktop-mode')) return true;
                            return false;
                        },
                        action: 'invert-sort'
                    },
                    {
                        icon: 'fas fa-minus',
                        tooltip: 'Decrease Gallery Column Size',
                        action: 'gallery-size-decrease'
                    },
                    {
                        icon: 'fas fa-plus',
                        tooltip: 'Increase Gallery Column Size',
                        action: 'gallery-size-increase'
                    }
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        icon: 'fa-regular fa-objects-column',
                        text: 'Visual Index',
                        action: 'open-jump-index',
                        hidden: () => {
                            if (document.body.classList.contains('desktop-mode')) return true;
                            const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
                            return effectiveLength === 0;
                        }
                    },
                    {
                        icon: 'fa-regular fa-location-dot',
                        text: 'Jog to Position',
                        optionsfn: getJumpPointsOptions,
                        handlerfn: handleJumpPointsAction,
                        openOnHover: false,
                        disabled: () => {
                            const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
                            if (effectiveLength === 0) return true;
                            // Disable if cache is not ready
                            return !cachedJumpPoints || cachedJumpPointsLength !== effectiveLength;
                        },
                        hidden: () => {
                            const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
                            return effectiveLength === 0;
                        }
                    },
                    {
                        icon: 'fa-regular fa-calendar-days',
                        text: 'Jog to Date',
                        optionsfn: getDateJumpOptions,
                        handlerfn: handleDateJumpAction,
                        openOnHover: false,
                        disabled: () => {
                            const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
                            if (effectiveLength === 0) return true;
                            // Disable if cache is not ready
                            return !cachedDateGroups || cachedDateGroups.length === 0;
                        },
                        hidden: () => {
                            const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
                            return effectiveLength === 0;
                        }
                    },
                    {
                        content: (target) => {
                            // Get current workspace from workspaces object using activeWorkspace variable
                            let workspaceName = 'Workspace';
                            let workspaceColor = '#6366f1';

                            // Use the same activeWorkspace variable as the main dropdown
                            if (typeof workspaces !== 'undefined' && workspaces && typeof workspaces === 'object' && activeWorkspace) {
                                const currentWorkspace = workspaces[activeWorkspace];
                                if (currentWorkspace) {
                                    workspaceName = currentWorkspace.name || activeWorkspace;
                                    workspaceColor = currentWorkspace.color || '#6366f1';
                                }
                            }

                            return `
                                    <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                                        <div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                                        <span class="context-menu-item-text">${workspaceName}</span>
                                    </div>
                                `;
                        },
                        optionsfn: getWorkspaceOptions,
                        handlerfn: handleWorkspaceAction,
                        openOnHover: false
                    },
                ]
            },
            {
                type: 'list',
                hidden: () => {
                    // Hide in desktop mode (when gallery is windowed)
                    const galleryWindow = document.getElementById('galleryWindow');
                    return galleryWindow && galleryWindow.classList.contains('windowed');
                },
                items: [
                    {
                        icon: 'fa-regular fa-compass-drafting',
                        text: 'Studio',
                        action: 'creator-model',
                        hideOnBreakpoint: "small-mobile"
                    },
                    {
                        icon: 'fa-regular fa-hat-wizard',
                        text: 'Spellcaster',
                        action: 'cast-spell'
                    },
                    {
                        icon: 'fa-regular fa-notebook',
                        text: 'Notion',
                        action: 'open-notebook'
                    },
                    {
                        icon: 'fa-regular fa-books',
                        text: 'Grimoire',
                        action: 'open-encyclopedia',
                        hideOnBreakpoint: "small-mobile"
                    },
                    {
                        icon: 'fa-regular fa-flask',
                        text: 'Atelier',
                        action: 'open-naxt',
                        hideOnBreakpoint: "small-mobile"
                    },
                    {
                        icon: 'fa-regular fa-messages',
                        text: 'Chat',
                        action: 'open-chat'
                    },
                    {
                        icon: 'fas fa-toolbox',
                        text: 'Toolbox',
                        openOnHover: false,
                        submenu: [
                            {
                                icon: 'fa-regular fa-solar-system',
                                text: 'Data Management',
                                action: 'workspace-manage',
                                hideOnBreakpoint: "small-mobile"
                            },
                            {
                                icon: 'nai-import',
                                text: 'Import',
                                action: 'upload',
                                hidden: () => {
                                    // Hide in desktop mode
                                    return document.body.classList.contains('desktop-mode');
                                }
                            },
                            {
                                icon: 'fa-regular fa-swatchbook',
                                text: 'References',
                                action: 'cache-manager',
                                hideOnBreakpoint: "small-mobile"
                            },
                            {
                                icon: 'fa-regular fa-book-spells',
                                text: 'Spellbook',
                                action: 'preset-manager'
                            },
                            {
                                icon: 'fa-regular fa-book-font',
                                text: 'Text Expanders',
                                action: 'text-replacement-manager',
                                hideOnBreakpoint: "small-mobile"
                            },
                            {
                                icon: 'fa-regular fa-box-open-full',
                                text: 'Memories',
                                action: 'knowledge-memories',
                                hideOnBreakpoint: "small-mobile"
                            },
                            {
                                icon: 'fa-regular fa-key-skeleton-left-right',
                                text: 'Service Keychain',
                                action: 'api-key-manager',
                                desktopOnly: true,
                                hidden: localStorage.getItem('userType') !== 'admin',
                                hideOnBreakpoint: "mobile"
                            },
                            /*{
                                icon: 'fa-regular fa-rotate',
                                text: 'Refresh Metadata',
                                action: 'refresh-metadata-cache'
                            },*/
                            {
                                icon: 'fa-regular fa-shield-halved',
                                text: 'Security Center',
                                action: 'security-center',
                                imageIcon: 'secu.png',
                                desktopOnly: true,
                                hidden: localStorage.getItem('userType') !== 'admin',
                            },
                            {
                                icon: 'fa-regular fa-laptop-arrow-down',
                                text: 'Reinstall',
                                action: 'clear-cache'
                            },
                        ]
                    }
                ]
            },
            {
                type: 'custom',
                hidden: () => {
                    // Hide in desktop mode (when gallery is windowed)
                    const galleryWindow = document.getElementById('galleryWindow');
                    return galleryWindow && galleryWindow.classList.contains('windowed');
                },
                content: `
                        <div class="anlas-subscription-section" style="padding: 0 10px; gap: var(--spacing-xs);">
                            <div class="menu-item-row balance-list">
                                <i class="nai-anla"></i>
                                <div class="price-list-container">
                                    <div class="price-list-fixed">
                                        <span class="price-list-label hidden">Fixed</span> 
                                        <span id="contextAnlasBalanceFixed" class="price-list balanceFixed">-</span>
                                    </div>
                                    <i class="fas fa-circle" style="font-size: 0.35rem; padding-top: 0.15rem;"></i>
                                    <div class="price-list-paid">
                                        <span class="price-list-label hidden">Paid</span>
                                        <span id="contextAnlasBalancePaid" class="price-list balancePaid">-</span>
                                    </div>
                                </div>
                            </div>
                            <div class="menu-item-row balance-list">
                                <i class="nai-opus" style="font-size: 1.15rem; margin: calc(-1.15rem / 2) 0;"></i>
                                <div class="price-list-container">
                                    <span class="anlas-subscription-value" id="contextAnlasSubscriptionTier">Free</span>
                                    <i class="fas fa-circle hidden" id="contextAnlasSubscriptionDivider" style="font-size: 0.35rem; padding-top: 0.15rem;"></i>
                                    <span class="anlas-subscription-value" id="contextAnlasDaysTillExpire">
                                        <i class="fas fa-exclamation-triangle anlas-warning-icon hidden"></i>
                                        <span class="anlas-days-text">Loading...</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    `,
                loadfn: (section, target) => {
                    // Update balance values directly (copied from updateBalanceDisplay)
                    if (window.optionsData?.balance) {
                        const balance = window.optionsData.balance;
                        const totalCredits = balance?.totalCredits || 0;
                        const fixedCredits = balance?.fixedTrainingStepsLeft || 0;
                        const purchasedCredits = balance?.purchasedTrainingSteps || 0;

                        // Update context menu balance elements
                        const contextBalanceFixed = document.getElementById('contextAnlasBalanceFixed');
                        const contextBalancePaid = document.getElementById('contextAnlasBalancePaid');

                        if (contextBalanceFixed) {
                            contextBalanceFixed.textContent = fixedCredits;
                        }
                        if (contextBalancePaid) {
                            contextBalancePaid.textContent = purchasedCredits;
                        }

                        // Update main balance display elements
                        const balanceDisplay = document.querySelectorAll('.balanceDisplay');
                        const balanceAmount = document.querySelectorAll('.balanceAmount');
                        const balanceFixed = document.querySelectorAll('.balanceFixed');
                        const balancePaid = document.querySelectorAll('.balancePaid');

                        if (balanceDisplay && balanceAmount) {
                            const balanceIcon = balanceDisplay[0].querySelector('i');

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
                        }
                    }

                    // Update subscription values directly (copied from updateAnlasSubscriptionInfo)
                    try {
                        const subscriptionTierElement = document.getElementById('contextAnlasSubscriptionTier');
                        const daysTillExpireElement = document.getElementById('contextAnlasDaysTillExpire');
                        const subscriptionDivider = document.getElementById('contextAnlasSubscriptionDivider');
                        const warningIcon = document.querySelector('#contextAnlasDaysTillExpire .anlas-warning-icon');
                        const daysText = document.querySelector('#contextAnlasDaysTillExpire .anlas-days-text');

                        if (subscriptionTierElement && daysTillExpireElement && warningIcon && daysText) {
                            const accountData = window.optionsData;

                            if (accountData?.user?.subscription?.tier !== undefined) {
                                // Update subscription tier
                                const subscriptionTier = accountData.user.subscription.tier || 'Unknown';
                                subscriptionTierElement.textContent = subscriptionTier === 3 ? 'Opus' :
                                    subscriptionTier === 2 ? 'Scroll' :
                                        subscriptionTier === 1 ? 'Tablet' :
                                            subscriptionTier === 0 ? 'Free' : 'Unknown';

                                if (subscriptionDivider) {
                                    subscriptionDivider.classList.toggle('hidden', subscriptionTier < 0 || subscriptionTier === 'Unknown');
                                }
                                daysTillExpireElement.classList.toggle('hidden', subscriptionTier < 0 || subscriptionTier === 'Unknown');

                                // Calculate time till expire
                                let renewalData = null;
                                if (accountData.user.subscription.expiresAt) {
                                    renewalData = getSubscriptionRenewalDisplayData(accountData.user.subscription.expiresAt);
                                }

                                daysText.textContent = renewalData ? renewalData.timeRemaining : '0 days';

                                // Show warning icon if expiring in a week or less
                                if (renewalData && renewalData.msUntilRenewal <= (7 * 24 * 60 * 60 * 1000) && renewalData.msUntilRenewal > 0) {
                                    warningIcon.classList.remove('hidden');
                                } else {
                                    warningIcon.classList.add('hidden');
                                }

                                // Add color coding for urgency
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
            },
            {
                type: 'icons',
                hidden: () => {
                    // Hide in desktop mode (when gallery is windowed)
                    const galleryWindow = document.getElementById('galleryWindow');
                    return galleryWindow && galleryWindow.classList.contains('windowed');
                },
                icons: [
                    {
                        icon: 'fa-regular fa-droplet',
                        tooltip: 'Liquid Glass',
                        action: 'toggle-glass',
                        keepMenuOpen: true,
                        showIndicator: true,
                        loadfn: (icon, target) => {
                            const isOn = document.documentElement.classList.contains('disable-blur');
                            icon.dataState = !isOn ? 'on' : 'off';
                        }
                    },
                    {
                        icon: 'fa-regular fa-blinds',
                        tooltip: 'Focus Cover',
                        action: 'toggle-privacy-mode',
                        keepMenuOpen: true,
                        showIndicator: true,
                        loadfn: (icon, target) => {
                            icon.dataState = focusCoverEnabled ? 'on' : 'off';
                        },
                        desktopOnly: true,
                    },
                    {
                        icon: 'fa-regular fa-sync',
                        tooltip: 'Software Update',
                        action: 'refresh-cache'
                    },
                    {
                        icon: 'fa-regular fa-window-alt',
                        tooltop: 'Melaton Desktop',
                        action: 'toggle-gallery-window',
                        hidden: () => document.body.classList.contains('desktop-mode'),
                        hideOnBreakpoint: "mobile"
                    },
                    {
                        icon: 'fa-regular fa-lock',
                        tooltip: 'Lock App',
                        hidden: () => !(window.AndroidPersistentNotification && window.AndroidPersistentNotification.canLock()),
                        action: 'lock-app'
                    },
                    {
                        icon: 'fa-regular fa-power-off',
                        tooltip: 'Logout',
                        action: 'logout'
                    }
                ]
            }
        ],
        maxHeight: true
    };

    // Attach the same configuration to multiple elements
    contextMenu.attachToElements('#main-menu-bar, #galleryToggleGroup', contextMenuConfig);

    // Add wheel support to main menu bar for adjusting gallery column size
    const mainMenuBar = document.getElementById('main-menu-bar');
    if (mainMenuBar && typeof adjustGalleryColumnSize === 'function') {
        let wheelTimeout = null;
        let lastWheelTime = 0;
        const wheelThrottle = 500; // ms between wheel adjustments

        mainMenuBar.addEventListener('wheel', function (e) {
            // Only handle vertical scrolling
            if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

            // Throttle wheel events
            const now = Date.now();
            if (now - lastWheelTime < wheelThrottle) {
                e.preventDefault();
                return;
            }

            e.preventDefault();
            lastWheelTime = now;

            // deltaY > 0 is scroll down (decrease), deltaY < 0 is scroll up (increase)
            const direction = e.deltaY > 0 ? -1 : 1;
            adjustGalleryColumnSize(direction);
        }, { passive: false });
    }

    // Handle context menu actions
    document.addEventListener('contextMenuAction', async function (event) {
        const { action, target, item } = event.detail;

        switch (action) {
            case 'jump-to-top':
                displayGalleryFromStartIndex(0);
                window.scrollTo(0, { behavior: 'instant' });
                break;
            case 'open-jump-index':
                if (typeof window.openGalleryJumpIndexToolWindow === 'function') {
                    window.openGalleryJumpIndexToolWindow();
                }
                break;

            case 'invert-sort':
                // Toggle sort order directly
                toggleGallerySortOrder();
                break;

            case 'workspace-manage':
                // Open workspace management modal directly
                showWorkspaceManagementModal();
                break;

            case 'preset-manager':
                // Open preset manager modal directly
                showPresetManager();
                break;

            case 'cast-spell':
                // Open spellbook modal directly
                window.spellbookModalManager.openModal();
                break;

            case 'creator-model':
                // Open creator model modal directly
                openManualModalWithContent();
                break;

            case 'open-notebook':
                // Open notebook modal directly
                window.notepadManager.openNotebook();
                break;

            case 'open-encyclopedia':
                if (window.tagWikiSearchModal) {
                    window.tagWikiSearchModal.open();
                } else {
                    const tagWikiSearchModalEl = document.getElementById('tagWikiSearchModal');
                    if (tagWikiSearchModalEl) {
                        openModal(tagWikiSearchModalEl);
                    }
                }
                break;

            case 'open-naxt':
                if (window.naxtApplet) {
                    window.naxtApplet.open();
                } else {
                    const naxtModalEl = document.getElementById('naxtModal');
                    if (naxtModalEl) {
                        openModal(naxtModalEl);
                    }
                }
                break;

            case 'open-chat':
                // Open chat modal directly
                window.chatSystem.showAllChats();
                break;

            case 'cache-manager':
                // Open cache manager modal directly
                showCacheManagerModal();
                break;

            case 'knowledge-memories':
                // Open Knowledge Memories DSAP applet (2008 web 2.0 edition)
                if (typeof openDsapInGrimoire === 'function') {
                    openDsapInGrimoire('dsap://memories.dyna.dreamscape.jp');
                } else if (typeof openKnowledgeMemoriesModal === 'function') {
                    openKnowledgeMemoriesModal();
                }
                break;

            case 'api-key-manager':
                if (localStorage.getItem('userType') === 'admin') {
                    if (typeof openSecurityCenterDsap === 'function') {
                        openSecurityCenterDsap('auth');
                    } else {
                        openDsapInGrimoire('dsap://security.dreamscape.jp/auth');
                    }
                } else {
                    showGlassToast('warning', null, 'Admin access required to manage API keys.', false, 5000, '<i class="fas fa-key-skeleton-left-right"></i>');
                }
                break;

            case 'linkxi-persona':
                if (typeof openLinkXiPersonaDsap === 'function') {
                    openLinkXiPersonaDsap();
                } else if (typeof openDsapInGrimoire === 'function') {
                    openDsapInGrimoire('dsap://xi.dyna.dreamscape.jp/persona');
                }
                break;

            case 'chat-manager':
                window.chatSystem.showAllChats();
                break;

            case 'security-center':
            case 'ip-manager':
                if (localStorage.getItem('userType') !== 'admin') {
                    showGlassToast('warning', null, 'Admin access required for Security Center.', false, 5000, '<i class="fas fa-lock"></i>');
                    break;
                }
                if (typeof openSecurityCenterDsap === 'function') {
                    openSecurityCenterDsap('blocked');
                } else if (typeof openDsapInGrimoire === 'function') {
                    openDsapInGrimoire('dsap://security.dreamscape.jp/');
                }
                break;

            case 'lockAllReplacements':
                // Lock all available Genso
                if (window.lastGenerationTextReplacements && Array.isArray(window.lastGenerationTextReplacements)) {
                    const lockableReplacements = window.lastGenerationTextReplacements.map(r => ({ ...r, locked: r.can_lock !== undefined ? r.can_lock !== false : true }));
                    window.lockedTextReplacements = lockableReplacements.filter(r => r.locked === true);
                    window.lastGenerationTextReplacements = lockableReplacements;
                    updateMainLockButtonState();
                    showGlassToast('success', null, `Locked ${lockableReplacements.length} Expander${lockableReplacements.length === 1 ? '' : 's'}.`);
                }
                if (dynamicGenerationHasCompileCache()) {
                    setDynamicGenerationLockState({ cacheLocked: true, contextLocked: true });
                }
                break;

            case 'unlockAllReplacements':
                // Unlock all Genso
                window.lockedTextReplacements = [];
                window.lastGenerationTextReplacements = window.lastGenerationTextReplacements.map(r => ({ ...r, locked: false }));
                updateMainLockButtonState();
                showGlassToast('success', null, 'Unlocked all Expanders or Tsubo\'s.');
                break;

            case 'compileTendaiReplacements':
                compileAllTendaiReplacements();
                break;

            case 'deleteManagedPhases':
                // deleteAllManagedBracketArtifacts: public/scripts/comp/bracketGenerationApplet.js
                if (typeof deleteAllManagedBracketArtifacts === 'function') {
                    deleteAllManagedBracketArtifacts();
                    showGlassToast('success', null, 'Removed managed stages from editor', false, 3000, '<i class="fas fa-trash-alt"></i>');
                }
                break;

            case 'text-replacement-manager':
                // Open Genso manager modal directly
                showTextReplacementManager();
                break;

            case 'refresh-metadata-cache':
                // Rebuild metadata cache
                await handleRefreshMetadataCache();
                break;

            case 'upload':
                // Open upload modal directly
                unifiedUploadModalManager.show();
                closeSubMenu();
                break;

            case 'toggle-gallery-window':
                // Toggle gallery window mode
                toggleGalleryWindowMode();
                break;

            case 'gallery-size-increase':
                // Increase gallery column size
                adjustGalleryColumnSize(1);
                break;

            case 'gallery-size-decrease':
                // Decrease gallery column size
                adjustGalleryColumnSize(-1);
                break;

            case 'toggle-glass':
                await switchTheme();
                break;

            case 'lock-app':
                // Lock app directly
                if (window.AndroidPersistentNotification && window.AndroidPersistentNotification.canLock()) {
                    window.AndroidPersistentNotification.lockApp();
                }
                break;

            case 'toggle-privacy-mode':
                // Toggle focus cover directly
                focusCoverEnabled = !focusCoverEnabled;
                localStorage.setItem('focusCoverEnabled', focusCoverEnabled.toString());
                break;

            case 'refresh-cache':
                // Refresh cache directly
                await serviceWorkerManager.refreshServerCacheAndCheck();
                break;

            case 'sw-restart-apply-updates':
                if (window.serviceWorkerManager) {
                    window.serviceWorkerManager.forceRestart();
                }
                break;

            case 'sw-check-updates':
                if (window.serviceWorkerManager) {
                    await window.serviceWorkerManager.checkStaticFileUpdates(false);
                }
                break;

            case 'sw-clear-cache-static':
            case 'sw-clear-cache-dynamic':
            case 'sw-clear-cache-internal':
            case 'sw-clear-cache-images':
            case 'sw-clear-cache-all': {
                const cacheNames = [];
                let label = '';

                if (action === 'sw-clear-cache-static') {
                    cacheNames.push('static-cache-v2');
                    label = 'static cache';
                } else if (action === 'sw-clear-cache-dynamic') {
                    cacheNames.push('dynamic-cache-v1');
                    label = 'dynamic cache';
                } else if (action === 'sw-clear-cache-internal') {
                    cacheNames.push('internal-cache-v1');
                    label = 'internal cache';
                } else if (action === 'sw-clear-cache-images') {
                    cacheNames.push('image-cache-v1');
                    label = 'image cache';
                } else if (action === 'sw-clear-cache-all') {
                    cacheNames.push('static-cache-v2', 'static-cache-v1', 'dynamic-cache-v1', 'internal-cache-v1', 'image-cache-v1');
                    label = 'all caches';
                }

                const confirmed = await showConfirmationDialog(
                    `Are you sure you want to clear ${label}?`,
                    [
                        { text: 'Clear Cache', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ],
                    event
                );
                if (!confirmed) break;

                try {
                    if ('caches' in window) {
                        await Promise.all(cacheNames.map((name) => caches.delete(name)));
                    }
                    if (window.serviceWorkerManager) {
                        await window.serviceWorkerManager.checkStaticFileUpdates(false);
                    }
                    showGlassToast('success', null, `Cleared ${label}.`, false, 3000, '<i class="fas fa-broom"></i>');
                } catch (error) {
                    console.error('Failed to clear caches:', error);
                    showGlassToast('error', null, `Failed to clear ${label}: ${error.message}`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
                break;
            }

            case 'clear-cache':
                // Clear cache directly
                const confirmedClear = await showConfirmationDialog(
                    `Are you sure you want to reinstall the application?`,
                    [
                        { text: 'Reinstall', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ],
                    event
                );
                if (confirmedClear) {
                    event.preventDefault();
                    await clearAllCachesAndReload();
                }
                break;

            case 'search-index-prepare-cache':
                // Prepare search cache for current session
                if (window.wsClient && window.wsClient.isConnected()) {
                    try {
                        const viewType = currentGalleryView || 'images';
                        await window.wsClient.sendMessage('search_index_prepare_cache', { viewType });
                        showGlassToast('success', null, 'Search cache prepared', false, 3000, '<i class="fas fa-check"></i>');
                    } catch (error) {
                        console.error('Error preparing search cache:', error);
                        showGlassToast('error', null, 'Failed to prepare search cache: ' + error.message, false, 5000, '<i class="fas fa-exclamation-circle"></i>');
                    }
                } else {
                    showGlassToast('error', null, 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
                }
                break;

            case 'search-index-clear-cache':
                // Clear search cache for current session
                if (window.wsClient && window.wsClient.isConnected()) {
                    try {
                        await window.wsClient.sendMessage('search_index_clear_cache', {});
                        showGlassToast('success', null, 'Search cache cleared', false, 3000, '<i class="fas fa-check"></i>');
                    } catch (error) {
                        console.error('Error clearing search cache:', error);
                        showGlassToast('error', null, 'Failed to clear search cache: ' + error.message, false, 5000, '<i class="fas fa-exclamation-circle"></i>');
                    }
                } else {
                    showGlassToast('error', null, 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
                }
                break;

            case 'search-index-toggle-pause':
                // Toggle indexing pause state
                if (window.wsClient && window.wsClient.isConnected()) {
                    try {
                        const result = await window.wsClient.sendMessage('search_index_toggle_pause', {});
                        if (result && result.paused !== undefined) {
                            const message = result.paused ? 'Indexing paused' : 'Indexing resumed';
                            showGlassToast('info', null, message, false, 3000, '<i class="fas fa-info-circle"></i>');
                        }
                    } catch (error) {
                        console.error('Error toggling indexing pause:', error);
                        showGlassToast('error', null, 'Failed to toggle indexing: ' + error.message, false, 5000, '<i class="fas fa-exclamation-circle"></i>');
                    }
                } else {
                    showGlassToast('error', null, 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
                }
                break;

            case 'search-index-trigger':
                // Manually trigger indexing
                if (window.wsClient && window.wsClient.isConnected()) {
                    try {
                        await window.wsClient.sendMessage('search_index_trigger', {});
                        showGlassToast('info', null, 'Indexing triggered', false, 3000, '<i class="fas fa-sync"></i>');
                    } catch (error) {
                        console.error('Error triggering indexing:', error);
                        showGlassToast('error', null, 'Failed to trigger indexing: ' + error.message, false, 5000, '<i class="fas fa-exclamation-circle"></i>');
                    }
                } else {
                    showGlassToast('error', null, 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
                }
                break;

            case 'search-index-rebuild-all':
                // Erase and reindex all search indexes
                if (window.wsClient && window.wsClient.isConnected()) {
                    try {
                        const confirmed = await showConfirmationDialog(
                            'Are you sure you want to erase and rebuild all search indexes?<br><br><strong>This will take a long time to complete</strong> and will rebuild indexes for all images in the database.',
                            [
                                { text: 'Rebuild All', value: true, className: 'btn-danger', icon: 'fas fa-broom' },
                                { text: 'Cancel', value: false, className: 'btn-secondary' }
                            ],
                            event
                        );
                        if (confirmed) {
                            await window.wsClient.sendMessage('search_index_rebuild_all', {});
                            showGlassToast('info', null, 'Rebuilding all search indexes... This may take a while.', false, 10000, '<i class="fas fa-sync fa-spin"></i>');
                        }
                    } catch (error) {
                        console.error('Error rebuilding indexes:', error);
                        showGlassToast('error', null, 'Failed to rebuild indexes: ' + error.message, false, 5000, '<i class="fas fa-exclamation-circle"></i>');
                    }
                } else {
                    showGlassToast('error', null, 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
                }
                break;

            case 'logout':
                // Logout directly
                const confirmed = await showConfirmationDialog(
                    `Are you sure you want to log out?`,
                    [
                        { text: 'Log Out', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                    // Don't pass event for context menu - it will center the dialog
                );
                if (confirmed) {
                    bypassConfirmation = true;
                    handleLogout();
                }
                break;

            default:
                // Handle individual Genso lock toggles
                if (action.startsWith('toggleTextReplacementLock_')) {
                    const index = parseInt(action.replace('toggleTextReplacementLock_', ''), 10);
                    const allReplacements = window.lastGenerationTextReplacements || [];

                    if (!isNaN(index) && allReplacements[index]) {
                        const seed = allReplacements[index];
                        const canLock = seed.can_lock !== undefined ? seed.can_lock !== false : true;

                        if (canLock) {
                            // Toggle the locked state
                            seed.locked = !seed.locked;

                            // Update the global lock state
                            const lockedSeeds = allReplacements.filter(s => s.locked === true);
                            window.lockedTextReplacements = lockedSeeds;
                            updateMainLockButtonState();
                        }
                    }
                }
                break;
        }
    });

}

function wireMainMenuListeners() {
    setupWindowManagementButtons();
    setupMainMenuContextMenus();
}
