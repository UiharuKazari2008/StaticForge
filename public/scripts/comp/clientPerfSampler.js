// Lightweight client performance sampling persisted through the authenticated WebSocket.

const CLIENT_PERF_SAMPLE_INTERVAL_MS = 60000;
const CLIENT_PERF_FRAME_WINDOW_MS = 5000;
const CLIENT_PERF_TYPING_FLUSH_DELAY_MS = 2000;
const CLIENT_PERF_QUEUE_LIMIT = 20;
const CLIENT_PERF_SAMPLE_BUILD_MEASURE = 'staticforge:client-perf-sample-build';
const CLIENT_PERF_SERVICE_WORKER_HEALTH_MEASURE = 'staticforge:service-worker-health-check';
const CLIENT_PERF_MEASURE_KEYS = Object.freeze({
    [CLIENT_PERF_SAMPLE_BUILD_MEASURE]: 'sampleBuild',
    [CLIENT_PERF_SERVICE_WORKER_HEALTH_MEASURE]: 'serviceWorkerHealth'
});

function createClientPerfMeasureState() {
    return {
        sampleBuild: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
        serviceWorkerHealth: { count: 0, totalDurationMs: 0, maxDurationMs: 0 }
    };
}

const clientPerfState = {
    startedAt: Date.now(),
    intervalId: null,
    frameWindowTimer: null,
    frameRafId: 0,
    intervalFlushTimer: null,
    startupFlushTimer: null,
    typingFlushTimer: null,
    modalFlushTimer: null,
    visibilityHandler: null,
    modalLifecycleHandler: null,
    connectedHandler: null,
    longTaskObserver: null,
    measureObserver: null,
    sendPromise: null,
    queuedSamples: [],
    frameTimes: [],
    lastFrameAt: 0,
    longTaskCount: 0,
    longTaskDurationMs: 0,
    longTaskMaxDurationMs: 0,
    longTaskBuckets: {
        under100Ms: 0,
        from100To249Ms: 0,
        from250To999Ms: 0,
        atLeast1000Ms: 0
    },
    namedMeasures: createClientPerfMeasureState(),
    modalOpened: 0,
    modalClosed: 0,
    autofillRebuildCount: 0,
    autofillRebuildTotalMs: 0,
    autofillRebuildMaxMs: 0,
    autofillServiceCount: 0,
    autofillResultCount: 0,
    lastAutofillRebuildMs: 0
};

function clientPerfPercentile(values, percentile) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))];
}

function getClientPerfHeapSnapshot() {
    if (!performance.memory) return null;
    return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    };
}

function getClientPerfFrameSnapshot() {
    const frames = clientPerfState.frameTimes;
    const averageFrameMs = frames.length
        ? frames.reduce((sum, value) => sum + value, 0) / frames.length
        : null;
    return {
        sampledFrames: frames.length,
        averageFrameMs: averageFrameMs === null ? null : Math.round(averageFrameMs * 100) / 100,
        p95FrameMs: clientPerfPercentile(frames, 0.95),
        estimatedFps: averageFrameMs ? Math.round((1000 / averageFrameMs) * 10) / 10 : null,
        longTaskCount: clientPerfState.longTaskCount,
        longTaskDurationMs: Math.round(clientPerfState.longTaskDurationMs),
        longTaskMaxDurationMs: Math.round(clientPerfState.longTaskMaxDurationMs),
        longTaskBuckets: { ...clientPerfState.longTaskBuckets }
    };
}

function getClientPerfNamedMeasureSnapshot() {
    const snapshot = {};
    for (const [key, value] of Object.entries(clientPerfState.namedMeasures)) {
        snapshot[key] = {
            count: value.count,
            totalDurationMs: Math.round(value.totalDurationMs * 100) / 100,
            averageDurationMs: value.count
                ? Math.round((value.totalDurationMs / value.count) * 100) / 100
                : null,
            maxDurationMs: Math.round(value.maxDurationMs * 100) / 100
        };
    }
    return snapshot;
}

function getClientPerfDomSnapshot() {
    return {
        nodeCount: document.getElementsByTagName('*').length,
        openModals: document.querySelectorAll('.modal:not(.hidden):not(.hidden-alt)').length,
        openDropdowns: document.querySelectorAll('.custom-dropdown-menu:not(.hidden)').length,
        activeToasts: activeToasts.size,
        galleryItems: document.querySelectorAll('.gallery-item').length,
        galleryPlaceholders: document.querySelectorAll('.gallery-placeholder').length
    };
}

function getClientPerfAutofillSnapshot() {
    const count = clientPerfState.autofillRebuildCount;
    return {
        rebuildCount: count,
        lastRebuildMs: clientPerfState.lastAutofillRebuildMs,
        averageRebuildMs: count
            ? Math.round((clientPerfState.autofillRebuildTotalMs / count) * 100) / 100
            : null,
        maxRebuildMs: clientPerfState.autofillRebuildMaxMs,
        serviceCount: clientPerfState.autofillServiceCount,
        resultCount: clientPerfState.autofillResultCount
    };
}

function getClientPerfSample(reason = 'manual') {
    // getGalleryPerformanceSnapshot: public/scripts/comp/galleryView.js
    const gallery = getGalleryPerformanceSnapshot();
    return {
        schemaVersion: 2,
        timestamp: Date.now(),
        sessionId: clientPerfState.startedAt.toString(36),
        uptimeMs: Date.now() - clientPerfState.startedAt,
        reason,
        page: location.pathname,
        glass: {
            glassOn: !document.documentElement.classList.contains('disable-blur'),
            classicTheme: document.body.classList.contains('windows-classic-theme')
        },
        visibility: document.visibilityState,
        frame: getClientPerfFrameSnapshot(),
        heap: getClientPerfHeapSnapshot(),
        dom: getClientPerfDomSnapshot(),
        gallery,
        autofill: getClientPerfAutofillSnapshot(),
        chrome: {
            modalOpened: clientPerfState.modalOpened,
            modalClosed: clientPerfState.modalClosed
        },
        namedMeasures: getClientPerfNamedMeasureSnapshot(),
        timers: {
            samplerInterval: !!clientPerfState.intervalId,
            serviceWorkerHealth: !!serviceWorkerManager?.healthCheckInterval,
            serviceWorkerState: !!serviceWorkerManager?.stateCheckInterval
        }
    };
}

function resetClientPerfWindowCounters() {
    clientPerfState.frameTimes.length = 0;
    clientPerfState.longTaskCount = 0;
    clientPerfState.longTaskDurationMs = 0;
    clientPerfState.longTaskMaxDurationMs = 0;
    clientPerfState.longTaskBuckets.under100Ms = 0;
    clientPerfState.longTaskBuckets.from100To249Ms = 0;
    clientPerfState.longTaskBuckets.from250To999Ms = 0;
    clientPerfState.longTaskBuckets.atLeast1000Ms = 0;
    clientPerfState.namedMeasures = createClientPerfMeasureState();
    clientPerfState.modalOpened = 0;
    clientPerfState.modalClosed = 0;
    clientPerfState.autofillRebuildCount = 0;
    clientPerfState.autofillRebuildTotalMs = 0;
    clientPerfState.autofillRebuildMaxMs = 0;
}

function queueClientPerfSample(sample) {
    clientPerfState.queuedSamples.push(sample);
    if (clientPerfState.queuedSamples.length > CLIENT_PERF_QUEUE_LIMIT) {
        clientPerfState.queuedSamples.splice(0, clientPerfState.queuedSamples.length - CLIENT_PERF_QUEUE_LIMIT);
    }
}

async function sendQueuedClientPerfSamples() {
    if (clientPerfState.sendPromise) return clientPerfState.sendPromise;
    if (!wsClient.isConnected() || clientPerfState.queuedSamples.length === 0) return;
    clientPerfState.sendPromise = (async () => {
        const queued = clientPerfState.queuedSamples.splice(0);
        try {
            await wsClient.reportClientPerf(queued);
        } catch (error) {
            clientPerfState.queuedSamples.unshift(...queued);
            if (clientPerfState.queuedSamples.length > CLIENT_PERF_QUEUE_LIMIT) {
                clientPerfState.queuedSamples.length = CLIENT_PERF_QUEUE_LIMIT;
            }
        } finally {
            clientPerfState.sendPromise = null;
            if (wsClient.isConnected() && clientPerfState.queuedSamples.length > 0) {
                sendQueuedClientPerfSamples();
            }
        }
    })();
    return clientPerfState.sendPromise;
}

async function flushClientPerfSample(reason = 'interval') {
    const sampleBuildStartedAt = performance.now();
    const sample = getClientPerfSample(reason);
    performance.measure(CLIENT_PERF_SAMPLE_BUILD_MEASURE, {
        start: sampleBuildStartedAt,
        end: performance.now()
    });
    queueClientPerfSample(sample);
    resetClientPerfWindowCounters();
    await sendQueuedClientPerfSamples();
    return sample;
}

function sampleClientPerfFrame(timestamp) {
    if (clientPerfState.lastFrameAt) {
        clientPerfState.frameTimes.push(Math.round((timestamp - clientPerfState.lastFrameAt) * 100) / 100);
    }
    clientPerfState.lastFrameAt = timestamp;
    clientPerfState.frameRafId = requestAnimationFrame(sampleClientPerfFrame);
}

function startClientPerfFrameWindow() {
    if (clientPerfState.frameRafId) return;
    clientPerfState.lastFrameAt = 0;
    clientPerfState.frameRafId = requestAnimationFrame(sampleClientPerfFrame);
    clientPerfState.frameWindowTimer = setTimeout(() => {
        cancelAnimationFrame(clientPerfState.frameRafId);
        clientPerfState.frameRafId = 0;
        clientPerfState.frameWindowTimer = null;
        clientPerfState.lastFrameAt = 0;
    }, CLIENT_PERF_FRAME_WINDOW_MS);
}

function recordClientPerfModalEvent(eventType) {
    if (eventType === 'opened') {
        clientPerfState.modalOpened++;
    } else if (eventType === 'closed') {
        clientPerfState.modalClosed++;
        if (clientPerfState.modalOpened + clientPerfState.modalClosed >= 4) {
            if (clientPerfState.modalFlushTimer) {
                clearTimeout(clientPerfState.modalFlushTimer);
            }
            clientPerfState.modalFlushTimer = setTimeout(() => {
                clientPerfState.modalFlushTimer = null;
                flushClientPerfSample('modal_churn');
            }, CLIENT_PERF_TYPING_FLUSH_DELAY_MS);
        }
    }
}

function recordClientPerfAutofillRebuild(durationMs, serviceCount, resultCount) {
    const rounded = Math.round(durationMs * 100) / 100;
    clientPerfState.autofillRebuildCount++;
    clientPerfState.autofillRebuildTotalMs += rounded;
    clientPerfState.autofillRebuildMaxMs = Math.max(clientPerfState.autofillRebuildMaxMs, rounded);
    clientPerfState.lastAutofillRebuildMs = rounded;
    clientPerfState.autofillServiceCount = serviceCount;
    clientPerfState.autofillResultCount = resultCount;
    if (clientPerfState.typingFlushTimer) {
        clearTimeout(clientPerfState.typingFlushTimer);
    }
    clientPerfState.typingFlushTimer = setTimeout(() => {
        clientPerfState.typingFlushTimer = null;
        flushClientPerfSample('typing');
    }, CLIENT_PERF_TYPING_FLUSH_DELAY_MS);
}

function startClientPerfSampler() {
    if (clientPerfState.intervalId) return;

    if ('PerformanceObserver' in self && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        clientPerfState.longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                clientPerfState.longTaskCount++;
                clientPerfState.longTaskDurationMs += entry.duration;
                clientPerfState.longTaskMaxDurationMs = Math.max(
                    clientPerfState.longTaskMaxDurationMs,
                    entry.duration
                );
                if (entry.duration < 100) {
                    clientPerfState.longTaskBuckets.under100Ms++;
                } else if (entry.duration < 250) {
                    clientPerfState.longTaskBuckets.from100To249Ms++;
                } else if (entry.duration < 1000) {
                    clientPerfState.longTaskBuckets.from250To999Ms++;
                } else {
                    clientPerfState.longTaskBuckets.atLeast1000Ms++;
                }
            }
        });
        clientPerfState.longTaskObserver.observe({ type: 'longtask', buffered: true });
    }

    if ('PerformanceObserver' in self && PerformanceObserver.supportedEntryTypes?.includes('measure')) {
        clientPerfState.measureObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const key = CLIENT_PERF_MEASURE_KEYS[entry.name];
                if (!key) continue;
                const measure = clientPerfState.namedMeasures[key];
                measure.count++;
                measure.totalDurationMs += entry.duration;
                measure.maxDurationMs = Math.max(measure.maxDurationMs, entry.duration);
                performance.clearMeasures(entry.name);
            }
        });
        clientPerfState.measureObserver.observe({ type: 'measure', buffered: true });
    }

    clientPerfState.visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
            flushClientPerfSample('visibility');
        } else {
            startClientPerfFrameWindow();
        }
    };
    document.addEventListener('visibilitychange', clientPerfState.visibilityHandler);

    clientPerfState.modalLifecycleHandler = (event) => {
        recordClientPerfModalEvent(event.detail?.type);
    };
    document.addEventListener('staticforge:modal-lifecycle', clientPerfState.modalLifecycleHandler);

    clientPerfState.connectedHandler = () => sendQueuedClientPerfSamples();
    wsClient.on('connected', clientPerfState.connectedHandler);

    startClientPerfFrameWindow();
    clientPerfState.intervalId = setInterval(() => {
        startClientPerfFrameWindow();
        clientPerfState.intervalFlushTimer = setTimeout(() => {
            clientPerfState.intervalFlushTimer = null;
            flushClientPerfSample('interval');
        }, CLIENT_PERF_FRAME_WINDOW_MS);
    }, CLIENT_PERF_SAMPLE_INTERVAL_MS);
    clientPerfState.startupFlushTimer = setTimeout(() => {
        clientPerfState.startupFlushTimer = null;
        flushClientPerfSample('startup');
    }, CLIENT_PERF_FRAME_WINDOW_MS);
}

function stopClientPerfSampler() {
    if (clientPerfState.intervalId) {
        clearInterval(clientPerfState.intervalId);
        clientPerfState.intervalId = null;
    }
    if (clientPerfState.frameWindowTimer) {
        clearTimeout(clientPerfState.frameWindowTimer);
        clientPerfState.frameWindowTimer = null;
    }
    if (clientPerfState.frameRafId) {
        cancelAnimationFrame(clientPerfState.frameRafId);
        clientPerfState.frameRafId = 0;
    }
    if (clientPerfState.typingFlushTimer) {
        clearTimeout(clientPerfState.typingFlushTimer);
        clientPerfState.typingFlushTimer = null;
    }
    if (clientPerfState.modalFlushTimer) {
        clearTimeout(clientPerfState.modalFlushTimer);
        clientPerfState.modalFlushTimer = null;
    }
    if (clientPerfState.intervalFlushTimer) {
        clearTimeout(clientPerfState.intervalFlushTimer);
        clientPerfState.intervalFlushTimer = null;
    }
    if (clientPerfState.startupFlushTimer) {
        clearTimeout(clientPerfState.startupFlushTimer);
        clientPerfState.startupFlushTimer = null;
    }
    if (clientPerfState.visibilityHandler) {
        document.removeEventListener('visibilitychange', clientPerfState.visibilityHandler);
        clientPerfState.visibilityHandler = null;
    }
    if (clientPerfState.modalLifecycleHandler) {
        document.removeEventListener('staticforge:modal-lifecycle', clientPerfState.modalLifecycleHandler);
        clientPerfState.modalLifecycleHandler = null;
    }
    if (clientPerfState.connectedHandler) {
        wsClient.off('connected', clientPerfState.connectedHandler);
        clientPerfState.connectedHandler = null;
    }
    if (clientPerfState.longTaskObserver) {
        clientPerfState.longTaskObserver.disconnect();
        clientPerfState.longTaskObserver = null;
    }
    if (clientPerfState.measureObserver) {
        clientPerfState.measureObserver.disconnect();
        clientPerfState.measureObserver = null;
    }
}
