/**
 * Reinstall the program files (Yozora #903, Yukimi Nov 17 2026): the way out of a breaking update that
 * leaves a client unable to update itself. Only Melaton's program is thrown away - the service worker
 * registration, every Cache Storage cache (the program files, the kept app page) and the install marker -
 * and /launch installs it again from the server. Settings, the cached logon, IndexedDB data and the
 * session stay on the device (the full wipe is fatalErrorBootstrap.js reinstallWebApp).
 *
 *   melatonReinstall() -> Promise<{ ok, reason? }>   reason 'offline': the server did not answer, nothing removed
 *   /launch?reinstall=1                              runs it at once (the Android app's recovery page, phone Settings)
 */
(function (root) {
    'use strict';

    async function serverAnswers() {
        try {
            const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
            const res = await root.fetch('/status', { method: 'OPTIONS', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
            if (timer) clearTimeout(timer);
            return res.ok;
        } catch (_) {
            return false;
        }
    }

    async function reinstall() {
        // the files come from the server: with no answer nothing is removed (the installed copy keeps working)
        if (!(await serverAnswers())) return { ok: false, reason: 'offline' };
        try {
            if (root.navigator && root.navigator.serviceWorker) {
                for (const reg of await root.navigator.serviceWorker.getRegistrations()) await reg.unregister();
            }
        } catch (_) { /* a registration that will not go is replaced by the new install */ }
        try {
            if (root.caches) for (const name of await root.caches.keys()) await root.caches.delete(name);
        } catch (_) { /* what is left is overwritten */ }
        try {
            // the install marker: /launch installs everything again instead of checking for updates
            ['melatonManifestHash', 'melatonSwHash'].forEach((k) => root.localStorage.removeItem(k));
        } catch (_) { /* private mode */ }
        try { root.sessionStorage.clear(); } catch (_) { /* private mode */ }
        root.location.replace('/launch');
        return { ok: true };
    }

    root.melatonReinstall = reinstall;

    if (root.location && root.location.pathname === '/launch' && /[?&]reinstall=1(?:&|$)/.test(root.location.search)) {
        root.__melatonReinstalling = true;
        reinstall().then((r) => {
            // no server: start as usual (the installed copy), without the parameter
            if (!r.ok) root.location.replace('/launch');
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
