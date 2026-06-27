/**
 * Context Menu Controller
 * A customizable context menu system that supports:
 * - Desktop right-click and touch long-press (context menus via attachToElement)
 * - Click/tap menus anchored to triggers (attachClickMenuToElement)
 * - Per-item context menus inside open menus (item.itemContextMenu + itemContextBindfn)
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
        this.touchThreshold = (typeof touchSlopUtils !== 'undefined' && touchSlopUtils.TOUCH_SLOP_PX)
            ? touchSlopUtils.TOUCH_SLOP_PX
            : 12;
        this._touchScrollSnapshot = null;
        this._boundTouchScrollCancel = null;
        this.hoverTimers = {
            openTimer: null,
            closeTimer: null
        };
        this.hoverSettings = {
            openDelay: 320, // ms
            closeDelay: 300 // ms - reduced for faster response, but submenu hover will cancel it
        };

        this.mobileBreakpoints = {
            small: 480,  // Small mobile devices
            tablet: 768  // Tablets and larger mobile devices
        };

        /** Parent menus when a nested item context menu is open (restore on hide). */
        this.menuStack = [];

        /** Active root menu config while open (for options like closeTreeOnOuterClick). */
        this.activeRootMenuConfig = null;

        /** After touch long-press open, ignore synthetic `contextmenu` (stops double open / double animation). */
        this._suppressDocumentContextMenuUntil = 0;
        /** Next `positionMenu` pass centers the root menu in the viewport (e.g. bulk move shortcut). */
        this._nextMenuViewportCenter = false;

        /** Monotonic id — stale hideMenu completion handlers bail when this changes. */
        this._hideSessionId = 0;
        this._hideCompleteTimer = null;
        this._hideAnimationEndHandler = null;

        /** Click/tap menus (separate from right-click / long-press context menus). */
        this.clickMenuConfigs = {};
        this.activeMenuTrigger = null;
        this._pendingClickMenuTouchTarget = null;
        /** After touch-open, ignore ghost click on trigger and overlay dismiss. */
        this._suppressClickMenuClickUntil = 0;

        /** Touch long-press confirmed for text inputs — blocks spurious contextmenu on short taps. */
        this._textInputLongPressConfirmed = false;
        this._textInputLongPressTarget = null;
        this._textInputLongPressClearTimer = null;

        this.init();
    }

    // Mobile detection methods
    isMobile(breakpoint = 'tablet') {
        return window.innerWidth < this.mobileBreakpoints[breakpoint];
    }

    _getScrollableScrollSnapshot(element) {
        const snapshot = [];
        let node = element;
        while (node && node !== document.documentElement) {
            const style = getComputedStyle(node);
            const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
            const scrollableX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
            if (scrollableY || scrollableX) {
                snapshot.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
            }
            node = node.parentElement;
        }
        return snapshot;
    }

    _hasTouchScrollMoved(snapshot) {
        if (!snapshot || !snapshot.length) {
            return false;
        }
        return snapshot.some((entry) =>
            Math.abs(entry.el.scrollTop - entry.top) > 1
            || Math.abs(entry.el.scrollLeft - entry.left) > 1
        );
    }

    _bindTouchScrollCancelListener() {
        if (this._boundTouchScrollCancel) {
            return;
        }
        this._boundTouchScrollCancel = () => {
            if (this.touchTimer) {
                this._cancelTouchLongPress();
            }
        };
        document.addEventListener('scroll', this._boundTouchScrollCancel, { capture: true, passive: true });
    }

    _removeTouchScrollCancelListener() {
        if (!this._boundTouchScrollCancel) {
            return;
        }
        document.removeEventListener('scroll', this._boundTouchScrollCancel, { capture: true });
    }

    _cancelTouchLongPress() {
        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
        this.hasScrolled = true;
        this._removeTouchScrollCancelListener();
    }

    _clearTouchTracking() {
        this._cancelTouchLongPress();
        this.touchStartX = null;
        this.touchStartY = null;
        this._touchScrollSnapshot = null;
        this.hasScrolled = false;
    }

    isSmallMobile() {
        return this.isMobile('small');
    }

    isDesktop() {
        return !this.isMobile('tablet');
    }

    _isTextInputContextMenuTarget(element) {
        if (!element) return false;
        if (element.tagName === 'TEXTAREA') return true;
        if (element.tagName === 'INPUT') {
            const type = (element.type || 'text').toLowerCase();
            return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'image', 'range', 'color'].includes(type);
        }
        return element.isContentEditable;
    }

    _clearTextInputLongPressState(delayMs = 0) {
        if (this._textInputLongPressClearTimer) {
            clearTimeout(this._textInputLongPressClearTimer);
            this._textInputLongPressClearTimer = null;
        }
        const clear = () => {
            this._textInputLongPressClearTimer = null;
            this._textInputLongPressConfirmed = false;
            this._textInputLongPressTarget = null;
        };
        if (delayMs > 0) {
            this._textInputLongPressClearTimer = setTimeout(clear, delayMs);
        } else {
            clear();
        }
    }

    /**
     * Textareas/inputs: on touch, ignore native contextmenu unless our long-press timer fired.
     * Desktop mouse right-click is always allowed.
     */
    _shouldAllowContextMenuOpen(event, target) {
        if (event._isProxyEvent) return true;
        if (!this._isTextInputContextMenuTarget(target)) return true;
        if (event.pointerType === 'mouse') return true;
        if (event.pointerType === 'touch') {
            return this._textInputLongPressConfirmed && this._textInputLongPressTarget === target;
        }
        // Legacy desktop right-click (no pointerType): allow when not in an active touch session
        if (!this._textInputLongPressTarget) return true;
        return this._textInputLongPressConfirmed && this._textInputLongPressTarget === target;
    }

    // Filter items based on mobile/desktop visibility
    shouldShowItem(item) {
        // Check if item is explicitly hidden
        if (typeof item.hidden === 'function') {
            try {
                if (item.hidden()) {
                    return false;
                }
            } catch (error) {
                console.error('Error executing item hidden fn:', error);
                return false;
            }
        } else if (item.hidden === true) {
            return false;
        }

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

    /** Radio-style selection dot: keepMenuOpen toggles, or showIndicator without keeping menu open. */
    itemWantsIndicator(item) {
        if (!item || item.noIndicator || item.highlighted) return false;
        return Boolean(item.keepMenuOpen || item.showIndicator);
    }

    /** 'box' (default) or 'dot' when showIndicator / keepMenuOpen; null when none. */
    getIndicatorStyle(item) {
        if (!item || item.noIndicator || item.highlighted) return null;
        if (item.indicatorStyle === 'dot') return 'dot';
        if (item.indicatorStyle === 'box') return 'box';
        if (this.itemWantsIndicator(item)) return 'box';
        return null;
    }

    applyItemHighlightAndIndicator(itemElement, item) {
        if (!itemElement || !item) return;

        itemElement.classList.toggle('context-menu-item-highlighted', !!item.highlighted);

        const indicatorStyle = this.getIndicatorStyle(item);
        if (!indicatorStyle) {
            itemElement.classList.remove('has-toggle-indicator');
            const existing = itemElement.querySelector('.context-menu-item-indicator');
            if (existing) existing.remove();
            return;
        }

        let indicatorDot = itemElement.querySelector('.context-menu-item-indicator');
        if (!indicatorDot) {
            indicatorDot = document.createElement('span');
            itemElement.appendChild(indicatorDot);
        }
        indicatorDot.className = 'context-menu-item-indicator indicator-' + indicatorStyle;
        indicatorDot.classList.toggle('checked', item.checked === true || item.dataState === 'on');
        itemElement.classList.add('has-toggle-indicator');
    }

    resolveItemContextMenuConfig(item, menuTarget) {
        if (!item || !item.itemContextMenu) return null;
        const raw = item.itemContextMenu;
        return typeof raw === 'function' ? raw(item, menuTarget) : raw;
    }

    wireItemContextMenu(itemElement, item, menuTarget) {
        if (!itemElement || !item) return;

        if (item.itemContextBindfn) {
            try {
                item.itemContextBindfn(item, itemElement, menuTarget);
            } catch (error) {
                console.error('Error executing itemContextBindfn:', error);
            }
        }

        const config = this.resolveItemContextMenuConfig(item, menuTarget);
        if (!config) return;

        this.attachToElement(itemElement, config);
        itemElement.classList.add('has-item-context-menu');
    }

    detachItemContextMenusFromConfig(config) {
        if (!config || !config.sections || !Array.isArray(config.sections)) return;

        config.sections.forEach((section) => {
            if (section.type !== 'list' || !section.items) return;
            section.items.forEach((item) => {
                if (item._element && item._element.dataset.contextMenu) {
                    this.detachFromElement(item._element);
                    item._element.classList.remove('has-item-context-menu');
                }
            });
        });
    }

    isNestedItemContextOpen(target, trigger) {
        if (!this.isOpen || trigger !== 'context' || !target || !this.menu) return false;
        if (!target.classList.contains('has-item-context-menu')) return false;
        return this.menu.contains(target);
    }

    /** True when keyboard focus is inside the open menu tree (root menu, submenu, or nested inputs). */
    isFocusInsideOpenMenu() {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) {
            return false;
        }
        if (this.menu && !this.menu.classList.contains('hidden') && this.menu.contains(active)) {
            return true;
        }
        if (this.currentSubmenu && this.currentSubmenu.contains(active)) {
            return true;
        }
        return false;
    }

    pushMenuStackSnapshot() {
        this.menuStack.push({
            config: this.activeRootMenuConfig,
            target: this.currentTarget,
            trigger: this.activeMenuTrigger
        });
    }

    restoreParentMenuFromStack() {
        const parent = this.menuStack.pop();
        if (!parent || !parent.config) return false;

        this.hideSubmenu();
        this.activeMenuTrigger = parent.trigger;
        this.activeRootMenuConfig = parent.config;
        this.currentTarget = parent.target;
        this.menu.classList.toggle('context-menu-click-triggered', parent.trigger === 'click');

        if (parent.config.beforeShow) {
            try {
                parent.config.beforeShow(null, parent.target, false);
            } catch (error) {
                console.error('Error executing menu beforeShow on restore:', error);
            }
        }

        this.applyMaxHeight(parent.config);
        this.executeInitFunctions(parent.config, parent.target);
        this.renderMenu(parent.config, parent.target);
        this.positionMenuForStoredTarget(parent.target, parent.config, parent.trigger);
        this.executeLoadFunctions(parent.config, parent.target);
        this.updateIndicatorDots(parent.config);

        parent.target.classList.add('context-open');
        this.isOpen = true;
        this.overlay.classList.remove('hidden');
        return true;
    }

    positionMenuForStoredTarget(target, config, trigger) {
        const menu = this.menu;
        menu.classList.remove('hidden');
        menu.style.opacity = '0';

        const menuRect = menu.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height > 0 ? menuRect.height : 350;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let positioning;
        if (config && (config.position === 'anchor' || trigger === 'click')) {
            const anchorEl = (config.anchorElement && typeof config.anchorElement === 'function')
                ? config.anchorElement(target)
                : target;
            positioning = this.calculateAnchorPositioning(
                anchorEl.getBoundingClientRect(),
                menuWidth,
                menuHeight,
                viewportWidth,
                viewportHeight,
                config.anchorAlign || 'start'
            );
        } else {
            const rect = target.getBoundingClientRect();
            positioning = this.calculateAnchorPositioning(
                rect,
                menuWidth,
                menuHeight,
                viewportWidth,
                viewportHeight,
                config && config.anchorAlign ? config.anchorAlign : 'start'
            );
        }

        menu.className = menu.className.replace(/position-\w+/g, '');
        menu.classList.add(`position-${positioning.vertical}`, `position-${positioning.horizontal}`);
        menu.style.left = `${positioning.x}px`;
        menu.style.top = `${positioning.y}px`;
        menu.style.bottom = '';
        menu.style.opacity = '';
    }

    /**
     * Run initfn or loadfn on every entry in a submenu array, including nested `type: 'grid'` blocks (same rules as list/icons).
     * @param {'initfn'|'loadfn'} fnKey
     */
    applySubmenuItemFns(submenuItems, target, fnKey) {
        if (!submenuItems || !Array.isArray(submenuItems)) return;
        submenuItems.forEach((entry) => {
            if (!entry || entry.separator) return;
            if (entry.type === 'grid' && Array.isArray(entry.items)) {
                const blockFn = entry[fnKey];
                if (typeof blockFn === 'function') {
                    try {
                        blockFn(entry, target);
                    } catch (error) {
                        console.error(`Error executing submenu grid block ${fnKey}:`, error);
                    }
                }
                entry.items.forEach((cell) => {
                    const fn = cell && cell[fnKey];
                    if (typeof fn === 'function') {
                        try {
                            fn(cell, target);
                        } catch (error) {
                            console.error(`Error executing submenu grid cell ${fnKey}:`, error);
                        }
                    }
                });
            } else {
                const fn = entry[fnKey];
                if (typeof fn === 'function') {
                    try {
                        fn(entry, target);
                    } catch (error) {
                        console.error(`Error executing submenu item ${fnKey}:`, error);
                    }
                }
            }
        });
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

            // Touch tap opens menu on touchend; browser then fires a synthetic click on the overlay
            if (Date.now() < this._suppressClickMenuClickUntil) return;

            // On mobile, keep submenus open - only close entire menu when clicking overlay
            // On desktop, close submenu first if it exists (unless root opts into closing the whole tree)
            if (!this.isMobile() && this.currentSubmenu) {
                if (this.activeRootMenuConfig && this.activeRootMenuConfig.closeTreeOnOuterClick) {
                    this.hideMenu();
                    return;
                }
                this.hideSubmenu();
                return;
            }
            this.hideMenu();
        });

        // Allow right-click and touch events to pass through the overlay
        this.overlay.addEventListener('contextmenu', (e) => {
            // Prevent browser context menu from appearing
            e.preventDefault();
            // Hide current menu immediately
            this.hideMenu();
            // Use a delay to ensure the overlay is hidden, then trigger the event on the element below
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

                        // Mark this as a proxy event from the overlay
                        newEvent._isProxyEvent = true;

                        target.dispatchEvent(newEvent);
                    }
                }
            }, 50);
        });

        // Track overlay touch state for long-press detection
        this.overlayTouchTimer = null;
        this.overlayTouchStartTime = 0;
        this.overlayTouchStartX = null;
        this.overlayTouchStartY = null;
        this.overlayHasScrolled = false;

        this.overlay.addEventListener('touchstart', (e) => {
            // Prevent touch events from passing through to elements below
            e.preventDefault();

            // On mobile, disable proxy tap functionality - just close the menu
            if (this.isMobile()) {
                if (Date.now() < this._suppressClickMenuClickUntil) return;
                this.hideMenu();
                return;
            }

            // On desktop, close submenu first if it exists (unless root opts into closing the whole tree)
            if (this.currentSubmenu) {
                if (this.activeRootMenuConfig && this.activeRootMenuConfig.closeTreeOnOuterClick) {
                    this.hideMenu();
                    return;
                }
                this.hideSubmenu();
                return;
            }

            // Hide current menu immediately (which will also close any submenu)
            this.hideMenu();

            // Track touch start for long-press detection
            this.overlayTouchStartTime = Date.now();
            this.overlayTouchStartX = e.touches[0].clientX;
            this.overlayTouchStartY = e.touches[0].clientY;
            this.overlayHasScrolled = false;

            // Clear any existing overlay touch timer
            if (this.overlayTouchTimer) {
                clearTimeout(this.overlayTouchTimer);
            }

            // Set up long-press timer for proxy clicking
            this.overlayTouchTimer = setTimeout(() => {
                if (!this.overlayHasScrolled) {
                    // Use a delay to ensure the overlay is hidden, then open the menu on the element below
                    setTimeout(() => {
                        const elementBelow = document.elementFromPoint(this.overlayTouchStartX, this.overlayTouchStartY);
                        if (elementBelow && elementBelow !== this.overlay) {
                            const target = elementBelow.closest('[data-context-menu]');
                            if (target) {
                                const x = this.overlayTouchStartX;
                                const y = this.overlayTouchStartY;
                                const syntheticTouchEvent = {
                                    touches: [{ clientX: x, clientY: y }],
                                    clientX: x,
                                    clientY: y
                                };
                                this._suppressDocumentContextMenuUntil = Date.now() + 600;
                                this.showMenu(syntheticTouchEvent, target, true, true);
                            }
                        }
                    }, 50);
                }
            }, this.longPressDelay);
        }, { passive: false });

        this.overlay.addEventListener('touchmove', (e) => {
            if (this.overlayTouchTimer && e.touches.length === 1) {
                const touch = e.touches[0];

                // Calculate distance moved from initial touch point
                const deltaX = Math.abs(touch.clientX - this.overlayTouchStartX);
                const deltaY = Math.abs(touch.clientY - this.overlayTouchStartY);

                // Cancel if moved too far (indicates scrolling or dragging)
                if (deltaX > this.touchThreshold || deltaY > this.touchThreshold) {
                    this.overlayHasScrolled = true;
                    clearTimeout(this.overlayTouchTimer);
                    this.overlayTouchTimer = null;
                }
            }
        }, { passive: true });

        this.overlay.addEventListener('touchend', (e) => {
            if (this.overlayTouchTimer) {
                clearTimeout(this.overlayTouchTimer);
                this.overlayTouchTimer = null;
            }
            // Reset overlay touch tracking
            this.overlayTouchStartX = null;
            this.overlayTouchStartY = null;
            this.overlayHasScrolled = false;
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
        // Prevent focus transfer when activating context or click menu triggers
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                const clickTarget = e.target.closest('[data-click-menu]');
                if (clickTarget) {
                    e.preventDefault();
                    return;
                }
            }
            if (e.button === 2) {
                const target = e.target.closest('[data-context-menu]');
                if (target) {
                    e.preventDefault();
                }
            }
        });

        // Click/tap menus (left click)
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-click-menu]');
            if (!target) return;
            if (Date.now() < this._suppressClickMenuClickUntil) return;
            e.preventDefault();
            e.stopPropagation();
            this.showClickMenu(e, target, false);
        }, true);

        // Desktop right-click
        document.addEventListener('contextmenu', (e) => {
            const target = e.target.closest('[data-context-menu]');
            if (!target) return;
            if (!this._shouldAllowContextMenuOpen(e, target)) return;
            e.preventDefault();
            if (!e._isProxyEvent && Date.now() < this._suppressDocumentContextMenuUntil) {
                return;
            }
            this.showMenu(e, target, false, e._isProxyEvent);
        });

        // Touch events for long-press (context) and tap (click menu)
        document.addEventListener('touchstart', (e) => {
            const clickTarget = e.target.closest('[data-click-menu]');
            const contextTarget = e.target.closest('[data-context-menu]');
            const target = clickTarget || contextTarget;
            if (!target || e.touches.length !== 1) return;

            this.touchStartTime = Date.now();
            this.currentTarget = target;
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.hasScrolled = false;
            this._touchScrollSnapshot = this._getScrollableScrollSnapshot(target);
            this._bindTouchScrollCancelListener();
            this._pendingClickMenuTouchTarget = clickTarget || null;

            if (this.touchTimer) {
                clearTimeout(this.touchTimer);
            }

            if (contextTarget) {
                if (this._isTextInputContextMenuTarget(contextTarget)) {
                    this._clearTextInputLongPressState();
                    this._textInputLongPressTarget = contextTarget;
                }
                this.touchTimer = setTimeout(() => {
                    if (!this.hasScrolled && this.touchStartX != null && this.touchStartY != null) {
                        if (this._isTextInputContextMenuTarget(contextTarget)) {
                            this._textInputLongPressConfirmed = true;
                        }
                        this._suppressDocumentContextMenuUntil = Date.now() + 600;
                        this._pendingClickMenuTouchTarget = null;
                        const x = this.touchStartX;
                        const y = this.touchStartY;
                        const syntheticTouchEvent = {
                            touches: [{ clientX: x, clientY: y }],
                            clientX: x,
                            clientY: y
                        };
                        this.showMenu(syntheticTouchEvent, contextTarget, true, e._isProxyEvent);
                    }
                    this._removeTouchScrollCancelListener();
                }, this.longPressDelay);
            }
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!this.touchTimer || e.touches.length !== 1) {
                return;
            }
            const touch = e.touches[0];

            // Cancel if the finger moved (scroll/drag) or a scrollable ancestor scrolled (NAX grid, etc.)
            const deltaX = Math.abs(touch.clientX - this.touchStartX);
            const deltaY = Math.abs(touch.clientY - this.touchStartY);
            if (deltaX > this.touchThreshold || deltaY > this.touchThreshold) {
                this._cancelTouchLongPress();
                return;
            }
            if (this._hasTouchScrollMoved(this._touchScrollSnapshot)) {
                this._cancelTouchLongPress();
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            const clickTarget = this._pendingClickMenuTouchTarget;
            const touchDuration = Date.now() - this.touchStartTime;
            const wasShortTap = touchDuration < this.longPressDelay;

            if (this.touchTimer) {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
            }
            this._removeTouchScrollCancelListener();

            if (this._textInputLongPressTarget) {
                if (this._textInputLongPressConfirmed) {
                    this._clearTextInputLongPressState(400);
                } else {
                    this._clearTextInputLongPressState();
                }
            }

            if (clickTarget && wasShortTap && !this.hasScrolled && clickTarget.hasAttribute('data-click-menu')) {
                const touch = e.changedTouches && e.changedTouches[0];
                if (touch) {
                    const syntheticTouchEvent = {
                        touches: [{ clientX: touch.clientX, clientY: touch.clientY }],
                        clientX: touch.clientX,
                        clientY: touch.clientY
                    };
                    this.showClickMenu(syntheticTouchEvent, clickTarget, true);
                }
            }

            this._pendingClickMenuTouchTarget = null;
            this.touchStartX = null;
            this.touchStartY = null;
            this._touchScrollSnapshot = null;
            this.hasScrolled = false;
        }, { passive: true });

        document.addEventListener('touchcancel', () => {
            if (this.touchTimer) {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
            }
            this._removeTouchScrollCancelListener();
            this._clearTextInputLongPressState();
            this._pendingClickMenuTouchTarget = null;
            this.touchStartX = null;
            this.touchStartY = null;
            this._touchScrollSnapshot = null;
            this.hasScrolled = false;
        }, { passive: true });

        // Note: Click outside handling is now done by the overlay

        // Close menu on key press when focus is outside the menu (typing in a textarea, shortcuts, etc.)
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;
            if (e.key === 'Escape') {
                this.hideMenu();
                return;
            }
            if (this.isFocusInsideOpenMenu()) return;
            this.hideMenu();
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

    getActiveMenuConfig(target) {
        if (!target) return null;
        if (this.activeMenuTrigger === 'click') {
            const menuConfigId = target.dataset.clickMenu;
            return menuConfigId && this.clickMenuConfigs ? this.clickMenuConfigs[menuConfigId] : null;
        }
        const menuConfigId = target.dataset.contextMenu;
        return menuConfigId && this.configs ? this.configs[menuConfigId] : null;
    }

    showClickMenu(event, target, isTouch = false) {
        if (!target?.dataset?.clickMenu) return;
        this._openMenu(event, target, 'click', isTouch, false);
    }

    showMenu(event, target, isTouch = false, isProxyEvent = false) {
        if (!target?.dataset?.contextMenu) return;
        this._openMenu(event, target, 'context', isTouch, isProxyEvent);
    }

    _openMenu(event, target, trigger, isTouch = false, isProxyEvent = false) {
        const isNestedItemContext = this.isNestedItemContextOpen(target, trigger);

        if (this.isOpen && !isProxyEvent && !isNestedItemContext) {
            if (this.currentTarget === target && this.activeMenuTrigger === trigger) {
                this.hideMenu();
                return;
            }
            this._dismissForMenuSwitch();
            this.menuStack = [];
        }

        if (isNestedItemContext) {
            this.pushMenuStackSnapshot();
            this.hideSubmenu();
        }

        this._cancelPendingHide();

        if (this.menu) {
            this.menu.classList.remove('context-menu-closing', 'context-menu-opening', 'hidden');
            this.menu.style.opacity = '';
        }

        const config = trigger === 'click'
            ? this.clickMenuConfigs[target.dataset.clickMenu]
            : this.configs && this.configs[target.dataset.contextMenu];
        if (!config) {
            console.error('Menu configuration not found for trigger:', trigger, target);
            return;
        }

        this.activeMenuTrigger = trigger;
        this.menu.classList.toggle('context-menu-click-triggered', trigger === 'click');

        // Apply maxHeight setting if specified
        this.applyMaxHeight(config);

        if (config.beforeShow && typeof config.beforeShow === 'function') {
            try {
                config.beforeShow(event, target, isTouch);
            } catch (error) {
                console.error('Error executing menu beforeShow:', error);
            }
        }

        // Call initfn for all sections before rendering to allow dynamic item generation
        this.executeInitFunctions(config, target);

        this.renderMenu(config, target);
        this.currentTarget = target;
        this.positionMenu(event, isTouch);

        this.activeRootMenuConfig = config;

        // Call loadfn for all sections after menu is fully rendered and positioned
        this.executeLoadFunctions(config, target);

        // Update indicator dots after loadfn has set item.checked values
        this.updateIndicatorDots(config);

        this.isOpen = true;

        if (isTouch) {
            this._suppressClickMenuClickUntil = Date.now() + 400;
        }

        // Add position-based class for corner press effect
        this.addPositionClass(target, event, isTouch);

        // Add context-open class to target element
        target.classList.add('context-open');

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

    addPositionClass(target, event, isTouch) {
        // Get click/touch coordinates
        let clickX, clickY;
        if (isTouch) {
            clickX = event.touches[0].clientX;
            clickY = event.touches[0].clientY;
        } else {
            clickX = event.clientX;
            clickY = event.clientY;
        }

        // Get target element bounding rectangle
        const rect = target.getBoundingClientRect();

        // Calculate relative position within the element
        const relativeX = clickX - rect.left;
        const relativeY = clickY - rect.top;

        // Calculate position ratios
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // Determine position class
        let positionClass = '';

        // Check if click is in center regions (within 40% of center)
        const centerThreshold = 0.4;
        const isCenterX = Math.abs(relativeX - centerX) / centerX < centerThreshold;
        const isCenterY = Math.abs(relativeY - centerY) / centerY < centerThreshold;

        if (isCenterX && relativeY < centerY * (1 - centerThreshold)) {
            positionClass = 'center-top';
        } else if (isCenterX && relativeY > centerY * (1 + centerThreshold)) {
            positionClass = 'center-bottom';
        } else if (isCenterY && relativeX < centerX * (1 - centerThreshold)) {
            positionClass = 'center-left';
        } else if (isCenterY && relativeX > centerX * (1 + centerThreshold)) {
            positionClass = 'center-right';
        } else if (isCenterX && isCenterY) {
            positionClass = 'center-center';
        } else {
            // Corner regions
            const isTop = relativeY < centerY;
            const isLeft = relativeX < centerX;

            if (isTop && isLeft) {
                positionClass = 'top-left';
            } else if (isTop && !isLeft) {
                positionClass = 'top-right';
            } else if (!isTop && isLeft) {
                positionClass = 'bottom-left';
            } else {
                positionClass = 'bottom-right';
            }
        }

        // Add the position class to the target element
        if (positionClass) {
            target.classList.add(positionClass);
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

    executeInitFunctions(config, target) {
        if (!config.sections || !Array.isArray(config.sections)) return;

        config.sections.forEach((section) => {
            // Execute initfn for all section types to allow dynamic generation of items/content
            if (section.initfn && typeof section.initfn === 'function') {
                try {
                    section.initfn(section, target);
                } catch (error) {
                    console.error('Error executing section initfn:', error);
                }
            }

            // Execute initfn for individual list items if they exist
            if (section.type === 'list' && section.items && Array.isArray(section.items)) {
                section.items.forEach((item) => {
                    if (item.initfn && typeof item.initfn === 'function') {
                        try {
                            item.initfn(item, target);
                        } catch (error) {
                            console.error('Error executing list item initfn:', error);
                        }
                    }
                    if (item.submenu && Array.isArray(item.submenu)) {
                        this.applySubmenuItemFns(item.submenu, target, 'initfn');
                    }
                });
            }

            // Execute initfn for individual icons if they exist
            if (section.type === 'icons' && section.icons && Array.isArray(section.icons)) {
                section.icons.forEach((icon) => {
                    if (icon.initfn && typeof icon.initfn === 'function') {
                        try {
                            icon.initfn(icon, target);
                        } catch (error) {
                            console.error('Error executing icon initfn:', error);
                        }
                    }
                });
            }

            if (section.type === 'grid' && section.items && Array.isArray(section.items)) {
                if (section.initfn && typeof section.initfn === 'function') {
                    try {
                        section.initfn(section, target);
                    } catch (error) {
                        console.error('Error executing grid section initfn:', error);
                    }
                }
                section.items.forEach((cell) => {
                    if (cell.initfn && typeof cell.initfn === 'function') {
                        try {
                            cell.initfn(cell, target);
                        } catch (error) {
                            console.error('Error executing grid item initfn:', error);
                        }
                    }
                });
            }
        });
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
            if (section.type === 'list') {
                // Call section-level loadfn first to populate items dynamically
                if (section.loadfn && typeof section.loadfn === 'function') {
                    try {
                        section.loadfn(section, target);
                    } catch (error) {
                        console.error('Error executing list section loadfn:', error);
                    }
                }

                // Then process individual item loadfns if items exist
                if (section.items && Array.isArray(section.items)) {
                    section.items.forEach((item) => {
                        if (item.loadfn && typeof item.loadfn === 'function') {
                            try {
                                item.loadfn(item, target);
                            } catch (error) {
                                console.error('Error executing list item loadfn:', error);
                            }
                        }
                        if (item.submenu && Array.isArray(item.submenu)) {
                            this.applySubmenuItemFns(item.submenu, target, 'loadfn');
                        }
                    });
                }
            }

            // Execute loadfn for icon sections
            if (section.type === 'icons') {
                if (section.loadfn && typeof section.loadfn === 'function') {
                    try {
                        section.loadfn(section, target);
                    } catch (error) {
                        console.error('Error executing icons section loadfn:', error);
                    }
                }
                if (section.icons && Array.isArray(section.icons)) {
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
            }

            if (section.type === 'grid' && section.items && Array.isArray(section.items)) {
                if (section.loadfn && typeof section.loadfn === 'function') {
                    try {
                        section.loadfn(section, target);
                    } catch (error) {
                        console.error('Error executing grid section loadfn:', error);
                    }
                }
                section.items.forEach((cell) => {
                    if (cell.loadfn && typeof cell.loadfn === 'function') {
                        try {
                            cell.loadfn(cell, target);
                        } catch (error) {
                            console.error('Error executing grid item loadfn:', error);
                        }
                    }
                });
            }
        });
    }

    renderMenu(config, target) {
        this.detachItemContextMenusFromConfig(config);

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
        section._element = sectionElement;

        switch (section.type) {
            case 'list':
                return this.createListSection(section, target, sectionElement);
            case 'icons':
                return this.createIconsSection(section, target, sectionElement);
            case 'grid':
                return this.createGridSection(section, target, sectionElement);
            case 'custom':
                return this.createCustomSection(section, target, sectionElement);
            case 'separator':
                return this.createSeparatorSection(section, target, sectionElement);
            default:
                console.warn(`Unknown section type: ${section.type}`);
                return null;
        }
    }

    createSeparatorSection(section, target, sectionElement) {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        sectionElement.appendChild(separator);
        return sectionElement;
    }

    createListSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-list-section';

        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            const titleText = typeof section.title === 'function' ? section.title() : section.title;
            titleElement.textContent = titleText;
            sectionElement.appendChild(titleElement);
        }

        if (!section.items || !Array.isArray(section.items)) {
            console.warn('List section must have items array');
            return sectionElement;
        }

        // Track visible items to avoid emitting rogue/leading/trailing/consecutive separators
        // for sections that end up empty after hidden items are filtered (e.g. page-type conditional
        // actions in wiki display menus, or future conditional sections in gear menus).
        let hasVisibleItemSinceLastSep = false;

        section.items.forEach((item, itemIndex) => {
            if (item.separator) {
                // Allow explicit hidden on a separator itself for non-existent sections
                if (typeof item.hidden === 'function' ? item.hidden() : !!item.hidden) {
                    return;
                }
                if (!hasVisibleItemSinceLastSep) {
                    // Skip separator that would appear before any visible item in this section
                    // (prevents rogue divider when a whole preceding group of items is hidden by page type etc.)
                    return;
                }
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';

                // Support named separators with optional icon
                if (item.text) {
                    const nameElement = document.createElement('div');
                    nameElement.className = 'context-menu-separator-name';

                    // Add icon if provided
                    if (item.icon) {
                        const iconElement = document.createElement('i');
                        iconElement.className = item.icon;
                        nameElement.appendChild(iconElement);
                    }

                    const textElement = document.createElement('span');
                    textElement.textContent = item.text;
                    nameElement.appendChild(textElement);

                    separator.appendChild(nameElement);
                }

                sectionElement.appendChild(separator);
                hasVisibleItemSinceLastSep = false;
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

            hasVisibleItemSinceLastSep = true;

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
                    const textContainer = document.createElement('div');
                    textContainer.className = 'context-menu-item-text-container';

                    const textElement = document.createElement('span');
                    textElement.className = 'context-menu-item-text';
                    textElement.textContent = item.text;
                    textContainer.appendChild(textElement);

                    if (item.subtext !== null && item.subtext !== undefined) {
                        const subtextElement = document.createElement('span');
                        subtextElement.className = 'context-menu-item-subtext';
                        subtextElement.textContent = typeof item.subtext === 'function' ? item.subtext(target) : item.subtext;
                        textContainer.appendChild(subtextElement);
                    }

                    itemElement.appendChild(textContainer);
                }

                if (item.badge !== null && item.badge !== undefined) {
                    const badgeElement = document.createElement('span');
                    badgeElement.className = 'context-menu-item-badge';
                    badgeElement.textContent = typeof item.badge === 'function' ? item.badge(target) : String(item.badge);
                    itemElement.appendChild(badgeElement);
                }
            }

            // Value display for submenu items (shows current selection)
            if ((item.submenu && Array.isArray(item.submenu)) || item.optionsfn) {
                if (item.valueDisplay) {
                    const valueDisplayElement = document.createElement('span');
                    valueDisplayElement.className = 'context-menu-item-value';
                    const valueDisplayContent = typeof item.valueDisplay === 'function' ? item.valueDisplay(target) : item.valueDisplay;
                    if (typeof valueDisplayContent === 'string') {
                        valueDisplayElement.innerHTML = valueDisplayContent;
                    } else if (valueDisplayContent instanceof HTMLElement) {
                        valueDisplayElement.appendChild(valueDisplayContent);
                    }
                    itemElement.appendChild(valueDisplayElement);
                }

                // Submenu arrow
                const arrowElement = document.createElement('i');
                arrowElement.className = 'context-menu-submenu-arrow fas fa-chevron-right';
                itemElement.appendChild(arrowElement);
                itemElement.classList.add('has-submenu');
            }

            // Indicator for toggles / selection (box or dot) or row highlight
            this.applyItemHighlightAndIndicator(itemElement, item);

            // Apply tooltip if it exists
            if (item.tooltip !== undefined) {
                const tooltipValue = typeof item.tooltip === 'function' ? item.tooltip(target) : item.tooltip;
                if (tooltipValue) {
                    itemElement.title = tooltipValue;
                }
            }

            // Apply className if it exists
            if (item.className) {
                const classes = Array.isArray(item.className) ? item.className : item.className.split(' ');
                classes.forEach(cls => {
                    if (cls) itemElement.classList.add(cls);
                });
            }

            // Disabled state - evaluate function if it's a function
            const isDisabled = typeof item.disabled === 'function' ? item.disabled() : item.disabled;
            if (isDisabled) {
                itemElement.classList.add('disabled');
                itemElement.setAttribute('aria-disabled', 'true');
            }

            // Prevent focus transfer on mousedown
            itemElement.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });

            // Click handler
            if (item.action && typeof item.action === 'string') {
                itemElement.addEventListener('click', () => {
                    const isItemDisabled = typeof item.disabled === 'function' ? item.disabled() : item.disabled;
                    if (!isItemDisabled) {
                        this.executeAction(item.action, target, item);
                        // Only hide menu if keepMenuOpen is not set to true
                        if (!item.keepMenuOpen) {
                            this.hideMenu();
                        } else {
                            // If menu stays open, refresh the item display
                            this.refreshListItemDisplay(itemElement, item, target);
                        }
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
                    const isSubmenuItemDisabled = typeof item.disabled === 'function' ? item.disabled() : item.disabled;
                    if (!isSubmenuItemDisabled) {
                        this.showSubmenu(itemElement, item.submenu, target);
                    }
                });

                // Hover support for submenu
                if (!!item.openOnHover) {
                    this.addSubmenuHoverSupport(itemElement, item, target);
                }
            } else if (item.optionsfn && typeof item.optionsfn === 'function') {
                // Store optionsfn and handlerfn for refreshing
                itemElement._optionsfn = item.optionsfn;
                itemElement._handlerfn = item.handlerfn;

                itemElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOptionsItemDisabled = typeof item.disabled === 'function' ? item.disabled() : item.disabled;
                    if (!isOptionsItemDisabled) {
                        const submenuOptions = item.optionsfn(target);
                        if (submenuOptions && Array.isArray(submenuOptions)) {
                            this.showSubmenu(itemElement, submenuOptions, target, item.handlerfn);
                        }
                    }
                });

                // Hover support for submenu
                if (!!item.openOnHover) {
                    this.addSubmenuHoverSupport(itemElement, item, target);
                }
            }

            // Store reference to DOM element on item for later updates
            item._element = itemElement;
            this.wireItemContextMenu(itemElement, item, target);

            sectionElement.appendChild(itemElement);
        });

        return sectionElement;
    }

    createIconsSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-icons-section';

        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            const titleText = typeof section.title === 'function' ? section.title() : section.title;
            titleElement.textContent = titleText;
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

                // Support named separators with optional icon
                if (icon.text) {
                    const nameElement = document.createElement('div');
                    nameElement.className = 'context-menu-separator-name';

                    // Add icon if provided
                    if (icon.icon) {
                        const iconElement = document.createElement('i');
                        iconElement.className = icon.icon;
                        nameElement.appendChild(iconElement);
                    }

                    const textElement = document.createElement('span');
                    textElement.textContent = icon.text;
                    nameElement.appendChild(textElement);

                    separator.appendChild(nameElement);
                }

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

            // Disabled state - evaluate function if it's a function
            const isIconDisabled = typeof icon.disabled === 'function' ? icon.disabled() : icon.disabled;
            if (isIconDisabled) {
                iconElement.classList.add('disabled');
                iconElement.setAttribute('aria-disabled', 'true');
            }

            // Click handler
            if (icon.action && typeof icon.action === 'string') {
                iconElement.setAttribute('data-action', icon.action);
                iconElement.addEventListener('click', () => {
                    const isIconItemDisabled = typeof icon.disabled === 'function' ? icon.disabled() : icon.disabled;
                    if (!isIconItemDisabled) {
                        this.executeAction(icon.action, target, icon);
                        // Only hide menu if keepMenuOpen is not set to true
                        if (!icon.keepMenuOpen) {
                            this.hideMenu();
                        } else {
                            // If menu stays open, refresh the icon display
                            this.refreshIconDisplay(iconElement, icon, target);
                        }
                    }
                });
            }

            // Set data-state attribute if available (for toggle buttons)
            // Support both dataState and checked for flexibility
            if (icon.dataState) {
                iconElement.setAttribute('data-state', icon.dataState);
            } else if (this.itemWantsIndicator(icon)) {
                // If using checked instead of dataState, convert to dataState for consistent styling
                if (icon.checked === true) {
                    iconElement.setAttribute('data-state', 'on');
                } else {
                    iconElement.setAttribute('data-state', 'off');
                }
            }

            iconsContainer.appendChild(iconElement);
            icon._element = iconElement;
        });

        sectionElement.appendChild(iconsContainer);
        return sectionElement;
    }

    createGridSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-grid-section';

        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            const titleText = typeof section.title === 'function' ? section.title() : section.title;
            titleElement.textContent = titleText;
            sectionElement.appendChild(titleElement);
        }

        if (!section.items || !Array.isArray(section.items)) {
            console.warn('Grid section must have items array');
            return sectionElement;
        }

        const gridContainer = document.createElement('div');
        gridContainer.className = 'context-menu-grid-container';

        section.items.forEach((cell) => {
            if (cell.separator) {
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';
                separator.style.flexBasis = '100%';
                separator.style.height = '1px';
                gridContainer.appendChild(separator);
                return;
            }

            if (!this.shouldShowItem(cell)) {
                return;
            }

            if (cell.loadfn && typeof cell.loadfn === 'function') {
                try {
                    cell.loadfn(cell, target);
                } catch (error) {
                    console.error('Error executing grid cell loadfn:', error);
                }
            }

            const cellEl = this.createGridCellElement(cell, target, {
                submenuContext: false
            });
            if (cellEl) {
                cell._element = cellEl;
                gridContainer.appendChild(cellEl);
            }
        });

        sectionElement.appendChild(gridContainer);
        return sectionElement;
    }

    createGridCellElement(cell, target, options = {}) {
        const submenuContext = Boolean(options.submenuContext);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'context-menu-grid-btn';
        btn.setAttribute('role', 'menuitem');
        btn.tabIndex = 0;

        if (cell.swatchColor) {
            const sw = document.createElement('span');
            sw.className = 'context-menu-grid-swatch';
            sw.style.backgroundColor = typeof cell.swatchColor === 'function' ? cell.swatchColor(target) : cell.swatchColor;
            btn.appendChild(sw);
        }

        const imageUrl = cell.image != null
            ? (typeof cell.image === 'function' ? cell.image(target) : cell.image)
            : null;
        if (imageUrl) {
            const img = document.createElement('img');
            img.className = 'context-menu-grid-image';
            img.src = imageUrl;
            img.alt = typeof cell.imageAlt === 'function' ? cell.imageAlt(target) : (cell.imageAlt || '');
            img.loading = 'lazy';
            btn.classList.add('has-grid-image');
            btn.appendChild(img);
        } else if (cell.icon) {
            const ic = document.createElement('i');
            ic.className = typeof cell.icon === 'function' ? cell.icon(target) : cell.icon;
            btn.appendChild(ic);
        }

        if (this.itemWantsIndicator(cell)) {
            const indicatorStyle = this.getIndicatorStyle(cell) || 'box';
            const indicatorDot = document.createElement('span');
            indicatorDot.className = 'context-menu-item-indicator indicator-' + indicatorStyle;
            if (cell.checked === true || cell.dataState === 'on') {
                indicatorDot.classList.add('checked');
            }
            btn.appendChild(indicatorDot);
            btn.classList.add('has-toggle-indicator');
        }

        if (cell.tooltip !== undefined) {
            const tooltipValue = typeof cell.tooltip === 'function' ? cell.tooltip(target) : cell.tooltip;
            if (tooltipValue) {
                btn.title = tooltipValue;
            }
        }

        if (cell.className) {
            const classes = Array.isArray(cell.className) ? cell.className : cell.className.split(' ');
            classes.forEach((cls) => {
                if (cls) btn.classList.add(cls);
            });
        }

        const isDisabled = typeof cell.disabled === 'function' ? cell.disabled() : cell.disabled;
        if (isDisabled) {
            btn.classList.add('disabled');
            btn.setAttribute('aria-disabled', 'true');
        }

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        const runClick = () => {
            const isCellDisabled = typeof cell.disabled === 'function' ? cell.disabled() : cell.disabled;
            if (isCellDisabled) return;

            if (submenuContext && options.customHandler && typeof options.customHandler === 'function') {
                options.customHandler(cell, target);
            } else if (cell.action && typeof cell.action === 'string') {
                this.executeAction(cell.action, target, cell);
            }

            if (!cell.keepMenuOpen) {
                this.hideMenu();
            } else {
                if (submenuContext && this.currentSubmenuState) {
                    if (this.currentSubmenuState.optionsfn) {
                        this.refreshSubmenu();
                    } else {
                        this.refreshAllSubmenuItems();
                    }
                } else {
                    this.refreshSubmenuItemDisplay(btn, cell, target);
                }
            }
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            runClick();
        });

        return btn;
    }

    createCustomSection(section, target, sectionElement) {
        sectionElement.className += ' context-menu-custom-section';

        if (section.title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'context-menu-section-title';
            const titleText = typeof section.title === 'function' ? section.title() : section.title;
            titleElement.textContent = titleText;
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

    _cancelPendingHide() {
        this._hideSessionId += 1;
        if (this._hideCompleteTimer) {
            clearTimeout(this._hideCompleteTimer);
            this._hideCompleteTimer = null;
        }
        if (this._hideAnimationEndHandler && this.menu) {
            this.menu.removeEventListener('animationend', this._hideAnimationEndHandler);
            this._hideAnimationEndHandler = null;
        }
        return this._hideSessionId;
    }

    _clearContextOpenTargetClasses(target) {
        if (!target) return;
        target.classList.remove(
            'context-open',
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
            'center-left',
            'center-right',
            'center-top',
            'center-bottom',
            'center-center'
        );
    }

    _dismissForMenuSwitch() {
        if (!this.isOpen) return;

        const hideConfig = this.activeRootMenuConfig;
        const hideTarget = this.currentTarget;

        this._cancelPendingHide();
        this.isOpen = false;
        this._clearContextOpenTargetClasses(this.currentTarget);
        this.hideSubmenu();

        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
        this.clearHoverTimers();

        if (this.menu) {
            this.menu.classList.remove('context-menu-closing', 'context-menu-opening');
            this.menu.style.opacity = '';
        }

        this.currentTarget = null;
        this.activeRootMenuConfig = null;
        this.activeMenuTrigger = null;
        this.menuStack = [];
        if (this.menu) {
            this.menu.classList.remove('context-menu-click-triggered');
        }

        if (hideConfig && typeof hideConfig.onHide === 'function') {
            try {
                hideConfig.onHide(hideTarget);
            } catch (error) {
                console.error('Error executing context menu onHide:', error);
            }
        }
    }

    _playContextMenuOpenAnimation(menu) {
        menu.classList.remove('context-menu-closing', 'context-menu-opening');
        void menu.offsetWidth;
        menu.classList.add('context-menu-opening');

        let cleared = false;
        const clearOpening = () => {
            if (cleared) return;
            cleared = true;
            menu.classList.remove('context-menu-opening');
            menu.removeEventListener('animationend', onOpenEnd);
        };

        const onOpenEnd = (e) => {
            if (e.target !== menu || e.animationName !== 'contextMenuFadeIn') return;
            clearOpening();
        };

        menu.addEventListener('animationend', onOpenEnd);
        setTimeout(clearOpening, 260);
    }

    positionMenu(event, isTouch = false) {
        const menu = this.menu;
        const menuContent = menu.querySelector('.context-menu-content');
        const centerInViewport = this._nextMenuViewportCenter;
        this._nextMenuViewportCenter = false;

        // Check if we're on a small mobile screen (480px or less)
        const isSmallMobile = window.innerWidth <= 480;

        if (isSmallMobile) {
            // Show menu for small mobile screens
            menu.classList.remove('hidden');
            // CSS will handle centering
            menu.style.left = '';
            menu.style.top = '';
            this._playContextMenuOpenAnimation(menu);
            return;
        }

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Get click/touch position
        let clickX, clickY;
        if (isTouch && event.touches && event.touches[0]) {
            clickX = event.touches[0].clientX;
            clickY = event.touches[0].clientY;
        } else {
            clickX = event.clientX;
            clickY = event.clientY;
        }

        // Temporarily position menu off-screen to get real dimensions (like submenu)
        menu.classList.remove('hidden');
        menu.style.position = 'fixed';
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.style.opacity = '0';

        // Force layout calculation to get real dimensions
        const menuRect = menu.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const actualHeight = menuRect.height;
        const menuHeight = actualHeight > 0 ? actualHeight : 350; // Fallback

        let positioning;
        const config = this.getActiveMenuConfig(this.currentTarget);
        if (centerInViewport) {
            let x = (viewportWidth - menuWidth) / 2;
            let y = (viewportHeight - menuHeight) / 2;
            if (x < 10) x = 10;
            if (x + menuWidth > viewportWidth - 10) x = Math.max(10, viewportWidth - menuWidth - 10);
            if (y < 10) y = 10;
            if (y + menuHeight > viewportHeight - 10) y = Math.max(10, viewportHeight - menuHeight - 10);
            positioning = { x, y, vertical: 'down', horizontal: 'right' };
        } else if (config && (config.position === 'anchor' || this.activeMenuTrigger === 'click')) {
            const anchorEl = (config.anchorElement && typeof config.anchorElement === 'function')
                ? config.anchorElement(this.currentTarget)
                : this.currentTarget;
            const anchorRect = anchorEl.getBoundingClientRect();
            positioning = this.calculateAnchorPositioning(
                anchorRect,
                menuWidth,
                menuHeight,
                viewportWidth,
                viewportHeight,
                config.anchorAlign || 'start'
            );
        } else {
            positioning = this.calculatePositioning(clickX, clickY, menuWidth, menuHeight, viewportWidth, viewportHeight);
        }

        // Apply positioning classes BEFORE animation
        menu.className = menu.className.replace(/position-\w+/g, ''); // Remove existing position classes
        menu.classList.add(`position-${positioning.vertical}`, `position-${positioning.horizontal}`);

        // Apply final positioning
        menu.style.left = `${positioning.x}px`;
        menu.style.top = `${positioning.y}px`;
        menu.style.bottom = '';

        menu.style.opacity = '';

        this._playContextMenuOpenAnimation(menu);
    }

    calculateAnchorPositioning(anchorRect, menuWidth, menuHeight, viewportWidth, viewportHeight, align = 'start') {
        const gap = 4;
        let vertical = 'down';
        let y = anchorRect.bottom + gap;

        if (viewportHeight - anchorRect.bottom < menuHeight + 20 && anchorRect.top > menuHeight + 20) {
            vertical = 'up';
            y = anchorRect.top - menuHeight - gap;
        }

        let horizontal = align === 'end' ? 'left' : 'right';
        let x = align === 'end' ? anchorRect.right - menuWidth : anchorRect.left;

        if (x + menuWidth > viewportWidth - 10) {
            x = viewportWidth - menuWidth - 10;
            horizontal = 'left';
        }
        if (x < 10) x = 10;
        if (y + menuHeight > viewportHeight - 10) y = Math.max(10, viewportHeight - menuHeight - 10);
        if (y < 10) y = 10;

        return { x, y, vertical, horizontal };
    }

    calculatePositioning(clickX, clickY, menuWidth, menuHeight, viewportWidth, viewportHeight) {
        const spaceBelow = viewportHeight - clickY;
        const spaceRight = viewportWidth - clickX;

        // Determine vertical positioning
        let vertical = 'down';
        let y = clickY + 5;

        if (spaceBelow < menuHeight + 20) {
            vertical = 'up';
            y = clickY - menuHeight - 5;
        }

        // Determine horizontal positioning
        let horizontal = 'right';
        let x = clickX + 5;

        if (spaceRight < menuWidth + 10) {
            horizontal = 'left';
            x = clickX - menuWidth - 5;
        }

        // Ensure menu stays within viewport bounds
        if (x < 10) x = 10;
        if (x + menuWidth > viewportWidth - 10) x = viewportWidth - menuWidth - 10;

        // Vertical bounds checking
        if (y < 10) y = 10;
        if (y + menuHeight > viewportHeight - 10) y = viewportHeight - menuHeight - 10;

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
        const config = this.getActiveMenuConfig(target);

        if (config && config.onAction && typeof config.onAction === 'function') {
            config.onAction(action, target, item);
            return;
        }

        // Fallback to global event dispatch for backward compatibility
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

    refreshListItemDisplay(itemElement, item, target) {
        // Skip items with custom content - they manage their own updates
        if (item.content) {
            // For custom content, just call loadfn if it exists
            if (item.loadfn && typeof item.loadfn === 'function') {
                try {
                    item.loadfn(item, target);
                } catch (error) {
                    console.error('Error executing list item loadfn:', error);
                }
            }
            return;
        }

        if (itemElement.classList.contains('context-menu-grid-btn')) {
            this.refreshSubmenuItemDisplay(itemElement, item, target);
            return;
        }

        // Call loadfn to update item properties
        if (item.loadfn && typeof item.loadfn === 'function') {
            try {
                item.loadfn(item, target);
            } catch (error) {
                console.error('Error executing list item loadfn:', error);
                return;
            }
        }

        // Update icon if it exists
        const iconElement = itemElement.querySelector('i');
        if (item.icon) {
            const iconValue = typeof item.icon === 'function' ? item.icon(target) : item.icon;
            if (iconElement) {
                iconElement.className = iconValue;
            } else {
                // Create icon if it doesn't exist
                const newIconElement = document.createElement('i');
                newIconElement.className = iconValue;
                itemElement.insertBefore(newIconElement, itemElement.firstChild);
            }
        } else if (iconElement) {
            // Remove icon if it no longer exists
            iconElement.remove();
        }

        // Update text if it exists
        const textContainer = itemElement.querySelector('.context-menu-item-text-container');
        const textElement = textContainer
            ? textContainer.querySelector('.context-menu-item-text')
            : itemElement.querySelector('.context-menu-item-text');
        if (item.text) {
            const textValue = typeof item.text === 'function' ? item.text(target) : item.text;
            if (textElement) {
                textElement.textContent = textValue;
            } else {
                const newTextContainer = document.createElement('div');
                newTextContainer.className = 'context-menu-item-text-container';
                const newTextElement = document.createElement('span');
                newTextElement.className = 'context-menu-item-text';
                newTextElement.textContent = textValue;
                newTextContainer.appendChild(newTextElement);
                itemElement.appendChild(newTextContainer);
            }
        } else if (textElement) {
            // Remove text if it no longer exists
            if (textContainer) {
                textContainer.remove();
            } else {
                textElement.remove();
            }
        }

        // Update subtext if it exists
        if (item.subtext !== null && item.subtext !== undefined) {
            const activeTextContainer = itemElement.querySelector('.context-menu-item-text-container');
            if (activeTextContainer) {
                let subtextElement = activeTextContainer.querySelector('.context-menu-item-subtext');
                const subtextValue = typeof item.subtext === 'function' ? item.subtext(target) : item.subtext;
                if (subtextElement) {
                    subtextElement.textContent = subtextValue;
                } else {
                    subtextElement = document.createElement('span');
                    subtextElement.className = 'context-menu-item-subtext';
                    subtextElement.textContent = subtextValue;
                    activeTextContainer.appendChild(subtextElement);
                }
            }
        } else {
            const activeTextContainer = itemElement.querySelector('.context-menu-item-text-container');
            const subtextElement = activeTextContainer ? activeTextContainer.querySelector('.context-menu-item-subtext') : null;
            if (subtextElement) {
                subtextElement.remove();
            }
        }

        // Update badge if it exists
        const badgeElement = itemElement.querySelector('.context-menu-item-badge');
        if (item.badge !== null && item.badge !== undefined) {
            const badgeValue = typeof item.badge === 'function' ? item.badge(target) : String(item.badge);
            if (badgeElement) {
                badgeElement.textContent = badgeValue;
            } else {
                const newBadgeElement = document.createElement('span');
                newBadgeElement.className = 'context-menu-item-badge';
                newBadgeElement.textContent = badgeValue;
                itemElement.appendChild(newBadgeElement);
            }
        } else if (badgeElement) {
            badgeElement.remove();
        }

        // Update tooltip if it exists
        if (item.tooltip !== undefined) {
            const tooltipValue = typeof item.tooltip === 'function' ? item.tooltip(target) : item.tooltip;
            if (tooltipValue) {
                itemElement.title = tooltipValue;
            } else {
                itemElement.removeAttribute('title');
            }
        }

        // Update className if it exists
        if (item.className) {
            // Remove old className from item element
            itemElement.classList.remove('text-success', 'text-danger', 'text-warning', 'text-info');
            // Add new className (handle both string and array)
            const classes = Array.isArray(item.className) ? item.className : [item.className];
            classes.forEach(cls => {
                if (cls) itemElement.classList.add(cls);
            });
        }

        // Update disabled state - evaluate function if it's a function
        const isItemDisabled = typeof item.disabled === 'function' ? item.disabled() : item.disabled;
        if (isItemDisabled) {
            itemElement.classList.add('disabled');
            itemElement.setAttribute('aria-disabled', 'true');
        } else {
            itemElement.classList.remove('disabled');
            itemElement.removeAttribute('aria-disabled');
        }

        // Update indicator dot for toggle items
        this.applyItemHighlightAndIndicator(itemElement, item);

        // Update value display for submenu items
        if ((item.submenu && Array.isArray(item.submenu)) || item.optionsfn) {
            if (item.valueDisplay) {
                let valueDisplayElement = itemElement.querySelector('.context-menu-item-value');
                if (!valueDisplayElement) {
                    valueDisplayElement = document.createElement('span');
                    valueDisplayElement.className = 'context-menu-item-value';
                    const arrowElement = itemElement.querySelector('.context-menu-submenu-arrow');
                    if (arrowElement) {
                        itemElement.insertBefore(valueDisplayElement, arrowElement);
                    } else {
                        itemElement.appendChild(valueDisplayElement);
                    }
                }
                const valueDisplayContent = typeof item.valueDisplay === 'function' ? item.valueDisplay(target) : item.valueDisplay;
                if (typeof valueDisplayContent === 'string') {
                    valueDisplayElement.innerHTML = valueDisplayContent;
                } else if (valueDisplayContent instanceof HTMLElement) {
                    valueDisplayElement.innerHTML = '';
                    valueDisplayElement.appendChild(valueDisplayContent);
                } else {
                    valueDisplayElement.textContent = valueDisplayContent || '';
                }
            }
        }
    }

    updateItemIndicatorDot(itemElement, item) {
        this.applyItemHighlightAndIndicator(itemElement, item);
    }

    refreshSubmenuItemDisplay(subItemElement, subItem, target) {
        // Skip items with custom content - they manage their own updates
        if (subItem.content) {
            // For custom content, just call loadfn if it exists
            if (subItem.loadfn && typeof subItem.loadfn === 'function') {
                try {
                    subItem.loadfn(subItem, target);
                } catch (error) {
                    console.error('Error executing submenu item loadfn:', error);
                }
            }
            return;
        }

        if (subItemElement.classList.contains('context-menu-grid-btn')) {
            if (subItem.loadfn && typeof subItem.loadfn === 'function') {
                try {
                    subItem.loadfn(subItem, target);
                } catch (error) {
                    console.error('Error executing submenu item loadfn:', error);
                }
            }
            const isSubItemRefreshDisabled = typeof subItem.disabled === 'function' ? subItem.disabled() : subItem.disabled;
            if (isSubItemRefreshDisabled) {
                subItemElement.classList.add('disabled');
                subItemElement.setAttribute('aria-disabled', 'true');
            } else {
                subItemElement.classList.remove('disabled');
                subItemElement.removeAttribute('aria-disabled');
            }
            this.updateItemIndicatorDot(subItemElement, subItem);
            const sw = subItemElement.querySelector('.context-menu-grid-swatch');
            if (sw && subItem.swatchColor !== undefined && subItem.swatchColor !== null) {
                sw.style.backgroundColor = typeof subItem.swatchColor === 'function' ? subItem.swatchColor(target) : subItem.swatchColor;
            }
            const imageUrl = subItem.image != null
                ? (typeof subItem.image === 'function' ? subItem.image(target) : subItem.image)
                : null;
            const img = subItemElement.querySelector('.context-menu-grid-image');
            if (imageUrl) {
                if (img) {
                    if (img.getAttribute('src') !== imageUrl) img.setAttribute('src', imageUrl);
                } else {
                    const newImg = document.createElement('img');
                    newImg.className = 'context-menu-grid-image';
                    newImg.src = imageUrl;
                    newImg.alt = typeof subItem.imageAlt === 'function' ? subItem.imageAlt(target) : (subItem.imageAlt || '');
                    newImg.loading = 'lazy';
                    subItemElement.insertBefore(newImg, subItemElement.firstChild);
                }
                subItemElement.classList.add('has-grid-image');
                if (subItem.className && String(subItem.className).includes('prompt-ctx-fav-grid-cell')) {
                    subItemElement.classList.add('prompt-ctx-fav-grid-cell');
                }
                const ic = subItemElement.querySelector('i');
                if (ic) ic.remove();
            } else {
                if (img) img.remove();
                subItemElement.classList.remove('has-grid-image');
                const ic = subItemElement.querySelector('i');
                if (subItem.icon) {
                    const iconValue = typeof subItem.icon === 'function' ? subItem.icon(target) : subItem.icon;
                    if (ic) {
                        ic.className = iconValue;
                    } else {
                        const newIcon = document.createElement('i');
                        newIcon.className = iconValue;
                        subItemElement.insertBefore(newIcon, subItemElement.firstChild);
                    }
                } else if (ic) {
                    ic.remove();
                }
            }
            return;
        }

        // Call loadfn to update subItem properties
        if (subItem.loadfn && typeof subItem.loadfn === 'function') {
            try {
                subItem.loadfn(subItem, target);
            } catch (error) {
                console.error('Error executing submenu item loadfn:', error);
                return;
            }
        }

        // Update icon if it exists
        const iconElement = subItemElement.querySelector('i');
        if (subItem.icon) {
            const iconValue = typeof subItem.icon === 'function' ? subItem.icon(target) : subItem.icon;
            if (iconElement) {
                iconElement.className = iconValue;
            } else {
                // Create icon if it doesn't exist
                const newIconElement = document.createElement('i');
                newIconElement.className = iconValue;
                subItemElement.insertBefore(newIconElement, subItemElement.firstChild);
            }
        } else if (iconElement) {
            // Remove icon if it no longer exists
            iconElement.remove();
        }

        // Update text if it exists
        const textContainer = subItemElement.querySelector('.context-menu-item-text-container');
        const textElement = textContainer
            ? textContainer.querySelector('.context-menu-item-text')
            : subItemElement.querySelector('.context-menu-item-text');

        if (subItem.text) {
            const textValue = typeof subItem.text === 'function' ? subItem.text(target) : subItem.text;
            if (textElement) {
                textElement.textContent = textValue;
            }
        }

        // Update subtext if it exists
        if (subItem.subtext && textContainer) {
            const subtextElement = textContainer.querySelector('.context-menu-item-subtext');
            const subtextValue = typeof subItem.subtext === 'function' ? subItem.subtext(target) : subItem.subtext;
            if (subtextElement) {
                subtextElement.textContent = subtextValue;
            }
        }

        // Update badge if it exists
        const badgeElement = subItemElement.querySelector('.context-menu-item-badge');
        if (subItem.badge !== null && subItem.badge !== undefined) {
            const badgeValue = typeof subItem.badge === 'function' ? subItem.badge(target) : String(subItem.badge);
            if (badgeElement) {
                badgeElement.textContent = badgeValue;
            } else {
                const newBadgeElement = document.createElement('span');
                newBadgeElement.className = 'context-menu-item-badge';
                newBadgeElement.textContent = badgeValue;
                subItemElement.appendChild(newBadgeElement);
            }
        } else if (badgeElement) {
            // Remove badge if it no longer exists
            badgeElement.remove();
        }

        // Update className if it exists
        if (subItem.className) {
            // Remove old className from subItem element
            subItemElement.classList.remove('text-success', 'text-danger', 'text-warning', 'text-info');
            // Add new className (handle both string and array)
            const classes = Array.isArray(subItem.className) ? subItem.className : [subItem.className];
            classes.forEach(cls => {
                if (cls) subItemElement.classList.add(cls);
            });
        }

        // Update disabled state - evaluate function if it's a function
        const isSubItemRefreshDisabled = typeof subItem.disabled === 'function' ? subItem.disabled() : subItem.disabled;
        if (isSubItemRefreshDisabled) {
            subItemElement.classList.add('disabled');
            subItemElement.setAttribute('aria-disabled', 'true');
        } else {
            subItemElement.classList.remove('disabled');
            subItemElement.removeAttribute('aria-disabled');
        }

        // Update indicator dot for toggle items
        this.updateItemIndicatorDot(subItemElement, subItem);
    }

    updateIndicatorDots(config) {
        if (!config.sections || !Array.isArray(config.sections)) return;

        config.sections.forEach((section) => {
            if (section.type === 'list' && section.items && Array.isArray(section.items)) {
                section.items.forEach((item) => {
                    if (this.itemWantsIndicator(item) && item._element) {
                        this.updateItemIndicatorDot(item._element, item);
                    }
                });
            }
            if (section.type === 'grid' && section.items && Array.isArray(section.items)) {
                section.items.forEach((cell) => {
                    if (cell.separator || !cell._element) return;
                    if (this.itemWantsIndicator(cell)) {
                        this.updateItemIndicatorDot(cell._element, cell);
                    }
                });
            }
        });
    }

    refreshIconDisplay(iconElement, icon, target) {
        // Call loadfn to update icon properties
        if (icon.loadfn && typeof icon.loadfn === 'function') {
            try {
                icon.loadfn(icon, target);
            } catch (error) {
                console.error('Error executing icon loadfn:', error);
                return;
            }
        }

        // Update icon
        const iconClass = iconElement.querySelector('i');
        if (icon.icon) {
            const iconValue = typeof icon.icon === 'function' ? icon.icon(target) : icon.icon;
            if (iconClass) {
                iconClass.className = iconValue;
            } else {
                // Create icon if it doesn't exist
                const newIconClass = document.createElement('i');
                newIconClass.className = iconValue;
                iconElement.appendChild(newIconClass);
            }
        } else if (iconClass) {
            // Remove icon if it no longer exists
            iconClass.remove();
        }

        // Update tooltip
        if (icon.tooltip) {
            const tooltipValue = typeof icon.tooltip === 'function' ? icon.tooltip(target) : icon.tooltip;
            iconElement.title = tooltipValue;
        } else {
            iconElement.removeAttribute('title');
        }

        // Update data-state attribute if available
        // Support both dataState and checked for flexibility
        if (icon.dataState) {
            iconElement.setAttribute('data-state', icon.dataState);
        } else if (this.itemWantsIndicator(icon)) {
            // If using checked instead of dataState, convert to dataState for consistent styling
            if (icon.checked === true) {
                iconElement.setAttribute('data-state', 'on');
            } else {
                iconElement.setAttribute('data-state', 'off');
            }
        } else {
            iconElement.removeAttribute('data-state');
        }

        // Update disabled state - evaluate function if it's a function
        const isIconItemDisabled = typeof icon.disabled === 'function' ? icon.disabled() : icon.disabled;
        if (isIconItemDisabled) {
            iconElement.classList.add('disabled');
            iconElement.setAttribute('aria-disabled', 'true');
        } else {
            iconElement.classList.remove('disabled');
            iconElement.removeAttribute('aria-disabled');
        }
    }

    /**
     * Open bulk gallery menu centered, with the Move-to-workspace submenu already expanded.
     * @param {HTMLElement} galleryElement — element with bulk context menu attached (e.g. #gallery)
     */
    openBulkActionsMoveSubmenuCentered(galleryElement) {
        if (!galleryElement || !galleryElement.dataset.contextMenu) return;
        if (this.isOpen) {
            this.hideMenu();
        }
        this._nextMenuViewportCenter = true;
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const ev = { clientX: cx, clientY: cy, touches: [{ clientX: cx, clientY: cy }] };
        this.showMenu(ev, galleryElement, false, false);
        const openMove = () => {
            const items = this.menu.querySelectorAll('.context-menu-item.has-submenu');
            for (let i = 0; i < items.length; i++) {
                const el = items[i];
                const textEl = el.querySelector('.context-menu-item-text');
                const label = textEl ? textEl.textContent.trim() : '';
                if (label.startsWith('Move to') && el._optionsfn) {
                    const opts = el._optionsfn(this.currentTarget);
                    if (opts && opts.length) {
                        this.showSubmenu(el, opts, this.currentTarget, el._handlerfn);
                    }
                    break;
                }
            }
        };
        requestAnimationFrame(() => requestAnimationFrame(openMove));
    }

    hideMenu() {
        if (!this.isOpen) return;

        if (this.menuStack.length > 0) {
            this._cancelPendingHide();
            this._clearContextOpenTargetClasses(this.currentTarget);
            this.hideSubmenu();
            if (this.touchTimer) {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
            }
            this.clearHoverTimers();
            this.restoreParentMenuFromStack();
            return;
        }

        const hideSession = this._cancelPendingHide();

        const hideConfig = this.activeRootMenuConfig;
        const hideTarget = this.currentTarget;
        const menu = this.menu;
        const overlay = this.overlay;

        this.isOpen = false;

        this._clearContextOpenTargetClasses(this.currentTarget);

        this.hideSubmenu();

        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }

        this.clearHoverTimers();

        const finishHide = () => {
            if (hideSession !== this._hideSessionId) return;

            menu.classList.remove('context-menu-closing', 'context-menu-opening');
            menu.style.opacity = '';
            menu.classList.add('hidden');
            overlay.classList.add('hidden');
            this.currentTarget = null;
            this.activeRootMenuConfig = null;
            this.activeMenuTrigger = null;
            this.menuStack = [];
            if (this.menu) {
                this.menu.classList.remove('context-menu-click-triggered');
            }

            if (typeof explorerApplet !== 'undefined' && explorerApplet) {
                explorerApplet._contextMenuTarget = null;
            }

            if (hideConfig && typeof hideConfig.onHide === 'function') {
                try {
                    hideConfig.onHide(hideTarget);
                } catch (error) {
                    console.error('Error executing context menu onHide:', error);
                }
            }
        };

        if (menu.classList.contains('hidden')) {
            finishHide();
            return;
        }

        menu.classList.remove('context-menu-opening');
        menu.style.opacity = '';
        menu.classList.add('context-menu-closing');
        overlay.classList.add('hidden');

        let finished = false;
        const completeHide = () => {
            if (finished || hideSession !== this._hideSessionId) return;
            finished = true;
            if (this._hideAnimationEndHandler) {
                menu.removeEventListener('animationend', this._hideAnimationEndHandler);
                this._hideAnimationEndHandler = null;
            }
            if (this._hideCompleteTimer) {
                clearTimeout(this._hideCompleteTimer);
                this._hideCompleteTimer = null;
            }
            finishHide();
        };

        this._hideAnimationEndHandler = (e) => {
            if (e.target !== menu || e.animationName !== 'contextMenuFadeOut') return;
            completeHide();
        };

        menu.addEventListener('animationend', this._hideAnimationEndHandler);
        this._hideCompleteTimer = setTimeout(completeHide, 300);
    }

    addSubmenuHoverSupport(itemElement, item, target) {
        // Mouse enter - start timer to open submenu
        itemElement.addEventListener('mouseenter', () => {
            this.clearHoverTimers();

            this.hoverTimers.openTimer = setTimeout(() => {
                const isHoverItemDisabled = typeof item.disabled === 'function' ? item.disabled() : item.disabled;
                if (!isHoverItemDisabled) {
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

        // Mouse leave - start timer to close submenu (but submenu hover will cancel it)
        itemElement.addEventListener('mouseleave', (e) => {
            // Check if mouse is moving to the submenu
            const relatedTarget = e.relatedTarget;
            if (relatedTarget && this.currentSubmenu && this.currentSubmenu.contains(relatedTarget)) {
                // Mouse is moving to submenu, don't close
                return;
            }

            // Mouse is leaving parent item, start close timer
            this.clearHoverTimers();
            this.hoverTimers.closeTimer = setTimeout(() => {
                this.hideSubmenu();
            }, this.hoverSettings.closeDelay);
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

    attachClickMenuToElement(element, config) {
        if (!element || !config) return;

        const configId = 'click-menu-config-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.clickMenuConfigs = this.clickMenuConfigs || {};
        this.clickMenuConfigs[configId] = config;

        element.setAttribute('data-click-menu', configId);
    }

    detachClickMenuFromElement(element) {
        if (!element) return;

        const configId = element.dataset.clickMenu;
        if (configId && this.clickMenuConfigs) {
            delete this.clickMenuConfigs[configId];
        }

        element.removeAttribute('data-click-menu');
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

        // Store submenu state for refreshing all items when toggling
        this.currentSubmenuState = {
            parentItem: parentItem,
            submenuItems: submenuItems,
            target: target,
            customHandler: customHandler,
            optionsfn: parentItem._optionsfn,
            handlerfn: customHandler || parentItem._handlerfn
        };

        // Create submenu container
        const submenu = document.createElement('div');
        submenu.className = 'context-menu-submenu';

        // Create submenu items
        submenuItems.forEach((subItem) => {
            // Filter submenu items based on mobile/desktop visibility (same as main menu items)
            if (!this.shouldShowItem(subItem)) {
                return;
            }

            if (subItem.separator) {
                const separator = document.createElement('div');
                separator.className = 'context-menu-separator';

                // Support named separators with optional icon
                if (subItem.text) {
                    const nameElement = document.createElement('div');
                    nameElement.className = 'context-menu-separator-name';

                    // Add icon if provided
                    if (subItem.icon) {
                        const iconElement = document.createElement('i');
                        iconElement.className = subItem.icon;
                        nameElement.appendChild(iconElement);
                    }

                    const textElement = document.createElement('span');
                    textElement.textContent = subItem.text;
                    nameElement.appendChild(textElement);

                    separator.appendChild(nameElement);
                }

                submenu.appendChild(separator);
                return;
            }

            if (subItem.type === 'grid' && Array.isArray(subItem.items)) {
                const gridWrap = document.createElement('div');
                gridWrap.className = 'context-menu-submenu-grid';
                if (subItem.className) {
                    const gridClasses = Array.isArray(subItem.className) ? subItem.className : subItem.className.split(' ');
                    gridClasses.forEach((cls) => {
                        if (cls) gridWrap.classList.add(cls);
                    });
                }
                if (subItem.title) {
                    const titleElement = document.createElement('div');
                    titleElement.className = 'context-menu-section-title';
                    const titleText = typeof subItem.title === 'function' ? subItem.title() : subItem.title;
                    titleElement.textContent = titleText;
                    gridWrap.appendChild(titleElement);
                }
                const gridInner = document.createElement('div');
                gridInner.className = 'context-menu-grid-container';
                if (gridWrap.classList.contains('prompt-ctx-fav-grid')) {
                    gridInner.classList.add('prompt-ctx-fav-grid-inner');
                }

                subItem.items.forEach((cell) => {
                    if (cell.separator) {
                        const sep = document.createElement('div');
                        sep.className = 'context-menu-separator';
                        sep.style.flexBasis = '100%';
                        sep.style.height = '1px';
                        gridInner.appendChild(sep);
                        return;
                    }
                    if (!this.shouldShowItem(cell)) {
                        return;
                    }
                    if (cell.loadfn && typeof cell.loadfn === 'function') {
                        try {
                            cell.loadfn(cell, target);
                        } catch (error) {
                            console.error('Error executing submenu grid cell loadfn:', error);
                        }
                    }
                    const cellEl = this.createGridCellElement(cell, target, {
                        submenuContext: true,
                        customHandler
                    });
                    if (cellEl) {
                        cell._element = cellEl;
                        gridInner.appendChild(cellEl);
                    }
                });

                gridWrap.appendChild(gridInner);
                submenu.appendChild(gridWrap);
                subItem._element = gridWrap;
                return;
            }

            // Call loadfn if it exists to update subItem properties before rendering
            if (subItem.loadfn && typeof subItem.loadfn === 'function') {
                try {
                    subItem.loadfn(subItem, target);
                } catch (error) {
                    console.error('Error executing submenu item loadfn:', error);
                }
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
                    // If subtext exists, wrap both in a container for proper layout
                    if (subItem.subtext) {
                        const textContainer = document.createElement('div');
                        textContainer.className = 'context-menu-item-text-container';

                        const textElement = document.createElement('span');
                        textElement.className = 'context-menu-item-text';
                        textElement.textContent = subItem.text;
                        textContainer.appendChild(textElement);

                        const subtextElement = document.createElement('span');
                        subtextElement.className = 'context-menu-item-subtext';
                        subtextElement.textContent = subItem.subtext;
                        textContainer.appendChild(subtextElement);

                        subItemElement.appendChild(textContainer);
                    } else {
                        const textElement = document.createElement('span');
                        textElement.className = 'context-menu-item-text';
                        textElement.textContent = subItem.text;
                        subItemElement.appendChild(textElement);
                    }
                }

                // Badge support (e.g., for index numbers)
                if (subItem.badge !== null && subItem.badge !== undefined) {
                    const badgeElement = document.createElement('span');
                    badgeElement.className = 'context-menu-item-badge';
                    badgeElement.textContent = subItem.badge;
                    subItemElement.appendChild(badgeElement);
                }
            }

            // Indicator for toggles / selection (box or dot) or row highlight
            this.applyItemHighlightAndIndicator(subItemElement, subItem);

            // Apply className if it exists
            if (subItem.className) {
                const classes = Array.isArray(subItem.className) ? subItem.className : subItem.className.split(' ');
                classes.forEach(cls => {
                    if (cls) subItemElement.classList.add(cls);
                });
            }

            // Apply tooltip if it exists
            if (subItem.tooltip !== undefined) {
                const tooltipValue = typeof subItem.tooltip === 'function' ? subItem.tooltip(target) : subItem.tooltip;
                if (tooltipValue) {
                    subItemElement.title = tooltipValue;
                }
            }

            // Disabled state - evaluate function if it's a function
            const isSubItemDisabled = typeof subItem.disabled === 'function' ? subItem.disabled() : subItem.disabled;
            if (isSubItemDisabled) {
                subItemElement.classList.add('disabled');
                subItemElement.setAttribute('aria-disabled', 'true');
            }

            // Prevent focus transfer on mousedown
            subItemElement.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });

            // Click handler
            if (customHandler && typeof customHandler === 'function') {
                subItemElement.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent click from bubbling to click-outside handler
                    const isSubItemClickDisabled = typeof subItem.disabled === 'function' ? subItem.disabled() : subItem.disabled;
                    if (!isSubItemClickDisabled) {
                        const runHandler = () => {
                            try {
                                const result = customHandler(subItem, target, e);
                                if (result && typeof result.then === 'function') {
                                    result.catch(err => console.error('Context submenu handler error:', err));
                                }
                            } catch (err) {
                                console.error('Context submenu handler error:', err);
                            }
                        };
                        runHandler();
                        // Only hide menu if keepMenuOpen is not set to true
                        if (!subItem.keepMenuOpen) {
                            this.hideMenu();
                        } else {
                            // If menu stays open, check if this is a dynamic submenu (optionsfn) or static submenu
                            // For static submenus, just refresh items (call loadfn again)
                            // For dynamic submenus (optionsfn), regenerate the entire submenu
                            // If not in a submenu at all, just refresh the item display
                            if (this.currentSubmenuState) {
                                if (this.currentSubmenuState.optionsfn) {
                                    // Dynamic submenu - regenerate from optionsfn
                                    this.refreshSubmenu();
                                } else {
                                    // Static submenu - just refresh items (call loadfn again)
                                    this.refreshAllSubmenuItems();
                                }
                            } else {
                                // Not in a submenu - just refresh this item's display
                                // This shouldn't happen for submenu items, but handle it gracefully
                                this.refreshListItemDisplay(subItemElement, subItem, target);
                            }
                        }
                    }
                });
            } else if (subItem.action && typeof subItem.action === 'string') {
                subItemElement.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent click from bubbling to click-outside handler
                    const isSubItemActionDisabled = typeof subItem.disabled === 'function' ? subItem.disabled() : subItem.disabled;
                    if (!isSubItemActionDisabled) {
                        this.executeAction(subItem.action, target, subItem);
                        // Only hide menu if keepMenuOpen is not set to true
                        if (!subItem.keepMenuOpen) {
                            this.hideMenu();
                        } else {
                            // If menu stays open, check if this is a dynamic submenu (optionsfn) or static submenu
                            // For static submenus, just refresh items (call loadfn again)
                            // For dynamic submenus (optionsfn), regenerate the entire submenu
                            // If not in a submenu at all, just refresh the item display
                            if (this.currentSubmenuState) {
                                if (this.currentSubmenuState.optionsfn) {
                                    // Dynamic submenu - regenerate from optionsfn
                                    this.refreshSubmenu();
                                } else {
                                    // Static submenu - just refresh items (call loadfn again)
                                    this.refreshAllSubmenuItems();
                                }
                            } else {
                                // Not in a submenu - just refresh this item's display
                                // This shouldn't happen for submenu items, but handle it gracefully
                                this.refreshListItemDisplay(subItemElement, subItem, target);
                            }
                        }
                    }
                });
            }

            // Store reference to DOM element on subItem for later updates
            subItem._element = subItemElement;
            this.wireItemContextMenu(subItemElement, subItem, target);

            submenu.appendChild(subItemElement);
        });

        if (submenu.querySelector('.prompt-ctx-fav-grid')) {
            submenu.classList.add('prompt-ctx-fav-submenu');
        }

        // Position the submenu (this also sets opacity to 1)
        this.positionSubmenu(submenu, parentItem);

        this.currentSubmenu = submenu;

        // Add hover support to submenu to keep it open when mouse is over it
        if (!this.isMobile()) {
            submenu.addEventListener('mouseenter', () => {
                // Cancel any close timer when mouse enters submenu
                this.clearHoverTimers();
            });

            submenu.addEventListener('mouseleave', (e) => {
                // Check if mouse is moving back to parent item
                const relatedTarget = e.relatedTarget;
                if (relatedTarget && parentItem.contains(relatedTarget)) {
                    // Mouse is moving back to parent, don't close
                    return;
                }

                // Mouse is leaving submenu, start close timer
                this.clearHoverTimers();
                this.hoverTimers.closeTimer = setTimeout(() => {
                    this.hideSubmenu();
                }, this.hoverSettings.closeDelay);
            });
        }

        // Add click outside handler for submenu
        const submenuClickHandler = (e) => {
            // Only handle clicks that are actually outside the submenu
            if (!submenu.contains(e.target) && !parentItem.contains(e.target)) {
                e.stopPropagation(); // Prevent bubbling to overlay handlers
                // On mobile, don't close submenu on outside click - keep it open
                // On desktop, close it
                if (!this.isMobile()) {
                    this.hideSubmenu();
                }
            }
        };

        document.addEventListener('click', submenuClickHandler);
        this.submenuClickHandler = submenuClickHandler;
    }

    refreshAllSubmenuItems() {
        if (!this.currentSubmenuState || !this.currentSubmenu) return;

        const { submenuItems, target } = this.currentSubmenuState;

        // Call loadfn for all submenu items (including nested grid cells)
        submenuItems.forEach((subItem) => {
            if (subItem.separator) return;

            if (subItem.type === 'grid' && Array.isArray(subItem.items)) {
                subItem.items.forEach((cell) => {
                    if (cell.separator || !cell._element) return;
                    this.refreshSubmenuItemDisplay(cell._element, cell, target);
                });
                return;
            }

            if (!subItem._element) return;

            // Call loadfn to update subItem properties
            if (subItem.loadfn && typeof subItem.loadfn === 'function') {
                try {
                    subItem.loadfn(subItem, target);
                } catch (error) {
                    console.error('Error executing submenu item loadfn:', error);
                }
            }

            // Refresh the display of this submenu item
            this.refreshSubmenuItemDisplay(subItem._element, subItem, target);
        });
    }

    hideSubmenu() {
        if (this.currentSubmenu) {
            this.currentSubmenu.remove();
            this.currentSubmenu = null;
        }

        // Clear submenu state
        this.currentSubmenuState = null;

        // Remove active state from any parent items
        const activeItems = this.menu.querySelectorAll('.context-menu-item.keyboard-selected');
        activeItems.forEach(item => item.classList.remove('keyboard-selected'));

        if (this.submenuClickHandler) {
            document.removeEventListener('click', this.submenuClickHandler);
            this.submenuClickHandler = null;
        }
    }

    positionSubmenu(submenu, parentItem) {
        // Get parent and viewport information
        const parentRect = parentItem.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const isMobile = viewportWidth < 768;

        // Temporarily position submenu off-screen to get real dimensions
        submenu.style.position = 'fixed';
        submenu.style.left = '-9999px';
        submenu.style.top = '-9999px';
        submenu.style.opacity = '0';

        // Add to document body temporarily to get dimensions
        document.body.appendChild(submenu);

        // Force layout calculation to get real dimensions
        const submenuRect = submenu.getBoundingClientRect();
        const submenuWidth = submenuRect.width;
        const submenuHeight = submenuRect.height;

        // Calculate positioning using real dimensions
        const parentCenterX = parentRect.left + (parentRect.width / 2);
        const parentCenterY = parentRect.top + (parentRect.height / 2);

        // Calculate available space correctly
        const spaceBelow = viewportHeight - parentRect.bottom;
        const spaceAbove = parentRect.top;

        // Determine vertical positioning with real dimensions
        let vertical = 'down';
        const minSpaceNeeded = submenuHeight + 20;

        if (spaceBelow < minSpaceNeeded && spaceAbove >= minSpaceNeeded) {
            vertical = 'up';
        } else if (spaceBelow < minSpaceNeeded && spaceAbove < minSpaceNeeded) {
            vertical = 'down'; // Prefer below even if cramped
        }

        // Calculate final positions with real dimensions
        let submenuX, submenuY, submenuDirection;

        // Vertical positioning - align with parent content area
        if (vertical === 'down') {
            // Position below parent, accounting for parent's visual alignment
            submenuY = parentRect.top + 2;
            submenuDirection = 'below';
        } else {
            // Position above parent, ensuring proper visual alignment
            submenuY = parentRect.bottom - submenuHeight;
            submenuDirection = 'above';
        }

        // Horizontal positioning
        if (isMobile) {
            submenuX = parentCenterX - (submenuWidth / 2);
            submenuDirection += '-mobile';
        } else {
            submenuX = parentRect.right + 2;
            submenuDirection = 'right';

            // Check if submenu would go off the right edge
            if (submenuX + submenuWidth > viewportWidth - 10) {
                submenuX = parentRect.left - submenuWidth - 2;
                submenuDirection = 'left';
            }
        }

        // Ensure submenu stays within viewport bounds
        if (submenuY < 10) {
            submenuY = 10;
        }
        if (submenuY + submenuHeight > viewportHeight - 10) {
            submenuY = viewportHeight - submenuHeight - 10;
        }
        if (submenuX < 10) {
            submenuX = 10;
        }
        if (submenuX + submenuWidth > viewportWidth - 10) {
            submenuX = viewportWidth - submenuWidth - 10;
        }

        // Position submenu with correct coordinates and add direction class
        submenu.style.left = `${submenuX}px`;
        submenu.style.top = `${submenuY}px`;
        submenu.classList.add(`submenu-${submenuDirection}`);

        // Make submenu visible
        submenu.style.opacity = '1';
    }

    refreshSubmenu() {
        if (!this.currentSubmenuState) return;

        // Preserve state before showSubmenu clears it
        const state = { ...this.currentSubmenuState };
        const { parentItem, target, customHandler, submenuItems: oldSubmenuItems } = state;

        // Get optionsfn from the parent item or use stored one
        const getOptionsFn = state.optionsfn || parentItem._optionsfn;
        if (!getOptionsFn || typeof getOptionsFn !== 'function') return;

        // Call optionsfn to get new submenu items
        const newSubmenuItems = getOptionsFn(target);

        if (newSubmenuItems && Array.isArray(newSubmenuItems)) {
            // Preserve loadfn from old items to new items by matching actions
            // This allows indicators to refresh correctly
            if (oldSubmenuItems && Array.isArray(oldSubmenuItems)) {
                const oldItemsMap = new Map();
                oldSubmenuItems.forEach(oldItem => {
                    if (oldItem.action && oldItem.loadfn) {
                        oldItemsMap.set(oldItem.action, oldItem.loadfn);
                    }
                });

                // Apply loadfn to new items if they have the same action
                newSubmenuItems.forEach(newItem => {
                    if (newItem.action && oldItemsMap.has(newItem.action)) {
                        newItem.loadfn = oldItemsMap.get(newItem.action);
                    }
                });
            }

            // Temporarily remove click handler to prevent closing during refresh
            const oldClickHandler = this.submenuClickHandler;
            if (oldClickHandler) {
                document.removeEventListener('click', oldClickHandler);
            }

            // Remove current submenu but preserve state
            if (this.currentSubmenu) {
                this.currentSubmenu.remove();
            }
            this.currentSubmenu = null;

            // Show new submenu with updated items (this will set new state)
            this.showSubmenu(parentItem, newSubmenuItems, target, state.handlerfn || customHandler || parentItem._handlerfn);

            // Recalculate position after refresh (height may have changed)
            if (this.currentSubmenu && parentItem) {
                this.positionSubmenu(this.currentSubmenu, parentItem);
            }

            // Refresh all submenu items to update indicators and other dynamic properties
            // This ensures loadfn is called for items that need their state refreshed
            this.refreshAllSubmenuItems();
        }
    }

    destroy() {
        if (this.menu && this.menu.parentNode) {
            this.menu.parentNode.removeChild(this.menu);
        }
        this.hideMenu();
    }
}

// Global singleton — bare `contextMenu` in other classic scripts resolves via window
window.contextMenu = new ContextMenuController();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContextMenuController;
    module.exports.contextMenu = window.contextMenu;
}

/*
INITFN AND LOADFN USAGE:

The context menu system supports two types of initialization functions:

1. initfn - Called BEFORE rendering
   - Use to dynamically generate items, icons, or content
   - Perfect for populating section.items or section.icons arrays
   - Runs before the DOM elements are created

2. loadfn - Called AFTER rendering
   - Use to update properties of already-rendered elements
   - Perfect for updating icons, text, or disabled states
   - Runs after DOM elements exist

INITFN EXAMPLES:

// List section - dynamically generate items before render
{
    type: "list",
    title: "Recent Files",
    items: [], // Start empty
    initfn: (section, target) => {
        // Populate items array dynamically
        const recentFiles = getRecentFiles(); // Your function
        section.items = recentFiles.map(file => ({
            text: file.name,
            icon: "fas fa-file",
            action: "openFile",
            data: file
        }));
    }
}

// Icons section - dynamically generate icons before render
{
    type: "icons",
    title: "Quick Actions",
    icons: [], // Start empty
    initfn: (section, target) => {
        // Populate icons array based on context
        const availableActions = getAvailableActions(target);
        section.icons = availableActions.map(action => ({
            icon: action.icon,
            tooltip: action.name,
            action: action.id
        }));
    }
}

// Custom section - set up content before render
{
    type: "custom",
    content: "", // Start empty
    initfn: (section, target) => {
        // Generate custom HTML content
        const data = getContextData(target);
        section.content = `<div class="custom-content">${data.html}</div>`;
    }
}

LOADFN EXAMPLES:

// Update item properties after render
{
    type: "list",
    items: [
        {
            text: "Toggle Feature",
            icon: "fas fa-toggle-off",
            action: "toggleFeature",
            loadfn: (item, target) => {
                // Update icon based on current state
                const isEnabled = checkFeatureState(target);
                item.icon = isEnabled ? "fas fa-toggle-on" : "fas fa-toggle-off";
                item.disabled = !canToggle(target);
            }
        }
    ]
}

COMBINING BOTH:

{
    type: "list",
    title: "Actions",
    items: [],
    // initfn creates the items
    initfn: (section, target) => {
        section.items = [
            { text: "Action 1", icon: "fas fa-star", action: "action1" },
            { text: "Action 2", icon: "fas fa-heart", action: "action2" }
        ];
    },
    // loadfn updates item properties after rendering
    loadfn: (section, target) => {
        section.items.forEach(item => {
            if (item.action === "action1") {
                item.disabled = !canDoAction1(target);
            }
        });
    }
}

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
