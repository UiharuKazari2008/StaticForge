importScripts('/dist/workbox/workbox-sw.js');

// Enable Workbox logging in development
if (workbox) {
  workbox.setConfig({ debug: false });
}

const { strategies, expiration, cacheableResponse } = workbox;

// Cache names
const STATIC_CACHE = 'static-cache-v1';
const DYNAMIC_CACHE = 'dynamic-cache-v1';
const INTERNAL_CACHE = 'internal-cache-v1';

// Helper function to add cache-busting headers to responses
function addCacheBustingHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Surrogate-Control', 'no-store');
  headers.set('Last-Modified', new Date().toUTCString());
  headers.set('ETag', `"${Date.now()}"`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

// Rolling key management for service worker authentication
let currentRollingKey = null;
let keyExpiresAt = 0;
let keyFetchPromise = null;
let lastRateLimitTime = 0;
let rateLimitRetryCount = 0;
const MAX_RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BACKOFF_BASE = 2000; // 2 seconds base backoff
const KEY_REFRESH_BUFFER = 240000; // Refresh 4 minutes before expiry (server rotates every 5 minutes)
const RATE_LIMIT_RESET_TIME = 300000; // Reset rate limit counters after 5 minutes of no errors

// Reset rate limit tracking after successful fetches
function resetRateLimitTracking() {
  rateLimitRetryCount = 0;
  lastRateLimitTime = 0;
}

// Periodic cleanup to prevent permanent backoff state
function cleanupRateLimitTracking() {
  const now = Date.now();
  if (lastRateLimitTime > 0 && now - lastRateLimitTime > RATE_LIMIT_RESET_TIME) {
    console.log('🔑 Service Worker: Resetting rate limit tracking after timeout');
    resetRateLimitTracking();
  }
}

// Fetch current rolling key from server with exponential backoff
async function fetchRollingKey() {
  // Periodic cleanup to prevent permanent backoff state
  cleanupRateLimitTracking();

  if (keyFetchPromise) {
    return keyFetchPromise;
  }

  const now = Date.now();
  const timeUntilExpiry = keyExpiresAt - now;
  const shouldRefresh = !currentRollingKey || now >= keyExpiresAt - KEY_REFRESH_BUFFER;

  // Check if we have a valid cached key
  if (currentRollingKey && now < keyExpiresAt - KEY_REFRESH_BUFFER) {
    return currentRollingKey;
  }

  // Check if we're in rate limit backoff period
  const backoffTime = RATE_LIMIT_BACKOFF_BASE * Math.pow(2, rateLimitRetryCount);
  if (lastRateLimitTime > 0 && now - lastRateLimitTime < backoffTime) {
    console.log(`🔑 Service Worker: In rate limit backoff period, using cached key (${Math.ceil((backoffTime - (now - lastRateLimitTime)) / 1000)}s remaining)`);
    if (currentRollingKey) {
      return currentRollingKey;
    }
  }

  keyFetchPromise = (async () => {
    try {
      const response = await fetch('/sw.js', {
        method: 'OPTIONS',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'X-Requested-With': 'ServiceWorker'
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limit hit - implement exponential backoff
          lastRateLimitTime = Date.now();
          rateLimitRetryCount = Math.min(rateLimitRetryCount + 1, MAX_RATE_LIMIT_RETRIES);

          console.warn(`🔑 Service Worker: Rate limit hit (${rateLimitRetryCount}/${MAX_RATE_LIMIT_RETRIES}), backing off for ${Math.ceil(backoffTime / 1000)}s, time until expiry: ${Math.ceil(timeUntilExpiry / 1000)}s`);

          // Return cached key if available
          if (currentRollingKey) {
            console.warn('🔑 Service Worker: Using cached key during rate limit backoff');
            return currentRollingKey;
          }

          throw new Error(`Rate limit exceeded, retry in ${Math.ceil(backoffTime / 1000)}s`);

        } else if (response.status === 500) {
          // Server error - don't retry immediately, use cached key if available
          console.error('🔑 Service Worker: Server error (500) when fetching rolling key');

          if (currentRollingKey) {
            console.warn('🔑 Service Worker: Using cached key due to server error');
            return currentRollingKey;
          }

          throw new Error('Server error while fetching rolling key');

        } else if (response.status === 503) {
          // Service unavailable - similar to server error
          console.error('🔑 Service Worker: Service unavailable (503) when fetching rolling key');

          if (currentRollingKey) {
            console.warn('🔑 Service Worker: Using cached key due to service unavailability');
            return currentRollingKey;
          }

          throw new Error('Service unavailable while fetching rolling key');

        } else if (response.status >= 400 && response.status < 500) {
          // Client errors (4xx) - likely configuration or permission issues
          console.error(`🔑 Service Worker: Client error (${response.status}) when fetching rolling key`);

          if (currentRollingKey) {
            console.warn('🔑 Service Worker: Using cached key due to client error');
            return currentRollingKey;
          }

          throw new Error(`Client error (${response.status}) while fetching rolling key`);

        } else {
          // Other errors (5xx, network issues, etc.)
          console.error(`🔑 Service Worker: Unexpected error (${response.status}) when fetching rolling key`);

          if (currentRollingKey) {
            console.warn('🔑 Service Worker: Using cached key due to unexpected error');
            return currentRollingKey;
          }

          throw new Error(`Failed to fetch rolling key: ${response.status}`);
        }
      }

      const data = await response.json();
      currentRollingKey = data.key;
      keyExpiresAt = data.expiresAt;

      // Reset rate limit tracking on successful fetch
      resetRateLimitTracking();
      return currentRollingKey;

    } catch (error) {
      // Handle network errors (fetch failures)
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('🔑 Service Worker: Network error when fetching rolling key:', error);

        // For network errors, increment retry count but with shorter backoff
        rateLimitRetryCount = Math.min(rateLimitRetryCount + 1, MAX_RATE_LIMIT_RETRIES);
        lastRateLimitTime = Date.now();

        if (currentRollingKey) {
          console.warn('🔑 Service Worker: Using cached key due to network error');
          return currentRollingKey;
        }

        throw new Error('Network error while fetching rolling key');
      }

      console.error('🔑 Service Worker: Failed to fetch rolling key:', error);

      // Return cached key if available, even if expired
      if (currentRollingKey) {
        console.warn('🔑 Service Worker: Using expired cached key as fallback');
        return currentRollingKey;
      }

      throw error;
    }
  })();

  try {
    const result = await keyFetchPromise;
    return result;
  } finally {
    keyFetchPromise = null;
  }
}

// Helper function to create service worker identification headers with rolling key
async function createServiceWorkerHeaders() {
  try {
    const rollingKey = await fetchRollingKey();
    return {
      'X-SW-Key': rollingKey,
      'X-Service-Worker-Version': '2.0', // Updated version for rolling key support
      'X-Requested-With': 'ServiceWorker'
    };
  } catch (error) {
    console.error('🔑 Service Worker: Failed to get rolling key for headers:', error);
    // Return empty headers if we can't get a key
    return {
      'X-Service-Worker-Version': '2.0',
      'X-Requested-With': 'ServiceWorker'
    };
  }
}

// Helper function to check if response should be cached based on server headers
function shouldCacheResponse(response) {
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl && (cacheControl.includes('blocked') || cacheControl.includes('realtime'))) {
    return false;
  }
  return true;
}

// Cache strategies - STATIC_CACHE is permanent and always returned with immediate expiry
const staticStrategy = new strategies.CacheFirst({
  cacheName: STATIC_CACHE,
  plugins: [
    new cacheableResponse.CacheableResponsePlugin({
      statuses: [0, 200],
    }),
    new expiration.ExpirationPlugin({
      maxEntries: 1000,
      maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
    }),
  ],
});

// Dynamic cache strategy - cache first with network fallback and immediate expiry
const dynamicStrategy = new strategies.CacheFirst({
  cacheName: DYNAMIC_CACHE,
  plugins: [
    new cacheableResponse.CacheableResponsePlugin({
      statuses: [0, 200],
    }),
    new expiration.ExpirationPlugin({
      maxEntries: 500,
      maxAgeSeconds: 24 * 60 * 60, // 24 hours
    }),
  ],
});

// Image strategy - cache first with network fallback and immediate expiry
const imageStrategy = new strategies.CacheFirst({
  cacheName: DYNAMIC_CACHE,
  plugins: [
    new cacheableResponse.CacheableResponsePlugin({
      statuses: [0, 200],
    }),
    new expiration.ExpirationPlugin({
      maxEntries: 200,
      maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
    }),
  ],
});

// Internal strategy - only return cached data, never fetch from network
const internalStrategy = {
  async handle({ request, event }) {
    try {
      const cache = await caches.open(INTERNAL_CACHE);
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        // Add cache-busting headers to prevent browser caching
        const response = addCacheBustingHeaders(cachedResponse);
        
        // Emit receive event for cached internal data
        notifyClientsOfNetworkActivity('receive', {
          url: request.url,
          method: request.method,
          status: response.status,
          timestamp: Date.now()
        });
        
        return response;
      }
      
      // If not in cache, internal URLs are client-side only
      // Return a 404 since this data should have been cached by the client
      const response = new Response('Internal data not found in cache', { 
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          'x-internal-missing': 'true',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      // Emit receive event for 404 response
      notifyClientsOfNetworkActivity('receive', {
        url: request.url,
        method: request.method,
        status: 404,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      // Emit receive event for failed requests
      notifyClientsOfNetworkActivity('receive', {
        url: request.url,
        method: request.method,
        status: 0,
        error: error.message,
        timestamp: Date.now()
      });
      
      throw error;
    }
  }
};

// Custom strategy wrapper to add cache-busting headers and emit network events
function createCacheBustingStrategy(strategy) {
  return {
    async handle({ request, event }) {
      try {
        const response = await strategy.handle({ request, event });
        if (response) {
          const finalResponse = addCacheBustingHeaders(response);
          
          // Emit receive event for successful responses
          notifyClientsOfNetworkActivity('receive', {
            url: request.url,
            method: request.method,
            status: response.status,
            timestamp: Date.now()
          });
          
          return finalResponse;
        }
        return response;
      } catch (error) {
        // Emit receive event for failed requests
        notifyClientsOfNetworkActivity('receive', {
          url: request.url,
          method: request.method,
          status: 0,
          error: error.message,
          timestamp: Date.now()
        });
        
        throw error;
      }
    }
  };
}

// Block all requests for chrome-extension://
workbox.routing.registerRoute(
  ({ url, request }) => {
    return url.protocol === 'chrome-extension:';
  },
  async (event) => {
    const { request, url } = event;
    return new Response('', {
      status: 403,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
);

// Unified route handler for all requests
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Always handle requests that start with /
    return url.pathname.startsWith('/');
  },
  async (event) => {
    const { request, url } = event;
    
    try {
      let response;
      
      // Handle internal routes (client-side only)
      if (url.pathname.startsWith('/internal/')) {
        response = await internalStrategy.handle(event);
      }
      // Handle route-based paths (/, /app) with custom caching
      else if (url.pathname === '/' || url.pathname === '/app' || url.pathname === '/index.html') {
        const cache = await caches.open(STATIC_CACHE);
        
        // Determine the route path and endpoint
        const routePath = url.pathname === '/index.html' ? '/' : url.pathname;
        const endpoint = routePath;
        
        // Try to serve from cache first
        const cachedResponse = await cache.match(routePath);
        if (cachedResponse) {
          response = addCacheBustingHeaders(cachedResponse);
        } else {
          // If not cached, fetch from server endpoint and cache
          try {
            const swHeaders = await createServiceWorkerHeaders();
            const fetchResponse = await fetch(endpoint, {
              cache: 'no-store',
              headers: {
                ...swHeaders,
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0'
              }
            });
            
            if (fetchResponse.ok && fetchResponse.status >= 200 && fetchResponse.status < 300 && shouldCacheResponse(fetchResponse)) {
              // Add cache-busting headers
              const headers = new Headers(fetchResponse.headers);
              headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
              headers.set('Pragma', 'no-cache');
              headers.set('Expires', '0');
              headers.set('Surrogate-Control', 'no-store');
              
              const responseWithHeaders = new Response(fetchResponse.body, {
                status: fetchResponse.status,
                statusText: fetchResponse.statusText,
                headers: headers
              });
              
              // Cache at route path
              await cache.put(routePath, responseWithHeaders);
              response = addCacheBustingHeaders(responseWithHeaders);
            } else {
              response = fetchResponse;
            }
          } catch (error) {
            console.error(`Failed to fetch from ${endpoint} endpoint:`, error);
            throw error;
          }
        }
      }
      // Handle previews and cache with dynamic strategy
      else if (url.pathname.startsWith('/previews/') || url.pathname.startsWith('/cache/')) {
        response = await createCacheBustingStrategy(dynamicStrategy).handle(event);
      }
      // Handle images with image strategy
      else if (url.pathname.startsWith('/images/')) {
        response = await createCacheBustingStrategy(imageStrategy).handle(event);
      }
      // Handle all other static files with static strategy
      else {
        response = await createCacheBustingStrategy(staticStrategy).handle(event);
      }
      
      return response;
    } catch (error) {
      // Emit receive event for failed requests
      notifyClientsOfNetworkActivity('receive', {
        url: request.url,
        method: request.method,
        status: 0,
        error: error.message,
        timestamp: Date.now()
      });
      
      // Re-throw the error
      throw error;
    }
  }
);

// Handle SPA navigation routes - use static cache if available, otherwise redirect
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Check if this is an HTML request that might be a client-side route
    const acceptHeader = request.headers.get('accept');
    const isHtmlRequest = acceptHeader && acceptHeader.includes('text/html');
    const isNotStaticFile = !url.pathname.includes('.') && 
                           !url.pathname.startsWith('/previews/') && 
                           !url.pathname.startsWith('/cache/') && 
                           !url.pathname.startsWith('/images/') && 
                           !url.pathname.startsWith('/internal/') &&
                           url.pathname !== '/' &&
                           url.pathname !== '/app';
    
    return isHtmlRequest && isNotStaticFile;
  },
  async ({ request, url }) => {
    try {
      const cache = await caches.open(STATIC_CACHE);
      const cachedResponse = await cache.match(request);
      
      // If we have a cached version, return it with cache-busting headers
      if (cachedResponse) {
        const response = addCacheBustingHeaders(cachedResponse);
        
        // Emit receive event for cached response
        notifyClientsOfNetworkActivity('receive', {
          url: request.url,
          method: request.method,
          status: response.status,
          timestamp: Date.now()
        });
        
        return response;
      }
      
      // If no cached version, redirect to main app for client-side routing
      const response = new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Dreamscape Workspace</title>
            <script>
              // Redirect to main app for client-side routing
              window.location.href = '/';
            </script>
          </head>
          <body>
            <div>Redirecting to main app...</div>
          </body>
        </html>
      `, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store',
          'Content-Type': 'text/html',
          'x-spa-redirect': 'true'
        }
      });
      
      // Emit receive event for SPA redirect response
      notifyClientsOfNetworkActivity('receive', {
        url: request.url,
        method: request.method,
        status: response.status,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      // Emit receive event for failed requests
      notifyClientsOfNetworkActivity('receive', {
        url: request.url,
        method: request.method,
        status: 0,
        error: error.message,
        timestamp: Date.now()
      });
      
      throw error;
    }
  }
);

// Message handling for client communication
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_STATIC_FILES') {
        cacheStaticFiles(event.data.files);
    } else if (event.data && event.data.type === 'NO_UPDATES_AVAILABLE') {
        // Notify clients that no updates are available
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'NO_UPDATES_AVAILABLE'
                });
            });
        });
    } else if (event.data && event.data.type === 'CACHE_INTERNAL') {
        cacheInternalData(event.data.url, event.data.data);
    } else if (event.data && event.data.type === 'GET_CACHE_STATUS') {
        getCacheStatus(event.data.requestId);
    } else if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Cache static files from server
async function cacheStaticFiles(files) {
    try {
        const cache = await caches.open(STATIC_CACHE);
        let completed = 0;
        const total = files.length;
        
        // Cache files one by one to track progress
        for (const file of files) {
            try {
                // Fetch with cache-busting headers to prevent browser caching
                const swHeaders = await createServiceWorkerHeaders();
                const response = await fetch(file.url, {
                  cache: 'no-store',
                  headers: {
                    ...swHeaders,
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                  }
                });
                if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)) {
                    try {
                        // Check if file already exists in cache
                        const existingResponse = await cache.match(file.url);
                        if (existingResponse) {
                            // Delete the old entry to ensure clean replacement
                            await cache.delete(file.url);
                        }

                        // Add hash to response headers for future comparison
                        const headers = new Headers(response.headers);
                        headers.set('x-file-hash', file.hash);

                        // Add comprehensive cache-busting headers to the cached response
                        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                        headers.set('Pragma', 'no-cache');
                        headers.set('Expires', '0');
                        headers.set('Surrogate-Control', 'no-store');

                        const responseWithHash = new Response(response.body, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: headers
                        });

                        await cache.put(file.url, responseWithHash);

                        // Verify it was cached with the new hash
                        const cachedResponse = await cache.match(file.url);
                        if (cachedResponse) {
                            const newHash = cachedResponse.headers.get('x-file-hash');

                            // Double-check the hash matches what we intended to store
                            if (newHash !== file.hash) {
                                console.warn(`Hash mismatch! Expected: ${file.hash}, Got: ${newHash}`);
                            }
                        }

                        completed++;

                        // Notify client of progress
                        self.clients.matchAll().then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'STATIC_CACHE_PROGRESS',
                                    completed: completed,
                                    total: total,
                                    currentFile: file.url
                                });
                            });
                        });
                    } catch (cacheError) {
                        console.error(`Failed to cache ${file.url}:`, cacheError);
                        // Notify client of cache error
                        self.clients.matchAll().then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'STATIC_CACHE_ERROR',
                                    file: file.url,
                                    error: cacheError.message
                                });
                            });
                        });
                        completed++;
                    }
                } else {
                    console.warn(`Failed to fetch ${file.url}: ${response.status} ${response.statusText}`);
                    // Notify client of fetch error
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'STATIC_CACHE_ERROR',
                                file: file.url,
                                error: `HTTP ${response.status}: ${response.statusText}`
                            });
                        });
                    });
                    completed++;
                }
            } catch (error) {
                console.error(`Failed to cache ${file.url}:`, error);
                completed++;
            }
        }
        
        // Notify client of completion
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_COMPLETE',
                    files: files,
                    completed: completed,
                    total: total
                });
            });
        });
    } catch (error) {
        console.error('Error caching static files:', error);
    }
}

// Cache internal data
async function cacheInternalData(url, data) {
  try {
    const cache = await caches.open(INTERNAL_CACHE);
    
    // If data contains imageUrl, fetch that URL and store the content at the specified path
    if (data.imageUrl) {
      try {
        const swHeaders = await createServiceWorkerHeaders();
        const fetchedResponse = await fetch(data.imageUrl, {
          cache: 'no-store',
          headers: {
            ...swHeaders,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
          });
        if (fetchedResponse.ok && fetchedResponse.status >= 200 && fetchedResponse.status < 300) {
          // Add cache-busting headers to prevent browser caching
          const headers = new Headers(fetchedResponse.headers);
          headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          headers.set('Pragma', 'no-cache');
          headers.set('Expires', '0');
          headers.set('Surrogate-Control', 'no-store');
          
          const responseWithHeaders = new Response(fetchedResponse.body, {
            status: fetchedResponse.status,
            statusText: fetchedResponse.statusText,
            headers: headers
          });
          
          // Only cache successful responses (status < 300)
          await cache.put(url, responseWithHeaders);
          
          // Notify client of completion
          self.clients.matchAll().then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'INTERNAL_CACHE_COMPLETE',
                url: url
              });
            });
          });
          return;
        } else {
          console.warn(`Failed to cache internal data: response status ${fetchedResponse.status}`);
        }
      } catch (error) {
        console.error('Failed to fetch content for internal cache:', error);
      }
    }
    
    // Fallback: store the data as-is if no imageUrl or fetch failed
    const response = new Response(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'x-internal-data': 'true'
      }
    });
    
    await cache.put(url, response);
    
    // Notify client of completion
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'INTERNAL_CACHE_COMPLETE',
          url: url
        });
      });
    });
  } catch (error) {
    console.error('Error caching internal data:', error);
  }
}

// Get cache status
async function getCacheStatus(requestId) {
  try {
    const staticCache = await caches.open(STATIC_CACHE);
    const dynamicCache = await caches.open(DYNAMIC_CACHE);
    const internalCache = await caches.open(INTERNAL_CACHE);
    
    const staticKeys = await staticCache.keys();
    const dynamicKeys = await dynamicCache.keys();
    const internalKeys = await internalCache.keys();
    
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'CACHE_STATUS',
          requestId: requestId,
          static: staticKeys.length,
          dynamic: dynamicKeys.length,
          internal: internalKeys.length
        });
      });
    });
  } catch (error) {
    console.error('Error getting cache status:', error);
  }
}

// Install event - cache critical files
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Preload critical routes from server endpoints
      const criticalRoutes = [
        { endpoint: '/', route: '/' },
        { endpoint: '/app', route: '/app' },
        { endpoint: '/launch', route: '/launch' }
      ];
      const cache = await caches.open(STATIC_CACHE);
      
      for (const { endpoint, route } of criticalRoutes) {
        try {
          const swHeaders = await createServiceWorkerHeaders();
          const response = await fetch(endpoint, {
            cache: 'no-store',
            headers: {
              ...swHeaders,
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          
          if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)) {
            // Add cache-busting headers
            const headers = new Headers(response.headers);
            headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            headers.set('Pragma', 'no-cache');
            headers.set('Expires', '0');
            headers.set('Surrogate-Control', 'no-store');
            
            const responseWithHeaders = new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });
            
            // Cache at the route path
            await cache.put(route, responseWithHeaders);
            console.log(`Preloaded ${endpoint} into cache at route ${route}`);
          }
        } catch (error) {
          console.warn(`Failed to preload ${endpoint}:`, error);
        }
      }
    })()
  );
  
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE && 
              cacheName !== INTERNAL_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Development Bridge Network Monitoring
let devBridgeClient = null;

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_DEV_CONFIG') {
    if (devBridgeClient) {
      devBridgeClient.close();
    }
    // Only initialize if dev mode is enabled
    if (event.data.devMode === true) {
      initDevBridge(event.data.devHost, event.data.devPort);
    }
  }
});

// Initialize dev bridge connection
function initDevBridge(devHost = 'localhost', devPort = 9221) {
  // Always try to connect to dev bridge, but handle failures gracefully
  // The dev bridge server will only be available when dev mode is enabled
  const wsUrl = `ws://${devHost}:${devPort}`;
  
  try {
    devBridgeClient = new WebSocket(wsUrl);
      
      devBridgeClient.onopen = () => {
        console.log('🔧 Service Worker: Dev Bridge connected');
      };
      
      devBridgeClient.onmessage = (event) => {
        // Handle messages from dev bridge server
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'welcome') {
            console.log('🔧 Service Worker: Dev Bridge client ID:', message.clientId);
          }
        } catch (error) {
          console.error('🔧 Service Worker: Invalid dev bridge message:', error);
        }
      };
      
      devBridgeClient.onclose = () => {
        console.log('🔧 Service Worker: Dev Bridge disconnected');
        devBridgeClient = null;
      };
      
      devBridgeClient.onerror = (error) => {
        // Don't log this as an error since dev mode might not be enabled
        console.log('🔧 Service Worker: Dev Bridge not available (dev mode may be disabled)');
      };
      
    } catch (error) {
      // Don't log this as an error since dev mode might not be enabled
      console.log('🔧 Service Worker: Dev Bridge not available (dev mode may be disabled)');
    }
}

// Send network log to dev bridge
function logNetworkRequest(requestData) {
  if (devBridgeClient && devBridgeClient.readyState === WebSocket.OPEN) {
    try {
      devBridgeClient.send(JSON.stringify({
        type: 'network',
        networkType: 'service_worker_request',
        ...requestData,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('🔧 Service Worker: Failed to send network log:', error);
    }
  }
}

// Send network activity event to all clients
function notifyClientsOfNetworkActivity(type, requestData) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'NETWORK_ACTIVITY',
        activityType: type, // 'transmit' or 'receive'
        requestData: requestData,
        timestamp: Date.now()
      });
    });
  });
}

// Send log to dev bridge
function logToDevBridge(level, message, data = null) {
  if (devBridgeClient && devBridgeClient.readyState === WebSocket.OPEN) {
    try {
      devBridgeClient.send(JSON.stringify({
        type: 'log',
        logType: 'service_worker',
        level: level,
        message: message,
        data: data,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('🔧 Service Worker: Failed to send log:', error);
    }
  }
}

// Enhanced fetch event handler with automatic rolling key injection
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle chrome extension requests (block them)
  if (url.protocol === 'chrome-extension:') {
    event.respondWith(
      new Response('', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    return;
  }

  // Check if this is a local server request that needs rolling key authentication
  if (isLocalServerRequest(url)) {
    event.respondWith((async () => {
      try {
        // Get rolling key headers
        const swHeaders = await createServiceWorkerHeaders();

        // Clone the request and add rolling key headers
        const headers = new Headers(request.headers);

        // Add rolling key headers
        Object.entries(swHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });

        // Create new request with rolling key headers
        const authenticatedRequest = new Request(request, {
          headers: headers
        });

        // Emit transmit event for authenticated requests
        notifyClientsOfNetworkActivity('transmit', {
          url: request.url,
          method: request.method,
          timestamp: Date.now(),
          authenticated: true
        });

        // Handle the authenticated request
        return fetch(authenticatedRequest);

      } catch (error) {
        console.error('🔑 Service Worker: Failed to add rolling key to request:', error);

        // Emit transmit event for failed authentication
        notifyClientsOfNetworkActivity('transmit', {
          url: request.url,
          method: request.method,
          timestamp: Date.now(),
          authenticated: false,
          authError: error.message
        });

        // Fall back to original request without authentication
        return fetch(request);
      }
    })());
    return;
  }

  // For non-local requests, just emit transmit event
  notifyClientsOfNetworkActivity('transmit', {
    url: request.url,
    method: request.method,
    timestamp: Date.now()
  });
});

// Check if URL is a local server request (should include rolling key)
function isLocalServerRequest(url) {
  if (!url) return false;

  // Handle relative URLs
  if (url.pathname.startsWith('/')) return true;

  // Handle absolute URLs to the same origin
  return url.origin === self.location.origin;
}
