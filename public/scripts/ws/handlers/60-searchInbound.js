// Search inbound WebSocket handlers — indexing status and realtime search updates.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function resolvePromptFtsPayloadFromMessage(message) {
    if (!message) return null;
    if (message.job === 'prompt_fts') return message;
    if (message.promptFts) return { job: 'prompt_fts', ...message.promptFts };
    return null;
}

function applyPromptFtsIndexingDatasets(indicator, payload) {
    indicator.dataset.promptFtsStatus = payload.status || 'idle';
    indicator.dataset.promptFtsPending = String(payload.stats?.ftsPending ?? '');
    indicator.dataset.promptFtsRunning = payload.running ? 'true' : 'false';
    indicator.dataset.promptFtsPaused = payload.paused ? 'true' : 'false';
}

function applySearchTrayCombinedState(indicator) {
    const icon = indicator.querySelector('i');
    if (!icon) return;

    const jobs = indicator._indexJobs || {};
    const sync = jobs.search_sync || {};
    const fts = jobs.prompt_fts || {};
    const ftsStats = fts.stats || {};
    const ftsPending = ftsStats.ftsPending || 0;
    const ftsDrift = ftsStats.ftsDrift || 0;

    const activeStatuses = ['starting', 'indexing', 'cache_init'];
    const activeJob = activeStatuses.includes(fts.status) ? fts
        : activeStatuses.includes(sync.status) ? sync
        : null;

    indicator.classList.remove('indexing', 'up_to_date', 'error', 'paused', 'cache_init', 'cache_ready', 'idle', 'pending');

    if (activeJob) {
        const status = activeJob.status;
        const statusMessage = activeJob.message || 'Indexing in progress';
        indicator.title = statusMessage;
        indicator.dataset.indexingJob = activeJob.job || 'search_sync';

        if (status === 'cache_init') {
            indicator.classList.add('cache_init', 'indexing');
            icon.className = 'fas fa-magnifying-glass-arrows-rotate';
        } else {
            indicator.classList.add('indexing');
            icon.className = activeJob.job === 'prompt_fts'
                ? 'fas fa-database'
                : 'fas fa-magnifying-glass-arrows-rotate';
        }
        return;
    }

    if (fts.status === 'paused' || sync.status === 'paused') {
        const pausedJob = fts.status === 'paused' ? fts : sync;
        indicator.title = pausedJob.message || 'Indexing paused';
        indicator.dataset.indexingJob = pausedJob.job || 'search_sync';
        indicator.classList.add('paused');
        icon.className = 'fas fa-magnifying-glass-minus';
        indicator.dataset.indexingPaused = 'true';
        return;
    }

    if (sync.status === 'error' || fts.status === 'error') {
        const errJob = fts.status === 'error' ? fts : sync;
        indicator.title = errJob.message || 'Indexing error';
        indicator.dataset.indexingJob = errJob.job || 'search_sync';
        indicator.classList.add('error');
        icon.className = 'fas fa-rotate-exclamation';
        return;
    }

    if (ftsPending > 0 || ftsDrift > 0) {
        indicator.title = fts.message || `Prompt FTS backlog: ${ftsPending} pending`;
        indicator.dataset.indexingJob = 'prompt_fts';
        indicator.classList.add('pending');
        icon.className = 'fas fa-rotate-exclamation';
        indicator.dataset.promptFtsPending = String(ftsPending);
        indicator.dataset.promptFtsStatus = fts.status || 'pending';
        indicator.dataset.indexingPaused = 'false';
        return;
    }

    const idleMessage = sync.message || fts.message || 'Search index up to date';
    indicator.title = idleMessage;
    indicator.dataset.indexingJob = '';
    indicator.dataset.promptFtsPending = '0';
    indicator.dataset.promptFtsStatus = fts.status || 'up_to_date';
    indicator.dataset.indexingPaused = 'false';

    if (sync.status === 'cache_ready') {
        indicator.classList.add('cache_ready', 'up_to_date');
        icon.className = 'fas fa-file-magnifying-glass';
    } else if (sync.status === 'complete' || fts.status === 'complete') {
        indicator.classList.add('up_to_date');
        icon.className = 'fas fa-file-magnifying-glass';
    } else {
        indicator.classList.add('up_to_date');
        icon.className = 'fas fa-magnifying-glass';
    }
}

function handleSearchIndexingStatusMessage(message, wsClient) {
    const indicator = document.getElementById('searchIndexingIndicator');
    if (!indicator) return;

    wsClient._lastSearchIndexingStatus = message;

    if (!indicator._indexJobs) indicator._indexJobs = {};

    const promptFtsPayload = resolvePromptFtsPayloadFromMessage(message);
    if (promptFtsPayload) {
        indicator._indexJobs.prompt_fts = promptFtsPayload;
        wsClient._lastPromptFtsIndexingStatus = promptFtsPayload;
        applyPromptFtsIndexingDatasets(indicator, promptFtsPayload);
    }

    if (message.job !== 'prompt_fts') {
        indicator._indexJobs.search_sync = {
            job: 'search_sync',
            status: message.status || 'idle',
            message: message.message,
            paused: message.paused,
            indexing: message.indexing,
            current: message.current,
            total: message.total,
            percentage: message.percentage,
            filename: message.filename
        };
        indicator.dataset.searchSyncStatus = message.status || 'idle';
        if (message.status === 'paused') {
            indicator.dataset.indexingPaused = 'true';
        } else if (message.status === 'resumed' || message.status === 'idle' || message.status === 'up_to_date' || message.status === 'complete') {
            indicator.dataset.indexingPaused = 'false';
        }
    }

    applySearchTrayCombinedState(indicator);

    if (indicator._menuConfigFn && contextMenu) {
        contextMenu.attachToElement(indicator, indicator._menuConfigFn());
    }

    wsClient.triggerEvent('search_indexing_status', message);
}

function handleRealtimeSearchUpdateMessage(message, wsClient) {
    // handleSearchResponse: public/scripts/comp/autocompleteUtils.js
    handleSearchResponse(message);
    wsClient.triggerEvent(message.type, message);
}

registerWsInboundHandler({
    id: 'search.indexing_status',
    type: 'search_indexing_status',
    phase: 'only',
    handler(message, wsClient) {
        handleSearchIndexingStatusMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'search.results_update',
    type: 'search_results_update',
    phase: 'only',
    handler(message, wsClient) {
        handleRealtimeSearchUpdateMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'search.status_update',
    type: 'search_status_update',
    phase: 'only',
    handler(message, wsClient) {
        handleRealtimeSearchUpdateMessage(message, wsClient);
    }
});

registerWsInboundHandler({
    id: 'search.results_complete',
    type: 'search_results_complete',
    phase: 'only',
    handler(message, wsClient) {
        handleRealtimeSearchUpdateMessage(message, wsClient);
    }
});
