class ServiceWorkerManager {
    constructor() {
        this.swRegistration = null;
        this.updateAvailable = false;
        this.updateProgress = 0;
        this.isUpdating = false;
        this.messageHandlers = new Map();
        this.pendingRequests = new Map();
        this.updateToastId = null;
        this.checkingToastId = null;
        this.timeoutToastId = null;
        this.swReadyTimeout = null;
        this.initialCheckDone = false;

        // Client-side key caching
        this.cachedRollingKey = null;
        this.keyExpiresAt = 0;
        this.keyFetchPromise = null;
        this.lastKeyRequestTime = 0;
        this.keyRequestCount = 0;
        this.KEY_REFRESH_BUFFER = 60000; // Refresh 1 minute before expiry
        this.KEY_REQUEST_COOLDOWN = 5000; // Minimum 5 seconds between requests
        this.MAX_KEY_REQUESTS_PER_MINUTE = 10;

        this.init();
    }

    // Client-side key caching methods
    async getCachedRollingKey() {
        const now = Date.now();
        
        // Check if we have a valid cached key
        if (this.cachedRollingKey && this.keyExpiresAt > 0 && now < this.keyExpiresAt - this.KEY_REFRESH_BUFFER) {
            console.log('🔑 Using cached rolling key');
            return this.cachedRollingKey;
        }

        // Check rate limiting
        if (this.lastKeyRequestTime > 0 && now - this.lastKeyRequestTime < this.KEY_REQUEST_COOLDOWN) {
            console.log('🔑 Key request in cooldown, using cached key if available');
            return this.cachedRollingKey;
        }

        // Check if we're already fetching a key
        if (this.keyFetchPromise) {
            console.log('🔑 Key fetch already in progress, waiting...');
            return this.keyFetchPromise;
        }

        // Reset request count if it's been more than a minute
        if (now - this.lastKeyRequestTime > 60000) {
            this.keyRequestCount = 0;
        }

        // Check if we've exceeded rate limit
        if (this.keyRequestCount >= this.MAX_KEY_REQUESTS_PER_MINUTE) {
            console.warn('🔑 Key request rate limit exceeded, using cached key');
            return this.cachedRollingKey;
        }

        // Fetch new key
        this.keyFetchPromise = this.fetchRollingKey();
        
        try {
            const result = await this.keyFetchPromise;
            return result;
        } finally {
            this.keyFetchPromise = null;
        }
    }

    async fetchRollingKey() {
        const now = Date.now();
        this.lastKeyRequestTime = now;
        this.keyRequestCount++;

        try {
            console.log('🔑 Fetching new rolling key...');
            const keyResponse = await fetch('/sw.js', {
                method: 'OPTIONS',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                    'Pragma': 'no-cache'
                }
            });

            if (!keyResponse.ok) {
                throw new Error(`Failed to fetch rolling key: ${keyResponse.status}`);
            }

            const keyData = await keyResponse.json();
            this.cachedRollingKey = keyData.key;
            this.keyExpiresAt = keyData.expiresAt;

            console.log('🔑 Rolling key cached successfully');
            return this.cachedRollingKey;

        } catch (error) {
            console.error('🔑 Failed to fetch rolling key:', error);
            
            // Return cached key if available, even if expired
            if (this.cachedRollingKey) {
                console.log('🔑 Using expired cached key as fallback');
                return this.cachedRollingKey;
            }
            
            throw error;
        }
    }
    
    async init() {
        if ('serviceWorker' in navigator) {
            try {
                // Register service worker
                this.swRegistration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered:', this.swRegistration);

                // Listen for updates
                this.swRegistration.addEventListener('updatefound', () => {
                    console.log('Service Worker update found');
                    this.checkForUpdates();
                });

                // Listen for state changes on the installing worker
                if (this.swRegistration.installing) {
                    this.swRegistration.installing.addEventListener('statechange', (event) => {
                        console.log('Service Worker installing state changed:', event.target.state);
                        if (event.target.state === 'installed') {
                            console.log('Service Worker installed successfully');
                        }
                    });
                }

                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', (event) => {
                    this.handleServiceWorkerMessage(event);
                });

                // Check current state immediately after registration
                console.log('Service Worker registration state:', {
                    active: !!this.swRegistration.active,
                    waiting: !!this.swRegistration.waiting,
                    installing: !!this.swRegistration.installing,
                    controller: !!navigator.serviceWorker.controller,
                    activeState: this.swRegistration.active?.state || 'none'
                });

                // Check if there's an update waiting
                if (this.swRegistration.waiting) {
                    console.log('Service Worker is waiting for activation');
                    this.checkForWaiting();
                }

                // Wait for service worker to be ready, with iOS-specific handling
                await this.waitForServiceWorkerReady();

            } catch (error) {
                console.error('Service Worker registration failed:', error);
                console.error('Service Worker error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
                this.handleServiceWorkerError(error);
            }
        } else {
            console.warn('Service Worker not supported in this browser');
            this.handleServiceWorkerNotSupported();
        }
    }

    async waitForServiceWorkerReady() {
        return new Promise((resolve, reject) => {
            // Immediate check - if service worker is already ready, resolve immediately
            const immediateIsActive = this.swRegistration.active;
            const immediateHasController = navigator.serviceWorker.controller;
            const immediateIsActivated = immediateIsActive?.state === 'activated';

            if (immediateIsActive || immediateHasController || immediateIsActivated) {
                resolve();
                return;
            }

            console.log('⏳ Service Worker not immediately ready, starting wait logic...');
            let checkInterval;

            const checkReady = () => {
                // Check multiple readiness indicators
                const isActive = this.swRegistration.active;
                const isWaiting = this.swRegistration.waiting;
                const isInstalling = this.swRegistration.installing;
                const hasController = navigator.serviceWorker.controller;

                console.log('🔍 Service Worker state check:', {
                    active: !!isActive,
                    waiting: !!isWaiting,
                    installing: !!isInstalling,
                    controller: !!hasController,
                    activeState: isActive?.state || 'none'
                });

                // Service worker is ready if it's active OR if we have a controller (page is controlled)
                // Also check if active service worker state is 'activated'
                const isActivated = isActive?.state === 'activated';
                const isReady = isActive || hasController || isActivated;

                console.log('🔍 Ready evaluation:', {
                    isActive: !!isActive,
                    hasController: !!hasController,
                    isActivated: isActivated,
                    isReady: isReady,
                    condition: 'isActive || hasController || isActivated'
                });

                if (isReady) {
                    // Clear any existing timeout and interval
                    if (this.swReadyTimeout) {
                        clearTimeout(this.swReadyTimeout);
                        this.swReadyTimeout = null;
                    }
                    if (checkInterval) {
                        clearInterval(checkInterval);
                    }
                    resolve();
                    return; // Make sure we don't continue
                }
                console.log('⏳ Service Worker not ready yet, continuing to wait...');
                // Continue waiting if not ready yet
            };

            // Listen for controllerchange event (when service worker becomes active)
            const controllerChangeHandler = () => {
                console.log('🎯 Service Worker controller changed - service worker is now active');
                navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);

                // Clear timeout and interval
                if (this.swReadyTimeout) {
                    clearTimeout(this.swReadyTimeout);
                    this.swReadyTimeout = null;
                }
                if (checkInterval) {
                    clearInterval(checkInterval);
                }

                // Check for static file updates once ready (only if not already done)
                if (!this.initialCheckDone) {
                    this.initialCheckDone = true;
                    this.checkStaticFileUpdates(true);
                }
                resolve();
            };

            navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);

            // Start periodic checking as fallback
            checkInterval = setInterval(checkReady, 200); // Check every 200ms instead of 100ms

            // Initial check
            checkReady();

            // Set a timeout for iOS devices (they can be slower)
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const timeoutMs = isIOS ? 15000 : 10000; // Longer timeout for iOS

            this.swReadyTimeout = setTimeout(() => {
                console.warn('⚠️ Service Worker ready timeout - proceeding anyway (this is normal)');
                console.warn('Service Worker state at timeout:', {
                    active: !!this.swRegistration?.active,
                    waiting: !!this.swRegistration?.waiting,
                    installing: !!this.swRegistration?.installing,
                    controller: !!navigator.serviceWorker?.controller,
                    state: this.swRegistration?.active?.state || 'unknown'
                });

                // Clear interval
                if (checkInterval) {
                    clearInterval(checkInterval);
                }

                // Remove event listener
                navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);

                this.handleServiceWorkerTimeout();
                resolve();
            }, timeoutMs);
        });
    }

    handleServiceWorkerError(error) {
        // Mark service worker as unavailable but don't break the app
        this.swRegistration = null;

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'warning',
                'Service Worker Unavailable',
                'Service worker failed to initialize. Some features are disabled.',
                false,
                5000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    handleServiceWorkerNotSupported() {
        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'warning',
                'Service Worker Not Supported',
                'Your browser doesn\'t support service workers. Cache updates are unavailable.',
                false,
                5000,
                '<i class="fas fa-info-circle"></i>'
            );
        }
    }

    handleServiceWorkerTimeout() {
        console.log('ℹ️ Service Worker initialization completed (timeout reached)');

        // Show toast with option to force update service worker
        if (typeof showGlassToast === 'function') {
            this.timeoutToastId = showGlassToast(
                'warning',
                'Service Worker Slow',
                'Service worker took longer than expected to initialize.',
                false,
                10000, // Show for 10 seconds
                '<i class="fas fa-clock"></i>'
            );

            // Add button to force update after a short delay
            setTimeout(() => {
                if (this.timeoutToastId && typeof updateGlassToastButtons === 'function') {
                    const updateButton = {
                        text: 'Force Restart',
                        type: 'primary',
                        onClick: () => {
                            console.log('User requested service worker update');
                            this.forceUpdateServiceWorker();
                        },
                        closeOnClick: false // Keep toast open during update
                    };

                    const dismissButton = {
                        text: 'Dismiss',
                        type: 'secondary',
                        onClick: () => {
                            console.log('User dismissed service worker timeout notification');
                        },
                        closeOnClick: true
                    };

                    updateGlassToastButtons(this.timeoutToastId, [updateButton, dismissButton]);
                }
            }, 1000); // Wait 1 second before adding buttons
        }
    }
    
    async checkStaticFileUpdates(noToast = false) {
        try {
            // Get cached rolling key with independent refresh logic
            const rollingKey = await this.getCachedRollingKey();

            // Make the actual request with the rolling key
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
                    'X-SW-Key': rollingKey,
                    'X-Service-Worker-Version': '2.0',
                    'X-Requested-With': 'ServiceWorker'
                }
            });

            if (response.ok) {
                const files = await response.json();
                await this.updateStaticCache(files, noToast);
            }
        } catch (error) {
            console.error('Failed to check static file updates:', error);
        }
    }
    
    async updateStaticCache(files, noToast = false) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready');
            this.showServiceWorkerNotReadyToast();
            return;
        }

        try {
            console.log('Checking for static file updates...');

            // Show initial toast immediately to indicate checking is happening
            this.showCheckingForUpdatesToast();

            // Check which files need updating
            const filesToUpdate = await this.getFilesNeedingUpdate(files);

            console.log(`Found ${filesToUpdate.length} files that need updating:`, filesToUpdate);

            if (filesToUpdate.length > 0) {
                console.log(`Found ${filesToUpdate.length} files that need updating`);
                // Update existing checking toast to show download progress
                this.showUpdateToastFromChecking(filesToUpdate);

                // Start background caching
                this.swRegistration.active.postMessage({
                    type: 'CACHE_STATIC_FILES',
                    files: filesToUpdate
                });
            } else if (!noToast) {
                // Update existing checking toast to show "no updates"
                this.showNoUpdatesFromChecking();
                if (this.swRegistration && this.swRegistration.active) {
                    this.swRegistration.active.postMessage({
                        type: 'NO_UPDATES_AVAILABLE'
                    });
                }
            } else {
                // Silently remove checking toast when noToast is true
                if (this.checkingToastId && typeof removeGlassToast === 'function') {
                    removeGlassToast(this.checkingToastId);
                    this.checkingToastId = null;
                }
                console.log('No application updates found');
            }
        } catch (error) {
            console.error('Error updating static cache:', error);
            this.showCacheUpdateErrorFromChecking(error);
        }
    }
    
    async getFilesNeedingUpdate(files) {
        const filesToUpdate = [];
        
        for (const file of files) {
            try {
                const cache = await caches.open('static-cache-v1');
                const cachedResponse = await cache.match(file.url);
                
                if (!cachedResponse) {
                    filesToUpdate.push(file);
                    continue;
                }
                
                // Check if hash matches - look for the hash in multiple places
                let cachedHash = cachedResponse.headers.get('x-file-hash');
                
                // If no hash in headers, try to get it from the response URL or other sources
                if (!cachedHash) {
                    // Try to extract hash from response URL if it was stored there
                    const responseUrl = cachedResponse.url;
                    const urlHashMatch = responseUrl.match(/[?&]hash=([^&]+)/);
                    if (urlHashMatch) {
                        cachedHash = urlHashMatch[1];
                    }
                }
                
                if (!cachedHash || cachedHash !== file.hash) {
                    console.log(`Hash mismatch or missing for ${file.url}, adding to update list`);
                    filesToUpdate.push(file);
                }
            } catch (error) {
                console.error(`Error checking file ${file.url}:`, error);
                filesToUpdate.push(file);
            }
        }
        return filesToUpdate;
    }
    
    showCheckingForUpdatesToast() {
        if (typeof showGlassToast === 'function') {
            this.checkingToastId = showGlassToast(
                'info',
                'Checking for Updates',
                'Scanning for available updates...',
                false,
                false,
                '<i class="fas fa-search"></i>'
            );
        }
    }

    showServiceWorkerNotReadyToast() {
        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'warning',
                'Service Worker Unavailable',
                'Cache updates require service worker. Try refreshing the page.',
                false,
                5000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    showNoUpdatesToast() {
        // Hide checking toast if it exists
        if (this.checkingToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'success',
                'Up to Date',
                'Your app is already up to date!',
                false,
                3000,
                '<i class="fas fa-check-circle"></i>'
            );
        }
    }

    showCacheUpdateErrorToast(error) {
        // Hide checking toast if it exists
        if (this.checkingToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'error',
                'Update Check Failed',
                'Failed to check for updates. Please try again.',
                false,
                5000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    showCacheFileErrorToast(file, error) {
        if (typeof showGlassToast === 'function') {
            // Extract filename from URL for cleaner display
            const filename = file.split('/').pop() || file;
            showGlassToast(
                'warning',
                'Cache Error',
                `Failed to cache ${filename}: ${error}`,
                false,
                3000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    // Methods to update the existing checking toast instead of replacing it
    showUpdateToastFromChecking(files) {
        // Convert checking toast to download progress toast
        this.updateAvailable = true;
        this.isUpdating = true;
        this.updateProgress = 0;

        if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
            updateGlassToastComplete(this.checkingToastId, {
                type: 'info',
                title: 'Downloading Updates',
                message: `Downloading ${files.length} updates...`,
                showProgress: true,
                customIcon: '<i class="fas fa-download"></i>'
            });
            // Keep the same toast ID for progress updates
            this.updateToastId = this.checkingToastId;
            this.checkingToastId = null;
        }
    }

    showNoUpdatesFromChecking() {
        if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
            updateGlassToastComplete(this.checkingToastId, {
                type: 'success',
                title: 'Up to Date',
                message: 'Your app is already up to date!',
                showProgress: false,
                customIcon: '<i class="fas fa-check-circle"></i>',
                timeout: 3000
            });
            // Clear the checking toast ID since it's now a completion toast
            this.checkingToastId = null;
        }
    }

    showCacheUpdateErrorFromChecking(error) {
        if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
            updateGlassToastComplete(this.checkingToastId, {
                type: 'error',
                title: 'Update Check Failed',
                message: 'Failed to check for updates. Please try again.',
                showProgress: false,
                customIcon: '<i class="fas fa-exclamation-triangle"></i>'
            });
            // Clear the checking toast ID since it's now an error toast
            this.checkingToastId = null;
        }
    }

    showUpdateToast(files) {
        // Hide checking toast if it exists
        if (this.checkingToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        this.updateAvailable = true;
        this.isUpdating = true;
        this.updateProgress = 0;

        // Check if showGlassToast function is available
        if (typeof showGlassToast === 'function') {
            // Show progress toast
            this.updateToastId = showGlassToast(
                'info',
                'Downloading Updates',
                `Downloading ${files.length} updates...`,
                true,
                false,
                '<i class="fas fa-download"></i>'
            );
        }
    }
    
    updateProgressToast(progress) {
        this.updateProgress = progress;
        if (this.updateToastId && typeof updateGlassToastProgress === 'function') {
            updateGlassToastProgress(this.updateToastId, progress);
        }
    }
    
    hideUpdateToast() {
        if (this.updateToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.updateToastId);
            this.updateToastId = null;
        }
        this.updateAvailable = false;
        this.isUpdating = false;
    }
    
    async cacheInternalData(url, data) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - skipping cache operation');
            return false;
        }
        
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            
            // Set up message handler
            const handler = (event) => {
                if (event.data.type === 'INTERNAL_CACHE_COMPLETE' && 
                    event.data.url === url) {
                    this.messageHandlers.delete(requestId);
                    resolve(true);
                }
            };
            
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send message to service worker
            this.swRegistration.active.postMessage({
                type: 'CACHE_INTERNAL',
                url: url,
                data: data
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Cache operation timed out'));
                }
            }, 10000);
        });
    }
    
    async getCacheStatus() {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - cannot get cache status');
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            
            // Set up message handler
            const handler = (event) => {
                if (event.data.type === 'CACHE_STATUS' && 
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    resolve({
                        static: event.data.static,
                        dynamic: event.data.dynamic,
                        internal: event.data.internal
                    });
                }
            };
            
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send message to service worker
            this.swRegistration.active.postMessage({
                type: 'GET_CACHE_STATUS',
                requestId: requestId
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Status request timed out'));
                }
            }, 5000);
        });
    }
    
    handleServiceWorkerMessage(event) {
        const { type, files, url, completed, total, currentFile } = event.data;
        
        switch (type) {
            case 'STATIC_CACHE_PROGRESS':
                const progress = Math.round((completed / total) * 100);
                this.updateProgressToast(progress);
                break;
                
            case 'STATIC_CACHE_COMPLETE':
                this.isUpdating = false;
                this.updateProgressToast(100);
                
                // Show completion message with restart button
                setTimeout(() => {
                    this.showUpdateCompleteToast();
                }, 1000);
                break;
                
            case 'INTERNAL_CACHE_COMPLETE':
                break;
                
            case 'CACHE_STATUS':
                // Handle cache status response
                const handler = this.messageHandlers.get(event.data.requestId);
                if (handler) {
                    handler(event);
                }
                break;

            case 'STATIC_CACHE_ERROR':
                // Handle cache error during file caching
                console.error(`Cache error for ${event.data.file}: ${event.data.error}`);
                this.showCacheFileErrorToast(event.data.file, event.data.error);
                break;

            case 'ping':
                // Handle ping messages from service worker
                console.log('Received ping from service worker:', event.data);
                break;
        }
    }
    
    async checkForWaiting() {
        if (this.swRegistration && this.swRegistration.waiting) {
            console.log('Service worker update waiting, activating...');

            // Show notification about update being available
            if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'info',
                    'Update Ready',
                    'A new version is ready. Activating update...',
                    false,
                    3000,
                    '<i class="fas fa-sync"></i>'
                );
            }

            // Send skip waiting message
            this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });

            // Wait a moment for the new service worker to activate
            setTimeout(() => {
                console.log('Reloading page to activate new service worker');
                window.location.reload();
            }, 1000);
        }
    }
    
    // Public method to manually trigger update check
    async checkForUpdates() {
        if (this.swRegistration) {
            await this.swRegistration.update();
        }
    }
    
    // Public method to get cache statistics
    async getCacheStats() {
        try {
            const status = await this.getCacheStatus();
            return status;
        } catch (error) {
            console.error('Failed to get cache stats:', error);
            return null;
        }
    }

    // Public method to check service worker health
    async checkServiceWorkerHealth() {
        try {
            if (!this.swRegistration) {
                return { healthy: false, reason: 'No service worker registration' };
            }

            const hasActive = !!this.swRegistration.active;
            const hasController = !!navigator.serviceWorker.controller;
            const isReady = hasActive || hasController;

            return {
                healthy: isReady,
                active: hasActive,
                controller: hasController,
                state: this.swRegistration.active?.state || 'unknown',
                scope: this.swRegistration.scope,
                installing: !!this.swRegistration.installing,
                waiting: !!this.swRegistration.waiting
            };
        } catch (error) {
            console.error('Error checking service worker health:', error);
            return { healthy: false, reason: error.message };
        }
    }

    // Clear timeout toast
    clearTimeoutToast() {
        if (this.timeoutToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.timeoutToastId);
            this.timeoutToastId = null;
        }
    }

    // Public method to force unregister and reregister service worker
    async forceUpdateServiceWorker() {
        console.log('🔄 Force updating service worker...');

        try {
            // Show loading state in the toast
            if (this.timeoutToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.timeoutToastId, {
                    type: 'info',
                    title: 'Updating Service Worker',
                    message: 'Please wait while we update the service worker...',
                    customIcon: '<i class="fas fa-spinner fa-spin"></i>'
                });
            }

            // Step 1: Unregister current service worker
            if (this.swRegistration) {
                console.log('🗑️ Unregistering current service worker...');
                const unregistered = await this.swRegistration.unregister();
                console.log('Unregister result:', unregistered);

                // Clear current registration
                this.swRegistration = null;
                this.updateAvailable = false;
                this.isUpdating = false;
                this.initialCheckDone = false;
            }

            // Step 2: Clear any existing timeouts
            if (this.swReadyTimeout) {
                clearTimeout(this.swReadyTimeout);
                this.swReadyTimeout = null;
            }

            // Step 3: Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 4: Force refresh the service worker cache
            console.log('🔄 Fetching fresh service worker...');
            const response = await fetch('/sw.js', {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch service worker: ${response.status}`);
            }

            console.log('✅ Fresh service worker fetched');

            // Step 5: Reregister service worker
            console.log('📝 Reregistering service worker...');
            this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/',
                updateViaCache: 'none' // Force fresh fetch
            });

            console.log('✅ Service worker reregistered:', this.swRegistration);

            // Step 6: Reinitialize event listeners
            this.swRegistration.addEventListener('updatefound', () => {
                console.log('🔄 Service Worker update found after force update');
                this.checkForUpdates();
            });

            if (this.swRegistration.installing) {
                this.swRegistration.installing.addEventListener('statechange', (event) => {
                    console.log('Service Worker installing state changed after force update:', event.target.state);
                });
            }

            // Re-add message listener
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event);
            });

            // Step 7: Wait for new service worker to be ready
            await this.waitForServiceWorkerReady();

            console.log('🎉 Service worker force update completed successfully');

            // Show success message
            if (this.timeoutToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.timeoutToastId, {
                    type: 'success',
                    title: 'Service Worker Updated',
                    message: 'Service worker has been successfully updated and reregistered.',
                    customIcon: '<i class="fas fa-check-circle"></i>'
                });

                // Auto-close success toast after 3 seconds
                setTimeout(() => {
                    this.clearTimeoutToast();
                }, 3000);
            } else if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'success',
                    'Service Worker Updated',
                    'Service worker has been successfully updated and reregistered.',
                    false,
                    3000,
                    '<i class="fas fa-check-circle"></i>'
                );
            }

            return { success: true, message: 'Service worker updated successfully' };

        } catch (error) {
            console.error('❌ Error during service worker force update:', error);

            // Show error message in the existing toast or create a new one
            if (this.timeoutToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.timeoutToastId, {
                    type: 'error',
                    title: 'Update Failed',
                    message: `Failed to update service worker: ${error.message}`,
                    customIcon: '<i class="fas fa-exclamation-triangle"></i>'
                });
            } else if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'error',
                    'Update Failed',
                    `Failed to update service worker: ${error.message}`,
                    false,
                    5000,
                    '<i class="fas fa-exclamation-triangle"></i>'
                );
            }

            return { success: false, error: error.message };
        }
    }

    // Refresh server cache and check for updates
    async refreshServerCacheAndCheck() {
        console.log('Refreshing server cache and checking for updates...');
        try {
            // Check if WebSocket client is available
            if (window.wsClient && window.wsClient.isConnected()) {
                // Use WebSocket to refresh server cache
                const result = await window.wsClient.refreshServerCache();
                console.log('Server cache refresh result:', result);

                // Wait a moment for the server to process
                setTimeout(async () => {
                    // Check for static file updates
                    await this.checkStaticFileUpdates();
                }, 1000);

            } else {
                console.warn('WebSocket not connected, using HTTP fallback');
                // Fallback to HTTP OPTIONS request
                await this.checkStaticFileUpdates();
            }
        } catch (error) {
            console.error('Error refreshing server cache:', error);
        }
    }

    // Initialization step: Check for and download updates as part of startup process
    async checkAndDownloadUpdatesForInit() {
        try {
            console.log('🔍 Checking for application updates during startup...');

            // Get cached rolling key with independent refresh logic
            const rollingKey = await this.getCachedRollingKey();

            // Make the actual request with the rolling key
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
                    'X-SW-Key': rollingKey,
                    'X-Service-Worker-Version': '2.0',
                    'X-Requested-With': 'ServiceWorker'
                }
            });

            if (!response.ok) {
                console.log('No update information available, continuing...');
                this.initialCheckDone = true;
                return; // No updates available
            }

            const files = await response.json();

            // Check which files need updating
            const filesToUpdate = await this.getFilesNeedingUpdate(files);

            if (filesToUpdate.length === 0) {
                console.log('✅ No updates available');
                this.initialCheckDone = true;
                return; // No updates needed
            }

            console.log(`📦 Found ${filesToUpdate.length} updates to download`);

            // Start downloading updates with integrated progress - AWAIT the result
            const downloadResult = await this.downloadUpdatesForInit(filesToUpdate);
            this.initialCheckDone = true;

            console.log('Update download process completed:', downloadResult);

            // If user chose to skip, the download result will indicate this
            // If updates were downloaded successfully, user will be prompted with Restart/Skip buttons
            // In either case, we return here and let the initialization continue

        } catch (error) {
            console.error('❌ Error during update check:', error);
            this.initialCheckDone = true;
            // Don't fail the startup process for update check errors - continue normally
        }
    }

    // Download updates with integrated progress for initialization
    async downloadUpdatesForInit(files) {
        return new Promise((resolve) => {
            if (!this.swRegistration || !this.swRegistration.active) {
                console.warn('Service Worker not ready for updates');
                resolve({ success: false, reason: 'Service Worker not ready' });
                return;
            }

            let updatesDownloaded = 0;
            let hasErrors = false;
            let skipRequested = false;
            let downloadCompleted = false;

            // Add Skip button to the progress notification
            if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastButtons === 'function') {
                const skipButton = {
                    text: 'Skip',
                    type: 'secondary',
                    onClick: () => {
                        console.log('User chose to skip update download during startup');
                        skipRequested = true;

                        // Hide the progress notification buttons
                        if (typeof updateGlassToastButtons === 'function') {
                            updateGlassToastButtons(window.wsClient.progressToastId, []);
                        }

                        // Show the normal update toast
                        this.showUpdateToast(files);

                        // Resolve immediately when skipped
                        if (!downloadCompleted) {
                            downloadCompleted = true;
                            resolve({ success: false, skipped: true });
                        }
                    },
                    closeOnClick: false
                };

                updateGlassToastButtons(window.wsClient.progressToastId, [skipButton]);
            }

            // Listen for progress updates
            const progressHandler = (event) => {
                if (skipRequested || downloadCompleted) return; // Ignore if already handled

                if (event.data.type === 'STATIC_CACHE_PROGRESS') {
                    const progress = Math.round((event.data.completed / event.data.total) * 100);
                    // Update the startup progress notification with download progress
                    if (window.wsClient) {
                        window.wsClient.updateProgressNotification(`Downloading updates... (${event.data.completed}/${event.data.total})`, progress); // 10-90% range
                    }
                } else if (event.data.type === 'STATIC_CACHE_COMPLETE') {
                    updatesDownloaded = event.data.total;
                    navigator.serviceWorker.removeEventListener('message', progressHandler);

                    if (window.wsClient) {
                        window.wsClient.updateProgressNotification(`Downloading updates...`, 100); // 10-90% range
                    }
                    if (!skipRequested && !downloadCompleted) {
                        downloadCompleted = true;
                        console.log(`Update download completed with ${updatesDownloaded} files downloaded${hasErrors ? ' (with errors)' : ''}`);

                        // Show Restart and Skip buttons if updates were downloaded successfully
                        if (!hasErrors && updatesDownloaded > 0) {
                            this.showRestartSkipButtonsForInit((choice) => {
                                resolve({ success: true, filesDownloaded: updatesDownloaded, userChoice: choice.action });
                            });
                        } else {
                            resolve({ success: false, filesDownloaded: updatesDownloaded, hasErrors });
                        }
                    }
                } else if (event.data.type === 'STATIC_CACHE_ERROR') {
                    console.error(`Cache error for ${event.data.file}: ${event.data.error}`);
                    hasErrors = true;
                    // Continue with other files - don't resolve here
                }
            };

            navigator.serviceWorker.addEventListener('message', progressHandler);

            // Start caching
            this.swRegistration.active.postMessage({
                type: 'CACHE_STATIC_FILES',
                files: files
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!skipRequested && !downloadCompleted) {
                    navigator.serviceWorker.removeEventListener('message', progressHandler);
                    downloadCompleted = true;
                    console.log(`Update download timed out with ${updatesDownloaded} files downloaded${hasErrors ? ' (with errors)' : ''}`);
                    resolve({
                        success: !hasErrors && updatesDownloaded > 0,
                        filesDownloaded: updatesDownloaded,
                        hasErrors,
                        timedOut: true
                    });
                }
            }, 30000);
        });
    }

    // Show Restart and Skip buttons for initialization updates
    showRestartSkipButtonsForInit(onUserChoice) {
        if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastButtons === 'function') {
            const restartButton = {
                text: 'Restart',
                type: 'primary',
                onClick: () => {
                    console.log('User chose to restart after update during startup');
                    // Force restart - this will reload the page
                    this.forceRestart();
                    // Don't call onUserChoice since page will reload
                },
                closeOnClick: false
            };

            const skipButton = {
                text: 'Skip',
                type: 'secondary',
                onClick: () => {
                    console.log('User chose to skip restart after update during startup');

                    // Reset toast to info type and show progress bar
                    if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastComplete === 'function') {
                        updateGlassToastComplete(window.wsClient.progressToastId, {
                            type: 'info',
                            title: 'Dreamscape',
                            message: 'Continuing...',
                            customIcon: '<i class="fa-duotone fa-star-christmas"></i>',
                            showProgress: true
                        });
                        // Show progress at 95% since updates are downloaded but we're continuing
                        if (typeof updateGlassToastProgress === 'function') {
                            updateGlassToastProgress(window.wsClient.progressToastId, 95);
                        }
                    }

                    onUserChoice({ action: 'skip', success: true });
                },
                closeOnClick: false
            };

            updateGlassToastButtons(window.wsClient.progressToastId, [restartButton, skipButton]);

            // Update the progress notification to show completion with warning styling and hidden progress bar
            if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(window.wsClient.progressToastId, {
                    type: 'warning',
                    title: 'Dreamscape',
                    message: 'Updates downloaded. Restart to apply changes.',
                    customIcon: '<i class="fa-duotone fa-star-christmas"></i>',
                    showProgress: false,
                    timeout: false
                });
            }
        } else {
            // Fallback if buttons can't be added - continue with skip
            console.log('Could not show restart/skip buttons, continuing with skip');
            onUserChoice({ action: 'skip', success: true });
        }
    }

    // Manual retry for cache updates (useful for iOS or failed updates)
    async retryCacheUpdate() {
        console.log('Manual retry of cache update requested');
        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'info',
                'Retrying Updates',
                'Checking for available updates...',
                false,
                3000,
                '<i class="fas fa-redo"></i>'
            );
        }

        try {
            await this.checkStaticFileUpdates();
        } catch (error) {
            console.error('Manual cache update retry failed:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'error',
                    'Retry Failed',
                    'Manual update retry failed. Please refresh the page.',
                    false,
                    5000,
                    '<i class="fas fa-exclamation-triangle"></i>'
                );
            }
        }
    }
    
    // Show update complete toast with restart button
    showUpdateCompleteToast() {
        if (this.updateToastId && typeof updateGlassToastButtons === 'function') {
            const restartButton = {
                text: 'Restart Now',
                type: 'primary',
                onClick: () => {
                    console.log('Restart requested by user');
                    this.forceRestart();
                },
                closeOnClick: true
            };
            
            const laterButton = {
                text: 'Later',
                type: 'secondary',
                onClick: () => {
                    console.log('User chose to restart later');
                },
                closeOnClick: true
            };
            
            updateGlassToastButtons(this.updateToastId, [restartButton, laterButton]);
            
            // Update the toast content to show completion
            if (typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.updateToastId, {
                    type: 'success',
                    title: 'Updates Complete',
                    message: 'Updates have been downloaded. Restart to apply changes.',
                    customIcon: '<i class="fas fa-check-circle"></i>'
                });
            }
        }
    }
    
    // Force restart with bypass confirmation
    forceRestart() {
        console.log('🔄 Force restarting application...');
        
        try {
            // Set bypass confirmation to true to avoid confirmation dialogs
            bypassConfirmation = true;
            
            // Small delay to ensure bypass confirmation is set
            setTimeout(() => {
                try {
                    window.location.reload();
                } catch (e1) {
                    window.location.href = window.location.href;
                }
            }, 100);
        } catch (error) {
            console.error('❌ Error during force restart:', error);
            alert('Restart failed. Please refresh the page manually to apply updates.');
        }
    }
}

// Create global instance
window.serviceWorkerManager = new ServiceWorkerManager();
