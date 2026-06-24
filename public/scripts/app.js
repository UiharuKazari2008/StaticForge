// app.js — thin shell: fence registration, bootstrap globals, DOMContentLoaded glue.
// Feature logic lives in public/scripts/comp/*.js (see docs/appjs-refactor-removal-manifest.md).

let bypassConfirmation = false;
Object.defineProperty(window, 'bypassConfirmation', {
    get() { return bypassConfirmation; },
    set(v) { bypassConfirmation = v; },
    configurable: true
});
__dreamscapeFence = (typeof __dreamscapeFence !== 'undefined' && __dreamscapeFence)
    ? __dreamscapeFence
    : Object.create(null);
__dreamscapeFence['app.js'] = false;

// T5 Tokenizer global instance (init: appInitSteps.js)
let t5Tokenizer = null;

// Session re-auth promise shared by connectionManager.js
let pinModalPromise = null;

// Tag-highlighting dataset from protected bundle
if (typeof u1 !== 'undefined') {
    window.u1 = u1;
}

document.addEventListener('DOMContentLoaded', async () => {
    // initVirtualKeyboard: public/scripts/comp/virtualKeyboard.js
    initVirtualKeyboard();

    if (window.serviceWorkerManager && typeof window.serviceWorkerManager.ensureBootComplete === 'function') {
        await window.serviceWorkerManager.ensureBootComplete();
    } else if (window.wsClient && typeof window.wsClient.beginApplicationBoot === 'function') {
        await window.wsClient.beginApplicationBoot();
    } else if (window.wsClient && !window.wsClient.initializationStarted) {
        window.wsClient.init();
    }

    // loadBlurPreference: public/scripts/comp/themePreferences.js
    loadBlurPreference();
    // wireFocusOverlayListeners: public/scripts/comp/focusOverlayManager.js
    wireFocusOverlayListeners();
});

__dreamscapeFence['app.js'] = true;
