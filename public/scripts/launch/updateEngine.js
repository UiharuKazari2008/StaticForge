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
 *                         order, so bytes done = the first n files), no progress for stallMs = stalled
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

    const config = {
        silentMax: 20,
        stallMs: 60000,
        manifestTimeoutMs: 8000,
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

    /** { files, bytes } to install, or { skipped } when this page cannot check. */
    async function check(env) {
        if (!env.caches) return { skipped: 'no-cache-storage' };
        const manifest = await fetchManifest(env);
        if (!manifest || !manifest.length) return { skipped: 'no-manifest' };
        const files = await filesNeedingUpdate(env, manifest);
        return { files, bytes: totalBytes(files), manifest };
    }

    function workerContainer(env) {
        return env.navigator && env.navigator.serviceWorker ? env.navigator.serviceWorker : null;
    }

    /** Registered, active and controlling this page → true; otherwise false (boot without it). */
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
        check,
        ensureWorker,
        download,
        verify,
        readState,
        writeState,
        writeRecord,
        readRecord,
        needsInstaller
    };
    if (root) root.melatonUpdateEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
