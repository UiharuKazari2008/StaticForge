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

// Cache strategies
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

// Custom strategies that add cache-busting headers to responses
const dynamicStrategy = {
  async handle({ request, event }) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Add cache-busting headers to prevent browser caching
      const headers = new Headers(cachedResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: headers
      });
    }
    
    // If not in cache, fetch from network
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  }
};

const imageStrategy = {
  async handle({ request, event }) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Add cache-busting headers to prevent browser caching
      const headers = new Headers(cachedResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: headers
      });
    }
    
    // If not in cache, fetch from network
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  }
};

const internalStrategy = {
  async handle({ request, event }) {
    const cache = await caches.open(INTERNAL_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Check if this is internal data
      const isInternalData = cachedResponse.headers.get('x-internal-data') === 'true';
      
      if (isInternalData) {
        // For internal data, return the response as-is with proper headers
        // This preserves the Content-Type: application/json and the actual data
        return cachedResponse;
      }
    }
    
    // If not in cache, return 404 since internal URLs are client-side only
    return new Response('Not found', { 
      status: 404,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
};

// Route handlers
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/previews/') || url.pathname.startsWith('/cache/'),
  dynamicStrategy.handle.bind(dynamicStrategy)
);

workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/images/'),
  imageStrategy.handle.bind(imageStrategy)
);

workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/internal/'),
  internalStrategy.handle.bind(internalStrategy)
);

// Special route for Workbox script - cache for 90 days but with cache-busting headers
workbox.routing.registerRoute(
  ({ url }) => url.pathname === '/dist/workbox/workbox-sw.js',
  async ({ request, event }) => {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Add cache-busting headers to prevent browser caching
      const headers = new Headers(cachedResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: headers
      });
    }
    
    // If not in cache, fetch from network
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  }
);

// Handle static files with cache-first strategy
workbox.routing.registerRoute(
  ({ url }) => {
    // Handle static files (HTML, CSS, JS, images, etc.)
    return url.pathname.startsWith('/') && 
           !url.pathname.startsWith('/previews/') && 
           !url.pathname.startsWith('/cache/') && 
           !url.pathname.startsWith('/images/') && 
           !url.pathname.startsWith('/internal/') &&
           url.pathname !== '/';
  },
  async ({ request }) => {
    // Check our static cache first
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Add cache-busting headers to cached responses to prevent browser caching
      const headers = new Headers(cachedResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: headers
      });
    }
    
    // If not in cache, fetch from network with cache-busting headers
    try {
      // Add cache-busting headers for ALL static assets to prevent browser caching
      const fetchOptions = {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      };
      
      const response = await fetch(request, fetchOptions);
      if (response && response.status === 200) {
        return response;
      }
      return response;
    } catch (error) {
      console.error('Fetch error for static file:', error);
      throw error;
    }
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
                if (response.ok) {
                    // Check if file already exists in cache
                    const existingResponse = await cache.match(file.url);
                    if (existingResponse) {
                        // Delete the old entry to ensure clean replacement
                        await cache.delete(file.url);
                    }
                    
                    // Add hash to response headers for future comparison
                    const headers = new Headers(response.headers);
                    headers.set('x-file-hash', file.hash);
                    
                    // Also add cache-busting headers to the cached response
                    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                    headers.set('Pragma', 'no-cache');
                    headers.set('Expires', '0');
                    
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
    
    // Store the actual data, not JSON string
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000',
        'x-internal-data': 'true' // Mark as internal data
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
