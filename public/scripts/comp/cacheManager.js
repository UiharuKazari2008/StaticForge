// Cache Manager for Dreamscape Workspace
class CacheManager {
    constructor() {
        this.serviceWorker = null;
        this.cacheData = null;
        this.isInitialized = false;
        this.cacheVersion = 'v1';
        this.pendingCriticalUpdates = null;
    }

    // Initialize the cache manager
    async initialize() {
        try {
            if (!('serviceWorker' in navigator)) {
                console.warn('Service Worker not supported');
                return false;
            }

            // Register service worker
            await this.registerServiceWorker();

            // Get cached data from service worker
            await this.getCacheStatus();

            // If no cache data exists, initialize with empty data to prevent infinite loops
            if (!this.cacheData || !this.cacheData.assets) {
                console.log('No existing cache data found, initializing with empty data');
                this.cacheData = {
                    assets: [],
                    timestamp: Date.now()
                };
            }

            this.isInitialized = true;
            console.log('Cache Manager initialized with', this.cacheData.assets.length, 'cached assets');
            return true;
        } catch (error) {
            console.error('Error initializing Cache Manager:', error);
            // Initialize with empty data even on error to prevent loops
            this.cacheData = {
                assets: [],
                timestamp: Date.now()
            };
            this.isInitialized = true;
            return false;
        }
    }

    // Register the service worker
    async registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            this.serviceWorker = registration;

            // Wait for service worker to be ready
            await navigator.serviceWorker.ready;

            // Set up service worker update handling
            this.setupServiceWorkerUpdates(registration);

            console.log('Service Worker registered:', registration);
            return registration;
        } catch (error) {
            console.error('Service Worker registration failed:', error);
            throw error;
        }
    }

    // Set up service worker update handling
    setupServiceWorkerUpdates(registration) {
        // Listen for service worker updates
        registration.addEventListener('updatefound', () => {
            console.log('🔄 Service Worker update found, installing...');

            const newWorker = registration.installing;
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('🔄 New Service Worker installed, ready to activate');
                    }
                });
            }
        });

        // Listen for service worker controller change
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('🔄 Service Worker controller changed, new version active');
            // Reload the page to use the new service worker
            setTimeout(() => {
                this.showUpdateBanner();
            }, 1000);
        });

        // Listen for messages from the service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SERVICE_WORKER_UPDATED') {
                console.log('🔄 Service worker updated message received:', event.data.message);
                // Show update banner when service worker is updated
                this.showUpdateBanner();
            }
        });
    }

    // Get cache status from service worker
    async getCacheStatus() {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.success) {
                    // Update local cache data with the retrieved data
                    if (event.data.cacheData && event.data.cacheData.assets) {
                        this.cacheData = event.data.cacheData;
                    } else {
                        console.log('📊 Cache status retrieved: no cached assets found');
                    }
                    resolve(event.data);
                } else {
                    reject(new Error(event.data?.error || 'Failed to get cache status'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'GET_CACHE_STATUS' },
                [messageChannel.port2]
            );

            // Set timeout
            setTimeout(() => {
                reject(new Error('Get cache status timeout'));
            }, 10000);
        });
    }

    // Cache assets using service worker
    async cacheAssets(assets) {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.type === 'CACHE_COMPLETE') {
                    // Update cache data with the new assets and their results
                    if (this.cacheData) {
                        // Create a map of successful assets with their metadata
                        const successfulAssets = assets.filter((asset, index) =>
                            event.data.results[index] && event.data.results[index].success
                        );

                        this.cacheData.assets = successfulAssets;
                        this.cacheData.timestamp = Date.now();

                        console.log(`Updated cache data with ${successfulAssets.length} assets`);
                    }
                    resolve(event.data.results);
                } else if (event.data && event.data.type === 'CACHE_ERROR') {
                    reject(new Error(event.data.error || 'Failed to cache assets'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'CACHE_ASSETS', assets },
                [messageChannel.port2]
            );
        });
    }

    // Clear all cached assets
    async clearCache() {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.success) {
                    this.cacheData = null;
                    resolve(event.data);
                } else {
                    reject(new Error(event.data?.error || 'Failed to clear cache'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'CLEAR_CACHE' },
                [messageChannel.port2]
            );
        });
    }

    // Check if assets need to be updated using stored hashes
    async checkForUpdates(serverAssets) {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        const needsUpdate = [];
        const upToDate = [];

        // Get all cached assets with their MD5 hashes at once
        let cachedAssets = [];
        try {
            cachedAssets = await this.getAllCachedAssets();
        } catch (error) {
            console.warn('Failed to get cached assets, assuming all need updates:', error.message);
        }

        // Create a map for fast lookup
        const cachedAssetsMap = new Map();
        cachedAssets.forEach(asset => cachedAssetsMap.set(asset.path, asset));

        // Compare server assets with cached assets
        for (const serverAsset of serverAssets) {
            const cachedAsset = cachedAssetsMap.get(serverAsset.path);

            if (!cachedAsset || cachedAsset.md5 !== serverAsset.md5) {
                console.log(`Asset needs update: ${serverAsset.path} (server: ${serverAsset.md5}, cached: ${cachedAsset?.md5 || 'none'})`);
                needsUpdate.push(serverAsset);
            } else {
                upToDate.push(serverAsset);
            }
        }

        return {
            needsUpdate: needsUpdate.length > 0,
            assets: needsUpdate,
            upToDate: upToDate,
            cachedAssets: cachedAssets // Include cached assets for reuse
        };
    }

    // Get stored asset metadata from service worker
    async getStoredAssetMetadata(path) {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.success) {
                    resolve(event.data.metadata);
                } else {
                    reject(new Error(event.data?.error || 'Failed to get asset metadata'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'GET_ASSET_METADATA', path: path },
                [messageChannel.port2]
            );

            // Set timeout
            setTimeout(() => {
                reject(new Error('Get asset metadata timeout'));
            }, 5000);
        });
    }

    // Get all cached assets with their MD5 hashes from service worker
    async getAllCachedAssets() {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.success) {
                    resolve(event.data.assets || []);
                } else {
                    reject(new Error(event.data?.error || 'Failed to get all cached assets'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'GET_ALL_CACHED_ASSETS' },
                [messageChannel.port2]
            );

            // Set timeout
            setTimeout(() => {
                reject(new Error('Get all cached assets timeout'));
            }, 10000);
        });
    }

    // Download and cache assets
    async downloadAssets(assets) {
        try {
            console.log(`Downloading ${assets.length} assets...`);

            const results = await this.cacheAssets(assets);

            // Check for any failed downloads
            const failed = results.filter(result => !result.success);
            if (failed.length > 0) {
                console.warn(`${failed.length} assets failed to download:`, failed);
            }

            const successCount = results.filter(result => result.success).length;
            console.log(`Successfully cached ${successCount}/${assets.length} assets`);

            return results;
        } catch (error) {
            console.error('Error downloading assets:', error);
            throw error;
        }
    }

    // Cache a single asset
    async cacheSingleAsset(asset) {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.type === 'CACHE_COMPLETE') {
                    // Find the result for this specific asset
                    const result = event.data.results.find(r => r.path === asset.path);
                    if (result) {
                        resolve(result);
                    } else {
                        resolve({ path: asset.path, success: false, error: 'Asset not found in results' });
                    }
                } else if (event.data && event.data.type === 'CACHE_ERROR') {
                    reject(new Error(event.data.error || 'Failed to cache asset'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'CACHE_ASSETS', assets: [asset] },
                [messageChannel.port2]
            );

            // Set timeout
            setTimeout(() => {
                reject(new Error('Cache single asset timeout'));
            }, 10000);
        });
    }

    // Download and cache assets with progress tracking
    async downloadAssetsWithProgress(assets, progressCallback) {
        try {
            console.log(`Downloading ${assets.length} assets with progress tracking...`);

            let downloadedCount = 0;
            const totalCount = assets.length;
            const results = [];

            // Call progress callback with initial state
            if (progressCallback) {
                progressCallback({ downloaded: 0, total: totalCount });
            }

            // Download assets one by one to show real progress
            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];
                try {
                    // Download single asset
                    const result = await this.cacheSingleAsset(asset);
                    results.push(result);
                    
                    if (result.success) {
                        downloadedCount++;
                        
                        // Call progress callback with updated progress
                        if (progressCallback) {
                            console.log(`📥 Progress: ${downloadedCount}/${totalCount} - ${asset.path}`);
                            progressCallback({ 
                                downloaded: downloadedCount, 
                                total: totalCount,
                                currentFile: asset.path,
                                success: true
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Failed to download asset ${asset.path}:`, error);
                    results.push({ 
                        path: asset.path, 
                        success: false, 
                        error: error.message 
                    });
                }
            }

            // Check for any failed downloads
            const failed = results.filter(result => !result.success);
            if (failed.length > 0) {
                console.warn(`${failed.length} assets failed to download:`, failed);
            }

            const successCount = results.filter(result => result.success).length;
            console.log(`Successfully cached ${successCount}/${assets.length} assets with progress tracking`);

            return results;
        } catch (error) {
            console.error('Error downloading assets with progress tracking:', error);
            throw error;
        }
    }

    // Get cache information
    getCacheInfo() {
        if (!this.cacheData) {
            return {
                isCached: false,
                totalAssets: 0,
                cachedAssets: 0,
                lastUpdate: null
            };
        }

        return {
            isCached: true,
            totalAssets: this.cacheData.assets?.length || 0,
            cachedAssets: this.cacheData.assets?.length || 0,
            lastUpdate: this.cacheData.timestamp ? new Date(this.cacheData.timestamp) : null
        };
    }

    // Check if specific asset is cached
    isAssetCached(path) {
        if (!this.cacheData || !this.cacheData.assets) {
            return false;
        }

        return this.cacheData.assets.some(asset => asset.path === path);
    }

    // Get cached asset info
    getCachedAssetInfo(path) {
        if (!this.cacheData || !this.cacheData.assets) {
            return null;
        }

        return this.cacheData.assets.find(asset => asset.path === path) || null;
    }

    // Remove specific cache entry (for when files are deleted)
    async removeCacheEntry(path) {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.success) {
                    // Remove from local cache data
                    if (this.cacheData && this.cacheData.assets) {
                        this.cacheData.assets = this.cacheData.assets.filter(asset => asset.path !== path);
                    }
                    resolve(event.data);
                } else {
                    reject(new Error(event.data?.error || 'Failed to remove cache entry'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'REMOVE_CACHE_ENTRY', path: path },
                [messageChannel.port2]
            );

            // Set timeout
            setTimeout(() => {
                reject(new Error('Remove cache entry timeout'));
            }, 10000);
        });
    }

    // Manually update cache data (useful for debugging)
    updateCacheData(assets) {
        if (assets && Array.isArray(assets)) {
            this.cacheData = {
                assets: assets,
                timestamp: Date.now()
            };
            console.log(`Cache data manually updated with ${assets.length} assets`);
        }
    }

    // Clean up expired cache entries
    async cleanupExpiredCache() {
        if (!this.serviceWorker || !this.serviceWorker.active) {
            throw new Error('Service Worker not ready');
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data && event.data.success) {
                    resolve(event.data);
                } else {
                    reject(new Error(event.data?.error || 'Failed to cleanup expired cache'));
                }
            };

            this.serviceWorker.active.postMessage(
                { type: 'CLEANUP_EXPIRED_CACHE' },
                [messageChannel.port2]
            );

            // Set timeout
            setTimeout(() => {
                reject(new Error('Cache cleanup timeout'));
            }, 30000);
        });
    }

    // Reload cache data from server (admin only)
    async reloadCacheData() {
        try {
            // Try WebSocket first if available
            if (window.wsClient && window.wsClient.isConnected()) {
                console.log('🔌 Using WebSocket for cache reload');
                const result = await window.wsClient.sendMessage('reload_cache_data');
                return result;
            } else {
                // Fall back to HTTP for cache manifest
                console.log('🌐 Using HTTP for cache reload (WebSocket not connected)');
                const response = await fetch('/app', { method: 'OPTIONS' });
                if (response.ok) {
                    const data = await response.json();
                    const serverAssets = data.cacheData || [];
                    
                    // Check for updates using HTTP data
                    if (serverAssets.length > 0) {
                        const updateInfo = await this.checkForUpdates(serverAssets);
                        if (updateInfo.needsUpdate) {
                            console.log(`📥 ${updateInfo.assets.length} assets need updating from HTTP reload`);
                            await this.showUpdateBannerWithProgress(updateInfo.assets, false);
                        }
                    }
                    
                    return {
                        assetsCount: serverAssets.length,
                        timestamp: Date.now(),
                        source: 'http'
                    };
                } else {
                    throw new Error('HTTP cache reload failed');
                }
            }
        } catch (error) {
            throw new Error(error.message || 'Failed to reload cache data');
        }
    }

    // Show update banner for critical updates
    showUpdateBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.classList.remove('hidden', 'hide');
            banner.classList.add('show');
            document.body.classList.add('has-update-banner');

            // Hide progress container for regular banner
            const progressContainer = banner.querySelector('.update-progress-container');
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }

            // Reset banner text to original state
            const bannerText = banner.querySelector('.update-banner-text');
            if (bannerText) {
                bannerText.textContent = 'Critical Update Available, Please save your work and restart.';
            }

            // Set up button handlers
            const reloadBtn = document.getElementById('updateBannerReloadBtn');

            if (reloadBtn) {
                reloadBtn.onclick = async () => {
                    this.pendingCriticalUpdates = null;
                    this.hideUpdateBanner();
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                };
            }
        }
    }

    // Show update banner with progress bar and download assets
    async showUpdateBannerWithProgress(assets, autoClose = false) {
        const banner = document.getElementById('updateBanner');
        if (!banner) {
            // Fallback to regular banner if progress banner not available
            const results = await this.downloadAssets(assets);
            if (results.length > 0) {
                this.showUpdateBanner();
            }
            return;
        }

        // Show the banner
        banner.classList.remove('hidden', 'hide');
        banner.classList.add('show');
        document.body.classList.add('has-update-banner');

        // Find progress elements (they now exist in the HTML)
        const progressContainer = banner.querySelector('.update-progress-container');
        const progressBar = banner.querySelector('.update-progress-bar');
        const progressStatus = banner.querySelector('.update-progress-status');
        const bannerText = banner.querySelector('.update-banner-text');
        const reloadBtn = banner.querySelector('#updateBannerReloadBtn');

        if (!progressContainer || !progressBar || !progressStatus) {
            console.error('Progress elements not found, falling back to regular banner');
            this.showUpdateBanner();
            return;
        }

        // Show progress container and hide reload button initially
        progressContainer.style.display = '';
        if (reloadBtn) {
            reloadBtn.style.display = 'none';
        }
        
        // Update initial banner text and status
        if (bannerText) {
            if (autoClose) {
                bannerText.textContent = 'Downloading assets... 0%';
            } else {
                bannerText.textContent = 'Downloading updates... 0%';
            }
        }
        if (progressStatus) {
            progressStatus.textContent = `0 / ${assets.length}`;
        }

        try {
            console.log(`📥 Downloading ${assets.length} assets with progress...`);
            
            // Download assets with progress tracking
            const results = await this.downloadAssetsWithProgress(assets, (progress) => {
                // Update progress bar
                const percentage = (progress.downloaded / progress.total) * 100;
                progressBar.style.width = `${percentage}%`;
                
                // Update status text
                if (progressStatus) {
                    progressStatus.textContent = `${progress.downloaded} / ${progress.total}`;
                }
                
                // Update banner text to show progress
                if (bannerText) {
                    bannerText.textContent = `Downloading updates... ${Math.round(percentage)}%`;
                }
            });

            // Check for any failed downloads
            const failed = results.filter(result => !result.success);
            if (failed.length > 0) {
                console.warn(`${failed.length} assets failed to download:`, failed);
            }

            const successCount = results.filter(result => result.success).length;
            console.log(`✅ Successfully downloaded ${successCount}/${assets.length} assets`);

            // Update progress to show completion
            progressBar.style.width = '100%';
            
            if (progressStatus) {
                progressStatus.textContent = `${successCount} / ${assets.length}`;
            }
            
            // Update banner text to show completion
            if (bannerText) {
                if (autoClose) {
                    bannerText.textContent = 'Assets downloaded successfully!';
                } else {
                    bannerText.textContent = 'Update Installed! Please save your work and restart.';
                }
            }

            // Handle completion based on autoClose parameter
            if (autoClose) {
                // Auto-close the banner after a short delay for initial asset downloads
                setTimeout(() => {
                    this.hideUpdateBanner();
                }, 1000);
            } else {
                // Hide reload button for initial asset downloads
                reloadBtn.style.display = 'flex';
                reloadBtn.onclick = async () => {
                    this.pendingCriticalUpdates = null;
                    this.hideUpdateBanner();
                    bypassConfirmation = true;
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                };
            }

        } catch (error) {
            console.error('❌ Error downloading assets with progress:', error);
            
            // Show error state
            progressBar.style.width = '0%';
            
            if (progressStatus) {
                progressStatus.textContent = 'Download failed';
            }
            
            // Update banner text to show error
            if (bannerText) {
                bannerText.textContent = 'Update failed. Please reload to apply existing updates.';
            }

            // Handle error based on autoClose parameter
            if (autoClose) {
                // Auto-close the banner after a short delay even on error for initial asset downloads
                setTimeout(() => {
                    this.hideUpdateBanner();
                }, 3000);
            } else if (reloadBtn) {
                // Show reload button on error for actual updates
                reloadBtn.style.display = 'block';
                reloadBtn.onclick = async () => {
                    this.pendingCriticalUpdates = null;
                    bypassConfirmation = true;
                    this.hideUpdateBanner();
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                };
            }
        }
    }

    // Hide update banner
    hideUpdateBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.classList.remove('show');
            banner.classList.add('hide');
            
            // Hide completely after animation
            setTimeout(() => {
                banner.classList.add('hidden');
                banner.classList.remove('hide');
                document.body.classList.remove('has-update-banner');
                
                // Reset progress bar
                const progressBar = banner.querySelector('.update-progress-bar');
                if (progressBar) {
                    progressBar.style.width = '0%';
                }
                
                // Hide progress container
                const progressContainer = banner.querySelector('.update-progress-container');
                if (progressContainer) {
                    progressContainer.style.display = 'none';
                }
            }, 500);
        }
    }

    // Check for service worker updates
    async checkServiceWorkerUpdate() {
        try {
            if (!this.serviceWorker || !this.serviceWorker.active) {
                console.log('⚠️ Service Worker not ready, skipping update check');
                return false;
            }

            console.log('🔍 Checking for service worker updates...');

            return new Promise((resolve, reject) => {
                const messageChannel = new MessageChannel();

                messageChannel.port1.onmessage = (event) => {
                    if (event.data && event.data.success) {
                        if (event.data.updated) {
                            console.log('✅ Service worker updated and activated:', event.data.message);
                            // For service worker updates, we don't need to download assets, just show banner
                            this.showUpdateBanner();
                        } else {
                            console.log('ℹ️ No service worker updates available:', event.data.message);
                        }
                        resolve(event.data.updated);
                    } else {
                        reject(new Error(event.data?.error || 'Service worker update check failed'));
                    }
                };

                this.serviceWorker.active.postMessage(
                    { type: 'CHECK_SW_UPDATE' },
                    [messageChannel.port2]
                );

                // Set timeout
                setTimeout(() => {
                    reject(new Error('Service worker update check timeout'));
                }, 10000);
            });
        } catch (error) {
            console.error('Error checking service worker updates:', error);
            return false;
        }
    }

    // Check for updates on reconnection
    async checkForUpdatesOnReconnection() {
        try {
            if (!this.serviceWorker || !this.serviceWorker.active) {
                console.log('⚠️ Service Worker not ready, skipping update check');
                return;
            }

            // Get cache manifest from server - prioritize WebSocket
            let serverAssets = [];
            try {
                if (window.wsClient && window.wsClient.isConnected()) {
                    console.log('🔌 Using WebSocket for cache manifest on reconnection');
                    const manifest = await window.wsClient.getCacheManifest();
                    serverAssets = manifest.assets || [];
                } else {
                    console.log('⚠️ WebSocket not connected, falling back to REST API for cache manifest');
                    const response = await fetch('/app', { method: 'OPTIONS' });
                    if (response.ok) {
                        const data = await response.json();
                        serverAssets = data.cacheData || [];
                    }
                }
            } catch (error) {
                console.error('Failed to get cache manifest on reconnection:', error);
                return;
            }

            if (serverAssets.length === 0) {
                console.log('⚠️ No server assets found, skipping update check');
                return;
            }

            // Check for updates
            const updateInfo = await this.checkForUpdates(serverAssets);

            if (updateInfo.needsUpdate) {
                console.log(`📥 ${updateInfo.assets.length} assets need updating on reconnection`);

                // Check for critical updates
                const criticalUpdates = [];
                const cachedAssetsMap = new Map();
                if (updateInfo.cachedAssets && updateInfo.cachedAssets.length > 0) {
                    updateInfo.cachedAssets.forEach(asset => cachedAssetsMap.set(asset.path, asset));
                }

                for (const asset of updateInfo.assets) {
                    const isCritical = asset.path.endsWith('.js') || asset.path.endsWith('.html');

                    if (isCritical) {
                        const cachedAsset = cachedAssetsMap.get(asset.path);
                        const wasPreviouslyCached = cachedAsset && cachedAsset.md5;

                        if (wasPreviouslyCached && wasPreviouslyCached !== asset.md5) {
                            console.log(`🔄 Critical file updated on reconnection: ${asset.path} (was: ${wasPreviouslyCached}, now: ${asset.md5})`);
                            criticalUpdates.push(asset);
                        }
                    }
                }

                // Show update banner if critical updates found
                if (criticalUpdates.length > 0) {
                    this.pendingCriticalUpdates = {
                        assets: updateInfo.assets,
                        criticalUpdates: criticalUpdates,
                        timestamp: Date.now()
                    };
                    
                    // Show update banner with progress bar and download assets
                    await this.showUpdateBannerWithProgress(updateInfo.assets);
                }
            }
        } catch (error) {
            console.error('Error checking for updates on reconnection:', error);
        }
    }
}

// Create global instance
window.cacheManager = new CacheManager();

// Register cache initialization steps with websocket client
if (window.wsClient) {
    // Step 2: Register service worker and initialize cache manager
    window.wsClient.registerInitStep(2, 'Initializing Service Worker', async () => {
        try {
            const success = await window.cacheManager.initialize();
            if (!success) {
                console.warn('Cache Manager initialization failed, continuing without caching');
            }
        } catch (error) {
            console.error('Error initializing Cache Manager:', error);
        }
    });

    // Step 3: Download and cache assets
    window.wsClient.registerInitStep(3, 'Downloading Assets', async () => {
        try {
            if (!window.cacheManager.isInitialized) {
                console.warn('Cache Manager not initialized, skipping asset download');
                return;
            }

            // Get cache manifest from server - prioritize HTTP for pre-WebSocket initialization
            let serverAssets = [];
            try {
                // Check if WebSocket is connected and use it if available
                if (window.wsClient && window.wsClient.isConnected()) {
                    const manifest = await window.wsClient.getCacheManifest();
                    serverAssets = manifest.assets || [];
                } else {
                    const response = await fetch('/app', { method: 'OPTIONS' });
                    if (response.ok) {
                        const data = await response.json();
                        serverAssets = data.cacheData || [];
                    }
                }
            } catch (error) {
                console.error('Failed to get cache manifest:', error);
                return;
            }

            if (serverAssets.length === 0) {
                console.warn('No assets to cache');
                return;
            }

            // Check for updates
            const updateInfo = await window.cacheManager.checkForUpdates(serverAssets);

            if (updateInfo.needsUpdate) {
                console.log(`📥 ${updateInfo.assets.length} assets need updating`);

                // Check for critical updates BEFORE downloading assets
                const criticalUpdates = [];

                // Use the cached assets we already retrieved from checkForUpdates
                const cachedAssetsMap = new Map();
                if (updateInfo.cachedAssets && updateInfo.cachedAssets.length > 0) {
                    updateInfo.cachedAssets.forEach(asset => cachedAssetsMap.set(asset.path, asset));
                    console.log(`📊 Using ${updateInfo.cachedAssets.length} cached assets for critical update detection`);
                } else {
                    console.warn('No cached assets available for critical update detection');
                }

                for (const asset of updateInfo.assets) {
                    const isCritical = asset.path.endsWith('.js') || asset.path.endsWith('.html');

                    if (isCritical) {
                        const cachedAsset = cachedAssetsMap.get(asset.path);
                        const wasPreviouslyCached = cachedAsset && cachedAsset.md5;

                        if (wasPreviouslyCached && wasPreviouslyCached !== asset.md5) {
                            console.log(`🔄 Critical file updated: ${asset.path} (was: ${wasPreviouslyCached}, now: ${asset.md5})`);
                            criticalUpdates.push(asset);
                        }
                    }
                }
                await window.cacheManager.showUpdateBannerWithProgress(updateInfo.assets, false);
            }
        } catch (error) {
            console.error('Error downloading assets:', error);
        }
    });

    // Step 4: Background cache cleanup (non-blocking)
    window.wsClient.registerInitStep(4, 'Cache Maintenance', async () => {
        try {
            if (!window.cacheManager.isInitialized) {
                return;
            }

            window.cacheManager.cleanupExpiredCache()
                .then(result => {
                    if (result && result.cleanedCount > 0) {
                        // Show glass toast with cleanup results
                        showGlassToast('success', 'Cache Cleaned', `🧹 Cache cleaned: ${result.cleanedCount} expired files removed`, false, 5000);
                        console.log(`🧹 Cache cleanup completed: ${result.cleanedCount} expired entries removed`);
                    }
                })
                .catch(error => {
                    console.warn('⚠️ Background cache cleanup failed:', error.message);
                });

        } catch (error) {
            console.error('Error in cache maintenance step:', error);
        }
    });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CacheManager;
}

// Global function for easy access from browser console (development only)
if (typeof window !== 'undefined') {
    window.reloadCacheData = async () => {
        try {
            if (!window.cacheManager) {
                throw new Error('Cache Manager not available');
            }

            console.log('🔄 Reloading cache data from server...');
            const result = await window.cacheManager.reloadCacheData();

            console.log('✅ Cache data reloaded successfully!');
            console.log(`📊 Assets: ${result.assetsCount}`);
            console.log(`⏰ Timestamp: ${new Date(result.timestamp).toLocaleString()}`);

            // Show success toast
            showGlassToast('success', 'Cache Reloaded', `Cache reloaded: ${result.assetsCount} assets`, false, 5000);

            return result;
        } catch (error) {
            console.error('❌ Failed to reload cache data:', error.message);
            showGlassToast('error', 'Cache Reload Failed', `Cache reload failed: ${error.message}`, false, 5000);

            throw error;
        }
    };

    // Global function for manual update check
    window.checkForUpdates = async () => {
        try {
            if (!window.cacheManager) {
                throw new Error('Cache Manager not available');
            }

            console.log('🔍 Manually checking for updates...');
            await window.cacheManager.checkForUpdatesOnReconnection();

        } catch (error) {
            console.error('❌ Manual update check failed:', error.message);
        }
    };

    // Global function for manual service worker update check
    window.checkServiceWorkerUpdate = async () => {
        try {
            if (!window.cacheManager) {
                throw new Error('Cache Manager not available');
            }

            console.log('🔍 Manually checking for service worker updates...');
            const updated = await window.cacheManager.checkServiceWorkerUpdate();
            
            if (updated) {
                console.log('✅ Service worker updated successfully');
                showGlassToast('success', 'Service Worker Updated', 'Service worker has been updated and activated', false, 5000);
            } else {
                console.log('ℹ️ No service worker updates found');
                showGlassToast('info', 'Service Worker Check', 'No service worker updates available', false, 3000);
            }

        } catch (error) {
            console.error('❌ Manual service worker update check failed:', error.message);
            showGlassToast('error', 'Service Worker Update Failed', `Update check failed: ${error.message}`, false, 5000);
        }
    };

    // Start periodic update checks to catch server restarts
    if (window.cacheManager) {
        // Check for updates every 5 minutes
        setInterval(() => {
            if (window.cacheManager.isInitialized && window.wsClient && window.wsClient.isConnected()) {
                console.log('🔄 Periodic update check...');
                window.cacheManager.checkForUpdatesOnReconnection().catch(error => {
                    console.warn('⚠️ Periodic update check failed:', error.message);
                });
            }
        }, 15 * 60 * 1000);
    }
}
