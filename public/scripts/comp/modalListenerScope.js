// Per-modal AbortController scope for attach/detach of document/window listeners.
// Used by openModal / closeMainModal (modalUtils.js) and modal managers during migration.

const MODAL_LISTENER_DEV_FLAG = 'staticforge_dev_mode';

function isModalListenerDevLogEnabled() {
    try {
        return localStorage.getItem(MODAL_LISTENER_DEV_FLAG) === 'true';
    } catch (_e) {
        return false;
    }
}

function modalListenerDevLog(message, detail) {
    if (!isModalListenerDevLogEnabled()) return;
    if (detail !== undefined) {
        console.debug('[modalListeners]', message, detail);
    } else {
        console.debug('[modalListeners]', message);
    }
}

function isModalOpenForListeners(modal) {
    if (!modal) return false;
    return !modal.classList.contains('hidden') && !modal.classList.contains('hidden-alt');
}

function ensureModalListenerScope(modal) {
    if (!modal) return null;
    if (!modal._listenerScope) {
        modal._listenerScope = {
            controller: null,
            attachCallbacks: []
        };
    }
    return modal._listenerScope;
}

function getModalListenerSignal(modal) {
    const scope = modal && modal._listenerScope;
    return scope && scope.controller ? scope.controller.signal : null;
}

function attachModalListeners(modal, fn) {
    if (!modal || !fn) return;
    const scope = ensureModalListenerScope(modal);
    if (scope.attachCallbacks.indexOf(fn) === -1) {
        scope.attachCallbacks.push(fn);
    }
    if (scope.controller && !scope.controller.signal.aborted) {
        try {
            fn(scope.controller.signal);
        } catch (err) {
            console.error('[modalListeners] attach callback failed for', modal.id || modal, err);
        }
    }
    modalListenerDevLog('attach registered', { id: modal.id, callbacks: scope.attachCallbacks.length });
}

function detachModalListeners(modal, options) {
    if (!modal || !modal._listenerScope) return;
    const clearCallbacks = options && options.clearCallbacks === true;
    const scope = modal._listenerScope;
    if (scope.controller) {
        modalListenerDevLog('detach abort', { id: modal.id });
        scope.controller.abort();
        scope.controller = null;
    }
    if (clearCallbacks) {
        scope.attachCallbacks.length = 0;
    }
}

function invokeModalAttachCallbacks(modal, signal) {
    const scope = modal && modal._listenerScope;
    if (!scope || !signal) return;
    scope.attachCallbacks.forEach((fn) => {
        try {
            fn(signal);
        } catch (err) {
            console.error('[modalListeners] open attach failed for', modal.id || modal, err);
        }
    });
}

function onModalOpened(modal) {
    if (!modal) return;
    const scope = ensureModalListenerScope(modal);
    if (scope.controller && !scope.controller.signal.aborted) {
        return;
    }
    scope.controller = new AbortController();
    modalListenerDevLog('opened', { id: modal.id });
    document.dispatchEvent(new CustomEvent('staticforge:modal-lifecycle', {
        detail: { type: 'opened', id: modal.id || null }
    }));
    invokeModalAttachCallbacks(modal, scope.controller.signal);
    // onModalKeyboardModalOpened: public/scripts/comp/modalKeyboardRegistry.js
    if (onModalKeyboardModalOpened) {
        onModalKeyboardModalOpened(modal);
    }
}

function onModalClosed(modal) {
    if (!modal) return;
    detachModalListeners(modal);
    modalListenerDevLog('closed', { id: modal.id });
    document.dispatchEvent(new CustomEvent('staticforge:modal-lifecycle', {
        detail: { type: 'closed', id: modal.id || null }
    }));
    // onModalKeyboardModalClosed: public/scripts/comp/modalKeyboardRegistry.js
    if (onModalKeyboardModalClosed) {
        onModalKeyboardModalClosed(modal);
    }
}
