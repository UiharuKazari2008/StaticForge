/**
 * Melaton update policy (Yozora #924): where an update installs.
 *
 * Yukimi, Nov 19 2026: "handle update download and install at the shutdown phase of the winlogon like
 * real Windows ... We would only jump to install if the update is so large that it would replace large
 * parts of the OS, or the client has never flipped the installed bit, or is missing critical files in
 * the cache."
 *
 *   route(input) -> { route: 'installer' | 'inplace', reason }
 *
 * 'installer' is /launch's installation media (melatonBoot.js + updateEngine.js). 'inplace' downloads
 * in the background while the app runs and installs at log off / shut down / restart
 * (serviceWorkerManager.installUpdatesAtShutdown, winlogonPower.js), or live where segments allow.
 *
 * The installer only when
 *   - an install is already running there (its state survives a reload), or
 *   - this client never finished an install (no installed mark), or
 *   - a critical file is not in the cache at all (the copy cannot start by itself), or
 *   - the update replaces large parts of the OS: a quarter of the client's files, a third of its code
 *     (scripts, styles, pages), or LARGE_BYTES of downloads.
 *
 * Shared by /launch and /app (both load this file before their update code). Pure: no storage, no
 * network; callers pass what they know.
 */
(function (root) {
    'use strict';

    const LARGE_FILE_SHARE = 0.25;
    const LARGE_CODE_SHARE = 1 / 3;
    const LARGE_BYTES = 150 * 1024 * 1024;
    // when the client does not know how many files it keeps (no stored list yet)
    const LARGE_FILES_FALLBACK = 2400;
    const LARGE_CODE_FALLBACK = 250;
    // an in-place update this small still lands before the desktop at a boot check (as before #924)
    const QUIET_BOOT_FILES = 20;

    // Without these in the cache the copy cannot boot, log on or update itself: missing (not merely
    // changed) sends the client to the installer. /app adds the files its own page loads.
    const CRITICAL_PATHS = [
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
    ];

    function pathOf(file) {
        const raw = String((file && file.url) || file || '');
        const q = raw.search(/[?#]/);
        return q < 0 ? raw : raw.slice(0, q);
    }

    function isCode(file) {
        return /\.(?:m?js|css|html?)$/i.test(pathOf(file));
    }

    /** { n, code, bytes } of a file list: what a client keeps, or what an update brings. */
    function stats(files) {
        const list = Array.isArray(files) ? files : [];
        let code = 0;
        let bytes = 0;
        for (let i = 0; i < list.length; i++) {
            const file = list[i];
            if (!file) continue;
            if (isCode(file)) code += 1;
            bytes += Number(file.size) || 0;
        }
        return { n: list.length, code, bytes };
    }

    function isCritical(file, extra) {
        const path = pathOf(file);
        if (CRITICAL_PATHS.indexOf(path) >= 0) return true;
        return !!(extra && typeof extra.has === 'function' && extra.has(path));
    }

    /**
     * input: { files (the update, stragglers already left out), total: { n, code } of what this
     *   client keeps (or null), installed (the installed mark), installActive (an install running on
     *   /launch), criticalMissing (critical files with no cache row) }
     */
    function route(input) {
        const o = input || {};
        if (o.installActive) return { route: 'installer', reason: 'install-in-progress' };
        const update = stats(o.files);
        if (!update.n) return { route: 'inplace', reason: 'nothing' };
        if (!o.installed) return { route: 'installer', reason: 'never-installed' };
        if (Number(o.criticalMissing) > 0) return { route: 'installer', reason: 'critical-missing' };
        const total = o.total && Number(o.total.n) > 0 ? o.total : null;
        const fileLimit = total ? Math.max(QUIET_BOOT_FILES + 1, Math.ceil(total.n * LARGE_FILE_SHARE)) : LARGE_FILES_FALLBACK;
        const codeLimit = total && Number(total.code) > 0
            ? Math.max(QUIET_BOOT_FILES + 1, Math.ceil(total.code * LARGE_CODE_SHARE)) : LARGE_CODE_FALLBACK;
        if (update.n >= fileLimit) return { route: 'installer', reason: 'large-files' };
        if (update.code >= codeLimit) return { route: 'installer', reason: 'large-code' };
        if (update.bytes >= LARGE_BYTES) return { route: 'installer', reason: 'large-bytes' };
        return { route: 'inplace', reason: 'inplace' };
    }

    const api = {
        LARGE_FILE_SHARE, LARGE_CODE_SHARE, LARGE_BYTES, LARGE_FILES_FALLBACK, LARGE_CODE_FALLBACK,
        QUIET_BOOT_FILES, CRITICAL_PATHS, pathOf, isCode, isCritical, stats, route
    };
    if (root) root.melatonUpdatePolicy = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
