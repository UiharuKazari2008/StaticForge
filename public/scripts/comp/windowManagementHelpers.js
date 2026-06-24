/** Window management context menu helpers (Phase 2 batch 13). */
function triggerContextMenuFromButton(button) {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (rect.width / 2),
        clientY: rect.bottom
    });
    button.dispatchEvent(event);
}

function getWindowManagementApplicationItems() {
    const mainApplicationItems = [];
    const actionHandlers = {};

    const registerAction = (keyPrefix, sourceItem, fallbackText) => {
        const key = `${keyPrefix}-${sourceItem.launchId || fallbackText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        actionHandlers[key] = sourceItem.action;
        return key;
    };

    const filterAppMenuSubitems = (items) => {
        if (!Array.isArray(items)) return [];
        return items.filter((subItem) => {
            if (!subItem || subItem.separator || subItem.hasSubmenu) return false;
            // isAppMenuEntryEnabled: public/scripts/comp/modalUtils.js
            if (typeof isAppMenuEntryEnabled === 'function') return isAppMenuEntryEnabled(subItem);
            return subItem.appMenu !== false;
        });
    };

    const startItems = (typeof getFilteredStartMenuConfig === 'function')
        ? getFilteredStartMenuConfig({ excludeAppRootOnly: false })
        : (Array.isArray(startMenuShellConfig) ? startMenuShellConfig : []);

    if (typeof getAllAppsMenuItems === 'function') {
        getAllAppsMenuItems().forEach((item) => {
            if (typeof item.action !== 'function') return;
            mainApplicationItems.push({
                icon: item.icon || 'fas fa-circle',
                imageIcon: item.imageIcon,
                text: item.text || item.fullName || 'Application',
                action: registerAction('app-main', item, item.text || 'app')
            });
        });
    } else if (typeof collectStartMenuLaunchableDescriptors === 'function') {
        collectStartMenuLaunchableDescriptors()
            .filter((item) => item.appMenu !== false)
            .forEach((item) => {
                if (typeof item.action !== 'function') return;
                mainApplicationItems.push({
                    icon: item.icon || 'fas fa-circle',
                    imageIcon: item.imageIcon,
                    text: item.text || item.fullName || 'Application',
                    action: registerAction('app-main', item, item.text || 'app')
                });
            });
    }

    startItems.forEach((item) => {
        if (!item || item.separator || item.submenu === 'tools' || item.submenu === 'toolbox' || item.submenu === 'all-apps') return;
        // isAppMenuEntryEnabled: public/scripts/comp/modalUtils.js
        if (typeof isAppMenuEntryEnabled === 'function') {
            if (!isAppMenuEntryEnabled(item)) return;
        } else if (item.appMenu === false) {
            return;
        }

        if (item.hasSubmenu && item.submenu && startMenuSubmenus?.[item.submenu]) {
            mainApplicationItems.push({
                icon: item.icon || 'fas fa-list',
                text: item.text || 'Menu',
                optionsfn: () => {
                    const submenuSource = startMenuSubmenus[item.submenu];
                    const submenuItems = typeof submenuSource === 'function' ? submenuSource() : submenuSource;
                    if (!Array.isArray(submenuItems)) return [];

                    return submenuItems
                        .filter((subItem) => !subItem || subItem.appMenu !== false)
                        .map((subItem, index) => {
                        const text = subItem.text || `Item ${index + 1}`;
                        if (subItem.color) {
                            return {
                                content: `
                                    <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                                        <div class="workspace-color-indicator" style="background-color: ${subItem.color}"></div>
                                        <span class="context-menu-item-text">${text}</span>
                                    </div>
                                `,
                                action: `app-submenu-${item.submenu}-${index}`
                            };
                        }
                        return {
                            icon: subItem.icon || 'fas fa-circle',
                            text,
                            action: `app-submenu-${item.submenu}-${index}`
                        };
                    });
                },
                handlerfn: (subItem) => {
                    const submenuSource = startMenuSubmenus[item.submenu];
                    const submenuItems = filterAppMenuSubitems(typeof submenuSource === 'function' ? submenuSource() : submenuSource);
                    const match = submenuItems.find((candidate, index) => `app-submenu-${item.submenu}-${index}` === subItem.action);
                    if (match?.action) {
                        match.action();
                    }
                },
                openOnHover: false
            });
            return;
        }

        if (typeof item.action === 'function') {
            mainApplicationItems.push({
                icon: item.icon || 'fas fa-circle',
                text: item.text || 'Application',
                action: registerAction('app-main', item, item.text || 'app')
            });
        }
    });

    const toolsApplicationItems = [];
    const toolsSourceList = typeof getAppMenuToolsItems === 'function'
        ? getAppMenuToolsItems()
        : (() => {
            const toolsItemsSource = startMenuSubmenus?.tools || startMenuSubmenus?.toolbox;
            return typeof toolsItemsSource === 'function' ? toolsItemsSource() : toolsItemsSource;
        })();
    if (Array.isArray(toolsSourceList) && toolsSourceList.length > 0) {
        toolsSourceList.forEach((item) => {
            if (!item || item.separator || item.hasSubmenu || typeof item.action !== 'function') return;
            toolsApplicationItems.push({
                icon: item.icon || 'fas fa-toolbox',
                imageIcon: item.imageIcon,
                text: item.text || 'Tool',
                action: registerAction('app-tool', item, item.text || 'tool')
            });
        });
    }

    /** Flat list for nested "Applications" when windows are open: main rows + Tools header + tools rows */
    const applicationItemsNested = [...mainApplicationItems];
    if (toolsApplicationItems.length > 0) {
        applicationItemsNested.push({ separator: true, text: 'Tools' });
        applicationItemsNested.push(...toolsApplicationItems);
    }

    /** Single root menu when no windows: main rows + Tools as submenu (subitems use action → onAction → actionHandlers) */
    const applicationItemsSingleRoot = [...mainApplicationItems];
    if (toolsApplicationItems.length > 0) {
        applicationItemsSingleRoot.push({
            icon: 'fas fa-toolbox',
            text: 'Tools',
            optionsfn: () => toolsApplicationItems,
            openOnHover: false
        });
    }

    return {
        actionHandlers,
        applicationItemsNested,
        applicationItemsSingleRoot
    };
}

function buildWindowManagementButtonMenuConfig() {
    const isDesktopMode = document.body.classList.contains('desktop-mode');
    const windowEntries = (typeof getNonRootTaskbarWindowEntries === 'function') ? getNonRootTaskbarWindowEntries() : [];
    const hasWindowEntries = !isDesktopMode && windowEntries.length > 0;
    const { actionHandlers, applicationItemsNested, applicationItemsSingleRoot } = getWindowManagementApplicationItems();

    const sections = [];
    if (hasWindowEntries) {
        sections.push({
            type: 'list',
            items: windowEntries.map((entry) => ({
                icon: entry.icon,
                text: entry.title,
                action: `window-entry-${entry.modalId}`,
                className: [entry.isActive ? 'active' : '', entry.isMinimised ? 'minimised-window' : ''].filter(Boolean).join(' ')
            }))
        });
        sections.push({
            type: 'list',
            items: [
                {
                    icon: 'fas fa-atom-alt',
                    text: 'Applications',
                    optionsfn: () => applicationItemsNested,
                    openOnHover: false
                }
            ]
        });
    } else {
        sections.push({
            type: 'list',
            items: applicationItemsSingleRoot
        });
    }

    return {
        sections,
        onAction: (action, target) => {
            if (typeof action === 'string' && action.startsWith('window-entry-')) {
                const modalId = action.replace('window-entry-', '');
                if (typeof activateTaskbarWindowEntry === 'function') {
                    activateTaskbarWindowEntry(modalId);
                }
                return;
            }

            if (typeof action === 'string' && actionHandlers[action]) {
                actionHandlers[action]();
            }
        }
    };
}

function updateWindowManagementButtonsState() {
    const galleryButton = document.getElementById('windowListGalleryBtn');
    const editorButton = document.getElementById('windowListEditorBtn');

    const isDesktopMode = document.body.classList.contains('desktop-mode');
    const entries = (typeof getNonRootTaskbarWindowEntries === 'function') ? getNonRootTaskbarWindowEntries() : [];
    const hasWindows = entries.length > 0;
    const iconClass = (isDesktopMode || !hasWindows) ? 'fa-light fa-atom-alt' : 'fa-light fa-window-restore';

    [galleryButton, editorButton].forEach((button) => {
        if (!button) return;
        const icon = button.querySelector('i');
        if (icon) {
            icon.className = iconClass;
        }
    });

    if (galleryButton) {
        if (isDesktopMode) {
            galleryButton.classList.remove('hidden');
        } else {
            galleryButton.classList.toggle('hidden', !hasWindows);
        }
    }
}

