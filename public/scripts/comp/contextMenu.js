/**
 * Context Menu Controller
 * A customizable context menu system that supports:
 * - Desktop right-click and touch long-press
 * - Multiple section types: list items, icon buttons, custom divs
 * - Dynamic positioning and collision detection
 * - Keyboard navigation support
 * - Touch device compatibility
 */

class ContextMenuController {
    constructor() {
        this.menu = null;
        this.isOpen = false;
        this.currentTarget = null;
        this.touchTimer = null;
        this.touchStartTime = 0;
        this.longPressDelay = 500; // ms
        this.touchThreshold = 10; // pixels
        this.hoverTimers = {
            openTimer: null,
            closeTimer: null
        };
        this.hoverSettings = {
            openDelay: 320, // ms
            closeDelay: 500 // ms
        };
        
        this.init();
    }

    init() {
        this.createMenu();
        this.bindEvents();
    }

    createMenu() {
        // Create the overlay to catch clicks outside the menu
        this.overlay = document.createElement('div');
        this.overlay.className = 'context-menu-overlay hidden';
        this.overlay.addEventListener('click', () => {
            this.hideMenu();
        });
        
        // Allow right-click and touch events to pass through the overlay
        this.overlay.addEventListener('contextmenu', (e) => {
            // Prevent browser context menu from appearing
            e.preventDefault();
            // Hide current menu immediately
            this.hideMenu();
            // Use a small delay to ensure the overlay is hidden, then trigger the event on the element below
            setTimeout(() => {
                const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
                if (elementBelow && elementBelow !== this.overlay) {
                    const target = elementBelow.closest('[data-context-menu]');
                    if (target) {
                        // Create and dispatch a new contextmenu event on the target element
                        const newEvent = new MouseEvent('contextmenu', {
                            bubbles: true,
                            cancelable: true,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            button: e.button,
                            buttons: e.buttons
                        });
                        target.dispatchEvent(newEvent);
                    }
                }
            }, 10);
        });
        
        this.overlay.addEventListener('touchstart', (e) => {
            // Hide current menu immediately
            this.hideMenu();
            // Use a small delay to ensure the overlay is hidden, then trigger the event on the element below
            setTimeout(() => {
                const elementBelow = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
                if (elementBelow && elementBelow !== this.overlay) {
                    const target = elementBelow.closest('[data-context-menu]');
                    if (target) {
                        // Create and dispatch a new touchstart event on the target element
                        const newEvent = new TouchEvent('touchstart', {
                            bubbles: true,
                            cancelable: true,
                            touches: e.touches,
                            targetTouches: e.targetTouches,
                            changedTouches: e.changedTouches
                        });
                        target.dispatchEvent(newEvent);
                    }
                }
            }, 10);
        }, { passive: true });
        
        // Create the main context menu container
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu hidden';
        this.menu.setAttribute('role', 'menu');
        
        // Create the menu content container
        const menuContent = document.createElement('div');
        menuContent.className = 'context-menu-content';
        this.menu.appendChild(menuContent);
        
        // Add overlay and menu to document
        document.body.appendChild(this.overlay);
        document.body.appendChild(this.menu);
    }

    bindEvents() {
        // Desktop right-click
        document.addEventListener('contextmenu', (e) => {
            const target = e.target.closest('[data-context-menu]');
            if (target) {
                e.preventDefault();
                this.showMenu(e, target);
            }
        });

        // Touch events for long-press
        document.addEventListener('touchstart', (e) => {
            const target = e.target.closest('[data-context-menu]');
            if (target && e.touches.length === 1) {
                this.touchStartTime = Date.now();
                this.currentTarget = target;
                
                // Clear any existing timer
                if (this.touchTimer) {
                    clearTimeout(this.touchTimer);
                }
                
                // Set up long-press timer
                this.touchTimer = setTimeout(() => {
                    this.showMenu(e, target, true);
                }, this.longPressDelay);
            }
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (this.touchTimer && e.touches.length === 1) {
                const touch = e.touches[0];
                const startTouch = e.targetTouches[0];
                
                // Calculate distance moved
                const deltaX = Math.abs(touch.clientX - startTouch.clientX);
                const deltaY = Math.abs(touch.clientY - startTouch.clientY);
                
                // Cancel if moved too far
                if (deltaX > this.touchThreshold || deltaY > this.touchThreshold) {
                    clearTimeout(this.touchTimer);
                    this.touchTimer = null;
                }
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (this.touchTimer) {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
            }
        }, { passive: true });

        // Note: Click outside handling is now done by the overlay

        // Close menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hideMenu();
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.isOpen) {
                this.hideMenu();
            }
        });

        // Close menu on scroll (both document and window)
        document.addEventListener('scroll', () => {
            if (this.isOpen) {
                this.hideMenu();
            }
        }, { passive: true });

        window.addEventListener('scroll', () => {
            if (this.isOpen) {
                this.hideMenu();
            }
        }, { passive: true });

        // Close menu when window loses focus
        window.addEventListener('blur', () => {
            if (this.isOpen && !window?.develeoperMode) {
                this.hideMenu();
            }
        });

        // Close menu when page becomes hidden (tab switch, minimize, etc.)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isOpen && !window?.develeoperMode) {
                this.hideMenu();
            }
        });
    }

    showMenu(event, target, isTouch = false) {
        // Block additional context menu clicks when a menu is already active
        if (this.isOpen) {
            console.log('Context menu already open, blocking additional clicks');
            return;
        }

        const menuConfigId = target.dataset.contextMenu;
        if (!menuConfigId) return;

        // Get the stored configuration
        const config = this.configs && this.configs[menuConfigId];
        if (!config) {
            console.error('Context menu configuration not found for ID:', menuConfigId);
            return;
        }

        // Apply maxHeight setting if specified
        this.applyMaxHeight(config);

        this.renderMenu(config, target);
        this.positionMenu(event, isTouch);
        
        // Call loadfn for all sections after menu is fully rendered and positioned
        this.executeLoadFunctions(config, target);
        
        this.isOpen = true;
        this.currentTarget = target;
        
        // Show the overlay
        this.overlay.classList.remove('hidden');
        
        // Add touch feedback for mobile
        if (isTouch) {
            target.classList.add('context-menu-triggered');
            setTimeout(() => {
                target.classList.remove('context-menu-triggered');
            }, 200);
        }
    }

    applyMaxHeight(config) {
        const menu = this.menu;
        if (!menu) return;

        // Reset any existing maxHeight
        menu.style.setProperty('--context-menu-max-height', '');

        if (config.maxHeight !== undefined) {
            if (config.maxHeight === true) {
                // Use 100vh minus padding (assuming 20px total padding)
                menu.style.setProperty('--context-menu-max-height', 'calc(100vh - 20px)');
            } else if (typeof config.maxHeight === 'number') {
                // Use the specified pixel value
                menu.style.setProperty('--context-menu-max-height', `${config.maxHeight}px`);
            } else if (typeof config.maxHeight === 'string') {
                // Use the specified CSS value (e.g., '50vh', '300px', etc.)
                menu.style.setProperty('--context-menu-max-height', config.maxHeight);
            }
        }
    }

    executeLoadFunctions(config, target) {
        if (!config.sections || !Array.isArray(config.sections)) return;

        config.sections.forEach((section) => {
            // Execute loadfn for custom sections
            if (section.type === 'custom' && section.loadfn && typeof section.loadfn === 'function') {
                try {
                    section.loadfn(section, target);
                } catch (error) {
                    console.error('Error executing custom section loadfn:', error);
                }
            }

            // Execute loadfn for list sections
            if (section.type === 'list' && section.items && Array.isArray(section.items)) {
                section.items.forEach((item) => {
                    if (item.loadfn && typeof item.loadfn === 'function') {
                        try {
                            item.loadfn(item, target);
                        } catch (error) {
                            console.error('Error executing list item loadfn:', error);
                        }
                    }
                });
            }

            // Execute loadfn for icon sections
            if (section.type === 'icons' && section.icons && Array.isArray(section.icons)) {
                section.icons.forEach((icon) => {
                    if (icon.loadfn && typeof icon.loadfn === 'function') {
                        try {
                            icon.loadfn(icon, target);
                        } catch (error) {
                            console.error('Error executing icon loadfn:', error);
                        }
                    }
                });
            }
        });
    }

    renderMenu(config, target) {
        const menuContent = this.menu.querySelector('.context-menu-content');
        menuContent.innerHTML = '';

        if (!config.sections || !Array.isArray(config.sections)) {
            console.error('Context menu config must have sections array');
            return;
        }

        config.sections.forEach((section, sectionIndex) => {
            const sectionElement = this.createSection(section, target, sectionIndex);
            if (sectionElement) {
                menuContent.appendChild(sectionElement);
            }
        });

        // Add keyboard navigation
        this.setupKeyboardNavigation();
    }

    createSection(section, target, sectionIndex) {
        const sectionElement = document.createElement('div');
        sectionElement.className = 'context-menu-section';

        switch (section.type) {
            case 'list':
                return this.createListSection(section, target, sectionElement);
            case 'icons':
                return this.createIconsSection(section, target, sectionElement);
            case 'custom':
                return this.createCustomSection(section, target, sectionElement);
            default:
                console.warn(`Unknown section type: ${section.type}`);
                return null;
        }
    }

    createListSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-list-section';
        
        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            titleElement.textContent = section.title;
            sectionElement.appendChild(titleElement);
        }

        if (!section.items || !Array.isArray(section.items)) {
            console.warn('List section must have items array');
            return sectionElement;
        }

        section.items.forEach((item, itemIndex) => {
            if (item.separator) {
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';
                sectionElement.appendChild(separator);
                return;
            }

            // Call loadfn if it exists to update item properties
            if (item.loadfn && typeof item.loadfn === 'function') {
                // Pass the target element and let the loadfn handle its own data access
                item.loadfn(item, target);
            }

            const itemElement = document.createElement('div');
            itemElement.className = 'context-menu-item';
            itemElement.setAttribute('role', 'menuitem');
            itemElement.tabIndex = 0;

                        // Custom content or Icon + Text
            if (item.content) {
                // Use custom content if provided
                if (typeof item.content === 'string') {
                    itemElement.innerHTML = item.content;
                } else if (item.content instanceof HTMLElement) {
                    itemElement.appendChild(item.content);
                } else if (typeof item.content === 'function') {
                    const customContent = item.content(target);
                    if (customContent instanceof HTMLElement) {
                        itemElement.appendChild(customContent);
                    } else if (typeof customContent === 'string') {
                        itemElement.innerHTML = customContent;
                    }
                }
            } else {
                // Default icon + text behavior
                if (item.icon) {
                    const iconElement = document.createElement('i');
                    iconElement.className = `${item.icon}`;
                    itemElement.appendChild(iconElement);
                }
                
                if (item.text) {
                    const textElement = document.createElement('span');
                    textElement.className = 'context-menu-item-text';
                    textElement.textContent = item.text;
                    itemElement.appendChild(textElement);
                }
            }

            // Submenu arrow
            if ((item.submenu && Array.isArray(item.submenu)) || item.optionsfn) {
                const arrowElement = document.createElement('i');
                arrowElement.className = 'context-menu-submenu-arrow fas fa-chevron-right';
                itemElement.appendChild(arrowElement);
                itemElement.classList.add('has-submenu');
            }

            // Disabled state
            if (item.disabled) {
                itemElement.classList.add('disabled');
                itemElement.setAttribute('aria-disabled', 'true');
            }

            // Click handler
            if (item.action && typeof item.action === 'string') {
                itemElement.addEventListener('click', () => {
                    if (!item.disabled) {
                        this.executeAction(item.action, target, item);
                        this.hideMenu();
                    }
                });
            }

            // Add hover support for non-submenu items to close submenu
            if (!item.submenu && !item.optionsfn) {
                itemElement.addEventListener('mouseenter', () => {
                    this.clearHoverTimers();
                    this.hoverTimers.closeTimer = setTimeout(() => {
                        this.hideSubmenu();
                    }, this.hoverSettings.closeDelay);
                });
            }

            // Submenu handler
            if (item.submenu && Array.isArray(item.submenu)) {
                itemElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!item.disabled) {
                        this.showSubmenu(itemElement, item.submenu, target);
                    }
                });

                // Hover support for submenu
                if (item.openOnHover !== false) {
                    this.addSubmenuHoverSupport(itemElement, item, target);
                }
            } else if (item.optionsfn && typeof item.optionsfn === 'function') {
                itemElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!item.disabled) {
                        const submenuOptions = item.optionsfn(target);
                        if (submenuOptions && Array.isArray(submenuOptions)) {
                            this.showSubmenu(itemElement, submenuOptions, target, item.handlerfn);
                        }
                    }
                });

                // Hover support for submenu
                if (item.openOnHover !== false) {
                    this.addSubmenuHoverSupport(itemElement, item, target);
                }
            }

            sectionElement.appendChild(itemElement);
        });

        return sectionElement;
    }

    createIconsSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-icons-section';
        
        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            titleElement.textContent = section.title;
            sectionElement.appendChild(titleElement);
        }

        if (!section.icons || !Array.isArray(section.icons)) {
            console.warn('Icons section must have icons array');
            return sectionElement;
        }

        const iconsContainer = document.createElement('div');
        iconsContainer.className = 'context-menu-icons-container';

        section.icons.forEach((icon, iconIndex) => {
            if (icon.separator) {
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';
                iconsContainer.appendChild(separator);
                return;
            }

            // Call loadfn if it exists to update icon properties
            if (icon.loadfn && typeof icon.loadfn === 'function') {
                // Pass the target element and let the loadfn handle its own data access
                icon.loadfn(icon, target);
            }

            const iconElement = document.createElement('button');
            iconElement.className = 'context-menu-icon-btn';
            iconElement.type = 'button';
            iconElement.setAttribute('role', 'menuitem');
            iconElement.tabIndex = 0;

            // Icon
            if (icon.icon) {
                const iconClass = document.createElement('i');
                iconClass.className = `${icon.icon}`;
                iconElement.appendChild(iconClass);
            }

            // Tooltip
            if (icon.tooltip) {
                iconElement.title = icon.tooltip;
            }

            // Disabled state
            if (icon.disabled) {
                iconElement.classList.add('disabled');
                iconElement.setAttribute('aria-disabled', 'true');
            }

            // Click handler
            if (icon.action && typeof icon.action === 'string') {
                iconElement.setAttribute('data-action', icon.action);
                iconElement.addEventListener('click', () => {
                    if (!icon.disabled) {
                        this.executeAction(icon.action, target, icon);
                        this.hideMenu();
                    }
                });
            }

            // Set data-state attribute if available (for toggle buttons)
            if (icon.dataState) {
                iconElement.setAttribute('data-state', icon.dataState);
            }

            iconsContainer.appendChild(iconElement);
        });

        sectionElement.appendChild(iconsContainer);
        return sectionElement;
    }

    createCustomSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-custom-section';
        
        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            titleElement.textContent = section.title;
            sectionElement.appendChild(titleElement);
        }

        if (section.content) {
            if (typeof section.content === 'string') {
                sectionElement.innerHTML += section.content;
            } else if (section.content instanceof HTMLElement) {
                sectionElement.appendChild(section.content);
            } else if (typeof section.content === 'function') {
                const customContent = section.content(target);
                if (customContent instanceof HTMLElement) {
                    sectionElement.appendChild(customContent);
                } else if (typeof customContent === 'string') {
                    sectionElement.innerHTML += customContent;
                }
            }
        }

        return sectionElement;
    }

    positionMenu(event, isTouch = false) {
        const menu = this.menu;
        const menuContent = menu.querySelector('.context-menu-content');
        
        // Show menu to get dimensions
        menu.classList.remove('hidden');
        
        // Check if we're on a small mobile screen (480px or less)
        const isSmallMobile = window.innerWidth <= 480;
        
        if (isSmallMobile) {
            // On small mobile screens, CSS will handle centering
            // Just ensure the menu is visible
            menu.style.left = '';
            menu.style.top = '';
            return;
        }
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Get click/touch position
        let clickX, clickY;
        if (isTouch) {
            clickX = event.touches[0].clientX;
            clickY = event.touches[0].clientY;
        } else {
            clickX = event.clientX;
            clickY = event.clientY;
        }
        
        // Force a layout to ensure accurate dimensions
        menu.style.visibility = 'hidden';
        menu.style.position = 'fixed';
        menu.style.left = '0px';
        menu.style.top = '0px';
        
        // Get accurate menu dimensions
        const menuRect = menu.getBoundingClientRect();
        const menuWidth = menuRect.width;
        // Use actual height if available, otherwise assume maximum safe height
        const actualHeight = menuRect.height;
        const menuHeight = actualHeight > 0 ? actualHeight : 350; // Conservative max height
        
        // Restore visibility
        menu.style.visibility = 'visible';
        
        // Calculate positioning
        const positioning = this.calculatePositioning(clickX, clickY, menuWidth, menuHeight, viewportWidth, viewportHeight);
        
        // Apply positioning classes BEFORE animation
        menu.className = menu.className.replace(/position-\w+/g, ''); // Remove existing position classes
        menu.classList.add(`position-${positioning.vertical}`, `position-${positioning.horizontal}`);
        
        // Apply CSS positioning
        menu.style.left = `${positioning.x}px`;
        if (positioning.vertical === 'down') {
            menu.style.top = `${positioning.y}px`;
            menu.style.bottom = '';
        } else {
            menu.style.bottom = `${positioning.y}px`;
            menu.style.top = '';
        }
        
        // Trigger animation with correct direction
        menu.classList.remove('context-menu-animate');
        void menu.offsetWidth; // Trigger reflow
        menu.classList.add('context-menu-animate');
    }
    
    calculatePositioning(clickX, clickY, menuWidth, menuHeight, viewportWidth, viewportHeight) {
        const spaceBelow = viewportHeight - clickY;
        const spaceRight = viewportWidth - clickX;
        
        // Determine vertical positioning
        let vertical = 'down';
        let y = clickY + 5;
        
        if (spaceBelow < menuHeight + 20) {
            vertical = 'up';
            y = viewportHeight - clickY + 5;
        }
        
        // Determine horizontal positioning
        let horizontal = 'right';
        let x = clickX + 5;

        if (spaceRight < menuWidth + 10) {
            horizontal = 'left';
            x = clickX - menuWidth - 5;
        }
        
        // Ensure menu stays within viewport bounds
        const originalX = x;
        if (x < 10) x = 10;
        if (x + menuWidth > viewportWidth - 10) x = viewportWidth - menuWidth - 10;
        
        return { x, y, vertical, horizontal };
    }

    setupKeyboardNavigation() {
        const handleKeydown = (e) => {
            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    this.hideMenu();
                    break;
            }
        };

        this.menu.addEventListener('keydown', handleKeydown);
    }

    executeAction(action, target, item) {
        // Dispatch custom event
        const event = new CustomEvent('contextMenuAction', {
            detail: {
                action: action,
                target: target,
                item: item,
                menu: this
            }
        });
        
        document.dispatchEvent(event);
    }

    hideMenu() {
        if (!this.isOpen) return;
        
        this.menu.classList.add('hidden');
        this.overlay.classList.add('hidden');
        this.isOpen = false;
        this.currentTarget = null;
        
        // Hide any open submenu
        this.hideSubmenu();
        
        // Clear any touch timers
        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }

        // Clear hover timers
        this.clearHoverTimers();
    }

    addSubmenuHoverSupport(itemElement, item, target) {
        // Mouse enter - start timer to open submenu
        itemElement.addEventListener('mouseenter', () => {
            this.clearHoverTimers();
            
            this.hoverTimers.openTimer = setTimeout(() => {
                if (!item.disabled) {
                    let submenuOptions = null;
                    
                    if (item.submenu && Array.isArray(item.submenu)) {
                        submenuOptions = item.submenu;
                    } else if (item.optionsfn && typeof item.optionsfn === 'function') {
                        submenuOptions = item.optionsfn(target);
                    }
                    
                    if (submenuOptions && Array.isArray(submenuOptions)) {
                        this.showSubmenu(itemElement, submenuOptions, target, item.handlerfn);
                    }
                }
            }, this.hoverSettings.openDelay);
        });
    }

    clearHoverTimers() {
        if (this.hoverTimers.openTimer) {
            clearTimeout(this.hoverTimers.openTimer);
            this.hoverTimers.openTimer = null;
        }
        if (this.hoverTimers.closeTimer) {
            clearTimeout(this.hoverTimers.closeTimer);
            this.hoverTimers.closeTimer = null;
        }
    }

    // Public API methods
    attachToElement(element, config) {
        if (!element || !config) return;
        
        // Store the config in a way that preserves functions
        const configId = 'context-menu-config-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.configs = this.configs || {};
        this.configs[configId] = config;
        
        element.setAttribute('data-context-menu', configId);
    }

    detachFromElement(element) {
        if (!element) return;
        
        const configId = element.dataset.contextMenu;
        if (configId && this.configs) {
            delete this.configs[configId];
        }
        
        element.removeAttribute('data-context-menu');
    }

    attachToElements(selector, config) {
        if (!selector || !config) return;
        
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            this.attachToElement(element, config);
        });
    }

    showSubmenu(parentItem, submenuItems, target, customHandler = null) {
        // Remove any existing submenu
        this.hideSubmenu();
        
        // Keep parent item active
        parentItem.classList.add('keyboard-selected');
        
        // Create submenu container
        const submenu = document.createElement('div');
        submenu.className = 'context-menu-submenu';
        
        // Create submenu items
        submenuItems.forEach((subItem) => {
            if (subItem.separator) {
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';
                submenu.appendChild(separator);
                return;
            }
            
            const subItemElement = document.createElement('div');
            subItemElement.className = 'context-menu-item';
            subItemElement.setAttribute('role', 'menuitem');
            subItemElement.tabIndex = 0;
            
            // Custom content or Icon + Text
            if (subItem.content) {
                if (typeof subItem.content === 'string') {
                    subItemElement.innerHTML = subItem.content;
                } else if (subItem.content instanceof HTMLElement) {
                    subItemElement.appendChild(subItem.content);
                } else if (typeof subItem.content === 'function') {
                    const customContent = subItem.content(target);
                    if (customContent instanceof HTMLElement) {
                        subItemElement.appendChild(customContent);
                    } else if (typeof customContent === 'string') {
                        subItemElement.innerHTML = customContent;
                    }
                }
            } else {
                // Default icon + text behavior
                if (subItem.icon) {
                    const iconElement = document.createElement('i');
                    iconElement.className = `${subItem.icon}`;
                    subItemElement.appendChild(iconElement);
                }
                
                if (subItem.text) {
                    const textElement = document.createElement('span');
                    textElement.className = 'context-menu-item-text';
                    textElement.textContent = subItem.text;
                    subItemElement.appendChild(textElement);
                }
            }
            
            // Disabled state
            if (subItem.disabled) {
                subItemElement.classList.add('disabled');
                subItemElement.setAttribute('aria-disabled', 'true');
            }
            
            // Click handler
            if (customHandler && typeof customHandler === 'function') {
                subItemElement.addEventListener('click', () => {
                    if (!subItem.disabled) {
                        customHandler(subItem, target);
                        this.hideMenu();
                    }
                });
            } else if (subItem.action && typeof subItem.action === 'string') {
                subItemElement.addEventListener('click', () => {
                    if (!subItem.disabled) {
                        this.executeAction(subItem.action, target, subItem);
                        this.hideMenu();
                    }
                });
            }
            
            submenu.appendChild(subItemElement);
        });
        
        // Position submenu relative to viewport (completely outside menu)
        const parentRect = parentItem.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate initial position (to the right of parent item, no padding)
        let submenuX = parentRect.right;
        let submenuY = parentRect.top;
        let submenuDirection = 'right';
        
        // Check if submenu would go off the right edge
        if (submenuX + 200 > viewportWidth) { // Assuming max width of 200px
            submenuX = parentRect.left - 200; // Position to the left instead
            submenuDirection = 'left';
        }
        
        // Ensure submenu doesn't go off the bottom edge
        if (submenuY + 400 > viewportHeight) { // Assuming max height of 400px
            submenuY = viewportHeight - 410; // Adjust to fit
        }
        
        // Add direction class for styling
        submenu.classList.add(`submenu-${submenuDirection}`);
        
        submenu.style.position = 'fixed';
        submenu.style.left = `${submenuX}px`;
        submenu.style.top = `${submenuY}px`;
        submenu.style.zIndex = '9999'; // Ensure it's above everything
        
        // Add to document body so it's completely outside the menu
        document.body.appendChild(submenu);
        this.currentSubmenu = submenu;
        
        // Add click outside handler for submenu
        const submenuClickHandler = (e) => {
            if (!submenu.contains(e.target) && !parentItem.contains(e.target)) {
                this.hideSubmenu();
            }
        };
        
        document.addEventListener('click', submenuClickHandler);
        this.submenuClickHandler = submenuClickHandler;
    }
    
    hideSubmenu() {
        if (this.currentSubmenu) {
            this.currentSubmenu.remove();
            this.currentSubmenu = null;
        }
        
        // Remove active state from any parent items
        const activeItems = this.menu.querySelectorAll('.context-menu-item.keyboard-selected');
        activeItems.forEach(item => item.classList.remove('keyboard-selected'));
        
        if (this.submenuClickHandler) {
            document.removeEventListener('click', this.submenuClickHandler);
            this.submenuClickHandler = null;
        }
    }

    destroy() {
        if (this.menu && this.menu.parentNode) {
            this.menu.parentNode.removeChild(this.menu);
        }
        this.hideMenu();
    }
}

// Create global instance
window.contextMenu = new ContextMenuController();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContextMenuController;
}
