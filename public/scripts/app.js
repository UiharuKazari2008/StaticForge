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

// T5 Tokenizer global instance (init: appInitSteps.js; declared in app.html)
// Session re-auth promise shared by connectionManager.js (declared in app.html)

// Tag-highlighting dataset from protected bundle
if (typeof u1 !== 'undefined') {
    window.u1 = u1;
}

document.addEventListener('DOMContentLoaded', async () => {
    // sendAppTelemetryPing: public/scripts/comp/telemetryClient.js
    sendAppTelemetryPing();

    // initVirtualKeyboard: public/scripts/comp/virtualKeyboard.js
    initVirtualKeyboard();

    if (window.serviceWorkerManager && typeof window.serviceWorkerManager.ensureBootComplete === 'function') {
        await window.serviceWorkerManager.ensureBootComplete();
    }
    // beginApplicationBoot may already have been triggered from serviceWorkerManager; ensure init runs
    if (window.wsClient && !window.wsClient.initializationStarted) {
        if (typeof window.wsClient.beginApplicationBoot === 'function') {
            await window.wsClient.beginApplicationBoot();
        } else {
            await window.wsClient.init();
        }
    }

    // loadBlurPreference: public/scripts/comp/themePreferences.js
    loadBlurPreference();
    // wireFocusOverlayListeners: public/scripts/comp/focusOverlayManager.js
    wireFocusOverlayListeners();
    // startClientPerfSampler: public/scripts/comp/clientPerfSampler.js
    startClientPerfSampler();
});

__dreamscapeFence['app.js'] = true;
