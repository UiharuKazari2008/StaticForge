/** App bootstrap — loadOptions / workspace from get_app_options (Phase 2 batch 13). */
// Flag to track if app data has been loaded
let appDataLoaded = false;

// Utility function to check if app data is ready
function isAppDataReady() {
    return appDataLoaded && window.optionsData && window.optionsData.ok;
}

// ---- App options chunks (Yozora #517) ----
// The logon loads a lean get_app_options. Parts only some windows use come with
// get_app_options_chunk and are merged into window.optionsData in place; nothing replaces or
// reloads the whole object after the boot:
//   text_replacements → optionsData.textReplacements + optionsData.preset_token_counts.expanders
//                       (Studio, autocomplete, Run, the token counter)
//   presets           → optionsData.presets (after a preset save, rename or delete)
const appOptionsChunkLoads = new Map(); // chunk → Promise while loading or once loaded

function appOptionsChunkIsLazy(name) {
    const lazy = window.optionsData && window.optionsData.lazyChunks;
    return Array.isArray(lazy) && lazy.indexOf(name) !== -1;
}

function appOptionsChunkPresent(name) {
    const data = window.optionsData;
    if (!data) return false;
    if (name === 'text_replacements') {
        return !!(data.textReplacements && data.preset_token_counts && data.preset_token_counts.expanders);
    }
    if (name === 'presets') return Array.isArray(data.presets);
    return false;
}

function applyAppOptionsChunk(name, chunk) {
    const data = window.optionsData;
    if (!data || !chunk) return;
    if (name === 'text_replacements') {
        data.textReplacements = chunk.textReplacements || {};
        data.preset_token_counts = Object.assign({}, data.preset_token_counts || {}, { expanders: chunk.expanders || {} });
    } else if (name === 'presets') {
        data.presets = Array.isArray(chunk.presets) ? chunk.presets : [];
    }
    // Caches keyed on the options version (presetTokenCount.js) rebuild
    data._cacheVersion = (Number(data._cacheVersion) || 0) + 1;
    document.dispatchEvent(new CustomEvent('appOptionsChunkLoaded', { detail: { chunk: name } }));
}

function fetchAppOptionsChunk(name) {
    const job = window.wsClient.sendMessage('get_app_options_chunk', { chunk: name }, false).then((result) => {
        const chunk = result && (result.data || result);
        if (!chunk || chunk.ok === false) throw new Error((chunk && chunk.error) || `chunk ${name} failed`);
        applyAppOptionsChunk(name, chunk);
        return true;
    }).catch((error) => {
        appOptionsChunkLoads.delete(name); // the next caller tries again
        console.warn(`App options chunk ${name} not loaded:`, error && error.message ? error.message : error);
        return false;
    });
    appOptionsChunkLoads.set(name, job);
    return job;
}

/** Load a chunk once (cached); resolves true when its data is in optionsData. */
function ensureAppOptionsChunk(name) {
    if (!appOptionsChunkIsLazy(name) || appOptionsChunkPresent(name) && !appOptionsChunkLoads.has(name)) {
        return Promise.resolve(appOptionsChunkPresent(name));
    }
    if (appOptionsChunkLoads.has(name)) return appOptionsChunkLoads.get(name);
    if (!window.wsClient || !window.wsClient.isConnected()) return Promise.resolve(false);
    return fetchAppOptionsChunk(name);
}

/** After a change: fetch the chunk again if it was loaded (or is the eager presets list). */
function refreshAppOptionsChunk(name) {
    if (!window.wsClient || !window.wsClient.isConnected()) return Promise.resolve(false);
    if (name !== 'presets' && !appOptionsChunkLoads.has(name) && !appOptionsChunkPresent(name)) {
        return Promise.resolve(false); // never loaded: the first ensure gets fresh data
    }
    return fetchAppOptionsChunk(name);
}

function carryAppOptionsChunks(previous, next) {
    if (!previous || !next || !Array.isArray(next.lazyChunks)) return;
    if (next.lazyChunks.indexOf('text_replacements') !== -1 && previous.textReplacements && !next.textReplacements) {
        next.textReplacements = previous.textReplacements;
        const expanders = previous.preset_token_counts && previous.preset_token_counts.expanders;
        if (expanders) next.preset_token_counts = Object.assign({}, next.preset_token_counts || {}, { expanders });
    }
}

// Idle prefetch once the desktop is up (or after the boot elsewhere), so Studio rarely waits
function prefetchAppOptionsChunksWhenIdle() {
    const run = () => { ensureAppOptionsChunk('text_replacements'); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 1000);
}
document.addEventListener('desktopBootDone', prefetchAppOptionsChunksWhenIdle, { once: true });

// Load options from server with retry logic
async function loadOptions(maxRetries = 5, retryDelay = 500) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Ensure WebSocket client is initialized
            if (!window.wsClient) {
                throw new Error('WebSocket client not initialized');
            }

            // Wait for WebSocket connection to be established and stable if not currently connected
            if (!window.wsClient.isConnected() || window.wsClient.getConnectionState() !== 'connected') {
                console.log(`⏳ [loadOptions] Waiting for WebSocket connection to stabilize (attempt ${attempt}/${maxRetries})...`);
                await window.wsClient.waitForConnection(10000);
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

            // Chunks loaded on demand since the last load stay (a retry must not drop them)
            const previousOptions = window.optionsData;
            window.optionsData = options;
            carryAppOptionsChunks(previousOptions, options);

            // resolveAccountDataStartupGate: public/scripts/comp/accountDataBootstrap.js
            const accountGate = await resolveAccountDataStartupGate(options);
            if (accountGate === 'cancelled') {
                const err = new Error('Account data startup cancelled by user');
                err.code = 'ACCOUNT_DATA_CANCELLED';
                throw err;
            }

            // applyNovelAiStatusFromOptions: public/scripts/comp/novelAiAccountStatus.js
            applyNovelAiStatusFromOptions(options);

            // usageToolManager: public/scripts/comp/usageToolManager.js
            usageToolManager.updateUsage(options.opusUsage);

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
            // The desktop prefetches on desktopBootDone; the phone / narrow app has no staged boot
            if (!window.isDesktop) prefetchAppOptionsChunksWhenIdle();

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

