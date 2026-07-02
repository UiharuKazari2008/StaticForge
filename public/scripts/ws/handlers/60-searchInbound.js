// Search inbound WebSocket handlers — indexing status and realtime search updates.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleSearchIndexingStatusMessage(message, wsClient) {
    const indicator = document.getElementById('searchIndexingIndicator');
    if (!indicator) return;

    const icon = indicator.querySelector('i');
    if (!icon) return;

    const status = message.status || 'idle';
    const statusMessage = message.message || 'Search index up to date';

    indicator.title = statusMessage;
    indicator.classList.remove('indexing', 'up_to_date', 'error', 'paused', 'cache_init', 'cache_ready', 'idle');

    switch (status) {
        case 'starting':
        case 'indexing':
        case 'cache_init':
            indicator.classList.add('indexing');
            icon.className = 'fas fa-magnifying-glass-arrows-rotate';
            break;
        case 'complete':
        case 'up_to_date':
        case 'cache_ready':
            indicator.classList.add('up_to_date');
            icon.className = 'fas fa-file-magnifying-glass';
            break;
        case 'paused':
            indicator.classList.add('paused');
            icon.className = 'fas fa-magnifying-glass-minus';
            break;
        case 'resumed':
        case 'idle':
            indicator.classList.add('up_to_date');
            icon.className = 'fas fa-magnifying-glass';
            break;
        case 'error':
            indicator.classList.add('error');
            icon.className = 'fas fa-rotate-exclamation';
            break;
        default:
            icon.className = 'fas fa-magnifying-glass';
            break;
    }

    if (status === 'paused') {
        indicator.dataset.indexingPaused = 'true';
    } else if (status === 'resumed' || status === 'idle' || status === 'up_to_date' || status === 'complete') {
        indicator.dataset.indexingPaused = 'false';
    }

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
