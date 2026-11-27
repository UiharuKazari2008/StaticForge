/* stubs for the desktop shell functions modalUtils.js expects from the rest of the app (the harness has no desktop) */
(function () {
    'use strict';
    const noop = () => {};
    ['onModalOpened', 'onModalClosed', 'getModalListenerSignal'].forEach((n) => { if (typeof window[n] !== 'function') window[n] = noop; });
    window.registerKeyboardListener = window.registerKeyboardListener || noop;
}());
