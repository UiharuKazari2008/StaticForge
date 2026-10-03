importScripts('/dist/workbox/workbox-sw.js');

// Compile-time: auto-apply CSS-only / apply-safe static cache updates without restart prompt
const CSS_ONLY_AUTO_APPLY = true;
const SW_SCRIPT_EPOCH = 13; // bump on breaking SW changes

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
const WALLPAPER_CACHE = 'wallpaper-cache-v1';
const IMAGE_METADATA_KEY = '/internal/sw-image-cache-metadata-v1';

const IMAGE_CACHE_POLICY = {
  maxEntries: 5000,
  maxSizeBytes: 2 * 1024 * 1024 * 1024, // 2GB
  // Previews only. Full /images/ responses are not stored.
  // galleryView.js syncImageCacheRules sends the same week.
  maxIdleMs: 7 * 24 * 60 * 60 * 1000,
  lockedPreviewCount: 500
};

// Saved shell and preview hits. The boot-loop fix refused unhashed writes;
// stamping no-store and a new ETag on every hit made saved files look one-shot.
const SAVED_ASSET_CACHE_CONTROL = 'public, max-age=604800';

// Enforcing cache policy on every image hit can thrash the cache.
// Debounce and rate-limit enforcement to keep the cache warm.
const IMAGE_POLICY_ENFORCE_DEBOUNCE_MS = 2000;
const IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS = 30000;

// Admin log viewer API — must bypass SW (SSE streams + live backlog)
const LOG_VIEWER_API_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:stream|backlog|sources|pm2\/(?:status|flush|restart))$/i;

function isLogViewerApiRequest(url) {
  return LOG_VIEWER_API_RE.test(url.pathname);
}

// Remote browser view, frame stream, input, and downloads. CacheFirst drops
// them (no x-file-hash) and the HTML navigation route would replace the
// viewer with the app shell.
function isGrimoireBrowserRequest(url) {
  return url.pathname.startsWith('/api/grimoire-browser/');
}

// Guacamole HTTP tunnel is a long-poll. CacheFirst strips the query and holds
// the body until the poll ends, so the display stays on Connecting.
function isDesktopGuacRequest(url) {
  return url.pathname.startsWith('/api/desktop-guac/');
}

function shouldReportNetworkActivity(requestData) {
  if (!requestData || requestData.fromNetwork !== true) {
    return false;
  }
  const rawUrl = requestData.url;
  if (!rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (isLogViewerApiRequest(parsed) || isGrimoireBrowserRequest(parsed) || isDesktopGuacRequest(parsed)) {
      return false;
    }
  } catch (error) {
    return false;
  }
  return true;
}

async function matchStrategyCache(cacheName, request) {
  const cache = await caches.open(cacheName);
  if (cacheName === DYNAMIC_CACHE || cacheName === STATIC_CACHE) {
    const cacheKey = request.url.split('?')[0];
    return (await cache.match(cacheKey, { ignoreVary: true }))
      || (await cache.match(request, { ignoreSearch: true, ignoreVary: true }));
  }
  return cache.match(request);
}

// Shell rows are stored as the pathname (see CACHE_STATIC_FILES). ?sha= and
// font ?t= / ?v= requests must use that row. cache.match on the opened cache
// honors ignoreSearch; Workbox's caches.match() does not, so those GETs were
// leaving the worker and hitting the server.
async function matchStaticShell(pathname) {
  if (!pathname || pathname === '/sw.js' || pathname.startsWith('/dist/workbox/')) {
    return null;
  }
  const cache = await caches.open(STATIC_CACHE);
  const query = { ignoreSearch: true, ignoreVary: true };
  const first = await cache.match(pathname, query);
  if (!first) {
    return null;
  }
  if (first.status === 200 && first.headers.get('x-file-hash')) {
    return first;
  }
  const keys = await cache.keys(pathname, query);
  let fallback = first.status === 200 ? first : null;
  for (let i = 0; i < keys.length; i++) {
    const candidate = await cache.match(keys[i], { ignoreVary: true });
    if (!candidate || candidate.status !== 200) {
      continue;
    }
    if (candidate.headers.get('x-file-hash')) {
      return candidate;
    }
    if (!fallback) {
      fallback = candidate;
    }
  }
  return fallback;
}
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
    abortController: null,
    silent: false,
    updatedFiles: []
};

function headersForSavedAsset(response) {
  const headers = new Headers(response.headers);
  headers.delete('pragma');
  headers.delete('expires');
  headers.delete('surrogate-control');
  headers.set('Cache-Control', SAVED_ASSET_CACHE_CONTROL);
  const hash = headers.get('x-file-hash');
  if (hash) {
    headers.set('ETag', `"${hash}"`);
  }
  return headers;
}

function savedAssetNotModified(request, response) {
  const hash = response && response.headers.get('x-file-hash');
  const inm = request && request.headers.get('if-none-match');
  if (!hash || !inm) {
    return null;
  }
  const etag = `"${hash}"`;
  const matched = inm.split(',').some((part) => {
    const token = part.trim().replace(/^W\//i, '');
    return token === '*' || token === etag || token === hash;
  });
  if (!matched) {
    return null;
  }
  return new Response(null, {
    status: 304,
    statusText: 'Not Modified',
    headers: headersForSavedAsset(response)
  });
}

// Return a saved Cache API body without the one-shot stamp.
function reusableCachedResponse(response) {
  if (!response || response.status < 200 || response.status > 599 || response.status === 304) {
    return response;
  }
  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headersForSavedAsset(response)
    });
  } catch (error) {
    return response;
  }
}

function respondWithSavedAsset(request, response) {
  return savedAssetNotModified(request, response) || reusableCachedResponse(response);
}

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

// App shell. CACHE_STATIC_FILES is the only writer, and it stores x-file-hash.
// A page fetch used to CacheFirst-miss, then store the network response
// (Vary: Accept-Encoding, no hash) over that row. Boot then saw a mismatch,
// downloaded, and restarted forever. cacheWillUpdate refuses those writes.
// Hits are served by matchStaticShell (cache.match on the pathname). Workbox
// CacheFirst uses caches.match(), which misses ?sha= / ?t= requests and then
// fetches the network copy. This strategy is only the miss path.
// maxEntries stays above the manifest (~920). A 1000 cap plus Vary/?sha=
// siblings evicted hashed shell files.
const staticStrategy = new strategies.CacheFirst({
  cacheName: STATIC_CACHE,
  matchOptions: {
    ignoreSearch: true,
    ignoreVary: true
  },
  plugins: [
    new cacheableResponse.CacheableResponsePlugin({
      statuses: [0, 200],
    }),
    {
      cacheKeyWillBeUsed: async ({ request }) => {
        const keyUrl = new URL(request.url);
        keyUrl.search = '';
        keyUrl.hash = '';
        return keyUrl.href;
      }
    },
    {
      cacheWillUpdate: async ({ response }) => {
        if (!response || !response.headers.get('x-file-hash')) {
          return null;
        }
        return response;
      }
    },
    new expiration.ExpirationPlugin({
      maxEntries: 8000,
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

/**
 * Image URLs whose query changes server processing must not use the query-stripped
 * image cache (would return a plain cached PNG without custom headers / transforms).
 */
function shouldBypassImageCache(request) {
  if (request.headers.get('X-Preview-Finalize') === '1') return true;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('clipboardOrigin') === 'true') return true;
    if (url.searchParams.get('clipboard') === 'true') return true;
    if (url.searchParams.get('download') === 'true') return true;
    if (url.searchParams.get('stripContext') === 'true') return true;
  } catch (_) { /* ignore */ }
  return false;
}

function isFullImageUrl(url) {
  return String(url || '').includes('/images/');
}

// Workspace wallpapers. Same path is overwritten on upload, so this set is
// replaced on change (dropped URLs are deleted). Not the preview cache and
// not the one-shot full-image path.
let wallpaperUrlSet = new Set();

function absoluteAssetUrl(input) {
  const raw = String(input || '').split('?')[0];
  if (!raw) return '';
  try {
    return new URL(raw, self.location.origin).href;
  } catch (error) {
    return raw;
  }
}

function isWallpaperRequest(url) {
  if (!url) return false;
  if (url.pathname.startsWith('/cache/wallpapers/')) return true;
  return wallpaperUrlSet.has(url.origin + url.pathname);
}

function wallpaperCachedResponse(response) {
  if (!response || response.status < 200 || response.status > 599) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('pragma');
  headers.delete('expires');
  headers.delete('surrogate-control');
  // Revalidate with this worker every time. The worker serves the stored
  // body until a wallpaper change deletes it, so the browser does not keep
  // a stale copy of /cache/wallpapers/<id>.png.
  headers.set('Cache-Control', 'private, no-cache');
  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  } catch (error) {
    return response;
  }
}

async function fetchAndStoreWallpaper(absoluteUrl) {
  const response = await fetch(absoluteUrl, { cache: 'no-store' });
  if (!response || !response.ok) {
    return response;
  }
  const cache = await caches.open(WALLPAPER_CACHE);
  await cache.put(absoluteUrl, response.clone());
  return response;
}

async function handleWallpaperRequest(event) {
  const absoluteUrl = absoluteAssetUrl(event.request.url);
  const cache = await caches.open(WALLPAPER_CACHE);
  const hit = await cache.match(absoluteUrl);
  if (hit) {
    return wallpaperCachedResponse(hit);
  }
  const response = await fetchAndStoreWallpaper(absoluteUrl);
  notifyClientsOfNetworkActivity('receive', {
    url: event.request.url,
    method: event.request.method,
    status: response ? response.status : 0,
    fromNetwork: true,
    timestamp: Date.now()
  });
  if (response && response.ok) {
    return wallpaperCachedResponse(response);
  }
  return response;
}

async function syncWallpaperUrls(urls, refreshUrls, requestId) {
  const next = new Set((Array.isArray(urls) ? urls : []).map(absoluteAssetUrl).filter(Boolean));
  const refresh = new Set((Array.isArray(refreshUrls) ? refreshUrls : []).map(absoluteAssetUrl).filter(Boolean));
  wallpaperUrlSet = next;
  const cache = await caches.open(WALLPAPER_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length; i++) {
    const canonical = absoluteAssetUrl(keys[i].url);
    if (!next.has(canonical)) {
      await cache.delete(keys[i]);
    }
  }
  for (const url of refresh) {
    if (!next.has(url)) continue;
    await deleteUrlFromCaches(url);
    await fetchAndStoreWallpaper(url);
  }
  for (const url of next) {
    if (refresh.has(url)) continue;
    const hit = await cache.match(url);
    if (!hit) {
      await fetchAndStoreWallpaper(url);
    }
  }
  if (requestId) {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({ type: 'SYNC_WALLPAPER_URLS_COMPLETE', requestId: requestId });
    });
  }
}

async function refreshWallpaperUrl(url, requestId) {
  const absoluteUrl = absoluteAssetUrl(url);
  if (absoluteUrl) {
    wallpaperUrlSet.add(absoluteUrl);
    await deleteUrlFromCaches(absoluteUrl);
    await fetchAndStoreWallpaper(absoluteUrl);
  }
  if (requestId) {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'REFRESH_WALLPAPER_COMPLETE',
        requestId: requestId,
        url: absoluteUrl
      });
    });
  }
}

function isManagedImageCacheUrl(url) {
  return url.includes('/previews/') || url.includes('/naxCache/');
}

// Studio Quick Start and Explorer thumbs. Stored in IMAGE_CACHE and not
// subject to preview eviction, so a second view is a cache hit.
function isStudioGalleryImageUrl(url) {
  const path = String(url || '');
  return path.includes('/cache/quickstart/') || path.includes('/cache/explore_files/');
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

  // Full images are one-shot. Drop leftovers so they do not crowd previews.
  for (const key of keys) {
    const url = getCanonicalUrl(key.url);
    if (!isFullImageUrl(url)) {
      continue;
    }
    const deleted = await cache.delete(key);
    if (deleted) {
      delete metadata.entries[url];
    }
  }

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
  if (isFullImageUrl(request.url)) {
    const networkResponse = await fetch(request, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    notifyClientsOfNetworkActivity('receive', {
      url: request.url,
      method: request.method,
      status: networkResponse.status,
      fromNetwork: true,
      timestamp: Date.now()
    });
    return addCacheBustingHeaders(networkResponse);
  }

  const canonicalUrl = getCanonicalUrl(request.url);
  const bypassImageCache = shouldBypassImageCache(request);
  const cache = await caches.open(IMAGE_CACHE);
  let cachedResponse = bypassImageCache ? null : await cache.match(canonicalUrl);

  if (!cachedResponse && !bypassImageCache && isStudioGalleryImageUrl(canonicalUrl)) {
    const dynamic = await caches.open(DYNAMIC_CACHE);
    const previous = await dynamic.match(canonicalUrl);
    if (previous && previous.ok && previous.status === 200) {
      try {
        await cache.put(canonicalUrl, previous.clone());
        await upsertImageMetadata(canonicalUrl, previous);
        cachedResponse = await cache.match(canonicalUrl);
      } catch (error) {
        console.warn('[sw] studio gallery cache promote failed:', canonicalUrl, error);
      }
    }
  }

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
      return respondWithSavedAsset(request, cachedResponse);
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
  notifyClientsOfNetworkActivity('receive', {
    url: request.url,
    method: request.method,
    status: networkResponse.status,
    fromNetwork: true,
    timestamp: Date.now()
  });
  // Cache.put() can throw NetworkError (quota, body stream errors). Must not reject the fetch
  // handler or the browser shows a broken image and logs an uncaught promise rejection.
  // Never store bypass responses under the canonical key (would poison normal image loads).
  if (!bypassImageCache
      && networkResponse && networkResponse.ok && networkResponse.status >= 200 && networkResponse.status < 300
      && shouldCacheResponse(networkResponse)) {
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

  if (bypassImageCache) {
    return addCacheBustingHeaders(networkResponse);
  }
  return respondWithSavedAsset(request, networkResponse);
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
      
      return response;
    } catch (error) {
      throw error;
    }
  }
};

// Custom strategy wrapper to add cache-busting headers and emit network events
function createCacheBustingStrategy(strategy, cacheName) {
  return {
    async handle({ request, event }) {
      const wasCached = !!(await matchStrategyCache(cacheName, request));
      try {
        const response = await strategy.handle({ request, event });
        if (response && !wasCached) {
          const finalResponse = addCacheBustingHeaders(response);
          notifyClientsOfNetworkActivity('receive', {
            url: request.url,
            method: request.method,
            status: response.status,
            fromNetwork: true,
            timestamp: Date.now()
          });
          return finalResponse;
        }
        if (response) {
          return addCacheBustingHeaders(response);
        }
        return response;
      } catch (error) {
        if (!wasCached) {
          notifyClientsOfNetworkActivity('receive', {
            url: request.url,
            method: request.method,
            status: 0,
            error: error.message,
            fromNetwork: true,
            timestamp: Date.now()
          });
        }
        throw error;
      }
    }
  };
}

// Custom strategy wrapper for images that disables client-side caching but allows service worker caching
function createImageStrategy() {
  return {
    async handle({ request, event }) {
      return handleImageRequest(event);
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
    if (isLogViewerApiRequest(url) || isGrimoireBrowserRequest(url) || isDesktopGuacRequest(url)) {
      return false;
    }
    // Always handle requests that start with /
    return url.pathname.startsWith('/');
  },
  async (event) => {
    const { request, url } = event;

    maybeNotifyHttpTransmit(request);
    
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
        const bypassRouteCache = request.headers.get('X-SW-Bypass-Cache') === '1';
        
        // Try to serve from cache first (skip when CACHE_STATIC_FILES needs a fresh network fetch)
        const cachedResponse = bypassRouteCache ? null : await cache.match(routePath);
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
            notifyClientsOfNetworkActivity('receive', {
              url: request.url,
              method: request.method,
              status: response.status,
              fromNetwork: true,
              timestamp: Date.now()
            });
          } catch (error) {
            console.error(`Failed to fetch from ${endpoint} endpoint:`, error);
            throw error;
          }
        }
      }
      // Workspace wallpapers: stored until the assignment changes, then dropped.
      else if (isWallpaperRequest(url)) {
        response = await handleWallpaperRequest(event);
      }
      // Handle previews with image strategy
      // Note: Image variants (like @blur.webp) are in the path, not query params,
      // so they're naturally cached separately. Query params are stripped for cache-busting.
      else if (url.pathname.startsWith('/previews/')) {
        response = await createImageStrategy().handle(event);
      }
      // Quick Start and Explorer images stay in the image cache. A hit does
      // not restamp no-store, so the next view is not a second download.
      else if (isStudioGalleryImageUrl(url.pathname)) {
        response = await createImageStrategy().handle(event);
      }
      // Handle cache with dynamic strategy
      else if (url.pathname.startsWith('/cache/')) {
        response = await createCacheBustingStrategy(dynamicStrategy, DYNAMIC_CACHE).handle(event);
      }
      // Handle images with image strategy
      else if (url.pathname.startsWith('/images/')) {
        response = await createImageStrategy().handle(event);
      }
      // Handle nax gallery cache images with image strategy
      else if (url.pathname.startsWith('/naxCache/')) {
        response = await createImageStrategy().handle(event);
      }
      // Handle all other static files with static strategy.
      // /sw.js must not enter STATIC_CACHE. A cached copy makes registration.update()
      // compare against old bytes and the new worker never installs.
      else if (url.pathname === '/sw.js' || url.pathname.startsWith('/dist/workbox/')) {
        response = await fetch(request, { cache: 'no-store' });
      }
      else {
        const shellHit = await matchStaticShell(url.pathname);
        if (shellHit) {
          response = respondWithSavedAsset(request, shellHit);
        } else {
          response = await createCacheBustingStrategy(staticStrategy, STATIC_CACHE).handle(event);
        }
      }
      
      return response;
    } catch (error) {
      notifyClientsOfNetworkActivity('receive', {
        url: request.url,
        method: request.method,
        status: 0,
        error: error.message,
        fromNetwork: true,
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
    if (isLogViewerApiRequest(url) || isGrimoireBrowserRequest(url) || isDesktopGuacRequest(url)) {
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
      
      return response;
    } catch (error) {
      throw error;
    }
  }
);

// Message handling for client communication
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_STATIC_FILES') {
        cacheStaticFiles(event.data.files, event.data.silent === true);
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
    } else if (event.data && event.data.type === 'SYNC_WALLPAPER_URLS') {
        event.waitUntil(syncWallpaperUrls(event.data.urls, event.data.refresh, event.data.requestId).catch((error) => {
            console.error('Wallpaper sync failed:', error);
            if (!event.data.requestId) return;
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({
                        type: 'SYNC_WALLPAPER_URLS_COMPLETE',
                        requestId: event.data.requestId,
                        error: error.message
                    });
                });
            });
        }));
    } else if (event.data && event.data.type === 'REFRESH_WALLPAPER') {
        event.waitUntil(refreshWallpaperUrl(event.data.url, event.data.requestId).catch((error) => {
            console.error('Wallpaper refresh failed:', error);
            if (!event.data.requestId) return;
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({
                        type: 'REFRESH_WALLPAPER_COMPLETE',
                        requestId: event.data.requestId,
                        error: error.message
                    });
                });
            });
        }));
    } else if (event.data && event.data.type === 'DELETE_FROM_CACHE') {
        deleteFromCache(event.data.url, event.data.requestId);
    } else if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data && event.data.type === 'GET_DOWNLOAD_STATE') {
        getDownloadState(event.data.requestId);
    } else if (event.data && event.data.type === 'CANCEL_DOWNLOAD') {
        cancelDownload();
    } else if (event.data && event.data.type === 'GET_SW_CONFIG') {
        getSwConfig(event.data.requestId);
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
                // Snapshot before matchAll — downloadState is reset when the download finishes
                const completedNow = downloadState.completed;
                const totalNow = downloadState.total;
                const currentFileNow = downloadState.currentFile;
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'STATIC_CACHE_PROGRESS',
                            completed: completedNow,
                            total: totalNow,
                            currentFile: currentFileNow,
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

// Drop every static-cache row for this path, including Vary / ?sha= siblings.
// cache.delete(url) misses those, and cache.match then keeps returning the old row
// with no x-file-hash — the client re-downloads and restarts forever.
async function purgeStaticCacheEntries(cache, urlPath) {
    let target;
    try {
        target = new URL(urlPath, self.location.origin);
    } catch (error) {
        return;
    }
    const keys = await cache.keys();
    await Promise.all(keys.map((request) => {
        try {
            const keyUrl = new URL(request.url);
            if (keyUrl.origin === target.origin && keyUrl.pathname === target.pathname) {
                return cache.delete(request, { ignoreVary: true });
            }
        } catch (error) { /* ignore bad key */ }
        return undefined;
    }));
}

function staticCacheResponseWithHash(bodyBuffer, response, hash) {
    const headers = new Headers(response.headers);
    headers.delete('vary');
    headers.delete('content-encoding');
    headers.set('content-length', String(bodyBuffer.byteLength));
    headers.set('x-file-hash', hash);
    headers.delete('pragma');
    headers.delete('expires');
    headers.delete('surrogate-control');
    headers.set('Cache-Control', SAVED_ASSET_CACHE_CONTROL);
    headers.set('ETag', `"${hash}"`);
    return new Response(bodyBuffer, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
    });
}

// Cache static files from server
async function cacheStaticFiles(files, silent = false) {
    // Check if already downloading
    if (downloadState.isDownloading) {
        console.warn('Download already in progress, sending current status');
        const completedNow = downloadState.completed;
        const totalNow = downloadState.total;
        const currentFileNow = downloadState.currentFile;
        const startTimeNow = downloadState.startTime;
        const lastProgressTimeNow = downloadState.lastProgressTime;
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_ALREADY_IN_PROGRESS',
                    currentDownload: {
                        completed: completedNow,
                        total: totalNow,
                        currentFile: currentFileNow,
                        startTime: startTimeNow,
                        lastProgressTime: lastProgressTimeNow
                    }
                });
                client.postMessage({
                    type: 'STATIC_CACHE_PROGRESS',
                    completed: completedNow,
                    total: totalNow,
                    currentFile: currentFileNow
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
        downloadState.silent = silent === true;
        downloadState.updatedFiles = [];
        
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
                const isRouteEntry = file.type === 'route'
                    || file.url === '/'
                    || file.url === '/app'
                    || file.url === '/launch'
                    || file.url === '/index.html';
                const fetchHeaders = {
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                };
                if (isRouteEntry) {
                    fetchHeaders['X-SW-Bypass-Cache'] = '1';
                }
                // Fetch with cache-busting headers to prevent browser caching
                const fetchStartTime = Date.now();
                const response = await fetch(file.url, {
                  cache: 'no-store',
                  signal: signal,
                  headers: fetchHeaders
                });
                
                // Update progress time after fetch completes (even if it fails)
                downloadState.lastProgressTime = Date.now();
                
                if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)) {
                    try {
                        const body = await response.arrayBuffer();
                        await purgeStaticCacheEntries(cache, file.url);
                        const cacheKey = new Request(file.url);
                        await cache.put(cacheKey, staticCacheResponseWithHash(body, response, file.hash));

                        const cachedResponse = await cache.match(cacheKey, { ignoreVary: true });
                        const newHash = cachedResponse && cachedResponse.headers.get('x-file-hash');
                        if (newHash !== file.hash) {
                            console.warn(`Hash mismatch! Expected: ${file.hash}, Got: ${newHash}`);
                        } else {
                            downloadState.updatedFiles.push({ url: file.url, hash: file.hash });
                        }

                        downloadState.completed++;
                        downloadState.lastProgressTime = Date.now();

                        const completedNow = downloadState.completed;
                        const totalNow = downloadState.total;
                        const currentFileNow = file.url;
                        self.clients.matchAll().then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'STATIC_CACHE_PROGRESS',
                                    completed: completedNow,
                                    total: totalNow,
                                    currentFile: currentFileNow
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
        const updatedFiles = downloadState.updatedFiles.slice();
        const wasSilent = downloadState.silent === true;

        // Notify client of completion
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_COMPLETE',
                    files: files,
                    completed: completedCount,
                    total: totalCount,
                    updatedFiles: updatedFiles,
                    silent: wasSilent
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
            abortController: null,
            silent: false,
            updatedFiles: []
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
            abortController: null,
            silent: false,
            updatedFiles: []
        };
    }
}

function getSwConfig(requestId) {
    const payload = {
        cssOnlyAutoApply: CSS_ONLY_AUTO_APPLY === true,
        epoch: SW_SCRIPT_EPOCH
    };
    if (!requestId) {
        return payload;
    }
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'SW_CONFIG',
                requestId,
                cssOnlyAutoApply: payload.cssOnlyAutoApply,
                epoch: payload.epoch
            });
        });
    });
    return payload;
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
          // Non-fatal — store metadata fallback when image is not yet available (e.g. server boot)
        }
      } catch (error) {
        console.error('Failed to fetch content for internal cache:', error);
      }
    }

    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const response = new Response(body, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'Content-Type': typeof data === 'string' ? 'text/plain' : 'application/json',
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
  if (!cacheNames.includes(WALLPAPER_CACHE)) {
    cacheNames.push(WALLPAPER_CACHE);
  }
  if (isStudioGalleryImageUrl(urlWithoutQuery) && !cacheNames.includes(IMAGE_CACHE)) {
    cacheNames.push(IMAGE_CACHE);
  }
  const removedUrls = [];

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    const targetUrl = absoluteAssetUrl(urlWithoutQuery);
    for (const key of keys) {
      const keyUrl = absoluteAssetUrl(key.url);
      if (keyUrl === targetUrl || key.url.split('?')[0] === urlWithoutQuery) {
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
    const isImageOrPreview = isManagedImageCacheUrl(urlWithoutQuery) || isStudioGalleryImageUrl(urlWithoutQuery);
    const absoluteUrl = absoluteAssetUrl(urlWithoutQuery);
    let targetCacheName = STATIC_CACHE;
    if (urlWithoutQuery.includes('/cache/wallpapers/') || wallpaperUrlSet.has(absoluteUrl)) {
      targetCacheName = WALLPAPER_CACHE;
    } else if (isImageOrPreview) {
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
      const cacheKey = targetCacheName === WALLPAPER_CACHE ? absoluteUrl : urlWithoutQuery;
      await cache.put(cacheKey, response.clone());
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

// Install event — SW script only; assets cached via client-initiated CACHE_STATIC_FILES
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// A hashed shell row and a Vary / ?sha= row can share a pathname. ignoreSearch
// match returns whichever it finds first, so the unhashed row can hide the hash.
async function dropUnhashedStaticSiblings() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  const byPath = new Map();
  for (const request of keys) {
    let pathname = '';
    try {
      pathname = new URL(request.url).pathname;
    } catch (error) {
      continue;
    }
    let list = byPath.get(pathname);
    if (!list) {
      list = [];
      byPath.set(pathname, list);
    }
    const response = await cache.match(request, { ignoreVary: true });
    const hash = response && response.headers.get('x-file-hash');
    list.push({ request, hash: hash || '' });
  }
  const deletions = [];
  for (const list of byPath.values()) {
    if (!list.some((entry) => entry.hash)) {
      continue;
    }
    for (const entry of list) {
      if (!entry.hash) {
        deletions.push(cache.delete(entry.request, { ignoreVary: true }));
      }
    }
  }
  await Promise.all(deletions);
}

// Install event — SW script only; assets cached via client-initiated CACHE_STATIC_FILES
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
              cacheName !== IMAGE_CACHE &&
              cacheName !== INTERNAL_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(async () => {
      await dropUnhashedStaticSiblings();
      await caches.open(STATIC_CACHE).then((cache) => cache.delete('/sw.js'));
      await enforceImageCachePolicy();
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_SCRIPT_UPDATED', epoch: SW_SCRIPT_EPOCH });
      });
    })
  );
});

// Send network activity event to all clients (debounced to batch rapid fetch/cache traffic).
const _networkActivityPending = { transmit: false, receive: false };
let _networkActivityFlushTimer = null;
const NETWORK_ACTIVITY_DEBOUNCE_MS = 80;

function maybeNotifyHttpTransmit(request) {
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return;
  }
  try {
    const parsed = new URL(request.url, self.location.origin);
    if (isLogViewerApiRequest(parsed) || isGrimoireBrowserRequest(parsed) || isDesktopGuacRequest(parsed)) {
      return;
    }
  } catch (error) {
    return;
  }
  notifyClientsOfNetworkActivity('transmit', {
    url: request.url,
    method,
    fromNetwork: true,
    timestamp: Date.now()
  });
}

function notifyClientsOfNetworkActivity(type, requestData) {
  if (!shouldReportNetworkActivity(requestData)) {
    return;
  }
  if (type === 'transmit') {
    _networkActivityPending.transmit = true;
  } else if (type === 'receive') {
    _networkActivityPending.receive = true;
  } else {
    return;
  }

  if (_networkActivityFlushTimer) {
    return;
  }

  _networkActivityFlushTimer = setTimeout(() => {
    _networkActivityFlushTimer = null;
    const pendingTransmit = _networkActivityPending.transmit;
    const pendingReceive = _networkActivityPending.receive;
    _networkActivityPending.transmit = false;
    _networkActivityPending.receive = false;

    if (!pendingTransmit && !pendingReceive) {
      return;
    }

    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        if (pendingTransmit) {
          client.postMessage({
            type: 'NETWORK_ACTIVITY',
            activityType: 'transmit',
            timestamp: Date.now()
          });
        }
        if (pendingReceive) {
          client.postMessage({
            type: 'NETWORK_ACTIVITY',
            activityType: 'receive',
            timestamp: Date.now()
          });
        }
      });
    });
  }, NETWORK_ACTIVITY_DEBOUNCE_MS);
}

// Check if URL is a local server request
function isLocalServerRequest(url) {
  if (!url) return false;

  // Handle relative URLs
  if (url.pathname.startsWith('/')) return true;

  // Handle absolute URLs to the same origin
  return url.origin === self.location.origin;
}
