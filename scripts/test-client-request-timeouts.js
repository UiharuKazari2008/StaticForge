const assert = require('assert');
const { SearchService } = require('../modules/searchService');

function stubResources() {
    return {
        isInitialized: () => false,
        getConfig: () => ({}),
        getSpellChecker: () => null,
        getWordLookupService: () => null,
        getTagAutofillSearch: () => null
    };
}

async function testSearchTurnTimeoutUnblocksLane() {
    const prevTimeout = SearchService.SEARCH_TURN_TIMEOUT_MS;
    SearchService.SEARCH_TURN_TIMEOUT_MS = 80;
    try {
        const service = new SearchService(stubResources());
        const key = 'sess1_v5';
        service.processLatestRequest = async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return { results: ['late'] };
        };
        service.latestRequests.set(key, {
            query: 'smug',
            model: 'v5',
            requestId: 'search_old',
            timestamp: Date.now()
        });

        const first = await service.waitForSearchTurn(key, 'search_old');
        assert.strictEqual(first.timedOut, true);
        assert.strictEqual(service.isProcessing.get(key), false);

        let ran = false;
        service.processLatestRequest = async () => {
            ran = true;
            return { results: ['fresh'] };
        };
        service.latestRequests.set(key, {
            query: 'smug grin',
            model: 'v5',
            requestId: 'search_new',
            timestamp: Date.now()
        });
        const second = await service.waitForSearchTurn(key, 'search_new');
        assert.strictEqual(ran, true);
        assert.strictEqual(second.processed, true);
        assert.deepStrictEqual(second.results, ['fresh']);
    } finally {
        SearchService.SEARCH_TURN_TIMEOUT_MS = prevTimeout;
    }
}

async function testClearSessionSearchState() {
    const service = new SearchService(stubResources());
    service.isProcessing.set('sessA_v5', true);
    service.latestRequests.set('sessA_v5', { requestId: 'x' });
    service.sessionRateLimiters.set('sessA_v5', {
        sessionId: 'sessA',
        model: 'v5',
        pendingRequest: null,
        isProcessing: true
    });
    service.isProcessing.set('sessB_v5', true);

    service.clearSessionSearchState('sessA');

    assert.strictEqual(service.isProcessing.has('sessA_v5'), false);
    assert.strictEqual(service.latestRequests.has('sessA_v5'), false);
    assert.strictEqual(service.sessionRateLimiters.has('sessA_v5'), false);
    assert.strictEqual(service.isProcessing.get('sessB_v5'), true);
}

function testClientTimeoutPolicy() {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
    assert.ok(src.includes('LIGHT_REQUEST_TYPES'), 'light request set missing');
    assert.ok(src.includes('resolveRequestTimeoutMs'), 'timeout resolver missing');
    assert.ok(/sendMessageWithRequestId[\s\S]*timeoutId = setTimeout/.test(src), 'sendMessageWithRequestId still has no timeout');
    assert.ok(src.includes('stuckHidden'), 'stuck ticker visibility missing');
    assert.ok(src.includes('this.clearPendingRequests()'), 'onerror/disconnect must clear pending');
}

async function main() {
    await testSearchTurnTimeoutUnblocksLane();
    await testClearSessionSearchState();
    testClientTimeoutPolicy();
    console.log('test-client-request-timeouts: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
