class ServiceWorkerManager {
    constructor() {
        this.swRegistration = null;
        this.updateAvailable = false;
        this.updateProgress = 0;
        this.isUpdating = false;
        this.messageHandlers = new Map();
        this.pendingRequests = new Map();
        this.updateToastId = null;
        
        this.init();
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
                
                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', (event) => {
                    this.handleServiceWorkerMessage(event);
                });
                
                // Check if there's an update waiting
                if (this.swRegistration.waiting) {
                    this.checkForUpdates();
                }
                
                // Check for static file updates
                this.checkStaticFileUpdates();
                
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }
    
    async checkStaticFileUpdates() {
        try {
            const response = await fetch('/', { method: 'OPTIONS' });
            if (response.ok) {
                const files = await response.json();
                await this.updateStaticCache(files);
            }
        } catch (error) {
            console.error('Failed to check static file updates:', error);
        }
    }
    
    async updateStaticCache(files) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready');
            return;
        }
        
        try {
            console.log('Checking for static file updates...');
            // Check which files need updating
            const filesToUpdate = await this.getFilesNeedingUpdate(files);
            
            console.log(`Found ${filesToUpdate.length} files that need updating:`, filesToUpdate);
            
            if (filesToUpdate.length > 0) {
                console.log(`Found ${filesToUpdate.length} files that need updating`);
                this.showUpdateToast(filesToUpdate);
                
                // Start background caching
                this.swRegistration.active.postMessage({
                    type: 'CACHE_STATIC_FILES',
                    files: filesToUpdate
                });
            } else {
                console.log('No files need updating');
            }
        } catch (error) {
            console.error('Error updating static cache:', error);
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
    
    showUpdateToast(files) {
        this.updateAvailable = true;
        this.isUpdating = true;
        this.updateProgress = 0;

        // Check if showGlassToast function is available
        if (typeof showGlassToast === 'function') {
            // Show progress toast
            this.updateToastId = showGlassToast(
                'info', 
                'Downloading Updates', 
                `Downloading ${files.length} critical updates...`, 
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
            console.warn('Service Worker not ready');
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
                console.log('Internal cache complete:', url);
                break;
                
            case 'CACHE_STATUS':
                // Handle cache status response
                const handler = this.messageHandlers.get(event.data.requestId);
                if (handler) {
                    handler(event);
                }
                break;
        }
    }
    
    async checkForUpdates() {
        if (this.swRegistration && this.swRegistration.waiting) {
            // Send skip waiting message
            this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            
            // Reload the page to activate the new service worker
            window.location.reload();
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
    
    // Test Workbox script caching
    async testWorkboxCaching() {
        console.log('Testing Workbox script caching...');
        try {
            // Check if Workbox script is in cache
            const cache = await caches.open('static-cache-v1');
            const workboxResponse = await cache.match('/dist/workbox/workbox-sw.js');
            
            if (workboxResponse) {
                console.log('✅ Workbox script found in cache');
                
                // Check if we can fetch it from the cached version
                const response = await fetch('/dist/workbox/workbox-sw.js');
                if (response.ok) {
                    console.log('✅ Workbox script accessible from cache');
                } else {
                    console.warn('⚠️ Workbox script not accessible from cache');
                }
            } else {
                console.log('❌ Workbox script not found in cache');
            }
            
            // Test the service worker's ability to serve Workbox
            const swResponse = await fetch('/dist/workbox/workbox-sw.js');
            console.log('Service worker response for Workbox:', swResponse.status, swResponse.statusText);
            
        } catch (error) {
            console.error('❌ Error testing Workbox caching:', error);
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
                    message: 'Critical updates have been downloaded. Restart to apply changes.',
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
    
    // Test the new button system
    testToastButtons() {
        console.log('Testing toast button system...');
        
        const testButton = {
            text: 'Test Button',
            type: 'primary',
            onClick: (toastId) => {
                console.log('Test button clicked for toast:', toastId);
                alert('Test button works!');
            },
            closeOnClick: false
        };
        
        const closeButton = {
            text: 'Close',
            type: 'secondary',
            onClick: (toastId) => {
                console.log('Close button clicked for toast:', toastId);
            },
            closeOnClick: true
        };
        
        if (typeof showGlassToast === 'function') {
            const toastId = showGlassToast(
                'info',
                'Test Toast with Buttons',
                'This toast has custom buttons. Click them to test!',
                false,
                false,
                '<i class="fas fa-flask"></i>',
                [testButton, closeButton]
        );
            console.log('Test toast created with ID:', toastId);
        } else {
            console.error('showGlassToast function not available!');
        }
    }
}

// Create global instance
window.serviceWorkerManager = new ServiceWorkerManager();
