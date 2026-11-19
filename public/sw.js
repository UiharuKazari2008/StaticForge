importScripts('/dist/workbox/workbox-sw.js');

// The Android app's phone storage (window.AndroidPhoneStorage, explorerPhoneDrive.js) serves files
// from https://appassets.androidplatform.net/phone-storage/... inside the WebView. The worker must
// never touch those: no route, no respondWith, or video and byte-range requests fail ("no-response").
// Registered before any Workbox route, so this listener runs first and keeps the event from it.
const SW_BYPASS_HOSTS = new Set(['appassets.androidplatform.net']);
self.addEventListener('fetch', (event) => {
  let host = '';
  try { host = new URL(event.request.url).hostname; } catch (_err) { return; }
  if (SW_BYPASS_HOSTS.has(host)) event.stopImmediatePropagation();
});

// Fast path for the page's own scripts and stylesheets, asked for by hash (#817).
// A boot asks for about 410 of them at once. Each went through the Workbox router (every route's
// matcher), the unified handler's awaits and its own Cache Storage lookup, one after another on
// the worker's thread: ~6 ms each on the Galaxy A53, so the last file was answered 5 s after the
// page asked and DOMContentLoaded waited for it (A53, Nov 15: all 410 requested by 0.85 s, median
// worker start 2.93 s, no long task in the page).
// This listener is registered before Workbox's, answers such a request itself and keeps the event
// from the router: one exact-key lookup in the hashed-URL cache (opened once per worker), the row
// handed over as it is, so Chrome's compiled code for it is used. A file not there yet takes
// hashedScriptRow (the copy from the static cache on first sight).
// Read on the A53 (Nov 15): DOMContentLoaded 5.05 -> 4.6 s, median worker start 2.93 -> 1.61 s. One
// read of the whole cache per burst (keys + matchAll) was tried and measured no better there
// (worker start 1.71 s, DOMContentLoaded 4.7 s) and worse on the desktop; it is not kept.
const HASHED_FAST_PREFIXES = ['/scripts/', '/css/'];

async function answerHashedAsset(event, request, url, key) {
  try {
    const cache = await openScriptCodeCache();
    const kept = await cache.match(key);
    if (kept) return kept;
    const row = await hashedScriptRow({ event }, request, url);
    if (row) return row;
    // the kept file is another version than the page asked for: what the router answered before
    const shellHit = await matchStaticShell(url.pathname);
    // a browser (not an installed client, which must start without the server) asking for a newer version than the
    // cache holds gets it from the server when it answers in time (#951): old bytes under the new ?sha= left the
    // page on old code with nothing telling it so
    const wanted = url.searchParams.get('sha');
    if (shellHit && wanted && shellHit.headers.get('x-file-hash') !== wanted && !isAppWebView(request)) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      try {
        const net = await fetch(request, { signal: ctl.signal });
        if (net && net.ok) return net;
      } catch (_err) { /* the held copy below */ } finally { clearTimeout(timer); }
    }
    if (shellHit) return respondWithSavedAsset(request, shellHit, SHELL_ASSET_CACHE_CONTROL);
    // no row at all (#924): an earlier version this worker still holds a copy of boots the page;
    // the update check that follows the start fetches the right one
    const earlier = await earlierScriptCopy(cache, url);
    if (earlier) return earlier;
  } catch (_err) { /* the network below */ }
  return fetchMissingHashedAsset(event, request, url);
}

/** Any copy SCRIPT_CODE_CACHE holds of this path under another hash (the version the page ran before). */
async function earlierScriptCopy(cache, url) {
  const byPath = await scriptCodeKeys(cache);
  const keys = byPath.get(url.origin + url.pathname);
  if (!keys) return null;
  for (const key of keys) {
    const copy = await cache.match(key);
    if (copy) return copy;
  }
  return null;
}

// A page file with no copy in any cache goes to the network, but never without a limit (#924): an
// installed client's kept /app once named a desktopBoot.js this cache did not have, the server was
// unreachable, and the request hung for 334 s before the page died. The answer's headers must come
// within MISSING_ASSET_WAIT_MS (shorter on an installed client, which must start without the
// server); past it the request fails at once, the pages are told (STATIC_FILE_MISSING), and when
// the file is one the copy cannot start without, the page is sent to /launch?repair=1, whose
// update check takes the critical-missing route to the installer.
const MISSING_ASSET_WAIT_MS = 10000;
const MISSING_ASSET_WAIT_INSTALLED_MS = 4000;
const SHELL_REPAIR_EVERY_MS = 3 * 60 * 1000;
// public/scripts/launch/updatePolicy.js CRITICAL_PATHS (kept in step by scripts/test-sw-shell-atomic.js)
const SHELL_CRITICAL_PATHS = new Set([
  '/scripts/comp/serviceWorkerManager.js',
  '/scripts/comp/fatalErrorBootstrap.js',
  '/scripts/comp/modalUtils.js',
  '/scripts/comp/winlogonPower.js',
  '/scripts/comp/desktopBoot.js',
  '/scripts/comp/featureLoader.js',
  '/scripts/websocket.js',
  '/scripts/app.js',
  '/scripts/launch/updatePolicy.js',
  '/scripts/launch/updateEngine.js',
  '/scripts/launch/melatonBoot.js',
  '/scripts/launch/assetPackages.js',
  '/css/desktop-boot.css'
]);
let shellRepairAt = 0;

async function fetchMissingHashedAsset(event, request, url) {
  const waitMs = isAppWebView(request) ? MISSING_ASSET_WAIT_INSTALLED_MS : MISSING_ASSET_WAIT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), waitMs);
  try {
    const response = await fetch(request, { signal: abort.signal });
    // the front proxy's error page is not the file
    if (response && response.status < 500) return response;
  } catch (_err) { /* no answer in time */ } finally {
    clearTimeout(timer);
  }
  const told = reportMissingAsset(event, url.pathname).catch(() => {});
  if (event && typeof event.waitUntil === 'function') event.waitUntil(told);
  return Response.error();
}

async function reportMissingAsset(event, pathname) {
  const all = await self.clients.matchAll({ type: 'window' });
  all.forEach((client) => client.postMessage({ type: 'STATIC_FILE_MISSING', path: pathname, critical: SHELL_CRITICAL_PATHS.has(pathname) }));
  if (!SHELL_CRITICAL_PATHS.has(pathname)) return;
  // the kept shell asked for it: that shell is not this cache's, so it goes (the next start takes
  // the server's page, or the installed boot shell when the server is away)
  try { await (await caches.open(LAUNCH_SHELL_CACHE)).delete(APP_SHELL_KEY); } catch (_err) { /* kept */ }
  const now = Date.now();
  if (now - shellRepairAt < SHELL_REPAIR_EVERY_MS) return;
  shellRepairAt = now;
  const id = event && (event.clientId || event.resultingClientId);
  const client = id ? await self.clients.get(id) : null;
  if (client && typeof client.navigate === 'function' && new URL(client.url).pathname === '/app') {
    await client.navigate('/launch?repair=1').catch(() => {});
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || (request.destination !== 'script' && request.destination !== 'style')) return;
  const raw = request.url;
  const at = raw.indexOf('?sha=');
  if (at < 0 || request.headers.has('range')) return;
  let url;
  try { url = new URL(raw); } catch (_err) { return; }
  if (url.origin !== self.location.origin || !HASHED_FAST_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  const sha = url.searchParams.get('sha');
  if (!sha || isAuthGatedStaticPath(url.pathname)) return;
  event.stopImmediatePropagation();
  event.respondWith(answerHashedAsset(event, request, url, `${url.origin}${url.pathname}?sha=${sha}`));
});

// Compile-time: auto-apply CSS-only / apply-safe static cache updates without restart prompt
const CSS_ONLY_AUTO_APPLY = true;
const SW_SCRIPT_EPOCH = 13; // bump on breaking SW changes

// Enable Workbox logging in development
// Modules from this server (public/dist/workbox, the 7.0.0 builds workbox-sw loads), not
// storage.googleapis.com: a new worker no longer waits on Google's CDN (Yozora #516)
if (workbox) {
  workbox.setConfig({ debug: false, modulePathPrefix: '/dist/workbox/' });
}

const { strategies, expiration, cacheableResponse } = workbox;

// Cache names
const STATIC_CACHE = 'static-cache-v2';
const DYNAMIC_CACHE = 'dynamic-cache-v1';
const INTERNAL_CACHE = 'internal-cache-v1';
const IMAGE_CACHE = 'image-cache-v1';
const WALLPAPER_CACHE = 'wallpaper-cache-v1';
// The Vista fonts (/protected/fonts/, behind the logon): kept once a signed-in client has them, so
// a server restart or a slow answer never swaps the text to a fallback font (Yukimi, Nov 13)
const PROTECTED_FONT_CACHE = 'protected-font-cache-v1';
const PROTECTED_FONT_PREFIX = '/protected/fonts/';
// Public data behind the logon that every boot reads (the T5 tokenizer is 2.4 MB): kept like the fonts
const KEPT_PROTECTED_FILES = new Set(['/protected/t5_tokenizer.json', '/protected/qwen35_tokenizer.def']);
function isKeptProtectedPath(pathname) {
  return pathname.startsWith(PROTECTED_FONT_PREFIX) || KEPT_PROTECTED_FILES.has(pathname);
}
// Explorer file previews (Yozora #643): /<vfs uuid>/previews/<fileId>?v=<version> and
// /cache/preview/<hash>.webp. Its own limits, apart from the Gallery's IMAGE_CACHE.
const EXPLORER_PREVIEW_CACHE = 'explorer-preview-cache-v1';
// Page scripts and stylesheets keyed by the URL the page asks with (path?sha=hash), so Chrome can
// keep V8's compiled code beside each script row (#817, hashedScriptRow below). Copies of
// STATIC_CACHE rows; safe to delete.
const SCRIPT_CODE_CACHE = 'script-code-cache-v1';
const EXPLORER_PREVIEW_POLICY = {
  maxEntries: 5000,
  maxIdleSeconds: 14 * 24 * 60 * 60, // a hit restarts the clock
  // Images with no generated preview come as the whole original; those stay network-only.
  maxEntryBytes: 1024 * 1024
};
const IMAGE_METADATA_KEY = '/internal/sw-image-cache-metadata-v1';

// ---------- opt-in performance trace ----------
// A page turns it on by storing anything at PERF_TRACE_FLAG_KEY in INTERNAL_CACHE (and posting
// SW_PERF_TRACE so a running worker rereads it). Rows go to PERF_TRACE_LOG_KEY (last 600):
//   fetch  <path> q=<ms the event waited for the worker> h=<ms in the handler> <branch>
//   span   <job> <ms>               the heavy jobs (activate steps, cache policy, downloads)
//   stall  <ms>                    the event loop held that long (100 ms probe)
const PERF_TRACE_FLAG_KEY = '/internal/sw-perf-trace';
const PERF_TRACE_LOG_KEY = '/internal/sw-perf-log';
const perfTrace = { on: false, rows: [], flushTimer: null, probe: null, last: 0 };

function perfLog(line) {
  if (!perfTrace.on) return;
  perfTrace.rows.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
  if (perfTrace.rows.length > 600) perfTrace.rows.splice(0, perfTrace.rows.length - 600);
  if (perfTrace.flushTimer) return;
  perfTrace.flushTimer = setTimeout(() => {
    perfTrace.flushTimer = null;
    caches.open(INTERNAL_CACHE).then((cache) => cache.put(PERF_TRACE_LOG_KEY, new Response(JSON.stringify(perfTrace.rows), {
      headers: { 'content-type': 'application/json' }
    }))).catch(() => {});
  }, 2000);
}

async function perfSpan(name, fn) {
  if (!perfTrace.on) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    perfLog(`span ${name} ${Math.round(performance.now() - t0)}`);
  }
}

async function loadPerfTraceFlag() {
  try {
    const cache = await caches.open(INTERNAL_CACHE);
    const on = !!(await cache.match(PERF_TRACE_FLAG_KEY));
    if (on && !perfTrace.on) {
      const previous = await cache.match(PERF_TRACE_LOG_KEY);
      perfTrace.rows = previous ? await previous.json().catch(() => []) : [];
    }
    perfTrace.on = on;
  } catch (_) { /* no trace */ }
  clearInterval(perfTrace.probe);
  perfTrace.probe = null;
  if (perfTrace.on) {
    perfLog('trace on (worker start or SW_PERF_TRACE)');
    perfTrace.last = performance.now();
    perfTrace.probe = setInterval(() => {
      const now = performance.now();
      const late = now - perfTrace.last - 100;
      perfTrace.last = now;
      if (late > 150) perfLog(`stall ${Math.round(late)}`);
    }, 100);
  }
}
loadPerfTraceFlag();

const IMAGE_CACHE_POLICY = {
  // Previews are ~20-40 KB; 20000 covers the largest workspace (~20k images) and stays under
  // maxSizeBytes. 5000 was never really enforced (lost metadata entries were not counted).
  maxEntries: 20000,
  maxSizeBytes: 2 * 1024 * 1024 * 1024, // 2GB
  // Previews only. Full /images/ responses are not stored.
  // galleryView.js syncImageCacheRules sends the same week.
  maxIdleMs: 7 * 24 * 60 * 60 * 1000,
  lockedPreviewCount: 500
};

// Saved shell and preview hits. The boot-loop fix refused unhashed writes;
// stamping no-store and a new ETag on every hit made saved files look one-shot.
const SAVED_ASSET_CACHE_CONTROL = 'public, max-age=604800';
// App shell hits (static_images, css, fonts, ...) keep one URL when their bytes change (an art
// update). A max-age let the renderer's memory cache reuse the old copy in the next document
// without asking: Android WebView keeps one renderer, so a phone showed old art after every
// restart until the app was killed (#709, the WM signal icons). no-cache makes the next
// document ask; the row's ETag is its hash, so an unchanged file is a 304 from this worker.
const SHELL_ASSET_CACHE_CONTROL = 'no-cache';

// Enforcing cache policy on every image hit can thrash the cache.
// Debounce and rate-limit enforcement to keep the cache warm.
const IMAGE_POLICY_ENFORCE_DEBOUNCE_MS = 2000;
const IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS = 30000;
const IMAGE_POLICY_DELETES_PER_RUN = 300;

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
    // Bare-path rows only (both strategies strip the query); an ignoreSearch match scans
    // every row (matchStaticShell)
    return cache.match(cacheKey, { ignoreVary: true });
  }
  return cache.match(request);
}

// Shell rows are stored as the pathname (see CACHE_STATIC_FILES). ?sha= and
// font ?t= / ?v= requests must use that row. cache.match on the opened cache
// honors ignoreSearch; Workbox's caches.match() does not, so those GETs were
// leaving the worker and hitting the server.
// /protected and /private stay on the network so a logged-out client cannot
// read a copy stored while someone was signed in. web_server.js isProtectedResource
function isAuthGatedStaticPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return false;
  if (pathname.startsWith('/protected/') || pathname.startsWith('/private/')) return true;
  if (pathname === '/' || pathname === '/app' || pathname === '/launch' || pathname === '/index.html') return true;
  if (pathname === '/manifest.json') return true;
  return false;
}

function isGateSensitiveShellPath(pathname) {
  return pathname === '/' || pathname === '/app' || pathname === '/launch' || pathname === '/index.html' || pathname === '/manifest.json';
}

function isAuthGatedManifestFile(file) {
  if (file && file.auth === true) return true;
  const raw = file && file.url ? String(file.url) : '';
  let path = raw.split('?')[0];
  try {
    path = new URL(raw, self.location.origin).pathname;
  } catch (_err) {
    path = raw.split('?')[0];
  }
  return isAuthGatedStaticPath(path);
}

function hasFileExtension(pathname) {
  const last = String(pathname || '').split('/').pop();
  return /\.[a-z0-9]{1,8}$/i.test(last);
}

async function matchStaticShell(pathname) {
  if (!pathname || pathname === '/sw.js' || pathname.startsWith('/dist/workbox/') || isAuthGatedStaticPath(pathname)) {
    return null;
  }
  const cache = await caches.open(STATIC_CACHE);
  // Exact key only: rows are stored under the bare pathname (CACHE_STATIC_FILES, and the
  // strategy's cacheKeyWillBeUsed strips the query). An ignoreSearch match cannot use the
  // cache's key index and scans every row: 3.5 s per miss on an 8500-row cache (Edge, Oct 24),
  // so /logon-picture held the Vista Welcome screen to its 12 s art timeout while the desktop
  // was revealed in the open. An exact miss costs nothing.
  const exact = await cache.match(pathname, { ignoreVary: true });
  return exact && exact.status === 200 ? exact : null;
}
let imagePolicyEnforceTimer = null;
let imagePolicyLastEnforcedAt = 0;
// One run at a time. The interval used to start counting only when a run ended, so on a phone
// where a run took 20-55 s every image hit started another: four ran at once, each deleting from
// the image cache while previews queued behind them for 5-9 s (Fold7 Continuity boot, Nov 14).
let imagePolicyRun = null;

function scheduleImageCachePolicyEnforcement(delayMs = IMAGE_POLICY_ENFORCE_DEBOUNCE_MS) {
  const now = Date.now();
  if (imagePolicyRun || now - imagePolicyLastEnforcedAt < IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS) {
    return;
  }
  if (imagePolicyEnforceTimer) {
    clearTimeout(imagePolicyEnforceTimer);
  }
  imagePolicyEnforceTimer = setTimeout(() => {
    imagePolicyEnforceTimer = null;
    if (imagePolicyRun) return;
    imagePolicyLastEnforcedAt = Date.now();
    imagePolicyRun = enforceImageCachePolicy()
      .catch((error) => { console.warn('[sw] image cache policy failed:', error); })
      .finally(() => {
        imagePolicyRun = null;
        imagePolicyLastEnforcedAt = Date.now();
      });
  }, delayMs);
}

// One file must not hold the installer. A 404 is absent and is not fetched again.
const STATIC_FILE_FETCH_TIMEOUT_MS = 20000;

function freshDownloadState() {
    return {
        isDownloading: false,
        completed: 0,
        total: 0,
        currentFile: null,
        startTime: null,
        lastProgressTime: null,
        files: [],
        abortController: null,
        silent: false,
        updatedFiles: [],
        absentFiles: [],
        // #951: the files still to fetch (a later request merges in), what each finished url was fetched at,
        // the files whose bytes were not the manifest's, and the pages that asked for this download
        queue: [],
        doneHash: new Map(),
        mismatched: [],
        requesters: new Set()
    };
}

// Download state tracking
let downloadState = freshDownloadState();

function headersForSavedAsset(response, cacheControl = SAVED_ASSET_CACHE_CONTROL) {
  const headers = new Headers(response.headers);
  headers.delete('pragma');
  headers.delete('expires');
  headers.delete('surrogate-control');
  headers.set('Cache-Control', cacheControl);
  const hash = headers.get('x-file-hash');
  if (hash) {
    headers.set('ETag', `"${hash}"`);
  }
  return headers;
}

function savedAssetNotModified(request, response, cacheControl) {
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
    headers: headersForSavedAsset(response, cacheControl)
  });
}

// Return a saved Cache API body without the one-shot stamp.
function reusableCachedResponse(response, cacheControl) {
  if (!response || response.status < 200 || response.status > 599 || response.status === 304) {
    return response;
  }
  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headersForSavedAsset(response, cacheControl)
    });
  } catch (error) {
    return response;
  }
}

// A script the page asks for by its hash (?sha=) is answered with a Cache Storage row handed over
// untouched, from a cache keyed by that exact URL (#817).
// Why: Chrome keeps V8's compiled code for a script beside its Cache Storage row, and uses it only
// when (1) the worker passes the row on as it is and (2) the row's key is the URL the page asked
// for. STATIC_CACHE met neither: its rows are keyed by the bare path, and every hit was copied
// (new Response(row.body), reusableCachedResponse) to change its headers, which makes it a response
// the worker wrote. So no script ever had a code cache: all of them (about 250, 6.7 MB) were parsed
// and compiled again on every boot, in the page's background threads, before DOMContentLoaded.
// How: the first request for path?sha=hash copies the STATIC_CACHE row (only when its x-file-hash
// is that hash) into SCRIPT_CODE_CACHE under that URL and is answered the old way; later requests
// get the copy itself. Chrome writes the compiled code to it after a couple of loads and reads it
// back from then on. The URL carries the hash, so new bytes are a new key: the row's own max-age
// cannot serve an old copy (the reason other shell hits are stamped no-cache), and copies of
// earlier hashes of the same path are dropped when the new one is stored.
let scriptCodeCacheOpen = null;
function openScriptCodeCache() {
  if (!scriptCodeCacheOpen) {
    scriptCodeCacheOpen = caches.open(SCRIPT_CODE_CACHE).catch((error) => { scriptCodeCacheOpen = null; throw error; });
  }
  return scriptCodeCacheOpen;
}

async function hashedScriptRow(handler, request, url) {
  // Stylesheets asked for by hash take the same road: no compiled code to keep, but a lookup in
  // this small cache instead of the 9,000-row static one, and no copy of the body per hit.
  if ((request.destination !== 'script' && request.destination !== 'style') || request.headers.get('range')) return null;
  const sha = url.searchParams.get('sha');
  if (!sha) return null;
  try {
    const cache = await openScriptCodeCache();
    const bare = url.origin + url.pathname;
    const key = `${bare}?sha=${sha}`;
    const kept = await cache.match(key);
    if (kept) return kept;
    const row = await matchStaticShell(url.pathname);
    if (!row || row.headers.get('x-file-hash') !== sha) return null;
    const stored = keepScriptCodeRow(cache, bare, key, row.clone()).catch(() => {});
    if (handler && handler.event && handler.event.waitUntil) handler.event.waitUntil(stored);
    return respondWithSavedAsset(request, row, SHELL_ASSET_CACHE_CONTROL);
  } catch (error) {
    return null;
  }
}

// Bare path -> the keys SCRIPT_CODE_CACHE holds for it. Read with one listing of that (small) cache
// the first time this worker stores a new hash, then kept current here. Each stored file used to
// list the cache with ignoreSearch, a scan of every row, for every changed script after an update.
let scriptCodeKeyIndex = null;
function scriptCodeKeys(cache) {
  if (!scriptCodeKeyIndex) {
    scriptCodeKeyIndex = cache.keys().then((keys) => {
      const byPath = new Map();
      for (const request of keys) {
        const bare = request.url.split('?')[0];
        if (!byPath.has(bare)) byPath.set(bare, new Set());
        byPath.get(bare).add(request.url);
      }
      return byPath;
    }).catch((error) => { scriptCodeKeyIndex = null; throw error; });
  }
  return scriptCodeKeyIndex;
}

/** Store row under key and drop the copies of the path's other hashes. */
async function keepScriptCodeRow(cache, bare, key, row) {
  await cache.put(key, row);
  const byPath = await scriptCodeKeys(cache);
  const before = byPath.get(bare);
  byPath.set(bare, new Set([key]));
  if (!before) return;
  await Promise.all([...before].filter((k) => k !== key).map((k) => cache.delete(k)));
}

function respondWithSavedAsset(request, response, cacheControl) {
  return savedAssetNotModified(request, response, cacheControl) || reusableCachedResponse(response, cacheControl);
}

// Helper function to add cache-busting headers to responses
function addCacheBustingHeaders(response, contentType) {
  // Opaque/opaqueredirect responses use status 0 and cannot be reconstructed.
  if (!response || response.status < 200 || response.status > 599) {
    return response;
  }

  const headers = new Headers(response.headers);
  // Zip extract used to store /app as octet-stream. A navigation then downloads it.
  if (contentType) {
    headers.set('Content-Type', contentType);
    headers.delete('Content-Disposition');
  }
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


// The server's X-File-Hash is the manifest hash looked up by path (web_server.js
// getServedFileHash), not a hash of the bytes it sent. A stale copy on the server (Oct 23:
// the old Paint and Notepad icons after 2bbb12a1) went out under the new hash, the row looked
// current to every update check, and the old icon stayed for good. Rows are stored under the
// SHA-256 of their body. Manifest hashes that are not a body hash: the routes (templated HTML)
// and workspaces.css (the hash of its source, modules/workspaceCssService.js getManifestEntry).
const NON_BODY_HASH_PATHS = new Set(['/', '/app', '/launch', '/index.html', '/css/workspaces.css']);

function hasBodyHash(urlPath) {
  try {
    return !NON_BODY_HASH_PATHS.has(new URL(urlPath, self.location.origin).pathname);
  } catch (_) {
    return false;
  }
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** False when the response claims an x-file-hash its body does not have (do not store it). */
async function bodyMatchesClaimedHash(response, urlPath) {
  const claimed = response && response.headers.get('x-file-hash');
  if (!claimed || !hasBodyHash(urlPath)) return true;
  const actual = await sha256Hex(await response.clone().arrayBuffer());
  if (actual === claimed) return true;
  console.warn(`[sw] ${urlPath}: body hash ${actual.slice(0, 12)} is not the claimed ${claimed.slice(0, 12)}; not cached`);
  return false;
}

// Once per client: rows stored before the body check whose body is not their x-file-hash are
// dropped, so the update check that follows SW_SCRIPT_UPDATED downloads them again.
const BODY_HASH_AUDIT_KEY = '/internal/sw-body-hash-audit-v1';

async function dropMislabelledStaticRows() {
  try {
    const internal = await caches.open(INTERNAL_CACHE);
    if (await internal.match(BODY_HASH_AUDIT_KEY)) return;
    const cache = await caches.open(STATIC_CACHE);
    const keys = await cache.keys();
    let next = 0;
    let dropped = 0;
    const lane = async () => {
      while (next < keys.length) {
        const request = keys[next++];
        try {
          const row = await cache.match(request, { ignoreVary: true });
          const claimed = row && row.headers.get('x-file-hash');
          if (!claimed || !hasBodyHash(request.url)) continue;
          if (await sha256Hex(await row.arrayBuffer()) === claimed) continue;
          await cache.delete(request, { ignoreVary: true });
          dropped++;
          console.warn(`[sw] dropped ${request.url}: its body is not ${claimed.slice(0, 12)}`);
        } catch (_) { /* unreadable row: the update check handles it */ }
      }
    };
    await Promise.all(Array.from({ length: 8 }, lane));
    await internal.put(BODY_HASH_AUDIT_KEY, new Response(JSON.stringify({ at: Date.now(), rows: keys.length, dropped }), {
      headers: { 'content-type': 'application/json' }
    }));
  } catch (error) {
    console.warn('[sw] body hash audit failed:', error);
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
  // No ignoreSearch: cacheKeyWillBeUsed below already reads and writes the bare path, and an
  // ignoreSearch match scans every row (matchStaticShell)
  matchOptions: {
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
      cacheWillUpdate: async ({ request, response }) => {
        if (!response || !response.headers.get('x-file-hash')) {
          return null;
        }
        if (!(await bodyMatchesClaimedHash(response, request.url))) {
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
  // No ignoreSearch: cacheKeyWillBeUsed below strips the query on read and write
  matchOptions: {},
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

const EXPLORER_VFS_PREVIEW_PATH = /^\/[0-9a-f-]{36}\/previews\/[^/]+$/i;

function isExplorerPreviewPath(pathname) {
  return EXPLORER_VFS_PREVIEW_PATH.test(pathname) || pathname.startsWith('/cache/preview/');
}

const explorerPreviewStrategy = new strategies.CacheFirst({
  cacheName: EXPLORER_PREVIEW_CACHE,
  plugins: [
    {
      // VFS previews keep ?v= (the file's version); /cache/preview/ is content-addressed.
      cacheKeyWillBeUsed: async ({ request }) => {
        const keyUrl = new URL(request.url);
        const v = EXPLORER_VFS_PREVIEW_PATH.test(keyUrl.pathname) ? keyUrl.searchParams.get('v') : null;
        keyUrl.search = v ? `?v=${encodeURIComponent(v)}` : '';
        keyUrl.hash = '';
        return keyUrl.href;
      }
    },
    {
      // Unversioned VFS URLs (an old page) and login/error pages are never stored.
      cacheWillUpdate: async ({ request, response }) => {
        if (!response || response.status !== 200) return null;
        if (!String(response.headers.get('content-type') || '').startsWith('image/')) return null;
        const url = new URL(request.url);
        if (EXPLORER_VFS_PREVIEW_PATH.test(url.pathname) && !url.searchParams.get('v')) return null;
        const length = parseInt(response.headers.get('content-length') || '0', 10);
        if (!(length > 0) || length > EXPLORER_PREVIEW_POLICY.maxEntryBytes) return null;
        // The expiration plugin also refuses a hit whose Date is past maxAgeSeconds.
        // Without Date only its last-used timestamp counts, so the limit is idle time.
        const headers = new Headers(response.headers);
        headers.delete('date');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
    },
    new expiration.ExpirationPlugin({
      maxEntries: EXPLORER_PREVIEW_POLICY.maxEntries,
      maxAgeSeconds: EXPLORER_PREVIEW_POLICY.maxIdleSeconds,
      purgeOnQuotaError: true
    })
  ]
});

// Image strategy - cache first with network fallback and immediate expiry
const imageStrategy = null;

function getCanonicalUrl(input) {
  const url = typeof input === 'string' ? input : input.url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const base = url.slice(0, q);
  // a NAX thumbnail (/naxCache/<slug>/<file>?w=480, #890) is another picture than the original:
  // it keeps its width in the key, so the grid's thumbnail and the full picture are cached apart
  if (base.includes('/naxCache/')) {
    const m = url.slice(q + 1).match(/(?:^|&)w=(\d+)(?:&|$)/);
    if (m) return `${base}?w=${m[1]}`;
  }
  return base;
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
  const s = String(url || '');
  // lossless preview copies (/previews/<stem>@ll.webp, #890) are full-size pictures too: one-shot,
  // never kept in the preview cache where a few MB each would push gallery previews out
  return s.includes('/images/') || /\/previews\/[^?#]*@ll\.webp(?:[?#]|$)/.test(s);
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

// The set lives in memory only, and the browser stops an idle worker. Rebuilt once per
// worker start from what WALLPAPER_CACHE already holds, so a /images/ or stock wallpaper
// is not sent down the no-store full-image path after a restart.
let wallpaperUrlSetRestore = null;
function restoreWallpaperUrlSet() {
  if (!wallpaperUrlSetRestore) {
    wallpaperUrlSetRestore = caches.open(WALLPAPER_CACHE)
      .then((cache) => cache.keys())
      .then((keys) => {
        keys.forEach((key) => {
          const url = absoluteAssetUrl(key.url);
          if (url) wallpaperUrlSet.add(url);
        });
      })
      .catch(() => {});
  }
  return wallpaperUrlSetRestore;
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

// urls: every workspace wallpaper (the cache keeps these). fetchUrls, when given, limits the
// downloads to that subset (boot fetches the active one; the rest come after the desktop).
async function syncWallpaperUrls(urls, refreshUrls, requestId, fetchUrls) {
  const next = new Set((Array.isArray(urls) ? urls : []).map(absoluteAssetUrl).filter(Boolean));
  const refresh = new Set((Array.isArray(refreshUrls) ? refreshUrls : []).map(absoluteAssetUrl).filter(Boolean));
  const fetchOnly = Array.isArray(fetchUrls)
    ? new Set(fetchUrls.map(absoluteAssetUrl).filter(Boolean))
    : null;
  await restoreWallpaperUrlSet();
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
    if (fetchOnly && !fetchOnly.has(url)) continue;
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
  // VFS previews are Explorer's (EXPLORER_PREVIEW_CACHE), not the Gallery's
  let pathname = String(url || '');
  try { pathname = new URL(pathname, self.location.origin).pathname; } catch (_) { /* keep raw */ }
  if (EXPLORER_VFS_PREVIEW_PATH.test(pathname)) return false;
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

// Image cache metadata lives in memory for the worker's lifetime: every preview hit and miss
// used to read, parse, change one entry of, re-serialize and rewrite the whole blob (~325 KB),
// concurrently and unlocked. That held each preview response 37-236 ms instead of a few ms,
// and overlapping writes lost entries (6244 of 7988 cached previews had none). Callers still
// readImageMetadata() / writeImageMetadata(); the write is a deferred flush to Cache Storage.
// The flush writes the whole blob (up to 20,000 entries, ~2 MB of JSON): it ran every 1.5 s while
// previews loaded (#890). Now it waits until the previews stop (IDLE_MS without a change), is held
// to one per MIN_GAP_MS, and a change never waits more than MAX_WAIT_MS. The image requests and the
// messages that change it keep the worker alive until the batch is written
// (imageMetadataSettled under their waitUntil), so stopping the worker does not lose it.
const IMAGE_METADATA_FLUSH_IDLE_MS = 2000;
const IMAGE_METADATA_FLUSH_MIN_GAP_MS = 30000;
const IMAGE_METADATA_FLUSH_MAX_WAIT_MS = 30000;
let imageMetadataState = null;
let imageMetadataLoading = null;
let imageMetadataFlushTimer = null;
let imageMetadataDirtySince = 0;
let imageMetadataLastFlushAt = 0;
let imageMetadataPending = null; // { promise, resolve } of the batch not yet written
let imageMetadataWriting = Promise.resolve();

async function readImageMetadata() {
  if (imageMetadataState) return imageMetadataState;
  if (!imageMetadataLoading) {
    imageMetadataLoading = loadImageMetadataFromCache()
      .then((metadata) => {
        imageMetadataState = imageMetadataState || metadata;
        return imageMetadataState;
      })
      .finally(() => {
        imageMetadataLoading = null;
      });
  }
  return imageMetadataLoading;
}

async function loadImageMetadataFromCache() {
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

/** Marks the metadata changed; resolves at once (imageMetadataSettled() is the write). */
async function writeImageMetadata(metadata) {
  imageMetadataState = metadata;
  const now = Date.now();
  if (!imageMetadataPending) {
    let resolve = null;
    const promise = new Promise((done) => { resolve = done; });
    imageMetadataPending = { promise, resolve };
    imageMetadataDirtySince = now;
  }
  // after the last change, not before the gap since the last write, never later than the cap
  const at = Math.min(
    Math.max(now + IMAGE_METADATA_FLUSH_IDLE_MS, imageMetadataLastFlushAt + IMAGE_METADATA_FLUSH_MIN_GAP_MS),
    imageMetadataDirtySince + IMAGE_METADATA_FLUSH_MAX_WAIT_MS
  );
  clearTimeout(imageMetadataFlushTimer);
  imageMetadataFlushTimer = setTimeout(runImageMetadataFlush, Math.max(0, at - now));
}

/** Resolves once every change made so far is in Cache Storage. */
function imageMetadataSettled() {
  return imageMetadataPending ? imageMetadataPending.promise : imageMetadataWriting;
}

/** The fetch or message event that changed the metadata keeps the worker up until it is written. */
function holdForImageMetadata(event) {
  if (!event || typeof event.waitUntil !== 'function') return;
  try { event.waitUntil(imageMetadataSettled()); } catch (_) { /* the event is over: the next one holds */ }
}

/** Writes the pending batch now (the daily maintenance). */
function flushImageMetadataNow() {
  if (!imageMetadataPending) return imageMetadataWriting;
  clearTimeout(imageMetadataFlushTimer);
  return runImageMetadataFlush();
}

function runImageMetadataFlush() {
  imageMetadataFlushTimer = null;
  const pending = imageMetadataPending;
  imageMetadataPending = null;
  imageMetadataDirtySince = 0;
  imageMetadataLastFlushAt = Date.now();
  // one write at a time, in order: the later one carries every change
  imageMetadataWriting = imageMetadataWriting
    .then(() => flushImageMetadata())
    .catch(() => {})
    .then(() => { if (pending) pending.resolve(); });
  return imageMetadataWriting;
}

async function flushImageMetadata() {
  if (!imageMetadataState) return;
  const cache = await caches.open(INTERNAL_CACHE);
  await cache.put(
    IMAGE_METADATA_KEY,
    new Response(JSON.stringify(imageMetadataState), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  );
}

// The pinned URLs (favourites and locked previews) as one Set, built once per rules change: every
// image hit built two new Sets from the lists. The lists are replaced (never edited in place) when
// the rules change (syncImageCacheRules) or the metadata is read again, so their identity is
// the key.
let pinnedImageSetMemo = { favorites: null, locked: null, set: new Set() };
function pinnedImageSet(metadata) {
  const rules = metadata.rules || {};
  const favorites = rules.favoriteUrls || null;
  const locked = rules.lockedPreviewUrls || null;
  if (pinnedImageSetMemo.favorites !== favorites || pinnedImageSetMemo.locked !== locked) {
    pinnedImageSetMemo = { favorites, locked, set: new Set([...(favorites || []), ...(locked || [])]) };
  }
  return pinnedImageSetMemo.set;
}

function isPinnedImageUrl(url, metadata) {
  return pinnedImageSet(metadata).has(url);
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

// Called on image hits (rate-limited) and after deletions: works from the metadata alone, no
// cache.keys() listing (about 1 s on a large image cache) and no per-entry Set rebuilds, which
// froze the worker 0.4-0.8 s at a time (perf trace, Oct 24). The listing-based reconcile
// (full images, entries without a row, rows without an entry) runs in runCacheMaintenance.
async function enforceImageCachePolicy() {
  return perfSpan('enforceImageCachePolicy', () => enforceImageCachePolicyNow({ reconcile: false }));
}

async function enforceImageCachePolicyNow({ reconcile }) {
  const metadata = await readImageMetadata();
  const cache = await caches.open(IMAGE_CACHE);
  const now = Date.now();
  const pinnedSet = pinnedImageSet(metadata);
  const pinnedUrl = (url) => pinnedSet.has(url);

  // Chromium refuses to list a cache this large in one call ("Operation too large": the Fold's
  // 20000 previews, ~1.2 GB). Maintenance then failed before recording its run, so it ran in
  // full on every boot. Without the listing the metadata-only pass below still evicts.
  let keys = null;
  if (reconcile) {
    try {
      keys = await cache.keys();
    } catch (error) {
      perfLog(`imagePolicy reconcile skipped: ${error && error.message}`);
    }
  }
  // the blob is written (a full rewrite of up to 20,000 entries) only when this run changed it:
  // every preview hit schedules a run, and most change nothing (#890)
  let changed = false;
  if (keys) {
    const keySet = new Set();
    for (const key of keys) {
      const url = getCanonicalUrl(key.url);
      // Full images are one-shot. Drop leftovers so they do not crowd previews.
      if (isFullImageUrl(url)) {
        if (await cache.delete(key) && metadata.entries[url]) { delete metadata.entries[url]; changed = true; }
        continue;
      }
      keySet.add(url);
    }
    // Entries whose row is gone
    for (const url of Object.keys(metadata.entries)) {
      if (!keySet.has(url)) { delete metadata.entries[url]; changed = true; }
    }
    // Cached previews whose entry an old overlapping write lost: track them as recently used,
    // so they count toward the limits and can be evicted in order instead of never
    for (const url of keySet) {
      if (!metadata.entries[url] && isManagedImageCacheUrl(url)) {
        metadata.entries[url] = { size: 0, lastAccess: now, cachedAt: now, seq: metadata.sequence, pinned: false };
        changed = true;
      }
    }
  }

  const evict = new Map();
  const candidates = [];
  let totalEntries = 0;
  let totalSize = 0;
  for (const [url, entry] of Object.entries(metadata.entries)) {
    if (!isManagedImageCacheUrl(url)) continue;
    const pinned = pinnedUrl(url);
    if (entry.pinned !== pinned) { entry.pinned = pinned; changed = true; }
    totalEntries += 1;
    totalSize += entry.size || 0;
    if (pinned) continue;
    candidates.push({ url, seq: entry.seq || 0, size: entry.size || 0 });
    if (now - (entry.lastAccess || entry.cachedAt || now) > IMAGE_CACHE_POLICY.maxIdleMs) {
      evict.set(url, 'expired');
    }
  }

  // FIFO-like eviction by earliest sequence for non-pinned items.
  if (totalEntries > IMAGE_CACHE_POLICY.maxEntries || totalSize > IMAGE_CACHE_POLICY.maxSizeBytes) {
    candidates.sort((a, b) => a.seq - b.seq);
    for (const candidate of candidates) {
      if (totalEntries <= IMAGE_CACHE_POLICY.maxEntries && totalSize <= IMAGE_CACHE_POLICY.maxSizeBytes) {
        break;
      }
      if (!evict.has(candidate.url)) evict.set(candidate.url, 'capacity');
      totalEntries -= 1;
      totalSize -= candidate.size || 0;
    }
  }

  // A bounded batch per run, handing the cache back between small groups: thousands of rows
  // expire together after a week away, and one long delete loop kept every preview waiting
  let deleted = 0;
  for (const url of evict.keys()) {
    if (deleted >= IMAGE_POLICY_DELETES_PER_RUN) break;
    if (await cache.delete(url) && metadata.entries[url]) { delete metadata.entries[url]; changed = true; }
    deleted += 1;
    if (deleted % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (changed) await writeImageMetadata(metadata);
  perfLog(`imagePolicy evict=${evict.size} deleted=${deleted} entries=${totalEntries}`);
  // the rest goes in later runs (the interval keeps them apart)
  if (evict.size > deleted) {
    setTimeout(() => scheduleImageCachePolicyEnforcement(0), IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS);
  }
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
      // the worker stays up until the hit's metadata batch is written
      event.waitUntil(updateImageMetadataForHit(canonicalUrl).then(imageMetadataSettled));
      scheduleImageCachePolicyEnforcement();
      return respondWithSavedAsset(request, cachedResponse);
    }
    await cache.delete(canonicalUrl);
    await deleteImageMetadata([canonicalUrl]);
    holdForImageMetadata(event);
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
      holdForImageMetadata(event);
      scheduleImageCachePolicyEnforcement();
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

// The Vista games' files (Yozora #609) load on demand and stay out of the update manifest
// (web_server.js onDemandGameAsset), so nothing told a client its cached copy was old. A hit is
// served, then checked against the server's X-File-Hash (a HEAD, once per file every 10 minutes
// per worker); a different hash fetches the file again for the next load. Setup's lighter copies
// (x-media-lite, launchGamesHost.js) differ from the server's hash too and are replaced the same
// way, except while Setup is open: its last step swaps them (launchGames.js upgradeLite). Setup's
// media zips (GAME_MEDIA_PREFIX) are read once and unpacked, so the worker leaves them alone.
const GAME_ASSET_PREFIX = '/static_images/vista-games/';
const GAME_MEDIA_PREFIX = '/static_images/vista-games/media/';
const GAME_REVALIDATE_MS = 10 * 60 * 1000;
const gameAssetChecked = new Map();
const gameAssetQueue = [];
let gameAssetActive = 0;

async function setupWindowOpen() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clients.some((client) => {
    try {
      const pathname = new URL(client.url).pathname;
      return pathname === '/launch' || pathname === '/launch-games.html';
    } catch (_err) {
      return false;
    }
  });
}

async function checkGameAsset(job) {
  if (await setupWindowOpen()) {
    gameAssetChecked.delete(job.pathname);
    return;
  }
  const head = await fetch(job.pathname, { method: 'HEAD', cache: 'no-store' });
  const hash = head.ok ? head.headers.get('x-file-hash') : null;
  if (!hash || hash === job.hash) {
    return;
  }
  const fresh = await fetch(job.pathname, { cache: 'no-store' });
  if (!fresh.ok || fresh.headers.get('x-file-hash') !== hash) {
    return;
  }
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(job.pathname, fresh);
}

function pumpGameAssetQueue() {
  while (gameAssetActive < 3 && gameAssetQueue.length) {
    const job = gameAssetQueue.shift();
    gameAssetActive += 1;
    checkGameAsset(job)
      .catch(() => { gameAssetChecked.delete(job.pathname); })
      .finally(() => {
        gameAssetActive -= 1;
        job.resolve();
        pumpGameAssetQueue();
      });
  }
}

function revalidateGameAsset(pathname, cached) {
  const last = gameAssetChecked.get(pathname);
  if (last && Date.now() - last < GAME_REVALIDATE_MS) {
    return Promise.resolve();
  }
  gameAssetChecked.set(pathname, Date.now());
  return new Promise((resolve) => {
    gameAssetQueue.push({ pathname, hash: cached.headers.get('x-file-hash') || '', resolve });
    pumpGameAssetQueue();
  });
}

// Sidebar gadget packages (Yozora #629, modules/vistaGadgetStatic.js): out of the update manifest
// like the games, but small and re-imported in place, so the network answers first (a miss in
// matchStaticShell scans every cache row with ignoreSearch, about 2 s a file). The copy kept under
// the bare path is the offline fallback.
const GADGET_ASSET_PREFIX = '/static_images/vista-gadgets/';

async function handleGadgetAsset(request, pathname) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    // an init resets the referrer to this worker; the server reads the page's (vistaGadgetStatic.js "../" lookups)
    const fresh = await fetch(request, { cache: 'no-cache', referrer: request.referrer || 'about:client', referrerPolicy: request.referrerPolicy || 'same-origin' });
    if (fresh.ok) {
      cache.put(pathname, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (error) {
    const kept = await cache.match(pathname, { ignoreVary: true });
    if (kept) {
      return kept;
    }
    throw error;
  }
}

// Custom strategy wrapper to add cache-busting headers and emit network events
// knownMiss: the caller already looked the row up (matchStaticShell); no second lookup
function createCacheBustingStrategy(strategy, cacheName, knownMiss = false) {
  return {
    async handle({ request, event }) {
      const wasCached = knownMiss ? false : !!(await matchStrategyCache(cacheName, request));
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

// The installed boot shell: the last /launch the server sent past the gate (X-Melaton-Shell).
// When the device's gate key is gone or stale the server answers the cover instead; this copy
// then boots, and the BIOS asks for the Gateway Password (phoenixBios.js promptGatewayPassword)
// rather than leaving the install for the homepage. Setup's format wipes it with every cache.
const LAUNCH_SHELL_CACHE = 'melaton-launch-shell-v1';
const LAUNCH_SHELL_KEY = '/launch';
const APP_SHELL_KEY = '/app';

// perfTrace phase mark inside a traced handler: <label>=<ms since the handler started>
function perfMark(options, label) {
  if (options && options.perfMarks) options.perfMarks.push(`${label}=${Math.round(performance.now() - options.perfT0)}`);
}

// perfTrace: how long the fetch event waited for the worker (q) and how long its handler ran (h)
function perfRoute(handler) {
  return async (options) => {
    if (!perfTrace.on) return handler(options);
    const t0 = performance.now();
    if (options) { options.perfT0 = t0; options.perfMarks = []; }
    const fetchEvent = options && options.event;
    const queued = fetchEvent && typeof fetchEvent.timeStamp === 'number' ? t0 - fetchEvent.timeStamp : -1;
    let status = 'err';
    try {
      const response = await handler(options);
      status = response ? response.status : 'none';
      return response;
    } finally {
      const pathname = options && options.url ? options.url.pathname : '?';
      const marks = options && options.perfMarks && options.perfMarks.length ? ' ' + options.perfMarks.join(' ') : '';
      perfLog(`fetch ${pathname.slice(0, 80)} q=${Math.round(queued)} h=${Math.round(performance.now() - t0)} ${status}${marks}`);
    }
  };
}

// TOP RULE (Yukimi, Nov 18 2026): the installed app (Android's WebView: "; wv)" in its user agent) starts with not
// one request in the way - its kept boot pages answer at once, and the server is asked behind them only to keep the
// copy fresh for the next start. A flaky network (slow, not down) held the phone on a blank screen until the
// browser's own timeout. Browsers are unchanged (the network first, the kept copy when it fails).
// A DreamOS laptop is an installed client too (#923): its kiosk adds " DreamOS/<version>" to Chromium's user agent.
const INSTALLED_CLIENT_UA = /(?: wv\)| DreamOS\/)/;
const isAppWebView = (request) => INSTALLED_CLIENT_UA.test((request && request.headers && request.headers.get('user-agent')) || '') || INSTALLED_CLIENT_UA.test(self.navigator && self.navigator.userAgent || '');
// The kept shell and its files switch together (#924). A page the server sends is first held as a
// candidate (<key>.next); it becomes the kept shell only once every script and stylesheet it names
// (src / href with ?sha=) is in the static cache under that hash. Until then the shell kept before
// stays: its files are the ones this cache holds. The candidate is tried when it arrives and again
// when the page reports the cache in sync (SHELL_COMMIT: the boot check, an install at shutdown,
// /launch's installer). Before this, every start put the server's newest /app in place at once,
// whether or not its files had been downloaded.
const SHELL_NEXT_SUFFIX = '.next';
const SHELL_REF = /(?:src|href)=["']([^"'?#]+)\?sha=([0-9a-f]{16,64})["']/g;

/** [{ path, sha }] of the page's hashed scripts and stylesheets (the files the fast path serves). */
function shellFileRefs(html) {
  const seen = new Set();
  const refs = [];
  let m;
  SHELL_REF.lastIndex = 0;
  while ((m = SHELL_REF.exec(html))) {
    const path = m[1].charAt(0) === '/' ? m[1] : `/${m[1]}`;
    if (!HASHED_FAST_PREFIXES.some((prefix) => path.startsWith(prefix)) || isAuthGatedStaticPath(path)) continue;
    const id = `${path}?${m[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    refs.push({ path, sha: m[2] });
  }
  return refs;
}

/** The first file the page names that the static cache does not hold under that hash, or null. */
async function shellFileMissing(html) {
  for (const ref of shellFileRefs(html)) {
    const row = await matchStaticShell(ref.path);
    if (!row || row.headers.get('x-file-hash') !== ref.sha) return ref;
  }
  return null;
}

/** Hold the server's page as the candidate for key, and make it the kept shell if its files are here. */
async function keepShell(key, response) {
  const cache = await caches.open(LAUNCH_SHELL_CACHE);
  const kept = await cache.match(key);
  const html = await response.clone().text();
  if (kept && (await kept.clone().text()) === html) {
    await cache.delete(key + SHELL_NEXT_SUFFIX);
    return true;
  }
  await cache.put(key + SHELL_NEXT_SUFFIX, response);
  await cache.delete(key + '.next-missing'); // the old candidate's missing file says nothing about this one
  return promoteShell(key);
}

async function promoteShell(key) {
  const cache = await caches.open(LAUNCH_SHELL_CACHE);
  const next = await cache.match(key + SHELL_NEXT_SUFFIX);
  if (!next) return false;
  const missing = await shellFileMissing(await next.clone().text());
  if (missing) return false;
  await cache.put(key, next);
  await cache.delete(key + SHELL_NEXT_SUFFIX);
  await cache.delete(key + '.next-missing');
  return true;
}

/**
 * The server's newest shells as candidates (#951): at a shutdown install the page asks for this before it commits, so
 * the restart boots the /app that names the files just installed. Before, the candidate only came with the next
 * start's background refresh, so a restart for updates on an installed client booted the old /app (old ?sha=, old
 * code) and then asked for a second restart. Bounded; offline or slow, the candidates already held are used.
 */
async function refreshShellCandidates(ms = 1500) {
  const one = async (key, mark) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(key, { credentials: 'same-origin', cache: 'no-store', signal: ctl.signal });
      // true: the server's page is the kept shell now (new and complete, or the same as the one kept)
      if (r && r.status === 200 && r.headers.get('x-melaton-shell') === mark) return await keepShell(key, r.clone());
    } catch (_err) { /* the held candidate stays */ } finally { clearTimeout(timer); }
    return false;
  };
  const [app, launch] = await Promise.all([one(APP_SHELL_KEY, 'app'), one(LAUNCH_SHELL_KEY, 'launch')]);
  return { app, launch };
}

/** SHELL_COMMIT from a page: the cache is in sync, so the candidates' files are here now. */
async function commitShells(refresh = false) {
  const fresh = refresh ? await refreshShellCandidates().catch(() => ({})) : {};
  const app = (await promoteShell(APP_SHELL_KEY).catch(() => false)) || fresh.app === true;
  const launch = (await promoteShell(LAUNCH_SHELL_KEY).catch(() => false)) || fresh.launch === true;
  return { app, launch };
}

// The candidate's first missing file, kept beside it (<key>.next-missing): a start looks that one file up instead of
// the candidate's ~450, so a candidate whose files are not here yet costs one cache lookup per start
const SHELL_MISSING_SUFFIX = '.next-missing';

/** A start: a held candidate whose files are all here becomes the kept shell first (#951), cheaply when they are not. */
async function promoteBeforeStart(key) {
  const cache = await caches.open(LAUNCH_SHELL_CACHE);
  const next = await cache.match(key + SHELL_NEXT_SUFFIX);
  if (!next) return false;
  const mark = await cache.match(key + SHELL_MISSING_SUFFIX);
  if (mark) {
    const ref = String(await mark.text()).split('?');
    const row = ref[0] ? await matchStaticShell(ref[0]) : null;
    if (!row || row.headers.get('x-file-hash') !== ref[1]) return false;
  }
  const missing = await shellFileMissing(await next.clone().text());
  if (missing) {
    await cache.put(key + SHELL_MISSING_SUFFIX, new Response(`${missing.path}?${missing.sha}`));
    return false;
  }
  return promoteShell(key);
}

async function keptFirst(event, key, refresh) {
  try {
    // a candidate whose files are all here now (an install at shutdown that could not commit) is the start's shell
    await promoteBeforeStart(key).catch(() => false);
    const cache = await caches.open(LAUNCH_SHELL_CACHE);
    const kept = await cache.match(key);
    if (kept) {
      // the fresh copy for the next start, never waited for
      const fresh = refresh().catch(() => null);
      if (event && typeof event.waitUntil === 'function') event.waitUntil(fresh);
      return kept;
    }
  } catch (_err) { /* nothing kept: the network below */ }
  return null;
}

workbox.routing.registerRoute(
  ({ url, request }) => request.mode === 'navigate' && url.origin === self.location.origin && url.pathname === '/launch',
  async ({ request, event }) => {
    if (isAppWebView(request)) {
      const kept = await keptFirst(event, LAUNCH_SHELL_KEY, async () => {
        const r = await fetch(request.url, { credentials: 'same-origin', cache: 'no-store' });
        if (r && r.ok && r.headers.get('x-melaton-shell') === 'launch') await keepShell(LAUNCH_SHELL_KEY, r.clone());
      });
      if (kept) return kept;
    }
    let response = null;
    try {
      // a navigate-mode Request takes no init (TypeError), so as the browser asked
      response = await fetch(request);
    } catch (_err) {
      response = null;
    }
    if (response && response.ok && response.headers.get('x-melaton-shell') === 'launch') {
      // kept for the next start once its files are here (keepShell), never waited for
      const keeping = keepShell(LAUNCH_SHELL_KEY, response.clone()).catch(() => false);
      if (event && typeof event.waitUntil === 'function') event.waitUntil(keeping);
      return response;
    }
    try {
      const cache = await caches.open(LAUNCH_SHELL_CACHE);
      const shell = await cache.match(LAUNCH_SHELL_KEY);
      if (shell) return shell;
    } catch (_err) { /* no shell: what the network said */ }
    return response || Response.error();
  }
);

// Opening / or /app: only a page the Dreamscape server itself sent may load. A front proxy's
// error page (nginx 502 / 504 while the server is down or stalled) never carries the server's
// X-Melaton-Shell mark; then, or with no answer at all, the installed boot shell (/launch) takes
// over and waits for the server (Yukimi, Nov 13). On a device that keeps the boot shell, any other
// unmarked answer is the proxy's too: nginx answers 404 while the server is down (a DreamOS laptop
// booted into "404 Not Found nginx/1.16.1", Nov 19), so only a redirect (the gate's way to
// /launch) or a marked page passes there. A device with nothing kept still gets what the server
// sent (the site gate's cover for a stranger).
workbox.routing.registerRoute(
  ({ url, request }) => request.mode === 'navigate' && url.origin === self.location.origin
    && (url.pathname === '/' || url.pathname === '/app' || url.pathname === '/index.html'),
  async ({ request, event }) => {
    if (isAppWebView(request) && new URL(request.url).pathname === '/app') {
      const kept = await keptFirst(event, APP_SHELL_KEY, async () => {
        const r = await fetch(request.url, { credentials: 'same-origin', cache: 'no-store' });
        if (r && r.status === 200 && r.headers.get('x-melaton-shell') === 'app') await keepShell(APP_SHELL_KEY, r.clone());
      });
      if (kept) return kept;
    }
    let response = null;
    try {
      response = await fetch(request);
    } catch (_err) {
      response = null;
    }
    let unmarkedWithShell = false;
    if (response && response.type !== 'opaqueredirect' && !response.headers.get('x-melaton-shell')) {
      try { unmarkedWithShell = !!(await (await caches.open(LAUNCH_SHELL_CACHE)).match(LAUNCH_SHELL_KEY)); } catch (_err) { unmarkedWithShell = false; }
    }
    if (response && (response.status < 500 || response.headers.get('x-melaton-shell')) && !unmarkedWithShell) {
      // the app page itself, kept so an installed phone starts without the server (launch.html
      // startOfflineIfInstalled; Melaton Mobile as Android's launcher must always reach Today)
      if (response.status === 200 && response.headers.get('x-melaton-shell') === 'app') {
        // kept for the next start once its files are here (keepShell), never waited for
        const keeping = keepShell(APP_SHELL_KEY, response.clone()).catch(() => false);
        if (event && typeof event.waitUntil === 'function') event.waitUntil(keeping);
      }
      return response;
    }
    try {
      const cache = await caches.open(LAUNCH_SHELL_CACHE);
      const url = new URL(request.url);
      if (url.pathname === '/app') {
        const kept = await cache.match(APP_SHELL_KEY);
        if (kept) return kept;
      }
      if (await cache.match(LAUNCH_SHELL_KEY)) return Response.redirect('/launch', 302);
    } catch (_err) { /* no boot shell: what the network said */ }
    return response || Response.error();
  }
);

/** A real font (or kept tokenizer) from the server, not the site gate's cover page or a logon redirect. */
function isFontResponse(response, pathname = '') {
  if (!response || response.status !== 200 || response.redirected) return false;
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (KEPT_PROTECTED_FILES.has(pathname)) return !type.includes('text/html');
  return /^font\/|woff|truetype|opentype|application\/octet-stream|application\/x-font/.test(type);
}

async function fetchProtectedFont(pathname) {
  const response = await fetch(pathname, { credentials: 'same-origin', cache: 'no-store' });
  if (!isFontResponse(response, pathname)) return null;
  const cache = await caches.open(PROTECTED_FONT_CACHE);
  await cache.put(pathname, response.clone());
  return response;
}

/**
 * /protected/fonts/*: the kept copy, always, with no request behind it (Yukimi: fonts are cached,
 * full stop). The old once-per-worker-run refresh fetched every Vista font again each time Android
 * restarted the worker, i.e. on nearly every boot. Only a font the cache does not hold yet goes to
 * the network, and is kept when it is a font.
 */
async function handleProtectedFont(event, url) {
  const cache = await caches.open(PROTECTED_FONT_CACHE);
  const kept = await cache.match(url.pathname);
  if (kept) return kept;
  try {
    const fresh = await fetchProtectedFont(url.pathname);
    if (fresh) return fresh;
  } catch (_err) { /* down: what the network says below */ }
  return fetch(event.request);
}

/** CACHE_PROTECTED_FONTS from the page after logon: every Vista font its stylesheets name, kept. */
async function cacheProtectedFonts(paths) {
  const cache = await caches.open(PROTECTED_FONT_CACHE);
  let added = 0;
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith(PROTECTED_FONT_PREFIX) || p.includes('..')) continue;
    if (await cache.match(p)) continue;
    try { if (await fetchProtectedFont(p)) added += 1; } catch (_err) { /* the next boot tries again */ }
  }
  return added;
}

/** /logon-picture: network first; a good answer is kept, the kept copy answers when the server does not. */
// The program icon store's pictures (wmAndroidApps, #773: /static_images/wm-android/<package>-<hash>-<version>, made
// on the server after a deploy, so outside the install manifest, and with no file extension, so they went straight to
// the network): kept on first use, answered from the kept copy after - each name is one version's bytes. Start and
// Programs showed no icons when the phone booted with the server down (Yukimi, Nov 18 2026).
const PROGRAM_ICON_PREFIX = '/static_images/wm-android/';
async function handleProgramIcon(request, pathname) {
  const cache = await caches.open(LAUNCH_SHELL_CACHE);
  const kept = await cache.match(pathname);
  if (kept) return kept;
  const response = await fetch(request);
  if (response && response.ok && /^image\//i.test(response.headers.get('content-type') || '')) {
    try { await cache.put(pathname, response.clone()); } catch (_err) { /* the page still gets it */ }
  }
  return response;
}

async function handleLogonPicture(request) {
  const cache = await caches.open(LAUNCH_SHELL_CACHE);
  let response = null;
  try {
    response = await fetch(request, { cache: 'no-store' });
  } catch (_err) {
    response = null;
  }
  const isImage = response && response.ok && /^image\//i.test(response.headers.get('content-type') || '');
  if (isImage) {
    try { await cache.put('/logon-picture', response.clone()); } catch (_err) { /* the page still gets it */ }
    return response;
  }
  // 404: Use Vista Logon is off; the kept picture goes with it
  if (response && response.status === 404) {
    try { await cache.delete('/logon-picture'); } catch (_err) { /* nothing kept */ }
    return response;
  }
  const kept = await cache.match('/logon-picture');
  return kept || response || Response.error();
}

workbox.routing.registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && isKeptProtectedPath(url.pathname),
  ({ event, url }) => handleProtectedFont(event, url)
);

// Unified route handler for all requests
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Never handle /preset or /pending routes
    if (url.pathname.startsWith('/preset') || url.pathname.startsWith('/pending') || url.pathname.startsWith('/traces')) {
      return false;
    }
    // Installer pack is one download stream; auth-gated static files are fetched by the page so the session check runs.
    if (url.pathname === '/install/meletonfx.zip' || isAuthGatedStaticPath(url.pathname)) {
      return false;
    }
    if (isLogViewerApiRequest(url) || isGrimoireBrowserRequest(url) || isDesktopGuacRequest(url)) {
      return false;
    }
    // Setup's game media: read once and unpacked into this cache (launchGamesHost.js)
    if (url.pathname.startsWith(GAME_MEDIA_PREFIX)) {
      return false;
    }
    // Always handle requests that start with /
    return url.pathname.startsWith('/');
  },
  perfRoute(async (event) => {
    const { request, url } = event;

    maybeNotifyHttpTransmit(request);
    
    try {
      let response;
      await restoreWallpaperUrlSet();
      perfMark(event, 'w');

      // Handle internal routes (client-side only)
      if (url.pathname.startsWith('/internal/')) {
        response = await internalStrategy.handle(event);
      }
      // Handle route-based paths (/, /app) with custom caching
      else if (isGateSensitiveShellPath(url.pathname) || url.pathname === '/launch') {
        const routePath = url.pathname === '/index.html' ? '/' : url.pathname;
        const endpoint = routePath;
        try {
          response = await fetch(endpoint, {
            cache: 'no-store',
            credentials: 'include',
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
              'X-SW-Bypass-Cache': '1'
            }
          });
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
      // Workspace wallpapers: stored until the assignment changes, then dropped.
      else if (isWallpaperRequest(url)) {
        response = await handleWallpaperRequest(event);
      }
      // Explorer file previews: their own cache and limits (Yozora #643)
      else if (isExplorerPreviewPath(url.pathname)) {
        response = await explorerPreviewStrategy.handle(event);
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
      // Sidebar gadget packages: on demand, never through the shell's ignoreSearch scan
      else if (url.pathname.startsWith(GADGET_ASSET_PREFIX)) {
        response = await handleGadgetAsset(request, url.pathname);
      }
      // Melaton apps (modules/melatonApps/static.js, Yozora #638): the server's HTTP caching only
      else if (url.pathname.startsWith('/melaton-apps/')) {
        response = await fetch(request);
      }
      // radar frames and map tiles (modules/weatherService.js, #780): never in a cache of ours (a
      // radar frame lives ~2 h); the browser's HTTP cache keeps them for their max-age
      else if (url.pathname.startsWith('/weather/')) {
        response = await fetch(request);
      }
      // The Vista Welcome screen's picture (an uploaded one has no static path): the network copy,
      // kept so the logon / lock screens still show it while the server restarts (Yukimi, Nov 13)
      else if (url.pathname === '/logon-picture') {
        response = await handleLogonPicture(request);
      }
      // the program icon store's pictures: kept, so they show with the server down
      else if (url.pathname.startsWith(PROGRAM_ICON_PREFIX)) {
        response = await handleProgramIcon(request, url.pathname);
      }
      // Every cached file has an extension (the manifest's only extensionless entries are the
      // routes above): API calls, /status, /logon-picture and the like go straight to the
      // network instead of queueing three lookups on the static cache (Chrome runs a cache's
      // operations one at a time; 30-80 ms each in a boot burst on an 8500-row cache)
      else if (!hasFileExtension(url.pathname)) {
        perfMark(event, 'net');
        response = await fetch(request);
        notifyClientsOfNetworkActivity('receive', {
          url: request.url,
          method: request.method,
          status: response.status,
          fromNetwork: true,
          timestamp: Date.now()
        });
      }
      else if ((response = await hashedScriptRow(event, request, url))) {
        perfMark(event, 'hit');
      }
      else {
        const shellHit = await matchStaticShell(url.pathname);
        perfMark(event, shellHit ? 'hit' : 'miss');
        if (shellHit) {
          response = respondWithSavedAsset(request, shellHit, SHELL_ASSET_CACHE_CONTROL);
          if (url.pathname.startsWith(GAME_ASSET_PREFIX) && event.event) {
            event.event.waitUntil(revalidateGameAsset(url.pathname, shellHit));
          }
        } else {
          response = await createCacheBustingStrategy(staticStrategy, STATIC_CACHE, true).handle(event);
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
  })
);

// Handle SPA navigation routes - use static cache if available, otherwise redirect
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Never handle /preset or /pending routes
    if (url.pathname.startsWith('/preset') || url.pathname.startsWith('/pending') || url.pathname.startsWith('/traces')) {
      return false;
    }
    // Installer pack is one download stream; auth-gated static files are fetched by the page so the session check runs.
    if (url.pathname === '/install/meletonfx.zip' || isAuthGatedStaticPath(url.pathname)) {
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

// Chrome stops a worker whose event is still extended after about 5 minutes, and the page's requests
// in flight go with it. A long job (a download, the Wi-Fi prefetch) holds its message event this long
// at most and then goes on for as long as the worker is up anyway.
const EVENT_HOLD_MAX_MS = 4 * 60 * 1000;
function heldAtMost(promise, ms = EVENT_HOLD_MAX_MS) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(resolve, ms); })
  ]);
}

// Message handling for client communication
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_PERF_TRACE') {
        event.waitUntil(loadPerfTraceFlag());
    } else if (event.data && event.data.type === 'CACHE_PROTECTED_FONTS') {
        event.waitUntil(cacheProtectedFonts(Array.isArray(event.data.paths) ? event.data.paths : []));
    } else if (event.data && event.data.type === 'SW_MAINTENANCE') {
        event.waitUntil(runCacheMaintenance(event.data.force === true));
    } else if (event.data && event.data.type === 'CACHE_STATIC_FILES') {
        const files = event.data.files || [];
        // held by the message (up to EVENT_HOLD_MAX_MS): a worker with nothing else to answer was
        // stopped mid-download
        event.waitUntil(heldAtMost(perfSpan(`cacheStaticFiles ${files.length} files`, () => cacheStaticFiles(files, event.data.silent === true, event.data.requester || ''))));
    } else if (event.data && event.data.type === 'PHONE_PREFETCH') {
        // Melaton Mobile's page: the network it is on (assetPackages.js); Wi-Fi starts the prefetch
        notePhoneNetwork(event.data.network);
        event.waitUntil(heldAtMost(runPhonePrefetch()));
    } else if (event.data && event.data.type === 'NETWORK_ACTIVITY_OPT_OUT') {
        // a page that draws no network arrows (the phone shell) stops getting NETWORK_ACTIVITY
        event.waitUntil(setNetworkActivityOptOut(event.source, event.data.off !== false));
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
        event.waitUntil(cacheInternalData(event.data.url, event.data.data));
    } else if (event.data && event.data.type === 'STORAGE_REPORT') {
        // Disk Cleanup, Offline Files' Disk Usage and Sync Center (diskCleanup.js), only while one is open
        event.waitUntil(storageReport(event.data.requestId, event.source));
    } else if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(clearCacheGroup(event.data.target, event.data.requestId, event.source));
    } else if (event.data && event.data.type === 'GET_CACHE_STATUS') {
        event.waitUntil(getCacheStatus(event.data.requestId, event.source));
    } else if (event.data && event.data.type === 'GET_CACHED_FILES') {
        event.waitUntil(getCachedFiles(event.data.requestId, event.source));
    } else if (event.data && event.data.type === 'DELETE_AND_PRECACHE') {
        event.waitUntil(deleteAndPrecache(event.data.url, event.data.requestId));
    } else if (event.data && event.data.type === 'SYNC_WALLPAPER_URLS') {
        event.waitUntil(syncWallpaperUrls(event.data.urls, event.data.refresh, event.data.requestId, event.data.fetchUrls).catch((error) => {
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
        event.waitUntil(deleteFromCache(event.data.url, event.data.requestId));
    } else if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data && event.data.type === 'SHELL_COMMIT') {
        // the page proved the cache in sync: the held shells switch with their files (#924)
        const source = event.source;
        event.waitUntil(commitShells(event.data.refresh === true).then((result) => {
            if (source && event.data.requestId) source.postMessage({ type: 'SHELL_COMMITTED', requestId: event.data.requestId, app: result.app, launch: result.launch });
        }));
    } else if (event.data && event.data.type === 'GET_DOWNLOAD_STATE') {
        getDownloadState(event.data.requestId, event.source);
    } else if (event.data && event.data.type === 'CANCEL_DOWNLOAD') {
        cancelDownload();
    } else if (event.data && event.data.type === 'GET_SW_CONFIG') {
        getSwConfig(event.data.requestId, event.source);
    } else if (event.data && event.data.type === 'ping') {
        // Respond to health check ping
        event.ports && event.ports[0] && event.ports[0].postMessage({
            type: 'pong',
            timestamp: Date.now()
        });
        event.waitUntil(answerPing(event.source));
    } else if (event.data && event.data.type === 'SYNC_IMAGE_CACHE_RULES') {
        event.waitUntil(syncImageCacheRules(event.data));
    }
});

/**
 * The gallery's pins (galleryView.js syncServiceWorkerImageCacheRules): favourites and the first
 * 500 previews, sent after every gallery reload, reroll result and pin toggle. The same lists again
 * change nothing (no write, no policy run). New lists go out with the next metadata batch, which
 * the message's event waits for: each sync used to rewrite the whole blob at once (#890).
 */
async function syncImageCacheRules(data) {
    const favoriteUrls = Array.isArray(data.favoriteUrls) ? data.favoriteUrls.map(getCanonicalUrl) : [];
    const lockedPreviewUrls = Array.isArray(data.lockedPreviewUrls) ? data.lockedPreviewUrls.map(getCanonicalUrl) : [];
    const policy = data.policy || {};
    const policyBefore = `${IMAGE_CACHE_POLICY.maxEntries}/${IMAGE_CACHE_POLICY.maxSizeBytes}/${IMAGE_CACHE_POLICY.maxIdleMs}`;
    if (Number.isFinite(policy.maxEntries) && policy.maxEntries > 0) {
      IMAGE_CACHE_POLICY.maxEntries = Math.floor(policy.maxEntries);
    }
    if (Number.isFinite(policy.maxSizeBytes) && policy.maxSizeBytes > 0) {
      IMAGE_CACHE_POLICY.maxSizeBytes = Math.floor(policy.maxSizeBytes);
    }
    if (Number.isFinite(policy.maxIdleMs) && policy.maxIdleMs > 0) {
      IMAGE_CACHE_POLICY.maxIdleMs = Math.floor(policy.maxIdleMs);
    }
    const policyChanged = policyBefore !== `${IMAGE_CACHE_POLICY.maxEntries}/${IMAGE_CACHE_POLICY.maxSizeBytes}/${IMAGE_CACHE_POLICY.maxIdleMs}`;
    const metadata = await readImageMetadata();
    const favorites = Array.from(new Set(favoriteUrls));
    const locked = Array.from(new Set(lockedPreviewUrls.slice(0, IMAGE_CACHE_POLICY.lockedPreviewCount)));
    const rulesChanged = !sameUrlSet(metadata.rules.favoriteUrls, favorites)
        || !sameUrlSet(metadata.rules.lockedPreviewUrls, locked);
    if (!rulesChanged && !policyChanged) return;
    if (rulesChanged) {
        // new arrays (never edited in place): pinnedImageSet keys its Set on their identity
        metadata.rules.favoriteUrls = favorites;
        metadata.rules.lockedPreviewUrls = locked;
        await writeImageMetadata(metadata);
    }
    scheduleImageCachePolicyEnforcement();
    if (rulesChanged) await imageMetadataSettled();
}

/** Two lists without repeats hold the same URLs (in any order). */
function sameUrlSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    if (a.every((url, i) => url === b[i])) return true;
    const have = new Set(a);
    return b.every((url) => have.has(url));
}

/**
 * The health ping's answer (serviceWorkerManager sendHealthCheckPing: once a minute from each visible
 * page; its tray reads the time of the last answer). The page that asked gets it, and so does every
 * hidden window: those do not ping while hidden, and with no answer for 95 s a window shown again
 * showed 'Service Worker: Not Responding' until its next ping, up to a minute later. Every other
 * visible window pings on its own: the broadcast woke each of them once per page per minute for
 * nothing. No source: every window, as before.
 */
function answerPing(source) {
    const message = { type: 'ping', timestamp: Date.now() };
    if (!source || typeof source.postMessage !== 'function') {
        replyToSource(null, message);
        return Promise.resolve();
    }
    try { source.postMessage(message); } catch (_) { /* gone */ }
    return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
            if (client.id !== source.id && client.visibilityState === 'hidden') {
                try { client.postMessage(message); } catch (_) { /* gone */ }
            }
        });
    }).catch(() => {});
}

/**
 * A reply goes to the page that asked (the message's source): a broadcast woke every other window
 * (a phone's and its DeX window's) for an answer meant for one. No source: every window, as before.
 */
function replyToSource(source, message) {
    if (source && typeof source.postMessage === 'function') {
        try {
            source.postMessage(message);
            return;
        } catch (_) { /* gone: every window */ }
    }
    self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage(message));
    });
}

// Get list of cached files with their hashes
async function getCachedFiles(requestId, source = null) {
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
        
        replyToSource(source, {
            type: 'CACHED_FILES_LIST',
            requestId: requestId,
            files: cachedFiles
        });
    } catch (error) {
        console.error('Error getting cached files:', error);
        replyToSource(source, {
            type: 'CACHED_FILES_ERROR',
            requestId: requestId,
            error: error.message
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

// Get current download state (to the page that asked: it carries the whole file list)
function getDownloadState(requestId, source = null) {
    replyToSource(source, {
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
}

// Cancel current download
function cancelDownload() {
    if (downloadState.isDownloading && downloadState.abortController) {
        downloadState.abortController.abort();
        downloadState.isDownloading = false;
        downloadState.abortController = null;
        dropStaticCacheProgress();
        // the loop returns on the abort without stopping it: a 2 s timer that ran until the next download
        stopStallDetection();
        
        // Notify clients of cancellation (the counts read now: the state is reset before matchAll answers)
        const completedNow = downloadState.completed;
        const totalNow = downloadState.total;
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_CANCELLED',
                    completed: completedNow,
                    total: totalNow
                });
            });
        });
        
        // Reset state
        downloadState = freshDownloadState();
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
  return perfSpan('purgeStaticCacheEntries', () => purgeStaticCacheEntriesNow(cache, urlPath));
}

async function purgeStaticCacheEntriesNow(cache, urlPath) {
  let target;
  try {
    target = new URL(urlPath, self.location.origin);
  } catch (error) {
    return;
  }
  // Rows are keyed by the bare path; ignoreVary takes every Vary variant of it. Listing the
  // whole cache here cost about 5 s per downloaded file on an 8500-row cache (Edge, Oct 24).
  // Query-keyed siblings, if any ever appear, go in runCacheMaintenance.
  target.search = '';
  target.hash = '';
  await cache.delete(target.href, { ignoreVary: true });
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
// A download's per-file progress goes out at most every STATIC_PROGRESS_POST_MS, the last count of a
// burst trailing (#890). One post per file was a clients.matchAll() and a message to every window per
// file, and each page re-drew its bar and logged a line per file. The pages read the counts in a
// message, never the number of messages (updateEngine.js download, serviceWorkerManager.js, login.js).
const STATIC_PROGRESS_POST_MS = 200;
let staticProgressLatest = null;
let staticProgressTimer = null;
let staticProgressPostedAt = 0;

function postStaticCacheProgress(completed, total, currentFile) {
    staticProgressLatest = { completed, total, currentFile };
    if (staticProgressTimer) return;
    const wait = staticProgressPostedAt + STATIC_PROGRESS_POST_MS - Date.now();
    if (wait <= 0) {
        sendStaticCacheProgress();
        return;
    }
    staticProgressTimer = setTimeout(sendStaticCacheProgress, wait);
}

function sendStaticCacheProgress() {
    staticProgressTimer = null;
    const progress = staticProgressLatest;
    staticProgressLatest = null;
    if (!progress) return;
    staticProgressPostedAt = Date.now();
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'STATIC_CACHE_PROGRESS',
                completed: progress.completed,
                total: progress.total,
                currentFile: progress.currentFile
            });
        });
    });
}

/** The download ended (complete, cancelled, failed): a count still waiting would land after the end. */
function dropStaticCacheProgress() {
    clearTimeout(staticProgressTimer);
    staticProgressTimer = null;
    staticProgressLatest = null;
}

function noteInstallFileDone(fileUrl, absentReason) {
    if (absentReason) {
        downloadState.absentFiles.push({ url: fileUrl, reason: absentReason });
    }
    downloadState.completed++;
    downloadState.lastProgressTime = Date.now();
    postStaticCacheProgress(downloadState.completed, downloadState.total, fileUrl);
}

/**
 * A request while a download runs (#951): its files join the running one instead of being dropped - a new url is
 * queued, a queued one takes the newer hash, a finished one fetched at another hash is fetched again. One completion
 * then covers every set, so a later notify never needs a second restart. True when it merged.
 */
function mergeIntoRunningDownload(files, requester) {
    if (!downloadState.isDownloading || !Array.isArray(downloadState.queue)) return false;
    if (requester) downloadState.requesters.add(String(requester));
    let added = 0;
    for (const file of files) {
        if (!file || !file.url) continue;
        const queued = downloadState.queue.find((f) => f.url === file.url);
        if (queued) { queued.hash = file.hash; continue; }
        if (downloadState.doneHash.get(file.url) === file.hash) continue;
        downloadState.queue.push(Object.assign({}, file));
        downloadState.files.push(file);
        added++;
    }
    downloadState.total += added;
    if (added) postStaticCacheProgress(downloadState.completed, downloadState.total, downloadState.currentFile);
    return true;
}

async function cacheStaticFiles(files, silent = false, requester = '') {
    // Check if already downloading: the new set joins it (#951)
    if (downloadState.isDownloading && mergeIntoRunningDownload(files, requester)) {
        if (silent !== true) downloadState.silent = false;
    }
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
        downloadState.files = files.slice();
        downloadState.queue = files.map((f) => Object.assign({}, f));
        downloadState.doneHash = new Map();
        downloadState.mismatched = [];
        downloadState.requesters = new Set(requester ? [String(requester)] : []);
        // kept here too: a cancel nulls downloadState.abortController while caches.open is awaited
        const downloadAbort = new AbortController();
        downloadState.abortController = downloadAbort;
        downloadState.silent = silent === true;
        downloadState.updatedFiles = [];
        downloadState.absentFiles = [];
        
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
        const signal = downloadAbort.signal;
        
        // Cache files one by one to track progress; the queue grows when a later request merges in (#951)
        while (downloadState.queue.length) {
            const file = downloadState.queue.shift();
            // Check if download was cancelled
            if (signal.aborted) {
                console.log('Download cancelled by user');
                return;
            }
            
            downloadState.currentFile = file.url;

            // Do not store auth-gated files. A 200 cached here would be served after logout.
            if (isAuthGatedManifestFile(file)) {
                noteInstallFileDone(file.url, 'auth');
                continue;
            }
            
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
                // Per-file timeout so a missing or slow file cannot stall the install.
                const fileAbort = new AbortController();
                const timeoutId = setTimeout(() => fileAbort.abort(), STATIC_FILE_FETCH_TIMEOUT_MS);
                const onParentAbort = () => fileAbort.abort();
                if (signal) {
                    if (signal.aborted) fileAbort.abort();
                    else signal.addEventListener('abort', onParentAbort);
                }
                let response;
                try {
                    response = await fetch(file.url, {
                      cache: 'no-store',
                      signal: fileAbort.signal,
                      headers: fetchHeaders
                    });
                } catch (error) {
                    if (signal && signal.aborted) {
                        console.log('Download aborted');
                        return;
                    }
                    if (error && error.name === 'AbortError') {
                        console.warn(`Timed out fetching ${file.url} after ${STATIC_FILE_FETCH_TIMEOUT_MS}ms`);
                        noteInstallFileDone(file.url, null);
                    } else {
                        console.error(`Failed to cache ${file.url}:`, error);
                        noteInstallFileDone(file.url, null);
                    }
                    continue;
                } finally {
                    clearTimeout(timeoutId);
                    if (signal) signal.removeEventListener('abort', onParentAbort);
                }
                
                // Update progress time after fetch completes (even if it fails)
                downloadState.lastProgressTime = Date.now();
                
                if (response.status === 404) {
                    console.warn(`Missing ${file.url}: HTTP 404 (not retried)`);
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'STATIC_CACHE_ERROR',
                                file: file.url,
                                error: 'HTTP 404: Not Found'
                            });
                        });
                    });
                    noteInstallFileDone(file.url, '404');
                    continue;
                }

                if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)) {
                    try {
                        const body = await response.arrayBuffer();
                        // Stored under the hash of what arrived (NON_BODY_HASH_PATHS); a body that
                        // is not the manifest's stays a mismatch, so the next check fetches it again
                        let storeHash = file.hash;
                        if (hasBodyHash(file.url)) {
                            storeHash = await sha256Hex(body);
                            if (storeHash !== file.hash) {
                                console.warn(`${file.url}: the server sent ${storeHash.slice(0, 12)}, not the manifest's ${String(file.hash).slice(0, 12)}`);
                            }
                        }
                        const cacheKey = new Request(file.url);
                        // The new bytes replace the row in one write (#924). The purge first is only for
                        // a row an old strategy stored with Vary, which put() would leave beside the new
                        // one: every row this download writes has none, so nothing is deleted before the
                        // put and a worker killed here (a power-off mid-install) still leaves a copy.
                        const before = await cache.match(cacheKey, { ignoreVary: true });
                        if (before && before.headers.get('vary')) await purgeStaticCacheEntries(cache, file.url);
                        await cache.put(cacheKey, staticCacheResponseWithHash(body, response, storeHash));

                        const cachedResponse = await cache.match(cacheKey, { ignoreVary: true });
                        const newHash = cachedResponse && cachedResponse.headers.get('x-file-hash');
                        downloadState.doneHash.set(file.url, newHash || '');
                        if (newHash !== file.hash) {
                            console.warn(`Hash mismatch! Expected: ${file.hash}, Got: ${newHash}`);
                            // not an update the page can restart into: reported apart, never as updated (#951)
                            downloadState.mismatched.push({ url: file.url, hash: file.hash, got: newHash || '' });
                        } else {
                            downloadState.updatedFiles = downloadState.updatedFiles.filter((f) => f.url !== file.url);
                            downloadState.updatedFiles.push({ url: file.url, hash: file.hash });
                        }

                        downloadState.completed++;
                        downloadState.lastProgressTime = Date.now();
                        postStaticCacheProgress(downloadState.completed, downloadState.total, file.url);
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
        dropStaticCacheProgress();
        
        // Capture values before resetting state (defensive against race conditions)
        const completedCount = downloadState.completed > 0 ? downloadState.completed : files.length;
        const totalCount = downloadState.total > 0 ? downloadState.total : files.length;
        const updatedFiles = downloadState.updatedFiles.slice();
        const mismatched = (downloadState.mismatched || []).slice();
        const requesters = Array.from(downloadState.requesters || []);
        const allFiles = (downloadState.files || files).slice();
        const wasSilent = downloadState.silent === true;
        // when it began: a page that loaded after that (a restart that did not wait for the download, #945)
        // knows it is not a new update for it - its own boot check judged the cache
        const startedAt = downloadState.startTime || 0;
        const absent = (downloadState.absentFiles || [])
            .filter((entry) => entry.reason === '404')
            .map((entry) => entry.url);

        // Notify client of completion
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'STATIC_CACHE_COMPLETE',
                    files: allFiles,
                    completed: completedCount,
                    total: totalCount,
                    updatedFiles: updatedFiles,
                    silent: wasSilent,
                    absent: absent,
                    startedAt: startedAt,
                    // #951: the pages that asked for or joined this download, and the files whose bytes were not the
                    // manifest's (not updates); 'v' tells a page this worker reports updatedFiles exactly
                    requesters: requesters,
                    mismatched: mismatched,
                    v: 2
                });
            });
        });

        // Reset download state
        downloadState = freshDownloadState();
    } catch (error) {
        // Check if error is due to abort
        if (error.name === 'AbortError') {
            console.log('Download aborted');
            return;
        }
        
        console.error('Error caching static files:', error);
        
        // Stop stall detection
        stopStallDetection();
        dropStaticCacheProgress();
        
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
        downloadState = freshDownloadState();
    }
}

function getSwConfig(requestId, source = null) {
    const payload = {
        cssOnlyAutoApply: CSS_ONLY_AUTO_APPLY === true,
        epoch: SW_SCRIPT_EPOCH
    };
    if (!requestId) {
        return payload;
    }
    replyToSource(source, {
        type: 'SW_CONFIG',
        requestId,
        cssOnlyAutoApply: payload.cssOnlyAutoApply,
        epoch: payload.epoch
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
async function getCacheStatus(requestId, source = null) {
  try {
    const staticCache = await caches.open(STATIC_CACHE);
    const dynamicCache = await caches.open(DYNAMIC_CACHE);
    const internalCache = await caches.open(INTERNAL_CACHE);
    
    const staticKeys = await staticCache.keys();
    const dynamicKeys = await dynamicCache.keys();
    const internalKeys = await internalCache.keys();
    // the image count from its metadata: listing up to 20,000 previews can fail outright
    // ("Operation too large", enforceImageCachePolicyNow), and then no answer came at all
    const metadata = await readImageMetadata();
    const images = Object.keys(metadata.entries || {}).length;
    
    replyToSource(source, {
      type: 'CACHE_STATUS',
      requestId: requestId,
      static: staticKeys.length,
      dynamic: dynamicKeys.length,
      internal: internalKeys.length,
      images
    });
  } catch (error) {
    console.error('Error getting cache status:', error);
  }
}

// ---------- storage report and cleanup (#945: Disk Cleanup / Offline Files / Sync Center, diskCleanup.js) ----------

/** One cache's rows and bytes: Content-Length where the row has it, else the body's size. A large cache is sampled. */
async function measureCache(name) {
  if (!(await caches.has(name))) return { count: 0, bytes: 0 };
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const SAMPLE = 600;
  const list = keys.length > SAMPLE ? keys.filter((_, i) => i % Math.ceil(keys.length / SAMPLE) === 0) : keys;
  let bytes = 0;
  for (let i = 0; i < list.length; i += 16) {
    await Promise.all(list.slice(i, i + 16).map(async (key) => {
      try {
        const r = await cache.match(key);
        if (!r) return;
        const len = Number(r.headers.get('content-length'));
        bytes += len > 0 ? len : (await r.clone().blob()).size;
      } catch (_err) { /* a row that went meanwhile */ }
    }));
  }
  if (list.length && list.length < keys.length) bytes = Math.round(bytes * (keys.length / list.length));
  return { count: keys.length, bytes, sampled: list.length < keys.length };
}

async function storageReport(requestId, source) {
  const out = { type: 'STORAGE_REPORT', requestId, caches: {} };
  try {
    // the static cache is Melaton's installed files (thousands of rows): counted, its size is the page's sum
    if (await caches.has(STATIC_CACHE)) out.caches.static = { count: (await (await caches.open(STATIC_CACHE)).keys()).length, bytes: null };
    // the picture cache: its own metadata's sizes (listing 20,000 previews can fail, getCacheStatus)
    const metadata = await readImageMetadata();
    const entries = Object.values(metadata.entries || {});
    out.caches.images = {
      count: entries.length,
      bytes: entries.reduce((n, e) => n + (Number(e && e.size) || 0), 0),
      pinned: entries.filter((e) => e && e.pinned).length
    };
    const names = { dynamic: DYNAMIC_CACHE, internal: INTERNAL_CACHE, wallpapers: WALLPAPER_CACHE, fonts: PROTECTED_FONT_CACHE,
      thumbnails: EXPLORER_PREVIEW_CACHE, scriptCode: SCRIPT_CODE_CACHE, launchShell: LAUNCH_SHELL_CACHE };
    for (const [key, name] of Object.entries(names)) out.caches[key] = await measureCache(name);
  } catch (error) {
    out.error = String((error && error.message) || error);
  }
  replyToSource(source, out);
}

/**
 * Disk Cleanup's deletions, only what comes back on its own: 'temporary' (the dynamic cache: responses kept for
 * quick viewing), 'thumbnails' (Explorer's previews) and 'pictures' (the gallery pictures kept for offline viewing,
 * except the pinned ones). Melaton's own files (static, fonts, script code, the launch shell) are never deleted here.
 */
async function clearCacheGroup(target, requestId, source) {
  const reply = { type: 'CLEAR_CACHE_DONE', requestId, target, removed: 0 };
  try {
    if (target === 'temporary' || target === 'thumbnails') {
      const name = target === 'temporary' ? DYNAMIC_CACHE : EXPLORER_PREVIEW_CACHE;
      if (await caches.has(name)) {
        reply.removed = (await (await caches.open(name)).keys()).length;
        await caches.delete(name);
      }
    } else if (target === 'pictures') {
      const metadata = await readImageMetadata();
      const urls = Object.keys(metadata.entries || {}).filter((url) => !(metadata.entries[url] && metadata.entries[url].pinned));
      const cache = await caches.open(IMAGE_CACHE);
      for (let i = 0; i < urls.length; i += 32) {
        await Promise.all(urls.slice(i, i + 32).map((url) => cache.delete(url, { ignoreVary: true }).catch(() => false)));
      }
      await deleteImageMetadata(urls);
      reply.removed = urls.length;
    } else {
      reply.error = 'not a cleanable group';
    }
  } catch (error) {
    reply.error = String((error && error.message) || error);
  }
  replyToSource(source, reply);
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
  const targetUrl = absoluteAssetUrl(urlWithoutQuery);

  // Every one of these caches keys its rows by the bare absolute URL (the strategies strip the
  // query, CACHE_STATIC_FILES / deleteAndPrecache store the bare path, WALLPAPER_CACHE and the image
  // cache the canonical URL), so one exact delete per cache takes the row and its Vary variants.
  // Listing each cache instead read ~10,000 static rows per call, and a 20,000-row image cache
  // cannot be listed at all ("Operation too large"), which failed the whole refresh.
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    if (await cache.delete(targetUrl, { ignoreVary: true })) {
      removedUrls.push(targetUrl);
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
    
    // cache: 'no-store' already skips the browser cache. A ?t= stamp broke URLs that
    // carry a query of their own.
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    if (response.ok && response.status >= 200 && response.status < 300 && shouldCacheResponse(response)
        && (targetCacheName !== STATIC_CACHE || await bodyMatchesClaimedHash(response, urlWithoutQuery))) {
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

// ---------- cache upkeep (off the activation path) ----------
// The page posts SW_MAINTENANCE once its boot is over (serviceWorkerManager.js
// _scheduleWorkerMaintenance); it runs at most once a day per client, under that message's
// waitUntil, so fetch events keep flowing meanwhile.
const MAINTENANCE_KEY = '/internal/sw-maintenance-v1';
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Fetched on demand and never in the manifest: kept by the leftover prune
const ON_DEMAND_STATIC_PREFIXES = () => [GAME_ASSET_PREFIX, GADGET_ASSET_PREFIX, '/data/vista-gadgets.json'];
// Melaton Mobile's install leaves these folders out (assetPackages.js phoneOptional 'wifi': the
// Desktop Background photos and the Sidebar's art; scripts/test-phone-optional-assets.js keeps the
// two lists in step). A phone fetches one when something shows it and keeps it, and the Wi-Fi
// prefetch below fills in the rest.
const PHONE_WIFI_PREFIXES = ['/static_images/wallpapers/photos/', '/static_images/vista-sidebar/'];
// The manifest digest of the last full pass and when it ran: the same list again prunes nothing new
const TIDY_MARK_KEY = '/internal/sw-tidy-v1';
const TIDY_RELIST_MS = 7 * 24 * 60 * 60 * 1000;
let maintenanceRun = null;

function decodedPath(pathname) {
  try { return decodeURI(pathname); } catch (_) { return pathname; }
}

// The page's copy of the manifest it last found the cache in sync with (updateEngine.js and
// serviceWorkerManager.js: IndexedDB melatonCacheVerified, store 'v', key 'manifest', the URLs and
// hashes packed under that digest). Opened with the pages' own version and store, closed at once.
const PAGE_MANIFEST_DB = 'melatonCacheVerified';
function readPageManifestSnapshot() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    let opened;
    try {
      opened = indexedDB.open(PAGE_MANIFEST_DB, 1);
    } catch (_) {
      resolve(null);
      return;
    }
    opened.onupgradeneeded = () => { try { opened.result.createObjectStore('v'); } catch (_) { /* there */ } };
    opened.onerror = () => resolve(null);
    opened.onblocked = () => resolve(null);
    opened.onsuccess = () => {
      const db = opened.result;
      const done = (value) => { try { db.close(); } catch (_) { /* closed */ } resolve(value); };
      try {
        const get = db.transaction('v').objectStore('v').get('manifest');
        get.onsuccess = () => done(get.result || null);
        get.onerror = () => done(null);
      } catch (_) {
        done(null);
      }
    };
  });
}

/**
 * This client's manifest: { paths, digest } or null. It sends the digest of the list the page keeps,
 * so an unchanged manifest is a bodyless 304 and that list is used; without one it was the whole
 * manifest (~130 KB gzip) every day.
 */
async function fetchManifestPaths() {
  let known = null;
  try {
    const packed = await readPageManifestSnapshot();
    if (packed && packed.hash && typeof packed.urls === 'string' && packed.n > 0) known = packed;
  } catch (_) {
    known = null;
  }
  try {
    const headers = { 'X-Service-Worker-Version': '2.0', 'X-Requested-With': 'ServiceWorker' };
    if (known) headers['X-Manifest-Hash'] = known.hash;
    const response = await fetch('/', { method: 'OPTIONS', cache: 'no-store', headers });
    const digest = (response.headers && typeof response.headers.get === 'function' && response.headers.get('X-Manifest-Hash')) || '';
    let urls = null;
    if (response.status === 304 && known) {
      urls = known.urls.split('\n');
      if (urls.length !== known.n) return null;
    } else if (response.ok) {
      const files = await response.json();
      if (!Array.isArray(files)) return null;
      urls = files.map((file) => String((file && file.url) || ''));
    } else {
      return null;
    }
    if (urls.length < 100) return null;
    return { paths: new Set(urls.map((url) => decodedPath(url.split('?')[0]))), digest };
  } catch (_) {
    return null;
  }
}

async function readTidyMark(internal) {
  try {
    const hit = await internal.match(TIDY_MARK_KEY);
    return hit ? await hit.json() : null;
  } catch (_) {
    return null;
  }
}

/**
 * One listing of the static cache: Setup's game media zips (about 27 MB a client, unpacked and
 * never read again), unhashed rows sharing a path with a hashed one (a query or Vary sibling),
 * and rows the manifest no longer lists (on-demand game and gadget files stay, and on a phone the
 * desktop pictures it fetched on demand). The manifest the last pass ran on, again, within a week:
 * no listing (nothing can have left it), unless forced (a package was removed).
 */
async function tidyStaticRows(force = false) {
  const manifest = await fetchManifestPaths();
  const internal = await caches.open(INTERNAL_CACHE);
  if (!force && manifest && manifest.digest) {
    const mark = await readTidyMark(internal);
    if (mark && mark.digest === manifest.digest && Date.now() - (Number(mark.at) || 0) < TIDY_RELIST_MS) {
      perfLog(`maintenance static rows: manifest as at the last pass, not listed`);
      return;
    }
  }
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  const onDemand = ON_DEMAND_STATIC_PREFIXES();
  // a manifest with none of a folder's files is a phone's (assetPackages.js phoneOptional): the copies
  // it fetched stay. A desktop's lists them, so a picture the server dropped still goes there.
  const listed = manifest ? [...manifest.paths] : [];
  const phoneKept = manifest ? PHONE_WIFI_PREFIXES.filter((prefix) => !listed.some((p) => p.startsWith(prefix))) : [];
  const byPath = new Map();
  const drop = [];
  for (const request of keys) {
    let pathname = '';
    try {
      pathname = new URL(request.url).pathname;
    } catch (_) {
      continue;
    }
    if (pathname.startsWith(GAME_MEDIA_PREFIX)) {
      drop.push(request);
      continue;
    }
    if (manifest && !manifest.paths.has(decodedPath(pathname))
        && !onDemand.some((prefix) => pathname.startsWith(prefix))
        && !phoneKept.some((prefix) => pathname.startsWith(prefix))) {
      drop.push(request);
      continue;
    }
    const list = byPath.get(pathname);
    if (list) list.push(request);
    else byPath.set(pathname, [request]);
  }
  for (const list of byPath.values()) {
    if (list.length < 2) continue;
    const rows = [];
    for (const request of list) {
      const response = await cache.match(request, { ignoreVary: true });
      rows.push({ request, hash: (response && response.headers.get('x-file-hash')) || '' });
    }
    if (!rows.some((row) => row.hash)) continue;
    rows.filter((row) => !row.hash).forEach((row) => drop.push(row.request));
  }
  for (const request of drop) {
    await cache.delete(request, { ignoreVary: true });
  }
  if (manifest && manifest.digest) {
    await internal.put(TIDY_MARK_KEY, new Response(JSON.stringify({ digest: manifest.digest, at: Date.now() }), {
      headers: { 'content-type': 'application/json' }
    }));
  }
  perfLog(`maintenance static rows=${keys.length} dropped=${drop.length} manifest=${manifest ? manifest.paths.size : 'none'}`);
}

function runCacheMaintenance(force = false) {
  if (maintenanceRun) return maintenanceRun;
  maintenanceRun = (async () => {
    const internal = await caches.open(INTERNAL_CACHE);
    const mark = await internal.match(MAINTENANCE_KEY);
    const last = mark ? Number(await mark.text()) || 0 : 0;
    if (!force && Date.now() - last < MAINTENANCE_INTERVAL_MS) return;
    await perfSpan('maintenance:dropMislabelledStaticRows', dropMislabelledStaticRows);
    await perfSpan('maintenance:tidyStaticRows', () => tidyStaticRows(force));
    // the same one-at-a-time slot as the hit-driven runs
    if (imagePolicyRun) await imagePolicyRun;
    imagePolicyRun = perfSpan('maintenance:imagePolicy', () => enforceImageCachePolicyNow({ reconcile: true }));
    try { await imagePolicyRun; } finally { imagePolicyRun = null; imagePolicyLastEnforcedAt = Date.now(); }
    // the reconcile's changes are written under this message's waitUntil
    await flushImageMetadataNow();
    await internal.put(MAINTENANCE_KEY, new Response(String(Date.now())));
  })().catch((error) => {
    console.warn('[sw] cache maintenance failed:', error);
    perfLog(`maintenance failed ${error && (error.stack || error.message || error)}`.slice(0, 600));
  }).finally(() => {
    maintenanceRun = null;
  });
  return maintenanceRun;
}

// ---------- Melaton Mobile's on-demand files (#890) ----------
// A phone's manifest leaves out the Desktop Background photos and the Sidebar's art (179 MB + 5 MB,
// assetPackages.js phoneOptional 'wifi'). A page that shows one gets it through the static strategy,
// which keeps it (x-file-hash), and tidyStaticRows leaves it be. The rest come here, in the
// background and only while the phone is on Wi-Fi (Yukimi, Nov 17): Melaton Mobile's page posts
// PHONE_PREFETCH with the network it is on once its boot is over and on every change; on Wi-Fi a pass
// fetches the missing or changed files one at a time at low priority and stops as soon as the network
// is not Wi-Fi or an update download starts. A pass that found nothing missing is not repeated for
// the same list within a week. The workspace's own wallpaper does not wait for any of this: the page
// fetches it into WALLPAPER_CACHE at every boot, on any network (syncWallpaperUrls), so Today and the
// DeX desktop always have it, offline too.
const PHONE_OPTIONAL_LIST_KEY = '/internal/sw-phone-optional-v1';
const PHONE_PREFETCH_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
// between two files: the page's own requests and the worker's thread come first
const PHONE_PREFETCH_GAP_MS = 50;
let phoneNetworkHint = 'unknown';
let phonePrefetchRun = null;

function notePhoneNetwork(network) {
  phoneNetworkHint = network === 'unmetered' || network === 'metered' ? network : 'unknown';
}

/** 'unmetered' (Wi-Fi, Ethernet), 'metered' or 'unknown': the worker's own view first, else the page's. */
function workerNetwork() {
  const c = self.navigator && self.navigator.connection;
  if (c) {
    if (c.saveData) return 'metered';
    const t = typeof c.type === 'string' ? c.type : '';
    if (t === 'wifi' || t === 'ethernet') return 'unmetered';
    if (t === 'cellular' || t === 'bluetooth' || t === 'wimax' || t === 'none') return 'metered';
  }
  return phoneNetworkHint;
}

function pathOfUrl(url) {
  try {
    return new URL(url, self.location.origin).pathname;
  } catch (_) {
    return String(url || '').split('?')[0];
  }
}

function isPhoneWifiPath(pathname) {
  return PHONE_WIFI_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function readPhoneOptionalRecord(internal) {
  try {
    const hit = await internal.match(PHONE_OPTIONAL_LIST_KEY);
    const record = hit ? await hit.json() : null;
    return record && record.hash && Array.isArray(record.rows) ? record : null;
  } catch (_) {
    return null;
  }
}

function writePhoneOptionalRecord(internal, record) {
  return internal.put(PHONE_OPTIONAL_LIST_KEY, new Response(JSON.stringify(record), {
    headers: { 'content-type': 'application/json' }
  })).catch(() => {});
}

/**
 * The 'wifi' files the server has now, from the core list (X-Melaton-Packages: none, every client's
 * files and no Melaton Mobile art; the phone's own list leaves them out): { record, fresh } or null.
 * The list kept from last time is sent by its digest, so an unchanged one is a bodyless 304.
 */
async function phoneOptionalList(internal) {
  const kept = await readPhoneOptionalRecord(internal);
  // X-Melaton-Subset (#890): a server that knows it answers only the 'wifi' rows, with a digest over
  // those rows, so a code update leaves it a 304; one that does not ignores it and sends the core list
  const headers = { 'X-Service-Worker-Version': '2.0', 'X-Requested-With': 'ServiceWorker', 'X-Melaton-Packages': 'none', 'X-Melaton-Subset': 'phone-wifi' };
  if (kept) headers['X-Manifest-Hash'] = kept.hash;
  const response = await fetch('/', { method: 'OPTIONS', cache: 'no-store', headers });
  if (response.status === 304 && kept) return { record: kept, fresh: false };
  if (!response.ok) return null;
  const files = await response.json();
  if (!Array.isArray(files)) return null;
  const hash = response.headers.get('X-Manifest-Hash') || '';
  const rows = files
    .filter((file) => file && file.url && file.hash && isPhoneWifiPath(pathOfUrl(file.url)))
    .map((file) => ({ url: String(file.url), hash: String(file.hash) }));
  // the core digest moves with every code update: when the 'wifi' rows themselves are the kept ones,
  // the kept pass result stands (no 1,480-row cache walk after each update), under the new digest
  const same = !!kept && sameOptionalRows(kept.rows, rows);
  const record = same
    ? { hash, rows, complete: kept.complete === true, checkedAt: Number(kept.checkedAt) || 0 }
    : { hash, rows, complete: false, checkedAt: 0 };
  if (hash) await writePhoneOptionalRecord(internal, record);
  return { record, fresh: !same };
}

function sameOptionalRows(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const byUrl = new Map();
  for (const row of a) if (row && row.url) byUrl.set(String(row.url), String(row.hash));
  if (byUrl.size !== b.length) return false;
  return b.every((row) => byUrl.get(row.url) === row.hash);
}

async function phonePrefetchPass() {
  const internal = await caches.open(INTERNAL_CACHE);
  const list = await phoneOptionalList(internal);
  if (!list) return;
  const { record } = list;
  if (!list.fresh && record.complete && Date.now() - (Number(record.checkedAt) || 0) < PHONE_PREFETCH_RECHECK_MS) return;
  const cache = await caches.open(STATIC_CACHE);
  let fetched = 0;
  let missed = 0;
  let stopped = false;
  for (const row of record.rows) {
    if (workerNetwork() !== 'unmetered' || downloadState.isDownloading) {
      stopped = true;
      break;
    }
    const pathname = pathOfUrl(row.url);
    const kept = await cache.match(pathname, { ignoreVary: true });
    if (kept && kept.headers.get('x-file-hash') === row.hash) continue;
    let response = null;
    try {
      response = await fetch(row.url, { cache: 'no-store', priority: 'low' });
    } catch (_) {
      stopped = true;
      break;
    }
    if (!response.ok) {
      missed += 1;
      continue;
    }
    const body = await response.arrayBuffer();
    // a copy that is not the manifest's (a stale server copy) is left for the next pass
    if (await sha256Hex(body) !== row.hash) {
      missed += 1;
      continue;
    }
    await purgeStaticCacheEntries(cache, row.url);
    await cache.put(new Request(row.url), staticCacheResponseWithHash(body, response, row.hash));
    fetched += 1;
    await new Promise((resolve) => setTimeout(resolve, PHONE_PREFETCH_GAP_MS));
  }
  if (!stopped && !missed) {
    record.complete = true;
    record.checkedAt = Date.now();
    if (record.hash) await writePhoneOptionalRecord(internal, record);
  }
  perfLog(`phonePrefetch rows=${record.rows.length} fetched=${fetched} missed=${missed}${stopped ? ' stopped' : ''}`);
}

/** One pass at a time, on Wi-Fi only. */
function runPhonePrefetch() {
  if (phonePrefetchRun) return phonePrefetchRun;
  if (workerNetwork() !== 'unmetered') return Promise.resolve();
  phonePrefetchRun = perfSpan('phonePrefetch', phonePrefetchPass)
    .catch((error) => { perfLog(`phonePrefetch failed ${error && (error.message || error)}`); })
    .finally(() => { phonePrefetchRun = null; });
  return phonePrefetchRun;
}

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // WALLPAPER_CACHE stays: every sw.js update used to drop it and re-download each wallpaper
          if (cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE && 
              cacheName !== IMAGE_CACHE &&
              cacheName !== INTERNAL_CACHE &&
              cacheName !== WALLPAPER_CACHE &&
              cacheName !== EXPLORER_PREVIEW_CACHE &&
              cacheName !== SCRIPT_CODE_CACHE &&
              cacheName !== LAUNCH_SHELL_CACHE &&
              cacheName !== PROTECTED_FONT_CACHE &&
              cacheName !== 'videos-cache-v1') { // Melaton Videos' own cache (emote pictures, wmYouTube.js)
            return caches.delete(cacheName);
          }
        })
      );
    }).then(async () => {
      // Only cheap steps here: the browser holds every page request until activation ends, and
      // the cache upkeep took ~19 s on Yukimi's Edge (the Welcome screen waited on it). It runs
      // in runCacheMaintenance, which the page asks for once its boot is over.
      await loadPerfTraceFlag();
      await caches.open(STATIC_CACHE).then((cache) => cache.delete('/sw.js'));
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

// Who gets NETWORK_ACTIVITY (#890): the desktop's taskbar arrows (websocket.js
// flashHttpTrafficArrow) and nobody else. A hidden window drops it on arrival (document.hidden), so
// it is not sent one; a page with no arrows to draw (Melaton Mobile's shell) opts out with
// NETWORK_ACTIVITY_OPT_OUT { off: true } and opts back in with { off: false }. The opt-outs are
// client ids kept in INTERNAL_CACHE, so a worker the browser stopped and started again still
// knows them; ids of closed windows are dropped as they are seen to be gone.
const NETWORK_ACTIVITY_OPT_OUT_KEY = '/internal/sw-network-activity-opt-out-v1';
let networkActivityOptOut = null; // Set of client ids, null until read
let networkActivityOptOutLoad = null;

function loadNetworkActivityOptOut() {
  if (networkActivityOptOut) return Promise.resolve(networkActivityOptOut);
  if (!networkActivityOptOutLoad) {
    networkActivityOptOutLoad = caches.open(INTERNAL_CACHE)
      .then((cache) => cache.match(NETWORK_ACTIVITY_OPT_OUT_KEY))
      .then((hit) => (hit ? hit.json() : []))
      .catch(() => [])
      .then((ids) => {
        if (!networkActivityOptOut) networkActivityOptOut = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
        networkActivityOptOutLoad = null;
        return networkActivityOptOut;
      });
  }
  return networkActivityOptOutLoad;
}

function saveNetworkActivityOptOut() {
  const ids = JSON.stringify([...(networkActivityOptOut || [])]);
  return caches.open(INTERNAL_CACHE)
    .then((cache) => cache.put(NETWORK_ACTIVITY_OPT_OUT_KEY, new Response(ids, { headers: { 'content-type': 'application/json' } })))
    .catch(() => {});
}

async function setNetworkActivityOptOut(source, off) {
  const id = source && typeof source.id === 'string' ? source.id : '';
  if (!id) return;
  const set = await loadNetworkActivityOptOut();
  if (off === set.has(id)) return;
  if (off) set.add(id);
  else set.delete(id);
  await saveNetworkActivityOptOut();
}

/** The windows that draw network activity: shown, and not opted out. Forgets closed ones. */
async function networkActivityClients() {
  const [clients, optOut] = await Promise.all([self.clients.matchAll(), loadNetworkActivityOptOut()]);
  if (optOut.size) {
    const open = new Set(clients.map((client) => client.id));
    let pruned = false;
    for (const id of optOut) {
      if (!open.has(id)) { optOut.delete(id); pruned = true; }
    }
    if (pruned) saveNetworkActivityOptOut();
  }
  return clients.filter((client) => client.visibilityState !== 'hidden' && !optOut.has(client.id));
}

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

    networkActivityClients().then(clients => {
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
