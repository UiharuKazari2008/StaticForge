// System inbound WebSocket handlers — runtime compile, service worker cache.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'system.service_worker_cache_update',
    type: 'service_worker_cache_update',
    phase: 'only',
    handler(message) {
        const files = message.data && Array.isArray(message.data.files) ? message.data.files : [];
        const silent = message.data && message.data.silent === true;
        const cacheOptions = {
            runtimeAssetsRecompiled: message.data && message.data.runtimeAssetsRecompiled === true
        };

        // Queue until boot gate completes — public/scripts/comp/serviceWorkerManager.js
        if (window.serviceWorkerManager && !window.serviceWorkerManager.isBootComplete()) {
            window.serviceWorkerManager.queueCacheUpdateUntilBoot(files, silent, cacheOptions);
            return;
        }

        if (files.length > 0 && window.serviceWorkerManager && typeof window.serviceWorkerManager.updateStaticCache === 'function') {
            window.serviceWorkerManager.updateStaticCache(files, silent, cacheOptions);
        } else if (!silent && window.serviceWorkerManager && typeof window.serviceWorkerManager.checkStaticFileUpdates === 'function') {
            window.serviceWorkerManager.checkStaticFileUpdates(silent);
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
