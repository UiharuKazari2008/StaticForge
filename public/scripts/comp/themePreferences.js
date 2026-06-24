/** Theme switch + blur / focus-cover prefs (Phase 2 batch 13). */
function getThemeSwitchOverlay() {
    let overlay = document.getElementById('theme-switch-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'theme-switch-overlay';
        document.body.appendChild(overlay);
    }
    return overlay;
}

const themeSwitchOverlayEnabled = false;

function runWithThemeSwitchOverlay(applyFn) {
    if (!themeSwitchOverlayEnabled) {
        applyFn();
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const overlay = getThemeSwitchOverlay();
        overlay.classList.add('active');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                applyFn();
                overlay.classList.remove('active');
                resolve();
            });
        });
    });
}

function switchTheme() {
    return runWithThemeSwitchOverlay(() => {
        const isBlurDisabled = document.documentElement.classList.contains('disable-blur');
        if (isBlurDisabled) {
            document.documentElement.classList.remove('disable-blur');
            saveBlurPreference(false);
        } else {
            document.documentElement.classList.add('disable-blur');
            saveBlurPreference(true);
        }
    });
}

function saveBlurPreference(disabled) {
    try {
        // Save preference to localStorage
        localStorage.setItem('disable-blur', disabled.toString());
    } catch (e) {
        console.error('Error saving blur preference:', e);
    }
}

function loadBlurPreference() {
    try {
        const disabled = localStorage.getItem('disable-blur');
        if (disabled !== null) {
            if (disabled === 'true') {
                document.documentElement.classList.add('disable-blur');
            } else {
                document.documentElement.classList.remove('disable-blur');
            }
        }

        const savedFocusCoverState = localStorage.getItem('focusCoverEnabled');
        if (savedFocusCoverState !== null) {
            focusCoverEnabled = savedFocusCoverState === 'true';
        }
    } catch (e) {
        console.error('Error loading blur preference:', e);
    }
}

