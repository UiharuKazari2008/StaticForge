/**
 * Popover Manager
 * Manages popover display and positioning for UI elements
 */

const HOVER_SHOW_DELAY_MS = 300;
const HOVER_HIDE_DELAY_MS = 100;
const HOVER_MAX_SHOW_MS = 10000;
const TRAY_NOTIFICATION_DEFAULT_TIMEOUT_MS = 8000;

const PopoverManager = {
    activePopovers: new Map(),
    
    /**
     * Show a popover with toast-like API
     * @param {HTMLElement} element - The element to attach the popover to
     * @param {string} type - Popover type ('success', 'error', 'warning', 'info')
     * @param {string} title - Popover title (optional)
     * @param {string} message - Popover message (optional)
     * @param {boolean} showProgress - Whether to show progress bar (not used for popovers, kept for API compatibility)
     * @param {number|boolean} timeout - Auto-dismiss timeout in milliseconds, or false to disable
     * @param {string|null} customIcon - Custom icon HTML string
     * @param {Array|null} buttons - Array of button configuration objects (not used for popovers, kept for API compatibility)
     * @param {Object} options - Additional options
     * @param {string} [options.position='top'] - Position: 'top', 'bottom', 'left', 'right'
     * @param {string} [options.arrowPosition] - Arrow position: 'bottom-right', etc.
     * @param {boolean} [options.hoverOnly=false] - Only show on hover
     * @returns {HTMLElement} The popover element
     */
    showPopover(element, type, title, message, showProgress = false, timeout = 5000, customIcon = null, buttons = null, options = {}) {
        if (!element) return null;
        
        const {
            position = 'top',
            arrowPosition = null,
            hoverOnly = false
        } = options;
        
        // Build popover content structure
        const hasTitle = title && title.trim();
        const hasMessage = message && message.trim();
        const isSimple = !hasTitle || !hasMessage;
        
        // Create content structure
        let content;
        if (isSimple) {
            // Simple one-line popover (message or title only)
            const text = hasMessage ? message : (hasTitle ? title : '');
            content = document.createElement('div');
            content.className = 'popover-body';
            content.innerHTML = text;
        } else {
            // Full popover with title and message - use flex structure
            content = document.createElement('div');
            content.className = 'popover-content';
            
            // Create header with icon
            const header = document.createElement('div');
            header.className = 'popover-header';
            const icon = customIcon || this._getPopoverIcon(type);
            header.innerHTML = `${icon} ${title}`;
            
            // Create body with message
            const body = document.createElement('div');
            body.className = 'popover-body';
            body.innerHTML = message;
            
            content.appendChild(header);
            content.appendChild(body);
        }
        
        // Attach or update popover
        let popoverData = this.activePopovers.get(element);
        
        if (!popoverData) {
            // Attach new popover
            this.attach(element, {
                content: content,
                timeout: timeout === false ? null : timeout,
                position: position,
                arrowPosition: arrowPosition,
                hoverOnly: hoverOnly,
                onHide: options.onHide || null,
                className: options.className || null
            });
        } else {
            // Update existing popover
            this.updateContent(element, content);
            if (!hoverOnly) {
                this._enterNotificationMode(element, popoverData);
                popoverData.timeout = timeout === false ? TRAY_NOTIFICATION_DEFAULT_TIMEOUT_MS : timeout;
            } else if (timeout !== false) {
                popoverData.timeout = timeout;
            } else {
                popoverData.timeout = null;
            }
            if (options.onHide) {
                popoverData.onHide = options.onHide;
            }
        }
        
        // Show the popover (use requestAnimationFrame to ensure DOM is ready)
        requestAnimationFrame(() => {
            this.show(element);
        });
        
        return this.activePopovers.get(element)?.popover || null;
    },
    
    /**
     * Get default icon for popover type
     * @private
     */
    _getPopoverIcon(type) {
        const icons = {
            success: '<i class="fas fa-check"></i>',
            error: '<i class="fas fa-exclamation-triangle"></i>',
            warning: '<i class="fas fa-exclamation-triangle"></i>',
            info: '<i class="fas fa-info-circle"></i>'
        };
        return icons[type] || icons.info;
    },
    
    /**
     * Attach a popover to an element
     * @param {HTMLElement} element - The element to attach the popover to
     * @param {Object} options - Configuration options
     * @param {string|HTMLElement} options.content - Popover content (text or HTML element)
     * @param {number} [options.timeout] - Auto-close timeout in milliseconds (optional)
     * @param {string} [options.position='bottom'] - Position: 'top', 'bottom', 'left', 'right'
     * @param {string} [options.arrowPosition] - Arrow position: 'bottom-right', etc. (overrides position-based arrow)
     * @param {Function} [options.onShow] - Callback when popover is shown
     * @param {Function} [options.onHide] - Callback when popover is hidden
     * @param {boolean} [options.hoverOnly=false] - Only show on hover (close when not hovering)
     * @returns {HTMLElement} The popover element
     */
    attach(element, options = {}) {
        const {
            content = '',
            timeout = null,
            position = 'bottom',
            arrowPosition = null,
            onShow = null,
            onHide = null,
            hoverOnly = false,
            className = null
        } = options;
        
        // Remove existing popover if any
        this.detach(element);
        
        // Create popover element
        const popover = document.createElement('div');
        popover.className = 'popover';
        if (className) {
            className.split(/\s+/).filter(Boolean).forEach((cls) => popover.classList.add(cls));
        }
        
        // Set content - support HTML strings (for backward compatibility) or HTMLElement
        if (typeof content === 'string') {
            // For simple string content, wrap in popover-body
            const body = document.createElement('div');
            body.className = 'popover-body';
            body.innerHTML = content;
            popover.appendChild(body);
        } else if (content instanceof HTMLElement) {
            popover.appendChild(content);
        }
        
        // Add position class
        if (position === 'top') {
            popover.classList.add('is-top');
        } else if (position === 'left') {
            popover.classList.add('is-left');
        } else if (position === 'right') {
            popover.classList.add('is-right');
        }
        
        // Add arrow position class if specified
        if (arrowPosition) {
            popover.classList.add(`arrow-${arrowPosition}`);
        }
        
        // Add to document
        document.body.appendChild(popover);
        
        // Store popover data
        const popoverData = {
            element,
            popover,
            timeout,
            hoverOnly,
            onShow,
            onHide,
            showTimeout: null,
            hideTimeout: null
        };
        
        this.activePopovers.set(element, popoverData);
        
        // Setup event listeners — tray popovers are notification-only (no hover tooltips, no click toggle)
        if (hoverOnly) {
            this._setupHoverListeners(popoverData);
        } else {
            this._setupNotificationDismissListeners(popoverData);
        }
        
        return popover;
    },
    
    /**
     * Show popover for an element
     * @param {HTMLElement} element - The element to show popover for
     */
    show(element) {
        const popoverData = this.activePopovers.get(element);
        if (!popoverData) return;
        
        // Clear any existing timeouts
        if (popoverData.showTimeout) {
            clearTimeout(popoverData.showTimeout);
            popoverData.showTimeout = null;
        }
        if (popoverData.hideTimeout) {
            clearTimeout(popoverData.hideTimeout);
            popoverData.hideTimeout = null;
        }
        
        // Position popover
        this._positionPopover(popoverData);
        
        // Show popover
        popoverData.popover.classList.add('show');
        
        // Call onShow callback
        if (popoverData.onShow) {
            popoverData.onShow(popoverData.popover, element);
        }
        
        // Auto-close timeout (notifications always honor timeout; hover tooltips cap max visible time)
        if (popoverData.timeout) {
            popoverData.hideTimeout = setTimeout(() => {
                this.hide(element);
            }, popoverData.timeout);
        } else if (popoverData.hoverOnly) {
            if (popoverData.maxShowTimeout) {
                clearTimeout(popoverData.maxShowTimeout);
            }
            popoverData.maxShowTimeout = setTimeout(() => {
                this.hide(element);
            }, HOVER_MAX_SHOW_MS);
        }
    },
    
    /**
     * Hide popover for an element
     * @param {HTMLElement} element - The element to hide popover for
     */
    hide(element) {
        const popoverData = this.activePopovers.get(element);
        if (!popoverData) return;
        
        // Clear timeouts
        if (popoverData.showTimeout) {
            clearTimeout(popoverData.showTimeout);
            popoverData.showTimeout = null;
        }
        if (popoverData.hideTimeout) {
            clearTimeout(popoverData.hideTimeout);
            popoverData.hideTimeout = null;
        }
        if (popoverData.maxShowTimeout) {
            clearTimeout(popoverData.maxShowTimeout);
            popoverData.maxShowTimeout = null;
        }
        
        // Hide popover
        popoverData.popover.classList.remove('show');

        this._exitNotificationMode(element, popoverData);
        
        // Call onHide callback
        if (popoverData.onHide) {
            popoverData.onHide(popoverData.popover, element);
        }
    },
    
    /**
     * Detach popover from an element
     * @param {HTMLElement} element - The element to detach popover from
     */
    detach(element) {
        const popoverData = this.activePopovers.get(element);
        if (!popoverData) return;
        
        // Clear timeouts
        if (popoverData.showTimeout) {
            clearTimeout(popoverData.showTimeout);
        }
        if (popoverData.hideTimeout) {
            clearTimeout(popoverData.hideTimeout);
        }
        if (popoverData.maxShowTimeout) {
            clearTimeout(popoverData.maxShowTimeout);
        }
        
        this._teardownHoverListeners(popoverData);
        this._teardownNotificationDismissListeners(popoverData);
        if (popoverData.clickListeners) {
            element.removeEventListener('click', popoverData.clickListeners.toggle);
            document.removeEventListener('click', popoverData.clickListeners.outside);
        }
        
        // Remove popover from DOM
        if (popoverData.popover.parentNode) {
            popoverData.popover.parentNode.removeChild(popoverData.popover);
        }
        
        // Remove from map
        this.activePopovers.delete(element);
    },
    
    /**
     * Update popover content
     * @param {HTMLElement} element - The element
     * @param {string|HTMLElement} content - New content
     */
    updateContent(element, content) {
        const popoverData = this.activePopovers.get(element);
        if (!popoverData) return;
        
        // Clear existing content
        popoverData.popover.innerHTML = '';
        
        // Set new content - support HTML strings (for backward compatibility) or HTMLElement
        if (typeof content === 'string') {
            // For simple string content, wrap in popover-body
            const body = document.createElement('div');
            body.className = 'popover-body';
            body.innerHTML = content;
            popoverData.popover.appendChild(body);
        } else if (content instanceof HTMLElement) {
            popoverData.popover.appendChild(content);
        }
        
        // Reposition if visible
        if (popoverData.popover.classList.contains('show')) {
            this._positionPopover(popoverData);
        }
    },
    
    /**
     * Position popover relative to element
     * @private
     */
    _positionPopover(popoverData) {
        const { element, popover } = popoverData;
        const rect = element.getBoundingClientRect();
        
        // Force layout calculation if popover is hidden
        const wasHidden = !popover.classList.contains('show');
        if (wasHidden) {
            popover.style.visibility = 'hidden';
            popover.style.opacity = '0';
            popover.style.display = 'block';
        }
        
        const popoverRect = popover.getBoundingClientRect();
        const position = popover.classList.contains('is-top') ? 'top' :
                        popover.classList.contains('is-left') ? 'left' :
                        popover.classList.contains('is-right') ? 'right' : 'bottom';
        
        const hasBottomRightArrow = popover.classList.contains('arrow-bottom-right');
        
        let top = 0;
        let left = 0;
        
        if (hasBottomRightArrow) {
            // For bottom-right arrow, position popover above element
            // Arrow should point from bottom-right of popover to the element
            // Calculate arrow position (1em from right, 18px from bottom)
            const arrowOffset = 18; // Arrow height
            const arrowRightOffset = parseFloat(getComputedStyle(popover).fontSize) || 16; // 1em in pixels
            
            top = rect.top - popoverRect.height - arrowOffset;
            // Align arrow to point to right side of element, offset by -10px to line up
            left = rect.right - popoverRect.width + arrowRightOffset;
        } else {
            switch (position) {
                case 'top':
                    top = rect.top - popoverRect.height - 8;
                    left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
                    break;
                case 'bottom':
                    top = rect.bottom + 8;
                    left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
                    break;
                case 'left':
                    top = rect.top + (rect.height / 2) - (popoverRect.height / 2);
                    left = rect.left - popoverRect.width - 8;
                    break;
                case 'right':
                    top = rect.top + (rect.height / 2) - (popoverRect.height / 2);
                    left = rect.right + 8;
                    break;
            }
        }
        
        // Keep popover within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 8;
        
        if (left < padding) {
            left = padding;
        } else if (left + popoverRect.width > viewportWidth - padding) {
            left = viewportWidth - popoverRect.width - padding;
        }
        
        if (top < padding) {
            top = padding;
            // Switch to bottom if top doesn't fit
            if (!popover.classList.contains('is-top') && !hasBottomRightArrow) {
                popover.classList.remove('is-top', 'is-left', 'is-right');
                if (wasHidden) {
                    popover.style.display = '';
                    popover.style.visibility = '';
                    popover.style.opacity = '';
                }
                return this._positionPopover(popoverData);
            }
        } else if (top + popoverRect.height > viewportHeight - padding) {
            top = viewportHeight - popoverRect.height - padding;
            // Switch to top if bottom doesn't fit
            if (!popover.classList.contains('is-top') && !hasBottomRightArrow) {
                popover.classList.add('is-top');
                if (wasHidden) {
                    popover.style.display = '';
                    popover.style.visibility = '';
                    popover.style.opacity = '';
                }
                return this._positionPopover(popoverData);
            }
        }
        
        // Offset left by -10px to line up with the element
        left -= 10;

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
        
        // Restore original state if was hidden
        if (wasHidden) {
            popover.style.display = '';
            popover.style.visibility = '';
            popover.style.opacity = '';
        }
    },
    
    /**
     * @private
     */
    _teardownHoverListeners(popoverData) {
        if (!popoverData?.hoverListeners) return;
        const { element, popover, hoverListeners } = popoverData;
        element.removeEventListener('mouseenter', hoverListeners.elementEnter);
        element.removeEventListener('mouseleave', hoverListeners.elementLeave);
        popover.removeEventListener('mouseenter', hoverListeners.popoverEnter);
        popover.removeEventListener('mouseleave', hoverListeners.popoverLeave);
        popoverData.hoverListeners = null;
    },

    /**
     * @private
     */
    _teardownNotificationDismissListeners(popoverData) {
        if (!popoverData?.notificationDismissListeners) return;
        const { element, popover, notificationDismissListeners } = popoverData;
        element.removeEventListener('mouseleave', notificationDismissListeners.elementLeave);
        popover.removeEventListener('mouseleave', notificationDismissListeners.popoverLeave);
        popoverData.notificationDismissListeners = null;
    },

    /**
     * Swap a tray hover tooltip into programmatic notification mode.
     * @private
     */
    _enterNotificationMode(element, popoverData) {
        if (!popoverData.hoverOnly || popoverData._hoverTooltipSnapshot) return;

        popoverData._hoverTooltipSnapshot = {
            content: element.title || ''
        };
        popoverData._savedOnHide = popoverData.onHide || null;
        popoverData.hoverOnly = false;
        this._teardownHoverListeners(popoverData);
        this._setupNotificationDismissListeners(popoverData);
    },

    /**
     * Restore tray hover tooltip after a notification closes.
     * @private
     */
    _exitNotificationMode(element, popoverData) {
        if (!popoverData._hoverTooltipSnapshot) return;

        this._teardownNotificationDismissListeners(popoverData);
        popoverData.hoverOnly = true;
        popoverData.timeout = null;
        this.updateContent(element, popoverData._hoverTooltipSnapshot.content);
        this._setupHoverListeners(popoverData);
        delete popoverData._hoverTooltipSnapshot;
        if (popoverData._savedOnHide !== undefined) {
            popoverData.onHide = popoverData._savedOnHide;
            delete popoverData._savedOnHide;
        }
    },

    /**
     * Close tray notification popovers when pointer leaves icon and bubble.
     * @private
     */
    _setupNotificationDismissListeners(popoverData) {
        this._teardownNotificationDismissListeners(popoverData);

        const { element, popover } = popoverData;
        let hideTimeout = null;

        const scheduleHide = () => {
            if (hideTimeout) clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => {
                PopoverManager.hide(element);
            }, HOVER_HIDE_DELAY_MS);
        };

        const cancelHide = () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
        };

        element.addEventListener('mouseleave', scheduleHide);
        popover.addEventListener('mouseenter', cancelHide);
        popover.addEventListener('mouseleave', scheduleHide);

        popoverData.notificationDismissListeners = {
            elementLeave: scheduleHide,
            popoverEnter: cancelHide,
            popoverLeave: scheduleHide
        };
    },

    /**
     * Setup hover listeners for hover-only popovers
     * @private
     */
    _setupHoverListeners(popoverData) {
        const { element, popover } = popoverData;
        let showTimeout = null;
        let hideTimeout = null;
        
        const showPopover = () => {
            if (showTimeout) {
                clearTimeout(showTimeout);
                showTimeout = null;
            }
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            
            showTimeout = setTimeout(() => {
                PopoverManager.show(element);
            }, HOVER_SHOW_DELAY_MS);
        };
        
        const hidePopover = () => {
            if (showTimeout) {
                clearTimeout(showTimeout);
                showTimeout = null;
            }
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            
            hideTimeout = setTimeout(() => {
                PopoverManager.hide(element);
            }, HOVER_HIDE_DELAY_MS);
        };
        
        const cancelHide = () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
        };
        
        element.addEventListener('mouseenter', showPopover);
        element.addEventListener('mouseleave', hidePopover);
        popover.addEventListener('mouseenter', cancelHide);
        popover.addEventListener('mouseleave', hidePopover);
        
        // Store listeners for cleanup
        popoverData.hoverListeners = {
            elementEnter: showPopover,
            elementLeave: hidePopover,
            popoverEnter: cancelHide,
            popoverLeave: hidePopover
        };
    },
    
    /**
     * Setup click listeners for click-triggered popovers
     * @private
     */
    _setupClickListeners(popoverData) {
        const { element } = popoverData;
        
        const togglePopover = (e) => {
            e.stopPropagation();
            if (popoverData.popover.classList.contains('show')) {
                PopoverManager.hide(element);
            } else {
                PopoverManager.show(element);
            }
        };
        
        element.addEventListener('click', togglePopover);
        
        // Close on outside click
        const closeOnOutsideClick = (e) => {
            if (!popoverData.popover.contains(e.target) && !element.contains(e.target)) {
                PopoverManager.hide(element);
            }
        };
        
        document.addEventListener('click', closeOnOutsideClick);
        
        // Store listeners for cleanup
        popoverData.clickListeners = {
            toggle: togglePopover,
            outside: closeOnOutsideClick
        };
    },
    
    /**
     * Cleanup all popovers
     */
    cleanup() {
        for (const element of this.activePopovers.keys()) {
            this.detach(element);
        }
    }
};

/**
 * Show a popover with toast-like API
 * @param {HTMLElement} element - The element to attach the popover to
 * @param {string} type - Popover type ('success', 'error', 'warning', 'info')
 * @param {string} title - Popover title (optional)
 * @param {string} message - Popover message (optional)
 * @param {boolean} showProgress - Whether to show progress bar (not used for popovers, kept for API compatibility)
 * @param {number|boolean} timeout - Auto-dismiss timeout in milliseconds, or false to disable
 * @param {string|null} customIcon - Custom icon HTML string
 * @param {Array|null} buttons - Array of button configuration objects (not used for popovers, kept for API compatibility)
 * @param {Object} options - Additional options
 * @param {string} [options.position='top'] - Position: 'top', 'bottom', 'left', 'right'
 * @param {string} [options.arrowPosition] - Arrow position: 'bottom-right', etc.
 * @param {boolean} [options.hoverOnly=false] - Only show on hover
 * @returns {HTMLElement} The popover element
 */
function showPopover(element, type, title, message, showProgress = false, timeout = 5000, customIcon = null, buttons = null, options = {}) {
    return PopoverManager.showPopover(element, type, title, message, showProgress, timeout, customIcon, buttons, options);
}

// Make available globally
window.PopoverManager = PopoverManager;
