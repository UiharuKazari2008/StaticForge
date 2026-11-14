/**
 * Background updater page (Yozora #815): DSApp's BackgroundUpdater loads /updater.html in a WebView
 * with no window when the server rings ActiveSync's line for an update and no Melaton window is
 * open. It runs the boot's own update check and download (updateEngine.js) so the service worker's
 * cache holds the new files before the next start, then tells the app how it went
 * (AndroidUpdater.done) and the app closes the WebView.
 *
 * Nothing here draws or asks: the page is never on screen.
 */
(function (root) {
    'use strict';

    const bridge = root.AndroidUpdater || null;
    const log = (text) => { try { if (bridge) bridge.log(String(text)); } catch (_) { /* no app */ } };
    let reported = false;
    const done = (result) => {
        if (reported) return;
        reported = true;
        log('done ' + JSON.stringify(result));
        try { if (bridge) bridge.done(JSON.stringify(result)); } catch (_) { /* no app */ }
    };

    const engine = root.melatonUpdateEngine || null;
    const env = {
        window: root,
        fetch: root.fetch.bind(root),
        navigator: root.navigator,
        sessionStorage: (() => { try { return root.sessionStorage; } catch (_) { return null; } })(),
        localStorage: (() => { try { return root.localStorage; } catch (_) { return null; } })(),
        caches: root.caches || null,
        location: root.location,
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        setInterval: root.setInterval.bind(root),
        clearInterval: root.clearInterval.bind(root)
    };

    async function run() {
        if (!engine) return done({ ok: false, reason: 'no update engine' });
        const found = await engine.check(env);
        if (found.failed) return done({ ok: false, reason: 'manifest check failed' });
        if (found.skipped) return done({ ok: false, reason: found.skipped });
        const files = found.files || [];
        if (!files.length) return done({ ok: true, files: 0 });
        log(`${files.length} file(s), ${found.bytes || 0} bytes`);
        if (!(await engine.ensureWorker(env))) return done({ ok: false, reason: 'service worker not ready', files: files.length });
        const result = await engine.download(env, files, { silent: true });
        const left = result.ok ? await engine.verify(env, files) : files;
        done({
            ok: !!result.ok && left.length === 0,
            files: files.length,
            bytes: found.bytes || 0,
            left: left.length,
            busy: !!result.busy,
            stalled: !!result.stalled,
            errors: (result.errors || []).slice(0, 5)
        });
    }

    run().catch((error) => done({ ok: false, reason: String((error && error.message) || error) }));
})(typeof window !== 'undefined' ? window : null);
