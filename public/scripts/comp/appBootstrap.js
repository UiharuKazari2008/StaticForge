/** App bootstrap — loadOptions / workspace from get_app_options (Phase 2 batch 13). */
// Flag to track if app data has been loaded
let appDataLoaded = false;

// Utility function to check if app data is ready
function isAppDataReady() {
    return appDataLoaded && window.optionsData && window.optionsData.ok;
}

// Load options from server with retry logic
async function loadOptions(maxRetries = 5, retryDelay = 500) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Ensure WebSocket is connected and ready
            if (!window.wsClient) {
                throw new Error('WebSocket client not initialized');
            }

            // Additional validation that the connection is stable
            if (window.wsClient.getConnectionState() !== 'connected') {
                throw new Error('WebSocket connection not in stable state');
            }

            // Add server readiness check before making the request
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected - server not ready');
            }

            // If health check passes, proceed with get_app_options
            const options = await window.wsClient.getAppOptions();

            if (!options || !options.ok) {
                const errorMsg = options?.error || 'Unknown error';
                console.error('❌ Application configuration load failed:', {
                    ok: options?.ok,
                    error: errorMsg,
                    hasUser: !!options?.user,
                    hasBalance: !!options?.balance,
                    connectionState: window.wsClient?.getConnectionState()
                });
                throw new Error("Failed to load application configuration: " + errorMsg);
            }

            window.optionsData = options;

            // resolveAccountDataStartupGate: public/scripts/comp/accountDataBootstrap.js
            const accountGate = await resolveAccountDataStartupGate(options);
            if (accountGate === 'cancelled') {
                const err = new Error('Account data startup cancelled by user');
                err.code = 'ACCOUNT_DATA_CANCELLED';
                throw err;
            }

            // applyNovelAiStatusFromOptions: public/scripts/comp/novelAiAccountStatus.js
            applyNovelAiStatusFromOptions(options);

            // loadDynamicGenerationQuips: public/scripts/comp/generationQuips.js
            if (typeof loadDynamicGenerationQuips === 'function') {
                loadDynamicGenerationQuips().catch(() => {});
            }

            if (typeof bootstrapVfsPathUuidFromOptions === 'function') {
                bootstrapVfsPathUuidFromOptions(options);
            }

            // Initialize datasetBias dynamically from config with default values
            if (window.optionsData?.datasets) {
                window.optionsData.datasets.forEach(dataset => {
                    // Use default value from config, fallback to 1.0
                    datasetBias[dataset.value] = dataset.default !== undefined ? dataset.default : 1.0;
                });
            }

            if (!isAccountDataDeferred() && window.optionsData?.user?.ok !== true && window.optionsData?.userDataValid !== true) {
                showGlassToast('warning', 'User Data Error', window.optionsData.user?.error || window.optionsData.userDataError || 'Failed to load user data', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }

            // Update subscription notifications (skip when account data deferred)
            if (!isAccountDataDeferred()) {
                updateSubscriptionNotifications().catch(error => { });
                updateSubscriptionRenewalIndicator();
                updateFixedCreditsIndicator();
                // maybeShowSubscriptionRenewalFailedNotice: public/scripts/comp/accountDataBootstrap.js
                maybeShowSubscriptionRenewalFailedNotice(window.optionsData);
            }

            // Handle active workspace data if provided
            if (window.optionsData?.activeWorkspace) {
                await handleWorkspaceDataFromOptions(window.optionsData.activeWorkspace);
            }

            // Check user type and show appropriate message
            const userType = localStorage.getItem('userType');
            if (userType === 'readonly') {
                showGlassToast('info', 'Read-Only Mode', 'You are logged in as a read-only user. Some features are restricted.', false, 8000, '<i class="fas fa-eye"></i>');
                disableReadOnlyFeatures();
            }

            // Mark app data as loaded
            appDataLoaded = true;

            // initMasterWsBridge: public/scripts/comp/masterWsBridge.js
            if (window.wsClient) {
                initMasterWsBridge(window.wsClient);
            }

            return; // Success, exit the retry loop

        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries) {
                showGlassToast('error', 'Critical Error', 'Failed to load application data. Please refresh the page or contact support.', false, false, '<i class="fas fa-exclamation-triangle"></i>');
            }
            console.error(`❌ Failed to load app options (attempt ${attempt}/${maxRetries}):`, error);
            if (attempt < maxRetries) {
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, retryDelay));

                // Increase delay for exponential backoff
                retryDelay = Math.min(retryDelay * 1.5, 10000);
            }
        }
    }

    // All retries failed
    const errorMessage = `Failed to load application configuration after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`;
    console.error(errorMessage);

    // Show critical error to user
    showGlassToast('error', 'Critical Error', 'Failed to load application data. Please refresh the page or contact support.', false, false, '<i class="fas fa-exclamation-triangle"></i>');

    // Throw the error to be handled by the caller
    throw new Error(errorMessage);
}

// Handle workspace data received from app options
async function handleWorkspaceDataFromOptions(workspaceInfo) {
    try {
        if (!workspaceInfo || !workspaceInfo.id || !workspaceInfo.data) {
            console.warn('⚠️ No valid workspace data in app options');
            return;
        }

        // Set the current workspace
        window.currentWorkspace = workspaceInfo.id;

        // Update workspace UI if the function exists
        if (window.updateWorkspaceUI) {
            window.updateWorkspaceUI(workspaceInfo.id);
        }

        // Update workspace selector if it exists
        const workspaceSelector = document.getElementById('workspace-selector');
        if (workspaceSelector) {
            workspaceSelector.value = workspaceInfo.id;
        }

        // Update workspace name display
        const workspaceNameElement = document.getElementById('workspace-name');
        if (workspaceNameElement && workspaceInfo.data.name) {
            workspaceNameElement.textContent = workspaceInfo.data.name;
        }

        // Keep Android persistent notification in sync with current workspace
        updateAndroidNotificationBody();
        clearAndroidNotificationImage();
    } catch (error) {
        console.error('❌ Error handling workspace data from options:', error);
    }
}

