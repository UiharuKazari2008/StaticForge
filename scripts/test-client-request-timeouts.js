const assert = require('assert');
const { EventEmitter } = require('events');
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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testSearchTurnTimeoutUnblocksLane() {
    const prevTimeout = SearchService.SEARCH_TURN_TIMEOUT_MS;
    SearchService.SEARCH_TURN_TIMEOUT_MS = 80;
    try {
        const service = new SearchService(stubResources());
        const key = 'sess1_v5';
        service.processLatestRequest = async () => {
            await delay(1000);
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

async function testQueuedSearchKeepsOwnBudgetAndRequestId() {
    const prevTimeout = SearchService.SEARCH_TURN_TIMEOUT_MS;
    SearchService.SEARCH_TURN_TIMEOUT_MS = 400;
    try {
        const service = new SearchService(stubResources());
        const key = 'sess_v5';
        const sent = [];
        const ws = {
            send: (s) => sent.push(JSON.parse(s)),
            readyState: 1
        };
        const durations = { A: 600, B: 100 };

        service.processLatestRequest = async function (k) {
            const r = this.latestRequests.get(k);
            const { ctx, ws: searchWs } = this._bindSearchCallContext(k, r);
            const me = r.query;
            try {
                await delay(durations[me]);
                this.sendSearchWs(searchWs, {
                    type: 'search_characters_response',
                    data: { results: ['from-' + me] }
                });
                return { results: ['from-' + me], spellCheck: null };
            } finally {
                if (this._activeSearchCtx.get(k) === ctx) {
                    this._activeSearchCtx.delete(k);
                }
            }
        };

        const enter = (q, id) => {
            service.latestRequests.set(key, {
                query: q,
                requestId: id,
                autofillSessionId: 'af-' + id,
                timestamp: Date.now(),
                ws
            });
            return service.waitForSearchTurn(key, id);
        };

        const pA = enter('A', 'req-A');
        await delay(50);
        const pB = enter('B', 'req-B');
        const [a, b] = await Promise.all([pA, pB]);

        assert.strictEqual(a.timedOut, true, 'stuck A must time out');
        assert.strictEqual(b.processed, true, 'healthy B queued behind A must still run');
        assert.deepStrictEqual(b.results, ['from-B']);
        assert.notStrictEqual(b.timedOut, true, 'B must get its own processing budget');

        await delay(250);

        const fromA = sent.filter((p) => p.data && p.data.results && p.data.results[0] === 'from-A');
        const fromB = sent.filter((p) => p.data && p.data.results && p.data.results[0] === 'from-B');
        assert.strictEqual(fromA.length, 0, 'timed-out A must not send after cancel');
        assert.ok(fromB.length >= 1, 'B must send its own packet');
        for (const pkt of fromB) {
            assert.strictEqual(pkt.requestId, 'req-B');
            assert.strictEqual(pkt.autofillSessionId, 'af-req-B');
        }
    } finally {
        SearchService.SEARCH_TURN_TIMEOUT_MS = prevTimeout;
    }
}

function testClearSessionSearchState() {
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

function testClearSearchStateForSocketKeepsLiveTab() {
    const service = new SearchService(stubResources());
    const wsOld = { id: 'old' };
    const wsLive = { id: 'live' };
    service.isProcessing.set('sessA_v5', true);
    service.latestRequests.set('sessA_v5', { requestId: 'live', ws: wsLive });
    service.latestRequests.set('sessA_v4', { requestId: 'old', ws: wsOld });
    service.sessionRateLimiters.set('sessA_v5', {
        sessionId: 'sessA',
        model: 'v5',
        pendingRequest: null,
        isProcessing: true
    });

    service.clearSearchStateForSocket(wsOld, 'sessA', { sessionHasOtherClients: true });

    assert.strictEqual(service.latestRequests.has('sessA_v4'), false);
    assert.strictEqual(service.latestRequests.get('sessA_v5').requestId, 'live');
    assert.strictEqual(service.isProcessing.get('sessA_v5'), true);
    assert.strictEqual(service.sessionRateLimiters.has('sessA_v5'), true);
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
    assert.ok(src.includes("'resolve_dynamic_context'"), 'Rentan must be in the timeout table');
    assert.ok(src.includes("'recompile_runtime_assets'"), 'recompile must be in the timeout table');
    assert.ok(
        /PROGRESS_REQUEST_TYPES = new Set\(\[[\s\S]*resolve_dynamic_context[\s\S]*recompile_runtime_assets/.test(src),
        'Rentan/recompile must be PROGRESS so keep-alive/default 3-5m does not cut them'
    );
    assert.ok(
        /t === 'search_files' \|\| t === 'omegasearch_query'/.test(src),
        'cold gallery queries must not stay on the 8-20s light floor'
    );
    assert.ok(src.includes('isSilentTickerRequest(request.type)'), 'stuckHidden must honor silent ticker types');
}

function fakeHttps(onRequest) {
    return {
        request(_opts, cb) {
            const req = new EventEmitter();
            req.destroy = () => {
                req.emit('error', new Error('destroyed'));
            };
            req.end = () => {
                onRequest(req, cb);
            };
            return req;
        }
    };
}

function emitResponse(cb, { statusCode = 200, encoding = 'gzip', chunks = [Buffer.from('{}')], error = null, endDelay = 0 } = {}) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = { 'content-encoding': encoding };
    cb(res);
    if (error) {
        setImmediate(() => res.emit('error', error));
        return res;
    }
    setImmediate(() => {
        for (const chunk of chunks) {
            res.emit('data', chunk);
        }
        setTimeout(() => res.emit('end'), endDelay);
    });
    return res;
}

function tagRequestService() {
    const service = new SearchService(stubResources());
    service.globalResources.getApiKeyManager = () => ({
        recordApiSuccess() {},
        recordApiFailure() {}
    });
    return service;
}

async function assertSettles(promise, rejectMatch) {
    const raced = await Promise.race([
        promise.then((value) => ({ ok: true, value })).catch((error) => ({ ok: false, error })),
        delay(250).then(() => ({ hung: true }))
    ]);
    assert.notStrictEqual(raced.hung, true, 'suggest-tags request hung');
    if (rejectMatch) {
        assert.strictEqual(raced.ok, false, 'suggest-tags request should reject');
        assert.match(String(raced.error && raced.error.message), rejectMatch);
    }
    return raced;
}

async function testSuggestTagsErrorPathsSettle() {
    const url = 'https://image.novelai.net/ai/generate-image/suggest-tags?model=v5&prompt=cat';

    const decompressRejects = tagRequestService()._httpsSuggestTagsRequest({
        url,
        headers: {},
        abortSignal: new AbortController().signal,
        sessionId: 'sess',
        apiModel: 'v5',
        requestId: 'req-decompress',
        httpsModule: fakeHttps((_req, cb) => emitResponse(cb)),
        decompress: async () => {
            throw new Error('bad gzip');
        }
    });
    await assertSettles(decompressRejects, /bad gzip/);

    const streamRejects = tagRequestService()._httpsSuggestTagsRequest({
        url,
        headers: {},
        abortSignal: new AbortController().signal,
        sessionId: 'sess',
        apiModel: 'v5',
        requestId: 'req-stream',
        httpsModule: fakeHttps((_req, cb) => emitResponse(cb, { error: new Error('socket reset') })),
        decompress: async (buf) => buf
    });
    await assertSettles(streamRejects, /Response error: socket reset/);

    const abortController = new AbortController();
    const abortRejects = tagRequestService()._httpsSuggestTagsRequest({
        url,
        headers: {},
        abortSignal: abortController.signal,
        sessionId: 'sess',
        apiModel: 'v5',
        requestId: 'req-abort',
        httpsModule: fakeHttps((_req, cb) => {
            emitResponse(cb, { endDelay: 40 });
            setImmediate(() => abortController.abort());
        }),
        decompress: async (buf) => buf
    });
    await assertSettles(abortRejects, /superseded/);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const preAbortRejects = tagRequestService()._httpsSuggestTagsRequest({
        url,
        headers: {},
        abortSignal: alreadyAborted.signal,
        sessionId: 'sess',
        apiModel: 'v5',
        requestId: 'req-preabort',
        httpsModule: fakeHttps(() => {
            throw new Error('should not start https request');
        }),
        decompress: async (buf) => buf
    });
    await assertSettles(preAbortRejects, /superseded/);

    const success = tagRequestService()._httpsSuggestTagsRequest({
        url,
        headers: {},
        abortSignal: new AbortController().signal,
        sessionId: 'sess',
        apiModel: 'v5',
        requestId: 'req-ok',
        httpsModule: fakeHttps((_req, cb) => emitResponse(cb, {
            encoding: 'identity',
            chunks: [Buffer.from(JSON.stringify({ tags: [{ tag: 'cat', count: 1, confidence: 1 }] }))]
        })),
        decompress: async (buf) => buf
    });
    const settled = await assertSettles(success);
    assert.strictEqual(settled.ok, true);
    assert.strictEqual(settled.value.tags[0].tag, 'cat');
}

async function main() {
    await testSearchTurnTimeoutUnblocksLane();
    await testQueuedSearchKeepsOwnBudgetAndRequestId();
    await testSuggestTagsErrorPathsSettle();
    testClearSessionSearchState();
    testClearSearchStateForSocketKeepsLiveTab();
    testClientTimeoutPolicy();
    console.log('test-client-request-timeouts: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
