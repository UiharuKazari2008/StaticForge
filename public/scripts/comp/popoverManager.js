/**
 * Popover Manager
 * Manages popover display and positioning for UI elements
 */

const HOVER_SHOW_DELAY_MS = 300;
const HOVER_HIDE_DELAY_MS = 100;
const HOVER_MAX_SHOW_MS = 10000;
const TRAY_NOTIFICATION_DEFAULT_TIMEOUT_MS = 8000;

/**
 * Tray balloons while the taskbar is hidden (boot, logon, staged reveal, locks; Yozora #435):
 * a balloon anchored in #desktopTaskbar would land in the top-left corner (its anchor has no
 * box). Per anchor: 'drop' = stale by the time the desktop is back (receipts: the wallet shows
 * the balance; a finished generation during boot), anything else is deferred, the latest per
 * anchor wins (desktopBoot.whenTaskbarVisible).
 */
const TRAY_BALLOON_WHEN_HIDDEN = {
    walletTrayIcon: 'drop',
    imageGenerationIndicator: 'drop-unless-locked', // finished during boot: the gallery has it
    pingWarningIndicator: 'defer-unless-locked'     // measured again after the lock
};

function trayBalloonPolicy(anchor) {
    const rule = TRAY_BALLOON_WHEN_HIDDEN[anchor.id] || 'defer';
    const body = document.body;
    const locked = body.classList.contains('session-suspended') || body.classList.contains('workstation-locked');
    if (rule === 'drop-unless-locked') return locked ? 'defer' : 'drop';
    if (rule === 'defer-unless-locked') return locked ? 'drop' : 'defer';
    return rule;
}

 /**
  * Tray balloons, the standard (Yukimi, Nov 12 2026; .cursor/rules/tray-balloons.mdc): a balloon
  * anchored on a notification-area icon (inside #desktopTaskbar) is placed as Vista's NotifyIcon
  * balloon: above the icon, its stem 15 px in from the balloon's right edge, pointing at the icon
  * (position 'top' + arrow 'bottom-right', forced here whatever the caller passed), and only one
  * shows at a time: one that comes while another is up waits for it to close (Vista queues them),
  * at most TRAY_QUEUE_MAX_WAIT_MS, then the waiting one takes the place. Melaton Update's own balloon
  * (serviceWorkerManager) takes part through trayBusy / whenTrayFree / trayReleased.
  */
/**
 * A balloon's click (Vista's NIN_BALLOONUSERCLICK; Yukimi, Nov 20 2026: "popups from the tray should have click
 * actions"): every tray balloon says what it is for with `onClick`, the function that takes the user there (the
 * window, page, tab or item: a message, the device, the update page) or `null` when there is nothing to open. A click
 * anywhere on the balloon closes it and runs onClick; its X (top right, as Vista draws it) only closes it. The
 * pointer stays the arrow over the whole balloon, as on the Vista VM. A tray balloon shown without onClick at all
 * logs a warning once: decide its target.
 */
const TRAY_QUEUE_MAX_WAIT_MS = 12000;
const TRAY_QUEUE_GAP_MS = 250;
const trayQueue = []; // { key, show, at }
let trayDrainTimer = null;
const isTrayAnchor = (el) => !!(el && el.closest && el.closest('#desktopTaskbar'));
// Vista turns system notifications off while presenting (melatonPresentation.js, #958): tray balloons wait in the
// queue and show, one at a time, when the presentation ends (it calls trayReleased)
const trayPresenting = () => !!(window.melatonPresentation && window.melatonPresentation.holdsBalloons());

const PopoverManager = {
    activePopovers: new Map(),
    /**
     * Presence (Yukimi, Nov 20 2026; Vista counts a balloon's time only while the user is at the computer): a tray balloon's
     * close timer, and the queue's wait before a waiting balloon takes the place of the one up, run only while there has
     * been mouse, keyboard or touch input in the last 30 s (IDLE_MS) and the page is visible. Away: the timer holds,
     * and it goes on at the next input, so a balloon raised while she was away stays until she is back and has had it for
     * its full time. One tracker for every balloon: passive input listeners that only note the time (no polling), and a
     * timer that sleeps until the moment the user would count as away, then waits for input.
     *   PopoverManager.presence.present()          input lately and the page visible
     *   PopoverManager.presenceTimer(ms, fn)       { cancel(), hold(on) }: fn after ms of presence (hold: hovered)
     */
    presence: (() => {
        const IDLE_MS = 30000;
        let lastInput = 0;
        const waiting = new Set();  // run at the next input
        const running = new Set();  // timers counting now (stopped when the page hides)
        const present = () => !document.hidden && Date.now() - lastInput < IDLE_MS;
        const onInput = () => {
            lastInput = Date.now();
            if (!waiting.size || document.hidden) return;
            const list = Array.from(waiting);
            waiting.clear();
            list.forEach((fn) => { try { fn(); } catch (err) { console.warn('[tray] presence wait failed', err); } });
        };
        for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
            // app-scope: allow page lifetime (the tray's presence tracker: shell code loaded once from app.html)
            window.addEventListener(type, onInput, { passive: true, capture: true });
        }
        // app-scope: allow page lifetime (as above)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) Array.from(running).forEach((t) => t.suspend());
        });
        const whenPresent = (fn) => {
            if (present()) { fn(); return () => {}; }
            waiting.add(fn);
            return () => waiting.delete(fn);
        };
        function timer(ms, fn) {
            let remaining = Math.max(0, Number(ms) || 0);
            let handle = 0;
            let startedAt = 0;
            let offWait = null;
            let done = false;
            let held = false;
            const tm = {};
            const stop = () => {
                if (handle) { clearTimeout(handle); handle = 0; remaining -= Date.now() - startedAt; }
                if (offWait) { offWait(); offWait = null; }
                running.delete(tm);
            };
            const run = () => {
                offWait = null;
                if (done || held || handle) return;
                if (!present()) { offWait = whenPresent(run); return; }
                startedAt = Date.now();
                running.add(tm);
                // count until the timeout, or until the user would count as away (then wait for input)
                const slice = Math.min(remaining, Math.max(0, lastInput + IDLE_MS - startedAt));
                handle = setTimeout(() => {
                    handle = 0;
                    running.delete(tm);
                    remaining -= Date.now() - startedAt;
                    if (remaining <= 0) { done = true; fn(); } else run();
                }, slice);
            };
            tm.suspend = () => { if (!done && !held) { stop(); offWait = whenPresent(run); } };
            tm.cancel = () => { done = true; stop(); };
            tm.hold = (on) => {
                if (done) return;
                if (on) { held = true; stop(); } else if (held) { held = false; run(); }
            };
            tm.remaining = () => remaining - (handle ? Date.now() - startedAt : 0);
            run();
            return tm;
        }
        return { present, whenPresent, timer };
    })(),
    presenceTimer: (ms, fn) => PopoverManager.presence.timer(ms, fn),
    _balloonFallbackMs: 15000,
    _noTargetWarned: new Set(),
    _trayWaitTimer: null,  // presence timer: the waiting balloon takes the place of the one up after TRAY_QUEUE_MAX_WAIT_MS

    /** A balloon on a tray icon other than `exceptKey` (an anchor element or a key) is showing. */
    trayBusy(exceptKey = null) {
        if (trayPresenting()) return true;
        for (const [el, data] of this.activePopovers) {
            if (el === exceptKey || data.hoverOnly || !isTrayAnchor(el)) continue;
            if (data.popover && data.popover.classList.contains('show')) return true;
        }
        const sw = document.getElementById('serviceWorkerUpdateTrayPopup');
        return !!(sw && sw.classList.contains('show') && exceptKey !== 'sw-update');
    },

    /** Run `show` once no other tray balloon is up (a later one with the same key replaces it). */
    whenTrayFree(key, show) {
        const at = trayQueue.findIndex((q) => q.key === key);
        const item = { key, show, at: Date.now() };
        if (at >= 0) trayQueue[at] = { ...item, at: trayQueue[at].at }; else trayQueue.push(item);
        this._startTrayWait();
        this._scheduleTrayDrain(TRAY_QUEUE_GAP_MS);
    },

    /** The queue's wait counts only while the user is present (a balloon up while she was away is not replaced). */
    _startTrayWait() {
        if (this._trayWaitTimer || !trayQueue.length) return;
        this._trayWaitTimer = this.presence.timer(TRAY_QUEUE_MAX_WAIT_MS, () => { this._trayWaitTimer = null; this._drainTray(true); });
    },

    /** A tray balloon closed: the next waiting one shows. */
    trayReleased() {
        this._scheduleTrayDrain(TRAY_QUEUE_GAP_MS);
    },

    _scheduleTrayDrain(ms) {
        clearTimeout(trayDrainTimer);
        if (!trayQueue.length) return;
        trayDrainTimer = setTimeout(() => this._drainTray(), ms);
    },

    _drainTray(waitedOut = false) {
        trayDrainTimer = null;
        if (!trayQueue.length || trayPresenting()) return;
        const next = trayQueue[0];
        if (this.trayBusy()) {
            // the one up closes (its timer, its X, a click) and trayReleased drains; once the wait has run out (in the
            // user's presence) the waiting balloon takes its place
            if (!waitedOut) { this._startTrayWait(); return; }
            for (const [el, data] of this.activePopovers) {
                if (!data.hoverOnly && isTrayAnchor(el) && data.popover.classList.contains('show')) this.hide(el);
            }
            const m = window.serviceWorkerManager;
            if (m && typeof m._hideServiceWorkerTrayPopup === 'function') m._hideServiceWorkerTrayPopup();
        }
        trayQueue.shift();
        if (this._trayWaitTimer) { this._trayWaitTimer.cancel(); this._trayWaitTimer = null; }
        try { next.show(); } catch (err) { console.warn('[tray] queued balloon failed', err); }
        this._startTrayWait();
    },
    
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
     * @param {Function|null} options.onClick - A tray balloon's action (required on a tray balloon; null = nothing
     *   to open): a click on the balloon closes it and runs this, the balloon's X only closes it
     * @returns {HTMLElement} The popover element
     */
    showPopover(element, type, title, message, showProgress = false, timeout = 5000, customIcon = null, buttons = null, options = {}) {
        if (!element) return null;

        // trayPopupHidden, trayClampPopupTimeout, trayNotePopup: public/scripts/comp/trayRegistry.js
        if (options.popupId && trayPopupHidden(options.popupId)) {
            if (typeof options.onHide === 'function') {
                try { options.onHide(); } catch (_) { /* best effort */ }
            }
            return null;
        }
        const trayBalloon = !options.hoverOnly && isTrayAnchor(element);
        if (trayBalloon && options.onClick === undefined) {
            const key = options.popupId || element.id || title;
            if (!this._noTargetWarned.has(key)) {
                this._noTargetWarned.add(key);
                console.warn(`[tray] balloon "${key}" has no onClick: pass what a click opens, or onClick: null`);
            }
        }
        // the tray standard: one balloon at a time (this icon's own balloon may be replaced in place); none while presenting
        if (trayBalloon && (trayPresenting() || this.trayBusy(element))) {
            const args = [element, type, title, message, showProgress, timeout, customIcon, buttons, options];
            this.whenTrayFree(element.id || title || 'balloon', () => this.showPopover(...args));
            return null;
        }
        if (options.popupId) trayNotePopup(options.popupId, title);
        timeout = trayClampPopupTimeout(timeout);

        // No tray balloon while the taskbar is hidden (desktopBoot.isTaskbarVisible, #435)
        const boot = window.desktopBoot;
        if (!options.hoverOnly && boot && typeof boot.isTaskbarVisible === 'function'
            && !boot.isTaskbarVisible() && element.closest && element.closest('#desktopTaskbar')) {
            if (trayBalloonPolicy(element) !== 'drop') {
                const args = [element, type, title, message, showProgress, timeout, customIcon, buttons, options];
                boot.whenTaskbarVisible(`popover:${element.id || title}`, () => this.showPopover(...args));
            } else if (typeof options.onHide === 'function') {
                // toastManager drops its entry for the balloon that never showed
                try { options.onHide(); } catch (_) { /* best effort */ }
            }
            return null;
        }
        
        const {
            position: askedPosition = 'top',
            arrowPosition: askedArrow = null,
            hoverOnly = false
        } = options;
        // ... and placed as Vista's NotifyIcon balloon, pointing at its icon
        const position = trayBalloon ? 'top' : askedPosition;
        const arrowPosition = trayBalloon ? 'bottom-right' : askedArrow;
        
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
        
        // Vista's balloon X (tooltip TTP_CLOSE): closes without the action (the click itself: _setupBalloonClick)
        if (trayBalloon) {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'tray-balloon-close';
            close.title = 'Close';
            close.setAttribute('aria-label', 'Close');
            content.appendChild(close);
        }
        const onClick = trayBalloon && typeof options.onClick === 'function' ? options.onClick : null;

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
            const added = this.activePopovers.get(element);
            if (added) added.onClick = onClick;
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
            popoverData.onClick = onClick;
        }
        const shownData = this.activePopovers.get(element);
        if (shownData) shownData.popover.classList.toggle('tray-balloon', trayBalloon);
        
        // Show the popover (use requestAnimationFrame to ensure DOM is ready)
        requestAnimationFrame(() => {
            this.show(element);
            // a tray balloon without its own timeout still closes (systemTrayManager's fallback,
            // hover-aware); run here, once it shows (callers ran it before the frame: a no-op)
            if (trayBalloon && typeof startPopoverAutoHideTimer === 'function') startPopoverAutoHideTimer(element);
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
            hideTimeout: null,
            onClick: null
        };
        
        this.activePopovers.set(element, popoverData);
        this._setupBalloonClick(popoverData);
        
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
        
        // A tray balloon closes after its time in the user's presence (PopoverManager.presence); others as before
        if (popoverData.presenceTimer) { popoverData.presenceTimer.cancel(); popoverData.presenceTimer = null; }
        if (!popoverData.hoverOnly && isTrayAnchor(element)) {
            popoverData.presenceTimer = this.presence.timer(popoverData.timeout || this._balloonFallbackMs, () => {
                popoverData.presenceTimer = null;
                this.hide(element);
            });
        } else if (popoverData.timeout) {
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
        if (popoverData.presenceTimer) {
            popoverData.presenceTimer.cancel();
            popoverData.presenceTimer = null;
        }
        
        // Hide popover
        popoverData.popover.classList.remove('show');

        this._exitNotificationMode(element, popoverData);
        
        // Call onHide callback
        if (popoverData.onHide) {
            popoverData.onHide(popoverData.popover, element);
        }
        if (!element.isConnected) {
            this.detach(element);
        }
        // the next waiting tray balloon
        if (!popoverData.hoverOnly && isTrayAnchor(element)) this.trayReleased();
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
        if (popoverData.presenceTimer) popoverData.presenceTimer.cancel();
        
        this._teardownHoverListeners(popoverData);
        this._teardownNotificationDismissListeners(popoverData);
        if (popoverData.balloonClick) popoverData.popover.removeEventListener('click', popoverData.balloonClick);
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
        let rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
            const chev = document.getElementById('trayOverflowBtn');
            if (chev && !chev.classList.contains('hidden')) rect = chev.getBoundingClientRect();
        }
        
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
            // Stem is 16px, inset 15px from the balloon's right edge (Vista NotifyIcon)
            const arrowOffset = 16;
            const arrowRightOffset = 15;
            
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
        hoverListeners.cancelTimers();
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
        notificationDismissListeners.cancelTimers();
        element.removeEventListener('mouseleave', notificationDismissListeners.elementLeave);
        popover.removeEventListener('mouseenter', notificationDismissListeners.popoverEnter);
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
        popoverData.onClick = null;
        popoverData.popover.classList.remove('tray-balloon');
        this.updateContent(element, popoverData._hoverTooltipSnapshot.content);
        this._setupHoverListeners(popoverData);
        delete popoverData._hoverTooltipSnapshot;
        if (popoverData._savedOnHide !== undefined) {
            popoverData.onHide = popoverData._savedOnHide;
            delete popoverData._savedOnHide;
        }
    },

    /**
     * A tray balloon's click (NIN_BALLOONUSERCLICK): anywhere on it closes it and runs its onClick (after this
     * click has finished, so a flyout it opens is not closed by the same click); its X only closes it. Hover
     * tooltips ignore clicks.
     * @private
     */
    _setupBalloonClick(popoverData) {
        const { element, popover } = popoverData;
        popoverData.balloonClick = (e) => {
            if (popoverData.hoverOnly || !popover.classList.contains('show') || !popover.classList.contains('tray-balloon')) return;
            const onClick = popoverData.onClick;
            this.hide(element);
            if (e.target && e.target.closest && e.target.closest('.tray-balloon-close')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (typeof onClick === 'function') {
                setTimeout(() => {
                    try {
                        const ran = onClick();
                        if (ran && typeof ran.catch === 'function') ran.catch((err) => console.warn('[tray] balloon action failed', err));
                    } catch (err) { console.warn('[tray] balloon action failed', err); }
                }, 0);
            }
        };
        popover.addEventListener('click', popoverData.balloonClick);
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
            if (popoverData.presenceTimer) popoverData.presenceTimer.hold(false);
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
        // the pointer on the balloon: it stays (Vista holds a hovered balloon)
        const enterBalloon = () => {
            cancelHide();
            if (popoverData.presenceTimer) popoverData.presenceTimer.hold(true);
        };

        element.addEventListener('mouseleave', scheduleHide);
        popover.addEventListener('mouseenter', enterBalloon);
        popover.addEventListener('mouseleave', scheduleHide);

        popoverData.notificationDismissListeners = {
            elementLeave: scheduleHide,
            popoverEnter: enterBalloon,
            popoverLeave: scheduleHide,
            cancelTimers: cancelHide
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

        const cancelTimers = () => {
            if (showTimeout) {
                clearTimeout(showTimeout);
                showTimeout = null;
            }
            cancelHide();
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
            popoverLeave: hidePopover,
            cancelTimers
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
