// System inbound WebSocket handlers — runtime compile, service worker cache.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'system.service_worker_cache_update',
    type: 'service_worker_cache_update',
    phase: 'only',
    handler(message) {
        const files = message.data && Array.isArray(message.data.files) ? message.data.files : [];
        const silent = message.data && message.data.silent === true;
        // The only publisher is runtimeAssetService's recompile/notify path: the server has already
        // rebuilt these assets and rewritten the served ?sha= links. Unlike a person's Check for
        // updates (notify mode counts new versions), this is an explicit apply - download now and let
        // the classifier swap what can be swapped live.
        const cacheOptions = { runtimeAssetsRecompiled: true, install: true };
        // sw.js itself is only re-read on a navigation; a page that stays open (the phone) kept the
        // old worker after every notify until it was reloaded (Nov 14)
        // swHash: sha1 of the server's sw.js (#890); an unchanged worker is not asked for again
        if (window.serviceWorkerManager && typeof window.serviceWorkerManager.recheckWorkerScript === 'function') {
            window.serviceWorkerManager.recheckWorkerScript((message.data && message.data.swHash) || message.swHash || '');
        }

        // Queue until boot gate completes — public/scripts/comp/serviceWorkerManager.js
        if (window.serviceWorkerManager && !window.serviceWorkerManager.isBootComplete()) {
            window.serviceWorkerManager.queueCacheUpdateUntilBoot(files, silent, cacheOptions);
            return;
        }

        // a delta (modules/swManifestDelta.js) applies only on top of the list this client last took;
        // otherwise the manifest is read in full, as before
        const sm = window.serviceWorkerManager;
        const d = message.data || {};
        if (d.delta === true && sm) {
            if (!d.baseHash || sm._broadcastHash !== d.baseHash) {
                if (typeof sm.checkStaticFileUpdates === 'function') sm.checkStaticFileUpdates(silent, cacheOptions);
                return;
            }
            sm._broadcastHash = d.hash || sm._broadcastHash;
        } else if (sm && d.hash) {
            sm._broadcastHash = d.hash;
        }
        if (files.length > 0 && window.serviceWorkerManager && typeof window.serviceWorkerManager.updateStaticCache === 'function') {
            window.serviceWorkerManager.updateStaticCache(files, silent, cacheOptions);
        } else if (!silent && window.serviceWorkerManager && typeof window.serviceWorkerManager.checkStaticFileUpdates === 'function') {
            window.serviceWorkerManager.checkStaticFileUpdates(silent, cacheOptions);
        }
    }
});

registerWsInboundHandler({
    id: 'system.runtime_compile_error',
    type: 'runtime_compile_error',
    phase: 'only',
    handler(message) {
        const errors = message.data && Array.isArray(message.data.errors) ? message.data.errors : [];
        // showRuntimeCompileErrors: public/scripts/appInitSteps.js
        if (errors.length > 0 && typeof showRuntimeCompileErrors === 'function') {
            showRuntimeCompileErrors(errors);
        }
    }
});

registerWsInboundHandler({
    id: 'system.runtime_compile_progress',
    type: 'runtime_compile_progress',
    phase: 'only',
    handler(message, wsClient) {
        // handleRuntimeCompileProgressBroadcast: public/scripts/appInitSteps.js
        if (typeof handleRuntimeCompileProgressBroadcast === 'function') {
            handleRuntimeCompileProgressBroadcast(message.data);
        }
        wsClient.triggerEvent('runtime_compile_progress', message);
    }
});

registerWsInboundHandler({
    id: 'system.runtime_compile_complete',
    type: 'runtime_compile_complete',
    phase: 'only',
    handler(message, wsClient) {
        // handleRuntimeCompileCompleteBroadcast: public/scripts/appInitSteps.js
        if (typeof handleRuntimeCompileCompleteBroadcast === 'function') {
            handleRuntimeCompileCompleteBroadcast(message.data);
        }
        wsClient.triggerEvent('runtime_compile_complete', message);
    }
});

registerWsInboundHandler({
    id: 'system.runtime_compile_logs',
    type: 'runtime_compile_logs',
    phase: 'only',
    handler(message, wsClient) {
        wsClient.triggerEvent('runtime_compile_logs', message);
    }
});

// Server Manager > Clients (#898): an administrator asked this client to resync, or disconnected it
// (it stays off until reconnected here; the Nightshade Network Client says who disconnected it)
registerWsInboundHandler({
    id: 'system.client_resync',
    type: 'client_resync',
    phase: 'only',
    handler(message, wsClient) {
        if (wsClient && typeof wsClient.resyncFromServer === 'function') void wsClient.resyncFromServer();
    }
});

registerWsInboundHandler({
    id: 'system.client_disconnect',
    type: 'client_disconnect',
    phase: 'only',
    handler(message, wsClient) {
        if (wsClient && typeof wsClient.adminDisconnect === 'function') wsClient.adminDisconnect();
    }
});
