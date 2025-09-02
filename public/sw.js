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
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
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
    const cache = await caches.open(INTERNAL_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Add cache-busting headers to prevent browser caching
      return addCacheBustingHeaders(cachedResponse);
    }
    
    // If not in cache, internal URLs are client-side only
    // Return a 404 since this data should have been cached by the client
    return new Response('Internal data not found in cache', { 
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'x-internal-missing': 'true',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  }
};

// Custom strategy wrapper to add cache-busting headers
function createCacheBustingStrategy(strategy) {
  return {
    async handle({ request, event }) {
      const response = await strategy.handle({ request, event });
      if (response) {
        return addCacheBustingHeaders(response);
      }
      return response;
    }
  };
}

// Unified route handler for all requests
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Always handle requests that start with /
    return url.pathname.startsWith('/');
  },
  async (event) => {
    const { request, url } = event;
    // Handle internal routes (client-side only)
    if (url.pathname.startsWith('/internal/')) {
      return internalStrategy.handle(event);
    }
    
    // Handle route-based paths (/, /app) with custom caching
    if (url.pathname === '/' || url.pathname === '/app' || url.pathname === '/index.html') {
      const cache = await caches.open(STATIC_CACHE);
      
      // Determine the route path and endpoint
      const routePath = url.pathname === '/index.html' ? '/' : url.pathname;
      const endpoint = routePath;
      
      // Try to serve from cache first
      const cachedResponse = await cache.match(routePath);
      if (cachedResponse) {
        return addCacheBustingHeaders(cachedResponse);
      }
      
      // If not cached, fetch from server endpoint and cache
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        
        if (response.ok) {
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
          
          // Cache at route path
          await cache.put(routePath, responseWithHeaders);
          return addCacheBustingHeaders(responseWithHeaders);
        }
      } catch (error) {
        console.error(`Failed to fetch from ${endpoint} endpoint:`, error);
      }
      
      // Fallback to static strategy
      return createCacheBustingStrategy(staticStrategy).handle(event);
    }
    
    // Handle previews and cache with dynamic strategy
    if (url.pathname.startsWith('/previews/') || url.pathname.startsWith('/cache/')) {
      return createCacheBustingStrategy(dynamicStrategy).handle(event);
    }
    
    // Handle images with image strategy
    if (url.pathname.startsWith('/images/')) {
      return createCacheBustingStrategy(imageStrategy).handle(event);
    }
    
    // Handle all other static files with static strategy
    return createCacheBustingStrategy(staticStrategy).handle(event);
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
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    // If we have a cached version, return it with cache-busting headers
    if (cachedResponse) {
      return addCacheBustingHeaders(cachedResponse);
    }
    
    // If no cached version, redirect to main app for client-side routing
    return new Response(`
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
  }
);

// Message handling for client communication
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_STATIC_FILES') {
        cacheStaticFiles(event.data.files);
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
                const fetchOptions = {
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    }
                };
                
                const response = await fetch(file.url, fetchOptions);
                if (response.ok && response.status < 300) {
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
                } else {
                    console.warn(`Failed to fetch ${file.url}: ${response.status}`);
                    completed++;
                }
            } catch (error) {
                console.error(`Failed to cache ${file.url}:`, error);
                completed++;
            }
        }
        
        // Final cache verification
        const allKeys = await cache.keys();
        
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
        const fetchedResponse = await fetch(data.imageUrl);
        if (fetchedResponse.ok && fetchedResponse.status < 300) {
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
        { endpoint: '/app', route: '/app' }
      ];
      const cache = await caches.open(STATIC_CACHE);
      
      for (const { endpoint, route } of criticalRoutes) {
        try {
          const response = await fetch(endpoint, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          
          if (response.ok) {
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

// Fetch event - let Workbox handle routing
self.addEventListener('fetch', (event) => {
  // Let Workbox handle all routing
  return;
});
