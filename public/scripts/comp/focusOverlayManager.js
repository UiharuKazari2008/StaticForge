/**
 * Focus Overlay Manager (Phase 1 — app.js refactor)
 *
 * Title bar scroll visibility, star fields, privacy focus overlay, Android biometric lock.
 * Extracted from public/scripts/app.js; originals remain until manifest removal.
 *
 * Globals used at runtime:
 * focusOverlay (manualModalManager.js), focusCoverEnabled, androidFocusLockActive (app.js)
 */

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

function wireFocusOverlayListeners() {
    // Title bar scroll visibility with high-performance throttling
    let scrollTimeout;
    let lastScrollTop = 0;
    let isScrolling = false;

    const updateTitleBarVisibility = (scrollTop) => {
        const shouldShow = scrollTop > 100;
        const isCurrentlyScrolled = document.documentElement.classList.contains('scrolled');

        // Only update if state actually changed
        if (shouldShow !== isCurrentlyScrolled) {
            if (shouldShow) {
                document.documentElement.classList.add('scrolled');
                generateStarField(); // Generate stars when title bar appears
            } else {
                document.documentElement.classList.remove('scrolled');
                clearStarField(); // Clear stars when title bar disappears
            }
        }
    };

    // Star field generation and management
    const generateStarField = () => {
        const starField = document.getElementById('star-field');
        const titleBar = document.getElementById('title-bar');
        if (!starField || !titleBar) return;

        // Clear existing stars
        starField.innerHTML = '';

        // Generate more stars (40-60) with higher density in top-left
        const numStars = Math.floor(Math.random() * 21) + 40;
        const starSizes = ['small', 'medium', 'large'];

        for (let i = 0; i < numStars; i++) {
            const star = document.createElement('div');
            star.className = 'star';

            // Random size
            const sizeClass = starSizes[Math.floor(Math.random() * starSizes.length)];
            star.classList.add(sizeClass);

            // Position with higher density in top-left area
            let x, y;
            if (Math.random() < 0.6) {
                // 60% chance to be in top-left quadrant (0-50% x, 0-50% y)
                x = Math.random() * 50;
                y = Math.random() * 50;
            } else {
                // 40% chance to be anywhere else
                x = Math.random() * 100;
                y = Math.random() * 100;
            }

            star.style.left = `${x}%`;
            star.style.top = `${y}%`;

            // Random animation delay
            const delay = Math.random() * 2;
            star.style.animationDelay = `${delay}s`;

            // Random animation duration (1.5s to 3s)
            const duration = 1.5 + Math.random() * 1.5;
            star.style.animationDuration = `${duration}s`;

            starField.appendChild(star);
        }
    };

    const clearStarField = () => {
        const starField = document.getElementById('star-field');
        if (starField) {
            starField.innerHTML = '';
        }
    };

    // Focus star field generation and management
    const generateFocusStarField = () => {
        const focusStarField = document.getElementById('focus-star-field');
        if (!focusStarField) return;

        // Clear existing focus stars
        focusStarField.innerHTML = '';

        // Generate stars across the entire viewport (25-40 stars)
        const numStars = Math.floor(Math.random() * 16) + 25;
        const starSizes = ['small', 'medium', 'large'];

        for (let i = 0; i < numStars; i++) {
            const star = document.createElement('div');
            star.className = 'focus-star';

            // Random size
            const sizeClass = starSizes[Math.floor(Math.random() * starSizes.length)];
            star.classList.add(sizeClass);

            // Position randomly across the entire viewport
            const x = Math.random() * 100;
            const y = Math.random() * 100;

            star.style.left = `${x}%`;
            star.style.top = `${y}%`;

            // Random animation delays
            const twinkleDelay = Math.random() * 3; // 0-3s for twinkling
            const driftDelay = Math.random() * 60; // 0-60s for drifting
            star.style.animationDelay = `${twinkleDelay}s, ${driftDelay}s`;

            // Random twinkling duration (2s to 4s)
            const twinkleDuration = 2 + Math.random() * 2;
            star.style.animationDuration = `${twinkleDuration}s, 60s`;

            focusStarField.appendChild(star);
        }
    };

    const clearFocusStarField = () => {
        const focusStarField = document.getElementById('focus-star-field');
        if (focusStarField) {
            focusStarField.innerHTML = '';
        }
    };

    const handleScroll = () => {
        if (!isScrolling) {
            isScrolling = true;
            requestAnimationFrame(() => {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

                // Only process if scroll position actually changed significantly
                if (Math.abs(scrollTop - lastScrollTop) > 5) {
                    updateTitleBarVisibility(scrollTop);
                    lastScrollTop = scrollTop;
                }

                isScrolling = false;
            });
        }

        // Clear existing timeout and set new one for scroll end detection
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Final update when scrolling stops
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            updateTitleBarVisibility(scrollTop);
        }, 16); // ~60fps timing
    };

    // UI SCROLL MANAGEMENT SYSTEM - Title bar visibility and star field generation
    window.addEventListener('scroll', handleScroll, { passive: true });

    // UI SCROLL MANAGEMENT SYSTEM - Initialize title bar state
    const initialScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    updateTitleBarVisibility(initialScrollTop);
    lastScrollTop = initialScrollTop;

    // FOCUS OVERLAY SYSTEM - Prevent accidental interactions when window loses focus
    if (focusOverlay) {
        let focusTimeout;

        const showFocusOverlay = () => {
            // Check if focus cover is enabled via toggle button
            if (!focusCoverEnabled) {
                return; // Don't show overlay if disabled
            }
            // Skip during boot — window blur/visibility flicker before prefs load
            if (document.body.classList.contains('initializing') ||
                document.body.classList.contains('boot-from-launch')) {
                return;
            }

            focusOverlay.style.pointerEvents = 'auto';
            focusOverlay.classList.add('active');
            generateFocusStarField(); // Generate focus stars when overlay appears
        };

        const hideFocusOverlay = () => {
            if (androidFocusLockActive) {
                return; // Android biometric lock keeps overlay active until explicitly unlocked
            }
            focusOverlay.classList.remove('active');
            clearFocusStarField(); // Clear focus stars when overlay disappears
            // Delay releasing pointer events to prevent accidental interactions during fade-out
            setTimeout(() => {
                focusOverlay.style.pointerEvents = 'none';
            }, 300); // Match the CSS transition duration
        };

        // FOCUS OVERLAY SYSTEM - Window blur/focus events
        window.addEventListener('blur', () => {
            // Small delay to prevent flickering during quick focus changes
            focusTimeout = setTimeout(showFocusOverlay, 100);
        });

        window.addEventListener('focus', () => {
            clearTimeout(focusTimeout);
            hideFocusOverlay();
        });

        // FOCUS OVERLAY SYSTEM - Document visibility change (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                showFocusOverlay();
            } else {
                hideFocusOverlay();
            }
        });

        // FOCUS OVERLAY SYSTEM - Click and keyboard events to return focus
        focusOverlay.addEventListener('click', () => {
            window.focus();
            if (!androidFocusLockActive) {
                hideFocusOverlay();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (focusOverlay.classList.contains('active') &&
                (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
                window.focus();
                if (!androidFocusLockActive) {
                    hideFocusOverlay();
                }
            }
        });
    }

    setupAndroidBiometricLockHandlers();
}
