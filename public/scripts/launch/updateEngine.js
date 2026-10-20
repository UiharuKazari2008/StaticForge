/**
 * Melaton update engine (Yozora #419, S4 of #411): the update check that runs under the Vista
 * boot screen on /launch, and the installer's real work.
 *
 *   check(env)            server manifest (OPTIONS /) diffed against the service worker's
 *                         static-cache-v1 (same rule as serviceWorkerManager.getFilesNeedingUpdate:
 *                         x-file-hash per path, Vary / ?sha= siblings count) → { files, bytes } or
 *                         { skipped: reason } when updates cannot be checked here
 *   ensureWorker(env)     registers /sw.js if needed and waits until it controls this page (it
 *                         claims clients on activate); progress messages only reach controlled pages
 *   download(env, files)  CACHE_STATIC_FILES to the worker, progress by bytes (files go in manifest
 *                         order, so bytes done = the first n files), no progress for stallMs = stalled.
 *                         Used for a small silent update. The installer does not use this.
 *   copyPack(env)         one GET /install/meletonfx.zip (the pack built when assets were recreated)
 *   expandPack(env)       compare the server manifest to the service worker cache, extract and store
 *                         only the files whose hash does not match
 *   installGroup(env, g)  post-process one group ('features' or 'updates') and confirm the bytes
 *                         written to the cache hash to the manifest
 *   verify(env, files)    which of them are still not in the cache with the right hash
 *
 * Install state survives a reload (localStorage melatonInstall: { active, startedAt, total }), so
 * a reload mid-install goes straight back into the installer. Up to SILENT_MAX files download
 * silently behind the boot screen; more open the installer (melatonBoot.js).
 */
(function (root) {
    'use strict';

    const STATIC_CACHE = 'static-cache-v1';
    const STATE_KEY = 'melatonInstall';
    const RECORD_KEY = 'melatonInstallRecord';
    const PACK_URL = '/install/meletonfx.zip';
    const SAVED_CACHE_CONTROL = 'public, max-age=604800';

    // Held between Copying and Expanding. Dropped once the mismatches are in the cache.
    let installPack = null;

    const FEATURE_EXT = new Set(['js', 'mjs', 'css', 'html', 'htm', 'json', 'map', 'svg', 'xml', 'txt', 'webmanifest']);

    const CONTENT_TYPES = {
        html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
        mjs: 'application/javascript', json: 'application/json', map: 'application/json',
        svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain', webmanifest: 'application/manifest+json',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
        avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
        ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm'
    };

    const config = {
        silentMax: 20,
        // A POST body listing fewer files than this gets a zip of just those files.
        // More than this uses the full pack built at asset recreation.
        subsetMax: 120,
        stallMs: 60000,
        packReadyWaitMs: 180000,
        manifestTimeoutMs: 30000,
        readyTimeoutMs: 20000,
        controllerTimeoutMs: 6000
    };

    function timeoutSignal(ms) {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
        return undefined;
    }

    function normalizePath(url, origin) {
        try {
            return new URL(url, origin || 'http://localhost').pathname;
        } catch (_) {
            return String(url || '').split('?')[0];
        }
    }

    /** OPTIONS / → the service worker manifest ([{ url, hash, size, type }]) or null. */
    async function fetchManifest(env) {
        try {
            const res = await env.fetch('/', {
                method: 'OPTIONS',
                headers: { 'X-Service-Worker-Version': '2.0', 'X-Requested-With': 'ServiceWorker' },
                cache: 'no-store',
                signal: timeoutSignal(config.manifestTimeoutMs)
            });
            if (!res.ok) return null;
            const data = await res.json();
            return Array.isArray(data) ? data.filter((f) => f && f.url && f.hash) : null;
        } catch (_) {
            return null;
        }
    }

    async function cachedHashMatches(cache, file, origin, siblings) {
        const path = normalizePath(file.url, origin);
        const candidates = [file.url, path];
        if (path === '/index.html') candidates.push('/');
        if (path === '/') candidates.push('/index.html');
        for (const key of candidates) {
            const hit = await cache.match(key);
            if (!hit) continue;
            let hash = hit.headers.get('x-file-hash');
            if (!hash && hit.url) {
                const m = hit.url.match(/[?&]hash=([^&]+)/);
                if (m) hash = m[1];
            }
            if (hash === file.hash) return true;
            break;
        }
        // A Vary / ?sha= sibling can hold the row with the new hash
        for (const request of siblings.get(path) || []) {
            const alt = await cache.match(request);
            if (alt && alt.headers.get('x-file-hash') === file.hash) return true;
        }
        return false;
    }

    function isAuthGatedManifestFile(file) {
        if (file && file.auth === true) return true;
        const path = normalizePath(file && file.url, '');
        return path.startsWith('/protected/') || path.startsWith('/private/');
    }

    /** The manifest files whose cached copy is missing or has another hash. */
    async function filesNeedingUpdate(env, files) {
        const list = (files || []).filter((file) => !isAuthGatedManifestFile(file));
        if (!env.caches) return list.slice();
        const cache = await env.caches.open(STATIC_CACHE);
        const origin = env.location && env.location.origin;
        const siblings = new Map();
        (await cache.keys()).forEach((request) => {
            const path = normalizePath(request.url, origin);
            if (!siblings.has(path)) siblings.set(path, []);
            siblings.get(path).push(request);
        });
        const out = [];
        for (const file of list) {
            if (!(await cachedHashMatches(cache, file, origin, siblings))) out.push(file);
        }
        return out;
    }

    function totalBytes(files) {
        return files.reduce((n, f) => n + (Number(f.size) || 0), 0);
    }

    /** Application code and markup, or everything else (images, fonts, media). */
    function fileGroup(file) {
        if (file && file.type === 'route') return 'features';
        const clean = String((file && file.url) || '').split('?')[0];
        const dot = clean.lastIndexOf('.');
        const ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
        return FEATURE_EXT.has(ext) ? 'features' : 'updates';
    }

    function extensionOf(url) {
        const clean = String(url || '').split('?')[0];
        const dot = clean.lastIndexOf('.');
        return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
    }

    function contentType(url) {
        // Shell routes have no suffix. octet-stream makes the browser download the navigation.
        const path = normalizePath(url);
        if (path === '/' || path === '/index.html' || path === '/app' || path === '/launch') return 'text/html; charset=utf-8';
        return CONTENT_TYPES[extensionOf(url)] || 'application/octet-stream';
    }

    /** Zip entry for a manifest url. Routes keep the html names the server writes. */
    function zipEntryName(url) {
        const path = normalizePath(url);
        if (path === '/' || path === '/index.html') return 'index.html';
        if (path === '/app') return 'app.html';
        if (path === '/launch') return 'launch.html';
        return path.replace(/^\/+/, '');
    }

    /** Stable bytes hashed into X-Pack-Hash. Sorted, so manifest order does not matter. */
    function manifestHashMaterial(files) {
        const list = (files || []).slice().sort((a, b) => String(a.url).localeCompare(String(b.url)));
        let out = '';
        for (const file of list) {
            out += `${file.url || ''}\0${file.hash || ''}\0`;
        }
        return out;
    }

    function hexBytes(buffer) {
        const bytes = new Uint8Array(buffer);
        let out = '';
        for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
        return out;
    }

    async function sha256Hex(bytes) {
        const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
        if (!subtle) throw new Error('no-subtle-crypto');
        const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
        const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        const digest = await subtle.digest('SHA-256', copy);
        return hexBytes(digest);
    }

    async function hashManifest(files) {
        return sha256Hex(new TextEncoder().encode(manifestHashMaterial(files)));
    }

    function concatChunks(chunks) {
        let size = 0;
        for (const chunk of chunks) size += chunk.byteLength;
        const out = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return out;
    }

    async function purgeCachePath(cache, url, origin) {
        const path = normalizePath(url, origin);
        const keys = await cache.keys();
        await Promise.all(keys.map((request) => {
            if (normalizePath(request.url, origin) === path) return cache.delete(request);
            return undefined;
        }));
    }

    async function putHashed(cache, file, bytes, origin) {
        await purgeCachePath(cache, file.url, origin);
        const headers = new Headers();
        headers.set('content-type', contentType(file.url));
        headers.set('content-length', String(bytes.byteLength));
        headers.set('x-file-hash', file.hash);
        headers.set('etag', `"${file.hash}"`);
        headers.set('cache-control', SAVED_CACHE_CONTROL);
        await cache.put(file.url, new Response(bytes, { status: 200, headers }));
    }

    /** Body hash matches, and the stored headers name that hash and the right type. Rewrites headers when the body is already right. */
    async function confirmWritten(cache, file, origin) {
        const stored = await cache.match(file.url);
        if (!stored) return false;
        const body = new Uint8Array(await stored.arrayBuffer());
        const hash = await sha256Hex(body);
        if (hash !== file.hash) return false;
        const type = stored.headers.get('content-type');
        const headerHash = stored.headers.get('x-file-hash');
        if (headerHash === file.hash && type === contentType(file.url)) return true;
        await putHashed(cache, file, body, origin);
        const again = await cache.match(file.url);
        return !!(again && again.headers.get('x-file-hash') === file.hash);
    }

    // The manifest digest the cache was last found in sync with; shared with /app's
    // serviceWorkerManager. OPTIONS / answers 304 for it (Yozora #516).
    const SYNCED_MANIFEST_KEY = 'melatonManifestHash';
    const MANIFEST_SNAPSHOT_KEY = 'melatonManifestSnapshot';

    function readSyncedManifestHash(env) {
        try {
            return (env.localStorage && env.localStorage.getItem(SYNCED_MANIFEST_KEY)) || '';
        } catch (_) {
            return '';
        }
    }

    /** Retry after a mismatch: drop the stored digest and list so the next check fetches the full list. */
    function forgetManifest(env) {
        try {
            if (!env.localStorage) return;
            env.localStorage.removeItem(SYNCED_MANIFEST_KEY);
            env.localStorage.removeItem(MANIFEST_SNAPSHOT_KEY);
        } catch (_) { /* storage off */ }
    }

    function readManifestSnapshot(env) {
        try {
            const raw = env.localStorage && env.localStorage.getItem(MANIFEST_SNAPSHOT_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (!Array.isArray(parsed) || !parsed.length) return null;
            return parsed.filter((file) => file && file.url && file.hash);
        } catch (_) {
            return null;
        }
    }

    function writeManifestSnapshot(env, manifest) {
        try {
            if (!env.localStorage || !Array.isArray(manifest) || !manifest.length) return;
            const rows = manifest.filter((file) => file && file.url && file.hash)
                .map((file) => ({ url: file.url, hash: file.hash }));
            if (!rows.length) return;
            env.localStorage.setItem(MANIFEST_SNAPSHOT_KEY, JSON.stringify(rows));
        } catch (_) { /* next check fetches the full list */ }
    }

    function writeSyncedManifestHash(env, hash, manifest) {
        try {
            if (hash && env.localStorage) env.localStorage.setItem(SYNCED_MANIFEST_KEY, hash);
        } catch (_) { /* storage off */ }
        if (manifest) writeManifestSnapshot(env, manifest);
    }

    /** OPTIONS / with the synced digest: { unchanged } on 304, { compile } on 503, { failed } on any other miss, else { manifest, hash }. */
    async function fetchManifestConditional(env, options = {}) {
        const known = options.full ? '' : readSyncedManifestHash(env);
        try {
            const headers = { 'X-Service-Worker-Version': '2.0', 'X-Requested-With': 'ServiceWorker' };
            if (known) headers['X-Manifest-Hash'] = known;
            const res = await env.fetch('/', {
                method: 'OPTIONS',
                headers,
                cache: 'no-store',
                signal: timeoutSignal(config.manifestTimeoutMs)
            });
            if (res.status === 304) return { unchanged: true, hash: known };
            if (res.status === 503) return { compile: true, manifest: null };
            if (!res.ok) return { failed: true };
            const data = await res.json();
            const hash = (res.headers && res.headers.get && res.headers.get('X-Manifest-Hash')) || '';
            const manifest = Array.isArray(data) ? data.filter((f) => f && f.url && f.hash) : null;
            if (!manifest || !manifest.length) return { failed: true };
            return { manifest, hash };
        } catch (_) {
            return { failed: true };
        }
    }

    // Stragglers from the last install are not part of a valid cache. They must not
    // block the handoff or be fetched again on every start.
    function requiredFiles(env, files) {
        const record = readRecord(env);
        const known = new Set((record && record.stragglers) || []);
        return (files || []).filter((file) => file && !known.has(file.url));
    }

    /** { files, bytes } to install, { unchanged } when the cache still holds that list, { skipped } while compiling, or { failed }. */
    async function check(env) {
        if (!env.caches) return { skipped: 'no-cache-storage' };
        const fetched = await fetchManifestConditional(env);
        if (fetched.failed) return { failed: true };
        if (fetched.unchanged) {
            const snapshot = readManifestSnapshot(env);
            if (snapshot) {
                const files = requiredFiles(env, await filesNeedingUpdate(env, snapshot));
                if (files.length) return { files, bytes: totalBytes(files), manifest: snapshot };
                return { files: [], bytes: 0, unchanged: true };
            }
            const full = await fetchManifestConditional(env, { full: true });
            if (full.compile) return { skipped: 'no-manifest' };
            if (full.failed || !full.manifest) return { failed: true };
            const files = requiredFiles(env, await filesNeedingUpdate(env, full.manifest));
            if (!files.length) writeSyncedManifestHash(env, full.hash, full.manifest);
            return { files, bytes: totalBytes(files), manifest: full.manifest };
        }
        const manifest = fetched.manifest;
        if (!manifest || !manifest.length) return { skipped: 'no-manifest' };
        const files = requiredFiles(env, await filesNeedingUpdate(env, manifest));
        if (!files.length) writeSyncedManifestHash(env, fetched.hash, manifest);
        return { files, bytes: totalBytes(files), manifest };
    }

    function workerContainer(env) {
        return env.navigator && env.navigator.serviceWorker ? env.navigator.serviceWorker : null;
    }

    /** Registered, active and controlling this page → true; otherwise false. The installer still runs. */
    async function ensureWorker(env) {
        const sw = workerContainer(env);
        if (!sw) return false;
        try {
            let reg = await sw.getRegistration();
            if (!reg) reg = await sw.register('/sw.js');
            const ready = await Promise.race([
                sw.ready.then(() => true),
                env.sleep(config.readyTimeoutMs).then(() => false)
            ]);
            if (!ready) return false;
            if (sw.controller) return true;
            // A new worker claims the page on activate (sw.js); wait for that
            return await Promise.race([
                new Promise((resolve) => sw.addEventListener('controllerchange', () => resolve(!!sw.controller), { once: true })),
                env.sleep(config.controllerTimeoutMs).then(() => !!sw.controller)
            ]);
        } catch (_) {
            return false;
        }
    }

    /**
     * Download through the service worker. onProgress({ completed, total, fraction, file }) with a
     * byte-weighted fraction. Resolves { ok, completed, total, errors, stalled }.
     */
    function download(env, files, { onProgress = null, silent = false } = {}) {
        const sw = workerContainer(env);
        if (!sw || !sw.controller) return Promise.resolve({ ok: false, completed: 0, total: files.length, errors: ['no-worker'], stalled: false });
        const sizes = files.map((f) => Number(f.size) || 0);
        const bytes = sizes.reduce((a, b) => a + b, 0);
        const errors = [];
        const absent = [];
        return new Promise((resolve) => {
            let lastProgress = env.now();
            let completed = 0;
            let settled = false;
            const report = (n, file) => {
                completed = Math.max(completed, Math.min(n, files.length));
                const doneBytes = sizes.slice(0, completed).reduce((a, b) => a + b, 0);
                const fraction = bytes > 0 ? doneBytes / bytes : (files.length ? completed / files.length : 1);
                if (onProgress) onProgress({ completed, total: files.length, fraction, file });
            };
            const finish = (result) => {
                if (settled) return;
                settled = true;
                sw.removeEventListener('message', onMessage);
                env.clearInterval(stallTimer);
                resolve({ completed, total: files.length, errors, ...result });
            };
            const onMessage = (event) => {
                const data = event && event.data;
                if (!data || typeof data.type !== 'string') return;
                switch (data.type) {
                    case 'STATIC_CACHE_STARTED':
                    case 'STATIC_CACHE_ALREADY_IN_PROGRESS':
                        lastProgress = env.now();
                        break;
                    case 'STATIC_CACHE_PROGRESS':
                        lastProgress = env.now();
                        report(Number(data.completed) || 0, data.currentFile || null);
                        break;
                    case 'STATIC_CACHE_ERROR':
                        lastProgress = env.now();
                        if (data.file && String(data.error || '').indexOf('404') !== -1 && absent.indexOf(data.file) === -1) {
                            absent.push(data.file);
                        }
                        errors.push(`${data.file || '?'}: ${data.error || 'failed'}`);
                        break;
                    case 'STATIC_CACHE_COMPLETE':
                        if (Array.isArray(data.absent)) {
                            data.absent.forEach((url) => {
                                if (url && absent.indexOf(url) === -1) absent.push(url);
                            });
                        }
                        report(files.length, null);
                        finish({ ok: true, stalled: false, absent: absent.slice() });
                        break;
                    case 'STATIC_CACHE_CANCELLED':
                        finish({ ok: false, stalled: false, cancelled: true });
                        break;
                    default:
                        break;
                }
            };
            sw.addEventListener('message', onMessage);
            const stallTimer = env.setInterval(() => {
                if (env.now() - lastProgress >= config.stallMs) finish({ ok: false, stalled: true });
            }, 1000);
            report(0, null);
            sw.controller.postMessage({ type: 'CACHE_STATIC_FILES', files, silent });
        });
    }

    /** The files that still did not land with the right hash (after a download). */
    function verify(env, files) {
        return filesNeedingUpdate(env, files);
    }

    function fflateApi(env) {
        if (env && env.fflate) return env.fflate;
        return root && root.fflate ? root.fflate : null;
    }

    // Loaded only when Expanding runs (the boot page does not fetch it on every start).
    // public/scripts/launch/updateEngine.js calls /protected/fflate.js, served from node_modules/fflate.
    function loadFflate(env) {
        const ready = fflateApi(env);
        if (ready) return Promise.resolve(ready);
        const doc = env.window && env.window.document;
        if (!doc || !doc.head) return Promise.resolve(null);
        return new Promise((resolve) => {
            const script = doc.createElement('script');
            script.src = '/protected/fflate.js';
            script.onload = () => resolve(fflateApi(env));
            script.onerror = () => resolve(null);
            doc.head.appendChild(script);
        });
    }

    async function readStream(env, res, onProgress) {
        const total = Number(res.headers.get('content-length')) || 0;
        if (!res.body || typeof res.body.getReader !== 'function') {
            const buf = new Uint8Array(await res.arrayBuffer());
            if (onProgress) onProgress({ fraction: 1, received: buf.byteLength, total: total || buf.byteLength });
            return buf;
        }
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
            const next = reader.read();
            const raced = await Promise.race([
                next.then((value) => ({ value })),
                env.sleep(config.stallMs).then(() => ({ stalled: true }))
            ]);
            if (raced.stalled) {
                try { reader.cancel(); } catch (_) { /* already closed */ }
                const error = new Error('stalled');
                error.stalled = true;
                throw error;
            }
            if (raced.value.done) break;
            chunks.push(raced.value.value);
            received += raced.value.value.byteLength;
            if (onProgress) onProgress({ fraction: total > 0 ? received / total : 0, received, total });
        }
        return concatChunks(chunks);
    }

    /**
     * Copying: one zip stream. A short file list is POSTed and the server packs only those
     * files. A longer list, or a 413, downloads the full pack from asset recreation.
     * The pack hash must match the manifest rows this boot already fetched.
     */
    async function copyPack(env, manifest, { onProgress = null, subset = null } = {}) {
        installPack = null;
        const wanted = Array.isArray(subset) ? subset.filter((file) => file && file.url && file.hash) : [];
        const useSubset = wanted.length > 0 && wanted.length <= config.subsetMax;
        try {
            let res = null;
            let expectedSource = manifest || [];
            if (useSubset) {
                res = await env.fetch(PACK_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: wanted.map((file) => ({ url: file.url, hash: file.hash })) })
                });
                if (res && res.status === 413) {
                    res = null;
                } else {
                    expectedSource = wanted;
                }
            }
            if (!res) res = await env.fetch(PACK_URL, { cache: 'no-store' });
            // 503 while the server rebuilds a pack that went stale. Wait it out here.
            for (let waited = 0; res && res.status === 503 && waited < config.packReadyWaitMs;) {
                const after = Number(res.headers && res.headers.get && res.headers.get('retry-after')) || 5;
                const pause = Math.min(Math.max(after, 1), 15) * 1000;
                await env.sleep(pause);
                waited += pause;
                res = await env.fetch(PACK_URL, { cache: 'no-store' });
            }
            if (!res || !res.ok) {
                const status = res && res.status;
                return { ok: false, stalled: false, error: status === 503 ? 'pack-not-ready' : `HTTP ${status || 0}` };
            }
            const bytes = await readStream(env, res, (progress) => {
                if (onProgress) onProgress({ fraction: progress.fraction, received: progress.received, total: progress.total });
            });
            const expected = await hashManifest(expectedSource);
            const got = (res.headers.get('x-pack-hash') || '').toLowerCase();
            if (!got || got !== expected) {
                return { ok: false, stalled: false, error: 'pack-hash' };
            }
            installPack = { bytes, hash: got, stored: [] };
            return { ok: true, stalled: false, bytes: bytes.byteLength };
        } catch (err) {
            if (err && err.stalled) return { ok: false, stalled: true, error: 'stalled' };
            return { ok: false, stalled: false, error: (err && err.message) || 'download' };
        }
    }

    function unzipEntries(fflateLib, bytes, onEntry) {
        return new Promise((resolve, reject) => {
            const unzip = new fflateLib.Unzip();
            unzip.register(fflateLib.UnzipInflate);
            let chain = Promise.resolve();
            unzip.onfile = (file) => {
                const chunks = [];
                file.ondata = (err, data, final) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (data && data.length) chunks.push(data);
                    if (final) {
                        const name = file.name;
                        const payload = concatChunks(chunks);
                        chain = chain.then(() => onEntry(name, payload));
                    }
                };
                file.start();
            };
            try {
                // fflate 0.8 Unzip.push recurses once per entry it finds in the
                // buffer; one push of the whole pack (~2.8k files) overflows the
                // stack. Feed it in slices so each push only sees a few entries.
                const step = 64 * 1024;
                if (!bytes.length) unzip.push(bytes, true);
                for (let at = 0; at < bytes.length; at += step) {
                    const end = Math.min(at + step, bytes.length);
                    unzip.push(bytes.subarray(at, end), end >= bytes.length);
                }
            } catch (err) {
                reject(err);
                return;
            }
            chain.then(resolve, reject);
        });
    }

    /**
     * Expanding: manifest vs the local cache. Extract and store only mismatches.
     * Returns { ok, missing } (urls that were needed and did not land).
     */
    async function expandPack(env, manifest, { onProgress = null } = {}) {
        const lib = await loadFflate(env);
        if (!lib || typeof lib.Unzip !== 'function') return { ok: false, missing: [], error: 'no-unzip' };
        if (!installPack || !installPack.bytes) return { ok: false, missing: [], error: 'no-pack' };
        const files = Array.isArray(manifest) ? manifest : [];
        const needed = await filesNeedingUpdate(env, files);
        if (!needed.length) {
            installPack.stored = [];
            installPack.bytes = null;
            if (onProgress) onProgress({ fraction: 1 });
            return { ok: true, missing: [], stored: 0 };
        }
        if (!env.caches) return { ok: false, missing: needed.map((file) => file.url), error: 'no-cache-storage' };
        const cache = await env.caches.open(STATIC_CACHE);
        const origin = env.location && env.location.origin;
        const neededByUrl = new Map(needed.map((file) => [file.url, file]));
        const listing = new Map();
        let packMeta = null;
        const stored = [];
        const seen = new Set();
        try {
            await unzipEntries(lib, installPack.bytes, async (name, payload) => {
                if (name === 'pack.json') {
                    packMeta = JSON.parse(new TextDecoder().decode(payload));
                    (packMeta.files || []).forEach((row) => listing.set(row.entry, row));
                    return;
                }
                const row = listing.get(name);
                const file = row && neededByUrl.get(row.url);
                if (!file || row.hash !== file.hash) return;
                await putHashed(cache, file, payload, origin);
                stored.push(file);
                seen.add(file.url);
                if (onProgress) onProgress({ fraction: seen.size / needed.length });
            });
        } catch (err) {
            return { ok: false, missing: needed.map((file) => file.url), error: (err && err.message) || 'unzip' };
        }
        installPack.stored = stored;
        installPack.bytes = null;
        const missing = needed.filter((file) => !seen.has(file.url)).map((file) => file.url);
        if (onProgress) onProgress({ fraction: 1 });
        return { ok: true, missing, stored: stored.length };
    }

    /**
     * Installing features / Installing updates: one group. Confirm each file this install
     * wrote still matches the manifest hash, and rewrite headers when the body is right
     * but the stored type or hash header is not.
     */
    async function installGroup(env, group, { onProgress = null } = {}) {
        const stored = (installPack && installPack.stored) || [];
        const files = stored.filter((file) => fileGroup(file) === group);
        if (!files.length) {
            if (onProgress) onProgress({ fraction: 1 });
            return { ok: true, mismatched: [] };
        }
        if (!env.caches) return { ok: false, mismatched: files.map((file) => file.url), error: 'no-cache-storage' };
        const cache = await env.caches.open(STATIC_CACHE);
        const origin = env.location && env.location.origin;
        const mismatched = [];
        for (let i = 0; i < files.length; i++) {
            let ok = false;
            try {
                ok = await confirmWritten(cache, files[i], origin);
            } catch (_) {
                ok = false;
            }
            if (!ok) mismatched.push(files[i].url);
            if (onProgress) onProgress({ fraction: (i + 1) / files.length });
        }
        return { ok: true, mismatched };
    }

    // ---- install state (survives a reload) ----

    function readState(env) {
        try {
            const raw = env.localStorage && env.localStorage.getItem(STATE_KEY);
            const state = raw ? JSON.parse(raw) : null;
            return state && state.active ? state : null;
        } catch (_) {
            return null;
        }
    }

    function writeState(env, state) {
        try {
            if (state) env.localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, active: true }));
            else env.localStorage.removeItem(STATE_KEY);
        } catch (_) { /* no resume then */ }
    }

    function writeRecord(env, record) {
        try {
            env.localStorage.setItem(RECORD_KEY, JSON.stringify(record));
        } catch (_) { /* best effort */ }
    }

    function readRecord(env) {
        try {
            const raw = env.localStorage && env.localStorage.getItem(RECORD_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Large enough for the installer (or an install already in progress)? Files the last install
     * could not keep (its stragglers) never count: they would open Setup on every start.
     */
    function needsInstaller(env, files) {
        if (readState(env)) return true;
        const record = readRecord(env);
        const known = new Set((record && record.stragglers) || []);
        const fresh = files.filter((f) => !known.has(f.url));
        return fresh.length > config.silentMax;
    }

    const api = {
        config,
        STATIC_CACHE,
        STATE_KEY,
        RECORD_KEY,
        normalizePath,
        fetchManifest,
        filesNeedingUpdate,
        totalBytes,
        fileGroup,
        zipEntryName,
        manifestHashMaterial,
        hashManifest,
        contentType,
        check,
        ensureWorker,
        download,
        copyPack,
        expandPack,
        installGroup,
        verify,
        readState,
        writeState,
        forgetManifest,
        writeRecord,
        readRecord,
        needsInstaller
    };
    if (root) root.melatonUpdateEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
