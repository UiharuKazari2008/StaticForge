/**
 * Toast Notification Management System
 *
 * This file contains all functionality related to:
 * - Toast notification display and management
 * - Toast progress tracking and updates
 * - Toast button handling and interactions
 *
 * Dependencies:
 * - app.js (for shared utilities and DOM elements)
 */

// ============================================================================
// GLOBAL VARIABLES (MOVED FROM app.js)
// ============================================================================

/**
 * Toast counter for unique ID generation
 * @type {number}
 */
let toastCounter = 0;

/**
 * Map of active toast notifications
 * @type {Map<string, object>}
 */
const activeToasts = new Map();

function _clearToastDismissTimer(stored) {
    if (!stored?.timeoutId) return;
    clearTimeout(stored.timeoutId);
    stored.timeoutId = null;
}

function _setToastDismissTimer(toastId, delay) {
    const stored = activeToasts.get(toastId);
    if (!stored || delay === false) return null;
    _clearToastDismissTimer(stored);
    const timeoutId = setTimeout(() => {
        const current = activeToasts.get(toastId);
        if (current?.timeoutId === timeoutId) {
            current.timeoutId = null;
        }
        removeGlassToast(toastId);
    }, Math.max(0, Number(delay) || 0));
    stored.timeoutId = timeoutId;
    activeToasts.set(toastId, stored);
    return timeoutId;
}

/**
 * Global button handler registry for toast buttons
 * @type {Map<number, object>}
 */
const buttonHandlers = new Map();

/**
 * Counter for generating unique button IDs
 * @type {number}
 */
let nextButtonId = 1;

/**
 * Map of vibe encoding progress intervals
 * @type {Map<string, number>}
 */
const vibeEncodingProgressIntervals = new Map();

// ============================================================================
// ANDROID NOTIFICATION BRIDGE
// ============================================================================

/**
 * True once initAndroidNotificationBridge() confirms the native bridge is
 * present and ready (isReady()). User preferences may still disable routing.
 * @type {boolean}
 */
let _androidBridgeHostReady = false;

const NOTIFICATION_BRIDGE_ENABLED_KEY = 'notificationBridgeEnabled';
const BYPASS_NOTIFICATION_BRIDGE_DESKTOP_KEY = 'bypassNotificationBridgeInDesktopMode';

/**
 * True when the host injected window.AndroidNotification with isReady().
 * @returns {boolean}
 */
function isAndroidNotificationBridgeDetected() {
    const bridge = window.AndroidNotification;
    return !!(bridge && typeof bridge.isReady === 'function');
}

function readNotificationBridgeEnabledPreference() {
    try {
        const raw = localStorage.getItem(NOTIFICATION_BRIDGE_ENABLED_KEY);
        if (raw === null) return true;
        return raw === 'true';
    } catch (e) {
        return true;
    }
}

function readBypassNotificationBridgeInDesktopPreference() {
    try {
        return localStorage.getItem(BYPASS_NOTIFICATION_BRIDGE_DESKTOP_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

function applyNotificationBridgePreferences(enabled, bypassInDesktop) {
    try {
        localStorage.setItem(NOTIFICATION_BRIDGE_ENABLED_KEY, enabled ? 'true' : 'false');
        localStorage.setItem(BYPASS_NOTIFICATION_BRIDGE_DESKTOP_KEY, bypassInDesktop ? 'true' : 'false');
    } catch (e) {
        /* ignore */
    }
}

function _isDesktopModeForNotificationBridge() {
    return !!(window.isDesktop || document.body.classList.contains('desktop-mode'));
}

function _canUseAndroidNotificationBridge() {
    if (!_androidBridgeHostReady) return false;
    if (!readNotificationBridgeEnabledPreference()) return false;
    if (readBypassNotificationBridgeInDesktopPreference() && _isDesktopModeForNotificationBridge()) {
        return false;
    }
    return true;
}

/**
 * Whether this toast may be forwarded to the Android notification bridge.
 * Blocked when bridge prefs disallow it, or desktop popup-wired titles in desktop mode.
 */
function _shouldRouteToastToNativeBridge(toastId, type, title, showProgress) {
    if (!_canUseAndroidNotificationBridge()) return false;
    const stored = toastId ? activeToasts.get(toastId) : null;
    const resolvedType = type ?? stored?.type;
    const resolvedTitle = title ?? stored?.title;
    const resolvedProgress = showProgress ?? stored?.showProgress ?? false;
    if (stored?.inAppOnly) return false;
    if (stored?.desktopPopoverAnchor) return false;
    if (_isDesktopPopupWiredToast(resolvedType, resolvedTitle, resolvedProgress)) return false;
    return true;
}

function _isNativeOnlyToast(toastId) {
    const stored = activeToasts.get(toastId);
    return !!(stored?.nativeRouted && !document.getElementById(toastId));
}

window.isAndroidNotificationBridgeDetected = isAndroidNotificationBridgeDetected;
window.readNotificationBridgeEnabledPreference = readNotificationBridgeEnabledPreference;
window.readBypassNotificationBridgeInDesktopPreference = readBypassNotificationBridgeInDesktopPreference;
window.applyNotificationBridgePreferences = applyNotificationBridgePreferences;

/**
 * Called once after the app has fully initialised. Checks whether the
 * window.AndroidNotification bridge is present and reports itself ready via
 * isReady(). If so, sets _androidBridgeHostReady = true and wires the onAction
 * callback so native button taps route back into handleToastButtonClick.
 *
 * Must be called AFTER all scripts have loaded (i.e. from the final
 * registerInitStep 'Finalizing' block in app.js).
 */
function initAndroidNotificationBridge() {
    const bridge = window.AndroidNotification;
    if (!bridge) return;

    // isReady() is the authoritative way for the native host to signal that it
    // can fully handle notifications and the in-app toast UI should be hidden.
    if (typeof bridge.isReady !== 'function' || !bridge.isReady()) return;

    // Do not bulk-dismiss existing in-app toasts here. Finalizing runs at the end of
    // startup (including desktop mode) and users may still have valid toasts open
    // (subscription warnings, update notices, etc.). Routing follows user preferences
    // via _canUseAndroidNotificationBridge().

    _androidBridgeHostReady = true;
    if (_canUseAndroidNotificationBridge()) {
        console.log('📱 AndroidNotification bridge active – native notification routing enabled');
    } else {
        console.log('📱 AndroidNotification bridge ready – in-app toasts (preferences or desktop bypass)');
    }

    // Wire native button-tap callback exactly once.
    if (!bridge._onActionRegistered) {
        bridge.onAction = function (id, actionKey) {
            handleToastButtonClick(Number(actionKey));
        };
        bridge._onActionRegistered = true;
    }
}

/**
 * Expose initAndroidNotificationBridge so app.js can call it after init.
 */
window.initAndroidNotificationBridge = initAndroidNotificationBridge;

/**
 * Fire-and-forget helper that calls a method on window.AndroidNotification.
 *
 * Only fires once the bridge has been fully initialised and confirmed ready
 * via initAndroidNotificationBridge() when _canUseAndroidNotificationBridge() is true.
 * This ensures no bridge calls are made during early application init steps,
 * before isReady() has been checked and the app has completely loaded.
 *
 * @param {string} method - Name of the AndroidNotification method to call
 * @param {...*} args - Arguments forwarded verbatim to the native method
 */
function _androidNotify(method, ...args) {
    // Do not forward any calls until the bridge has been confirmed ready
    // initAndroidNotificationBridge sets _androidBridgeHostReady after isReady().
    if (!_canUseAndroidNotificationBridge()) return;

    if (window.AndroidNotification && typeof window.AndroidNotification[method] === 'function') {
        try {
            window.AndroidNotification[method](...args);
        } catch (e) {
            console.warn(`📱 AndroidNotification.${method} failed:`, e);
        }
    }
}

/**
 * Registers window.AndroidNotification.onAction exactly once.
 * When the native side fires onAction(id, actionKey), we route it to
 * handleToastButtonClick so the JS onClick callbacks and closeOnClick
 * behaviour are honoured identically to a DOM button click.
 * @deprecated Prefer initAndroidNotificationBridge() – kept for safety.
 */
function _androidSetupOnAction() {
    if (!window.AndroidNotification || window.AndroidNotification._onActionRegistered) return;
    window.AndroidNotification.onAction = function (id, actionKey) {
        handleToastButtonClick(Number(actionKey));
    };
    window.AndroidNotification._onActionRegistered = true;
}

/**
 * Serialise the action buttons currently registered for a toast into the
 * JSON array format expected by the native bridge, or null if there are none.
 *
 * Native format: [{label: string, action: string}, ...]
 * The action value is the numeric buttonId (stored as a string) so that
 * onAction can look it up in buttonHandlers via handleToastButtonClick.
 *
 * @param {string} toastId - The toast whose buttons to serialise
 * @returns {string|null} JSON string, or null when there are no buttons
 */
function _getAndroidActionsJson(toastId) {
    const actions = [];
    for (const [buttonId, handler] of buttonHandlers.entries()) {
        if (handler.toastId === toastId) {
            actions.push({ label: handler.text ?? '', action: String(buttonId) });
        }
    }
    return actions.length ? JSON.stringify(actions) : null;
}

/**
 * Numeric id for the Android bridge (showNotification/completeNotification and all
 * update/dismiss methods must use the same id so the native side matches one notification).
 */
function _toastNumericId(toastId) {
    return parseInt(String(toastId).replace(/^toast-/, ''), 10) || 0;
}

/**
 * Toasts marked inAppOnly render in the WebView when the Android notification bridge
 * is active; all other toasts are mirrored only to native notifications.
 */
function _isInAppOnlyToast(toastId) {
    return !!activeToasts.get(toastId)?.inAppOnly;
}

/**
 * Decide whether a toast must stay in the in-app glass UI (not native-only).
 * Action buttons and a few high-visibility titles always use the DOM path.
 */
function _shouldUseInAppToast(type, title, _message, buttons) {
    if (buttons && Array.isArray(buttons) && buttons.length > 0) return true;
    if (title === 'Critical Error' || title === 'User Data Error' || title === 'Read-Only Mode') return true;
    if (title === 'Extended Free Usage') return true;
    if (type === 'warning' && title === 'Queue Blocked') return true;
    if (title === 'Disconnected' || title === 'Reconnecting') return true;
    return false;
}

/** Titles wired to desktop taskbar/tray popovers (showPopover call sites). */
const DESKTOP_POPUP_TOAST_TITLES = new Set([
    'Balance Updated',
    'Generation Complete',
    'High Latency Detected',
    'Operation Receipt',
    'Generation Receipt',
    'Upscaling Receipt',
    'Vibe Encoding Receipt',
    'Deposit Receipt'
]);

/**
 * Desktop notifications anchored to taskbar indicators as popovers — never native bridge.
 * Matches showPopover wiring in app.js / websocket.js.
 */
function _isDesktopPopupWiredToast(type, title, showProgress = false) {
    if (!_isDesktopModeForNotificationBridge()) return false;
    if (showProgress) return false;
    return !!(title && DESKTOP_POPUP_TOAST_TITLES.has(title));
}

function _getDesktopPopupAnchorForTitle(title) {
    if (title === 'High Latency Detected') {
        return document.getElementById('pingWarningIndicator');
    }
    if (title === 'Generation Complete') {
        return document.getElementById('imageGenerationIndicator');
    }
    if (DESKTOP_POPUP_TOAST_TITLES.has(title)) {
        return document.getElementById('fixedCreditsIndicator');
    }
    return null;
}

function _dismissNativeToastNotification(toastId) {
    if (!window.AndroidNotification || typeof window.AndroidNotification.dismissNotification !== 'function') {
        return;
    }
    try {
        window.AndroidNotification.dismissNotification(_toastNumericId(toastId));
    } catch (e) {
        console.warn('📱 AndroidNotification.dismissNotification failed:', e);
    }
}

function _showDesktopPopupForToast(toastId, type, title, message, timeout, customIcon) {
    const anchor = _getDesktopPopupAnchorForTitle(title);
    if (!anchor || !window.PopoverManager || typeof showPopover !== 'function') {
        return false;
    }

    for (const [existingId, existing] of activeToasts) {
        if (existingId !== toastId && existing.desktopPopoverAnchor === anchor) {
            removeGlassToast(existingId);
            break;
        }
    }

    const resolvedTimeout = timeout === false ? 8000 : timeout;
    const revealGenerationIndicator = title === 'Generation Complete' && anchor.classList.contains('hidden');
    if (revealGenerationIndicator) {
        anchor.classList.remove('hidden');
    }

    showPopover(
        anchor,
        type,
        title,
        message,
        false,
        resolvedTimeout,
        customIcon,
        null,
        {
            position: 'top',
            arrowPosition: 'bottom-right',
            onHide: () => {
                if (activeToasts.has(toastId)) {
                    activeToasts.delete(toastId);
                }
                if (revealGenerationIndicator && typeof updateImageGenerationIndicator === 'function') {
                    updateImageGenerationIndicator();
                }
            }
        }
    );
    // startPopoverAutoHideTimer: public/scripts/comp/systemTrayManager.js
    if (typeof startPopoverAutoHideTimer === 'function') {
        startPopoverAutoHideTimer(anchor);
    }

    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.inAppOnly = true;
        stored.nativeRouted = false;
        stored.desktopPopoverAnchor = anchor;
        activeToasts.set(toastId, stored);
    }
    return true;
}

function _promoteToastToDesktopPopupIfWired(toastId, type, title, message, showProgress, timeout, customIcon) {
    if (!_isDesktopPopupWiredToast(type, title, showProgress)) {
        return false;
    }

    const stored = activeToasts.get(toastId);
    if (stored?.buttons && stored.buttons.length > 0) {
        return false;
    }
    if (stored?.nativeRouted) {
        _dismissNativeToastNotification(toastId);
    }

    const toastEl = document.getElementById(toastId);
    if (toastEl?.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
    }

    return _showDesktopPopupForToast(toastId, type, title, message, timeout, customIcon);
}

/**
 * Forward to AndroidNotification only when the bridge is active and this toast
 * is not forced to in-app display.
 */
function _androidNotifyToast(toastId, method, ...args) {
    if (!_shouldRouteToastToNativeBridge(toastId)) return;
    _androidNotify(method, ...args);
}

/**
 * Dismiss the native notification for a bridge-only toast, mark it in-app, and insert DOM.
 * @param {HTMLElement|null} prebuiltButtonsEl - If set, use this (already wired by generateButtonsHtml); do not regenerate IDs.
 */
function _materializeGlassToastDomIfNeeded(toastId, prebuiltButtonsEl = null) {
    if (document.getElementById(toastId)) return;
    const stored = activeToasts.get(toastId);
    if (!stored) return;

    if (stored.nativeRouted && window.AndroidNotification && typeof window.AndroidNotification.dismissNotification === 'function') {
        try {
            window.AndroidNotification.dismissNotification(_toastNumericId(toastId));
        } catch (e) {
            console.warn('📱 AndroidNotification.dismissNotification failed:', e);
        }
    }
    stored.inAppOnly = true;
    stored.nativeRouted = false;
    activeToasts.set(toastId, stored);
    _appendGlassToastDom(
        toastId,
        stored.type,
        stored.title,
        stored.message,
        stored.showProgress,
        stored.timeout !== undefined ? stored.timeout : 5000,
        stored.customIcon,
        stored.buttons,
        prebuiltButtonsEl
    );
}

/**
 * Create and insert the glass toast DOM (shared by showGlassToast and materialize).
 * @param {HTMLElement|null} prebuiltButtonsEl - Optional pre-built .toast-buttons node (preserves button handler IDs).
 */
function _appendGlassToastDom(toastId, type, title, message, showProgress, timeout, customIcon, buttons, prebuiltButtonsEl = null) {
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();

    const toast = document.createElement('div');
    const isSimple = !title || !message;
    toast.className = `glass-toast glass-toast-${type} ${showProgress ? 'upload-progress' : ''} ${isSimple ? 'simple' : ''}`;
    toast.id = toastId;

    const icon = customIcon || getToastIcon(type, showProgress);
    const buttonsElement = prebuiltButtonsEl || (buttons ? generateButtonsHtml(buttons, toastId) : null);

    if (title && message) {
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="fa-regular fa-xmark-large"></i></button>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
                ${showProgress ? '<div class="toast-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;

        if (buttonsElement) {
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.appendChild(buttonsElement);
            }
        }
    } else {
        const messageText = title || message;
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="fa-regular fa-xmark-large"></i></button>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-message">${messageText}</div>
                ${showProgress ? '<div class="toast-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;

        if (buttonsElement) {
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.appendChild(buttonsElement);
            }
        }
    }

    toastContainer.prepend(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
    });

    if (timeout !== false && !showProgress) {
        _setToastDismissTimer(toastId, timeout);
    }
}

// ============================================================================
// TOAST MANAGEMENT FUNCTIONS (READY FOR MANUAL IMPLEMENTATION)
// ============================================================================

/**
 * Display a glass-style toast notification
 * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
 * @param {string} title - Toast title (optional)
 * @param {string} message - Toast message (optional)
 * @param {boolean} showProgress - Whether to show progress bar
 * @param {number|boolean} timeout - Auto-dismiss timeout in milliseconds, or false to disable
 * @param {string|null} customIcon - Custom icon HTML string
 * @param {Array|null} buttons - Array of button configuration objects
 * @returns {string} Unique toast ID
 *
 * @example
 * // Simple success toast
 * showGlassToast('success', 'Success!', 'Operation completed');
 *
 * @example
 * // Progress toast with buttons
 * showGlassToast('info', 'Uploading...', 'Please wait', true, false, null, [
 *   { text: 'Cancel', onClick: () => cancelUpload() }
 * ]);
 */
function showGlassToast(type, title, message, showProgress = false, timeout = 5000, customIcon = null, buttons = null) {
    const toastId = `toast-${++toastCounter}`;
    const resolvedTimeout = timeout === false ? false : (timeout ?? 5000);
    const inAppOnly = _shouldUseInAppToast(type, title, message, buttons)
        || _isDesktopPopupWiredToast(type, title, showProgress);

    activeToasts.set(toastId, {
        type,
        title,
        message,
        showProgress,
        customIcon,
        buttons,
        createdAt: Date.now(),
        inAppOnly,
        timeout: resolvedTimeout,
        nativeRouted: false,
        desktopPopoverAnchor: null,
        timeoutId: null
    });

    if (!buttons && _promoteToastToDesktopPopupIfWired(toastId, type, title, message, showProgress, resolvedTimeout, customIcon)) {
        return toastId;
    }

    // ── Android bridge path (native-only toasts) ─────────────────────────────
    if (_shouldRouteToastToNativeBridge(toastId, type, title, showProgress)) {
        if (buttons) generateButtonsHtml(buttons, toastId);
        const numericId = _toastNumericId(toastId);
        activeToasts.get(toastId).nativeRouted = true;
        _androidNotifyToast(toastId, 'showNotification', numericId, type, title ?? '', message ?? '', showProgress, resolvedTimeout === false ? -1 : resolvedTimeout);
        if (buttons) _androidNotifyToast(toastId, 'updateNotificationActions', numericId, _getAndroidActionsJson(toastId));

        if (resolvedTimeout !== false && !showProgress) {
            _setToastDismissTimer(toastId, resolvedTimeout);
        }

        return toastId;
    }

    // ── In-app glass UI (no bridge, or forced in-app) ────────────────────────
    _appendGlassToastDom(toastId, type, title, message, showProgress, resolvedTimeout, customIcon, buttons);
    return toastId;
}

/**
 * Update an existing toast notification
 * @param {string} toastId - Unique toast ID to update
 * @param {string} type - New toast type ('success', 'error', 'warning', 'info')
 * @param {string} title - New toast title
 * @param {string} message - New toast message
 * @param {string|null} customIcon - New custom icon HTML
 *
 * @example
 * const toastId = showGlassToast('info', 'Loading...', 'Please wait');
 * updateGlassToast(toastId, 'success', 'Complete!', 'Operation finished');
 */
function updateGlassToast(toastId, type, title, message, customIcon = null) {
    // Update stored data regardless of render path
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.type = type;
        stored.title = title;
        stored.message = message;
        stored.customIcon = customIcon;
        activeToasts.set(toastId, stored);
    }

    _androidNotifyToast(toastId, 'updateNotification', _toastNumericId(toastId), title ?? '', message ?? '', type);

    const toast = document.getElementById(toastId);
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    const icon = customIcon || getToastIcon(type);
    const isSimple = !title || !message;
    const messageText = title || message;

    // Preserve existing classes and only update necessary ones
    const existingClasses = toast.className.split(' ').filter(cls =>
        cls !== 'glass-toast' &&
        !cls.startsWith('glass-toast-') &&
        cls !== 'simple' &&
        cls !== 'upload-progress'
    );

    // Build new class list
    const newClasses = ['glass-toast', `glass-toast-${type}`];
    if (isSimple) newClasses.push('simple');
    if (existingClasses.includes('upload-progress')) newClasses.push('upload-progress');
    if (existingClasses.includes('show')) newClasses.push('show');

    toast.className = newClasses.join(' ');

    // Update icon
    const iconElement = toast.querySelector('.toast-icon');
    if (iconElement) {
        iconElement.innerHTML = icon;
    }

    if (isSimple) {
        // Simple toast - only update message
        const messageElement = toast.querySelector('.toast-message');
        if (messageElement) {
            messageElement.textContent = messageText;
        }
    } else {
        // Full toast - update both title and message
        const titleElement = toast.querySelector('.toast-title');
        const messageElement = toast.querySelector('.toast-message');

        if (titleElement) {
            titleElement.textContent = title;
        }
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
}

/** Minimum time (ms) a toast must exist before dismiss when on Android bridge, so the native notification can be shown. */
const ANDROID_DISMISS_DEFER_MS = 400;

/**
 * Remove a toast notification with animation
 * @param {string} toastId - Unique toast ID to remove
 *
 * @example
 * const toastId = showGlassToast('info', 'Message', 'Content');
 * // Later...
 * removeGlassToast(toastId);
 */
function removeGlassToast(toastId) {
    const stored = activeToasts.get(toastId);
    if (stored?.nativeRouted && !_isInAppOnlyToast(toastId)) {
        const elapsed = Date.now() - (stored.createdAt || 0);
        if (elapsed < ANDROID_DISMISS_DEFER_MS) {
            _setToastDismissTimer(toastId, ANDROID_DISMISS_DEFER_MS - elapsed);
            return;
        }
    }
    _clearToastDismissTimer(stored);

    const vibeInterval = vibeEncodingProgressIntervals.get(toastId);
    if (vibeInterval) {
        clearInterval(vibeInterval);
        vibeEncodingProgressIntervals.delete(toastId);
    }

    // Clean up button handlers for this toast
    for (const [buttonId, handler] of buttonHandlers.entries()) {
        if (handler.toastId === toastId) {
            buttonHandlers.delete(buttonId);
        }
    }

    const mirrorDismissToNative = stored?.nativeRouted && !stored.inAppOnly;
    const wasNativeOnly = !!(stored?.nativeRouted && !document.getElementById(toastId));
    const popoverAnchor = stored?.desktopPopoverAnchor;
    activeToasts.delete(toastId);

    if (popoverAnchor && window.PopoverManager) {
        PopoverManager.hide(popoverAnchor);
    }

    if (mirrorDismissToNative) {
        if (window.AndroidNotification && typeof window.AndroidNotification.dismissNotification === 'function') {
            try {
                window.AndroidNotification.dismissNotification(_toastNumericId(toastId));
            } catch (e) {
                console.warn('📱 AndroidNotification.dismissNotification failed:', e);
            }
        }
    }

    clearGlassToastImagePreview(toastId);

    const toast = document.getElementById(toastId);
    if (wasNativeOnly || !toast) return;

    toast.classList.add('removing');

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

/**
 * Get appropriate FontAwesome icon for toast type
 * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
 * @param {boolean} showProgress - Whether progress is being shown
 * @returns {string} HTML string for the icon
 *
 * @example
 * const icon = getToastIcon('success', false); // '<i class="fas fa-check-circle"></i>'
 */
function getToastIcon(type, showProgress) {
    if (showProgress && type === 'info') {
        return '<i class="fas fa-spin fa-spinner-third"></i>';
    }
    switch (type) {
        case 'success': return '<i class="fas fa-check-circle"></i>';
        case 'error': return '<i class="fas fa-times-circle"></i>';
        case 'warning': return '<i class="fas fa-exclamation-triangle"></i>';
        case 'info': return '<i class="fas fa-info-circle"></i>';
        default: return '<i class="fas fa-sparkles"></i>';
    }
}

/**
 * Create and append toast container to document body
 * @returns {HTMLElement} The toast container element
 *
 * @example
 * const container = createToastContainer();
 * // Container is now appended to document.body
 */
function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

/**
 * Update progress bar for a toast notification
 * @param {string} toastId - Unique toast ID
 * @param {number} progress - Progress value (0-100)
 *
 * @example
 * const toastId = showGlassToast('info', 'Uploading...', '', true);
 * updateGlassToastProgress(toastId, 50); // 50% complete
 */
function updateGlassToastProgress(toastId, progress) {
    const clampedProgress = Math.min(progress, 100);
    const stored = activeToasts.get(toastId);

    _androidNotifyToast(toastId, 'updateNotificationProgress', _toastNumericId(toastId), stored?.title ?? '', stored?.message ?? '', clampedProgress, 100, stored?.type);

    const toast = document.getElementById(toastId);
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    const progressBar = toast.querySelector('.toast-progress-bar');
    const progressContainer = progressBar ? progressBar.parentElement : null;

    if (progressBar) {
        progressBar.style.width = `${clampedProgress}%`;

        // Update ARIA attributes for accessibility
        if (progressContainer && progressContainer.hasAttribute('role') && progressContainer.getAttribute('role') === 'progressbar') {
            progressContainer.setAttribute('aria-valuenow', clampedProgress);
        }
    }
}

/**
 * Update the main message line of the toast
 * @param {string} toastId - Toast ID
 * @param {string} message - New message text
 */
function updateGlassToastMessage(toastId, message) {
    const stored = activeToasts.get(toastId);

    // Persist the updated message so subsequent reads (e.g. _getAndroidActionsJson) are fresh
    if (stored) {
        stored.message = message;
        activeToasts.set(toastId, stored);
    }

    _androidNotifyToast(toastId, 'updateNotificationMessage', _toastNumericId(toastId), stored?.title ?? '', message, stored?.type);

    const toast = document.getElementById(toastId);
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    const messageElement = toast.querySelector('.toast-message');
    if (messageElement) {
        messageElement.textContent = message;
    }
}

/**
 * Get action text for tool while executing
 * @param {string} toolName - Tool name
 * @returns {string} Action text
 */
function getToolActionText(toolName) {
    const actionTexts = {
        'searchTagDatabase': 'Searching database...',
        'validateTextReplacement': 'Validating...',
        'searchTagsBatch': 'Searching tags...',
        'getTagDetails': 'Reading wiki...',
        'resolveTagLinks': 'Resolving links...',
        'searchByDescription': 'Searching...',
        'getBodyChunk': 'Reading section...',
        'analyzeTokenCount': 'Analyzing tokens...',
        'webSearch': 'Searching web...',
        'fetchUrl': 'Fetching content...',
        'fetchImage': 'Fetching image...',
        'saveKnowledgeMemory': 'Saving memory...',
        'retrieveKnowledgeMemory': 'Loading memories...',
        'searchKnowledgeMemories': 'Searching memories...',
        'completeTooling': 'Complete',
        'publishAnalysisResults': 'Publishing analysis...',
        'planTextReplacements': 'Planning replacements...',
        'validateSegmentSyntax': 'Validating syntax...'
    };
    return actionTexts[toolName] || 'Processing...';
}

/**
 * Get display name for tools
 * @param {string} toolName - Tool name
 * @returns {string} Display name
 */
function getToolDisplayName(toolName) {
    const displayNames = {
        'start': 'Prepare Agent',
        'searchTagDatabase': 'Tag Database Search',
        'validateTextReplacement': 'Validate Prompt',
        'searchTagsBatch': 'Search Tags and Wiki',
        'getTagDetails': 'Inspect Tag Wiki',
        'resolveTagLinks': 'Resolve Tag Links',
        'searchByDescription': 'Search Tag Description',
        'getBodyChunk': 'Read Wiki Section',
        'analyzeTokenCount': 'Analyze Tokens Usage',
        'webSearch': 'Search Web',
        'fetchUrl': 'Fetch URL',
        'fetchImage': 'Fetch Image',
        'saveKnowledgeMemory': 'Save Knowledge',
        'retrieveKnowledgeMemory': 'Inspect Knowledge',
        'searchKnowledgeMemories': 'Search Memories',
        'completeTooling': 'Plan Complete',
        'publishAnalysisResults': 'Analyse Input',
        'planTextReplacements': 'Create Plan',
        'getDatasetGroupContents': 'Inspect Tag Group'
    };
    return displayNames[toolName] || toolName;
}

/**
 * Get tool icon and background color based on tool name
 * @param {string} toolName - Name of the tool
 * @param {string} toolState - State of the tool ('executing' or 'completed')
 * @returns {Object} Object with icon and backgroundColor
 */
function getToolIconAndBackground(toolName, toolState = 'completed') {

    const toolConfig = {
        'searchTagDatabase': {
            icon: '<i class="fas fa-search"></i>',
            backgroundColor: 'rgb(10 78 139 / 69%)', // Blue
        },
        'searchTagsBatch': {
            icon: '<i class="fas fa-search"></i>',
            backgroundColor: 'rgb(10 78 139 / 69%)', // Indigo
        },
        'getDatasetGroupContents': {
            icon: '<i class="fas fa-list-tree"></i>',
            backgroundColor: 'rgb(97 67 20 / 84%)', // Brown
        },

        'validateTextReplacement': {
            icon: '<i class="fas fa-monitor-waveform"></i>',
            backgroundColor: 'rgb(68 101 6 / 84%)', // Green
        },

        'getTagDetails': {
            icon: '<i class="fas fa-memo-circle-info"></i>',
            backgroundColor: 'rgb(48 42 121 / 84%)', // Purple
        },
        'resolveTagLinks': {
            icon: '<i class="fas fa-diagram-nested"></i>',
            backgroundColor: 'rgb(48 42 121 / 84%)', // Pink
        },
        'searchByDescription': {
            icon: '<i class="fas fa-file-alt"></i>',
            backgroundColor: 'rgb(48 42 121 / 84%)', // Sky blue
        },

        'getBodyChunk': {
            icon: '<i class="fas fa-book-open"></i>',
            backgroundColor: 'rgb(48 42 121 / 84%)', // Purple
        },

        'analyzeTokenCount': {
            icon: '<i class="fas fa-scanner-keyboard"></i>',
            backgroundColor: 'rgb(68 101 6 / 84%)', // Emerald
        },

        'webSearch': {
            icon: '<i class="fas fa-globe"></i>',
            backgroundColor: 'rgb(91 50 7 / 84%)', // Orange
        },
        'fetchUrl': {
            icon: '<i class="fas fa-download"></i>',
            backgroundColor: 'rgb(91 50 7 / 84%)', // Teal
        },
        'fetchImage': {
            icon: '<i class="fas fa-image"></i>',
            backgroundColor: 'rgb(91 50 7 / 84%)', // Pink
        },

        'saveKnowledgeMemory': {
            icon: '<i class="fas fa-book-arrow-up"></i>',
            backgroundColor: 'rgb(88 28 135 / 84%)', // Purple
        },
        'retrieveKnowledgeMemory': {
            icon: '<i class="fas fa-book-open"></i>',
            backgroundColor: 'rgb(88 28 135 / 84%)', // Purple
        },
        'searchKnowledgeMemories': {
            icon: '<i class="fas fa-search-location"></i>',
            backgroundColor: 'rgb(88 28 135 / 84%)', // Purple
        },

        'completeTooling': {
            icon: '<i class="fas fa-check-double"></i>',
            backgroundColor: 'rgb(0 71 58 / 84%)', // Green
        },
        'publishAnalysisResults': {
            icon: '<i class="fas fa-circles-overlap"></i>',
            backgroundColor: 'rgb(90 15 15 / 84%)', // Red/Dark red
        },
        'planTextReplacements': {
            icon: '<i class="fas fa-clipboard-list"></i>',
            backgroundColor: 'rgb(27 69 2 / 84%)', // Purple
        }
    };

    let result = toolConfig[toolName] || {
        icon: '<i class="fas fa-cog"></i>',
        backgroundColor: 'rgba(156, 163, 175, 0.1)', // Gray
    };
    if (toolState === 'executing' && toolName !== 'completeTooling') {
        result.icon = '<i class="fas fa-spinner-third fa-spin"></i>';
    }
    return result;
}

/**
 * Update reasoning text in toast (3rd line)
 * @param {string} toastId - Toast ID
 * @param {string} reasoning - Reasoning text to display
 * @param {string} toolName - Name of the tool (optional, for tool-specific styling)
 * @param {string} phase - Current phase (optional, to detect tool execution)
 */
function updateGlassToastReasoning(toastId, reasoning, toolName = null, phase = null) {
    const toolState = window._lastToolState || 'completed';

    _androidNotifyToast(toastId, 'updateNotificationReasoning', _toastNumericId(toastId), toolName ?? '', reasoning ?? '', toolState);

    const toast = document.getElementById(toastId);
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    // Find or create reasoning element
    let reasoningElement = toast.querySelector('.toast-reasoning');
    if (!reasoningElement) {
        // Create reasoning element and add it to the toast content
        const toastContent = toast.querySelector('.toast-content');
        if (toastContent) {
            reasoningElement = document.createElement('div');
            reasoningElement.className = 'toast-reasoning';
            toastContent.appendChild(reasoningElement);
        }
    }

    if (reasoningElement) {
        if (reasoning) {
            // Check if this is tool execution
            const isToolExecution = phase === 'tool_execution' || toolName;

            if (isToolExecution && toolName) {
                // Get tool-specific icon and background based on toolState from data
                // This will be passed through from the websocket data
                const toolStyle = getToolIconAndBackground(toolName, toolState);

                // Apply tool-specific styling
                reasoningElement.style.cssText = `
                    font-size: 0.85em;
                    color: var(--text-primary);
                    margin-top: 6px;
                    padding: 8px 12px;
                    line-height: 1.4;
                    max-height: 4em;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    background: ${toolStyle.backgroundColor};
                    border-left: 3px solid ${toolStyle.borderColor};
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s ease;
                `;

                // Set content with icon
                reasoningElement.innerHTML = `
                    <span style="
                        flex-shrink: 0;
                        font-size: 1.1em;
                        opacity: 0.8;
                    ">${toolStyle.icon}</span>
                    <span style="
                        flex: 1;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${reasoning}</span>
                `;
            } else {
                // Standard reasoning display (non-tool)
                reasoningElement.style.cssText = `
                    font-size: 0.85em;
                    color: var(--text-secondary);
                    margin-top: 4px;
                    line-height: 1.3;
                    max-height: 3em;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                `;
                reasoningElement.textContent = reasoning;
            }

            reasoningElement.title = reasoning; // Show full text on hover
        } else {
            reasoningElement.remove();
        }
    }
}

/**
 * Update image preview in toast
 * @param {string} toastId - Toast ID
 * @param {string} imageData - Base64 image data
 */
function updateGlassToastImagePreview(toastId, imageData) {
    _androidNotifyToast(toastId, 'updateNotificationImagePreview', _toastNumericId(toastId), imageData ?? '');

    const toast = document.getElementById(toastId);
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    // Find or create image preview element
    let imageElement = toast.querySelector('.toast-image-preview');
    if (!imageElement) {
        // Create image element and add it above progress bar
        const toastContent = toast.querySelector('.toast-content');
        if (toastContent) {
            imageElement = document.createElement('img');
            imageElement.className = 'toast-image-preview';
            imageElement.style.cssText = `
                width: 100%;
                max-width: 200px;
                height: auto;
                max-height: 150px;
                object-fit: contain;
                border-radius: 4px;
                margin-bottom: 8px;
                cursor: pointer;
                display: block;
            `;

            // Insert before progress bar if it exists, otherwise at the end
            const progressBar = toast.querySelector('.toast-progress-container');
            if (progressBar) {
                toastContent.insertBefore(imageElement, progressBar);
            } else {
                toastContent.appendChild(imageElement);
            }
        }
    }

    if (imageElement) {
        if (imageElement.src && imageElement.src.startsWith('data:')) {
            imageElement.onload = null;
            imageElement.onclick = null;
            imageElement.removeAttribute('src');
        }
        imageElement.src = `data:image/png;base64,${imageData}`;

        // Add click handler to open in PhotoSwipe
        imageElement.onclick = () => {
            if (typeof openPhotoSwipe === 'function') {
                // Create a temporary gallery item
                const galleryItem = {
                    src: imageElement.src,
                    w: imageElement.naturalWidth || 512,
                    h: imageElement.naturalHeight || 512,
                    title: 'Generation Preview'
                };
                openPhotoSwipe([galleryItem], 0);
            }
        };
    }
}

/**
 * Drop intermediate generation preview pixels from the toast DOM (large data URLs).
 * @param {string} toastId - Toast ID
 */
function clearGlassToastImagePreview(toastId) {
    if (!toastId) return;
    _androidNotifyToast(toastId, 'updateNotificationImagePreview', _toastNumericId(toastId), '');

    const toast = document.getElementById(toastId);
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    const imageElement = toast.querySelector('.toast-image-preview');
    if (imageElement) {
        imageElement.onload = null;
        imageElement.onclick = null;
        imageElement.removeAttribute('src');
        imageElement.remove();
    }
}

/**
 * Generate HTML element for toast buttons
 * @param {Array} buttons - Array of button configuration objects
 * @param {string} toastId - Unique toast ID
 * @returns {HTMLElement|null} Buttons container element or null
 *
 * @example
 * const buttons = [
 *   { text: 'OK', onClick: () => console.log('OK clicked') },
 *   { text: 'Cancel', onClick: () => console.log('Cancel clicked'), closeOnClick: false }
 * ];
 * const buttonsElement = generateButtonsHtml(buttons, 'toast-123');
 */
function generateButtonsHtml(buttons, toastId) {
    if (!buttons || !Array.isArray(buttons)) return '';

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'toast-buttons';

    buttons.forEach((button, index) => {
        const btn = document.createElement('button');
        btn.className = `toast-button btn-${button.type || 'secondary'}`;
        btn.textContent = button.text;
        btn.type = 'button'; // Prevent form submission

        const clickHandler = button.onClick || button.callback;
        if (clickHandler) {
            // Generate unique button ID
            const buttonId = nextButtonId++;

            // Store the button handler (text is kept so _getAndroidActionsJson can serialise it)
            buttonHandlers.set(buttonId, {
                onClick: clickHandler,
                toastId: toastId,
                closeOnClick: button.closeOnClick,
                text: button.text ?? ''
            });

            // Set onclick attribute to call global handler
            btn.setAttribute('onclick', `handleToastButtonClick('${buttonId}')`);

            // Add data attributes for debugging
            btn.setAttribute('data-button-id', buttonId);
            btn.setAttribute('data-button-index', index);
            btn.setAttribute('data-toast-id', toastId);
        }

        buttonsContainer.appendChild(btn);
    });

    return buttonsContainer;
}

/**
 * Update buttons for an existing toast notification
 * @param {string} toastId - Unique toast ID
 * @param {Array|null} buttons - New button configuration array
 *
 * @example
 * const toastId = showGlassToast('info', 'Confirm', 'Are you sure?');
 * updateGlassToastButtons(toastId, [
 *   { text: 'Yes', onClick: () => proceed() },
 *   { text: 'No', onClick: () => cancel() }
 * ]);
 */
function updateGlassToastButtons(toastId, buttons) {
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.buttons = buttons;
        if (buttons && Array.isArray(buttons) && buttons.length > 0) {
            stored.inAppOnly = true;
        }
        activeToasts.set(toastId, stored);
    }

    if (buttons && Array.isArray(buttons)) {
        for (const [buttonId, handler] of buttonHandlers.entries()) {
            if (handler.toastId === toastId) {
                buttonHandlers.delete(buttonId);
            }
        }
        const buttonsElement = generateButtonsHtml(buttons, toastId);

        _androidNotifyToast(toastId, 'updateNotificationActions', _toastNumericId(toastId), _getAndroidActionsJson(toastId));

        let toast = document.getElementById(toastId);
        if (!toast && _canUseAndroidNotificationBridge() && buttons.length > 0) {
            _materializeGlassToastDomIfNeeded(toastId, buttonsElement);
            return;
        }
        if (_isNativeOnlyToast(toastId)) return;
        if (!toast) return;

        const existingButtons = toast.querySelector('.toast-buttons');
        if (existingButtons) existingButtons.remove();

        const content = toast.querySelector('.toast-content');
        if (content && buttonsElement) {
            content.appendChild(buttonsElement);
        }
    } else {
        _androidNotifyToast(toastId, 'updateNotificationActions', _toastNumericId(toastId), null);

        const toast = document.getElementById(toastId);
        if (_isNativeOnlyToast(toastId)) return;
        if (!toast) return;

        const existingButtons = toast.querySelector('.toast-buttons');
        if (existingButtons) existingButtons.remove();
    }
}

/**
 * Complete a toast notification with final state
 * @param {string} toastId - Unique toast ID
 * @param {object} options - Completion options
 * @param {string} options.type - Final toast type
 * @param {string} options.title - Final toast title
 * @param {string} options.message - Final toast message
 * @param {string} options.customIcon - Final custom icon
 * @param {Array} options.buttons - Final buttons array
 * @param {boolean} options.showProgress - Whether to show progress
 * @param {number|boolean} options.timeout - Final timeout setting
 *
 * @example
 * const toastId = showGlassToast('info', 'Processing...', '', true);
 * updateGlassToastComplete(toastId, {
 *   type: 'success',
 *   title: 'Complete!',
 *   message: 'Operation finished successfully',
 *   showProgress: false
 * });
 */
function updateGlassToastComplete(toastId, options = {}) {
    const {
        type,
        title,
        message,
        customIcon,
        buttons,
        showProgress = null,
        timeout = null
    } = options;

    const storedBefore = activeToasts.get(toastId);
    const resolvedType = type ?? storedBefore?.type;
    const resolvedTitle = title ?? storedBefore?.title;
    const resolvedMessage = message ?? storedBefore?.message;
    const resolvedIcon = customIcon ?? storedBefore?.customIcon;
    const resolvedShowProgress = showProgress !== null ? showProgress : storedBefore?.showProgress;

    if (storedBefore) {
        if (type) storedBefore.type = type;
        if (title) storedBefore.title = title;
        if (message) storedBefore.message = message;
        if (customIcon !== undefined) storedBefore.customIcon = customIcon;
        if (showProgress !== null) storedBefore.showProgress = showProgress;
        if (buttons && Array.isArray(buttons) && buttons.length > 0) {
            storedBefore.inAppOnly = true;
        }
        activeToasts.set(toastId, storedBefore);
    }

    if (_isDesktopPopupWiredToast(resolvedType, resolvedTitle, resolvedShowProgress)) {
        const st = activeToasts.get(toastId);
        if (st) {
            st.inAppOnly = true;
            activeToasts.set(toastId, st);
        }
        if (_promoteToastToDesktopPopupIfWired(
            toastId,
            resolvedType,
            resolvedTitle,
            resolvedMessage,
            resolvedShowProgress,
            timeout !== null && timeout !== undefined
                ? timeout
                : (storedBefore?.timeout === false ? 8000 : (storedBefore?.timeout ?? 5000)),
            resolvedIcon
        )) {
            return;
        }
    }

    // Update basic content (also fires updateNotification bridge call and updates activeToasts)
    if (type || title || message || customIcon) {
        updateGlassToast(toastId, type, title, message, customIcon);
    }

    // Update buttons (also fires updateNotificationActions bridge call)
    if (buttons !== undefined) {
        updateGlassToastButtons(toastId, buttons);
    }

    _androidNotifyToast(toastId, 'completeNotification', _toastNumericId(toastId), type ?? '', title ?? '', message ?? '');

    if (_shouldRouteToastToNativeBridge(toastId)) {
        if (timeout !== null && timeout !== false) {
            _setToastDismissTimer(toastId, timeout);
        } else if (showProgress === false) {
            _setToastDismissTimer(toastId, 5000);
        }
    }

    // ── DOM path ─────────────────────────────────────────────────────────────
    const toast = document.getElementById(toastId);
    // Skip DOM work when the bridge owns the display AND no DOM element exists
    if (_isNativeOnlyToast(toastId)) return;
    if (!toast) return;

    // Update progress state if provided
    if (showProgress !== null) {
        const progressElement = toast.querySelector('.toast-progress');
        if (showProgress && !progressElement) {
            // Add progress bar
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.insertAdjacentHTML('beforeend', '<div class="toast-progress"><div class="toast-progress-bar"></div></div>');
            }
            toast.classList.add('upload-progress');
        } else if (!showProgress && progressElement) {
            // Remove progress bar
            progressElement.remove();
            toast.classList.remove('upload-progress');

            // When removing progress, add close button and set default timeout
            const existingCloseBtn = toast.querySelector('.toast-close');
            if (!existingCloseBtn) {
                const closeBtn = '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="fa-regular fa-xmark-large"></i></button>';
                toast.insertAdjacentHTML('beforeend', closeBtn);
            }

            // Set default timeout for completed progress toasts
            const stored = activeToasts.get(toastId);
            if (stored) {
                _setToastDismissTimer(toastId, 5000);
            }
        }
    }

    if (showProgress === false) {
        clearGlassToastImagePreview(toastId);
    }

    // Update timeout if provided
    if (timeout !== null) {
        const stored = activeToasts.get(toastId);
        if (stored) {
            stored.timeout = timeout;
            activeToasts.set(toastId, stored);

            // Clear existing timeout and set new one
            _clearToastDismissTimer(stored);

            if (timeout !== false) {
                _setToastDismissTimer(toastId, timeout);
            }
        }
    }

    // Ensure toast is visible
    if (!toast.classList.contains('show')) {
        toast.classList.add('show');
    }
}

/**
 * Start automatic progress animation for vibe encoding
 * @param {string} toastId - Unique toast ID
 * @returns {number} Interval ID for the progress animation
 *
 * @example
 * const toastId = showGlassToast('info', 'Encoding Vibe...', '', true);
 * startVibeEncodingProgress(toastId);
 */
function startVibeEncodingProgress(toastId) {
    let progress = 0;
    const interval = setInterval(() => {
        progress += 5; // Add 5% every 500ms
        updateGlassToastProgress(toastId, progress);

        if (progress >= 100) {
            clearInterval(interval);
            vibeEncodingProgressIntervals.delete(toastId);
        }
    }, 250); // Every 500ms

    vibeEncodingProgressIntervals.set(toastId, interval);
    return interval;
}

/**
 * Complete vibe encoding progress with success state
 * @param {string} toastId - Unique toast ID
 * @param {string} successMessage - Success message to display
 *
 * @example
 * completeVibeEncodingProgress(toastId, 'Vibe encoded successfully!');
 */
function completeVibeEncodingProgress(toastId, successMessage = 'Vibe encoding completed!') {
    const interval = vibeEncodingProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        vibeEncodingProgressIntervals.delete(toastId);
    }

    // Set progress to 100%
    updateGlassToastProgress(toastId, 100);

    // Update the toast to show completion
    setTimeout(() => {
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Vibe Created',
            message: successMessage,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
    }, 200); // Small delay to show 100% completion
}

/**
 * Fail vibe encoding progress with error state
 * @param {string} toastId - Unique toast ID
 * @param {string} errorMessage - Error message to display
 *
 * @example
 * failVibeEncodingProgress(toastId, 'Network error occurred');
 */
function failVibeEncodingProgress(toastId, errorMessage = 'Vibe encoding failed') {
    const interval = vibeEncodingProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        vibeEncodingProgressIntervals.delete(toastId);
    }

    // Update the toast to show error
    updateGlassToastComplete(toastId, {
        type: 'error',
        title: 'Encoding Failed',
        message: errorMessage,
        customIcon: '<i class="nai-cross"></i>',
        showProgress: false
    });
}

/**
 * Handle toast button click events
 * @param {number} buttonId - The unique button ID
 */
function handleToastButtonClick(buttonId) {
    const handler = buttonHandlers.get(buttonId);
    if (handler) {
        try {
            handler.onClick(handler.toastId);
            if (handler.closeOnClick !== false) {
                removeGlassToast(handler.toastId);
            }
            // Clean up the handler after use
            buttonHandlers.delete(buttonId);
        } catch (error) {
            console.error('Error in button click handler:', error);
        }
    } else {
        console.error('Button handler not found for ID:', buttonId);
    }
}

/**
 * Complete test progress toast (placeholder - not found in app.js)
 * @param {string} toastId - Toast ID
 */
function completeTestProgress(toastId) {
    // This function was referenced in the original plan but not found in app.js
    // Implement as needed for test progress completion
    console.log('completeTestProgress: Function not found in app.js - implement as needed');
    updateGlassToastComplete(toastId, {
        type: 'success',
        title: 'Test Completed',
        message: 'Test progress has been completed successfully.',
        showProgress: false
    });
}

/**
 * Complete all test progress toasts (placeholder - not found in app.js)
 * @param {string} toastId - Toast ID
 */
function completeAllTestProgress() {
    // This function was referenced in the original plan but not found in app.js
    // Implement as needed for completing all test progress
    console.log('completeAllTestProgress: Function not found in app.js - implement as needed');

    // Close all active toasts with 'test' in the ID or message
    activeToasts.forEach((toastData, toastId) => {
        if (toastId.includes('test') || toastData.message?.toLowerCase().includes('test')) {
            removeGlassToast(toastId);
        }
    });
}

/**
 * Debug utility to inspect button handlers (placeholder - not found in app.js)
 */
function inspectButtonHandlers() {
    // This function was referenced in the original plan but not found in app.js
    // Implement as needed for debugging button handlers
    console.log('inspectButtonHandlers: Function not found in app.js - implement as needed');
    console.log('Current button handlers:', buttonHandlers.size);
    buttonHandlers.forEach((handler, buttonId) => {
        console.log(`Button ${buttonId}:`, handler);
    });
}