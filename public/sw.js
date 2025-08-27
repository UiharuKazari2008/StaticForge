// Service Worker for Dreamscape Workspace
const STATIC_CACHE_NAME = 'dreamscape-static-v1';
const DYNAMIC_CACHE_NAME = 'dreamscape-dynamic-v1';

// Cache expiration times (in milliseconds)
const CACHE_EXPIRATION = {
    '/previews/': 3 * 24 * 60 * 60000, // 3 days
    '/cache/':   15 * 24 * 60 * 60000,   // 15 days
    'default':   30 * 24 * 60 * 60000,   // 30 days default
};

// Paths that should use stale-while-revalidate strategy
const STALE_WHILE_REVALIDATE_PATHS = [
    '/previews/login_image.jpg'
];

// Path mappings for root routes
const PATH_MAPPINGS = {
    '/': '/index.html',
    '/app': '/app.html'
};

// Install event - cache core assets
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

// Clean up expired cache entries periodically
async function cleanupExpiredCache() {
    try {
        const cachesToCheck = [STATIC_CACHE_NAME, DYNAMIC_CACHE_NAME];
        let totalCleaned = 0;
        
        for (const cacheName of cachesToCheck) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            
            for (const request of keys) {
                const response = await cache.match(request);
                if (response && isCacheExpired(response, request.url)) {
                    await cache.delete(request);
                    totalCleaned++;
                }
            }
        }
        
        if (totalCleaned > 0) {
            console.log(`🧹 Cache cleanup completed: ${totalCleaned} expired entries removed`);
        }

        return {
            success: true,
            cleanedCount: totalCleaned,
            message: totalCleaned > 0 ? 
                `${totalCleaned} expired cache entries removed` : 
                'No expired cache entries found'
        };
    } catch (error) {
        console.error('❌ Error during cache cleanup:', error);
        return {
            success: false,
            error: error.message,
            cleanedCount: 0
        };
    }
}

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker activated');
            return self.clients.claim();
        })
    );
});

// Check for service worker updates
async function checkForUpdates() {
    try {
        // Force a check for updates
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
            await registration.update();
            console.log('Service Worker update check completed');
            
            // Check if there's a waiting service worker and force activation
            if (registration.waiting) {
                console.log('🔄 Waiting service worker found, forcing activation...');
                
                // Send skipWaiting message to force activation
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                
                // Wait a bit for the service worker to activate
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Check if controller changed
                if (navigator.serviceWorker.controller !== registration.active) {
                    console.log('✅ Service worker successfully updated and activated');
                    
                    // Notify clients about the update
                    const clients = await self.clients.matchAll();
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'SERVICE_WORKER_UPDATED',
                            message: 'Service worker has been updated and activated'
                        });
                    });
                    
                    return true;
                }
            }
            
            // Also check for installing service worker
            if (registration.installing) {
                console.log('🔄 Installing service worker found, waiting for completion...');
                
                return new Promise((resolve) => {
                    const installingWorker = registration.installing;
                    
                    const stateChangeHandler = () => {
                        if (installingWorker.state === 'installed') {
                            console.log('🔄 Service worker installed, forcing activation...');
                            installingWorker.postMessage({ type: 'SKIP_WAITING' });
                            
                            // Wait for activation
                            setTimeout(() => {
                                if (navigator.serviceWorker.controller !== registration.active) {
                                    console.log('✅ Service worker successfully updated and activated');
                                    
                                    // Notify clients about the update
                                    self.clients.matchAll().then(clients => {
                                        clients.forEach(client => {
                                            client.postMessage({
                                                type: 'SERVICE_WORKER_UPDATED',
                                                message: 'Service worker has been updated and activated'
                                            });
                                        });
                                    });
                                    
                                    resolve(true);
                                } else {
                                    resolve(false);
                                }
                            }, 1000);
                        } else if (installingWorker.state === 'activated') {
                            console.log('✅ Service worker activated');
                            resolve(true);
                        }
                    };
                    
                    installingWorker.addEventListener('statechange', stateChangeHandler);
                    
                    // Timeout after 10 seconds
                    setTimeout(() => {
                        installingWorker.removeEventListener('statechange', stateChangeHandler);
                        resolve(false);
                    }, 10000);
                });
            }
        }
        
        return false;
    } catch (error) {
        console.warn('Service Worker update check failed:', error);
        return false;
    }
}

// Check for updates every 10 minutes (more frequent for better update detection)
setInterval(checkForUpdates, 10 * 60 * 1000);

// Also check for updates when the service worker starts
checkForUpdates();

// Listen for skip waiting messages from the service worker itself
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('🔄 Service worker received skip waiting message, activating...');
        self.skipWaiting();
    }
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
    // Use a non-async wrapper to ensure proper control flow
    event.respondWith((async () => {
        const url = new URL(event.request.url);
        
        // Only handle requests to our domain
        if (url.origin !== self.location.origin) {
            return fetch(event.request);
        }
        
        // Skip non-GET requests
        if (event.request.method !== 'GET') {
            return fetch(event.request);
        }
        
        // Skip non-asset requests (API calls, etc.)
        if (url.pathname.startsWith('/temp/') || 
            url.pathname.startsWith('/images/') || 
            url.pathname.startsWith('/ping') ||
            url.pathname.startsWith('/sw.js') ||
            url.pathname.startsWith('/preset/') ||
            url.pathname.startsWith('/login') ||
            url.pathname.startsWith('/logout')) {
            return fetch(event.request);
        }

        // Handle /cache/ path - only cache .webp and .jpg files
        if (url.pathname.startsWith('/cache/')) {
            const ext = url.pathname.split('.').pop().toLowerCase();
            if (ext !== '.webp' && ext !== '.jpg' && ext !== '.jpeg') {
                return fetch(event.request);
            }
        }

        // Handle path mappings for root routes
        let requestPath = url.pathname;
        let originalPath = url.pathname;
        let isPathMapped = false;
        
        // Check if this is a path that should be mapped to an HTML file
        if (PATH_MAPPINGS[requestPath]) {
            requestPath = PATH_MAPPINGS[requestPath];
            isPathMapped = true;
        }

        // Handle transparent redirect from / to /app when session is valid
        if (url.pathname === '/') {
            // Check if we have a valid session by trying to fetch /app
            try {
                const appResponse = await fetch('/app', { method: 'OPTIONS', cache: 'no-store' });
                if (appResponse.ok) {
                    const data = await appResponse.json();
                    if (data.cacheData && data.cacheData.length > 0) {
                        console.log('✅ Valid session detected, transparently redirecting / to /app');
                        console.log('🔄 Returning redirect response for /');
                        return new Response(null, {
                            status: 302,
                            statusText: 'Found',
                            headers: {
                                'Location': '/app'
                            }
                        });
                    }
                }
            } catch (error) {
                console.log('⚠️ No valid session, serving /index.html normally');
            }
        } else if (url.pathname === '/app') {
            // Check if we have a valid session by trying to fetch /app
            try {
                const appResponse = await fetch('/app', { method: 'OPTIONS', cache: 'no-store' });
                if (!appResponse.ok) {
                    console.log('⚠️ No valid session, redirecting to /');
                    return new Response(null, {
                        status: 302,
                        statusText: 'Found',
                        headers: {
                            'Location': '/'
                        }
                    });
                } else {
                    checkForUpdates().catch(error => {
                        console.warn('Background service worker update check failed:', error);
                    });
                }
            } catch (error) {
                console.log('⚠️ No valid session, serving /app normally');
            }
        }

        // Determine which cache to use based on path
        const isDynamicResource = requestPath.startsWith('/previews/') || 
                                  requestPath.startsWith('/images/');

        const cacheName = isDynamicResource ? DYNAMIC_CACHE_NAME : STATIC_CACHE_NAME;
        
        // Check if this path should use stale-while-revalidate
        const useStaleWhileRevalidate = STALE_WHILE_REVALIDATE_PATHS.some(path => 
            requestPath === path || requestPath.startsWith(path)
        );

        if (useStaleWhileRevalidate) {
            // Use stale-while-revalidate strategy
            return handleStaleWhileRevalidate(event.request, requestPath, cacheName, isPathMapped, originalPath);
        } else {
            // Use standard cache-first strategy
            return handleCacheFirst(event.request, requestPath, cacheName, isPathMapped, originalPath);
        }
    })());
});

// Check if cached response has expired
function isCacheExpired(cachedResponse, requestPath) {
    try {
        // Get cache timestamp from response headers
        const cacheTimestamp = cachedResponse.headers.get('sw-cache-timestamp');
        if (!cacheTimestamp) {
            return false; // No timestamp, assume not expired
        }

        const cacheTime = parseInt(cacheTimestamp);
        const now = Date.now();
        
        // Determine expiration time based on path
        let expirationTime = CACHE_EXPIRATION.default;
        for (const [path, time] of Object.entries(CACHE_EXPIRATION)) {
            if (path !== 'default' && requestPath.startsWith(path)) {
                expirationTime = time;
                break;
            }
        }
        
        const isExpired = (now - cacheTime) > expirationTime;
        
        if (isExpired) {
            console.log(`Cache expired for ${requestPath}: ${Math.round((now - cacheTime) / (1000 * 60 * 60 * 24))} days old`);
        }
        
        return isExpired;
    } catch (error) {
        console.warn(`Error checking cache expiration for ${requestPath}:`, error);
        return false; // Assume not expired on error
    }
}

// Helper function to get the appropriate cache request and key
function getCacheRequestAndKey(request, requestPath, isPathMapped) {
    if (isPathMapped) {
        // For mapped paths, we cache the actual file (e.g., /index.html) but serve it for the original path (e.g., /)
        return {
            cacheRequest: new Request(requestPath, { method: 'GET' }),
            cacheKey: requestPath,
            isMapped: true
        };
    } else {
        // For regular paths, use the original request
        return {
            cacheRequest: request,
            cacheKey: request.url,
            isMapped: false
        };
    }
}

// Handle cache-first strategy (default for most assets)
async function handleCacheFirst(request, requestPath, cacheName, isPathMapped = false, originalPath = null) {
    try {
        // Get the appropriate cache request and key
        const { cacheRequest, cacheKey, isMapped } = getCacheRequestAndKey(request, requestPath, isPathMapped);
        
        // Try to get from cache first
        const cachedResponse = await caches.match(cacheRequest);
        if (cachedResponse) {
            // Check if cache has expired
            if (isCacheExpired(cachedResponse, requestPath)) {
                console.log(`Cache expired for ${requestPath}, fetching fresh content`);
                // Remove expired cache entry
                const cache = await caches.open(cacheName);
                await cache.delete(cacheRequest);
            } else {
                if (isMapped) {
                    console.log(`Serving mapped path ${originalPath} from cached ${requestPath}`);
                }
                return cachedResponse;
            }
        }
        
        // If not in cache or expired, fetch from network
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            // Clone and cache the response with timestamp
            const responseToCache = networkResponse.clone();
            const responseWithTimestamp = new Response(responseToCache.body, {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: responseToCache.headers
            });
            
            // Add cache timestamp header
            responseWithTimestamp.headers.set('sw-cache-timestamp', Date.now().toString());
            
            const cache = await caches.open(cacheName);
            await cache.put(cacheRequest, responseWithTimestamp);
            console.log(`Cached new asset: ${requestPath}${isMapped ? ` (mapped from ${originalPath})` : ''}`);
        }
        
        return networkResponse;
    } catch (error) {
        console.error(`Error in cache-first strategy for ${requestPath}:`, error);
        // Fallback to network
        return fetch(request);
    }
}

// Handle stale-while-revalidate strategy for specific paths
async function handleStaleWhileRevalidate(request, requestPath, cacheName, isPathMapped = false, originalPath = null) {
    try {
        // Get the appropriate cache request and key
        const { cacheRequest, cacheKey, isMapped } = getCacheRequestAndKey(request, requestPath, isPathMapped);
        
        // Try to get from cache first
        const cachedResponse = await caches.match(cacheRequest);
        
        // Start fetching from network in background (revalidation)
        const networkPromise = fetch(request).then(async (networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                // Update cache with fresh response and timestamp
                const responseToCache = networkResponse.clone();
                const responseWithTimestamp = new Response(responseToCache.body, {
                    status: responseToCache.status,
                    statusText: responseToCache.statusText,
                    headers: responseToCache.headers
                });
                
                // Add cache timestamp header
                responseWithTimestamp.headers.set('sw-cache-timestamp', Date.now().toString());
                
                const cache = await caches.open(cacheName);
                await cache.put(cacheRequest, responseWithTimestamp);
                console.log(`Updated stale asset: ${requestPath}${isMapped ? ` (mapped from ${originalPath})` : ''}`);
            }
            return networkResponse;
        }).catch(error => {
            console.warn(`Background revalidation failed for ${requestPath}:`, error);
        });
        
        if (cachedResponse) {
            // Check if cache has expired
            if (isCacheExpired(cachedResponse, requestPath)) {
                console.log(`Cache expired for ${requestPath}, serving fresh content`);
                // Return fresh content instead of expired cache
                return await networkPromise;
            } else {
                if (isMapped) {
                    console.log(`Serving stale mapped path ${originalPath} from cached ${requestPath} (revalidating in background)`);
                } else {
                    console.log(`Serving stale from cache: ${requestPath} (revalidating in background)`);
                }
                // Return cached response immediately, revalidate in background
                return cachedResponse;
            }
        } else {
            // No cache, wait for network response
            console.warn(`No cache for ${requestPath}, waiting for network`);
            return await networkPromise;
        }
    } catch (error) {
        console.error(`Error in stale-while-revalidate strategy for ${requestPath}:`, error);
        // Fallback to network
        return fetch(request);
    }
}

// Message event - handle cache operations
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_ASSETS') {
        console.log('Caching assets:', event.data.assets?.length || 0, 'assets');
        
        // Create progress callback to send updates to client
        const progressCallback = (progressData) => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage(progressData);
            }
        };
        
        event.waitUntil(cacheAssets(event.data.assets, progressCallback).then(results => {
            console.log('Cache operation completed:', results);
            // Send completion message back to client
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    type: 'CACHE_COMPLETE',
                    results: results
                });
            }
        }).catch(error => {
            console.error('Cache operation failed:', error);
            // Send error message back to client
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    type: 'CACHE_ERROR',
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'CLEAR_CACHE') {
        console.log('Clearing cache...');
        event.waitUntil(clearCache().then(result => {
            console.log('Clear cache completed:', result);
            // Send completion message back to client
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage(result);
            }
        }).catch(error => {
            console.error('Clear cache failed:', error);
            // Send error message back to client
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: false,
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'GET_CACHE_STATUS') {
        event.waitUntil(getCacheStatus().then(status => {
            event.ports[0].postMessage(status);
        }));
    } else if (event.data && event.data.type === 'REMOVE_CACHE_ENTRY') {
        console.log('Removing cache entry:', event.data.path);
        event.waitUntil(removeCacheEntry(event.data.path).then(result => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage(result);
            }
        }).catch(error => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: false,
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'CLEANUP_EXPIRED_CACHE') {
        console.log('Manual cache cleanup requested');
        event.waitUntil(cleanupExpiredCache().then(result => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage(result);
            }
        }).catch(error => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: false,
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'GET_ASSET_METADATA') {
        event.waitUntil(getAssetMetadata(event.data.path).then(metadata => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: true,
                    metadata: metadata
                });
            }
        }).catch(error => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: false,
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'CACHE_DEFAULT_BACKGROUND') {
        console.log('Caching default background:', event.data.url, 'as', event.data.targetPath);
        event.waitUntil(cacheDefaultBackground(event.data.url, event.data.targetPath).then(result => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage(result);
            }
        }).catch(error => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: false,
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'GET_ALL_CACHED_ASSETS') {
        console.log('Getting all cached assets metadata');
        event.waitUntil(getAllCachedAssets().then(assets => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: true,
                    assets: assets
                });
            }
        }).catch(error => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    success: false,
                    error: error.message
                });
            }
        }));
    } else if (event.data && event.data.type === 'CHECK_SW_UPDATE') {
        console.log('Manual service worker update check requested');
        event.waitUntil(checkForUpdates().then((updated) => {
            if (event.ports && event.ports[0] && updated) {
                event.ports[0].postMessage({ 
                    success: true, 
                    message: 'Service worker updated and activated',
                    updated: updated
                });
            }
        }).catch(error => {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({ success: false, error: error.message });
            }
        }));
    }
});

// Start periodic cache cleanup (every 6 hours)
setInterval(cleanupExpiredCache, 6 * 60 * 60 * 1000);

// Cache assets with smart verification and progress updates
async function cacheAssets(assets, progressCallback) {
    const cache = await caches.open(STATIC_CACHE_NAME);
    const results = [];
    const totalAssets = assets.length;
    
    for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const currentIndex = i + 1;
        
        try {
            // Check if asset is already cached and up-to-date
            const existingResponse = await cache.match(asset.path);
            if (existingResponse) {
                // Asset exists in cache, check if we need to update it using headers
                const existingMd5 = existingResponse.headers.get('sw-cache-md5');
                if (existingMd5 && existingMd5 === asset.md5) {
                    // Asset is up-to-date, skip download
                    results.push({ path: asset.path, success: true, skipped: true, reason: 'Already up-to-date' });
                    
                    // Send progress update for skipped assets
                    if (progressCallback) {
                        progressCallback({
                            type: 'PROGRESS_UPDATE',
                            current: currentIndex,
                            total: totalAssets,
                            percentage: Math.round((currentIndex / totalAssets) * 100),
                            asset: asset.path,
                            status: 'Downloading...',
                            skipped: true
                        });
                    }
                    continue;
                }
            }
            
            // Send progress update for starting download
            if (progressCallback) {
                progressCallback({
                    type: 'PROGRESS_UPDATE',
                    current: currentIndex,
                    total: totalAssets,
                    percentage: Math.round((currentIndex / totalAssets) * 100),
                    asset: asset.path,
                    status: 'Downloading...',
                    downloading: true
                });
            }
            
            // Download and cache the asset
            const response = await fetch(asset.path);
            if (response.ok) {
                // Store the MD5 hash from server response for future comparison
                const assetInfo = {
                    path: asset.path,
                    md5: asset.md5,
                    size: asset.size,
                    modified: asset.modified
                };
                
                // Create response with MD5 hash in headers
                const responseWithHeaders = new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: {
                        ...Object.fromEntries(response.headers.entries()),
                        'sw-cache-md5': asset.md5,
                        'sw-cache-timestamp': Date.now().toString()
                    }
                });
                
                // Clone response and cache
                const responseToCache = responseWithHeaders.clone();
                await cache.put(asset.path, responseToCache);
                
                results.push({ path: asset.path, success: true, downloaded: true });
                console.log(`Cached: ${asset.path} with hash: ${asset.md5}`);
                
                // Send progress update for completed download
                if (progressCallback) {
                    progressCallback({
                        type: 'PROGRESS_UPDATE',
                        current: currentIndex,
                        total: totalAssets,
                        percentage: Math.round((currentIndex / totalAssets) * 100),
                        asset: asset.path,
                        status: 'Downloading...',
                        completed: true
                    });
                }
            } else {
                results.push({ path: asset.path, success: false, error: `HTTP ${response.status}` });
                console.error(`Failed to cache ${asset.path}: HTTP ${response.status}`);
                
                // Send progress update for failed download
                if (progressCallback) {
                    progressCallback({
                        type: 'PROGRESS_UPDATE',
                        current: currentIndex,
                        total: totalAssets,
                        percentage: Math.round((currentIndex / totalAssets) * 100),
                        asset: asset.path,
                        status: `Failed: HTTP ${response.status}`,
                        failed: true
                    });
                }
            }
        } catch (error) {
            results.push({ path: asset.path, success: false, error: error.message });
            console.error(`Error caching ${asset.path}:`, error);
            
            // Send progress update for error
            if (progressCallback) {
                progressCallback({
                    type: 'PROGRESS_UPDATE',
                    current: currentIndex,
                    total: totalAssets,
                    percentage: Math.round((currentIndex / totalAssets) * 100),
                    asset: asset.path,
                    status: `Error: ${error.message}`,
                    failed: true
                });
            }
        }
    }
    
    return results;
}

// Cache default background image
async function cacheDefaultBackground(sourceUrl, targetPath) {
    try {
        console.log('🖼️ Caching default background:', sourceUrl, 'as', targetPath);
        
        // Check if the source image is already cached
        const cache = await caches.open(DYNAMIC_CACHE_NAME);
        const cachedResponse = await cache.match(sourceUrl);
        
        if (cachedResponse) {
            console.log('✅ Source image already cached, copying to target path');
            // Copy the cached source image to the target path
            const request = new Request(targetPath);
            await cache.put(request, cachedResponse);
            
            return {
                success: true,
                message: 'Default background copied from cache',
                sourceUrl: sourceUrl,
                targetPath: targetPath,
                cachedAt: new Date().toISOString(),
                isAlreadyCached: true
            };
        }
        
        // Fetch the source image if not cached
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch source image: ${response.status} ${response.statusText}`);
        }
        
        // Clone the response to avoid consuming it
        const responseClone = response.clone();
        
        // Store in dynamic cache with the target path
        const request = new Request(targetPath);
        
        // Create a new response with the image data
        const imageBlob = await response.blob();
        const newResponse = new Response(imageBlob, {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000', // 1 year
                'X-Cached-From': sourceUrl,
                'X-Cached-At': new Date().toISOString()
            }
        });
        
        await cache.put(request, newResponse);
        
        console.log('✅ Default background cached successfully:', targetPath);
        
        return {
            success: true,
            message: 'Default background cached successfully',
            sourceUrl: sourceUrl,
            targetPath: targetPath,
            size: imageBlob.size,
            cachedAt: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Failed to cache default background:', error);
        
        // Try to create a placeholder default background
        try {
            const placeholderResult = await createPlaceholderDefaultBackground(targetPath);
            if (placeholderResult.success) {
                console.log('✅ Created placeholder default background');
                return placeholderResult;
            }
        } catch (placeholderError) {
            console.error('Failed to create placeholder default background:', placeholderError);
        }
        
        return {
            success: false,
            error: error.message,
            sourceUrl: sourceUrl,
            targetPath: targetPath
        };
    }
}

// Create a placeholder default background if the source image is not available
async function createPlaceholderDefaultBackground(targetPath) {
    try {
        console.log('🎨 Creating placeholder default background');
        
        // Create a simple colored canvas as placeholder
        const canvas = new OffscreenCanvas(1920, 1080);
        const ctx = canvas.getContext('2d');
        
        // Create a gradient background
        const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.5, '#16213e');
        gradient.addColorStop(1, '#0f3460');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1920, 1080);
        
        // Add some subtle pattern
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 1920; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, 1080);
            ctx.stroke();
        }
        for (let i = 0; i < 1080; i += 50) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(1920, i);
            ctx.stroke();
        }
        
        // Convert canvas to blob
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        
        // Store in dynamic cache
        const cache = await caches.open(DYNAMIC_CACHE_NAME);
        const request = new Request(targetPath);
        
        const newResponse = new Response(blob, {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000', // 1 year
                'X-Cached-From': 'placeholder',
                'X-Cached-At': new Date().toISOString(),
                'X-Is-Placeholder': 'true'
            }
        });
        
        await cache.put(request, newResponse);
        
        console.log('✅ Placeholder default background created successfully');
        
        return {
            success: true,
            message: 'Placeholder default background created successfully',
            sourceUrl: 'placeholder',
            targetPath: targetPath,
            size: blob.size,
            cachedAt: new Date().toISOString(),
            isPlaceholder: true
        };
        
    } catch (error) {
        console.error('❌ Failed to create placeholder default background:', error);
        throw error;
    }
}

// Clear all cached assets
async function clearCache() {
    try {
        await caches.delete(STATIC_CACHE_NAME);
        await caches.delete(DYNAMIC_CACHE_NAME);
        console.log('All caches cleared successfully');
        return { success: true };
    } catch (error) {
        console.error('Error clearing cache:', error);
        return { success: false, error: error.message };
    }
}

// Get cache status
async function getCacheStatus() {
    try {
        const staticCache = await caches.open(STATIC_CACHE_NAME);
        const dynamicCache = await caches.open(DYNAMIC_CACHE_NAME);
        
        const staticKeys = await staticCache.keys();
        const dynamicKeys = await dynamicCache.keys();
        const cacheData = {
            assets: [],
            timestamp: Date.now()
        };
        
        for (const request of [...staticKeys, ...dynamicKeys]) {
            try {
                const response = await caches.match(request);
                if (response) {
                    const md5 = response.headers.get('sw-cache-md5');
                    if (md5) {
                        cacheData.assets.push({
                            path: request.url.replace(self.location.origin, ''),
                            md5: md5
                        });
                    }
                }
            } catch (error) {
                console.warn('Failed to get metadata from cached response:', error.message);
            }
        }
        
        return {
            success: true,
            staticCache: {
                name: STATIC_CACHE_NAME,
                cachedFiles: staticKeys.length
            },
            dynamicCache: {
                name: DYNAMIC_CACHE_NAME,
                cachedFiles: dynamicKeys.length
            },
            totalCachedFiles: staticKeys.length + dynamicKeys.length,
            cacheData: cacheData
        };
    } catch (error) {
        console.error('Error getting cache status:', error);
        return { success: false, error: error.message };
    }
}

// Get asset metadata for hash comparison from cache headers
async function getAssetMetadata(path) {
    try {
        // Try to get from static cache first
        const staticCache = await caches.open(STATIC_CACHE_NAME);
        let response = await staticCache.match(path);
        
        // If not in static cache, try dynamic cache
        if (!response) {
            const dynamicCache = await caches.open(DYNAMIC_CACHE_NAME);
            response = await dynamicCache.match(path);
        }
        
        if (response) {
            const md5 = response.headers.get('sw-cache-md5');
            const timestamp = response.headers.get('sw-cache-timestamp');
            
            if (md5) {
                return {
                    path: path,
                    md5: md5,
                    timestamp: timestamp ? parseInt(timestamp) : null
                };
            }
        }
        
        return null;
    } catch (error) {
        console.warn('Failed to get asset metadata from cache:', error.message);
        return null;
    }
}

// Get all cached assets with their MD5 hashes
async function getAllCachedAssets() {
    try {
        const staticCache = await caches.open(STATIC_CACHE_NAME);
        const dynamicCache = await caches.open(DYNAMIC_CACHE_NAME);
        
        const staticKeys = await staticCache.keys();
        const dynamicKeys = await dynamicCache.keys();
        
        const allCachedAssets = [];
        
        // Process all cached requests
        for (const request of [...staticKeys, ...dynamicKeys]) {
            try {
                const response = await caches.match(request);
                if (response) {
                    const md5 = response.headers.get('sw-cache-md5');
                    if (md5) {
                        // Extract the path from the request URL
                        const url = new URL(request.url);
                        const path = url.pathname;
                        
                        allCachedAssets.push({
                            path: path,
                            md5: md5,
                            timestamp: response.headers.get('sw-cache-timestamp') ? 
                                parseInt(response.headers.get('sw-cache-timestamp')) : null
                        });
                    }
                }
            } catch (error) {
                console.warn('Failed to get metadata from cached response:', error.message);
            }
        }
        
        console.log(`Found ${allCachedAssets.length} cached assets with MD5 hashes`);
        return allCachedAssets;
        
    } catch (error) {
        console.error('Failed to get all cached assets:', error);
        return [];
    }
}

// Remove specific cache entry from both caches
async function removeCacheEntry(path) {
    try {
        let removedFromStatic = false;
        let removedFromDynamic = false;
        
        // Try to remove from static cache
        try {
            const staticCache = await caches.open(STATIC_CACHE_NAME);
            const request = new Request(path);
            removedFromStatic = await staticCache.delete(request);
        } catch (error) {
            console.warn('Failed to remove from static cache:', error.message);
        }
        
        // Try to remove from dynamic cache
        try {
            const dynamicCache = await caches.open(DYNAMIC_CACHE_NAME);
            const request = new Request(path);
            removedFromDynamic = await dynamicCache.delete(request);
        } catch (error) {
            console.warn('Failed to remove from dynamic cache:', error.message);
        }
        
        console.log(`Cache entry removed: ${path} (static: ${removedFromStatic}, dynamic: ${removedFromDynamic})`);
        
        return {
            success: true,
            path: path,
            removedFromStatic: removedFromStatic,
            removedFromDynamic: removedFromDynamic
        };
    } catch (error) {
        console.error('Error removing cache entry:', error);
        return {
            success: false,
            error: error.message
        };
    }
}
