/** Android persistent notification bridge (Phase 2 batch 13). */
let _androidBiometricLockHandlersAttached = false;
let androidFocusLockActive = false;

function setupAndroidBiometricLockHandlers() {
    if (typeof window.AndroidPersistentNotification === 'undefined') return;
    if (_androidBiometricLockHandlersAttached) return;
    const el = document.getElementById('focus-overlay');
    if (!el) return;
    _androidBiometricLockHandlersAttached = true;
    const bridge = window.AndroidPersistentNotification;
    bridge.onLockRequested = function () {
        androidFocusLockActive = true;
        el.style.pointerEvents = 'auto';
        el.classList.add('active');
    };
    bridge.onUnlocked = function () {
        androidFocusLockActive = false;
        el.classList.remove('active');
        setTimeout(() => {
            el.style.pointerEvents = 'none';
        }, 300);
    };
}

/**
 * Update Android persistent notification body (if bridge is available).
 * Body format (JSON array of strings, joined with " · " on Android side):
 *  - Current workspace name OR "Editor Open" if manual editor is open
 *  - Current 24H generation count
 *  - Free credits
 *  - Paid credits
 */
function updateAndroidNotificationBody() {
    setupAndroidBiometricLockHandlers();
    // Only run if the Android bridge is available
    if (typeof window.AndroidPersistentNotification === 'undefined') {
        return;
    }

    // Determine if the manual editor is open
    const manualModalEl = document.getElementById('manualModal');
    const isManualOpen = manualModalEl && !manualModalEl.classList.contains('hidden');

    let firstPart;
    if (isManualOpen) {
        firstPart = 'Editor Open';
    } else {
        firstPart = window.optionsData.activeWorkspace.data.name || 'Default';
    }

    // 24H rolling image generation count (from server ping)
    const genCount = typeof imageCount === 'number' ? imageCount : 0;
    const genPart = `${genCount}`;

    // Free / paid credits from latest balance (optionsData or previousBalance fallback)
    let fixedCredits = 0;
    let paidCredits = 0;

    if (window.optionsData && window.optionsData.balance) {
        fixedCredits = window.optionsData.balance.fixedTrainingStepsLeft || 0;
        paidCredits = window.optionsData.balance.purchasedTrainingSteps || 0;
    } else if (previousBalance) {
        fixedCredits = previousBalance.fixedTrainingStepsLeft || 0;
        paidCredits = previousBalance.purchasedTrainingSteps || 0;
    }

    const creditsLeftPart = `${fixedCredits ? fixedCredits + ' + ' : ''}${paidCredits} anlas`;

    const parts = [firstPart, genPart, creditsLeftPart];

    try {
        window.AndroidPersistentNotification.setBody(JSON.stringify(parts));
    } catch (error) {
        console.warn('Failed to update Android persistent notification body:', error);
    }
}

/**
 * Build an absolute image URL for the Android notification (native side cannot resolve relative paths).
 * @param {string} imagePath - Filename, or path like /images/xxx, or full http(s) URL
 * @returns {string} Absolute URL
 */
function buildAbsoluteImageUrl(imagePath) {
    if (!imagePath) return '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
    const path = imagePath.startsWith('/') ? imagePath : `/images/${imagePath}`;
    return (typeof location !== 'undefined' && location.origin) ? (location.origin + path) : path;
}

/**
 * Update Android persistent notification image using the current manual preview image.
 * Uses the last generated/previewed image's URL when available.
 */
function updateAndroidNotificationImageFromCurrentPreview() {
    if (typeof window.AndroidPersistentNotification === 'undefined') {
        return;
    }

    if (!window.currentManualPreviewImage) {
        return;
    }

    const image = window.currentManualPreviewImage;
    const imagePath = image.upscaled || image.original || image.filename;

    if (!imagePath) {
        return;
    }

    const url = buildAbsoluteImageUrl(imagePath);

    try {
        window.AndroidPersistentNotification.setImageUrl(url);
    } catch (error) {
        console.warn('Failed to update Android persistent notification image:', error);
    }
}

/**
 * Set the Android persistent notification image from an arbitrary image object (e.g. first gallery image).
 * @param {Object} imageObj - Image object with upscaled, original, and/or filename
 */
function setAndroidNotificationImageFromImage(imageObj) {
    if (typeof window.AndroidPersistentNotification === 'undefined') return;
    if (!imageObj) return;
    const imagePath = imageObj.upscaled || imageObj.original || imageObj.filename;
    if (!imagePath) return;
    const url = buildAbsoluteImageUrl(imagePath);
    try {
        window.AndroidPersistentNotification.setImageUrl(url);
    } catch (error) {
        console.warn('Failed to set Android persistent notification image:', error);
    }
}

/**
 * Clear the Android persistent notification large icon (e.g. when changing workspace).
 */
function clearAndroidNotificationImage() {
    if (typeof window.AndroidPersistentNotification === 'undefined') return;
    try {
        window.AndroidPersistentNotification.clearImage();
    } catch (error) {
        console.warn('Failed to clear Android persistent notification image:', error);
    }
}

/**
 * Register AndroidBackgroundRefresh manifest so the native layer can GET JSON while the WebView is paused.
 * See ANDROID_BRIDGE.md. Requires session cookies (same origin as the app).
 */
function registerAndroidBackgroundNotificationManifest() {
    const abr = globalThis.AndroidBackgroundRefresh;
    if (abr === undefined) return;
    try {
        const uri =
            typeof location !== 'undefined' && location.origin
                ? `${location.origin}/android/background-notification`
                : '/android/background-notification';
        abr.registerManifest(
            JSON.stringify({
                uri,
                title: 'DreamScape',
                body: '{{free}} Free / {{paid}} Paid Credits / {{daysLeft}} Days Left',
                internal: false,
                intervalMinutes: 15
            })
        );
    } catch (error) {
        console.warn('AndroidBackgroundRefresh.registerManifest failed:', error);
    }
}

