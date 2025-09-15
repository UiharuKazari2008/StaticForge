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
        this.touchStartX = null;
        this.touchStartY = null;
        this.hasScrolled = false;
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

        this.mobileBreakpoints = {
            small: 480,  // Small mobile devices
            tablet: 768  // Tablets and larger mobile devices
        };

        this.init();
    }

    // Mobile detection methods
    isMobile(breakpoint = 'tablet') {
        return window.innerWidth < this.mobileBreakpoints[breakpoint];
    }

    isSmallMobile() {
        return this.isMobile('small');
    }

    isDesktop() {
        return !this.isMobile('tablet');
    }

    // Filter items based on mobile/desktop visibility
    shouldShowItem(item) {
        const isMobile = this.isMobile();

        // Check mobile-only items
        if (item.mobileOnly && !isMobile) {
            return false;
        }

        // Check desktop-only items
        if (item.desktopOnly && isMobile) {
            return false;
        }

        // Check for specific breakpoint conditions
        if (item.showOnBreakpoint) {
            const breakpoint = item.showOnBreakpoint;
            if (breakpoint === 'mobile' && !isMobile) return false;
            if (breakpoint === 'desktop' && isMobile) return false;
            if (breakpoint === 'small-mobile' && !this.isSmallMobile()) return false;
            if (breakpoint === 'tablet-and-up' && this.isSmallMobile()) return false;
        }

        // Check for hide conditions
        if (item.hideOnBreakpoint) {
            const breakpoint = item.hideOnBreakpoint;
            if (breakpoint === 'mobile' && isMobile) return false;
            if (breakpoint === 'desktop' && !isMobile) return false;
            if (breakpoint === 'small-mobile' && this.isSmallMobile()) return false;
            if (breakpoint === 'tablet-and-up' && !this.isSmallMobile()) return false;
        }

        return true;
    }

    init() {
        this.createMenu();
        this.bindEvents();
    }

    createMenu() {
        // Create the overlay to catch clicks outside the menu
        this.overlay = document.createElement('div');
        this.overlay.className = 'context-menu-overlay hidden';
        this.overlay.addEventListener('click', (e) => {
            // Prevent event bubbling to avoid conflicts
            e.stopPropagation();

            // On mobile, close submenu first if it exists, then close main menu
            if (this.isMobile() && this.currentSubmenu) {
                // Close submenu and prevent further processing in this event loop
                this.hideSubmenu();
                // Don't close main menu in the same event - let user tap again
                return;
            } else {
                // No submenu open, close the main menu
                this.hideMenu();
            }
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
            // Prevent touch events from passing through to elements below
            e.preventDefault();

            // On mobile, close submenu first if it exists, then close main menu
            if (this.isMobile() && this.currentSubmenu) {
                // Close submenu and prevent further processing
                this.hideSubmenu();
                return; // Don't process further - let user tap again for main menu
            }

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
        }, { passive: false });
        
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
                this.touchStartX = e.touches[0].clientX;
                this.touchStartY = e.touches[0].clientY;
                this.hasScrolled = false;

                // Clear any existing timer
                if (this.touchTimer) {
                    clearTimeout(this.touchTimer);
                }

                // Set up long-press timer
                this.touchTimer = setTimeout(() => {
                    if (!this.hasScrolled) {
                        this.showMenu(e, target, true);
                    }
                }, this.longPressDelay);
            }
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (this.touchTimer && e.touches.length === 1) {
                const touch = e.touches[0];

                // Calculate distance moved from initial touch point
                const deltaX = Math.abs(touch.clientX - this.touchStartX);
                const deltaY = Math.abs(touch.clientY - this.touchStartY);

                // Cancel if moved too far (indicates scrolling or dragging)
                if (deltaX > this.touchThreshold || deltaY > this.touchThreshold) {
                    this.hasScrolled = true;
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
            // Reset touch tracking
            this.touchStartX = null;
            this.touchStartY = null;
            this.hasScrolled = false;
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
            // Check if section should be shown based on mobile/desktop visibility
            if (!this.shouldShowItem(section)) {
                return; // Skip this section entirely
            }

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

            // Check if item should be shown based on mobile/desktop visibility
            if (!this.shouldShowItem(item)) {
                return; // Skip this item
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

            // Check if icon should be shown based on mobile/desktop visibility
            if (!this.shouldShowItem(icon)) {
                return; // Skip this icon
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
                const iconValue = typeof icon.icon === 'function' ? icon.icon(target) : icon.icon;
                iconClass.className = `${iconValue}`;
                iconElement.appendChild(iconClass);
            }

            // Tooltip
            if (icon.tooltip) {
                const tooltipValue = typeof icon.tooltip === 'function' ? icon.tooltip(target) : icon.tooltip;
                iconElement.title = tooltipValue;
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

        // Position submenu based on screen size
        const parentRect = parentItem.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const isMobile = viewportWidth < 768;

        let submenuX, submenuY, submenuDirection;

        // Get submenu dimensions (assume standard size if not yet rendered)
        const submenuWidth = 200; // Standard submenu width
        const submenuHeight = 300; // Conservative height estimate

        // Calculate positioning using similar logic to main menu
        const parentCenterX = parentRect.left + (parentRect.width / 2);
        const parentCenterY = parentRect.top + (parentRect.height / 2);

        // For both mobile and desktop: use top/down positioning logic
        const spaceBelow = viewportHeight - parentCenterY;
        const spaceAbove = parentCenterY;

        // Determine vertical positioning
        let vertical = 'down';
        if (spaceBelow < submenuHeight + 20 && spaceAbove > spaceBelow) {
            vertical = 'up';
        }

        // Calculate vertical position
        if (vertical === 'down') {
            submenuY = parentRect.bottom + 2; // Slight gap below parent
            submenuDirection = 'below';
        } else {
            submenuY = parentRect.top - submenuHeight - 2; // Above parent
            submenuDirection = 'above';
        }

        // Ensure submenu doesn't go off screen vertically
        if (submenuY < 10) {
            submenuY = 10; // Minimum top margin
        }
        if (submenuY + submenuHeight > viewportHeight - 10) {
            submenuY = viewportHeight - submenuHeight - 10; // Maximum bottom margin
        }

        // Determine horizontal positioning
        if (isMobile) {
            // On mobile: center horizontally on parent item
            submenuX = parentCenterX - (submenuWidth / 2);
            submenuDirection += '-mobile';
        } else {
            // Desktop: position to the right of parent item
            submenuX = parentRect.right + 2; // Slight gap to the right
            submenuDirection = 'right';

            // Check if submenu would go off the right edge
            if (submenuX + submenuWidth > viewportWidth - 10) {
                submenuX = parentRect.left - submenuWidth - 2; // Position to the left instead
                submenuDirection = 'left';
            }
        }

        // Ensure submenu stays within horizontal bounds
        if (submenuX < 10) {
            submenuX = 10; // Minimum left margin
        }
        if (submenuX + submenuWidth > viewportWidth - 10) {
            submenuX = viewportWidth - submenuWidth - 10; // Maximum right margin
        }

        // Add direction class for styling
        submenu.classList.add(`submenu-${submenuDirection}`);

        submenu.style.position = 'fixed';
        submenu.style.left = `${submenuX}px`;
        submenu.style.top = `${submenuY}px`;

        // Add to document body
        document.body.appendChild(submenu);
        this.currentSubmenu = submenu;

        // Add click outside handler for submenu
        const submenuClickHandler = (e) => {
            // Only handle clicks that are actually outside the submenu
            if (!submenu.contains(e.target) && !parentItem.contains(e.target)) {
                e.stopPropagation(); // Prevent bubbling to overlay handlers
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

/*
MOBILE/DESKTOP FILTERING USAGE EXAMPLES:

1. SIMPLE MOBILE/DESKTOP ONLY ITEMS:

// Mobile-only item
{
    text: "Touch-specific action",
    action: "touchAction",
    mobileOnly: true
}

// Desktop-only item
{
    text: "Desktop keyboard shortcut",
    action: "desktopAction",
    desktopOnly: true
}

2. BREAKPOINT-SPECIFIC ITEMS:

// Show only on mobile (tablets and phones)
{
    text: "Mobile layout option",
    action: "mobileLayout",
    showOnBreakpoint: "mobile"
}

// Show only on desktop
{
    text: "Desktop features",
    action: "desktopFeatures",
    showOnBreakpoint: "desktop"
}

// Show only on small mobile phones (≤480px)
{
    text: "Compact view",
    action: "compactView",
    showOnBreakpoint: "small-mobile"
}

// Show on tablets and larger (≥481px)
{
    text: "Full features",
    action: "fullFeatures",
    showOnBreakpoint: "tablet-and-up"
}

3. HIDE ON SPECIFIC BREAKPOINTS:

// Hide on mobile devices
{
    text: "Complex desktop tool",
    action: "complexTool",
    hideOnBreakpoint: "mobile"
}

// Hide on small mobile phones
{
    text: "Requires larger screen",
    action: "largeScreenRequired",
    hideOnBreakpoint: "small-mobile"
}

4. SECTION-LEVEL FILTERING:

// Entire section only on desktop
{
    type: "list",
    title: "Advanced Options",
    desktopOnly: true,
    items: [...]
}

// Entire section only on mobile
{
    type: "icons",
    title: "Quick Actions",
    mobileOnly: true,
    icons: [...]
}

5. COMPLETE EXAMPLE CONFIG:

const contextMenuConfig = {
    sections: [
        {
            type: "list",
            title: "File Operations",
            items: [
                {
                    text: "Open",
                    icon: "fas fa-folder-open",
                    action: "openFile"
                },
                {
                    text: "Save",
                    icon: "fas fa-save",
                    action: "saveFile",
                    hideOnBreakpoint: "small-mobile" // Hide on phones
                },
                {
                    text: "Print",
                    icon: "fas fa-print",
                    action: "printFile",
                    desktopOnly: true // Desktop only
                },
                {
                    separator: true
                },
                {
                    text: "Share",
                    icon: "fas fa-share",
                    action: "shareFile",
                    mobileOnly: true // Mobile only
                }
            ]
        },
        {
            type: "icons",
            title: "Quick Tools",
            showOnBreakpoint: "tablet-and-up", // Tablets and desktop
            icons: [
                {
                    icon: "fas fa-copy",
                    tooltip: "Copy",
                    action: "copyItem"
                },
                {
                    icon: "fas fa-paste",
                    tooltip: "Paste",
                    action: "pasteItem"
                }
            ]
        }
    ]
};

USAGE:
- mobileOnly: true/false - Show only on mobile devices (< 768px)
- desktopOnly: true/false - Show only on desktop devices (≥ 768px)
- showOnBreakpoint: "mobile" | "desktop" | "small-mobile" | "tablet-and-up"
- hideOnBreakpoint: "mobile" | "desktop" | "small-mobile" | "tablet-and-up"

Works on individual items, icons, and entire sections!
*/
