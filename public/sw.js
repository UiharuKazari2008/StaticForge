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
const IMAGE_CACHE = 'image-cache-v1';
const IMAGE_METADATA_KEY = '/internal/sw-image-cache-metadata-v1';

const IMAGE_CACHE_POLICY = {
  maxEntries: 5000,
  maxSizeBytes: 2 * 1024 * 1024 * 1024, // 2GB
  maxIdleMs: 24 * 60 * 60 * 1000, // 24 hours since last access
  lockedPreviewCount: 500
};

// Enforcing cache policy on every image hit can thrash the cache.
// Debounce and rate-limit enforcement to keep the cache warm.
const IMAGE_POLICY_ENFORCE_DEBOUNCE_MS = 2000;
const IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS = 30000;
let imagePolicyEnforceTimer = null;
let imagePolicyLastEnforcedAt = 0;

function scheduleImageCachePolicyEnforcement() {
  const now = Date.now();
  if (now - imagePolicyLastEnforcedAt < IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS) {
    return;
  }
  if (imagePolicyEnforceTimer) {
    clearTimeout(imagePolicyEnforceTimer);
  }
  imagePolicyEnforceTimer = setTimeout(async () => {
    imagePolicyEnforceTimer = null;
    try {
      await enforceImageCachePolicy();
    } finally {
      imagePolicyLastEnforcedAt = Date.now();
    }
  }, IMAGE_POLICY_ENFORCE_DEBOUNCE_MS);
}

// Download state tracking
let downloadState = {
    isDownloading: false,
    completed: 0,
    total: 0,
    currentFile: null,
    startTime: null,
    lastProgressTime: null,
    files: [],
    abortController: null
};

// Helper function to add cache-busting headers to responses
function addCacheBustingHeaders(response) {
  // Opaque/opaqueredirect responses use status 0 and cannot be reconstructed.
  if (!response || response.status < 200 || response.status > 599) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Surrogate-Control', 'no-store');
  headers.set('Last-Modified', new Date().toUTCString());
  headers.set('ETag', `"${Date.now()}"`);

  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  } catch (error) {
    // Fall back to the original response when rewrapping is not allowed.
    return response;
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
  matchOptions: {
    ignoreSearch: true
  },
  plugins: [
    new cacheableResponse.CacheableResponsePlugin({
      statuses: [0, 200],
    }),
    new expiration.ExpirationPlugin({
      maxEntries: 500,
      maxAgeSeconds: 24 * 60 * 60, // 24 hours
    }),
    {
      cacheKeyWillBeUsed: async ({ request }) => {
        // Strip query parameters from cache key
        return request.url.split('?')[0];
      },
    },
  ],
});

// Image strategy - cache first with network fallback and immediate expiry
const imageStrategy = null;

function getCanonicalUrl(input) {
  const url = typeof input === 'string' ? input : input.url;
  return url.split('?')[0];
}

function isManagedImageCacheUrl(url) {
  return url.includes('/images/') || url.includes('/previews/') || url.includes('/naxCache/');
}

function getApproximateResponseSize(response) {
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
}

async function readImageMetadata() {
  const cache = await caches.open(INTERNAL_CACHE);
  const response = await cache.match(IMAGE_METADATA_KEY);
  if (!response) {
    return {
      sequence: 0,
      rules: {
        favoriteUrls: [],
        lockedPreviewUrls: []
      },
      entries: {}
    };
  }

  try {
    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid metadata');
    }
    return {
      sequence: Number.isFinite(data.sequence) ? data.sequence : 0,
      rules: {
        favoriteUrls: Array.isArray(data.rules?.favoriteUrls) ? data.rules.favoriteUrls : [],
        lockedPreviewUrls: Array.isArray(data.rules?.lockedPreviewUrls) ? data.rules.lockedPreviewUrls : []
      },
      entries: data.entries && typeof data.entries === 'object' ? data.entries : {}
    };
  } catch (error) {
    return {
      sequence: 0,
      rules: {
        favoriteUrls: [],
        lockedPreviewUrls: []
      },
      entries: {}
    };
  }
}

async function writeImageMetadata(metadata) {
  const cache = await caches.open(INTERNAL_CACHE);
  await cache.put(
    IMAGE_METADATA_KEY,
    new Response(JSON.stringify(metadata), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  );
}

function isPinnedImageUrl(url, metadata) {
  const favoriteSet = new Set(metadata.rules.favoriteUrls || []);
  const lockedPreviewSet = new Set(metadata.rules.lockedPreviewUrls || []);
  return favoriteSet.has(url) || lockedPreviewSet.has(url);
}

async function updateImageMetadataForHit(url) {
  const metadata = await readImageMetadata();
  const entry = metadata.entries[url];
  if (!entry) {
    return;
  }
  metadata.sequence += 1;
  entry.lastAccess = Date.now();
  entry.seq = metadata.sequence;
  entry.pinned = isPinnedImageUrl(url, metadata);
  await writeImageMetadata(metadata);
}

async function upsertImageMetadata(url, response) {
  const metadata = await readImageMetadata();
  metadata.sequence += 1;
  metadata.entries[url] = {
    size: getApproximateResponseSize(response),
    lastAccess: Date.now(),
    cachedAt: Date.now(),
    seq: metadata.sequence,
    pinned: isPinnedImageUrl(url, metadata)
  };
  await writeImageMetadata(metadata);
}

async function deleteImageMetadata(urls) {
  const metadata = await readImageMetadata();
  for (const url of urls) {
    delete metadata.entries[url];
  }
  await writeImageMetadata(metadata);
}

async function enforceImageCachePolicy() {
  const metadata = await readImageMetadata();
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  const now = Date.now();
  const keySet = new Set(keys.map(key => getCanonicalUrl(key.url)));

  // Cleanup metadata entries no longer present in cache.
  for (const url of Object.keys(metadata.entries)) {
    if (!keySet.has(url)) {
      delete metadata.entries[url];
    }
  }

  const removable = [];
  let totalEntries = 0;
  let totalSize = 0;

  for (const key of keys) {
    const url = getCanonicalUrl(key.url);
    if (!isManagedImageCacheUrl(url)) {
      continue;
    }

    const entry = metadata.entries[url];
    if (!entry) {
      continue;
    }

    const pinned = isPinnedImageUrl(url, metadata);
    entry.pinned = pinned;
    totalEntries += 1;
    totalSize += entry.size || 0;

    const isExpired = now - (entry.lastAccess || entry.cachedAt || now) > IMAGE_CACHE_POLICY.maxIdleMs;
    if (!pinned && isExpired) {
      removable.push({ url, seq: entry.seq || 0, reason: 'expired', size: entry.size || 0 });
    }
  }

  removable.sort((a, b) => a.seq - b.seq);
  const evictQueue = [...removable];

  // FIFO-like eviction by earliest sequence for non-pinned items.
  if (totalEntries > IMAGE_CACHE_POLICY.maxEntries || totalSize > IMAGE_CACHE_POLICY.maxSizeBytes) {
    const candidates = Object.entries(metadata.entries)
      .filter(([url, entry]) => {
        if (!isManagedImageCacheUrl(url)) return false;
        return !isPinnedImageUrl(url, metadata);
      })
      .map(([url, entry]) => ({ url, seq: entry.seq || 0, size: entry.size || 0 }))
      .sort((a, b) => a.seq - b.seq);

    for (const candidate of candidates) {
      if (totalEntries <= IMAGE_CACHE_POLICY.maxEntries && totalSize <= IMAGE_CACHE_POLICY.maxSizeBytes) {
        break;
      }
      if (!evictQueue.find(item => item.url === candidate.url)) {
        evictQueue.push({ ...candidate, reason: 'capacity' });
      }
      totalEntries -= 1;
      totalSize -= candidate.size || 0;
    }
  }

  if (evictQueue.length > 0) {
    const removed = [];
    for (const item of evictQueue) {
      const deleted = await cache.delete(item.url);
      if (deleted) {
        removed.push(item.url);
      }
    }
    if (removed.length > 0) {
      for (const url of removed) {
        delete metadata.entries[url];
      }
    }
  }

  await writeImageMetadata(metadata);
}

async function handleImageRequest(event) {
  const { request } = event;
  const canonicalUrl = getCanonicalUrl(request.url);
  const cache = await caches.open(IMAGE_CACHE);
  const cachedResponse = await cache.match(canonicalUrl);

  if (cachedResponse) {
    let discardCached = !cachedResponse.ok;
    if (!discardCached) {
      const contentLengthHdr = cachedResponse.headers.get('content-length');
      const contentLengthParsed = parseInt(contentLengthHdr || '-1', 10);
      if (Number.isFinite(contentLengthParsed) && contentLengthParsed === 0) {
        discardCached = true;
      }
      const contentTypeRaw = cachedResponse.headers.get('content-type') || '';
      const contentTypeLc = contentTypeRaw.toLowerCase();
      // HTML/error payloads cached under image paths yield permanent broken thumbnails
      if (contentTypeLc.includes('text/html')) {
        discardCached = true;
      }
    }
    if (!discardCached) {
      event.waitUntil(updateImageMetadataForHit(canonicalUrl));
      event.waitUntil((async () => {
        scheduleImageCachePolicyEnforcement();
      })());
      return cachedResponse;
    }
    await cache.delete(canonicalUrl);
    await deleteImageMetadata([canonicalUrl]);
  }

  const networkResponse = await fetch(request, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
  // Cache.put() can throw NetworkError (quota, body stream errors). Must not reject the fetch
  // handler or the browser shows a broken image and logs an uncaught promise rejection.
  if (networkResponse && networkResponse.ok && networkResponse.status >= 200 && networkResponse.status < 300 && shouldCacheResponse(networkResponse)) {
    try {
      await cache.put(canonicalUrl, networkResponse.clone());
      await upsertImageMetadata(canonicalUrl, networkResponse);
      event.waitUntil((async () => {
        scheduleImageCachePolicyEnforcement();
      })());
    } catch (cacheError) {
      console.warn('[sw] image-cache put failed:', canonicalUrl, cacheError);
      try {
        await cache.delete(canonicalUrl);
      } catch (deleteErr) {
        console.warn('[sw] image-cache delete after failed put:', canonicalUrl, deleteErr);
      }
      try {
        await deleteImageMetadata([canonicalUrl]);
      } catch (metaErr) {
        console.warn('[sw] image metadata cleanup failed:', canonicalUrl, metaErr);
      }
    }
  }

  return networkResponse;
}

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

// Custom strategy wrapper for images that disables client-side caching but allows service worker caching
function createImageStrategy() {
  return {
    async handle({ request, event }) {
      try {
        const response = await handleImageRequest(event);
        if (response) {
          // Emit receive event for successful responses
          notifyClientsOfNetworkActivity('receive', {
            url: request.url,
            method: request.method,
            status: response.status,
            timestamp: Date.now()
          });
          return response;
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
      status: 200,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
);

// Unified route handler for all requests
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Never handle /preset or /pending routes
    if (url.pathname.startsWith('/preset') || url.pathname.startsWith('/pending') || url.pathname.startsWith('/traces')) {
      return false;
    }
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
            const fetchResponse = await fetch(endpoint, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0'
              }
            });
            
            if (fetchResponse.ok && fetchResponse.status >= 200 && fetchResponse.status < 300 && shouldCacheResponse(fetchResponse)) {
              // Keep original server headers in storage; cache-busting is only for fetch mode.
              const responseWithHeaders = new Response(fetchResponse.body, {
                status: fetchResponse.status,
                statusText: fetchResponse.statusText,
                headers: fetchResponse.headers
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
      // Handle previews with image strategy
      // Note: Image variants (like @blur.webp) are in the path, not query params,
      // so they're naturally cached separately. Query params are stripped for cache-busting.
      else if (url.pathname.startsWith('/previews/')) {
        response = await createImageStrategy().handle(event);
      }
      // Handle cache with dynamic strategy
      else if (url.pathname.startsWith('/cache/')) {
        response = await createCacheBustingStrategy(dynamicStrategy).handle(event);
      }
      // Handle images with image strategy
      else if (url.pathname.startsWith('/images/')) {
        response = await createImageStrategy().handle(event);
      }
      // Handle nax gallery cache images with image strategy
      else if (url.pathname.startsWith('/naxCache/')) {
        response = await createImageStrategy().handle(event);
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
    // Never handle /preset or /pending routes
    if (url.pathname.startsWith('/preset') || url.pathname.startsWith('/pending') || url.pathname.startsWith('/traces')) {
      return false;
    }
    // Check if this is an HTML request that might be a client-side route
    const acceptHeader = request.headers.get('accept');
    const isHtmlRequest = acceptHeader && acceptHeader.includes('text/html');
    const isNotStaticFile = !url.pathname.includes('.') && 
                           !url.pathname.startsWith('/previews/') && 
                           !url.pathname.startsWith('/cache/') && 
                           !url.pathname.startsWith('/images/') && 
                           !url.pathname.startsWith('/naxCache/') && 
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
    } else if (event.data && event.data.type === 'GET_CACHED_FILES') {
        getCachedFiles(event.data.requestId);
    } else if (event.data && event.data.type === 'DELETE_AND_PRECACHE') {
        deleteAndPrecache(event.data.url, event.data.requestId);
    } else if (event.data && event.data.type === 'DELETE_FROM_CACHE') {
        deleteFromCache(event.data.url, event.data.requestId);
    } else if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data && event.data.type === 'GET_DOWNLOAD_STATE') {
        getDownloadState(event.data.requestId);
    } else if (event.data && event.data.type === 'CANCEL_DOWNLOAD') {
        cancelDownload();
    } else if (event.data && event.data.type === 'ping') {
        // Respond to health check ping
        event.ports && event.ports[0] && event.ports[0].postMessage({
            type: 'pong',
            timestamp: Date.now()
        });
        // Also send via postMessage for compatibility
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'ping',
                    timestamp: Date.now()
                });
            });
        });
    } else if (event.data && event.data.type === 'SYNC_IMAGE_CACHE_RULES') {
        const favoriteUrls = Array.isArray(event.data.favoriteUrls) ? event.data.favoriteUrls.map(getCanonicalUrl) : [];
        const lockedPreviewUrls = Array.isArray(event.data.lockedPreviewUrls) ? event.data.lockedPreviewUrls.map(getCanonicalUrl) : [];
        event.waitUntil((async () => {
            const policy = event.data.policy || {};
            if (Number.isFinite(policy.maxEntries) && policy.maxEntries > 0) {
              IMAGE_CACHE_POLICY.maxEntries = Math.floor(policy.maxEntries);
            }
            if (Number.isFinite(policy.maxSizeBytes) && policy.maxSizeBytes > 0) {
              IMAGE_CACHE_POLICY.maxSizeBytes = Math.floor(policy.maxSizeBytes);
            }
            if (Number.isFinite(policy.maxIdleMs) && policy.maxIdleMs > 0) {
              IMAGE_CACHE_POLICY.maxIdleMs = Math.floor(policy.maxIdleMs);
            }
            const metadata = await readImageMetadata();
            metadata.rules.favoriteUrls = Array.from(new Set(favoriteUrls));
            metadata.rules.lockedPreviewUrls = Array.from(new Set(lockedPreviewUrls.slice(0, IMAGE_CACHE_POLICY.lockedPreviewCount)));
            await writeImageMetadata(metadata);
            scheduleImageCachePolicyEnforcement();
        })());
    }
});

// Get list of cached files with their hashes
async function getCachedFiles(requestId) {
    try {
        const cache = await caches.open(STATIC_CACHE);
        const keys = await cache.keys();
        const cachedFiles = [];
        
        for (const key of keys) {
            try {
                const response = await cache.match(key);
                if (response) {
                    const hash = response.headers.get('x-file-hash') || '';
                    const url = key.url;
                    cachedFiles.push({
                        url: url,
                        hash: hash
                    });
                }
            } catch (error) {
                console.error(`Error getting cached file info for ${key.url}:`, error);
            }
        }
        
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'CACHED_FILES_LIST',
                    requestId: requestId,
                    files: cachedFiles
                });
            });
        });
    } catch (error) {
        console.error('Error getting cached files:', error);
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'CACHED_FILES_ERROR',
                    requestId: requestId,
                    error: error.message
                });
            });
        });
    }
}

// Helper function to determine content type from file path
function getContentTypeFromPath(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const contentTypes = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'webp': 'image/webp',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'ttf': 'font/ttf',
        'eot': 'application/vnd.ms-fontobject',
        'otf': 'font/otf',
        'ico': 'image/x-icon',
        'xml': 'application/xml',
        'txt': 'text/plain',
        'map': 'application/json'
    };
    return contentTypes[ext] || 'application/octet-stream';
}

// Get current download state
function getDownloadState(requestId) {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'DOWNLOAD_STATE',
                requestId: requestId,
                isDownloading: downloadState.isDownloading,
                completed: downloadState.completed,
                total: downloadState.total,
                currentFile: downloadState.currentFile,
                startTime: downloadState.startTime,
                lastProgressTime: downloadState.lastProgressTime,
                files: downloadState.files
            });
        });
    });
}

// Cancel current download
function cancelDownload() {
    if (downloadState.isDownloading && downloadState.abortController) {
        downloadState.abortController.abort();
        downloadState.isDownloading = false;
        downloadState.abortController = null;
        
        // Notify clients of cancellation
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_CANCELLED',
                    completed: downloadState.completed,
                    total: downloadState.total
                });
            });
        });
        
        // Reset state
        downloadState = {
            isDownloading: false,
            completed: 0,
            total: 0,
            currentFile: null,
            startTime: null,
            lastProgressTime: null,
            files: [],
            abortController: null
        };
    }
}

// Check for stalled downloads (no progress for 30 seconds)
let lastHeartbeatTime = 0;
function checkStallDetection() {
    if (downloadState.isDownloading && downloadState.lastProgressTime) {
        const timeSinceLastProgress = Date.now() - downloadState.lastProgressTime;
        const STALL_TIMEOUT = 30000; // 30 seconds
        
        if (timeSinceLastProgress > STALL_TIMEOUT) {
            console.warn(`Download appears stalled (${Math.round(timeSinceLastProgress/1000)}s since last progress), notifying clients`);
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'STATIC_CACHE_STALLED',
                        completed: downloadState.completed,
                        total: downloadState.total,
                        currentFile: downloadState.currentFile,
                        timeSinceLastProgress: timeSinceLastProgress,
                        stalled: true
                    });
                });
            });
        } else {
            // Send periodic progress updates even if no new files complete (every 10 seconds)
            // This helps keep the UI updated and detects if the service worker is still alive
            const now = Date.now();
            if (now - lastHeartbeatTime > 10000) {
                lastHeartbeatTime = now;
                // Send a heartbeat progress update
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'STATIC_CACHE_PROGRESS',
                            completed: downloadState.completed,
                            total: downloadState.total,
                            currentFile: downloadState.currentFile,
                            heartbeat: true
                        });
                    });
                });
            }
        }
    }
}

// Start stall detection interval
let stallDetectionInterval = null;
function startStallDetection() {
    if (stallDetectionInterval) {
        clearInterval(stallDetectionInterval);
    }
    // Check every 2 seconds for more responsive stall detection
    stallDetectionInterval = setInterval(() => {
        try {
            checkStallDetection();
        } catch (error) {
            console.error('Error in stall detection:', error);
        }
    }, 2000);
}

function stopStallDetection() {
    if (stallDetectionInterval) {
        clearInterval(stallDetectionInterval);
        stallDetectionInterval = null;
    }
    lastHeartbeatTime = 0;
}

// Cache static files from server
async function cacheStaticFiles(files) {
    // Check if already downloading
    if (downloadState.isDownloading) {
        console.warn('Download already in progress, sending current status');
        // Immediately send current status to all clients
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                // Send current status immediately
                client.postMessage({
                    type: 'STATIC_CACHE_ALREADY_IN_PROGRESS',
                    currentDownload: {
                        completed: downloadState.completed,
                        total: downloadState.total,
                        currentFile: downloadState.currentFile,
                        startTime: downloadState.startTime,
                        lastProgressTime: downloadState.lastProgressTime
                    }
                });
                // Also send a progress update to sync the UI
                client.postMessage({
                    type: 'STATIC_CACHE_PROGRESS',
                    completed: downloadState.completed,
                    total: downloadState.total,
                    currentFile: downloadState.currentFile
                });
            });
        });
        return;
    }
    
    try {
        // Initialize download state
        downloadState.isDownloading = true;
        downloadState.completed = 0;
        downloadState.total = files.length;
        downloadState.currentFile = null;
        downloadState.startTime = Date.now();
        downloadState.lastProgressTime = Date.now();
        downloadState.files = files;
        downloadState.abortController = new AbortController();
        
        // Start stall detection
        startStallDetection();
        
        // Notify clients that download has started
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_STARTED',
                    total: files.length
                });
            });
        });
        
        const cache = await caches.open(STATIC_CACHE);
        const signal = downloadState.abortController.signal;
        
        // Cache files one by one to track progress
        for (const file of files) {
            // Check if download was cancelled
            if (signal.aborted) {
                console.log('Download cancelled by user');
                return;
            }
            
            downloadState.currentFile = file.url;
            
            // Update lastProgressTime when starting a new file (even if fetch hasn't completed yet)
            // This helps detect if we're stuck on a single file
            downloadState.lastProgressTime = Date.now();
            
            try {
                // Fetch with cache-busting headers to prevent browser caching
                const fetchStartTime = Date.now();
                const response = await fetch(file.url, {
                  cache: 'no-store',
                  signal: signal,
                  headers: {
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                  }
                });
                
                // Update progress time after fetch completes (even if it fails)
                downloadState.lastProgressTime = Date.now();
                
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

                        downloadState.completed++;
                        downloadState.lastProgressTime = Date.now();

                        // Notify client of progress
                        self.clients.matchAll().then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'STATIC_CACHE_PROGRESS',
                                    completed: downloadState.completed,
                                    total: downloadState.total,
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
                        downloadState.completed++;
                        downloadState.lastProgressTime = Date.now();
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
                    downloadState.completed++;
                    downloadState.lastProgressTime = Date.now();
                }
            } catch (error) {
                // Check if error is due to abort
                if (error.name === 'AbortError') {
                    console.log('Download aborted');
                    return;
                }
                console.error(`Failed to cache ${file.url}:`, error);
                downloadState.completed++;
                downloadState.lastProgressTime = Date.now();
            }
        }
        
        // Stop stall detection
        stopStallDetection();
        
        // Capture values before resetting state (defensive against race conditions)
        const completedCount = downloadState.completed > 0 ? downloadState.completed : files.length;
        const totalCount = downloadState.total > 0 ? downloadState.total : files.length;
        
        // Notify client of completion
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_COMPLETE',
                    files: files,
                    completed: completedCount,
                    total: totalCount
                });
            });
        });
        
        // Reset download state
        downloadState = {
            isDownloading: false,
            completed: 0,
            total: 0,
            currentFile: null,
            startTime: null,
            lastProgressTime: null,
            files: [],
            abortController: null
        };
    } catch (error) {
        // Check if error is due to abort
        if (error.name === 'AbortError') {
            console.log('Download aborted');
            return;
        }
        
        console.error('Error caching static files:', error);
        
        // Stop stall detection
        stopStallDetection();
        
        // Notify clients of error
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_ERROR',
                    file: 'unknown',
                    error: error.message
                });
            });
        });
        
        // Reset download state
        downloadState = {
            isDownloading: false,
            completed: 0,
            total: 0,
            currentFile: null,
            startTime: null,
            lastProgressTime: null,
            files: [],
            abortController: null
        };
    }
}

// Cache internal data
async function cacheInternalData(url, data) {
  try {
    const cache = await caches.open(INTERNAL_CACHE);
    
    // If data contains imageUrl, fetch that URL and store the content at the specified path
    if (data.imageUrl) {
      try {
        const fetchedResponse = await fetch(data.imageUrl, {
          cache: 'no-store',
          headers: {
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
    const imageCache = await caches.open(IMAGE_CACHE);
    
    const staticKeys = await staticCache.keys();
    const dynamicKeys = await dynamicCache.keys();
    const internalKeys = await internalCache.keys();
    const imageKeys = await imageCache.keys();
    
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'CACHE_STATUS',
          requestId: requestId,
          static: staticKeys.length,
          dynamic: dynamicKeys.length,
          internal: internalKeys.length,
          images: imageKeys.length
        });
      });
    });
  } catch (error) {
    console.error('Error getting cache status:', error);
  }
}

// Delete matching URL entries from static, dynamic, and image caches
async function deleteUrlFromCaches(url) {
  const urlWithoutQuery = url.split('?')[0];
  const isImageOrPreview = isManagedImageCacheUrl(urlWithoutQuery);
  const cacheNames = isImageOrPreview ? [IMAGE_CACHE] : [STATIC_CACHE, DYNAMIC_CACHE];
  const removedUrls = [];

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    for (const key of keys) {
      const keyUrl = key.url.split('?')[0];
      if (keyUrl === urlWithoutQuery) {
        const deleted = await cache.delete(key);
        if (deleted) {
          removedUrls.push(keyUrl);
        }
      }
    }
  }

  if (removedUrls.length > 0) {
    await deleteImageMetadata(removedUrls);
  }

  return removedUrls;
}

// Delete from cache only (no precache)
async function deleteFromCache(url, requestId) {
  try {
    await deleteUrlFromCaches(url);

    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'DELETE_FROM_CACHE_COMPLETE',
          requestId: requestId,
          url: url
        });
      });
    });
  } catch (error) {
    console.error('Error deleting from cache:', error);
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'DELETE_FROM_CACHE_ERROR',
          requestId: requestId,
          url: url,
          error: error.message
        });
      });
    });
  }
}

// Delete from cache and precache a file
async function deleteAndPrecache(url, requestId) {
  try {
    const urlWithoutQuery = url.split('?')[0];
    const isImageOrPreview = isManagedImageCacheUrl(urlWithoutQuery);
    let targetCacheName = STATIC_CACHE;
    if (isImageOrPreview) {
      targetCacheName = IMAGE_CACHE;
    } else if (urlWithoutQuery.includes('/cache/')) {
      targetCacheName = DYNAMIC_CACHE;
    }

    await deleteUrlFromCaches(url);
    
    // Fetch the file to precache it (with timestamp to force fresh fetch)
    const fetchUrl = `${url}?t=${Date.now()}`;
    const response = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)) {
      const cache = await caches.open(targetCacheName);
      // Cache the file without query parameters (strategies will strip queries)
      await cache.put(urlWithoutQuery, response.clone());
      if (isImageOrPreview) {
        await upsertImageMetadata(urlWithoutQuery, response);
        await enforceImageCachePolicy();
      }
    }
    
    // Notify client of completion
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'DELETE_AND_PRECACHE_COMPLETE',
          requestId: requestId,
          url: url
        });
      });
    });
  } catch (error) {
    console.error('Error deleting and precaching:', error);
    // Notify client of error
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'DELETE_AND_PRECACHE_ERROR',
          requestId: requestId,
          url: url,
          error: error.message
        });
      });
    });
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
          const response = await fetch(endpoint, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          
          if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)) {
            // Keep original response headers in cache.
            const responseWithHeaders = new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
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
              cacheName !== IMAGE_CACHE &&
              cacheName !== INTERNAL_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(async () => {
      await enforceImageCachePolicy();
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

// Check if URL is a local server request
function isLocalServerRequest(url) {
  if (!url) return false;

  // Handle relative URLs
  if (url.pathname.startsWith('/')) return true;

  // Handle absolute URLs to the same origin
  return url.origin === self.location.origin;
}
