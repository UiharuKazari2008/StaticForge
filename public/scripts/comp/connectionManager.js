/** Session, fetchWithAuth, server ping (Phase 2 batch 13). */

function syncAuthLocalStorageFromServer(payload) {
    if (!payload || typeof payload !== 'object') {
        return;
    }
    if (payload.userType) {
        localStorage.setItem('userType', payload.userType);
    }
    if (payload.userType === 'admin' && payload.logViewerPathUuid) {
        localStorage.setItem('logViewerPathUuid', payload.logViewerPathUuid);
    }
    // bootstrapVfsPathUuidFromOptions: public/scripts/comp/vfsClient.js
    if (payload.vfsPathUuid && typeof bootstrapVfsPathUuidFromOptions === 'function') {
        bootstrapVfsPathUuidFromOptions(payload);
    }
    if (payload.authenticated === false) {
        vistaWebFontsSawSignedOut = true;
    } else if (payload.userType) {
        refreshVistaWebFontsAfterLogon();
    }
}

// The Vista fonts (public/css/vista-fonts.css) are served from /protected/: a face that loaded
// while this page was signed out fell back to the client's own copy or Selawik. Once signed in,
// fetch those faces again; a face added from script wins over the CSS one.
const VISTA_WEB_FONT_PATH = '/protected/fonts/vista/';
let vistaWebFontsSawSignedOut = false;

function refreshVistaWebFontsAfterLogon() {
    if (!vistaWebFontsSawSignedOut) return;
    vistaWebFontsSawSignedOut = false;
    if (typeof document === 'undefined' || !document.fonts || typeof FontFace !== 'function') return;
    const loaded = new Set();
    document.fonts.forEach((face) => {
        if (face.status === 'loaded') loaded.add(`${face.family.replace(/["']/g, '')}|${face.weight}|${face.style}`);
    });
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (_) { continue; }
        for (const rule of rules) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            const src = rule.style.getPropertyValue('src');
            const match = src.match(/url\(["']?([^"')]+)["']?\)/);
            if (!match || match[1].indexOf(VISTA_WEB_FONT_PATH) === -1) continue;
            const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
            const weight = rule.style.getPropertyValue('font-weight') || '400';
            const style = rule.style.getPropertyValue('font-style') || 'normal';
            if (!loaded.has(`${family}|${weight}|${style}`)) continue;
            const descriptors = { weight, style, display: 'swap' };
            const range = rule.style.getPropertyValue('unicode-range');
            if (range) descriptors.unicodeRange = range;
            new FontFace(family, `url("${match[1]}") format("woff2")`, descriptors).load()
                .then((face) => { document.fonts.add(face); })
                .catch(() => { /* still signed out: the fallback stays */ });
        }
    }
}

/**
 * options.redirect: where to go once the server has ended the session (default '/'); false
 * stays on the page (Log Off, winlogonPower.js, goes to /launch itself). Resolves true on success.
 */
async function handleLogout(options = {}) {
    const redirect = options.redirect === undefined ? '/' : options.redirect;
    try {
        const response = await fetchWithAuth('/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            // keepSiteAccess: the desktop's Log off keeps this computer's site key (web_server.js 'logout')
            body: JSON.stringify(options.keepSiteAccess ? { action: 'logout', data: { keepSiteAccess: true } } : { action: 'logout' })
        });
        if (response.ok) {
            // Clear authentication-related data from localStorage
            try {
                // Remove user authentication data
                localStorage.removeItem('userType');
                localStorage.removeItem('userData');
                localStorage.removeItem('loginTimestamp');
                localStorage.removeItem('logViewerPathUuid');

                // Disconnect WebSocket client
                if (window.wsClient) {
                    console.log('🔌 Disconnecting WebSocket client');
                    window.wsClient.disconnect();
                }
            } catch (error) {
                console.warn('⚠️ Failed to clear some localStorage keys or disconnect services:', error);
            }

            if (redirect) window.location.href = redirect;
            return true;
        }
        if (redirect) showError('Logout failed');
        return false;
    } catch (error) {
        // Already redirected on 401
        return false;
    }
}

async function fetchWithAuth(url, options = {}) {
    if (!(await ensureSessionValid())) {
        handleAuthError(new Error('Unauthorized access'), 'fetchWithAuth');
        return Promise.reject(new Error('Session invalid or cancelled'));
    }
    return fetch(url, options);
};

// Ping management
let lastPingTime = null;
let pingTimeoutId = null;
let imageCount = 0;
// websocketToastId is now global (window.websocketToastId)

function handleServerPing(data) {
    lastPingTime = Date.now();

    // Update UI with server data
    if (data.image_count !== undefined) {
        imageCount = data.image_count;
        if (typeof updateManualGenCountDisplay === 'function') {
            updateManualGenCountDisplay();
        }
    }
    if (data.balance !== undefined) {
        if (!(typeof isAccountDataDeferred === 'function' && isAccountDataDeferred())) {
            updateBalanceDisplay(data.balance);
            if (window.optionsData) {
                window.optionsData.balance = data.balance;
            }
        }

        // Subscription toasts need loaded user subscription data; skip until get_app_options has loaded
        if (appDataLoaded && isUserSubscriptionDataReady()) {
            updateSubscriptionNotifications().catch(error => {
            });
        }
    }
    // #829: renewal date / tier and status.novelai.net's verdict, pushed with every ping (boot-only before)
    if (data.subscription && window.optionsData && window.optionsData.user && window.optionsData.user.subscription
        && typeof window.optionsData.user.subscription === 'object') {
        const cur = window.optionsData.user.subscription;
        const s = data.subscription;
        if (s.tier != null) cur.tier = s.tier;
        if (s.active != null) cur.active = s.active;
        if (s.expiresAt != null) cur.expiresAt = s.expiresAt;
        if (s.monthlyAnlas != null) cur.perks = Object.assign({}, cur.perks || {}, { moduleTrainingSteps: s.monthlyAnlas });
    }
    if (data.novelaiStatus && window.optionsData) {
        const prev = window.optionsData.novelaiStatus || {};
        const impaired = new Map((data.novelaiStatus.impaired || []).map((c) => [c.name, c]));
        window.optionsData.novelaiStatus = Object.assign({}, prev, {
            fetchedAt: data.novelaiStatus.fetchedAt,
            activeIncident: data.novelaiStatus.activeIncident,
            imageGenerationBlocked: data.novelaiStatus.imageGenerationBlocked,
            components: (prev.components || []).map((c) => (impaired.has(c.name) ? Object.assign({}, c, impaired.get(c.name)) : Object.assign({}, c, { impaired: false })))
        });
    }
    if (data.opusUsage !== undefined) {
        if (window.optionsData) {
            window.optionsData.opusUsage = data.opusUsage;
        }
        // usageToolManager: public/scripts/comp/usageToolManager.js
        usageToolManager.updateUsage(data.opusUsage);
    }

    if (data.accountHealth) {
        // applyAccountHealthFieldsToOptions / handleAccountHealthUpdate: public/scripts/comp/accountDataBootstrap.js
        applyAccountHealthFieldsToOptions(data.accountHealth, data.balance);
        handleAccountHealthUpdate(data.accountHealth, data.balance);
    }

    // Handle queue status
    if (data.queue_status !== undefined) {
        if (data.queue_status === 2) {
            isQueueStopped = true;
            isQueueProcessing = false;
        } else if (data.queue_status === 1) {
            isQueueStopped = false;
            isQueueProcessing = true;
        } else {
            isQueueStopped = false;
            isQueueProcessing = false;
        }
        updateManualGenerateBtnState();
    }

    // Update Android persistent notification with latest status
    updateAndroidNotificationBody();

    if (window.wsClient && typeof window.wsClient.setPingResponseWaitingFlash === 'function') {
        window.wsClient.setPingResponseWaitingFlash(false);
    }

    // Clear WebSocket connection toast if it exists
    if (window.websocketToastId) {
        removeGlassToast(window.websocketToastId);
        window.websocketToastId = null;
    }

    // Reset ping timeout
    if (pingTimeoutId) {
        clearTimeout(pingTimeoutId);
    }

    // Set timeout for next ping (15 seconds) — flash WS dot if still connected but server silent
    pingTimeoutId = setTimeout(() => {
        if (window.wsClient && window.wsClient.isConnected && window.wsClient.isConnected()
            && typeof window.wsClient.setPingResponseWaitingFlash === 'function') {
            window.wsClient.setPingResponseWaitingFlash(true);
        }
    }, 15000);
}

async function ensureSessionValid() {
    // Use WebSocket ping if available, otherwise fall back to HTTP
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.pingWithAuth();
                return true;
            } catch (wsError) {
                // Check if this is a timeout error (not authentication failure)
                if (wsError.code === 'PING_TIMEOUT') {
                    console.warn('WebSocket ping timeout, connection may be unstable:', wsError);
                    // For timeouts, don't treat as auth failure - just return false
                    return false;
                }
                console.warn('WebSocket ping failed, authentication required:', wsError);
            }
        }

        // Melaton Mobile with the socket down: the server is out of reach, which says nothing about
        // the session. No PIN prompt for a dropped connection (the connectivity icon shows it); the
        // socket's own auth answer asks for logon when the session really has gone (Yukimi, Nov 13)
        if (window.wsClient && !window.wsClient.isConnected() && window.wsClient.connectionPhase !== 'auth'
            && document.documentElement.classList.contains('ui-mobile') && window.wmShell) {
            return true;
        }

        // An installed client is never covered by a sign-in box (#899): the phone, and the desktop once it
        // is up, show the Nightshade Network as "Sign-in required" and sign in from its glyph / client.
        // The request fails quietly; it is the user's to sign in.
        const wsc = window.wsClient;
        if (window.uiShell === 'mobile' || (wsc && typeof wsc._nightshadeQuietDesktop === 'function' && wsc._nightshadeQuietDesktop())) {
            if (wsc && typeof wsc._updateModemTrayIcon === 'function') wsc._updateModemTrayIcon();
            return false;
        }

        // Show PIN modal for re-authentication
        if (pinModalPromise) return pinModalPromise;
        pinModalPromise = await window.showPinModal();

        // After re-authentication, try WebSocket first, then HTTP
        if (window.wsClient) {
            try {
                // Wait for WebSocket to reconnect after authentication
                await window.wsClient.waitForConnection(10000);

                // Verify authentication with WebSocket ping
                await window.wsClient.pingWithAuth();
                pinModalPromise = null;
                return true;
            } catch (wsError) {
                console.warn('WebSocket authentication after re-auth failed:', wsError);
                // Fall through to HTTP fallback
            }
        }
        pinModalPromise = null;
    } catch (error) {
        // User cancelled or other error
        console.error('Session validation error:', error);
        try {
            if (localStorage.getItem('dreamscapeSiteGate') === '1') {
                if (typeof showPinModal === 'function') {
                    await showPinModal();
                    return true;
                }
                window.location.replace((window.melatonHomeUrl ? window.melatonHomeUrl() : '/launch'));
                return false;
            }
        } catch (_) { /* ignore */ }
        window.location.href = '/';
        return false;
    }
}

// Initialize session validation after WebSocket is ready
async function initializeSessionValidation() {
    // Wait a bit for WebSocket to connect if it's available
    if (window.wsClient) {
        try {
            await window.wsClient.waitForConnection(5000);
        } catch (error) {
            console.warn('WebSocket not available, proceeding with HTTP authentication');
        }
    }

    await ensureSessionValid();

    // Set up periodic session validation
    pingTimeoutId = setTimeout(() => {
        ensureSessionValid();
    }, 15000);
}

