class ServiceWorkerManager {
    constructor() {
        this.swRegistration = null;
        this.updateAvailable = false;
        this.updateProgress = 0;
        this.isUpdating = false;
        this.lastUpdateCounts = { completed: 0, total: 0 };
        this.lastUpdateFilesTotal = 0;
        this.trayPopup = {
            el: null,
            anchorEl: null,
            state: 'hidden', // hidden | checking | downloading | available | complete
            dismissedUntilComplete: false,
            progress: 0,
            message: '',
            filesTotal: 0
        };
        this.messageHandlers = new Map();
        this.pendingRequests = new Map();
        this.updateToastId = null;
        this.checkingToastId = null;
        this.timeoutToastId = null;
        this.swReadyTimeout = null;
        this.initialCheckDone = false;
        this.downloadState = null;
        this.stallDetectionTimeout = null;
        this.stateCheckInterval = null;
        this.lastProgressUpdate = null;
        this.lastHeartbeatTime = null;
        this.heartbeatCheckInterval = null;
        this.lastPingResponseTime = null;
        this.healthCheckInterval = null;
        this.healthCheckStartTime = null;

        this.init();
    }

    _isDesktopTrayMode() {
        return Boolean(window.isDesktop && document.body.classList.contains('desktop-mode'));
    }

    _getServiceWorkerTrayAnchor() {
        const icon = document.getElementById('serviceWorkerTrayIcon');
        return icon || null;
    }

    _ensureServiceWorkerTrayPopup() {
        if (this.trayPopup.el) {
            return;
        }

        const el = document.createElement('div');
        el.className = 'popover arrow-bottom-right service-worker-tray-popup';
        el.id = 'serviceWorkerUpdateTrayPopup';

        // We control show/hide manually; do not rely on PopoverManager click toggles.
        el.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.body.appendChild(el);
        this.trayPopup.el = el;

        // Close on outside click (but never auto-dismiss otherwise).
        document.addEventListener('click', (e) => {
            if (!this.trayPopup.el || !this.trayPopup.el.classList.contains('show')) return;
            if (this.trayPopup.el.contains(e.target)) return;
            // Ignore clicks on the tray icon; close is only via explicit close button.
        }, { passive: true });
    }

    _positionServiceWorkerTrayPopup() {
        if (!this.trayPopup.el) return;
        const anchor = this._getServiceWorkerTrayAnchor();
        if (!anchor) return;

        const popover = this.trayPopup.el;
        const rect = anchor.getBoundingClientRect();

        // Show temporarily for sizing.
        const wasHidden = !popover.classList.contains('show');
        if (wasHidden) {
            popover.style.visibility = 'hidden';
            popover.style.opacity = '0';
            popover.classList.add('show');
        }

        const popoverRect = popover.getBoundingClientRect();
        const arrowOffset = 18;
        const arrowRightOffset = parseFloat(getComputedStyle(popover).fontSize) || 16;

        let top = rect.top - popoverRect.height - arrowOffset;
        let left = rect.right - popoverRect.width + arrowRightOffset;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 8;

        if (left < padding) left = padding;
        if (left + popoverRect.width > viewportWidth - padding) left = viewportWidth - popoverRect.width - padding;
        if (top < padding) top = padding;
        if (top + popoverRect.height > viewportHeight - padding) top = viewportHeight - popoverRect.height - padding;

        // Match PopoverManager’s visual alignment tweak.
        left -= 10;

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;

        if (wasHidden) {
            popover.classList.remove('show');
            popover.style.visibility = '';
            popover.style.opacity = '';
        }
    }

    _hideServiceWorkerTrayPopup() {
        if (!this.trayPopup.el) return;
        this.trayPopup.el.classList.remove('show');
        this.trayPopup.state = 'hidden';
    }

    _renderServiceWorkerTrayPopup() {
        this._ensureServiceWorkerTrayPopup();
        const popover = this.trayPopup.el;
        const state = this.trayPopup.state;

        const titleByState = {
            checking: 'Checking for updates',
            available: 'Updates available',
            downloading: 'Downloading updates',
            complete: 'Updates complete'
        };

        const showProgress = state === 'downloading';
        const progressVal = Math.max(0, Math.min(100, Math.round(this.trayPopup.progress || 0)));

        const message = this.trayPopup.message || '';
        const filesTotal = Number.isFinite(this.trayPopup.filesTotal) ? this.trayPopup.filesTotal : 0;
        const headerTitle = titleByState[state] || 'Service Worker';

        const wrap = document.createElement('div');
        wrap.className = 'popover-content';

        const header = document.createElement('div');
        header.className = 'popover-header';
        header.innerHTML = `<i class="fa-regular fa-laptop-arrow-down"></i><span>${headerTitle}</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'context-menu-icon-btn service-worker-tray-popup-close';
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '<i class="fa-regular fa-xmark"></i>';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.trayPopup.state === 'downloading') {
                this.trayPopup.dismissedUntilComplete = true;
            }
            this._hideServiceWorkerTrayPopup();
        });

        const headerRow = document.createElement('div');
        headerRow.className = 'service-worker-tray-popup-header-row';
        headerRow.appendChild(header);
        headerRow.appendChild(closeBtn);
        wrap.appendChild(headerRow);

        const body = document.createElement('div');
        body.className = 'popover-body';

        if (state === 'available') {
            body.innerHTML = message || 'Resource updates are available.';
        } else if (state === 'downloading') {
            body.innerHTML = filesTotal > 0
                ? `Downloading ${filesTotal} files…`
                : (message || 'Downloading updates…');
        } else if (state === 'checking') {
            body.innerHTML = message || 'Scanning for available updates…';
        } else if (state === 'complete') {
            const count = Number.isFinite(this.trayPopup.filesTotal) ? this.trayPopup.filesTotal : 0;
            body.innerHTML = `Completed updating ${count} files. Restart to apply changes.`;
        } else {
            body.innerHTML = message;
        }

        wrap.appendChild(body);

        if (showProgress) {
            const progressWrap = document.createElement('div');
            progressWrap.className = 'service-worker-tray-popup-progress-wrap';

            const bar = document.createElement('div');
            bar.setAttribute('role', 'progressbar');
            bar.className = 'animate';

            const fill = document.createElement('div');
            fill.style.width = `${progressVal}%`;
            bar.appendChild(fill);
            progressWrap.appendChild(bar);
            wrap.appendChild(progressWrap);
        }

        if (state === 'available') {
            const actions = document.createElement('div');
            actions.className = 'service-worker-tray-popup-actions';

            const laterBtn = document.createElement('button');
            laterBtn.type = 'button';
            laterBtn.className = 'btn-standard btn-small';
            laterBtn.textContent = 'Later';
            laterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hideServiceWorkerTrayPopup();
            });

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'btn-standard btn-small';
            downloadBtn.textContent = 'Download now';
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hideServiceWorkerTrayPopup();
                this.checkStaticFileUpdates(false);
            });

            actions.appendChild(downloadBtn);
            actions.appendChild(laterBtn);
            wrap.appendChild(actions);
        }

        if (state === 'complete') {
            const actions = document.createElement('div');
            actions.className = 'service-worker-tray-popup-actions';

            const laterBtn = document.createElement('button');
            laterBtn.type = 'button';
            laterBtn.className = 'btn-standard btn-small';
            laterBtn.textContent = 'Later';
            laterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hideServiceWorkerTrayPopup();
            });

            const restartBtn = document.createElement('button');
            restartBtn.type = 'button';
            restartBtn.className = 'btn-standard btn-small';
            restartBtn.textContent = 'Restart';
            restartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.forceRestart();
            });

            actions.appendChild(restartBtn);
            actions.appendChild(laterBtn);
            wrap.appendChild(actions);
        }

        popover.innerHTML = '';
        popover.appendChild(wrap);
    }

    _showServiceWorkerTrayPopup(nextState, { message = '', progress = null, filesTotal = null } = {}) {
        if (!this._isDesktopTrayMode()) {
            return false;
        }

        if (nextState === 'downloading' && this.trayPopup.dismissedUntilComplete) {
            // Stay hidden until completion.
            this.trayPopup.state = 'hidden';
            return false;
        }

        this.trayPopup.anchorEl = this._getServiceWorkerTrayAnchor();
        if (!this.trayPopup.anchorEl) return false;

        this.trayPopup.state = nextState;
        if (typeof message === 'string') this.trayPopup.message = message;
        if (progress !== null) this.trayPopup.progress = progress;
        if (filesTotal !== null) this.trayPopup.filesTotal = filesTotal;

        this._renderServiceWorkerTrayPopup();
        this._positionServiceWorkerTrayPopup();
        this.trayPopup.el.classList.add('show');
        return true;
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

                // Start health check for service worker
                this.startHealthCheck();

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
            // First check if there's already a download in progress
            const swState = await this.checkDownloadState();
            if (swState && swState.isDownloading) {
                console.log('Download already in progress, syncing with existing download');
                // Sync with existing download
                this.isUpdating = true;
                const progress = swState.total > 0 
                    ? Math.round((swState.completed / swState.total) * 100) 
                    : 0;
                this.updateProgress = progress;
                
                if (!noToast && !this.updateToastId) {
                    this.showUpdateToast([{url: '...', hash: '...'}]);
                    this.updateProgressToast(progress);
                }
                
                // Check if stalled
                if (swState.lastProgressTime) {
                    const timeSinceProgress = Date.now() - swState.lastProgressTime;
                    if (timeSinceProgress > 30000) {
                        console.warn('Existing download appears stalled');
                        this.handleStalledDownload();
                    }
                }
                return; // Don't start a new check
            }
            
            // Make the actual request
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
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
    
    async checkDownloadState() {
        if (!this.swRegistration || !this.swRegistration.active) {
            return null;
        }
        
        return new Promise((resolve) => {
            const requestId = Date.now().toString();
            
            const handler = (event) => {
                if (event.data.type === 'DOWNLOAD_STATE' && 
                    event.data.requestId === requestId) {
                    navigator.serviceWorker.removeEventListener('message', handler);
                    this.downloadState = event.data;
                    resolve(event.data);
                }
            };
            
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send request to service worker
            this.swRegistration.active.postMessage({
                type: 'GET_DOWNLOAD_STATE',
                requestId: requestId
            });
            
            // Timeout after 2 seconds
            setTimeout(() => {
                navigator.serviceWorker.removeEventListener('message', handler);
                resolve(null);
            }, 2000);
        });
    }

    async updateStaticCache(files, noToast = false) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready');
            this.showServiceWorkerNotReadyToast();
            return;
        }

        try {
            // Check if service worker is already downloading
            const swState = await this.checkDownloadState();
            if (swState && swState.isDownloading) {
                console.warn('Service worker is already downloading, syncing with current status');
                // Immediately sync with current status
                this.isUpdating = true;
                const progress = swState.total > 0 
                    ? Math.round((swState.completed / swState.total) * 100) 
                    : 0;
                this.updateProgress = progress;
                
                if (!noToast) {
                    // Show or update the progress toast
                    if (!this.updateToastId) {
                        this.showCheckingForUpdatesToast();
                        setTimeout(() => {
                            if (typeof updateGlassToastComplete === 'function' && this.checkingToastId) {
                                updateGlassToastComplete(this.checkingToastId, {
                                    type: 'info',
                                    title: 'Download in Progress',
                                    message: `Downloading ${swState.completed}/${swState.total} files...`,
                                    showProgress: true,
                                    customIcon: '<i class="fas fa-download"></i>'
                                });
                                if (typeof updateGlassToastProgress === 'function') {
                                    updateGlassToastProgress(this.checkingToastId, progress);
                                }
                                this.updateToastId = this.checkingToastId;
                                this.checkingToastId = null;
                            }
                        }, 100);
                    } else {
                        // Update existing toast
                        this.updateProgressToast(progress);
                    }
                }
                
                // Check if download appears stalled
                if (swState.lastProgressTime) {
                    const timeSinceProgress = Date.now() - swState.lastProgressTime;
                    if (timeSinceProgress > 30000) {
                        console.warn('Download appears stalled when checking state');
                        this.handleStalledDownload();
                    }
                }
                
                return;
            }

            // Check if we're already updating
            if (this.isUpdating) {
                console.warn('Update already in progress, skipping new request');
                return;
            }

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
        // Desktop mode: use tray popup
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('checking', { message: 'Scanning for available updates…', progress: 0 });
            this.checkingToastId = 'service-worker-tray-popup';
        } else {
            // Non-desktop mode: use toast
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

        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            this.trayPopup.dismissedUntilComplete = false;
            this._showServiceWorkerTrayPopup('downloading', { message: `Downloading ${files.length} files…`, progress: 0, filesTotal: files.length });
            this.updateToastId = 'service-worker-tray-popup';
            this.checkingToastId = null;
        } else {
            // Non-desktop mode: use toast
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
    }

    showNoUpdatesFromChecking() {
        // Desktop mode: tray popup (auto-hide after short delay)
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('checking', { message: 'Your app is already up to date!', progress: 100 });
            setTimeout(() => this._hideServiceWorkerTrayPopup(), 2200);
            this.checkingToastId = null;
        } else {
            // Non-desktop mode: use toast
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
    }

    showCacheUpdateErrorFromChecking(error) {
        // Desktop mode: tray popup (auto-hide)
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('checking', { message: 'Failed to check for updates. Please try again.', progress: 0 });
            setTimeout(() => this._hideServiceWorkerTrayPopup(), 3500);
            this.checkingToastId = null;
        } else {
            // Non-desktop mode: use toast
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
    }

    showUpdateToast(files) {
        // Hide checking toast if it exists
        if (this.checkingToastId && this.checkingToastId !== 'service-worker-tray-popup' && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        this.updateAvailable = true;
        this.isUpdating = true;
        this.updateProgress = 0;

        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            this.trayPopup.dismissedUntilComplete = false;
            this._showServiceWorkerTrayPopup('downloading', { message: `Downloading ${files.length} files…`, progress: 0, filesTotal: files.length });
            this.updateToastId = 'service-worker-tray-popup';
        } else {
            // Non-desktop mode: use toast
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
    }
    
    updateProgressToast(progress) {
        this.updateProgress = progress;

        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            if (this.updateToastId === 'service-worker-tray-popup') {
                this._showServiceWorkerTrayPopup('downloading', { progress: progress });
            }
        } else {
            // Non-desktop mode: use toast
            if (this.updateToastId && typeof updateGlassToastProgress === 'function') {
                updateGlassToastProgress(this.updateToastId, progress);
            }
        }
    }
    
    hideUpdateToast() {
        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            if (this.updateToastId === 'service-worker-tray-popup') {
                this._hideServiceWorkerTrayPopup();
            }
        } else {
            // Non-desktop mode: use toast
            if (this.updateToastId && typeof removeGlassToast === 'function') {
                removeGlassToast(this.updateToastId);
            }
        }
        this.updateToastId = null;
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
    
    // Delete from cache and precache a file
    async deleteAndPrecache(url) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - skipping cache operation');
            return false;
        }
        
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            
            // Set up message handler
            const handler = (event) => {
                if (event.data.type === 'DELETE_AND_PRECACHE_COMPLETE' && 
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    resolve(true);
                } else if (event.data.type === 'DELETE_AND_PRECACHE_ERROR' && 
                          event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error(event.data.error || 'Delete and precache failed'));
                }
            };
            
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send message to service worker
            this.swRegistration.active.postMessage({
                type: 'DELETE_AND_PRECACHE',
                url: url,
                requestId: requestId
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Delete and precache operation timed out'));
                }
            }, 10000);
        });
    }

    // Delete from service worker cache only (no precache)
    async deleteFromCache(url) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - skipping cache delete');
            return false;
        }

        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();

            const handler = (event) => {
                if (event.data.type === 'DELETE_FROM_CACHE_COMPLETE' &&
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    resolve(true);
                } else if (event.data.type === 'DELETE_FROM_CACHE_ERROR' &&
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error(event.data.error || 'Delete from cache failed'));
                }
            };

            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);

            this.swRegistration.active.postMessage({
                type: 'DELETE_FROM_CACHE',
                url: url,
                requestId: requestId
            });

            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Delete from cache operation timed out'));
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
            case 'STATIC_CACHE_STARTED':
                this.updateAvailable = true;
                this.isUpdating = true;
                this.updateProgress = 0;
                this.lastProgressUpdate = Date.now();
                this.lastUpdateCounts = { completed: 0, total: event.data.total || 0 };
                this.lastUpdateFilesTotal = event.data.total || 0;
                console.log('Service worker started downloading updates');
                // Clear any stall detection timeout
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                    this.stallDetectionTimeout = null;
                }
                // Start periodic state checking
                this.startPeriodicStateCheck();
                // Start heartbeat tracking
                this.startHeartbeatTracking();
                break;
                
            case 'STATIC_CACHE_PROGRESS':
                const progress = Math.round((completed / total) * 100);
                this.updateProgress = progress;
                this.lastProgressUpdate = Date.now();
                this.lastUpdateCounts = { completed: completed || 0, total: total || 0 };
                this.lastUpdateFilesTotal = total || this.lastUpdateFilesTotal || 0;
                this.updateProgressToast(progress);
                
                console.log(`Progress update: ${completed}/${total} (${progress}%)`);
                
                // Reset stall detection - we got progress
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                }
                // Set new stall detection timeout (35 seconds - slightly longer than service worker's 30s)
                this.stallDetectionTimeout = setTimeout(() => {
                    console.warn('Download appears stalled - no progress for 35 seconds');
                    this.handleStalledDownload();
                }, 35000);
                
                // If this is a heartbeat, log it for debugging and track it
                if (event.data.heartbeat) {
                    console.log(`Download heartbeat: ${completed}/${total} (${progress}%)`);
                    this.lastHeartbeatTime = Date.now();
                }
                break;
                
            case 'STATIC_CACHE_COMPLETE':
                // Always clear isUpdating state, even if total is 0 (handles race condition with fast downloads)
                this.isUpdating = false;
                this.updateProgress = 100;
                this.updateProgressToast(100);
                this.lastUpdateCounts = { completed: event.data.completed || 0, total: event.data.total || 0 };
                
                // Stop periodic state checking
                this.stopPeriodicStateCheck();
                
                // Stop heartbeat tracking
                this.stopHeartbeatTracking();
                
                // Clear stall detection
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                    this.stallDetectionTimeout = null;
                }
                
                // Clear heartbeat time
                this.lastHeartbeatTime = null;
                
                console.log('Download completed:', event.data);
                
                // Only show completion toast if files were actually downloaded
                // Use files.length as fallback if total is 0 (handles race condition)
                const filesCount = event.data.total > 0 ? event.data.total : (event.data.files ? event.data.files.length : 0);
                if (filesCount > 0) {
                    this.trayPopup.dismissedUntilComplete = false;
                    this.trayPopup.filesTotal = filesCount;
                    // Show completion message with restart button
                    setTimeout(() => {
                        this.showUpdateCompleteToast();
                    }, 1000);
                } else {
                    // No files downloaded - just clear the update state silently
                    console.log('Download completed but no files were downloaded');
                    this.hideUpdateToast();
                }
                break;
                
            case 'STATIC_CACHE_STALLED':
                console.warn('Service worker reports download stalled:', event.data);
                this.handleStalledDownload();
                break;
                
            case 'STATIC_CACHE_ALREADY_IN_PROGRESS':
                console.log('Service worker already downloading:', event.data.currentDownload);
                // Update our state to match service worker
                this.isUpdating = true;
                if (event.data.currentDownload) {
                    const progress = event.data.currentDownload.total > 0
                        ? Math.round((event.data.currentDownload.completed / event.data.currentDownload.total) * 100)
                        : 0;
                    this.updateProgress = progress;
                    this.updateProgressToast(progress);
                    
                    // Show update toast if not already shown
                    if (!this.updateToastId) {
                        this.showUpdateToast([{url: '...', hash: '...'}]);
                    }
                    
                    // Start periodic state checking and heartbeat tracking
                    this.startPeriodicStateCheck();
                    this.startHeartbeatTracking();
                    
                    // If we have a last progress time, use it as the last heartbeat time
                    if (event.data.currentDownload.lastProgressTime) {
                        this.lastHeartbeatTime = event.data.currentDownload.lastProgressTime;
                    }
                    
                    // Check if download appears stalled
                    if (event.data.currentDownload.lastProgressTime) {
                        const timeSinceProgress = Date.now() - event.data.currentDownload.lastProgressTime;
                        if (timeSinceProgress > 30000) {
                            console.warn('Download appears stalled based on last progress time');
                            this.handleStalledDownload();
                        }
                    }
                }
                break;
                
            case 'STATIC_CACHE_CANCELLED':
                console.log('Download cancelled');
                this.isUpdating = false;
                this.updateProgress = 0;
                this.stopPeriodicStateCheck();
                this.stopHeartbeatTracking();
                this.lastHeartbeatTime = null;
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                    this.stallDetectionTimeout = null;
                }
                break;
                
            case 'DOWNLOAD_STATE':
                // Handle download state response
                const stateHandler = this.messageHandlers.get(event.data.requestId);
                if (stateHandler) {
                    stateHandler(event);
                }
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
                // Handle ping response from service worker (response to our health check)
                this.lastPingResponseTime = Date.now();
                break;
        }
    }
    
    // Start periodic state checking to keep UI in sync
    startPeriodicStateCheck() {
        if (this.stateCheckInterval) {
            clearInterval(this.stateCheckInterval);
        }
        
        this.stateCheckInterval = setInterval(async () => {
            if (!this.isUpdating) {
                this.stopPeriodicStateCheck();
                return;
            }
            
            try {
                const swState = await this.checkDownloadState();
                if (swState && swState.isDownloading) {
                    // Update UI with current state
                    const progress = swState.total > 0 
                        ? Math.round((swState.completed / swState.total) * 100) 
                        : 0;
                    
                    // Only update if different from current progress
                    if (progress !== this.updateProgress) {
                        console.log(`Periodic state check: updating progress from ${this.updateProgress}% to ${progress}%`);
                        this.updateProgress = progress;
                        this.updateProgressToast(progress);
                        this.lastProgressUpdate = Date.now();
                    }
                    
                    // Check for stall
                    if (swState.lastProgressTime) {
                        const timeSinceProgress = Date.now() - swState.lastProgressTime;
                        if (timeSinceProgress > 30000 && !this.stallDetectionTimeout) {
                            console.warn('Periodic check detected stalled download');
                            this.handleStalledDownload();
                        }
                    }
                } else {
                    // Service worker says download is not in progress
                    console.warn('Periodic check: Service worker reports no download, but we think it is');
                    if (this.isUpdating) {
                        // Download might have completed without us receiving the message
                        this.isUpdating = false;
                        this.stopPeriodicStateCheck();
                        // Try to check if it actually completed
                        if (this.updateProgress >= 100) {
                            this.showUpdateCompleteToast();
                        }
                    }
                }
            } catch (error) {
                console.error('Error in periodic state check:', error);
            }
        }, 5000); // Check every 5 seconds
    }
    
    stopPeriodicStateCheck() {
        if (this.stateCheckInterval) {
            clearInterval(this.stateCheckInterval);
            this.stateCheckInterval = null;
        }
    }

    startHeartbeatTracking() {
        // Stop any existing heartbeat check
        this.stopHeartbeatTracking();
        
        // Initialize last heartbeat time
        this.lastHeartbeatTime = Date.now();
        
        // Check for missed heartbeats every 5 seconds
        this.heartbeatCheckInterval = setInterval(() => {
            this.checkHeartbeatStatus();
        }, 5000);
    }

    stopHeartbeatTracking() {
        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
        }
    }

    checkHeartbeatStatus() {
        // Only check if we're in an update state and expecting heartbeats
        if (!this.isUpdating) {
            return;
        }

        // If we have a last heartbeat time, check if it's been too long
        if (this.lastHeartbeatTime) {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTime;
            // Heartbeats should come every 10 seconds, so if we haven't received one in 20 seconds, it's likely missed
            if (timeSinceLastHeartbeat > 20000) {
                // Heartbeat is missing - this will be picked up by getServiceWorkerHeartbeatStatus
                console.warn(`Service worker heartbeat missing for ${Math.round(timeSinceLastHeartbeat / 1000)}s`);
            }
        }
    }

    startHealthCheck() {
        // Stop any existing health check
        this.stopHealthCheck();
        
        // Record when health check started (for grace period)
        this.healthCheckStartTime = Date.now();
        
        // Don't initialize lastPingResponseTime - wait for first actual response
        // This way we can detect if service worker never responds
        
        // Send health check ping every 10 seconds
        this.healthCheckInterval = setInterval(() => {
            this.sendHealthCheckPing();
        }, 10000);
        
        // Send initial ping immediately
        this.sendHealthCheckPing();
    }

    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        this.healthCheckStartTime = null;
    }

    sendHealthCheckPing() {
        if (!this.swRegistration || !this.swRegistration.active) {
            this.lastPingResponseTime = null;
            return;
        }

        try {
            // Send ping to service worker
            this.swRegistration.active.postMessage({
                type: 'ping',
                timestamp: Date.now()
            });
            
            // Check if service worker is responding (if we haven't received a response in 15 seconds, it's likely stopped)
            if (this.lastPingResponseTime) {
                const timeSinceLastResponse = Date.now() - this.lastPingResponseTime;
                if (timeSinceLastResponse > 15000) {
                    console.warn(`Service worker not responding - last response ${Math.round(timeSinceLastResponse / 1000)}s ago`);
                }
            }
        } catch (error) {
            console.error('Error sending health check ping:', error);
            this.lastPingResponseTime = null;
        }
    }

    // Public method to get service worker heartbeat status
    getServiceWorkerHeartbeatStatus() {
        if (!this.swRegistration) {
            return {
                available: false,
                status: 'Not Registered',
                hasActive: false,
                isUpdating: false,
                heartbeatMissed: false,
                timeSinceLastHeartbeat: null,
                isResponding: false,
                timeSinceLastPingResponse: null
            };
        }

        const hasActive = !!this.swRegistration.active;
        const isReady = hasActive || !!navigator.serviceWorker.controller;

        // Check if service worker is responding to pings
        let isResponding = true;
        let timeSinceLastPingResponse = null;
        
        if (this.lastPingResponseTime) {
            timeSinceLastPingResponse = Date.now() - this.lastPingResponseTime;
            // If we haven't received a ping response in 15 seconds, service worker is likely stopped
            isResponding = timeSinceLastPingResponse < 15000;
        } else if (hasActive && this.healthCheckInterval && this.healthCheckStartTime) {
            // If we have an active service worker but no ping response time yet, check grace period
            const timeSinceHealthCheckStart = Date.now() - this.healthCheckStartTime;
            // Give 20 seconds grace period after starting health check before marking as not responding
            // This accounts for initial delay and potential slow responses
            if (timeSinceHealthCheckStart > 20000) {
                // Grace period expired, service worker is not responding
                isResponding = false;
                timeSinceLastPingResponse = timeSinceHealthCheckStart;
            }
        }

        // Check heartbeat status only if we're updating
        let heartbeatMissed = false;
        let timeSinceLastHeartbeat = null;

        if (this.isUpdating && this.lastHeartbeatTime) {
            timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTime;
            // Heartbeats should come every 10 seconds, so if we haven't received one in 20 seconds, it's likely missed
            heartbeatMissed = timeSinceLastHeartbeat > 20000;
        } else if (this.isUpdating && !this.lastHeartbeatTime) {
            // If we're updating but haven't received a heartbeat yet, wait a bit before flagging as missed
            heartbeatMissed = false;
        }

        // Determine status
        let status = 'Active';
        if (!isResponding) {
            status = 'Stopped';
        } else if (this.isUpdating) {
            status = 'Updating';
            if (heartbeatMissed) {
                status = 'Heartbeat Missed';
            }
        } else if (!isReady) {
            status = 'Inactive';
        }

        return {
            available: true,
            status: status,
            hasActive: hasActive,
            isUpdating: this.isUpdating,
            heartbeatMissed: heartbeatMissed,
            timeSinceLastHeartbeat: timeSinceLastHeartbeat,
            isResponding: isResponding,
            timeSinceLastPingResponse: timeSinceLastPingResponse
        };
    }

    async handleStalledDownload() {
        console.warn('Handling stalled download');
        
        // Check current state from service worker
        const swState = await this.checkDownloadState();
        if (swState && swState.isDownloading) {
            const timeSinceProgress = swState.lastProgressTime 
                ? Date.now() - swState.lastProgressTime 
                : 0;
            
            // Update UI with current state
            const progress = swState.total > 0 
                ? Math.round((swState.completed / swState.total) * 100) 
                : 0;
            this.updateProgress = progress;
            this.updateProgressToast(progress);
            
            if (typeof showGlassToast === 'function') {
                const message = timeSinceProgress > 0
                    ? `Download stalled (no progress for ${Math.round(timeSinceProgress/1000)}s). Current: ${swState.completed}/${swState.total}. Click to retry.`
                    : `Download appears stalled. Current: ${swState.completed}/${swState.total}. Click to retry.`;
                    
                const toastId = showGlassToast(
                    'warning',
                    'Download Stalled',
                    message,
                    false,
                    20000,
                    '<i class="fas fa-exclamation-triangle"></i>'
                );
                
                // Add retry button after a moment
                setTimeout(() => {
                    if (typeof updateGlassToastButtons === 'function') {
                        const retryButton = {
                            text: 'Retry',
                            type: 'primary',
                            onClick: async () => {
                                console.log('User requested retry after stall');
                                await this.cancelDownload();
                                // Wait a moment then retry
                                setTimeout(() => {
                                    this.checkStaticFileUpdates();
                                }, 1000);
                            },
                            closeOnClick: true
                        };
                        updateGlassToastButtons(toastId, [retryButton]);
                    }
                }, 1000);
            }
            
            // Optionally offer to cancel and retry
            console.warn(`Stalled download state: ${swState.completed}/${swState.total}, last progress: ${swState.lastProgressTime ? new Date(swState.lastProgressTime).toISOString() : 'unknown'}`);
        } else {
            // Service worker says it's not downloading, but we think it is
            // This might mean the download completed or crashed
            console.warn('Service worker reports no download in progress, but we thought it was');
            this.isUpdating = false;
            this.stopPeriodicStateCheck();
        }
    }
    
    async cancelDownload() {
        if (!this.swRegistration || !this.swRegistration.active) {
            return;
        }
        
        this.swRegistration.active.postMessage({
            type: 'CANCEL_DOWNLOAD'
        });
        
        this.isUpdating = false;
        this.updateProgress = 0;
        this.lastProgressUpdate = null;
        
        this.stopPeriodicStateCheck();
        this.stopHeartbeatTracking();
        
        if (this.stallDetectionTimeout) {
            clearTimeout(this.stallDetectionTimeout);
            this.stallDetectionTimeout = null;
        }
        
        // Clear heartbeat time
        this.lastHeartbeatTime = null;
    }

    async syncImageCacheRules(favoriteUrls = [], lockedPreviewUrls = [], policy = null) {
        try {
            const worker = this.swRegistration?.active || navigator.serviceWorker?.controller;
            if (!worker) {
                return false;
            }

            worker.postMessage({
                type: 'SYNC_IMAGE_CACHE_RULES',
                favoriteUrls: Array.isArray(favoriteUrls) ? favoriteUrls : [],
                lockedPreviewUrls: Array.isArray(lockedPreviewUrls) ? lockedPreviewUrls : [],
                policy: policy && typeof policy === 'object' ? policy : undefined
            });

            return true;
        } catch (error) {
            console.error('Failed to sync image cache rules:', error);
            return false;
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
                    customIcon: '<i class="fas fa-spinner-third fa-spin"></i>'
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

            // Make the actual request
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
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
        return new Promise(async (resolve) => {
            if (!this.swRegistration || !this.swRegistration.active) {
                console.warn('Service Worker not ready for updates');
                resolve({ success: false, reason: 'Service Worker not ready' });
                return;
            }
            
            // Check if service worker is already downloading
            const swState = await this.checkDownloadState();
            if (swState && swState.isDownloading) {
                console.warn('Service worker is already downloading, waiting for it to complete');
                // Wait for the existing download to complete
                const waitForCompletion = () => {
                    return new Promise((waitResolve) => {
                        const checkInterval = setInterval(async () => {
                            const currentState = await this.checkDownloadState();
                            if (!currentState || !currentState.isDownloading) {
                                clearInterval(checkInterval);
                                waitResolve();
                            }
                        }, 1000);
                        
                        // Timeout after 60 seconds
                        setTimeout(() => {
                            clearInterval(checkInterval);
                            waitResolve();
                        }, 60000);
                    });
                };
                
                await waitForCompletion();
                // After waiting, check if we still need to download these files
                resolve({ success: false, reason: 'Download was already in progress' });
                return;
            }
            
            // Check if we're already updating
            if (this.isUpdating) {
                console.warn('Update already in progress, skipping');
                resolve({ success: false, reason: 'Update already in progress' });
                return;
            }

            let updatesDownloaded = 0;
            let hasErrors = false;
            let skipRequested = false;
            let downloadCompleted = false;

            // Listen for progress updates
            const progressHandler = (event) => {
                if (skipRequested || downloadCompleted) return; // Ignore if already handled

                if (event.data.type === 'STATIC_CACHE_STARTED') {
                    // Download started
                    console.log('Download started in service worker');
                } else if (event.data.type === 'STATIC_CACHE_PROGRESS') {
                    // UI is handled by the service worker tray popup (desktop) or existing startup UI (mobile).
                } else if (event.data.type === 'STATIC_CACHE_COMPLETE') {
                    // Use files.length as fallback if total is 0 (handles race condition with fast downloads)
                    updatesDownloaded = event.data.total > 0 ? event.data.total : (event.data.files ? event.data.files.length : 0);
                    navigator.serviceWorker.removeEventListener('message', progressHandler);
                    
                    // Clear isUpdating state immediately to prevent stuck UI
                    this.isUpdating = false;
                    this.updateProgress = 100;

                    if (!skipRequested && !downloadCompleted) {
                        downloadCompleted = true;
                        console.log(`Update download completed with ${updatesDownloaded} files downloaded${hasErrors ? ' (with errors)' : ''}`);

                        // Show Restart and Skip buttons if updates were downloaded successfully
                        // Check files.length as fallback if total was 0 due to race condition
                        const filesWereDownloaded = updatesDownloaded > 0 || (event.data.files && event.data.files.length > 0);
                        if (!hasErrors && filesWereDownloaded) {
                            // Use actual files count if we have it
                            const actualFilesCount = event.data.files ? event.data.files.length : updatesDownloaded;
                            updatesDownloaded = actualFilesCount;

                            // The tray completion popup prompts restart/later. Continue init regardless.
                            resolve({ success: true, filesDownloaded: updatesDownloaded, userChoice: 'later' });
                        } else {
                            // No files downloaded or had errors - resolve but don't show restart buttons
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

            // Desktop mode: show tray popup immediately for init downloads.
            if (this._isDesktopTrayMode()) {
                this.showUpdateToast(files);
            }

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
        // Desktop mode: tray popup completion prompt
        if (this._isDesktopTrayMode()) {
            const filesTotal = this.trayPopup.filesTotal || this.lastUpdateFilesTotal || 0;
            this._showServiceWorkerTrayPopup('complete', { filesTotal, progress: 100 });
            this.updateToastId = 'service-worker-tray-popup';
        } else {
            // Non-desktop mode: use toast
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

    showUpdateAvailableTrayPrompt(message) {
        if (!this._isDesktopTrayMode()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, message || 'Updates are available.', false, 8000, '<i class="fas fa-download"></i>');
            }
            return;
        }
        this.trayPopup.dismissedUntilComplete = false;
        this._showServiceWorkerTrayPopup('available', { message: message || 'Resource updates are available.' });
    }
}

// Create global instance
window.serviceWorkerManager = new ServiceWorkerManager();
