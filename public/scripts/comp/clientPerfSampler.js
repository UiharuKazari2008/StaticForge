// Lightweight client performance sampling persisted through the authenticated WebSocket.

const CLIENT_PERF_SAMPLE_INTERVAL_MS = 60000;
// Each rAF in the window forces a full main-thread frame (style + paint) on a page that otherwise
// animates on the compositor only, so the window itself was load: 1 s (~60 frames) is enough for
// the average and p95 (Fold7: 5 s windows tripled main-thread time while open).
const CLIENT_PERF_FRAME_WINDOW_MS = 1000;
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
    screenHandler: null,
    lastSentAt: 0,
    lastSleepFlushAt: 0,
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
    lastAutofillRebuildMs: 0,
    // The frame window (#998): its rAFs force a main-thread frame each, ~60 on a page that would draw none, so it
    // runs only when the minute had something to draw: input, a CSS animation or transition starting, or an
    // animation running now. A quiet minute's sample says sampledFrames 0 (FPS and p95 null, '—' in Security
    // Center's event list). One-shot listeners: the first event of a minute takes them off until the next sample.
    activity: {
        EVENTS: ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'animationstart', 'transitionstart'],
        // (listening from the start; the start-up window always runs)
        seen: false,
        armed: false,
        note: () => {
            const a = clientPerfState.activity;
            a.seen = true;
            a.disarm();
        },
        arm() {
            if (this.armed) return;
            this.armed = true;
            this.EVENTS.forEach((type) => document.addEventListener(type, this.note, { capture: true, passive: true }));
        },
        disarm() {
            if (!this.armed) return;
            this.armed = false;
            this.EVENTS.forEach((type) => document.removeEventListener(type, this.note, { capture: true }));
        },
        /** Whether there was something to draw since the last call; listens again for the next. */
        take() {
            let seen = this.seen;
            if (!seen && typeof document.getAnimations === 'function') {
                try { seen = document.getAnimations().some((anim) => anim.playState === 'running'); } catch (_) { seen = true; }
            }
            this.seen = false;
            this.arm();
            return seen;
        }
    },
    // the DOM counts' collections, kept: a live collection answers its length without a walk while the DOM is
    // unchanged (a querySelectorAll matched every element again each minute)
    domLists: null,
    // Melaton Mobile (#890): a sample a minute went out at once, each its own radio wake-up (1,440 a
    // day per phone, screen off too). A phone builds one a minute only while it is on screen and sends
    // them together: at most every 15 minutes, when the socket has just sent something else (the radio
    // is up anyway), when it goes out of sight or the screen goes off, or when the queue is full.
    phone: {
        SEND_EVERY_MS: 15 * 60 * 1000,
        PIGGYBACK_MS: 3000,
        // the DeX window of a hybrid phone too: its samples ride the phone's socket and radio (#890)
        is: () => window.uiShell === 'mobile' || !!(window.melatonContinuity && typeof window.melatonContinuity.isDexWindow === 'function' && window.melatonContinuity.isDexWindow()),
        /** Out of sight: a hidden page, or a phone whose screen is off (html[data-screen-off], the app's melatonscreen). */
        asleep: () => document.visibilityState === 'hidden' || document.documentElement.dataset.screenOff !== undefined,
        /** Whether the queued samples go out now or wait for a later chance. */
        sendDue(reason) {
            if (reason === 'visibility' || reason === 'screen_off' || reason === 'startup') return true;
            if (clientPerfState.queuedSamples.length >= CLIENT_PERF_QUEUE_LIMIT) return true;
            const now = Date.now();
            if (now - clientPerfState.lastSentAt >= this.SEND_EVERY_MS) return true;
            // lastOutgoingAt: public/scripts/websocket.js _sendOnSocket (anything but these samples)
            return now - (Number(wsClient.lastOutgoingAt) || 0) < this.PIGGYBACK_MS;
        },
        /** Going out of sight (hidden, or the screen off): one sample and the queue go out, once on a
            phone for both events (its screen-off is followed by the WebView hiding). */
        flushOnSleep(reason) {
            const now = Date.now();
            if (this.is() && now - clientPerfState.lastSleepFlushAt < 2000) return;
            clientPerfState.lastSleepFlushAt = now;
            flushClientPerfSample(reason);
        }
    }
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
    const lists = clientPerfState.domLists || (clientPerfState.domLists = {
        all: document.getElementsByTagName('*'),
        modals: document.getElementsByClassName('modal'),
        dropdowns: document.getElementsByClassName('custom-dropdown-menu'),
        galleryItems: document.getElementsByClassName('gallery-item'),
        galleryPlaceholders: document.getElementsByClassName('gallery-placeholder')
    });
    let openModals = 0;
    for (const el of lists.modals) if (!el.classList.contains('hidden') && !el.classList.contains('hidden-alt')) openModals++;
    let openDropdowns = 0;
    for (const el of lists.dropdowns) if (!el.classList.contains('hidden')) openDropdowns++;
    return {
        nodeCount: lists.all.length,
        openModals,
        openDropdowns,
        activeToasts: activeToasts.size,
        galleryItems: lists.galleryItems.length,
        galleryPlaceholders: lists.galleryPlaceholders.length
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
    // getGalleryPerformanceSnapshot: public/scripts/comp/galleryImagesLoad.js
    const gallery = (typeof getGalleryPerformanceSnapshot === 'function')
        ? getGalleryPerformanceSnapshot()
        : null;
    return {
        schemaVersion: 2,
        timestamp: Date.now(),
        sessionId: clientPerfState.startedAt.toString(36),
        uptimeMs: Date.now() - clientPerfState.startedAt,
        reason,
        page: location.pathname,
        glass: {
            glassOn: !document.documentElement.classList.contains('disable-blur'),
            classicTheme: window.uiTheme.is('classic')
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
            clientPerfState.lastSentAt = Date.now();
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
    // the desktop batches too (#998): the server only stores the samples (190-adminHandler.js handleReportClientPerf,
    // telemetry events), nothing reads them by the minute
    if (clientPerfState.phone.sendDue(reason)) await sendQueuedClientPerfSamples();
    return sample;
}

function clientPerfShouldSampleFrames() {
    // isGenerating: public/scripts/comp/generationOrchestrator.js
    if (typeof isGenerating !== 'undefined' && isGenerating) return false;
    // directorInstance: public/scripts/comp/director.js
    if (typeof directorInstance !== 'undefined' && directorInstance && directorInstance._running) return false;
    return true;
}

function sampleClientPerfFrame(timestamp) {
    if (!clientPerfShouldSampleFrames()) {
        clientPerfState.frameRafId = 0;
        clientPerfState.lastFrameAt = 0;
        return;
    }
    if (clientPerfState.lastFrameAt) {
        clientPerfState.frameTimes.push(Math.round((timestamp - clientPerfState.lastFrameAt) * 100) / 100);
    }
    clientPerfState.lastFrameAt = timestamp;
    clientPerfState.frameRafId = requestAnimationFrame(sampleClientPerfFrame);
}

function startClientPerfFrameWindow() {
    if (clientPerfState.frameRafId) return;
    if (!clientPerfShouldSampleFrames()) return;
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

    const phone = clientPerfState.phone;
    clientPerfState.visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
            phone.flushOnSleep('visibility');
        } else if (!phone.asleep()) {
            startClientPerfFrameWindow();
        }
    };
    document.addEventListener('visibilitychange', clientPerfState.visibilityHandler);
    // a phone's screen going off does not hide the page (the app's melatonscreen event)
    clientPerfState.screenHandler = (event) => {
        if (!(event && event.detail && event.detail.on)) phone.flushOnSleep('screen_off');
        else if (!phone.asleep()) startClientPerfFrameWindow();
    };
    window.addEventListener('melatonscreen', clientPerfState.screenHandler);

    clientPerfState.modalLifecycleHandler = (event) => {
        recordClientPerfModalEvent(event.detail?.type);
    };
    document.addEventListener('staticforge:modal-lifecycle', clientPerfState.modalLifecycleHandler);

    clientPerfState.connectedHandler = () => sendQueuedClientPerfSamples();
    wsClient.on('connected', clientPerfState.connectedHandler);

    clientPerfState.activity.seen = false;
    clientPerfState.activity.arm();
    startClientPerfFrameWindow();
    clientPerfState.intervalId = setInterval(() => {
        // nothing is measured or sent while the page is out of sight or a phone's screen is off (going
        // out of sight sent that minute already); a hidden desktop tab too (#890: it measured no frames)
        if (document.visibilityState === 'hidden' || document.documentElement.dataset.screenOff !== undefined) return;
        // a quiet minute (no input, nothing animating) has no frames to time: sampled at once, without the window
        if (!clientPerfState.activity.take()) {
            flushClientPerfSample('interval');
            return;
        }
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
    clientPerfState.activity.disarm();
    clientPerfState.domLists = null;
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
    if (clientPerfState.screenHandler) {
        window.removeEventListener('melatonscreen', clientPerfState.screenHandler);
        clientPerfState.screenHandler = null;
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
