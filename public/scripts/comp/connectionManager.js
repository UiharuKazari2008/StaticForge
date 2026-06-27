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
}

async function handleLogout() {
    try {
        const response = await fetchWithAuth('/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'logout'
            })
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

            window.location.href = '/';
        } else {
            showError('Logout failed');
        }
    } catch (error) {
        // Already redirected on 401
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
        updateBalanceDisplay(data.balance);
        // Update optionsData balance and increment version to keep things in sync
        if (window.optionsData) {
            window.optionsData.balance = data.balance;
        }

        // Subscription toasts need loaded user subscription data; skip until get_app_options has loaded
        if (appDataLoaded && isUserSubscriptionDataReady()) {
            updateSubscriptionNotifications().catch(error => {
            });
        }
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

