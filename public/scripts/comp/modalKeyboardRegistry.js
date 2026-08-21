// Central keyboard listener registry — routes document keydown/keyup by priority and modal scope.
// Loaded after modalListenerScope.js; hooks onModalOpened / onModalClosed via modalListenerScope.js.

const MODAL_KEYBOARD_DEV_FLAG = 'staticforge_dev_mode';
const KEYBOARD_REGISTRY_WARNINGS_MAX = 200;
const KEYBOARD_UNREGISTERED_WARN_DEBOUNCE_MS = 750;
const DEV_WARNINGS_LOG_CLIENT_SOURCE_ID = 'client:dev-warnings';

const keyboardListenerRegistry = new Map();
let keyboardRegistryInitialized = false;
let keyboardOverlayRefreshCallback = null;
let devWarningsTrayPopup = null;
const keyboardDevWarnings = [];
const keyboardDirectListenerWarnings = [];
let keyboardUnregisteredWarnLastAt = 0;
let keyboardUnregisteredWarnLastKey = '';

function isModalKeyboardDevLogEnabled() {
    try {
        return localStorage.getItem(MODAL_KEYBOARD_DEV_FLAG) === 'true';
    } catch (_e) {
        return false;
    }
}

function modalKeyboardDevLog(message, detail) {
    if (!isModalKeyboardDevLogEnabled()) return;
    if (detail !== undefined) {
        console.debug('[keyboardRegistry]', message, detail);
    } else {
        console.debug('[keyboardRegistry]', message);
    }
}

function markKeyboardRegistryInternal(fn) {
    if (fn) {
        fn._keyboardRegistryInternal = true;
    }
    return fn;
}

const keyboardOverlayDisplayOnlyHandler = markKeyboardRegistryInternal(function keyboardOverlayDisplayOnly() {});

function isModalFocusedForKeyboard(modal) {
    if (!modal) return false;
    // isModalActive: public/scripts/comp/modalUtils.js
    return isModalActive(modal);
}

function isDesktopOnlyKeyboardContextActive() {
    if (!document.body.classList.contains('desktop-mode')) return false;
    // currentActiveWindowId: public/scripts/comp/modalUtils.js
    if (currentActiveWindowId) return false;
    // desktopShortcuts: public/scripts/comp/desktopShortcuts.js
    if (typeof desktopShortcuts === 'undefined' || !desktopShortcuts) return false;
    return !!(desktopShortcuts.selectedShortcutIds && desktopShortcuts.selectedShortcutIds.size > 0);
}

function overlayEntrySortTier(entry) {
    if (entry.type === 'whenFocused' || entry.type === 'whenOpen') return 2;
    if (entry.desktopContextOnly) return 0;
    return 1;
}

function isKeyboardListenerActive(entry, options) {
    if (!entry || !entry.handler) return false;

    if (entry.type === 'global') {
        if (entry.desktopContextOnly && !isDesktopOnlyKeyboardContextActive()) {
            return false;
        }
        return true;
    }

    if (!entry.modalId) return false;
    const modal = document.getElementById(entry.modalId);
    if (!modal || !isModalOpenForListeners(modal)) {
        return false;
    }

    const forOverlay = options && options.forOverlay === true;

    if (entry.type === 'whenOpen') {
        if (forOverlay) {
            return isModalFocusedForKeyboard(modal);
        }
        return true;
    }

    if (entry.type === 'whenFocused') {
        return isModalFocusedForKeyboard(modal);
    }

    return false;
}

function resolveKeyboardListenerEventType(entry) {
    if (entry.eventType === 'keydown' || entry.eventType === 'keyup') {
        return entry.eventType;
    }
    if (entry.id && entry.id.endsWith('.keyup')) {
        return 'keyup';
    }
    return 'keydown';
}

function keyboardListenerMatchesEventType(entry, event) {
    return resolveKeyboardListenerEventType(entry) === event.type;
}

function resolveShowInOverlay(options) {
    if (options.showInOverlay === false) return false;
    if (options.showInOverlay === true) return true;
    return !!(options.label && options.keys);
}

function collectActiveKeyboardListeners(event) {
    const active = [];
    keyboardListenerRegistry.forEach((entry) => {
        if (entry.overlayOnly) return;
        if (isKeyboardListenerActive(entry) && keyboardListenerMatchesEventType(entry, event)) {
            active.push(entry);
        }
    });
    active.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return active;
}

function getActiveKeyboardOverlayEntries() {
    const active = [];
    keyboardListenerRegistry.forEach((entry) => {
        if (!entry.showInOverlay) return;
        if (!isKeyboardListenerActive(entry, { forOverlay: true })) return;
        if (entry.overlayValid && !entry.overlayValid()) return;
        if (resolveKeyboardListenerEventType(entry) !== 'keydown') return;
        if (!entry.overlayKeys) return;
        active.push(entry);
    });
    active.sort((a, b) => {
        const tierDiff = overlayEntrySortTier(a) - overlayEntrySortTier(b);
        if (tierDiff !== 0) return tierDiff;
        const ga = a.overlayGroup || '';
        const gb = b.overlayGroup || '';
        if (ga !== gb) return ga.localeCompare(gb);
        return (b.priority || 0) - (a.priority || 0);
    });
    return active;
}

function setKeyboardOverlayRefreshCallback(fn) {
    keyboardOverlayRefreshCallback = fn || null;
}

function notifyKeyboardOverlayContextChanged() {
    if (keyboardOverlayRefreshCallback) {
        keyboardOverlayRefreshCallback();
    }
}

function isModifierKeyOnly(event) {
    const key = event && event.key;
    return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta';
}

function isBrowserNativeEditingShortcut(event) {
    if (!event.ctrlKey && !event.metaKey) return false;
    if (event.altKey) return false;
    const key = (event.key || '').toLowerCase();
    if (key.length !== 1) return false;
    if ('cvxazy'.indexOf(key) === -1) return false;
    if (isKeyboardEventNativeTextInput(event)) return true;
    const target = event.target;
    if (!target) return true;
    const tag = target.tagName;
    return tag === 'BODY' || tag === 'HTML';
}

function isKeyboardEventMeaningful(event) {
    if (!event || event.type !== 'keydown') return false;
    if (event.repeat) return false;
    if (isModifierKeyOnly(event)) return false;
    if (shouldSkipUnregisteredKeyboardWarning(event)) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return true;
    const key = event.key || '';
    if (key === 'Escape' || key === 'Enter' || key === 'Tab') return true;
    if (/^F\d{1,2}$/i.test(key)) return true;
    if (key.length === 1) return false;
    if (key.startsWith('Arrow')) return true;
    return true;
}

function isKeyboardEventNativeTextInput(event) {
    const target = event && event.target;
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    if (tag === 'INPUT') {
        const type = (target.type || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit' || type === 'reset') {
            return false;
        }
        return true;
    }
    if (target.matches && target.matches('.prompt-textarea, .character-prompt-textarea')) {
        return true;
    }
    return false;
}

function shouldSkipUnregisteredKeyboardWarning(event) {
    if (!event || event.type !== 'keydown') return false;
    if (event.key === 'F12') return true;
    if (isModifierKeyOnly(event)) return true;
    if (isBrowserNativeEditingShortcut(event)) return true;
    if (isKeyboardEventNativeTextInput(event) && !event.altKey) return true;
    return false;
}

function captureKeyboardListenerRegistrationStack() {
    const err = new Error('keyboard listener registration');
    if (!err.stack) return null;
    const frames = err.stack.split('\n').slice(2);
    const cleaned = [];
    for (let i = 0; i < frames.length && cleaned.length < 8; i++) {
        const line = frames[i].trim();
        if (!line) continue;
        if (line.includes('modalKeyboardRegistry.js')) continue;
        cleaned.push(line);
    }
    return cleaned.length ? cleaned : null;
}

function formatKeyboardEventLabel(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('CTRL');
    if (event.altKey) parts.push('ALT');
    if (event.metaKey) parts.push('META');
    if (event.shiftKey) parts.push('SHIFT');
    parts.push((event.key || 'Unknown').toUpperCase());
    return parts.join('+');
}

function formatDevWarningLogLine(entry) {
    const time = new Date(entry.at).toLocaleTimeString();
    let detailSuffix = '';
    if (entry.detail) {
        const detailForJson = Object.assign({}, entry.detail);
        const stack = detailForJson.stack;
        delete detailForJson.stack;
        if (Object.keys(detailForJson).length) {
            detailSuffix += ` ${JSON.stringify(detailForJson)}`;
        }
        if (Array.isArray(stack) && stack.length) {
            detailSuffix += `\n    ${stack.join('\n    ')}`;
        }
    }
    return `[${time}] [${entry.kind || 'keyboard'}] ${entry.message}${detailSuffix}`;
}

function getDevWarningsLogFormattedText() {
    const warnings = getKeyboardRegistryWarnings();
    const all = warnings.directListeners.concat(warnings.unregistered);
    if (!all.length) {
        return 'No developer warnings recorded yet.\n\nWarnings appear here when unregistered keydown activity or direct document keyboard listeners are detected.';
    }
    return all
        .slice()
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .map(formatDevWarningLogLine)
        .join('\n');
}

function getDevWarningsLogEntryCount() {
    return keyboardDevWarnings.length + keyboardDirectListenerWarnings.length;
}

function openDevWarningsInEventViewer() {
    if (devWarningsTrayPopup) {
        devWarningsTrayPopup.classList.remove('show');
    }
    // logViewerApplet: public/scripts/comp/logViewerApplet.js
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet) {
        logViewerApplet.open({ source: DEV_WARNINGS_LOG_CLIENT_SOURCE_ID });
    }
}

function pushKeyboardDevWarning(warning) {
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        kind: warning.kind || 'keyboard',
        message: warning.message || 'Keyboard warning',
        detail: warning.detail || null
    };

    if (entry.kind === 'direct-listener') {
        keyboardDirectListenerWarnings.push(entry);
        if (keyboardDirectListenerWarnings.length > KEYBOARD_REGISTRY_WARNINGS_MAX) {
            keyboardDirectListenerWarnings.shift();
        }
    } else {
        keyboardDevWarnings.push(entry);
        if (keyboardDevWarnings.length > KEYBOARD_REGISTRY_WARNINGS_MAX) {
            keyboardDevWarnings.shift();
        }
    }

    updateDevWarningsTrayIcon();
    modalKeyboardDevLog('warning recorded', entry);
    // logViewerApplet: public/scripts/comp/logViewerApplet.js
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet && logViewerApplet.isDevWarningsLogSourceActive()) {
        logViewerApplet.onDevWarningLogEntry(entry);
    }
}

function recordUnregisteredKeyboardActivity(event) {
    if (!isKeyboardEventMeaningful(event)) return;
    if (shouldSkipUnregisteredKeyboardWarning(event)) return;

    const label = formatKeyboardEventLabel(event);
    const now = Date.now();
    if (label === keyboardUnregisteredWarnLastKey && (now - keyboardUnregisteredWarnLastAt) < KEYBOARD_UNREGISTERED_WARN_DEBOUNCE_MS) {
        return;
    }
    keyboardUnregisteredWarnLastKey = label;
    keyboardUnregisteredWarnLastAt = now;

    pushKeyboardDevWarning({
        kind: 'unregistered',
        message: `Unhandled keydown: ${label}`,
        detail: {
            key: event.key,
            code: event.code,
            target: event.target && event.target.id ? `#${event.target.id}` : (event.target && event.target.tagName ? event.target.tagName.toLowerCase() : 'unknown')
        }
    });
}

let keyboardDirectListenerWarnLastAt = 0;
let keyboardDirectListenerWarnLastKey = '';

function recordDirectKeyboardListenerWarning(type, listener) {
    const listenerName = listener && listener.name ? listener.name : '(anonymous)';
    const stack = captureKeyboardListenerRegistrationStack();
    const stackHead = stack && stack.length ? stack[0] : '';
    const dedupeKey = `${type}:${listenerName}:${stackHead}`;
    const now = Date.now();
    if (dedupeKey === keyboardDirectListenerWarnLastKey && (now - keyboardDirectListenerWarnLastAt) < KEYBOARD_UNREGISTERED_WARN_DEBOUNCE_MS) {
        return;
    }
    keyboardDirectListenerWarnLastKey = dedupeKey;
    keyboardDirectListenerWarnLastAt = now;
    pushKeyboardDevWarning({
        kind: 'direct-listener',
        message: `Direct document.${type} listener registered outside keyboard registry`,
        detail: {
            type,
            listener: listenerName,
            stack: stack || undefined
        }
    });
}

function dispatchKeyboardRegistryEvent(event) {
    // OS key-repeat on modifiers (~30–60/s) must not scan the registry or re-enter handlers.
    if (event.repeat && isModifierKeyOnly(event)) {
        return false;
    }

    const listeners = collectActiveKeyboardListeners(event);
    let consumed = false;
    let blocked = false;

    for (let i = 0; i < listeners.length; i++) {
        const entry = listeners[i];
        if (blocked) break;

        try {
            const result = entry.handler(event, {
                id: entry.id,
                type: entry.type,
                modalId: entry.modalId,
                priority: entry.priority
            });
            if (result === true || event.defaultPrevented || event._keyboardRegistryConsumed === true) {
                consumed = true;
            }
            if (entry.critical && consumed) {
                blocked = true;
            }
        } catch (err) {
            console.error('[keyboardRegistry] handler failed for', entry.id, err);
        }
    }

    if (!consumed && event.type === 'keydown') {
        recordUnregisteredKeyboardActivity(event);
    }

    return consumed;
}

function centralKeyboardKeydownHandler(event) {
    dispatchKeyboardRegistryEvent(event);
}

function centralKeyboardKeyupHandler(event) {
    dispatchKeyboardRegistryEvent(event);
}

markKeyboardRegistryInternal(centralKeyboardKeydownHandler);
markKeyboardRegistryInternal(centralKeyboardKeyupHandler);

function installCentralKeyboardHandler() {
    if (keyboardRegistryInitialized) return;
    keyboardRegistryInitialized = true;

    document.addEventListener('keydown', centralKeyboardKeydownHandler, true);
    document.addEventListener('keyup', centralKeyboardKeyupHandler, true);
    modalKeyboardDevLog('central handler installed');
}

function installKeyboardListenerDevPatch() {
    if (document._keyboardRegistryAddEventListenerPatched) return;
    document._keyboardRegistryAddEventListenerPatched = true;

    const nativeAdd = document.addEventListener.bind(document);
    document.addEventListener = function patchedDocumentAddEventListener(type, listener, options) {
        if ((type === 'keydown' || type === 'keyup') && listener && !listener._keyboardRegistryInternal) {
            recordDirectKeyboardListenerWarning(type, listener);
        }
        return nativeAdd(type, listener, options);
    };
}

function registerKeyboardListener(options) {
    if (!options || !options.id) {
        console.warn('[keyboardRegistry] registerKeyboardListener requires id');
        return false;
    }

    const hasOverlayMetadata = !!(options.label && options.keys);
    const overlayOnly = options.overlayOnly === true || (!options.handler && hasOverlayMetadata);
    if (!options.handler && !overlayOnly) {
        console.warn('[keyboardRegistry] registerKeyboardListener requires handler for', options.id);
        return false;
    }

    const type = options.type || 'global';
    if (type !== 'global' && type !== 'whenOpen' && type !== 'whenFocused') {
        console.warn('[keyboardRegistry] invalid type for', options.id, type);
        return false;
    }

    if ((type === 'whenOpen' || type === 'whenFocused') && !options.modalId) {
        console.warn('[keyboardRegistry] modalId required for', options.id, type);
        return false;
    }

    const handler = options.handler || keyboardOverlayDisplayOnlyHandler;
    markKeyboardRegistryInternal(handler);

    const eventType = options.eventType === 'keyup' ? 'keyup' : (options.eventType === 'keydown' ? 'keydown' : null);
    const showInOverlay = resolveShowInOverlay(options);

    keyboardListenerRegistry.set(options.id, {
        id: options.id,
        handler,
        type,
        eventType,
        priority: Number.isFinite(options.priority) ? options.priority : 0,
        critical: options.critical === true,
        modalId: options.modalId || null,
        overlayOnly,
        showInOverlay,
        overlayLabel: options.label || null,
        overlayKeys: options.keys || null,
        overlayGroup: options.overlayGroup || null,
        overlayIcon: options.overlayIcon || null,
        overlayAlt: options.overlayAlt === true,
        overlayFnRow: options.overlayFnRow || null,
        desktopContextOnly: options.desktopContextOnly === true,
        overlayValid: typeof options.overlayValid === 'function' ? options.overlayValid : null
    });

    modalKeyboardDevLog('registered', { id: options.id, type, priority: options.priority || 0 });
    return true;
}

function deregisterKeyboardListener(id) {
    if (!id) return false;
    const removed = keyboardListenerRegistry.delete(id);
    if (removed) {
        modalKeyboardDevLog('deregistered', { id });
    }
    return removed;
}

function getKeyboardRegistryWarnings() {
    return {
        unregistered: keyboardDevWarnings.slice(),
        directListeners: keyboardDirectListenerWarnings.slice()
    };
}

function clearKeyboardRegistryWarnings() {
    keyboardDevWarnings.length = 0;
    keyboardDirectListenerWarnings.length = 0;
    updateDevWarningsTrayIcon();
    if (devWarningsTrayPopup) {
        devWarningsTrayPopup.classList.remove('show');
    }
    // logViewerApplet: public/scripts/comp/logViewerApplet.js
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet && logViewerApplet.isDevWarningsLogSourceActive()) {
        logViewerApplet.renderDevWarningsLogContent();
        logViewerApplet.setStatus(logViewerApplet.formatDevWarningsLogStatusMeta());
    }
}

function ensureDevWarningsTrayIcon() {
    let icon = document.getElementById('devWarningsTrayIcon');
    if (icon) return icon;

    const trayIcons = document.querySelector('.taskbar-tray-icons');
    if (!trayIcons) return null;

    icon = document.createElement('div');
    icon.className = 'dev-warnings-tray-icon taskbar-tray-icon hidden';
    icon.id = 'devWarningsTrayIcon';
    icon.title = 'Developer warnings';
    icon.innerHTML = '<i class="fas fa-triangle-exclamation"></i>';

    const wsIndicator = document.getElementById('taskbarWebsocketIndicator');
    if (wsIndicator && wsIndicator.parentNode === trayIcons) {
        trayIcons.insertBefore(icon, wsIndicator);
    } else {
        trayIcons.appendChild(icon);
    }

    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        openDevWarningsInEventViewer();
    });

    return icon;
}

function ensureDevWarningsTrayPopup() {
    if (devWarningsTrayPopup) return devWarningsTrayPopup;

    const popover = document.createElement('div');
    popover.className = 'popover arrow-bottom-right dev-warnings-tray-popup hidden';
    popover.id = 'devWarningsTrayPopup';
    popover.innerHTML = `
        <div class="popover-content">
            <div class="popover-header dev-warnings-tray-popup-header-row">
                <span>Developer Warnings</span>
                <button type="button" class="context-menu-icon-btn dev-warnings-tray-popup-close" title="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="popover-body dev-warnings-tray-popup-body"></div>
            <div class="dev-warnings-tray-popup-actions">
                <button type="button" class="btn-secondary btn-small dev-warnings-tray-clear-btn">Clear</button>
            </div>
        </div>
    `;
    document.body.appendChild(popover);

    const closeBtn = popover.querySelector('.dev-warnings-tray-popup-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.remove('show');
        });
    }

    const clearBtn = popover.querySelector('.dev-warnings-tray-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearKeyboardRegistryWarnings();
            renderDevWarningsTrayPopup();
        });
    }

    document.addEventListener('click', (e) => {
        if (!popover.classList.contains('show')) return;
        if (popover.contains(e.target)) return;
        const icon = document.getElementById('devWarningsTrayIcon');
        if (icon && icon.contains(e.target)) return;
        popover.classList.remove('show');
    });

    devWarningsTrayPopup = popover;
    return popover;
}

function renderDevWarningsTrayPopup() {
    const popover = ensureDevWarningsTrayPopup();
    const body = popover.querySelector('.dev-warnings-tray-popup-body');
    if (!body) return;

    const warnings = getKeyboardRegistryWarnings();
    const all = warnings.directListeners.concat(warnings.unregistered);

    if (!all.length) {
        body.innerHTML = '<p class="text-secondary">No warnings collected.</p>';
        return;
    }

    body.innerHTML = '';
    all.slice().reverse().forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'dev-warnings-tray-popup-row';
        const time = document.createElement('div');
        time.className = 'dev-warnings-tray-popup-time text-secondary';
        time.textContent = entry.at;
        const msg = document.createElement('div');
        msg.className = 'dev-warnings-tray-popup-message';
        msg.textContent = entry.message;
        row.appendChild(time);
        row.appendChild(msg);
        if (entry.detail) {
            const detailForDisplay = Object.assign({}, entry.detail);
            const stack = detailForDisplay.stack;
            delete detailForDisplay.stack;
            if (Object.keys(detailForDisplay).length) {
                const detail = document.createElement('div');
                detail.className = 'dev-warnings-tray-popup-detail text-secondary';
                detail.textContent = JSON.stringify(detailForDisplay);
                row.appendChild(detail);
            }
            if (Array.isArray(stack) && stack.length) {
                const stackEl = document.createElement('div');
                stackEl.className = 'dev-warnings-tray-popup-detail dev-warnings-tray-popup-stack text-secondary';
                stackEl.textContent = stack.join('\n');
                row.appendChild(stackEl);
            }
        }
        body.appendChild(row);
    });
}

function positionDevWarningsTrayPopup() {
    const popover = ensureDevWarningsTrayPopup();
    const icon = document.getElementById('devWarningsTrayIcon');
    if (!popover || !icon) return;

    const rect = icon.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    popover.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
    popover.style.left = 'auto';
    popover.style.top = 'auto';
}

function toggleDevWarningsTrayPopup() {
    const popover = ensureDevWarningsTrayPopup();
    if (popover.classList.contains('show')) {
        popover.classList.remove('show');
        return;
    }
    renderDevWarningsTrayPopup();
    positionDevWarningsTrayPopup();
    popover.classList.remove('hidden');
    popover.classList.add('show');
}

function updateDevWarningsTrayIcon() {
    const icon = ensureDevWarningsTrayIcon();
    if (!icon) return;

    const total = keyboardDevWarnings.length + keyboardDirectListenerWarnings.length;
    if (total > 0) {
        icon.classList.remove('hidden');
        icon.classList.add('has-warnings');
        icon.title = `${total} developer warning${total === 1 ? '' : 's'} — click to open in Periscope`;
    } else {
        icon.classList.add('hidden');
        icon.classList.remove('has-warnings');
        icon.title = 'Developer warnings';
    }
}

function wireDevWarningsTrayIcon() {
    ensureDevWarningsTrayIcon();
    updateDevWarningsTrayIcon();
}

function onModalKeyboardModalOpened(modal) {
    modalKeyboardDevLog('modal opened', { id: modal && modal.id });
    notifyKeyboardOverlayContextChanged();
}

function onModalKeyboardModalClosed(modal) {
    modalKeyboardDevLog('modal closed', { id: modal && modal.id });
    notifyKeyboardOverlayContextChanged();
}

function modalKeyboardSkipPrimaryEnter(target) {
    if (!target) return false;
    if (target.tagName === 'TEXTAREA') return true;
    if (target.tagName === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
}

function modalKeyboardClickButton(e, btn) {
    if (!btn || btn.disabled) return false;
    e.preventDefault();
    e.stopPropagation();
    btn.click();
    return true;
}

function modalKeyboardHandleActionDigits(e, modal, selector) {
    if (!/^[1-9]$/.test(e.key)) return false;
    const root = modal.querySelector(selector || '.modal-actions, #confirmationControls');
    if (!root) return false;
    const buttons = root.querySelectorAll('button:not(:disabled)');
    if (!buttons.length) return false;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return false;
    const digit = parseInt(e.key, 10);
    const btnIndex = buttons.length - 1 - (digit - 1);
    if (btnIndex < 0 || btnIndex >= buttons.length) return false;
    return modalKeyboardClickButton(e, buttons[btnIndex]);
}

function modalKeyboardTriggerPrimaryEnter(e, modal, primarySelector) {
    if (modalKeyboardSkipPrimaryEnter(e.target)) return false;
    if (e.target.closest('.modal-actions') && e.target.tagName === 'BUTTON') return false;
    if (e.target.closest('#confirmationControls') && e.target.tagName === 'BUTTON') return false;
    const btn = modal.querySelector(primarySelector
        || '#confirmationControls [data-dialog-primary="1"], .modal-actions .btn-primary:not(:disabled), .btn.btn-primary:not(:disabled)');
    return modalKeyboardClickButton(e, btn);
}

function resolveOverlayFnRowForKeys(keys, explicitFnRow) {
    if (explicitFnRow) return explicitFnRow;
    const trimmed = String(keys || '').trim();
    if (/^F\d{1,2}$/i.test(trimmed)) return 'primary';
    const normalized = trimmed.replace(/\s+/g, '');
    if (/^ALT\+F\d{1,2}$/i.test(normalized)) return 'alt';
    return null;
}

function registerModalOverlayEntries(modalId, overlayGroup, entries, scopeOptions) {
    const type = (scopeOptions && scopeOptions.type) || 'whenFocused';
    entries.forEach((entry) => {
        registerKeyboardListener({
            id: entry.id,
            type,
            modalId,
            label: entry.label,
            keys: entry.keys,
            overlayIcon: entry.icon,
            overlayGroup,
            overlayAlt: entry.overlayAlt === true,
            overlayFnRow: resolveOverlayFnRowForKeys(entry.keys, entry.fnRow),
            overlayValid: typeof entry.overlayValid === 'function' ? entry.overlayValid : null,
            overlayOnly: true,
            priority: -10
        });
    });
}

const devWarningsLogApi = {
    clientSourceId: DEV_WARNINGS_LOG_CLIENT_SOURCE_ID,
    getFormattedText: getDevWarningsLogFormattedText,
    getEntryCount: getDevWarningsLogEntryCount
};

function initializeModalKeyboardRegistry() {
    installCentralKeyboardHandler();
    installKeyboardListenerDevPatch();
    wireDevWarningsTrayIcon();
}

initializeModalKeyboardRegistry();
